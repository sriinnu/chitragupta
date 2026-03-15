import type { ResearchRefinementProjectScope } from "./chitragupta-daemon-research-scope.js";
import { repairSelectiveReembeddingForResearchScopes } from "./chitragupta-daemon-semantic.js";
import type { ResearchRefinementQueuedScope, ResearchRefinementRepairIntent } from "@chitragupta/smriti";

/** Aggregated result of draining deferred research semantic repair work. */
export interface QueuedResearchRefinementDrainResult {
	drained: number;
	repaired: number;
	deferred: number;
	remainingDue: number;
	remoteSynced: number;
	qualityDeferred: number;
}

/** Build one deterministic scope key so I can dedupe queue work cheaply. */
function buildScopeKey(scope: {
	projectPath: string;
	sessionIds?: readonly string[];
	sessionLineageKeys?: readonly string[];
}): string {
	return JSON.stringify({
		projectPath: scope.projectPath,
		sessionIds: [...(scope.sessionIds ?? [])].sort(),
		sessionLineageKeys: [...(scope.sessionLineageKeys ?? [])].sort(),
	});
}

/** Return a zeroed drain summary before any queued scope is replayed. */
function initialDrainResult(): QueuedResearchRefinementDrainResult {
	return {
		drained: 0,
		repaired: 0,
		deferred: 0,
		remainingDue: 0,
		remoteSynced: 0,
		qualityDeferred: 0,
	};
}

/** Back off noisy retry loops instead of hammering the same broken scope. */
function queueBackoffMs(attemptCount: number): number {
	const exponent = Math.max(0, Math.min(attemptCount, 6));
	return Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** exponent));
}

/** Normalize one persisted queue record into the canonical project scope shape. */
function toProjectScope(scope: {
	projectPath: string;
	sessionIds: string[];
	sessionLineageKeys: string[];
	policyFingerprints?: readonly string[];
	primaryObjectiveIds?: readonly string[];
	primaryStopConditionIds?: readonly string[];
	primaryStopConditionKinds?: readonly string[];
	frontierBestScore?: number | null;
	refinementBudget?: ResearchRefinementProjectScope["refinementBudget"];
	nidraBudget?: ResearchRefinementProjectScope["nidraBudget"];
}): ResearchRefinementProjectScope {
	return {
		projectPath: scope.projectPath,
		sessionIds: scope.sessionIds,
		sessionLineageKeys: scope.sessionLineageKeys,
		policyFingerprints: scope.policyFingerprints,
		primaryObjectiveIds: scope.primaryObjectiveIds,
		primaryStopConditionIds: scope.primaryStopConditionIds,
		primaryStopConditionKinds: scope.primaryStopConditionKinds,
		frontierBestScore: typeof scope.frontierBestScore === "number" ? scope.frontierBestScore : undefined,
		refinementBudget: scope.refinementBudget ?? null,
		nidraBudget: scope.nidraBudget ?? null,
	};
}

function coversSubset(covered: readonly string[] | undefined, candidate: readonly string[] | undefined): boolean {
	const normalizedCovered = new Set((covered ?? []).map((value) => value.trim()).filter(Boolean));
	const normalizedCandidate = [...(candidate ?? [])].map((value) => value.trim()).filter(Boolean);
	if (normalizedCandidate.length === 0) return true;
	if (normalizedCovered.size === 0) return false;
	return normalizedCandidate.every((value) => normalizedCovered.has(value));
}

function findCoveredScope(
	entry: Pick<ResearchRefinementQueuedScope, "projectPath" | "sessionIds" | "sessionLineageKeys">,
	excludedScopes: readonly ResearchRefinementProjectScope[],
): ResearchRefinementProjectScope | null {
	const exact = excludedScopes.find((scope) => buildScopeKey(scope) === buildScopeKey(toProjectScope(entry)));
	if (exact) return exact;
	return excludedScopes.find((scope) =>
		scope.projectPath === entry.projectPath
		&& coversSubset(scope.sessionIds, entry.sessionIds)
		&& coversSubset(scope.sessionLineageKeys, entry.sessionLineageKeys),
	) ?? null;
}

