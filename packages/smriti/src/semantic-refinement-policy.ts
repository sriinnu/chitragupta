import {
	MIN_SUMMARY_MDL_SCORE,
	WATCH_SUMMARY_MDL_SCORE,
} from "./mdl-compaction.js";

/** One temporal scope that the daemon can repair selectively. */
export type TemporalReembeddingLevel = "daily" | "monthly" | "yearly";

/** Full selective-reembedding reason set used by daemon-owned repair paths. */
export type SemanticRepairReason =
	| "stale_epoch"
	| "stale_remote_epoch"
	| "low_mdl"
	| "rejected_packed"
	| "low_retention"
	| "low_reduction";

/**
 * Optional per-loop budget overrides persisted in research loop state.
 *
 * I keep the override schema in Smriti because both the daemon's immediate
 * research repair path and Anina's daily semantic refinement must agree on the
 * same knobs.
 */
export interface ResearchRefinementBudgetOverride {
	dailyCandidateLimit?: number;
	projectCandidateLimit?: number;
	dailyMinMdlScore?: number;
	projectMinMdlScore?: number;
	dailyMinPriorityScore?: number;
	projectMinPriorityScore?: number;
	dailyMinSourceSessionCount?: number;
	projectMinSourceSessionCount?: number;
}

type TemporalRepairPolicy = {
	candidateLimit: number;
	minMdlScore: number;
	minSourceSessionCount: number;
	minPriorityScore: number;
};

/** Shared policy shape for one bounded same-epoch semantic quality-debt pass. */
export interface QualityDebtRepairPolicy {
	candidateLimit: number;
	minMdlScore: number;
	minSourceSessionCount: number;
	minPriorityScore: number;
}

const REEMBED_REASONS_BY_LEVEL: Record<
	TemporalReembeddingLevel,
	readonly SemanticRepairReason[]
> = {
	daily: [
		"stale_epoch",
		"stale_remote_epoch",
		"low_mdl",
		"rejected_packed",
		"low_retention",
		"low_reduction",
	],
	monthly: ["stale_epoch", "stale_remote_epoch"],
	yearly: ["stale_epoch", "stale_remote_epoch"],
};

const TEMPORAL_REEMBED_POLICY: Record<
	TemporalReembeddingLevel,
	TemporalRepairPolicy
> = {
	daily: {
		candidateLimit: 12,
		minMdlScore: WATCH_SUMMARY_MDL_SCORE,
		minSourceSessionCount: 1,
		minPriorityScore: 1.65,
	},
	monthly: {
		candidateLimit: 6,
		minMdlScore: roundThreshold(WATCH_SUMMARY_MDL_SCORE + 0.05),
		minSourceSessionCount: 2,
		minPriorityScore: 1.9,
	},
	yearly: {
		candidateLimit: 3,
		minMdlScore: roundThreshold(WATCH_SUMMARY_MDL_SCORE + 0.1),
		minSourceSessionCount: 4,
		minPriorityScore: 2.15,
	},
};

