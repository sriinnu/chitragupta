import {
	MIN_SUMMARY_MDL_SCORE,
} from "./mdl-compaction.js";
import type {
	ConsolidationVectorSyncIssue,
	CuratedConsolidationArtifact,
} from "./consolidation-indexer.js";
import type {
	LocalSelectiveReembeddingReason,
	SelectiveReembeddingCandidate,
	SelectiveReembeddingReason,
} from "./selective-reembedding.js";
import type { RemoteSemanticSyncIssue } from "./remote-semantic-sync.js";

/**
 * Return true when the selected reasons demand a quality-led rebuild rather
 * than a pure freshness-only vector refresh.
 */
export function hasQualityRepairReason(
	reasons: ReadonlyArray<SelectiveReembeddingReason | LocalSelectiveReembeddingReason>,
): boolean {
	return (
		reasons.includes("low_mdl")
		|| reasons.includes("rejected_packed")
		|| reasons.includes("low_retention")
	);
}

/** Return true when the selected reasons are freshness or epoch drift driven. */
export function hasFreshnessRepairReason(
	reasons: ReadonlyArray<SelectiveReembeddingReason | LocalSelectiveReembeddingReason>,
): boolean {
	return (
		reasons.includes("missing_vector")
		|| reasons.includes("legacy_vector")
		|| reasons.includes("stale_hash")
		|| reasons.includes("stale_epoch")
		|| reasons.includes("stale_remote_epoch")
		|| reasons.includes("missing_remote")
		|| reasons.includes("stale_remote")
		|| reasons.includes("remote_error")
	);
}

/** Quality rebuilds only happen on severe quality debt, not every watch signal. */
export function hasQualityRebuildReason(
	reasons: ReadonlyArray<SelectiveReembeddingReason | LocalSelectiveReembeddingReason>,
): boolean {
	return (
		reasons.includes("low_mdl")
		|| reasons.includes("rejected_packed")
		|| reasons.includes("low_retention")
	);
}

/** Decide whether one candidate requires an artifact rebuild before reindexing. */
export function requiresQualityRefresh(
	candidate: Pick<SelectiveReembeddingCandidate, "localReasons">,
): boolean {
	return hasQualityRebuildReason(candidate.localReasons);
}

/** Group one issue list by artifact id for cheap ranked frontier scoring. */
export function buildIssueMap<T extends { id: string }>(
	issues: readonly T[],
): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const issue of issues) {
		const bucket = map.get(issue.id) ?? [];
		bucket.push(issue);
		map.set(issue.id, bucket);
	}
	return map;
}

/** Normalize the optional reason filter into a cheap membership set. */
export function normalizeReasonFilter(
	reasons: readonly SelectiveReembeddingReason[] | undefined,
): Set<SelectiveReembeddingReason> | null {
	if (!reasons || reasons.length === 0) return null;
	const filtered = reasons.filter((reason): reason is SelectiveReembeddingReason => typeof reason === "string");
	return filtered.length > 0 ? new Set(filtered) : null;
}

