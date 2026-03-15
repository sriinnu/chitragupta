import type {
	ResearchNidraBudgetOverride,
	ResearchRefinementBudgetOverride,
	ResearchRefinementBudgetState,
} from "@chitragupta/smriti";
import type { ResearchRefinementProjectScope } from "./chitragupta-daemon-research-scope.js";

/** One daemon-owned refinement phase in the daily postprocess order. */
export type DailyRefinementPhase =
	| "date-repair"
	| "research-repair"
	| "queued-repair"
	| "epoch-refresh";

/** Shared budget envelope that the daemon applies across one refinement cycle. */
export interface DailyRefinementBudgetEnvelope {
	refinement: ResearchRefinementBudgetOverride;
	nidra: ResearchNidraBudgetOverride | null;
}

/** One computed refinement-governor plan for a single daily daemon cycle. */
export interface DailyRefinementGovernorPlan {
	phases: DailyRefinementPhase[];
	effectiveBudget: DailyRefinementBudgetEnvelope | null;
	selectedScopes: ResearchRefinementProjectScope[];
	deferredScopes: ResearchRefinementProjectScope[];
	researchSignalCount: number;
	queuedDrainLimit: number | null;
}

/** Outcome-derived reasons that forced remote sync to stay blocked. */
export type DailyRefinementHoldReason =
	| "daily-quality-debt"
	| "research-quality-debt"
	| "queued-deferred"
	| "queued-carried-forward"
	| "queued-quality-debt"
	| "epoch-quality-debt"
	| "epoch-incomplete"
	| "epoch-freshness-incomplete";

function widerCap(left?: number, right?: number): number | undefined {
	if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
		return Math.max(left, right);
	}
	return typeof left === "number" && Number.isFinite(left)
		? left
		: typeof right === "number" && Number.isFinite(right)
			? right
			: undefined;
}

function widerFloor(left?: number, right?: number): number | undefined {
	if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
		return Math.min(left, right);
	}
	return typeof left === "number" && Number.isFinite(left)
		? left
		: typeof right === "number" && Number.isFinite(right)
			? right
			: undefined;
}

/**
 * Merge two daemon refinement envelopes while preserving the already-approved
 * wider repair surface.
 */
function mergeBudgetEnvelopes(
	left: DailyRefinementBudgetEnvelope | null,
	right: DailyRefinementBudgetEnvelope | null,
): DailyRefinementBudgetEnvelope | null {
	if (!left && !right) return null;
	const leftRefinement = left?.refinement ?? null;
	const rightRefinement = right?.refinement ?? null;
	const leftNidra = left?.nidra ?? null;
	const rightNidra = right?.nidra ?? null;
	return {
		refinement: {
			dailyCandidateLimit: widerCap(leftRefinement?.dailyCandidateLimit, rightRefinement?.dailyCandidateLimit),
			projectCandidateLimit: widerCap(leftRefinement?.projectCandidateLimit, rightRefinement?.projectCandidateLimit),
			dailyMinMdlScore: widerFloor(leftRefinement?.dailyMinMdlScore, rightRefinement?.dailyMinMdlScore),
			projectMinMdlScore: widerFloor(leftRefinement?.projectMinMdlScore, rightRefinement?.projectMinMdlScore),
			dailyMinPriorityScore: widerFloor(leftRefinement?.dailyMinPriorityScore, rightRefinement?.dailyMinPriorityScore),
			projectMinPriorityScore: widerFloor(leftRefinement?.projectMinPriorityScore, rightRefinement?.projectMinPriorityScore),
			dailyMinSourceSessionCount: widerFloor(
				leftRefinement?.dailyMinSourceSessionCount,
				rightRefinement?.dailyMinSourceSessionCount,
			),
			projectMinSourceSessionCount: widerFloor(
				leftRefinement?.projectMinSourceSessionCount,
				rightRefinement?.projectMinSourceSessionCount,
			),
		},
		nidra: {
			maxResearchProjectsPerCycle: widerCap(
				leftNidra?.maxResearchProjectsPerCycle,
				rightNidra?.maxResearchProjectsPerCycle,
			),
			maxSemanticPressure: widerCap(leftNidra?.maxSemanticPressure, rightNidra?.maxSemanticPressure),
		},
	};
}

function scoreResearchSemanticPressure(args: {
	loopProjects: number;
	experimentProjects: number;
	refinementProjects: number;
	refinementPriority: number;
}): number {
	return Math.min(
		8,
		Math.max(args.refinementProjects * 1.25, args.refinementPriority)
			+ Math.min(args.loopProjects, 2)
			+ Math.min(args.experimentProjects, 2),
	);
}

function roundBudgetThreshold(value: number): number {
	return Math.round(value * 100) / 100;
}

