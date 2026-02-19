/**
 * Nidra Daemon — Background Sleep Cycle Manager.
 *
 * "Nidra" (निद्रा) means Sleep. The daemon orchestrates a 3-state machine:
 *   LISTENING -> idle timeout -> DREAMING -> dream done -> DEEP_SLEEP -> maintenance -> LISTENING
 *
 * Each state runs at a different heartbeat cadence. DREAMING invokes Svapna
 * consolidation; DEEP_SLEEP triggers maintenance (VACUUM, GC, index rebuilds).
 *
 * Persistence, snapshot building, and timer utilities live in
 * nidra-daemon-persistence.ts — all pure functions on state bags.
 */

import type { EventBus } from "@chitragupta/core";
import { createLogger } from "@chitragupta/core";
import type { NidraConfig, NidraState, NidraSnapshot } from "./types.js";
import { DEFAULT_NIDRA_CONFIG } from "./types.js";
import {
	persistNidraState, restoreNidraState, persistHeartbeat,
	buildNidraSnapshot, unrefTimer, VALID_TRANSITIONS,
	type DreamHandler, type DeepSleepHandler, type DreamProgressFn,
	type NidraDaemonState,
} from "./nidra-daemon-persistence.js";

// Re-export persistence utilities for consumers
export {
	persistNidraState, restoreNidraState, persistHeartbeat,
	buildNidraSnapshot, unrefTimer, VALID_TRANSITIONS,
	type DreamHandler, type DeepSleepHandler, type DreamProgressFn,
	type NidraDaemonState,
} from "./nidra-daemon-persistence.js";

const log = createLogger("nidra");

// ─── NidraDaemon ─────────────────────────────────────────────────────────────

/**
 * Background sleep-cycle daemon with a 3-state machine, drift-correcting
 * heartbeat, SQLite persistence, and integration hooks for Svapna
 * consolidation and deep-sleep maintenance.
 */
export class NidraDaemon {
	private readonly config: NidraConfig;
	private readonly events: EventBus | null;

	private state: NidraState = "LISTENING";
	private lastStateChange: number = Date.now();
	private lastHeartbeat: number = Date.now();
	private lastConsolidationStart: number | undefined;
	private lastConsolidationEnd: number | undefined;
	private consolidationPhase: import("./types.js").SvapnaPhase | undefined;
	private consolidationProgress: number = 0;
	private startedAt: number = 0;

	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private phaseDurationTimer: ReturnType<typeof setTimeout> | null = null;
	private expectedHeartbeatTime: number = 0;

	private dreamHandler: DreamHandler | null = null;
	private deepSleepHandler: DeepSleepHandler | null = null;

	private running = false;
	private disposed = false;
	private dreamAbort: AbortController | null = null;

	constructor(config?: Partial<NidraConfig>, events?: EventBus) {
		this.config = { ...DEFAULT_NIDRA_CONFIG, ...config };
		this.events = events ?? null;
	}

	/** Start the daemon. Restores persisted state, then begins heartbeat + idle timer. */
	start(): void {
		this.assertNotDisposed();
		if (this.running) return;
		this.running = true;
		this.startedAt = Date.now();
		this.restore();
		this.scheduleHeartbeat();
		this.schedulePhaseTransition();
		log.info(`Nidra daemon started in state=${this.state}`);
	}

