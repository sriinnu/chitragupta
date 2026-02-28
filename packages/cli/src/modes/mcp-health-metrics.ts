/**
 * MCP Health Metrics — Derives real TrigunaObservation from session data.
 *
 * Reads recent sessions from smriti and computes observation signals:
 *   - errorRate: fraction of tool calls with isError=true
 *   - tokenVelocity: normalized turns per minute (capped at 1.0)
 *   - loopCount: normalized total tool calls (capped at 1.0)
 *   - latency: inverse of session recency (stale = high latency)
 *   - successRate: 1 - errorRate
 *   - userSatisfaction: heuristic from session length and error-free turns
 *
 * @module
 */

/** Observation vector consumed by Triguna.update(). */
export interface TrigunaObservationData {
	errorRate: number;
	tokenVelocity: number;
	loopCount: number;
	latency: number;
	successRate: number;
	userSatisfaction: number;
}

/** Maximum number of recent sessions to sample for metrics. */
const MAX_SESSIONS = 5;

/** Expected tool calls per session (baseline for normalization). */
const EXPECTED_TOOL_CALLS = 20;

/** Expected turns per minute (baseline for velocity normalization). */
const EXPECTED_VELOCITY = 2;

/**
 * Compute a TrigunaObservation from recent session data.
 *
 * Returns null if no sessions are available (first-run or DB unavailable).
 * All values are clamped to [0, 1].
 */
export async function computeSessionMetrics(): Promise<TrigunaObservationData | null> {
	try {
		const bridge = await import("./daemon-bridge.js");

		const metas = await bridge.listSessions();
		if (metas.length === 0) return null;

		const recent = metas.slice(0, MAX_SESSIONS);

		let totalToolCalls = 0;
		let errorToolCalls = 0;
		let totalTurns = 0;
		let errorFreeTurns = 0;
		let earliestTs = Infinity;
		let latestTs = 0;

		for (const meta of recent) {
			try {
				const session = await bridge.showSession(String(meta.id), String(meta.project)) as {
					meta: Record<string, unknown>;
					turns: Array<Record<string, unknown>>;
				};
				for (const turn of session.turns) {
					totalTurns++;
					const calls = (turn.toolCalls ?? []) as Array<Record<string, unknown>>;
					let turnHasError = false;
					for (const tc of calls) {
						totalToolCalls++;
						if (tc.isError) {
							errorToolCalls++;
							turnHasError = true;
						}
					}
					if (!turnHasError) errorFreeTurns++;
				}
				const createdMs = new Date(String(meta.created)).getTime();
				const updatedMs = new Date(String(meta.updated)).getTime();
				if (createdMs < earliestTs) earliestTs = createdMs;
				if (updatedMs > latestTs) latestTs = updatedMs;
			} catch {
				// Skip corrupted/unreadable sessions
			}
		}

		if (totalTurns === 0) return null;

		// errorRate: fraction of failed tool calls
		const errorRate = totalToolCalls > 0
			? clamp(errorToolCalls / totalToolCalls)
			: 0;

		// successRate: inverse of errorRate
		const successRate = 1 - errorRate;

		// tokenVelocity: normalized turns per minute across session span
		const spanMs = Math.max(1, latestTs - earliestTs);
		const spanMinutes = spanMs / 60_000;
		const turnsPerMinute = totalTurns / spanMinutes;
		const tokenVelocity = clamp(turnsPerMinute / EXPECTED_VELOCITY);

		// loopCount: normalized total tool calls vs baseline
		const loopCount = clamp(totalToolCalls / (EXPECTED_TOOL_CALLS * recent.length));

		// latency: how stale is the most recent session (high = degraded)
		const staleness = Date.now() - latestTs;
		const STALE_THRESHOLD = 30 * 60_000; // 30 minutes = fully stale
		const latency = clamp(staleness / STALE_THRESHOLD);

		// userSatisfaction: heuristic from error-free turn ratio and session count
		const errorFreeRatio = errorFreeTurns / totalTurns;
		const sessionActivity = clamp(recent.length / MAX_SESSIONS);
		const userSatisfaction = clamp(errorFreeRatio * 0.7 + sessionActivity * 0.3);

		return {
			errorRate,
			tokenVelocity,
			loopCount,
			latency,
			successRate,
			userSatisfaction,
		};
	} catch {
		// smriti unavailable (e.g. better-sqlite3 not loaded)
		return null;
	}
}

/** Clamp a value to [0, 1]. */
function clamp(v: number): number {
	return Math.max(0, Math.min(1, v));
}
