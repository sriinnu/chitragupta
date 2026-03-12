import { getEngineEmbeddingService } from "./embedding-runtime.js";
import { repairSelectiveReembedding, type SelectiveReembeddingRepairResult } from "./selective-reembedding.js";
import { getAgentDb } from "./session-db.js";

const CURATED_EMBEDDING_EPOCH_STATE = "curated_embedding_epoch";
const EPOCH_REFRESH_RETRY_BACKOFF_MS = 30 * 60 * 1000;
const GLOBAL_SEMANTIC_REFRESH_REASONS = [
	"missing_vector",
	"legacy_vector",
	"stale_hash",
	"stale_epoch",
	"stale_remote_epoch",
	"missing_remote",
	"stale_remote",
	"remote_error",
] as const;

interface SemanticRuntimeStateRecord {
	currentEpoch: string | null;
	lastAttemptEpoch: string | null;
	lastAttemptAt: number | null;
	lastAttemptStatus: "success" | "partial";
	previousEpoch: string | null;
	lastRepair: SelectiveReembeddingRepairResult;
}

export interface SemanticEpochRefreshResult {
	currentEpoch: string;
	previousEpoch: string | null;
	reason: "unchanged" | "bootstrap" | "epoch-changed" | "forced" | "retry-backoff";
	completed: boolean;
	refreshed: boolean;
	repair: SelectiveReembeddingRepairResult;
}

function emptyRepairResult(): SelectiveReembeddingRepairResult {
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

function readCurrentEpochState(): SemanticRuntimeStateRecord | null {
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
					: "success",
			previousEpoch:
				typeof parsed.previousEpoch === "string" && parsed.previousEpoch.trim()
					? parsed.previousEpoch
					: null,
			lastRepair:
				parsed.lastRepair && typeof parsed.lastRepair === "object"
					? parsed.lastRepair as SelectiveReembeddingRepairResult
					: emptyRepairResult(),
		};
	} catch {
		return null;
	}
}

function writeCurrentEpochState(params: {
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

function repairCompleted(repair: SelectiveReembeddingRepairResult): boolean {
	return (
		repair.plan.candidateCount === 0
		|| (
			repair.qualityDeferred === 0
			&& repair.reembedded === repair.plan.candidateCount
			&& repair.remoteSynced === repair.reembedded
		)
	);
}

/**
 * I treat embedding-epoch drift as a self-healing event for the semantic
 * mirror. When the active provider/model epoch changes, all curated semantic
 * artifacts are scanned and stale local/remote vectors are refreshed.
 */
export async function refreshGlobalSemanticEpochDrift(
	options: { force?: boolean } = {},
): Promise<SemanticEpochRefreshResult> {
	const currentEpoch = (await (await getEngineEmbeddingService()).getEmbeddingEpoch()).epoch;
	const state = readCurrentEpochState();
	const previousEpoch = state?.currentEpoch ?? null;
	const force = options.force === true;
	const shouldRefresh = force || previousEpoch === null || previousEpoch !== currentEpoch;

	if (!shouldRefresh) {
		return {
			currentEpoch,
			previousEpoch,
			reason: "unchanged",
			completed: true,
			refreshed: false,
			repair: emptyRepairResult(),
		};
	}

	if (
		!force
		&& previousEpoch !== currentEpoch
		&& state?.lastAttemptEpoch === currentEpoch
		&& state.lastAttemptStatus === "partial"
		&& typeof state.lastAttemptAt === "number"
		&& (Date.now() - state.lastAttemptAt) < EPOCH_REFRESH_RETRY_BACKOFF_MS
	) {
		return {
			currentEpoch,
			previousEpoch,
			reason: "retry-backoff",
			completed: false,
			refreshed: false,
			repair: state.lastRepair,
		};
	}

	const repair = await repairSelectiveReembedding({
		scanAll: true,
		reasons: [...GLOBAL_SEMANTIC_REFRESH_REASONS],
		resyncRemote: true,
		minMdlScore: 0,
		minSourceSessionCount: 0,
		minPriorityScore: 0,
	});
	const completed = repairCompleted(repair);
	writeCurrentEpochState({
		healedEpoch: completed ? currentEpoch : previousEpoch,
		attemptEpoch: currentEpoch,
		attemptStatus: completed ? "success" : "partial",
		previousEpoch,
		repair,
	});

	const result: SemanticEpochRefreshResult = {
		currentEpoch,
		previousEpoch,
		reason: force ? "forced" : previousEpoch === null ? "bootstrap" : "epoch-changed",
		completed,
		refreshed: true,
		repair,
	};
	return result;
}