	/** Stop the daemon gracefully. Cancels timers, aborts in-flight consolidation, persists state. */
	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		this.clearAllTimers();
		if (this.dreamAbort) { this.dreamAbort.abort(); this.dreamAbort = null; }
		this.persist();
		log.info("Nidra daemon stopped");
	}

	/** Force wake — interrupt from any state back to LISTENING. */
	wake(): void {
		this.assertNotDisposed();
		if (!this.running) return;
		if (this.state === "LISTENING") { this.resetIdleTimer(); return; }
		if (this.state === "DREAMING" && this.dreamAbort) { this.dreamAbort.abort(); this.dreamAbort = null; }
		log.info(`Nidra wake interrupt: ${this.state} -> LISTENING`);
		this.transitionTo("LISTENING", true);
	}

	/** Register user activity. Resets idle timer or triggers wake interrupt. */
	touch(): void {
		this.assertNotDisposed();
		if (!this.running) return;
		if (this.state === "LISTENING") this.resetIdleTimer();
		else this.wake();
	}

	/** Get a read-only snapshot of the daemon's current state. */
	snapshot(): NidraSnapshot { return buildNidraSnapshot(this.getStateBag()); }

	/** Register the dream handler (Svapna consolidation plug-in). */
	onDream(handler: DreamHandler): void { this.dreamHandler = handler; }

	/** Register the deep sleep handler (maintenance plug-in). */
	onDeepSleep(handler: DeepSleepHandler): void { this.deepSleepHandler = handler; }

	/** Persist current state to the nidra_state singleton row. */
	persist(): void { persistNidraState(this.getStateBag()); }

	/** Restore state from the nidra_state singleton row. */
	restore(): void {
		const bag = this.getStateBag();
		restoreNidraState(bag);
		this.state = bag.state;
		this.lastStateChange = bag.lastStateChange;
		this.lastHeartbeat = bag.lastHeartbeat;
		this.lastConsolidationStart = bag.lastConsolidationStart;
		this.lastConsolidationEnd = bag.lastConsolidationEnd;
		this.consolidationPhase = bag.consolidationPhase;
		this.consolidationProgress = bag.consolidationProgress;
	}

	/** Dispose — stop and release all resources. Cannot be restarted. */
	dispose(): void {
		if (this.disposed) return;
		this.running = false;
		this.clearAllTimers();
		if (this.dreamAbort) { this.dreamAbort.abort(); this.dreamAbort = null; }
		this.dreamHandler = null;
		this.deepSleepHandler = null;
		this.disposed = true;
		log.debug("Nidra daemon disposed");
	}

	// ─── State Machine ───────────────────────────────────────────────────

	private transitionTo(target: NidraState, interrupt = false): void {
		if (!this.running || this.disposed) return;
		if (!interrupt) {
			const expected = VALID_TRANSITIONS.get(this.state);
			if (expected !== target) {
				log.warn(`Invalid transition: ${this.state} -> ${target} (expected ${expected})`);
				return;
			}
		}
		const prev = this.state;
		const now = Date.now();
		this.state = target;
		this.lastStateChange = now;
		if (prev === "DREAMING" && target !== "DREAMING") {
			this.consolidationPhase = undefined;
			this.consolidationProgress = 0;
		}
		this.persist();
		this.emit("nidra:state_change", { prev, next: target, timestamp: now });
		log.info(`State transition: ${prev} -> ${target}`);
		this.clearAllTimers();
		this.scheduleHeartbeat();
		this.schedulePhaseTransition();
		if (target === "DREAMING") this.runDreamPhase();
		else if (target === "DEEP_SLEEP") this.runDeepSleepPhase();
	}

	// ─── Phase Handlers ──────────────────────────────────────────────────

	private runDreamPhase(): void {
		if (!this.dreamHandler) return;
		this.dreamAbort = new AbortController();
		const { signal } = this.dreamAbort;
		const now = Date.now();
		this.lastConsolidationStart = now;
		this.emit("nidra:consolidation_start", { timestamp: now });

		const progress: DreamProgressFn = (phase, pct) => {
			if (signal.aborted) return;
			this.consolidationPhase = phase;
			this.consolidationProgress = Math.max(0, Math.min(1, pct));
			this.persist();
		};

		this.dreamHandler(progress)
			.then(() => {
				if (signal.aborted || !this.running) return;
				const end = Date.now();
				this.lastConsolidationEnd = end;
				this.emit("nidra:consolidation_end", {
					timestamp: end, durationMs: end - (this.lastConsolidationStart ?? end),
				});
				log.info("Dream consolidation complete");
			})
			.catch((err: unknown) => {
				if (signal.aborted) return;
				log.error("Dream handler failed", { error: String(err) });
			})
			.finally(() => { this.dreamAbort = null; });
	}

	private runDeepSleepPhase(): void {
		if (!this.deepSleepHandler) return;
		this.deepSleepHandler()
			.then(() => { if (this.running) log.info("Deep sleep maintenance complete"); })
			.catch((err: unknown) => { log.error("Deep sleep handler failed", { error: String(err) }); });
	}

	// ─── Drift-Correcting Heartbeat ──────────────────────────────────────

	private scheduleHeartbeat(): void {
		const interval = this.config.heartbeatMs[this.state];
		this.expectedHeartbeatTime = Date.now() + interval;
		const tick = (): void => {
			if (!this.running || this.disposed) return;
			const now = Date.now();
			this.lastHeartbeat = now;
			this.emit("nidra:heartbeat", { state: this.state, timestamp: now, uptime: now - this.startedAt });
			persistHeartbeat(now);
			const drift = now - this.expectedHeartbeatTime;
			const nextInterval = this.config.heartbeatMs[this.state];
			const corrected = Math.max(0, nextInterval - drift);
			this.expectedHeartbeatTime = now + corrected;
			this.heartbeatTimer = setTimeout(tick, corrected);
			unrefTimer(this.heartbeatTimer);
		};
		this.heartbeatTimer = setTimeout(tick, interval);
		unrefTimer(this.heartbeatTimer);
	}

	// ─── Phase Duration Scheduling ───────────────────────────────────────

	private schedulePhaseTransition(): void {
		switch (this.state) {
			case "LISTENING": this.resetIdleTimer(); break;
			case "DREAMING":
				this.phaseDurationTimer = setTimeout(() => {
					if (!this.running || this.disposed) return;
					this.transitionTo("DEEP_SLEEP");
				}, this.config.dreamDurationMs);
				unrefTimer(this.phaseDurationTimer);
				break;
			case "DEEP_SLEEP":
				this.phaseDurationTimer = setTimeout(() => {
					if (!this.running || this.disposed) return;
					this.transitionTo("LISTENING");
				}, this.config.deepSleepDurationMs);
				unrefTimer(this.phaseDurationTimer);
				break;
		}
	}

	private resetIdleTimer(): void {
		if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
		if (this.state !== "LISTENING" || !this.running) return;
		this.idleTimer = setTimeout(() => {
			if (!this.running || this.disposed) return;
			if (this.state !== "LISTENING") return;
			this.transitionTo("DREAMING");
		}, this.config.idleTimeoutMs);
		unrefTimer(this.idleTimer);
	}

	// ─── Utilities ───────────────────────────────────────────────────────

	private clearAllTimers(): void {
		if (this.heartbeatTimer !== null) { clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null; }
		if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null; }
		if (this.phaseDurationTimer !== null) { clearTimeout(this.phaseDurationTimer); this.phaseDurationTimer = null; }
	}

	private emit(event: string, data: unknown): void {
		if (!this.events) return;
		try { this.events.emit(event, data); } catch { /* swallow */ }
	}

	private assertNotDisposed(): void {
		if (this.disposed) throw new Error("NidraDaemon has been disposed.");
	}

	/** Build a state bag for persistence functions. */
	private getStateBag(): NidraDaemonState {
		return {
			state: this.state, lastStateChange: this.lastStateChange,
			lastHeartbeat: this.lastHeartbeat,
			lastConsolidationStart: this.lastConsolidationStart,
			lastConsolidationEnd: this.lastConsolidationEnd,
			consolidationPhase: this.consolidationPhase,
			consolidationProgress: this.consolidationProgress,
			startedAt: this.startedAt, running: this.running,
		};
	}
}
