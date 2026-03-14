import {
	inspectConsolidationVectorSync,
	indexConsolidationSummary,
	listCuratedConsolidationArtifacts,
	type ConsolidationVectorSyncIssue,
	type CuratedConsolidationArtifact,
	type CuratedConsolidationArtifactQuery,
} from "./consolidation-indexer.js";
import {
	MIN_SUMMARY_MDL_SCORE,
} from "./mdl-compaction.js";
import {
	inspectRemoteSemanticSync,
	syncRemoteSemanticMirror,
	type RemoteSemanticSyncIssue,
} from "./remote-semantic-sync.js";
import { getRemoteSemanticPromotionDecision } from "./remote-semantic-sync-quality.js";
import {
	buildIssueMap,
	deriveArtifactQualityReasons,
	hasCompactionRepairDisposition,
	hasCompactionWatchDisposition,
	hasFreshnessRepairReason,
	hasQualityRebuildReason,
	hasQualityRepairReason,
	normalizeReasonFilter,
	requiresQualityRefresh,
	scoreCandidate,
} from "./selective-reembedding-helpers.js";

/**
 * Candidate artifact for selective semantic refresh.
 *
 * I score these from a mix of epoch drift, remote drift, provenance weight,
 * and MDL quality so the daemon can refresh a small high-value frontier
 * instead of rewriting the entire semantic mirror.
 */
export interface SelectiveReembeddingCandidate {
	id: string;
	level: "daily" | "monthly" | "yearly";
	period: string;
	project: string | undefined;
	score: number;
	localReasons: Array<LocalSelectiveReembeddingReason>;
	remoteReasons: Array<RemoteSemanticSyncIssue["reason"]>;
	sourceSessionCount: number;
	sourcePeriodCount: number;
	mdlScore: number;
	contentHash: string;
}

/**
 * Local reasons originate from the canonical Chitragupta semantic mirrors.
 *
 * These are the only reasons that can trigger local rebuild/reindex work
 * without consulting the remote mirror.
 */
export type LocalSelectiveReembeddingReason =
	| ConsolidationVectorSyncIssue["reason"]
	| "low_mdl"
	| "rejected_packed"
	| "low_retention"
	| "low_reduction";

/**
 * Full selective-reembedding reason set.
 *
 * This widens local reasons with remote mirror drift so the daemon can repair
 * either local truth or remote lag from the same ranked candidate frontier.
 */
export type SelectiveReembeddingReason =
	| LocalSelectiveReembeddingReason
	| RemoteSemanticSyncIssue["reason"];

/** Ranked repair plan for the highest-value stale semantic artifacts. */
export interface SelectiveReembeddingPlan {
	scanned: number;
	candidateCount: number;
	candidates: SelectiveReembeddingCandidate[];
}

/**
 * Result of one selective semantic repair pass.
 *
 * `reembedded` counts local semantic refreshes, while `remoteSynced` only
 * counts the second-phase remote mirror repair after local truth is healthy.
 */
export interface SelectiveReembeddingRepairResult {
	plan: SelectiveReembeddingPlan;
	reembedded: number;
	remoteSynced: number;
	qualityDeferred: number;
}

/**
 * Planner options for selective semantic repair.
 *
 * These gates intentionally bias toward high-value artifacts instead of
 * rewriting the entire mirror whenever one provider/model epoch changes.
 */
export interface SelectiveReembeddingOptions extends CuratedConsolidationArtifactQuery {
	candidateLimit?: number;
	reasons?: readonly SelectiveReembeddingReason[];
	resyncRemote?: boolean;
	minMdlScore?: number;
	minSourceSessionCount?: number;
	minPriorityScore?: number;
}

/**
 * Rebuild a curated artifact through the same consolidation path that
 * originally produced it, instead of mutating the artifact ad hoc.
 */
