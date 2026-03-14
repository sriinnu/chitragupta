import { getEngineEmbeddingService } from "./embedding-runtime.js";
import {
	planSelectiveReembedding,
	repairSelectiveReembedding,
	type SelectiveReembeddingReason,
	type SelectiveReembeddingRepairResult,
} from "./selective-reembedding.js";
import { getAgentDb } from "./session-db.js";
import { resolveRemoteSemanticMirrorConfig } from "./remote-semantic-sync-client.js";
import {
	planSemanticQualityDebt,
	repairSemanticQualityDebt,
} from "./semantic-epoch-refresh-quality.js";
import {
	acquireSemanticRuntimeLock,
	emptyRepairResult,
	readCurrentEpochState,
	releaseSemanticRuntimeLock,
	SEMANTIC_EPOCH_REFRESH_LOCK,
	type SemanticRuntimeStateRecord,
	writeCurrentEpochState,
} from "./semantic-epoch-refresh-state.js";
import { readActiveResearchRefinementBudget } from "./research-refinement-budget.js";

const EPOCH_REFRESH_RETRY_BACKOFF_MS = 30 * 60 * 1000;
const GLOBAL_SEMANTIC_FRESHNESS_REPAIR_REASONS = [
	"missing_vector",
	"legacy_vector",
	"stale_hash",
	"stale_epoch",
	"stale_remote_epoch",
	"missing_remote",
	"stale_remote",
	"remote_error",
] as const;

const GLOBAL_EPOCH_COMPLETION_REASONS: SelectiveReembeddingReason[] = [
	"missing_vector",
	"legacy_vector",
	"stale_hash",
	"stale_epoch",
	"stale_remote_epoch",
	"missing_remote",
	"stale_remote",
	"remote_error",
];

const LOCAL_SEMANTIC_FRESHNESS_REPAIR_REASONS = GLOBAL_SEMANTIC_FRESHNESS_REPAIR_REASONS.filter((reason) =>
	!reason.startsWith("missing_remote")
	&& !reason.startsWith("stale_remote")
	&& reason !== "remote_error",
) as SelectiveReembeddingReason[];

const LOCAL_EPOCH_COMPLETION_REASONS = GLOBAL_EPOCH_COMPLETION_REASONS.filter((reason) =>
	!reason.startsWith("missing_remote")
	&& !reason.startsWith("stale_remote")
	&& reason !== "remote_error",
);

let inFlightSemanticEpochRefresh: Promise<SemanticEpochRefreshResult> | null = null;

/**
 * Result of one daemon-owned semantic epoch refresh or repair pass.
 *
 * I use this as the durable operator-facing contract for self-heal status,
 * not just as an internal helper shape, so callers can tell whether the pass
 * fully healed freshness drift or only reduced the remaining debt frontier.
 */
export interface SemanticEpochRefreshResult {
	currentEpoch: string;
	previousEpoch: string | null;
	reason: "unchanged" | "bootstrap" | "epoch-changed" | "forced" | "retry-backoff" | "quality-debt";
	/** True only when the refresh pass fully cleared the condition it was handling. */
	completed: boolean;
	/** True when local/remote freshness drift is fully healed for the active epoch. */
	freshnessCompleted: boolean;
	refreshed: boolean;
	/** Remaining low-quality curated artifacts after the latest bounded repair pass. */
	qualityDebtCount: number;
	repair: SelectiveReembeddingRepairResult;
}

/**
 * Operator-facing snapshot of semantic self-heal state.
 *
 * `persistedEpoch` is the last epoch the daemon considers healed. It can lag
 * behind `currentEpoch` when refresh is partial or in retry backoff.
 */
export interface SemanticEpochRefreshStatus {
	currentEpoch: string;
	persistedEpoch: string | null;
	previousEpoch: string | null;
	lastAttemptEpoch: string | null;
	lastAttemptAt: number | null;
	lastAttemptStatus: "success" | "partial" | null;
	inFlight: boolean;
	qualityDebtCount: number;
	lastRepair: SelectiveReembeddingRepairResult;
	persistedStateValid: boolean;
	degradedReason: string | null;
}

