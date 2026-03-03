/**
 * @chitragupta/daemon — Shared helpers for RPC service handlers.
 *
 * Parameter normalization (camelCase/snake_case aliasing), limit parsing,
 * and daemon-level constants used across service registration modules.
 *
 * @module
 */

/** Default limit for list queries. */
export const DEFAULT_LIMIT = 10;

/** Maximum allowed limit. */
export const MAX_LIMIT = 200;

/** Daemon start time for uptime tracking. */
export const DAEMON_START_MS = Date.now();

/** snake_case → camelCase alias map for RPC parameter normalization. */
const ALIAS_MAP: Record<string, string> = {
	session_id: "sessionId",
	turn_number: "turnNumber",
	since_turn_number: "sinceTurnNumber",
	since_ms: "sinceMs",
	scope_type: "scopeType",
	scope_path: "scopePath",
	project_path: "projectPath",
	max_results: "maxResults",
	hub_url: "hubUrl",
};

/**
 * Normalize RPC params to accept both camelCase and snake_case.
 *
 * External consumers (Takumi, HTTP clients) may use snake_case;
 * internal code uses camelCase. This accepts both without ambiguity.
 * snake_case value is only copied if the camelCase key is absent.
 */
export function normalizeParams(params: Record<string, unknown>): Record<string, unknown> {
	const normalized = { ...params };
	for (const [snake, camel] of Object.entries(ALIAS_MAP)) {
		if (normalized[snake] !== undefined && normalized[camel] === undefined) {
			normalized[camel] = normalized[snake];
		}
	}
	return normalized;
}

/** Parse a non-negative integer from an RPC param. */
export function parseNonNegativeInt(value: unknown, field: string, fallback = 0): number {
	const parsed = value == null ? fallback : Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Invalid ${field}`);
	}
	return Math.trunc(parsed);
}

/** Parse a limit parameter with bounds checking. */
export function parseLimit(value: unknown, fallback = DEFAULT_LIMIT, max = MAX_LIMIT): number {
	const parsed = value == null ? fallback : Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error("Invalid limit");
	}
	return Math.min(max, Math.trunc(parsed));
}
