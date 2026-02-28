/**
 * @chitragupta/daemon — Resilience primitives.
 *
 * Health state machine, circuit breaker, heartbeat monitor.
 * Used by DaemonClient for self-healing lifecycle:
 *
 *   HEALTHY → DEGRADED → HEALING → HEALTHY (recovered)
 *                      ↘ DEAD (fallback to direct access)
 *
 * @module
 */

import { EventEmitter } from "node:events";

/** Daemon health states — ordered by severity. */
export enum HealthState {
	/** All systems nominal. */
	HEALTHY = "HEALTHY",
	/** Errors accumulating, still serving. */
	DEGRADED = "DEGRADED",
	/** Actively attempting recovery (restart + reconnect). */
	HEALING = "HEALING",
	/** Recovery failed — daemon unreachable. */
	DEAD = "DEAD",
}

/** Events emitted by the health monitor. */
export interface HealthEvents {
	stateChange: [from: HealthState, to: HealthState, reason: string];
	healed: [attempts: number];
	degraded: [consecutiveFailures: number];
	dead: [reason: string];
}

/** Circuit breaker configuration. */
export interface CircuitBreakerConfig {
	/** Consecutive failures before tripping to DEGRADED (default: 3). */
	degradeThreshold?: number;
	/** Consecutive failures before entering HEALING (default: 5). */
	healThreshold?: number;
	/** Max restart attempts before declaring DEAD (default: 3). */
	maxRestartAttempts?: number;
	/** Cooldown between restart attempts in ms (default: 2000). */
	restartCooldownMs?: number;
	/** Heartbeat interval in ms. 0 disables (default: 30_000). */
	heartbeatIntervalMs?: number;
}

const DEFAULTS: Required<CircuitBreakerConfig> = {
	degradeThreshold: 3,
	healThreshold: 5,
	maxRestartAttempts: 3,
	restartCooldownMs: 2000,
	heartbeatIntervalMs: 30_000,
};

/**
 * Health monitor with circuit breaker for daemon connections.
 *
 * Tracks consecutive failures and transitions through health states.
 * The client wires `recordSuccess()` / `recordFailure()` on every call.
 * When state reaches HEALING, the client triggers daemon restart.
 */
export class HealthMonitor extends EventEmitter<HealthEvents> {
	private state: HealthState = HealthState.HEALTHY;
	private consecutiveFailures = 0;
	private restartAttempts = 0;
	private lastFailureTime = 0;
	private totalFailures = 0;
	private totalSuccesses = 0;
	private readonly config: Required<CircuitBreakerConfig>;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private heartbeatFn: (() => Promise<boolean>) | null = null;

	constructor(config: CircuitBreakerConfig = {}) {
		super();
		this.config = { ...DEFAULTS, ...config };
	}

	/** Current health state. */
	getState(): HealthState {
		return this.state;
	}

	/** Full health snapshot for diagnostics. */
	getSnapshot(): {
		state: HealthState;
		consecutiveFailures: number;
		restartAttempts: number;
		totalFailures: number;
		totalSuccesses: number;
		lastFailureTime: number;
	} {
		return {
			state: this.state,
			consecutiveFailures: this.consecutiveFailures,
			restartAttempts: this.restartAttempts,
			totalFailures: this.totalFailures,
			totalSuccesses: this.totalSuccesses,
			lastFailureTime: this.lastFailureTime,
		};
	}

	/** Record a successful request — resets failure counters. */
	recordSuccess(): void {
		this.totalSuccesses++;
		if (this.consecutiveFailures > 0 || this.state !== HealthState.HEALTHY) {
			const prevState = this.state;
			this.consecutiveFailures = 0;
			this.restartAttempts = 0;
			this.transition(HealthState.HEALTHY, "request succeeded");
			if (prevState === HealthState.HEALING || prevState === HealthState.DEGRADED) {
				this.emit("healed", this.restartAttempts);
			}
		}
	}

	/**
	 * Record a failed request — may trigger state transitions.
	 * Returns true if the caller should attempt recovery (HEALING state).
	 */
	recordFailure(reason: string): boolean {
		this.consecutiveFailures++;
		this.totalFailures++;
		this.lastFailureTime = Date.now();

		if (this.state === HealthState.DEAD) return false;

		if (this.consecutiveFailures >= this.config.healThreshold) {
			this.transition(HealthState.HEALING, reason);
			return true;
		}

		if (this.consecutiveFailures >= this.config.degradeThreshold) {
			this.transition(HealthState.DEGRADED, reason);
			this.emit("degraded", this.consecutiveFailures);
		}

		return false;
	}

	/**
	 * Record a restart attempt result.
	 * Returns false if max attempts exhausted (enters DEAD state).
	 */
	recordRestartAttempt(success: boolean): boolean {
		if (success) {
			this.restartAttempts = 0;
			this.consecutiveFailures = 0;
			this.transition(HealthState.HEALTHY, "daemon restarted successfully");
			this.emit("healed", this.restartAttempts);
			return true;
		}

		this.restartAttempts++;
		if (this.restartAttempts >= this.config.maxRestartAttempts) {
			this.transition(HealthState.DEAD, `${this.restartAttempts} restart attempts failed`);
			this.emit("dead", `exhausted ${this.config.maxRestartAttempts} restart attempts`);
			return false;
		}

		return true;
	}

	/** Whether the circuit is open (should not send requests). */
	isCircuitOpen(): boolean {
		return this.state === HealthState.DEAD;
	}

	/** Reset to HEALTHY — used after manual intervention. */
	reset(): void {
		this.consecutiveFailures = 0;
		this.restartAttempts = 0;
		this.transition(HealthState.HEALTHY, "manual reset");
	}

	/** Get restart cooldown for current attempt (exponential backoff). */
	getRestartCooldown(): number {
		return this.config.restartCooldownMs * (2 ** this.restartAttempts);
	}

	/**
	 * Start heartbeat monitoring.
	 * @param pingFn — async function that returns true if daemon is alive.
	 */
	startHeartbeat(pingFn: () => Promise<boolean>): void {
		if (this.config.heartbeatIntervalMs <= 0) return;
		this.stopHeartbeat();
		this.heartbeatFn = pingFn;
		this.heartbeatTimer = setInterval(() => {
			this.runHeartbeat().catch(() => {});
		}, this.config.heartbeatIntervalMs);
		// Don't prevent process exit
		if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
	}

	/** Stop heartbeat monitoring. */
	stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		this.heartbeatFn = null;
	}

	/** Dispose all timers and listeners. */
	dispose(): void {
		this.stopHeartbeat();
		this.removeAllListeners();
	}

	/** Single heartbeat check. */
	private async runHeartbeat(): Promise<void> {
		if (!this.heartbeatFn || this.state === HealthState.HEALING) return;
		const alive = await this.heartbeatFn();
		if (alive) {
			if (this.state !== HealthState.HEALTHY) this.recordSuccess();
		} else {
			this.recordFailure("heartbeat failed");
		}
	}

	/** Transition to a new state if different. */
	private transition(to: HealthState, reason: string): void {
		if (this.state === to) return;
		const from = this.state;
		this.state = to;
		this.emit("stateChange", from, to, reason);
	}
}