/**
 * Clear the process-local refresh lock for tests.
 *
 * The persisted runtime state remains in SQLite; this only resets the in-flight
 * guard used to coalesce concurrent refresh requests in one process.
 */
export function _resetSemanticEpochRefreshStateForTests(): void {
	inFlightSemanticEpochRefresh = null;
}

/**
 * Report whether a process-local semantic epoch refresh is already running.
 *
 * Read paths use this to avoid recursively re-entering the same repair flow
 * from inside selective re-embedding and vector-sync inspection.
 */
export function isSemanticEpochRefreshInProgress(): boolean {
	return inFlightSemanticEpochRefresh !== null;
}

/**
 * Return current epoch-refresh state for operator inspection and daemon control
 * surfaces.
 */
export async function getSemanticEpochRefreshStatus(): Promise<SemanticEpochRefreshStatus> {
	const currentEpoch = (await (await getEngineEmbeddingService()).getEmbeddingEpoch()).epoch;
	const state = readCurrentEpochState();
	return {
		currentEpoch,
		persistedEpoch: state?.currentEpoch ?? null,
		previousEpoch: state?.previousEpoch ?? null,
		lastAttemptEpoch: state?.lastAttemptEpoch ?? null,
		lastAttemptAt: state?.lastAttemptAt ?? null,
		lastAttemptStatus: state?.lastAttemptStatus ?? null,
		inFlight: isSemanticEpochRefreshInProgress(),
		qualityDebtCount: state?.lastRepair.qualityDeferred ?? 0,
		lastRepair: state?.lastRepair ?? emptyRepairResult(),
		persistedStateValid: !state?.parseError,
		degradedReason: state?.parseError ?? null,
	};
}

/**
 * Persist the result of a manual or daemon-triggered semantic repair pass so
 * later status checks can distinguish healed freshness drift from remaining
 * quality debt.
 */
export async function persistSemanticEpochRepairState(
	repair: SelectiveReembeddingRepairResult,
): Promise<SemanticEpochRefreshResult> {
	const currentEpoch = (await (await getEngineEmbeddingService()).getEmbeddingEpoch()).epoch;
	const state = readCurrentEpochState();
	const previousEpoch = state?.currentEpoch ?? null;
	const freshnessCompleted = await epochRefreshCompleted();
	writeCurrentEpochState({
		healedEpoch: freshnessCompleted ? currentEpoch : previousEpoch,
		attemptEpoch: currentEpoch,
		attemptStatus: freshnessCompleted ? "success" : "partial",
		previousEpoch,
		repair,
	});
	return {
		currentEpoch,
		previousEpoch,
		reason: previousEpoch === null ? "bootstrap" : previousEpoch === currentEpoch ? "forced" : "epoch-changed",
		completed: freshnessCompleted,
		freshnessCompleted,
		refreshed: true,
		qualityDebtCount: repair.qualityDeferred,
		repair,
	};
}

/**
 * Treat an embedding epoch as healed only when both the local semantic mirror
 * and the remote semantic mirror no longer report freshness drift.
 *
 * Quality debt such as low MDL or rejected packed summaries stays visible in
 * repair metadata, but it is not the same as an epoch-refresh freshness miss.
 */
async function epochRefreshCompleted(): Promise<boolean> {
	const remoteEnabled = Boolean(resolveRemoteSemanticMirrorConfig());
	const remaining = await planSelectiveReembedding({
		scanAll: true,
		reasons: remoteEnabled ? GLOBAL_EPOCH_COMPLETION_REASONS : LOCAL_EPOCH_COMPLETION_REASONS,
		resyncRemote: false,
		minMdlScore: 0,
		minSourceSessionCount: 0,
		minPriorityScore: 0,
	});
	return remaining.candidateCount === 0;
}