function roundThreshold(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Build the bounded policy for one same-epoch semantic quality-debt pass.
 *
 * I derive this from the persisted research refinement override so the daemon's
 * background self-heal path uses the same operator-approved repair envelope as
 * the immediate post-round repair path. Quality debt pressure can widen the
 * frontier slightly, but never without staying inside a hard cap.
 */
export function buildQualityDebtRepairPolicy(args: {
	override?: ResearchRefinementBudgetOverride | null;
	pressure?: number;
} = {}): QualityDebtRepairPolicy {
	const override = args.override ?? null;
	const pressure = Math.max(0, Math.floor(args.pressure ?? 0));
	const dailyCandidateLimit = override?.dailyCandidateLimit ?? TEMPORAL_REEMBED_POLICY.daily.candidateLimit;
	const projectCandidateLimit = override?.projectCandidateLimit ?? TEMPORAL_REEMBED_POLICY.monthly.candidateLimit;
	const baseMinMdl = Math.min(
		override?.dailyMinMdlScore ?? TEMPORAL_REEMBED_POLICY.daily.minMdlScore,
		override?.projectMinMdlScore ?? TEMPORAL_REEMBED_POLICY.monthly.minMdlScore,
	);
	const baseMinSourceSessionCount = Math.max(
		1,
		Math.min(
			override?.dailyMinSourceSessionCount ?? TEMPORAL_REEMBED_POLICY.daily.minSourceSessionCount,
			override?.projectMinSourceSessionCount ?? TEMPORAL_REEMBED_POLICY.monthly.minSourceSessionCount,
		),
	);
	const baseMinPriorityScore = Math.min(
		override?.dailyMinPriorityScore ?? TEMPORAL_REEMBED_POLICY.daily.minPriorityScore,
		override?.projectMinPriorityScore ?? TEMPORAL_REEMBED_POLICY.monthly.minPriorityScore,
	);
	return {
		candidateLimit: Math.max(8, Math.min(48, dailyCandidateLimit + projectCandidateLimit + Math.min(pressure, 12))),
		minMdlScore: roundThreshold(
			Math.max(MIN_SUMMARY_MDL_SCORE, baseMinMdl - (pressure > 0 ? Math.min(pressure * 0.01, 0.08) : 0)),
		),
		minSourceSessionCount: baseMinSourceSessionCount,
		minPriorityScore: roundThreshold(
			Math.max(0, baseMinPriorityScore - (pressure > 0 ? Math.min(pressure * 0.04, 0.4) : 0)),
		),
	};
}

/**
 * Decide which semantic-repair reasons matter for one temporal level.
 *
 * Daily repair always watches quality debt. Higher periods stay freshness-led
 * unless current research pressure is strong enough to justify widening the
 * repair frontier.
 */
export function semanticRepairReasonsForLevel(
	level: TemporalReembeddingLevel,
	researchSignalCount = 0,
): SemanticRepairReason[] {
	if (level === "daily" || researchSignalCount > 0) {
		return [
			...new Set<SemanticRepairReason>([
				...REEMBED_REASONS_BY_LEVEL[level],
				"low_mdl",
				"rejected_packed",
				"low_retention",
				"low_reduction",
			]),
		];
	}
	return [...REEMBED_REASONS_BY_LEVEL[level]];
}

/**
 * Build the daemon-owned selective-reembedding request for one temporal scope.
 *
 * I derive the MDL thresholds from the shared compaction policy so semantic
 * repair and compaction health use the same baseline for "healthy" and
 * "repair-worthy" artifacts.
 */
export function buildTemporalSelectiveReembeddingRequest(args: {
	level: TemporalReembeddingLevel;
	date: string;
	researchSignalCount?: number;
	projects?: string[];
	periods?: string[];
	override?: ResearchRefinementBudgetOverride | null;
}): Record<string, unknown> {
	const { level, date } = args;
	const researchSignalCount = args.researchSignalCount ?? 0;
	const qualityPressure = researchSignalCount > 0;
	const policy = TEMPORAL_REEMBED_POLICY[level];
	const override = args.override ?? null;
	const candidateLimitOverride = level === "daily"
		? override?.dailyCandidateLimit
		: override?.projectCandidateLimit;
	const minMdlScoreOverride = level === "daily"
		? override?.dailyMinMdlScore
		: override?.projectMinMdlScore;
	const minSourceSessionCountOverride = level === "daily"
		? override?.dailyMinSourceSessionCount
		: override?.projectMinSourceSessionCount;
	const minPriorityScoreOverride = level === "daily"
		? override?.dailyMinPriorityScore
		: override?.projectMinPriorityScore;
	const candidateLimit =
		candidateLimitOverride
		?? (
			policy.candidateLimit
			+ (qualityPressure ? Math.min(researchSignalCount, level === "daily" ? 6 : 2) : 0)
		);
	// Daily repair can widen down to the hard repair threshold. Longer periods
	// stay slightly more conservative so one noisy loop does not rewrite the
	// whole historical horizon.
	const minMdlScore =
		minMdlScoreOverride
		?? (
			level === "daily"
				? roundThreshold(Math.max(MIN_SUMMARY_MDL_SCORE, policy.minMdlScore - (qualityPressure ? 0.1 : 0)))
				: roundThreshold(
						Math.max(MIN_SUMMARY_MDL_SCORE + 0.05, policy.minMdlScore - (qualityPressure ? 0.05 : 0)),
					)
		);
	const minPriorityScore =
		minPriorityScoreOverride
		?? roundThreshold(
			Math.max(0, policy.minPriorityScore - (qualityPressure ? 0.3 : 0)),
		);
	const minSourceSessionCount = minSourceSessionCountOverride ?? policy.minSourceSessionCount;
	const periods =
		level === "daily"
			? undefined
			: [...(args.periods ?? [level === "monthly" ? date.slice(0, 7) : date.slice(0, 4)])];
	const baseRequest: Record<string, unknown> = {
		levels: [level],
		candidateLimit,
		reasons: semanticRepairReasonsForLevel(level, researchSignalCount),
		minMdlScore,
		minSourceSessionCount,
		minPriorityScore,
		resyncRemote: qualityPressure,
	};
	if (args.projects?.length) baseRequest.projects = [...args.projects];
	if (level === "daily") {
		baseRequest.dates = [date];
		return baseRequest;
	}
	baseRequest.periods = periods;
	return baseRequest;
}

/**
 * Build the immediate post-round repair requests for the touched day and
 * project scopes.
 *
 * I keep this separate from the temporal helper because the overnight loop has
 * a narrower, operator-controlled budget surface than the daemon's broader
 * daily refinement pass.
 */
export function buildImmediateResearchRefinementRequests(args: {
	projectPath: string;
	date: string;
	elevatedSignal: boolean;
	override?: ResearchRefinementBudgetOverride | null;
}): {
	daily: Record<string, unknown>;
	project: Record<string, unknown>;
} {
	const budget = args.override ?? null;
	const projectResearchSignal = args.elevatedSignal ? 1 : 0;
	const monthly = buildTemporalSelectiveReembeddingRequest({
		level: "monthly",
		date: args.date,
		researchSignalCount: projectResearchSignal,
		projects: [args.projectPath],
		periods: [args.date.slice(0, 7)],
		override: budget,
	});
	const yearly = buildTemporalSelectiveReembeddingRequest({
		level: "yearly",
		date: args.date,
		researchSignalCount: projectResearchSignal,
		projects: [args.projectPath],
		periods: [args.date.slice(0, 4)],
		override: budget,
	});
	return {
		daily: {
			dates: [args.date],
			levels: ["daily"],
			candidateLimit: budget?.dailyCandidateLimit ?? (args.elevatedSignal ? 8 : 4),
			reasons: semanticRepairReasonsForLevel("daily", 1),
			minMdlScore:
				budget?.dailyMinMdlScore
				?? (args.elevatedSignal
					? roundThreshold(Math.max(0.4, MIN_SUMMARY_MDL_SCORE - 0.05))
					: roundThreshold(Math.max(0.5, MIN_SUMMARY_MDL_SCORE + 0.05))),
			minSourceSessionCount: budget?.dailyMinSourceSessionCount ?? 1,
			minPriorityScore: budget?.dailyMinPriorityScore ?? (args.elevatedSignal ? 1.1 : 1.35),
			resyncRemote: true,
		},
		// I derive the broader monthly/yearly request from the same temporal helper
		// the daemon uses in its normal sweep so "immediate research repair" does
		// not silently adopt a looser project horizon than the background daemon
		// path for the same semantic debt.
		project: {
			projects: [args.projectPath],
			levels: ["monthly", "yearly"],
			periods: [args.date.slice(0, 7), args.date.slice(0, 4)],
			candidateLimit: Math.max(
				monthly.candidateLimit as number,
				yearly.candidateLimit as number,
			),
			reasons: [
				...new Set<SemanticRepairReason>([
					...monthly.reasons as SemanticRepairReason[],
					...yearly.reasons as SemanticRepairReason[],
				]),
			],
			minMdlScore: Math.min(
				monthly.minMdlScore as number,
				yearly.minMdlScore as number,
			),
			minSourceSessionCount: Math.min(
				monthly.minSourceSessionCount as number,
				yearly.minSourceSessionCount as number,
			),
			minPriorityScore: Math.min(
				monthly.minPriorityScore as number,
				yearly.minPriorityScore as number,
			),
			resyncRemote: Boolean(monthly.resyncRemote || yearly.resyncRemote),
		},
	};
}
