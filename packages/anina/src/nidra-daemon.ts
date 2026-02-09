/**
 * Nidra Daemon — Background Sleep Cycle Manager.
 *
 * "Nidra" (निद्रा) means Sleep. The daemon orchestrates a 3-state machine
 * that governs the agent's background consciousness cycle:
 *
 *   LISTENING  → idle timeout  → DREAMING
 *   DREAMING   → dream done    → DEEP_SLEEP
 *   DEEP_SLEEP → maintenance   → LISTENING
 *   ANY        → user activity → LISTENING (interrupt)
 *
 * Each state runs at a different heartbeat cadence, emitting events and
 * persisting state to the nidra_state SQLite singleton row. The DREAMING
 * state invokes the Svapna consolidation pipeline; DEEP_SLEEP triggers
 * maintenance (VACUUM, GC, index rebuilds).
 *
 * Timer drift is corrected using the same setTimeout-chain technique
 * as KaalaBrahma — each tick compensates for scheduling jitter so the
 * heartbeat stays honest over long durations.
 */

import type { EventBus } from "@chitragupta/core";
import { createLogger } from "@chitragupta/core";
import { DatabaseManager } from "@chitragupta/smriti";
import type { NidraConfig, NidraState, NidraSnapshot, SvapnaPhase } from "./types.js";
import { DEFAULT_NIDRA_CONFIG } from "./types.js";

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Progress callback supplied to the dream handler. */
type DreamProgressFn = (phase: SvapnaPhase, pct: number) => void;

/** Async handler invoked when entering the DREAMING state. */
type DreamHandler = (progress: DreamProgressFn) => Promise<void>;

/** Async handler invoked when entering the DEEP_SLEEP state. */
type DeepSleepHandler = () => Promise<void>;