async function rebuildCuratedArtifact(
	artifact: CuratedConsolidationArtifact,
): Promise<boolean> {
	try {
		if (artifact.level === "daily") {
			const { consolidateDay } = await import("./day-consolidation.js");
			await consolidateDay(artifact.period, { force: true });
			return true;
		}
		if (!artifact.project) return false;
		const { PeriodicConsolidation } = await import("./periodic-consolidation.js");
		const consolidation = new PeriodicConsolidation({ project: artifact.project });
		if (artifact.level === "monthly") {
			const [year, month] = artifact.period.split("-").map((value) => Number.parseInt(value, 10));
			if (!Number.isFinite(year) || !Number.isFinite(month)) return false;
			await consolidation.monthly(year, month);
			return true;
		}
		const year = Number.parseInt(artifact.period, 10);
		if (!Number.isFinite(year)) return false;
		await consolidation.yearly(year);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reload one curated artifact after a local rebuild/reindex step.
 *
 * I use this to ensure any downstream promotion decision sees the latest
 * hash/epoch/quality metadata instead of whatever snapshot was loaded before
 * the repair ran.
 */
async function reloadCuratedArtifact(
	options: SelectiveReembeddingOptions,
	artifactId: string,
	fallback: CuratedConsolidationArtifact,
): Promise<CuratedConsolidationArtifact> {
	const refreshed = await listCuratedConsolidationArtifacts({ ...options, ids: [artifactId] });
	return refreshed[0] ?? fallback;
}

/**
 * Re-read the local vector drift reasons for one artifact after a rebuild step.
 *
 * I use this to tell apart "the rebuild already refreshed the vector row"
 * from "the canonical rebuild improved quality, but I still owe a local
 * reindex before the artifact is semantically healthy again".
 */
async function reloadLocalRepairReasons(
	options: SelectiveReembeddingOptions,
	artifactId: string,
): Promise<Array<ConsolidationVectorSyncIssue["reason"]>> {
	const status = await inspectConsolidationVectorSync({ ...options, ids: [artifactId] });
	return status.issues
		.filter((issue) => issue.id === artifactId)
		.map((issue) => issue.reason);
}

/**
 * Plan a bounded selective semantic repair pass without mutating artifacts.
 */
export async function planSelectiveReembedding(
	options: SelectiveReembeddingOptions = {},
): Promise<SelectiveReembeddingPlan> {
	const hasExplicitIds = Array.isArray(options.ids) && options.ids.length > 0;
	const candidateLimit = hasExplicitIds || options.scanAll === true
		? Number.MAX_SAFE_INTEGER
		: Math.max(1, Math.min(options.candidateLimit ?? 20, 200));
	const reasonFilter = normalizeReasonFilter(options.reasons);
	const artifacts = await listCuratedConsolidationArtifacts(options);
	if (artifacts.length === 0) {
		return { scanned: 0, candidateCount: 0, candidates: [] };
	}
	const [localStatus, remoteStatus] = await Promise.all([
		inspectConsolidationVectorSync(options),
		inspectRemoteSemanticSync(options),
	]);
	const localIssuesById = buildIssueMap(localStatus.issues);
	const remoteIssuesById = buildIssueMap(remoteStatus.issues);
	const minMdlScore = Math.max(0, Math.min(1, options.minMdlScore ?? 0));
	const minSourceSessionCount = Math.max(0, Math.trunc(options.minSourceSessionCount ?? 0));
	const minPriorityScore = Number.isFinite(options.minPriorityScore) ? Math.max(0, options.minPriorityScore ?? 0) : 0;
	const candidates = artifacts
		.reduce<SelectiveReembeddingCandidate[]>((acc, artifact) => {
			const localSyncReasons = (localIssuesById.get(artifact.id) ?? []).map((issue) => issue.reason);
			const remoteReasons = (remoteIssuesById.get(artifact.id) ?? []).map((issue) => issue.reason);
			const qualityReasons = deriveArtifactQualityReasons(artifact);
			const compactionRepairDisposition = hasCompactionRepairDisposition(artifact);
			const compactionWatchDisposition = hasCompactionWatchDisposition(artifact);
			// Quality reasons are first-class repair triggers, not just tie-breakers.
			const localReasons = [...new Set([...localSyncReasons, ...qualityReasons])];
			const effectiveReasons = [...new Set([...localReasons, ...remoteReasons])];
			const epochRelevant =
				localReasons.includes("stale_epoch")
				|| remoteReasons.includes("stale_remote_epoch");
			const remoteRelevant =
				remoteReasons.includes("missing_remote")
				|| remoteReasons.includes("stale_remote")
				|| remoteReasons.includes("stale_remote_quality")
				|| remoteReasons.includes("remote_error");
			const qualityRelevant =
				localReasons.includes("low_mdl")
				|| localReasons.includes("rejected_packed")
				|| localReasons.includes("low_retention")
				|| localReasons.includes("low_reduction")
				// I surface MDL disposition directly here so "repair" is a
				// first-class frontier signal, not only an indirect score bump.
				|| compactionRepairDisposition
				|| (
					compactionWatchDisposition
					&& artifact.mdlMetrics.mdlScore < Math.max(minMdlScore, MIN_SUMMARY_MDL_SCORE)
				);
			const matchedReasons = reasonFilter
				? effectiveReasons.filter((reason) => reasonFilter.has(reason))
				: effectiveReasons.filter((reason) => epochRelevant || remoteRelevant || qualityRelevant);
			const reasonMatch = reasonFilter
				? matchedReasons.length > 0
					|| (compactionRepairDisposition && reasonFilter.has("low_mdl"))
				: epochRelevant || remoteRelevant || qualityRelevant;
			if (!reasonMatch) {
				return acc;
			}
			const sourcePeriodCount =
				"sourcePeriods" in artifact.provenance && Array.isArray(artifact.provenance.sourcePeriods)
					? artifact.provenance.sourcePeriods.length
					: 0;
			const score = scoreCandidate(artifact, localReasons, remoteReasons);
			if (!hasExplicitIds) {
				// High-signal drift reasons and explicit repair disposition are
				// allowed to bypass the generic frontier gates so I do not ignore
				// obviously bad artifacts just because they are small or sparse.
				const bypassRepairGates =
					hasQualityRepairReason(matchedReasons)
					|| hasFreshnessRepairReason(matchedReasons)
					|| compactionRepairDisposition;
				const meetsMdlGate = bypassRepairGates || artifact.mdlMetrics.mdlScore >= minMdlScore;
				const meetsSourceGate = bypassRepairGates || artifact.provenance.sourceSessionIds.length >= minSourceSessionCount;
				const meetsPriorityGate = bypassRepairGates || score >= minPriorityScore;
				if (!meetsMdlGate || !meetsSourceGate || !meetsPriorityGate) {
					return acc;
				}
			}
			acc.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				score,
				localReasons,
				remoteReasons,
				sourceSessionCount: artifact.provenance.sourceSessionIds.length,
				sourcePeriodCount,
				mdlScore: artifact.mdlMetrics.mdlScore,
				contentHash: artifact.contentHash,
			});
			return acc;
		}, [])
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
		.slice(0, candidateLimit);
	return {
		scanned: artifacts.length,
		candidateCount: candidates.length,
		candidates,
	};
}

