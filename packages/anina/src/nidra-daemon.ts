/**
 * Nidra Daemon — Background Sleep Cycle Manager.
 *
 * Orchestrates a 3-state machine:
 *   LISTENING -> DREAMING -> DEEP_SLEEP -> LISTENING
 *
 * Autonomous DEEP_SLEEP entry: 5 consecutive idle DREAMING cycles OR 20
 * processed sessions since last DEEP_SLEEP. New session during DEEP_SLEEP
 * wakes back to LISTENING. Persistence utilities live in nidra-daemon-persistence.ts.
 */

import type { EventBus } from "@chitragupta/core";
import { createLogger } from "@chitragupta/core";
import type { NidraConfig, NidraState, NidraSnapshot } from "./types.js";
import { DEFAULT_NIDRA_CONFIG } from "./types.js";
import {
	persistNidraState, restoreNidraState, persistHeartbeat,
	buildNidraSnapshot, unrefTimer, VALID_TRANSITIONS,
	type DreamHandler, type DeepSleepHandler, type DreamProgressFn,
	type DeepSleepConsolidationHandler, type NidraDaemonState,
} from "./nidra-daemon-persistence.js";

// Re-export persistence utilities for consumers
export {
	persistNidraState, restoreNidraState, persistHeartbeat,
	buildNidraSnapshot, unrefTimer, VALID_TRANSITIONS,
	type DreamHandler, type DeepSleepHandler, type DreamProgressFn,
	type DeepSleepConsolidationHandler, type NidraDaemonState,
} from "./nidra-daemon-persistence.js";

const log = createLogger("nidra");

// ─── NidraDaemon ─────────────────────────────────────────────────────────────

/**
 * Background sleep-cycle daemon with drift-correcting heartbeat, SQLite
 * persistence, and Swapna consolidation hooks. Autonomous DEEP_SLEEP entry
 * via consecutive idle dream cycles or session-count threshold.
 */
export class NidraDaemon {
	private readonly config: NidraConfig;
	private readonly events: EventBus | null;

	private state: NidraState = "LISTENING";
	private lastStateChange: number = Date.now();
	private lastHeartbeat: number = Date.now();
	private lastConsolidationStart: number | undefined;
	private lastConsolidationEnd: number | undefined;
	private consolidationPhase: import("./types.js").SwapnaPhase | undefined;
	private consolidationProgress: number = 0;
	private startedAt: number = 0;

	/** Consecutive DREAMING cycles where no new sessions were observed. */
	private consecutiveIdleDreamCycles: number = 0;
	/** Session IDs accumulated since last DEEP_SLEEP. Drives consolidation. */
	private pendingSessionIds: string[] = [];
	/** Total sessions recorded since last DEEP_SLEEP (includes duplicates). */
	private sessionsProcessedSinceDeepSleep: number = 0;
	/** Whether at least one session was seen during the current DREAMING cycle. */
	private sessionSeenThisDream: boolean = false;

	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private phaseDurationTimer: ReturnType<typeof setTimeout> | null = null;
	private expectedHeartbeatTime: number = 0;

	private dreamHandler: DreamHandler | null = null;
	private deepSleepHandler: DeepSleepHandler | null = null;
	private deepSleepConsolidationHandler: DeepSleepConsolidationHandler | null = null;

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

	/**
	 * Notify the daemon that a new session has been processed.
	 *
	 * - In LISTENING/DREAMING: records the session for pending consolidation,
	 *   marks the current DREAMING cycle as "active", and resets the idle-dream counter.
	 * - In DEEP_SLEEP: wakes the daemon back to LISTENING (new work has arrived).
	 *
	 * @param sessionId - Unique session identifier for consolidation tracking.
	 */
	notifySession(sessionId: string): void {
		this.assertNotDisposed();
		if (!this.running) return;

		// Wake from DEEP_SLEEP — new activity arrived
		if (this.state === "DEEP_SLEEP") {
			log.info(`Nidra: new session during DEEP_SLEEP, waking → LISTENING (session=${sessionId})`);
			this.wake();
			return;
		}

		// Track for consolidation
		if (!this.pendingSessionIds.includes(sessionId)) {
			this.pendingSessionIds.push(sessionId);
		}
		this.sessionsProcessedSinceDeepSleep += 1;
		this.sessionSeenThisDream = true;

		log.debug(`Nidra: session recorded (id=${sessionId}, total=${this.sessionsProcessedSinceDeepSleep})`);

		// State is LISTENING|DREAMING here (DEEP_SLEEP returned above).
		if (this.sessionsProcessedSinceDeepSleep >= this.config.sessionCountThreshold) {
			log.info(
				`Nidra: session threshold reached (${this.sessionsProcessedSinceDeepSleep}` +
				` >= ${this.config.sessionCountThreshold}), forcing DEEP_SLEEP`
			);
			this.forceDeepSleep();
		}
	}

	/** Get a read-only snapshot of the daemon's current state. */
	snapshot(): NidraSnapshot { return buildNidraSnapshot(this.getStateBag()); }

	/** Register the dream handler (Swapna consolidation plug-in). */
	onDream(handler: DreamHandler): void { this.dreamHandler = handler; }

