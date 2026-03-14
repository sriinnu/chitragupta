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
}): ResearchRefinementProjectScope {
	return {
		projectPath: scope.projectPath,
		sessionIds: scope.sessionIds,
		sessionLineageKeys: scope.sessionLineageKeys,
	};
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
	entry: Pick<ResearchRefinementQueuedScope, "projectPath" | "sessionIds" | "sessionLineageKeys" | "repairIntent">,
	excludedScopeKeys: ReadonlySet<string>,
): "clear" | "keep" | "process" {
	if (!excludedScopeKeys.has(buildScopeKey(toProjectScope(entry)))) return "process";
	return entry.repairIntent ? "keep" : "clear";
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
	if (typeof options.limit === "number" && options.limit <= 0) {
		return {
			...initialDrainResult(),
			remainingDue: countQueuedResearchRefinementScopes(),
		};
	}
	const queued = listQueuedResearchRefinementScopes({ limit: options.limit });
	const summary = initialDrainResult();
	const excludedScopeKeys = new Set(
		(options.excludeScopes ?? []).map((scope) => buildScopeKey(scope)),
	);
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
		const exclusionDecision = shouldSkipQueuedEntry(entry, excludedScopeKeys);
		if (exclusionDecision === "clear") {
			// I treat an already-repaired queued scope as satisfied instead of
			// replaying the same project/session set twice in one daemon cycle.
			clearQueuedResearchRefinementScope(entry.id);
			continue;
		}
		if (exclusionDecision === "keep") {
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