/**
 * Repair the highest-value stale semantic artifacts in place.
 *
 * Quality repairs rebuild the artifact first, then refresh local vectors, and
 * only then attempt remote mirror repair if the local representation is healthy
 * enough to promote.
 */
export async function repairSelectiveReembedding(
	options: SelectiveReembeddingOptions = {},
): Promise<SelectiveReembeddingRepairResult> {
	const plan = await planSelectiveReembedding(options);
	if (plan.candidateCount === 0) {
		return { plan, reembedded: 0, remoteSynced: 0, qualityDeferred: 0 };
	}
	const artifactIds = plan.candidates.map((candidate) => candidate.id);
	const artifacts = await listCuratedConsolidationArtifacts({ ...options, ids: artifactIds });
	const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
	let reembedded = 0;
	let qualityDeferred = 0;
	const remoteEligibleIds: string[] = [];
	for (const candidate of plan.candidates) {
		let artifact = artifactsById.get(candidate.id);
		if (!artifact) continue;
		const requiresQualityRepair = requiresQualityRefresh(candidate);
		const requiresLocalVectorRepair =
			candidate.localReasons.includes("missing_vector")
			|| candidate.localReasons.includes("stale_hash")
			|| candidate.localReasons.includes("legacy_vector")
			|| candidate.localReasons.includes("stale_epoch");
		const requiresRemoteMirrorRepair =
			candidate.remoteReasons.includes("missing_remote")
			|| candidate.remoteReasons.includes("stale_remote")
			|| candidate.remoteReasons.includes("stale_remote_epoch")
			|| candidate.remoteReasons.includes("stale_remote_quality")
			|| candidate.remoteReasons.includes("remote_error");
		let requiresLocalReindex = requiresLocalVectorRepair;
		let qualityStillDeferred = false;
		if (!requiresLocalVectorRepair && !requiresRemoteMirrorRepair && !requiresQualityRepair) {
			continue;
		}
		if (requiresQualityRepair) {
			const rebuilt = await rebuildCuratedArtifact(artifact);
			if (!rebuilt) {
				qualityStillDeferred = true;
				qualityDeferred += 1;
				continue;
			}
			artifact = await reloadCuratedArtifact(options, candidate.id, artifact);
			artifactsById.set(candidate.id, artifact);
			const remainingQualityReasons = deriveArtifactQualityReasons(artifact);
			qualityStillDeferred = hasQualityRebuildReason(remainingQualityReasons);
			const refreshedLocalReasons = await reloadLocalRepairReasons(options, candidate.id);
			if (requiresLocalVectorRepair && !hasFreshnessRepairReason(refreshedLocalReasons)) {
				// Canonical rebuilds can already refresh the vector row through the
				// consolidation path. When that happens I count the local semantic
				// repair immediately and skip a redundant reindex call.
				requiresLocalReindex = false;
				reembedded += 1;
			} else {
				// Rebuilds can change both the summary body and its MDL/packed
				// metadata, so I still force a local reindex before any remote sync
				// when the canonical rebuild has not already repaired freshness.
				requiresLocalReindex = true;
			}
		}
		let localIndexed = false;
		if (requiresLocalReindex) {
			const reindex = await indexConsolidationSummary(
				artifact.level,
				artifact.period,
				artifact.markdown,
				artifact.project,
			);
			localIndexed = reindex.indexed;
			if (localIndexed) {
				reembedded += 1;
				artifact = await reloadCuratedArtifact(options, candidate.id, artifact);
				artifactsById.set(candidate.id, artifact);
			} else if (requiresQualityRepair) {
				// Canonical rebuilds can already refresh the local vector through the
				// consolidation path. If the follow-up index call becomes a no-op, I
				// still count the local vector refresh instead of under-reporting a
				// successful rebuild. Any remaining quality debt is tracked
				// separately through `qualityStillDeferred`.
				localIndexed = true;
				reembedded += 1;
			}
		}
		if (qualityStillDeferred) {
			qualityDeferred += 1;
		}
			const remotePromotion = getRemoteSemanticPromotionDecision(artifact);
			// I only promote remotely once local quality debt is no longer deferred
			// and either the local index actually refreshed or the remote mirror
			// itself still needs an explicit repair pass.
			if (!qualityStillDeferred && remotePromotion.eligible && (localIndexed || requiresRemoteMirrorRepair)) {
				remoteEligibleIds.push(candidate.id);
			}
	}
	if (options.resyncRemote === false) {
		return {
			plan,
			reembedded,
			remoteSynced: 0,
			qualityDeferred,
		};
	}
	const remote = remoteEligibleIds.length > 0
		? await syncRemoteSemanticMirror({ ids: remoteEligibleIds, repairLocal: false })
		: { synced: 0 };
	return {
		plan,
		reembedded,
		remoteSynced: remote.synced,
		qualityDeferred,
	};
}
