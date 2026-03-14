import { randomUUID } from "node:crypto";
import { getAgentDb } from "./session-db.js";
import type { SelectiveReembeddingRepairResult } from "./selective-reembedding.js";

const CURATED_EMBEDDING_EPOCH_STATE = "curated_embedding_epoch";
/** Shared SQLite lease key for global semantic epoch refresh work. */
export const SEMANTIC_EPOCH_REFRESH_LOCK = "semantic-epoch-refresh";
const SEMANTIC_EPOCH_REFRESH_LEASE_MS = 10 * 60 * 1000;

/**
 * Persisted daemon state for the global semantic epoch self-heal loop.
 *
 * I keep this internal so callers consume the operator-facing result types
 * instead of coupling themselves to the SQLite payload shape.
 */
export interface SemanticRuntimeStateRecord {
	currentEpoch: string | null;
	lastAttemptEpoch: string | null;
	lastAttemptAt: number | null;
	lastAttemptStatus: "success" | "partial" | null;
	previousEpoch: string | null;
	lastRepair: SelectiveReembeddingRepairResult;
	parseError?: string | null;
}

/**
 * Build an empty repair result for state bootstrap and degraded fallback paths.
 */
export function emptyRepairResult(): SelectiveReembeddingRepairResult {
	return {
		plan: {
			scanned: 0,
			candidateCount: 0,
			candidates: [],
		},
		reembedded: 0,
		remoteSynced: 0,
		qualityDeferred: 0,
	};
}

/**
 * Acquire the process-external SQLite lease used to serialize epoch refresh
 * passes across multiple daemon processes.
 */
export function acquireSemanticRuntimeLock(name = SEMANTIC_EPOCH_REFRESH_LOCK): string | null {
	const db = getAgentDb();
	const ownerToken = randomUUID();
	const now = Date.now();
	const expiresAt = now + SEMANTIC_EPOCH_REFRESH_LEASE_MS;
	const result = db.prepare(`
		INSERT INTO semantic_runtime_locks (name, owner_token, acquired_at, expires_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			owner_token = excluded.owner_token,
			acquired_at = excluded.acquired_at,
			expires_at = excluded.expires_at
		WHERE semantic_runtime_locks.expires_at <= ?
	`).run(name, ownerToken, now, expiresAt, now);
	return result.changes > 0 ? ownerToken : null;
}

/**
 * Release the SQLite lease only when the current owner token still matches.
 */
export function releaseSemanticRuntimeLock(
	name = SEMANTIC_EPOCH_REFRESH_LOCK,
	ownerToken: string | null,
): void {
	if (!ownerToken) return;
	const db = getAgentDb();
	db.prepare("DELETE FROM semantic_runtime_locks WHERE name = ? AND owner_token = ?").run(name, ownerToken);
}

/**
 * Load the persisted semantic epoch state and normalize its shape so callers do
 * not have to handle partially written JSON.
 */
export function readCurrentEpochState(): SemanticRuntimeStateRecord | null {
	const db = getAgentDb();
	const row = db.prepare(
		"SELECT value_json FROM semantic_runtime_state WHERE name = ?",
	).get(CURATED_EMBEDDING_EPOCH_STATE) as { value_json: string } | undefined;
	if (!row?.value_json) return null;
	try {
		const parsed = JSON.parse(row.value_json) as Partial<SemanticRuntimeStateRecord>;
		return {
			currentEpoch:
				typeof parsed.currentEpoch === "string" && parsed.currentEpoch.trim()
					? parsed.currentEpoch
					: null,
			lastAttemptEpoch:
				typeof parsed.lastAttemptEpoch === "string" && parsed.lastAttemptEpoch.trim()
					? parsed.lastAttemptEpoch
					: null,
			lastAttemptAt:
				typeof parsed.lastAttemptAt === "number" && Number.isFinite(parsed.lastAttemptAt)
					? parsed.lastAttemptAt
					: null,
			lastAttemptStatus:
				parsed.lastAttemptStatus === "success" || parsed.lastAttemptStatus === "partial"
					? parsed.lastAttemptStatus
					: null,
			previousEpoch:
				typeof parsed.previousEpoch === "string" && parsed.previousEpoch.trim()
					? parsed.previousEpoch
					: null,
			lastRepair:
				parsed.lastRepair && typeof parsed.lastRepair === "object"
					? parsed.lastRepair as SelectiveReembeddingRepairResult
					: emptyRepairResult(),
			parseError: null,
		};
		} catch (error) {
			return {
				currentEpoch: null,
				lastAttemptEpoch: null,
			lastAttemptAt: null,
			lastAttemptStatus: "partial",
			previousEpoch: null,
			lastRepair: emptyRepairResult(),
				// I degrade to a repairable partial state instead of throwing so daemon
				// startup can self-heal malformed persisted epoch metadata.
				parseError: error instanceof Error ? error.message : "invalid semantic runtime state",
			};
		}
}

/**
 * Store the latest semantic refresh attempt while preserving the healed epoch
 * separately from the current embedding epoch.
 */
export function writeCurrentEpochState(params: {
	healedEpoch: string | null;
	attemptEpoch: string;
	attemptStatus: "success" | "partial";
	previousEpoch: string | null;
	repair: SelectiveReembeddingRepairResult;
}): void {
	const db = getAgentDb();
	const value: SemanticRuntimeStateRecord = {
		currentEpoch: params.healedEpoch,
		lastAttemptEpoch: params.attemptEpoch,
		lastAttemptAt: Date.now(),
		lastAttemptStatus: params.attemptStatus,
		previousEpoch: params.previousEpoch,
		lastRepair: params.repair,
		parseError: null,
	};
	db.prepare(`
		INSERT INTO semantic_runtime_state (name, value_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			value_json = excluded.value_json,
			updated_at = excluded.updated_at
	`).run(
		CURATED_EMBEDDING_EPOCH_STATE,
		JSON.stringify(value),
		value.lastAttemptAt,
	);
}
