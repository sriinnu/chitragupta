/** Nidra Daemon — background LISTENING -> DREAMING -> DEEP_SLEEP cycle manager. */

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
import { applyRestoredNidraState, buildNidraRuntimeStateBag } from "./nidra-daemon-state.js";

export {
	persistNidraState, restoreNidraState, persistHeartbeat,
	buildNidraSnapshot, unrefTimer, VALID_TRANSITIONS,
	type DreamHandler, type DeepSleepHandler, type DreamProgressFn,
	type DeepSleepConsolidationHandler, type NidraDaemonState,
} from "./nidra-daemon-persistence.js";

const log = createLogger("nidra");

// ─── NidraDaemon ─────────────────────────────────────────────────────────────

/** Background sleep-cycle daemon with drift-correcting heartbeat and persistent consolidation state. */
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

	private consecutiveIdleDreamCycles: number = 0;
	private pendingSessionIds: string[] = [];
	private sessionsProcessedSinceDeepSleep: number = 0;
	private sessionNotificationsSinceDeepSleep: number = 0;
	private sessionSeenThisDream: boolean = false;
	private preservePendingSessionsOnListening: boolean = false;

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
	private dreamRunGeneration = 0;
	private deepSleepRunGeneration = 0;
	private deepSleepCompletionPending = false;

	constructor(config?: Partial<NidraConfig>, events?: EventBus) {
		this.config = { ...DEFAULT_NIDRA_CONFIG, ...config };
		this.events = events ?? null;
	}

	start(): void {
		this.assertNotDisposed();
		if (this.running) return;
		this.running = true;
		this.startedAt = Date.now();
		this.restore();
		this.scheduleHeartbeat();
		this.schedulePhaseTransition();
		if (this.state === "DREAMING") this.runDreamPhase();
		else if (this.state === "DEEP_SLEEP") this.runDeepSleepPhase();
		log.info(`Nidra daemon started in state=${this.state}`);
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		this.clearAllTimers();
		if (this.dreamAbort) { this.dreamAbort.abort(); this.dreamAbort = null; }
		this.persist();
		log.info("Nidra daemon stopped");
	}

	wake(): void {
		this.assertNotDisposed();
		if (!this.running) return;
		if (this.state === "LISTENING") { this.resetIdleTimer(); return; }
		if (this.state === "DEEP_SLEEP") {
			this.preservePendingSessionsOnListening ||= this.pendingSessionIds.length > 0;
		}
		if (this.state === "DREAMING" && this.dreamAbort) { this.dreamAbort.abort(); this.dreamAbort = null; }
		log.info(`Nidra wake interrupt: ${this.state} -> LISTENING`);
		this.transitionTo("LISTENING", true);
	}

	touch(): void {
		this.assertNotDisposed();
		if (!this.running) return;
		if (this.state === "LISTENING") this.resetIdleTimer();
		else this.wake();
	}

	notifySession(sessionId: string): void {
		this.assertNotDisposed();
		if (!this.running) return;

		if (this.state === "DEEP_SLEEP") {
			log.info(`Nidra: new session during DEEP_SLEEP, waking → LISTENING (session=${sessionId})`);
			this.preservePendingSessionsOnListening = true;
			this.wake();
		}

		const isNewSession = !this.pendingSessionIds.includes(sessionId);
		if (isNewSession) {
			this.pendingSessionIds.push(sessionId);
			this.sessionsProcessedSinceDeepSleep += 1;
		}
		this.sessionNotificationsSinceDeepSleep += 1;
		this.sessionSeenThisDream = true;
		this.persist();

		log.debug(
			`Nidra: session recorded (id=${sessionId}, unique=${this.sessionsProcessedSinceDeepSleep}, notifications=${this.sessionNotificationsSinceDeepSleep}, new=${isNewSession})`,
		);

		if (this.sessionsProcessedSinceDeepSleep >= this.config.sessionCountThreshold) {
			log.info(
				`Nidra: session threshold reached (${this.sessionsProcessedSinceDeepSleep}` +
				` >= ${this.config.sessionCountThreshold}), forcing DEEP_SLEEP`
			);
			this.forceDeepSleep();
		}
	}

	snapshot(): NidraSnapshot { return buildNidraSnapshot(this.getStateBag()); }

	onDream(handler: DreamHandler): void { this.dreamHandler = handler; }

	onDeepSleep(handler: DeepSleepHandler): void { this.deepSleepHandler = handler; }

	onDeepSleepConsolidation(handler: DeepSleepConsolidationHandler): void {
		this.deepSleepConsolidationHandler = handler;
	}

	persist(): void { persistNidraState(this.getStateBag()); }

	restore(): void {
		const bag = this.getStateBag();
		restoreNidraState(bag);
		applyRestoredNidraState(this as unknown as import("./nidra-daemon-state.js").NidraRuntimeStateFields, bag);
	}

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
			if (this.dreamAbort) {
				this.dreamAbort.abort();
				this.dreamAbort = null;
			}
			this.dreamRunGeneration += 1;
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
		if (prev === "DEEP_SLEEP" && target !== "DEEP_SLEEP") {
			this.deepSleepRunGeneration += 1;
			this.deepSleepCompletionPending = false;
		}
		if (target === "LISTENING") {
			if (this.preservePendingSessionsOnListening) {
				const pendingUniqueSessionIds = [...new Set(this.pendingSessionIds)];
				this.pendingSessionIds = pendingUniqueSessionIds;
				this.sessionsProcessedSinceDeepSleep = pendingUniqueSessionIds.length;
			} else {
				this.sessionsProcessedSinceDeepSleep = 0;
				this.pendingSessionIds = [];
			}
			this.sessionNotificationsSinceDeepSleep = 0;
			this.sessionSeenThisDream = false;
			this.preservePendingSessionsOnListening = false;
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

	private runDreamPhase(): void {
		if (!this.dreamHandler) return;
		const runGeneration = ++this.dreamRunGeneration;
		const dreamAbort = new AbortController();
		this.dreamAbort = dreamAbort;
		const { signal } = dreamAbort;
		const now = Date.now();
		this.lastConsolidationStart = now;
		this.emit("nidra:consolidation_start", { timestamp: now });

		const progress: DreamProgressFn = (phase, pct) => {
			if (signal.aborted || this.state !== "DREAMING" || runGeneration !== this.dreamRunGeneration) return;
			this.consolidationPhase = phase;
			this.consolidationProgress = Math.max(0, Math.min(1, pct));
			this.persist();
		};

		this.dreamHandler(progress)
			.then(() => {
				if (
					signal.aborted ||
					!this.running ||
					this.state !== "DREAMING" ||
					runGeneration !== this.dreamRunGeneration
				) return;
				const end = Date.now();
				this.lastConsolidationEnd = end;
				this.emit("nidra:consolidation_end", {
					timestamp: end, durationMs: end - (this.lastConsolidationStart ?? end),
				});
				log.info("Dream consolidation complete");
			})
			.catch((err: unknown) => {
				if (signal.aborted || runGeneration !== this.dreamRunGeneration) return;
				log.error("Dream handler failed", { error: String(err) });
			})
			.finally(() => {
				if (this.dreamAbort === dreamAbort) {
					this.dreamAbort = null;
				}
			});
	}

	private runDeepSleepPhase(): void {
		const runGeneration = ++this.deepSleepRunGeneration;
		const sessionIds = [...this.pendingSessionIds];

		if (this.deepSleepConsolidationHandler) {
			this.deepSleepCompletionPending = true;
			log.info(
				`Nidra: DEEP_SLEEP bulk consolidation starting (sessions=${sessionIds.length})`
			);
			this.emit("nidra:deep_sleep_consolidation_start", {
				timestamp: Date.now(),
				sessionCount: sessionIds.length,
				sessionIds,
			});
			this.deepSleepConsolidationHandler(sessionIds)
				.then((processedSessionIds) => {
					if (!this.running || this.state !== "DEEP_SLEEP" || runGeneration !== this.deepSleepRunGeneration) {
						return;
					}
					const consumed = [
						...new Set(
							(processedSessionIds ?? sessionIds).filter((id): id is string =>
								typeof id === "string",
							),
						),
					];
					log.info("Nidra: DEEP_SLEEP bulk consolidation complete");
					this.emit("nidra:deep_sleep_consolidation_end", {
						timestamp: Date.now(),
						sessionCount: consumed.length,
					});
					// Sessions consumed — clear only what the handler confirmed.
					this.pendingSessionIds = this.pendingSessionIds.filter(
						(id) => !consumed.includes(id)
					);
					this.preservePendingSessionsOnListening = this.pendingSessionIds.length > 0;
					this.deepSleepCompletionPending = false;
					this.persist();
				})
				.catch((err: unknown) => {
					if (runGeneration !== this.deepSleepRunGeneration) return;
					this.deepSleepCompletionPending = false;
					log.error("Deep sleep consolidation handler failed", { error: String(err) });
				});
			return;
		}

		if (this.deepSleepHandler) {
			this.deepSleepHandler()
				.then(() => {
					if (this.running && this.state === "DEEP_SLEEP" && runGeneration === this.deepSleepRunGeneration) {
						log.info("Deep sleep maintenance complete");
					}
				})
				.catch((err: unknown) => {
					if (runGeneration !== this.deepSleepRunGeneration) return;
					log.error("Deep sleep handler failed", { error: String(err) });
				});
		}
	}

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

	private schedulePhaseTransition(): void {
		switch (this.state) {
			case "LISTENING": this.resetIdleTimer(); break;
			case "DREAMING":
				this.phaseDurationTimer = setTimeout(() => {
					if (!this.running || this.disposed) return;
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
				{
					const phaseStartedAt = this.lastStateChange;
					const attemptExitDeepSleep = (): void => {
						if (!this.running || this.disposed) return;
						if (this.state !== "DEEP_SLEEP" || this.lastStateChange !== phaseStartedAt) return;
						if (this.deepSleepCompletionPending) {
							this.phaseDurationTimer = setTimeout(attemptExitDeepSleep, 250);
							unrefTimer(this.phaseDurationTimer);
							return;
						}
						this.preservePendingSessionsOnListening =
							this.preservePendingSessionsOnListening || this.deepSleepCompletionPending;
						this.transitionTo("LISTENING");
					};
					this.phaseDurationTimer = setTimeout(attemptExitDeepSleep, this.config.deepSleepDurationMs);
				}
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

	private getStateBag(): NidraDaemonState {
		return buildNidraRuntimeStateBag(
			this as unknown as import("./nidra-daemon-state.js").NidraRuntimeStateFields,
		);
	}
}
