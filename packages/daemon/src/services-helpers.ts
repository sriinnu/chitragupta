/**
 * @chitragupta/daemon — Shared helpers for RPC service handlers.
 *
 * Parameter normalization (camelCase/snake_case aliasing), limit parsing,
 * and daemon-level constants used across service registration modules.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

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

/**
 * Normalize a project path into a stable key.
 *
 * Best-effort canonicalization:
 * - trim + resolve relative segments
 * - resolve symlinks if path exists
 * - normalize separators and strip trailing slash
 * - normalize Windows drive-letter case
 */
export function normalizeProjectPath(project: string): string {
	const trimmed = project.trim();
	if (!trimmed) return "";

	let normalized = path.resolve(trimmed);
	try {
		normalized = fs.realpathSync.native(normalized);
	} catch {
		// Keep resolved path when realpath fails (e.g. moved/non-existent path).
	}

	normalized = path.normalize(normalized);
	if (normalized.length > 1) normalized = normalized.replace(/[\\/]+$/, "");
	if (/^[A-Z]:/.test(normalized)) normalized = normalized[0].toLowerCase() + normalized.slice(1);
	return normalized;
}

function suffix(project: string, segments = 2): string {
	const parts = normalizeProjectPath(project).split(/[\\/]+/).filter(Boolean);
	return parts.slice(-segments).join("/").toLowerCase();
}

/**
 * Resolve a requested project path against known stored project keys.
 *
 * Resolution order:
 * 1) exact normalized match
 * 2) unique basename match (repo moved, same folder name)
 * 3) unique 2-segment suffix match
 * 4) fall back to normalized requested path
 */
export function resolveProjectKey(
	requestedProject: string,
	knownProjects: readonly string[],
): string {
	const requested = normalizeProjectPath(requestedProject);
	if (!requested) return "";
	if (knownProjects.length === 0) return requested;

	const normalizedToStored = new Map<string, string>();
	for (const candidate of knownProjects) {
		const normalized = normalizeProjectPath(candidate);
		if (normalized && !normalizedToStored.has(normalized)) {
			normalizedToStored.set(normalized, candidate);
		}
	}

	const exact = normalizedToStored.get(requested);
	if (exact) return exact;

	const requestedBase = path.basename(requested).toLowerCase();
	const baseMatches = [...normalizedToStored.entries()].filter(
		([normalized]) => path.basename(normalized).toLowerCase() === requestedBase,
	);
	if (baseMatches.length === 1) return baseMatches[0][1];

	if (baseMatches.length > 1) {
		const wantedSuffix = suffix(requested, 2);
		const suffixMatches = baseMatches.filter(([normalized]) => suffix(normalized, 2) === wantedSuffix);
		if (suffixMatches.length === 1) return suffixMatches[0][1];
	}

	return requested;
}