function deriveQueuedDrainLimit(
	nidraBudget: ResearchNidraBudgetOverride | null | undefined,
	selectedScopeCount: number,
	queuedDueScopes: number | undefined,
): number | null {
	const remainingSharedCap = typeof nidraBudget?.maxResearchProjectsPerCycle === "number"
		? Math.max(nidraBudget.maxResearchProjectsPerCycle - selectedScopeCount, 0)
		: null;
	if ((queuedDueScopes ?? 0) <= 0) return remainingSharedCap;
	const boundedQueueCap = Math.min(8, Math.max(1, queuedDueScopes ?? 0));
	if (remainingSharedCap == null) return boundedQueueCap;
	if (remainingSharedCap === 0) return 0;
	return Math.min(remainingSharedCap, boundedQueueCap);
}

/**
 * Derive one bounded daemon-wide refinement budget from the current daily
 * research digests.
 *
 * I treat this as reconstruction, not speculation. The daemon already has the
 * loop/project evidence for the day, so it should be able to rebuild a modest
 * repair envelope even if the original immediate loop callback was missed.
 */
function derivePostprocessResearchBudget(args: {
	loopProjects: number;
	experimentProjects: number;
	refinementScopes: readonly ResearchRefinementProjectScope[];
}): DailyRefinementBudgetEnvelope | null {
	if (
		args.loopProjects <= 0
		&& args.experimentProjects <= 0
		&& args.refinementScopes.length <= 0
	) return null;
	const strongestPriority = args.refinementScopes.reduce((best, scope) => {
		const priority = typeof scope.priorityScore === "number" ? scope.priorityScore : 0;
		return Math.max(best, priority);
	}, 0);
	const pressure = Math.min(
		8,
			scoreResearchSemanticPressure({
				loopProjects: args.loopProjects,
				experimentProjects: args.experimentProjects,
				refinementProjects: args.refinementScopes.length,
				refinementPriority: args.refinementScopes.reduce(
					(sum, scope) => sum + (typeof scope.priorityScore === "number" ? scope.priorityScore : 0),
					0,
				),
			}),
		);
	const widening = Math.max(1, Math.ceil(Math.max(strongestPriority, pressure)));
	return {
		refinement: {
			dailyCandidateLimit: Math.min(14, 4 + widening),
			projectCandidateLimit: Math.min(10, 3 + Math.max(1, Math.ceil(strongestPriority / 2))),
			dailyMinMdlScore: roundBudgetThreshold(Math.max(0.45, 0.52 - Math.min(widening * 0.02, 0.07))),
			projectMinMdlScore: roundBudgetThreshold(Math.max(0.45, 0.57 - Math.min(widening * 0.015, 0.06))),
			dailyMinPriorityScore: roundBudgetThreshold(Math.max(0.8, 1.35 - Math.min(widening * 0.08, 0.45))),
			projectMinPriorityScore: roundBudgetThreshold(Math.max(0.95, 1.5 - Math.min(widening * 0.07, 0.4))),
			dailyMinSourceSessionCount: 1,
			projectMinSourceSessionCount: strongestPriority >= 3 ? 1 : 2,
		},
		nidra: {
			maxResearchProjectsPerCycle: Math.min(
					8,
					Math.max(1, Math.ceil(args.refinementScopes.length || 1)),
				),
			maxSemanticPressure: Math.max(1, Math.ceil(pressure)),
		},
	};
}

/**
 * Rebuild the widest explicit loop-derived budget carried on research scopes.
 *
 * This lets deep-sleep and postprocess honor budgets recovered from overnight
 * summaries instead of treating scope metadata as advisory only.
 */
function deriveScopeBudgetEnvelope(
	scopes: readonly ResearchRefinementProjectScope[],
): DailyRefinementBudgetEnvelope | null {
	let envelope: DailyRefinementBudgetEnvelope | null = null;
	for (const scope of scopes) {
		if (!scope.refinementBudget && !scope.nidraBudget) continue;
		envelope = mergeBudgetEnvelopes(envelope, {
			refinement: scope.refinementBudget ?? {},
			nidra: scope.nidraBudget ?? null,
		});
	}
	return envelope;
}

/**
 * Merge one persisted budget with the postprocess-derived budget.
 *
 * I preserve the wider repair envelope across the immediate callback path and
 * the later daemon reconstruction. Once one path widened repair pressure, the
 * postprocess sweep should not silently tighten it again just because it ran
 * later.
 */
function mergeResearchBudgetState(
	active: ResearchRefinementBudgetState | null,
	derived: DailyRefinementBudgetEnvelope | null,
): DailyRefinementBudgetEnvelope | null {
	return mergeBudgetEnvelopes(
		active
			? {
				refinement: active.refinement,
				nidra: active.nidra ?? null,
			}
			: null,
		derived,
	);
}