/**
 * Self-heal the curated semantic mirror when the active embedding epoch
 * changes.
 *
 * A refresh is considered complete only when freshness drift is gone locally
 * and, when configured, in the remote semantic mirror as well.
 *
 * When the epoch is unchanged, the same entrypoint can still run a bounded
 * quality-debt repair pass so low-MDL artifacts do not wait for the next
 * provider/model migration before being reconsidered.
 */
export async function refreshGlobalSemanticEpochDrift(
	options: { force?: boolean } = {},
): Promise<SemanticEpochRefreshResult> {
	if (inFlightSemanticEpochRefresh) {
		return await inFlightSemanticEpochRefresh;
	}
	const run = (async (): Promise<SemanticEpochRefreshResult> => {
		const currentEpoch = (await (await getEngineEmbeddingService()).getEmbeddingEpoch()).epoch;
		const state = readCurrentEpochState();
		const previousEpoch = state?.currentEpoch ?? null;
		const remoteEnabled = Boolean(resolveRemoteSemanticMirrorConfig());
		const activeBudget = readActiveResearchRefinementBudget()?.refinement ?? null;
		const force = options.force === true;
		const shouldRefresh = force || previousEpoch === null || previousEpoch !== currentEpoch;
		const lastKnownQualityDebtCount = state?.lastRepair.qualityDeferred ?? 0;
		const recentlyCheckedSameEpoch = state?.lastAttemptEpoch === currentEpoch
			&& typeof state.lastAttemptAt === "number"
			&& (Date.now() - state.lastAttemptAt) < EPOCH_REFRESH_RETRY_BACKOFF_MS;

		if (!shouldRefresh) {
			// Same-epoch runs are repair-only. I do not advance freshness here; I only
			// chase unresolved quality debt against the current embedding generation.
			const qualityDebtCount = lastKnownQualityDebtCount > 0 || recentlyCheckedSameEpoch
				? lastKnownQualityDebtCount
				: await planSemanticQualityDebt(remoteEnabled, {
					override: activeBudget,
					pressure: lastKnownQualityDebtCount,
				});

			if (
				!force
				&& qualityDebtCount > 0
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
					freshnessCompleted: true,
					refreshed: false,
					qualityDebtCount,
					repair: state.lastRepair,
				};
			}

			if (qualityDebtCount <= 0) {
				// No same-epoch quality debt remains, so I can report the semantic
				// mirror as fully healthy without performing another repair pass.
				return {
					currentEpoch,
					previousEpoch,
					reason: "unchanged",
					completed: true,
					freshnessCompleted: true,
					refreshed: false,
					qualityDebtCount: 0,
					repair: emptyRepairResult(),
				};
			}

			const lockToken = acquireSemanticRuntimeLock(SEMANTIC_EPOCH_REFRESH_LOCK);
			if (!lockToken) {
				// Another repair already owns the lock. I return the persisted repair
				// state instead of waiting so operators see the current debt snapshot
				// without creating a second concurrent repair.
				return {
					currentEpoch,
					previousEpoch,
					reason: "retry-backoff",
					completed: false,
					freshnessCompleted: true,
					refreshed: false,
					qualityDebtCount,
					repair: state?.lastRepair ?? emptyRepairResult(),
				};
			}

			try {
				const repair = await repairSemanticQualityDebt(remoteEnabled, {
					override: activeBudget,
					pressure: qualityDebtCount,
				});
				const remainingQualityDebtCount = await planSemanticQualityDebt(remoteEnabled, {
					override: activeBudget,
					pressure: Math.max(qualityDebtCount, repair.qualityDeferred),
				});
				const repairWithQualityDebt = {
					...repair,
					qualityDeferred: remainingQualityDebtCount,
				};
				const completed = remainingQualityDebtCount === 0;
				writeCurrentEpochState({
					healedEpoch: currentEpoch,
					attemptEpoch: currentEpoch,
					attemptStatus: completed ? "success" : "partial",
					previousEpoch,
					repair: repairWithQualityDebt,
				});
				return {
					currentEpoch,
					previousEpoch,
					reason: "quality-debt",
					completed,
					freshnessCompleted: true,
					refreshed: repair.reembedded > 0 || repair.remoteSynced > 0,
					qualityDebtCount: remainingQualityDebtCount,
					repair: repairWithQualityDebt,
				};
			} finally {
				releaseSemanticRuntimeLock(SEMANTIC_EPOCH_REFRESH_LOCK, lockToken);
			}
		}

		if (
			!force
			&& previousEpoch !== currentEpoch
		&& state?.lastAttemptEpoch === currentEpoch
		&& state.lastAttemptStatus === "partial"
		&& typeof state.lastAttemptAt === "number"
		&& (Date.now() - state.lastAttemptAt) < EPOCH_REFRESH_RETRY_BACKOFF_MS
	) {
			// Freshness repair is already in progress for this epoch. I surface the
			// persisted partial state immediately instead of starting a second full
			// refresh against the same embedding generation.
			return {
				currentEpoch,
				previousEpoch,
				reason: "retry-backoff",
				completed: false,
				freshnessCompleted: false,
				refreshed: false,
				qualityDebtCount: state.lastRepair.qualityDeferred,
				repair: state.lastRepair,
			};
	}

		// Epoch changes are freshness work first. I only reuse the same retry window
		// if the current epoch already has a partial refresh attempt in flight.
		const lockToken = acquireSemanticRuntimeLock(SEMANTIC_EPOCH_REFRESH_LOCK);
		if (!lockToken) {
			// The active refresher will persist the latest state. I surface the
			// current snapshot immediately instead of blocking another daemon cycle.
			return {
				currentEpoch,
				previousEpoch,
				reason: "retry-backoff",
				completed: false,
				freshnessCompleted: false,
				refreshed: false,
				qualityDebtCount: state?.lastRepair.qualityDeferred ?? 0,
				repair: state?.lastRepair ?? emptyRepairResult(),
			};
		}

		try {
			let repair: SelectiveReembeddingRepairResult;
			try {
				repair = await repairSelectiveReembedding({
					scanAll: true,
					reasons: [...(remoteEnabled
						? GLOBAL_SEMANTIC_FRESHNESS_REPAIR_REASONS
						: LOCAL_SEMANTIC_FRESHNESS_REPAIR_REASONS)],
					resyncRemote: remoteEnabled,
					minMdlScore: 0,
					minSourceSessionCount: 0,
					minPriorityScore: 0,
				});
			} catch (error) {
				writeCurrentEpochState({
					healedEpoch: previousEpoch,
					attemptEpoch: currentEpoch,
					attemptStatus: "partial",
					previousEpoch,
					repair: state?.lastRepair ?? emptyRepairResult(),
				});
				throw error;
			}
			const freshnessCompleted = await epochRefreshCompleted();
			const qualityDebtCount = await planSemanticQualityDebt(remoteEnabled, {
				override: activeBudget,
				pressure: repair.qualityDeferred,
			});
			const repairWithQualityDebt = {
				...repair,
				qualityDeferred: qualityDebtCount,
			};
			const completed = freshnessCompleted;
			writeCurrentEpochState({
				healedEpoch: freshnessCompleted ? currentEpoch : previousEpoch,
				attemptEpoch: currentEpoch,
				attemptStatus: freshnessCompleted ? "success" : "partial",
				previousEpoch,
				repair: repairWithQualityDebt,
			});

			return {
				currentEpoch,
				previousEpoch,
				reason: force ? "forced" : previousEpoch === null ? "bootstrap" : "epoch-changed",
				completed,
				freshnessCompleted,
				refreshed: true,
				qualityDebtCount,
				repair: repairWithQualityDebt,
			};
		} finally {
			releaseSemanticRuntimeLock(SEMANTIC_EPOCH_REFRESH_LOCK, lockToken);
		}
	})();
	inFlightSemanticEpochRefresh = run.finally(() => {
		inFlightSemanticEpochRefresh = null;
	});
	return await inFlightSemanticEpochRefresh;
}