function hasMissingMetadataCoverage(
	entry: Pick<
		ResearchRefinementQueuedScope,
		| "policyFingerprints"
		| "primaryObjectiveIds"
		| "primaryStopConditionIds"
		| "primaryStopConditionKinds"
		| "frontierBestScore"
		| "refinementBudget"
		| "nidraBudget"
	>,
	covered: ResearchRefinementProjectScope,
): boolean {
	const misses = (
		values: readonly string[] | undefined,
		coveredValues: readonly string[] | undefined,
	): boolean => (values ?? []).some((value) => !(coveredValues ?? []).includes(value));
	const preservesBudget = (value: unknown, coveredValue: unknown): boolean => {
		if (value == null) return true;
		return JSON.stringify(value) === JSON.stringify(coveredValue ?? null);
	};
	return (
		misses(entry.policyFingerprints, covered.policyFingerprints)
		|| misses(entry.primaryObjectiveIds, covered.primaryObjectiveIds)
		|| misses(entry.primaryStopConditionIds, covered.primaryStopConditionIds)
		|| misses(entry.primaryStopConditionKinds, covered.primaryStopConditionKinds)
		|| (
			typeof entry.frontierBestScore === "number"
			&& entry.frontierBestScore > (covered.frontierBestScore ?? Number.NEGATIVE_INFINITY)
		)
		|| !preservesBudget(entry.refinementBudget, covered.refinementBudget)
		|| !preservesBudget(entry.nidraBudget, covered.nidraBudget)
	);
}

/**
 * Decide whether one queued entry can be considered already covered by the
 * project-scoped repair that ran earlier in this daemon cycle.
 *
 * I only auto-clear coarse project/session queue rows here. Exact persisted
 * repair intents stay durable because a broad project repair pass does not
 * prove that the narrower failed frontier was replayed successfully.
 */
function shouldSkipQueuedEntry(
	entry: Pick<
		ResearchRefinementQueuedScope,
		| "projectPath"
		| "sessionIds"
		| "sessionLineageKeys"
		| "repairIntent"
		| "policyFingerprints"
		| "primaryObjectiveIds"
		| "primaryStopConditionIds"
		| "primaryStopConditionKinds"
		| "frontierBestScore"
		| "refinementBudget"
		| "nidraBudget"
	>,
	excludedScopes: readonly ResearchRefinementProjectScope[],
): "clear" | "keep" | "process" {
	const covered = findCoveredScope(entry, excludedScopes);
	if (!covered) return "process";
	if (entry.repairIntent || hasMissingMetadataCoverage(entry, covered)) return "keep";
	return "clear";
}

/**
 * Replay one exact deferred repair intent when the queue preserved it.
 *
 * I prefer this over project-scope reconstruction because it preserves the
 * original daily/project frontier that actually failed, which makes retries
 * more deterministic across restarts and later ledger churn.
 */
async function replayQueuedRepairIntent(
	intent: ResearchRefinementRepairIntent,
): Promise<{
	candidates: number;
	reembedded: number;
	remoteSynced: number;
	qualityDeferred: number;
}> {
	const { repairSelectiveReembedding } = await import("@chitragupta/smriti");
	const requests = [intent.daily, intent.project].filter((value): value is Record<string, unknown> => Boolean(value));
	let candidates = 0;
	let reembedded = 0;
	let remoteSynced = 0;
	let qualityDeferred = 0;
	for (const request of requests) {
		const repair = await repairSelectiveReembedding(
			request as Parameters<typeof repairSelectiveReembedding>[0] & Record<string, unknown>,
		);
		candidates += repair.plan.candidateCount;
		reembedded += repair.reembedded;
		remoteSynced += repair.remoteSynced;
		qualityDeferred += repair.qualityDeferred;
	}
	return { candidates, reembedded, remoteSynced, qualityDeferred };
}

/**
 * Drain durable research refinement retries through the same project-scoped
 * semantic repair path the daemon already uses for daily and deep-sleep repair.
 *
 * I keep the queue narrow: only normalized project/session scope is persisted.
 * Dates and period windows are recomputed from the research ledger during
 * repair so the queue does not duplicate time-window state.
 */
