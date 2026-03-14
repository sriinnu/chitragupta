import { createHash } from "node:crypto";
import type { CuratedConsolidationArtifact } from "./consolidation-indexer.js";
import { MIN_SUMMARY_MDL_SCORE } from "./mdl-compaction.js";

/**
 * Promotion decision for one curated artifact entering the remote semantic
 * mirror.
 *
 * I keep this explicit so callers can separate local-quality debt from remote
 * freshness debt instead of inferring intent from booleans alone.
 */
export interface RemoteSemanticPromotionDecision {
	eligible: boolean;
	reason: "eligible" | "deferred_quality";
}

/**
 * Build a stable quality fingerprint for a curated artifact.
 *
 * The remote mirror uses this to detect when local compaction quality changed
 * even if the human-readable summary text stayed the same.
 */
export function buildArtifactQualityHash(artifact: CuratedConsolidationArtifact): string {
	const payload = JSON.stringify({
		mdlMetrics: artifact.mdlMetrics,
		compactionDecision: artifact.compactionDecision,
		packedDecision: artifact.packedDecision,
		embeddingInputHash: artifact.embeddingInputHash,
		packedSummaryText: artifact.packedSummaryText ?? null,
		compression: artifact.compression ?? null,
	});
	return createHash("sha1").update(payload).digest("hex");
}

/**
 * Decide whether a curated artifact is healthy enough to promote into the
 * remote semantic mirror.
 *
 * I only defer artifacts that the local MDL gate already marked for repair.
 * "watch" artifacts still sync, because they remain serviceable for recall
 * and should not be treated as freshness failures.
 */
export function getRemoteSemanticPromotionDecision(
	artifact: CuratedConsolidationArtifact,
): RemoteSemanticPromotionDecision {
	const severeSummaryQualityDebt = (
		artifact.compactionDecision.reason === "low_mdl"
		|| artifact.compactionDecision.reason === "low_retention"
		|| artifact.mdlMetrics.mdlScore < MIN_SUMMARY_MDL_SCORE
	);
	const severePackedQualityDebt = Boolean(
		artifact.packedDecision
		&& !artifact.packedDecision.accepted
		&& (
			artifact.packedDecision.reason === "low_mdl"
			|| artifact.packedDecision.reason === "low_retention"
		),
	);
	if (severeSummaryQualityDebt || severePackedQualityDebt) {
		return {
			eligible: false,
			reason: "deferred_quality",
		};
	}
	return {
		eligible: true,
		reason: "eligible",
	};
}
