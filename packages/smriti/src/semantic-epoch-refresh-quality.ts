import {
	planSelectiveReembedding,
	repairSelectiveReembedding,
	type SelectiveReembeddingReason,
	type SelectiveReembeddingRepairResult,
} from "./selective-reembedding.js";
import {
	buildQualityDebtRepairPolicy,
	type ResearchRefinementBudgetOverride,
} from "./semantic-refinement-policy.js";

export const GLOBAL_SEMANTIC_QUALITY_REASONS = [
	"low_mdl",
	"low_retention",
	"low_reduction",
	"rejected_packed",
	"stale_remote_quality",
] as const;

export const LOCAL_SEMANTIC_QUALITY_REASONS = GLOBAL_SEMANTIC_QUALITY_REASONS.filter((reason) =>
	!reason.startsWith("stale_remote"),
) as SelectiveReembeddingReason[];

/**
 * Count the current semantic quality debt backlog without mutating the mirror.
 *
 * This is separate from freshness drift: low-MDL or low-retention artifacts
 * can remain even after the active embedding epoch is fully healed.
 */
export async function planSemanticQualityDebt(
	remoteEnabled: boolean,
	options: {
		override?: ResearchRefinementBudgetOverride | null;
		pressure?: number;
	} = {},
): Promise<number> {
	const policy = buildQualityDebtRepairPolicy(options);
	const qualityPlan = await planSelectiveReembedding({
		scanAll: true,
		candidateLimit: policy.candidateLimit,
		reasons: remoteEnabled ? GLOBAL_SEMANTIC_QUALITY_REASONS : LOCAL_SEMANTIC_QUALITY_REASONS,
		resyncRemote: false,
		minMdlScore: policy.minMdlScore,
		minSourceSessionCount: policy.minSourceSessionCount,
		minPriorityScore: policy.minPriorityScore,
	});
	return qualityPlan.candidateCount;
}

/**
 * Repair a bounded slice of semantic quality debt.
 *
 * I keep this separate from epoch freshness repair so the daemon can improve
 * low-value summaries gradually without rewriting the entire mirror on every
 * periodic pass.
 */
export async function repairSemanticQualityDebt(
	remoteEnabled: boolean,
	options: {
		override?: ResearchRefinementBudgetOverride | null;
		pressure?: number;
	} = {},
): Promise<SelectiveReembeddingRepairResult> {
	const policy = buildQualityDebtRepairPolicy(options);
	return await repairSelectiveReembedding({
		scanAll: true,
		candidateLimit: policy.candidateLimit,
		reasons: [...(remoteEnabled ? GLOBAL_SEMANTIC_QUALITY_REASONS : LOCAL_SEMANTIC_QUALITY_REASONS)],
		resyncRemote: remoteEnabled,
		minMdlScore: policy.minMdlScore,
		minSourceSessionCount: policy.minSourceSessionCount,
		minPriorityScore: policy.minPriorityScore,
	});
}
