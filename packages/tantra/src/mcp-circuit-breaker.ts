/**
 * @chitragupta/tantra — Circuit Breaker for MCP servers.
 *
 * Per-server circuit breaker with time-windowed failure tracking
 * and three-state transitions (closed / open / half-open).
 * Extracted from mcp-autonomous.ts to keep files under 450 LOC.
 */

import type { CircuitBreakerState } from "./mcp-autonomous-types.js";

// ─── Circuit Breaker ────────────────────────────────────────────────────────

/**
 * Per-server circuit breaker implementation with time-windowed failure
 * tracking and three-state transitions.
 *
 * State transitions:
 * ```
 * Closed -> Open:     when failureCount > threshold within window
 * Open -> Half-Open:  after cooldown period
 * Half-Open -> Closed: on successful probe
 * Half-Open -> Open:   on failed probe
 * ```
 */
export class CircuitBreaker {
	private readonly states = new Map<string, CircuitBreakerState>();
	private readonly failureThreshold: number;
	private readonly windowMs: number;
	private readonly cooldownMs: number;

	constructor(
		failureThreshold: number,
		windowMs: number,
		cooldownMs: number,
	) {
		this.failureThreshold = failureThreshold;
		this.windowMs = windowMs;
		this.cooldownMs = cooldownMs;
	}

	/**
	 * Get the current state of a server's circuit breaker.
	 * Creates a default "closed" state if none exists.
	 * Handles time-based transitions (open -> half-open).
	 */
	getState(serverId: string): CircuitBreakerState {
		let state = this.states.get(serverId);
		if (!state) {
			state = {
				serverId,
				state: "closed",
				failureCount: 0,
				failureTimestamps: [],
				openedAt: null,
				halfOpenAt: null,
				probeSuccesses: 0,
			};
			this.states.set(serverId, state);
		}

		// Time-based transition: open -> half-open
		if (
			state.state === "open" &&
			state.halfOpenAt !== null &&
			Date.now() >= state.halfOpenAt
		) {
			state.state = "half-open";
			state.probeSuccesses = 0;
		}

		return state;
	}

	/**
	 * Record a failure for a server. May trip the circuit open.
	 */
	recordFailure(serverId: string): void {
		const state = this.getState(serverId);
		const now = Date.now();

		if (state.state === "half-open") {
			// Failed probe — go back to open
			state.state = "open";
			state.openedAt = now;
			state.halfOpenAt = now + this.cooldownMs;
			return;
		}

		if (state.state === "open") return; // Already open

		// Closed state: add failure and prune old ones
		state.failureTimestamps.push(now);
		state.failureTimestamps = state.failureTimestamps.filter(
			(t) => now - t <= this.windowMs,
		);
		state.failureCount = state.failureTimestamps.length;

		if (state.failureCount >= this.failureThreshold) {
			state.state = "open";
			state.openedAt = now;
			state.halfOpenAt = now + this.cooldownMs;
		}
	}

	/**
	 * Record a success for a server. May close the circuit from half-open.
	 */
	recordSuccess(serverId: string): void {
		const state = this.getState(serverId);

		if (state.state === "half-open") {
			// Successful probe — close the circuit
			state.state = "closed";
			state.failureCount = 0;
			state.failureTimestamps = [];
			state.openedAt = null;
			state.halfOpenAt = null;
			state.probeSuccesses = 0;
			return;
		}

		if (state.state === "closed") {
			// Prune old failures in closed state
			const now = Date.now();
			state.failureTimestamps = state.failureTimestamps.filter(
				(t) => now - t <= this.windowMs,
			);
			state.failureCount = state.failureTimestamps.length;
		}
	}

	/**
	 * Check if a call is allowed through the circuit breaker.
	 * - Closed: allowed
	 * - Open: blocked
	 * - Half-Open: allowed (one probe)
	 */
	allowCall(serverId: string): boolean {
		const state = this.getState(serverId);
		return state.state !== "open";
	}

	/** Remove state for a server. */
	remove(serverId: string): void {
		this.states.delete(serverId);
	}

	/** Get all circuit breaker states. */
	getAllStates(): CircuitBreakerState[] {
		// Refresh time-based transitions
		for (const serverId of this.states.keys()) {
			this.getState(serverId);
		}
		return [...this.states.values()];
	}
}