/**
 * Bound the set of project-scoped research refinements that one daemon cycle
 * is allowed to widen into.
 */
function applyNidraProjectBudget(
	scopes: ResearchRefinementProjectScope[],
	maxProjectsPerCycle: number | null,
): {
	selected: ResearchRefinementProjectScope[];
	deferred: ResearchRefinementProjectScope[];
} {
	const sortedScopes = [...scopes].sort((left, right) => {
		// I spend the bounded Nidra budget on the strongest daemon-owned
		// refinement pressure first, not just in lexical project order.
		const leftPriority = typeof left.priorityScore === "number" ? left.priorityScore : 0;
		const rightPriority = typeof right.priorityScore === "number" ? right.priorityScore : 0;
		return rightPriority - leftPriority || left.projectPath.localeCompare(right.projectPath);
	});
	if (!maxProjectsPerCycle || maxProjectsPerCycle <= 0) {
		return { selected: sortedScopes, deferred: [] };
	}
	return {
		selected: sortedScopes.slice(0, maxProjectsPerCycle),
		deferred: sortedScopes.slice(maxProjectsPerCycle),
	};
}

/**
 * Build one explicit governor plan for the daily refinement phases.
 *
 * I keep the phase order fixed so every daemon cycle uses the same healing
 * sequence: local date repair first, then project-scoped repair, then deferred
 * queue replay, and only after that the broader epoch refresh.
 */
export function buildDailyRefinementGovernorPlan(args: {
	loopProjects: number;
	experimentProjects: number;
	refinementScopes: ResearchRefinementProjectScope[];
	activeBudget: ResearchRefinementBudgetState | null;
	queuedDueScopes?: number;
}): DailyRefinementGovernorPlan {
	const scopeBudget = deriveScopeBudgetEnvelope(args.refinementScopes);
	const effectiveBudget = mergeResearchBudgetState(
		args.activeBudget,
		mergeBudgetEnvelopes(
			derivePostprocessResearchBudget({
				loopProjects: args.loopProjects,
				experimentProjects: args.experimentProjects,
				refinementScopes: args.refinementScopes,
			}),
			scopeBudget,
		),
	);
	const nidraBudget = effectiveBudget?.nidra ?? null;
	const { selected, deferred } = applyNidraProjectBudget(
		args.refinementScopes,
		typeof nidraBudget?.maxResearchProjectsPerCycle === "number"
			? nidraBudget.maxResearchProjectsPerCycle
			: null,
	);
	const researchSignalCount = Math.min(
		// I collapse research activity into one bounded semantic-pressure signal so
		// repair can widen predictably without one noisy day blowing out policy.
		scoreResearchSemanticPressure({
			loopProjects: args.loopProjects,
			experimentProjects: args.experimentProjects,
			refinementProjects: selected.length,
			refinementPriority: selected.reduce(
				(sum, scope) => sum + (typeof scope.priorityScore === "number" ? scope.priorityScore : 0),
				0,
			),
		}),
		typeof nidraBudget?.maxSemanticPressure === "number"
			? nidraBudget.maxSemanticPressure
			: Number.POSITIVE_INFINITY,
	);
	return {
		phases: ["date-repair", "research-repair", "queued-repair", "epoch-refresh"],
		effectiveBudget,
		selectedScopes: selected,
		deferredScopes: deferred,
		researchSignalCount,
		queuedDrainLimit: deriveQueuedDrainLimit(nidraBudget, selected.length, args.queuedDueScopes),
	};
}

/**
 * Explain why the daemon refused to publish remote semantic sync after local
 * refinement finished.
 */
export function collectDailyRefinementHoldReasons(args: {
	semanticQualityDeferred: number;
	researchQualityDeferred: number;
	queuedDeferred: number;
	queuedRemainingDue: number;
	queuedCarriedForward: number;
	queuedQualityDeferred: number;
	epochQualityDebtCount: number;
	epochCompleted: boolean;
	epochFreshnessCompleted: boolean;
}): DailyRefinementHoldReason[] {
	const reasons: DailyRefinementHoldReason[] = [];
	if (args.semanticQualityDeferred > 0) reasons.push("daily-quality-debt");
	if (args.researchQualityDeferred > 0) reasons.push("research-quality-debt");
	if (args.queuedDeferred > 0 || args.queuedRemainingDue > 0) reasons.push("queued-deferred");
	if (args.queuedCarriedForward > 0) reasons.push("queued-carried-forward");
	if (args.queuedQualityDeferred > 0) reasons.push("queued-quality-debt");
	if (args.epochQualityDebtCount > 0) reasons.push("epoch-quality-debt");
	if (!args.epochCompleted) reasons.push("epoch-incomplete");
	if (!args.epochFreshnessCompleted) reasons.push("epoch-freshness-incomplete");
	return reasons;
}