	/** Register the deep sleep handler (maintenance plug-in, legacy single-pass). */
	onDeepSleep(handler: DeepSleepHandler): void { this.deepSleepHandler = handler; }

	/**
	 * Register the multi-session deep-sleep consolidation handler.
	 * When registered, supersedes the legacy `onDeepSleep` handler for
	 * DEEP_SLEEP runs; receives all pending session IDs in one pass.
	 */
	onDeepSleepConsolidation(handler: DeepSleepConsolidationHandler): void {
		this.deepSleepConsolidationHandler = handler;
	}

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
		// Note: session counters are not persisted (ephemeral per daemon lifetime)
	}

	/** Dispose — stop and release all resources. Cannot be restarted. */
	dispose(): void {
		if (this.disposed) return;
		this.running = false;
		this.clearAllTimers();
		if (this.dreamAbort) { this.dreamAbort.abort(); this.dreamAbort = null; }
		this.dreamHandler = null;
		this.deepSleepHandler = null;
		this.deepSleepConsolidationHandler = null;
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

		if (prev === "DREAMING" && target !== "DREAMING") {
			this.consolidationPhase = undefined;
			this.consolidationProgress = 0;
			if (this.sessionSeenThisDream) {
				this.consecutiveIdleDreamCycles = 0;
			} else {
				this.consecutiveIdleDreamCycles += 1;
				log.debug(`Nidra: idle dream cycle #${this.consecutiveIdleDreamCycles}`);
			}
			this.sessionSeenThisDream = false;
		}
		if (target === "DEEP_SLEEP") {
			this.consecutiveIdleDreamCycles = 0;
		}
		if (target === "LISTENING") {
			this.sessionsProcessedSinceDeepSleep = 0;
			this.pendingSessionIds = [];
			this.sessionSeenThisDream = false;
		}

		this.state = target;
		this.lastStateChange = now;
		this.persist();
		this.emit("nidra:state_change", { prev, next: target, timestamp: now });
		log.info(`State transition: ${prev} -> ${target}`);
		this.clearAllTimers();
		this.scheduleHeartbeat();
		this.schedulePhaseTransition();
		if (target === "DREAMING") this.runDreamPhase();
		else if (target === "DEEP_SLEEP") this.runDeepSleepPhase();
	}

	/**
	 * Immediately force a transition to DEEP_SLEEP regardless of timers.
	 * Aborts any in-flight DREAMING phase first.
	 */
	private forceDeepSleep(): void {
		if (!this.running || this.disposed) return;
		if (this.state === "DEEP_SLEEP") return;
		if (this.state === "DREAMING" && this.dreamAbort) {
			this.dreamAbort.abort();
			this.dreamAbort = null;
		}
		log.info("Nidra: forcing DEEP_SLEEP (autonomous entry)");
		this.transitionTo("DEEP_SLEEP", true);
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

	/**
	 * Run the DEEP_SLEEP phase.
	 * Prefers `deepSleepConsolidationHandler` (multi-session Swapna bulk pass)
	 * over the legacy `deepSleepHandler`.  After completion, clears pending sessions.
	 */
	private runDeepSleepPhase(): void {
		const sessionIds = [...this.pendingSessionIds];

		if (this.deepSleepConsolidationHandler) {
			log.info(
				`Nidra: DEEP_SLEEP bulk consolidation starting (sessions=${sessionIds.length})`
			);
			this.emit("nidra:deep_sleep_consolidation_start", {
				timestamp: Date.now(),
				sessionCount: sessionIds.length,
				sessionIds,
			});
			this.deepSleepConsolidationHandler(sessionIds)
				.then(() => {
					if (!this.running) return;
					log.info("Nidra: DEEP_SLEEP bulk consolidation complete");
					this.emit("nidra:deep_sleep_consolidation_end", {
						timestamp: Date.now(),
						sessionCount: sessionIds.length,
					});
					// Sessions consumed — clear only what we processed
					this.pendingSessionIds = this.pendingSessionIds.filter(
						(id) => !sessionIds.includes(id)
					);
				})
				.catch((err: unknown) => {
					log.error("Deep sleep consolidation handler failed", { error: String(err) });
				});
			return;
		}

		if (this.deepSleepHandler) {
			this.deepSleepHandler()
				.then(() => { if (this.running) log.info("Deep sleep maintenance complete"); })
				.catch((err: unknown) => { log.error("Deep sleep handler failed", { error: String(err) }); });
		}
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
					// Check autonomous DEEP_SLEEP entry: 5 consecutive idle cycles
					const willBeIdle = !this.sessionSeenThisDream;
					const idleCount = willBeIdle
						? this.consecutiveIdleDreamCycles + 1
						: 0;
					if (idleCount >= this.config.consecutiveIdleDreamThreshold) {
						log.info(
							`Nidra: ${idleCount} consecutive idle dream cycles` +
							` (threshold=${this.config.consecutiveIdleDreamThreshold}), forcing DEEP_SLEEP`
						);
					}
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
			consecutiveIdleDreamCycles: this.consecutiveIdleDreamCycles,
			sessionsProcessedSinceDeepSleep: this.sessionsProcessedSinceDeepSleep,
			pendingSessionIds: [...this.pendingSessionIds],
		};
	}
}