/** Valid state transitions. Any state can also jump to LISTENING via interrupt. */
const VALID_TRANSITIONS: ReadonlyMap<NidraState, NidraState> = new Map([
	["LISTENING", "DREAMING"],
	["DREAMING", "DEEP_SLEEP"],
	["DEEP_SLEEP", "LISTENING"],
]);

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

	// ── State ────────────────────────────────────────────────────────────
	private state: NidraState = "LISTENING";
	private lastStateChange: number = Date.now();
	private lastHeartbeat: number = Date.now();
	private lastConsolidationStart: number | undefined;
	private lastConsolidationEnd: number | undefined;
	private consolidationPhase: SvapnaPhase | undefined;
	private consolidationProgress: number = 0;
	private startedAt: number = 0;

	// ── Timers ───────────────────────────────────────────────────────────
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private phaseDurationTimer: ReturnType<typeof setTimeout> | null = null;
	private expectedHeartbeatTime: number = 0;

	// ── Handlers ─────────────────────────────────────────────────────────
	private dreamHandler: DreamHandler | null = null;
	private deepSleepHandler: DeepSleepHandler | null = null;

	// ── Lifecycle ────────────────────────────────────────────────────────
	private running = false;
	private disposed = false;
	private dreamAbort: AbortController | null = null;

	constructor(config?: Partial<NidraConfig>, events?: EventBus) {
		this.config = { ...DEFAULT_NIDRA_CONFIG, ...config };
		this.events = events ?? null;
	}

	// ─── Public API ──────────────────────────────────────────────────────

	/**
	 * Start the daemon. Restores persisted state if available, then begins
	 * the heartbeat loop and idle timer from the current state.
	 */
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

	/**
	 * Stop the daemon gracefully. Cancels all timers, aborts any in-flight
	 * consolidation, and persists the current state.
	 */
	async stop(): Promise<void> {
		if (!this.running) return;

		this.running = false;
		this.clearAllTimers();

		// Abort in-flight dream consolidation
		if (this.dreamAbort) {
			this.dreamAbort.abort();
			this.dreamAbort = null;
		}

		this.persist();
		log.info("Nidra daemon stopped");
	}

	/**
	 * Force wake — interrupt from any state back to LISTENING.
	 * Used when the user becomes active again.
	 */
	wake(): void {
		this.assertNotDisposed();
		if (!this.running) return;

		if (this.state === "LISTENING") {
			// Already listening — just reset the idle timer
			this.resetIdleTimer();
			return;
		}

		// Abort in-flight dream if waking from DREAMING
		if (this.state === "DREAMING" && this.dreamAbort) {
			this.dreamAbort.abort();
			this.dreamAbort = null;
		}

		log.info(`Nidra wake interrupt: ${this.state} -> LISTENING`);
		this.transitionTo("LISTENING", true);
	}

	/**
	 * Register user activity. Resets the idle timer so the daemon stays
	 * in LISTENING longer. If called while DREAMING or DEEP_SLEEP,
	 * triggers a full wake interrupt.
	 */
	touch(): void {
		this.assertNotDisposed();
		if (!this.running) return;

		if (this.state === "LISTENING") {
			this.resetIdleTimer();
		} else {
			// Activity during sleep states → wake up
			this.wake();
		}
	}

	/** Get a read-only snapshot of the daemon's current state. */
	snapshot(): NidraSnapshot {
		const now = Date.now();
		return {
			state: this.state,
			lastStateChange: this.lastStateChange,
			lastHeartbeat: this.lastHeartbeat,
			lastConsolidationStart: this.lastConsolidationStart,
			lastConsolidationEnd: this.lastConsolidationEnd,
			consolidationPhase: this.consolidationPhase,
			consolidationProgress: this.consolidationProgress,
			uptime: this.running ? now - this.startedAt : 0,
		};
	}

	/**
	 * Register the dream handler — invoked when entering the DREAMING state.
	 * This is where Svapna consolidation plugs in.
	 *
	 * @param handler - Async function receiving a progress reporter.
	 */
	onDream(handler: DreamHandler): void {
		this.dreamHandler = handler;
	}

	/**
	 * Register the deep sleep handler — invoked when entering DEEP_SLEEP.
	 * This is where maintenance (VACUUM, GC, index rebuild) plugs in.
	 *
	 * @param handler - Async function for maintenance work.
	 */
	onDeepSleep(handler: DeepSleepHandler): void {
		this.deepSleepHandler = handler;
	}

	/**
	 * Persist current state to the nidra_state singleton row in SQLite.
	 * Called automatically on every state transition and at stop().
	 */
	persist(): void {
		try {
			const db = DatabaseManager.instance().get("agent");
			const now = Date.now();
			db.prepare(`
				INSERT OR REPLACE INTO nidra_state
					(id, current_state, last_state_change, last_heartbeat,
					 last_consolidation_start, last_consolidation_end,
					 consolidation_phase, consolidation_progress, updated_at)
				VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				this.state,
				this.lastStateChange,
				this.lastHeartbeat,
				this.lastConsolidationStart ?? null,
				this.lastConsolidationEnd ?? null,
				this.consolidationPhase ?? null,
				this.consolidationProgress,
				now,
			);
		} catch (err) {
			log.warn("Failed to persist nidra state", { error: String(err) });
		}
	}

	/**
	 * Restore state from the nidra_state singleton row in SQLite.
	 * Called automatically at start(). If the row doesn't exist or the
	 * database is unavailable, the daemon starts fresh in LISTENING.
	 */
	restore(): void {
		try {
			const db = DatabaseManager.instance().get("agent");
			const row = db.prepare(
				"SELECT current_state, last_state_change, last_heartbeat, " +
				"last_consolidation_start, last_consolidation_end, " +
				"consolidation_phase, consolidation_progress " +
				"FROM nidra_state WHERE id = 1"
			).get() as {
				current_state: NidraState;
				last_state_change: number;
				last_heartbeat: number;
				last_consolidation_start: number | null;
				last_consolidation_end: number | null;
				consolidation_phase: string | null;
				consolidation_progress: number;
			} | undefined;

			if (row) {
				this.state = row.current_state;
				this.lastStateChange = row.last_state_change;
				this.lastHeartbeat = row.last_heartbeat;
				this.lastConsolidationStart = row.last_consolidation_start ?? undefined;
				this.lastConsolidationEnd = row.last_consolidation_end ?? undefined;
				this.consolidationPhase = row.consolidation_phase as SvapnaPhase | undefined;
				this.consolidationProgress = row.consolidation_progress;
				log.debug(`Restored nidra state: ${this.state}`);
			}
		} catch (err) {
			log.warn("Failed to restore nidra state, starting fresh", { error: String(err) });
			this.state = "LISTENING";
			this.lastStateChange = Date.now();
			this.lastHeartbeat = Date.now();
		}
	}

	/**
	 * Dispose — stop the daemon and release all resources.
	 * After disposal the daemon cannot be restarted.
	 */
	dispose(): void {
		if (this.disposed) return;

		this.running = false;
		this.clearAllTimers();

		if (this.dreamAbort) {
			this.dreamAbort.abort();
			this.dreamAbort = null;
		}

		this.dreamHandler = null;
		this.deepSleepHandler = null;
		this.disposed = true;

		log.debug("Nidra daemon disposed");
	}

	// ─── State Machine ───────────────────────────────────────────────────

	/**
	 * Execute a state transition. Validates the transition, updates internal
	 * state, persists to SQLite, emits events, and invokes phase handlers.
	 *
	 * @param target - The destination state.
	 * @param interrupt - Whether this is an interrupt (bypasses normal transition validation).
	 */
	private transitionTo(target: NidraState, interrupt = false): void {
		if (!this.running || this.disposed) return;

		// Validate transition unless this is an interrupt to LISTENING
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

		// Clear consolidation tracking when leaving DREAMING
		if (prev === "DREAMING" && target !== "DREAMING") {
			this.consolidationPhase = undefined;
			this.consolidationProgress = 0;
		}

		this.persist();
		this.emit("nidra:state_change", { prev, next: target, timestamp: now });

		log.info(`State transition: ${prev} -> ${target}`);

		// Reschedule timers for the new state
		this.clearAllTimers();
		this.scheduleHeartbeat();
		this.schedulePhaseTransition();

		// Invoke async handlers (fire-and-forget with error capture)
		if (target === "DREAMING") {
			this.runDreamPhase();
		} else if (target === "DEEP_SLEEP") {
			this.runDeepSleepPhase();
		}
	}

	// ─── Phase Handlers ──────────────────────────────────────────────────

	/**
	 * Execute the dream (Svapna consolidation) phase.
	 * The handler receives a progress reporter for phase/percentage updates.
	 * Completion triggers the DREAMING -> DEEP_SLEEP transition.
	 */
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
					timestamp: end,
					durationMs: end - (this.lastConsolidationStart ?? end),
				});
				log.info("Dream consolidation complete");
			})
			.catch((err: unknown) => {
				if (signal.aborted) return;
				log.error("Dream handler failed", { error: String(err) });
			})
			.finally(() => {
				this.dreamAbort = null;
			});
	}

	/**
	 * Execute the deep sleep (maintenance) phase.
	 * Invokes the registered handler for VACUUM, GC, checkpointing, etc.
	 */
	private runDeepSleepPhase(): void {
		if (!this.deepSleepHandler) return;

		this.deepSleepHandler()
			.then(() => {
				if (!this.running) return;
				log.info("Deep sleep maintenance complete");
			})
			.catch((err: unknown) => {
				log.error("Deep sleep handler failed", { error: String(err) });
			});
	}

	// ─── Drift-Correcting Heartbeat ──────────────────────────────────────

	/**
	 * Start the heartbeat loop using a self-correcting setTimeout chain.
	 * Each tick compensates for scheduling drift by subtracting the
	 * overshoot from the next interval.
	 */
	private scheduleHeartbeat(): void {
		const interval = this.config.heartbeatMs[this.state];
		this.expectedHeartbeatTime = Date.now() + interval;

		const tick = (): void => {
			if (!this.running || this.disposed) return;

			const now = Date.now();
			this.lastHeartbeat = now;

			this.emit("nidra:heartbeat", {
				state: this.state,
				timestamp: now,
				uptime: now - this.startedAt,
			});

			// Persist heartbeat timestamp
			this.persistHeartbeat(now);

			// Schedule next tick with drift correction
			const drift = now - this.expectedHeartbeatTime;
			const nextInterval = this.config.heartbeatMs[this.state];
			const corrected = Math.max(0, nextInterval - drift);
			this.expectedHeartbeatTime = now + corrected;

			this.heartbeatTimer = setTimeout(tick, corrected);
			this.unrefTimer(this.heartbeatTimer);
		};

		this.heartbeatTimer = setTimeout(tick, interval);
		this.unrefTimer(this.heartbeatTimer);
	}

	/**
	 * Lightweight heartbeat persistence — only updates the timestamp column
	 * to avoid full row rewrites on every beat.
	 */
	private persistHeartbeat(now: number): void {
		try {
			const db = DatabaseManager.instance().get("agent");
			db.prepare(
				"UPDATE nidra_state SET last_heartbeat = ?, updated_at = ? WHERE id = 1"
			).run(now, now);
		} catch {
			// Non-critical — swallow to avoid crashing the heartbeat loop
		}
	}

	// ─── Phase Duration Scheduling ───────────────────────────────────────

	/**
	 * Schedule the timer that drives the current state toward its natural
	 * transition. Each state has a duration after which it advances:
	 *   LISTENING  → idle timeout → DREAMING
	 *   DREAMING   → dream duration → DEEP_SLEEP
	 *   DEEP_SLEEP → maintenance duration → LISTENING
	 */
	private schedulePhaseTransition(): void {
		switch (this.state) {
			case "LISTENING":
				this.resetIdleTimer();
				break;

			case "DREAMING":
				this.phaseDurationTimer = setTimeout(() => {
					if (!this.running || this.disposed) return;
					this.transitionTo("DEEP_SLEEP");
				}, this.config.dreamDurationMs);
				this.unrefTimer(this.phaseDurationTimer);
				break;

			case "DEEP_SLEEP":
				this.phaseDurationTimer = setTimeout(() => {
					if (!this.running || this.disposed) return;
					this.transitionTo("LISTENING");
				}, this.config.deepSleepDurationMs);
				this.unrefTimer(this.phaseDurationTimer);
				break;
		}
	}

	/**
	 * Reset the idle timer. Called on touch() and when entering LISTENING.
	 * After idleTimeoutMs without activity, transitions to DREAMING.
	 */
	private resetIdleTimer(): void {
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		if (this.state !== "LISTENING" || !this.running) return;

		this.idleTimer = setTimeout(() => {
			if (!this.running || this.disposed) return;
			if (this.state !== "LISTENING") return;
			this.transitionTo("DREAMING");
		}, this.config.idleTimeoutMs);
		this.unrefTimer(this.idleTimer);
	}

	// ─── Timer Utilities ─────────────────────────────────────────────────

	/** Clear all active timers. */
	private clearAllTimers(): void {
		if (this.heartbeatTimer !== null) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		if (this.phaseDurationTimer !== null) {
			clearTimeout(this.phaseDurationTimer);
			this.phaseDurationTimer = null;
		}
	}

	/**
	 * Unref a timer so it doesn't keep the Node.js process alive.
	 * Guards against non-Node environments where unref() may not exist.
	 */
	private unrefTimer(timer: ReturnType<typeof setTimeout>): void {
		if (typeof timer === "object" && timer !== null && "unref" in timer) {
			(timer as NodeJS.Timeout).unref();
		}
	}

	// ─── Event Emission ──────────────────────────────────────────────────

	/** Emit an event on the EventBus if one was provided. */
	private emit(event: string, data: unknown): void {
		if (!this.events) return;
		try {
			this.events.emit(event, data);
		} catch {
			// Event handler failures must never crash the daemon
		}
	}

	// ─── Guards ──────────────────────────────────────────────────────────

	private assertNotDisposed(): void {
		if (this.disposed) {
			throw new Error("NidraDaemon has been disposed.");
		}
	}
}