export async function drainQueuedResearchRefinementScopes(
	options: { limit?: number; label?: string; excludeScopes?: readonly ResearchRefinementProjectScope[] } = {},
): Promise<QueuedResearchRefinementDrainResult> {
	const {
		countQueuedResearchRefinementScopes,
		listQueuedResearchRefinementScopes,
		clearQueuedResearchRefinementScope,
		deferQueuedResearchRefinementScope,
	} = await import("@chitragupta/smriti");
	const excludedScopes = options.excludeScopes ?? [];
	const replayBudget = typeof options.limit === "number"
		? Math.max(0, Math.floor(options.limit))
		: null;
	if (replayBudget === 0 && excludedScopes.length === 0) {
		return {
			...initialDrainResult(),
			remainingDue: countQueuedResearchRefinementScopes(),
		};
	}
	const dueCount = countQueuedResearchRefinementScopes();
	const queued = listQueuedResearchRefinementScopes({
		limit: replayBudget === null ? options.limit : Math.max(1, dueCount),
	});
	const summary = initialDrainResult();
	for (const entry of queued) {
		const parseError =
			typeof (entry as ResearchRefinementQueuedScope & { parseError?: unknown }).parseError === "string"
				? (entry as ResearchRefinementQueuedScope & { parseError: string }).parseError
				: null;
		if (parseError) {
			summary.deferred += 1;
			deferQueuedResearchRefinementScope(entry.id, {
				backoffMs: queueBackoffMs(entry.attemptCount + 1),
				lastError: `parse-error:${parseError}`,
			});
			continue;
		}
		const exclusionDecision = shouldSkipQueuedEntry(entry, excludedScopes);
		if (exclusionDecision === "clear") {
			// I treat an already-repaired queued scope as satisfied instead of
			// replaying the same project/session set twice in one daemon cycle.
			clearQueuedResearchRefinementScope(entry.id);
			continue;
		}
		if (exclusionDecision === "keep") {
			if (replayBudget === 0) {
				// I leave exact queued replay intent untouched when the shared budget
				// is exhausted. Budget exhaustion is not a failed replay attempt, so it
				// should not advance retry bookkeeping or rewrite the durable intent.
				continue;
			}
			// I keep exact replay intents durable when the current daemon cycle
			// only proved that a broader project repair ran. The narrower replay
			// frontier can be retried once the active project scope is no longer
			// consuming this cycle's bounded repair budget.
			summary.deferred += 1;
			deferQueuedResearchRefinementScope(entry.id, {
				backoffMs: queueBackoffMs(entry.attemptCount),
				lastError: "deferred:active-project-repair",
			});
			continue;
		}
		const projectScope = toProjectScope(entry);
		if (replayBudget === 0) {
			// I still inspect and clear already-covered rows when the replay budget is
			// exhausted, but I leave untouched due work in place instead of pretending
			// it was processed or rewriting its retry bookkeeping.
			continue;
		}
		if (replayBudget !== null && summary.drained >= replayBudget) {
			// I keep walking the due queue after the replay budget is spent so parse
			// errors and already-covered rows still get reconciled in this cycle,
			// but I leave untouched actionable rows in place for the next pass.
			continue;
		}
		summary.drained += 1;
		try {
			// I replay each durable scope independently so one bad project does not
			// block unrelated queued research refinement work.
			const repair = entry.repairIntent
				? await replayQueuedRepairIntent(entry.repairIntent)
				: await repairSelectiveReembeddingForResearchScopes(
					options.label ?? entry.label,
					[projectScope],
				);
			summary.remoteSynced += repair.remoteSynced;
			summary.qualityDeferred += repair.qualityDeferred;
			if (repair.qualityDeferred > 0) {
				// Quality debt is not a transport failure. I keep the same durable
				// scope alive with backoff so the next daemon cycle can retry after
				// compaction or epoch state improves.
				summary.deferred += 1;
				deferQueuedResearchRefinementScope(entry.id, {
					backoffMs: queueBackoffMs(entry.attemptCount + 1),
					lastError: `quality-deferred:${repair.qualityDeferred}`,
				});
				continue;
			}
			clearQueuedResearchRefinementScope(entry.id);
			summary.repaired += 1;
			} catch (error) {
				summary.deferred += 1;
				deferQueuedResearchRefinementScope(entry.id, {
					backoffMs: queueBackoffMs(entry.attemptCount + 1),
					lastError: error instanceof Error ? error.message : String(error),
				});
			}
		}
	summary.remainingDue = countQueuedResearchRefinementScopes();
	return summary;
}