function roundScore(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function levelWeight(level: CuratedConsolidationArtifact["level"]): number {
	switch (level) {
		case "yearly":
			return 1.35;
		case "monthly":
			return 1.2;
		default:
			return 1;
	}
}

/**
 * Return true when the artifact-level MDL disposition already says the summary
 * needs repair even if freshness drift has not shown up yet.
 */
export function hasCompactionRepairDisposition(
	artifact: Pick<CuratedConsolidationArtifact, "compactionDecision">,
): boolean {
	return artifact.compactionDecision.disposition === "repair";
}

/**
 * Return true when the compaction layer is warning about borderline quality
 * without crossing into mandatory rebuild territory.
 */
export function hasCompactionWatchDisposition(
	artifact: Pick<CuratedConsolidationArtifact, "compactionDecision">,
): boolean {
	return artifact.compactionDecision.disposition === "watch";
}

/**
 * Score one repair candidate from freshness drift, provenance weight, and MDL
 * quality pressure.
 */
export function scoreCandidate(
	artifact: CuratedConsolidationArtifact,
	localReasons: Array<LocalSelectiveReembeddingReason>,
	remoteReasons: Array<RemoteSemanticSyncIssue["reason"]>,
): number {
	const sourceSessionCount = artifact.provenance.sourceSessionIds.length;
	const sourcePeriodCount =
		"sourcePeriods" in artifact.provenance && Array.isArray(artifact.provenance.sourcePeriods)
			? artifact.provenance.sourcePeriods.length
			: 0;
	const localEpochDrift = localReasons.includes("stale_epoch");
	const remoteEpochDrift = remoteReasons.includes("stale_remote_epoch");
	const bothSidesDrift = localEpochDrift && remoteEpochDrift;
	const lowMdl = localReasons.includes("low_mdl");
	const rejectedPacked = localReasons.includes("rejected_packed");
	const repairDisposition = hasCompactionRepairDisposition(artifact);
	const watchDisposition = hasCompactionWatchDisposition(artifact);
	const mdlDeficit = 1 - artifact.mdlMetrics.mdlScore;
	// I weight retention/repair pressure above pure size reduction because a
	// semantically useful artifact is worth more than an aggressively small one
	// that has already lost recall value.
	const priorityBase =
		levelWeight(artifact.level)
		+ Math.min(sourceSessionCount, 24) * 0.08
		+ Math.min(sourcePeriodCount, 12) * 0.05
		+ artifact.mdlMetrics.mdlScore
		+ (bothSidesDrift ? 0.5 : localEpochDrift || remoteEpochDrift ? 0.25 : 0)
		+ (lowMdl ? Math.max(0.45, mdlDeficit) : 0)
		+ (rejectedPacked ? 0.35 : 0)
		+ (repairDisposition ? 0.4 : watchDisposition ? 0.15 : 0);
	return roundScore(priorityBase);
}

/**
 * Derive stable quality reasons from the curated artifact metadata.
 *
 * I expose only the reasons that should influence repair ranking. Diagnostic
 * low-reduction signals stay lower-priority than retention or outright MDL debt.
 */
export function deriveArtifactQualityReasons(
	artifact: CuratedConsolidationArtifact,
): Array<LocalSelectiveReembeddingReason> {
	const reasons: Array<LocalSelectiveReembeddingReason> = [];
	const summaryNeedsRepair = (
		artifact.compactionDecision.reason === "low_mdl"
		|| artifact.compactionDecision.reason === "low_retention"
		|| artifact.compactionDecision.reason === "low_reduction"
		|| (
			artifact.compactionDecision.disposition === "repair"
			&& artifact.mdlMetrics.mdlScore < MIN_SUMMARY_MDL_SCORE
		)
	);
	if (summaryNeedsRepair) {
		if (
			artifact.compactionDecision.reason === "low_mdl"
			|| artifact.compactionDecision.reason === "low_retention"
			|| (
				artifact.compactionDecision.disposition === "repair"
				&& artifact.mdlMetrics.mdlScore < MIN_SUMMARY_MDL_SCORE
			)
		) {
			reasons.push("low_mdl");
		}
		if (artifact.compactionDecision.reason === "low_retention") {
			reasons.push("low_retention");
		}
		if (artifact.compactionDecision.reason === "low_reduction") {
			reasons.push("low_reduction");
		}
	}
	if (artifact.packedDecision && !artifact.packedDecision.accepted) {
		reasons.push("rejected_packed");
		if (artifact.packedDecision.reason === "low_retention") {
			reasons.push("low_retention");
		}
		if (artifact.packedDecision.reason === "low_reduction") {
			reasons.push("low_reduction");
		}
		if (artifact.packedDecision.reason === "low_mdl") {
			reasons.push("low_mdl");
		}
	}
	return [...new Set(reasons)];
}
