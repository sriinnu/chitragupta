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
	if (args.loopProjects <= 0 && args.experimentProjects <= 0 && args.refinementScopes.length <= 0) return null;
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
			maxResearchProjectsPerCycle: Math.min(8, Math.max(1, Math.ceil(args.refinementScopes.length || 1))),
			maxSemanticPressure: Math.max(1, Math.ceil(pressure)),
		},
	};
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
	if (!active && !derived) return null;
	const activeRefinement = active?.refinement ?? null;
	const activeNidra = active?.nidra ?? null;
	const derivedRefinement = derived?.refinement ?? null;
	const derivedNidra = derived?.nidra ?? null;
	const takeWiderCap = (left?: number, right?: number): number | undefined => {
		if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
			return Math.max(left, right);
		}
		return typeof left === "number" && Number.isFinite(left)
			? left
			: typeof right === "number" && Number.isFinite(right)
				? right
				: undefined;
	};
	const takeWiderFloor = (left?: number, right?: number): number | undefined => {
		if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) {
			return Math.min(left, right);
		}
		return typeof left === "number" && Number.isFinite(left)
			? left
			: typeof right === "number" && Number.isFinite(right)
				? right
				: undefined;
	};
	return {
		refinement: {
			// Candidate limits are breadth caps, so the larger cap preserves the
			// most permissive already-authorized repair envelope.
			dailyCandidateLimit: takeWiderCap(activeRefinement?.dailyCandidateLimit, derivedRefinement?.dailyCandidateLimit),
			projectCandidateLimit: takeWiderCap(activeRefinement?.projectCandidateLimit, derivedRefinement?.projectCandidateLimit),
			// Minimum thresholds narrow the candidate set, so the lower floor is the
			// wider, already-approved repair envelope.
			dailyMinMdlScore: takeWiderFloor(activeRefinement?.dailyMinMdlScore, derivedRefinement?.dailyMinMdlScore),
			projectMinMdlScore: takeWiderFloor(activeRefinement?.projectMinMdlScore, derivedRefinement?.projectMinMdlScore),
			dailyMinPriorityScore: takeWiderFloor(activeRefinement?.dailyMinPriorityScore, derivedRefinement?.dailyMinPriorityScore),
			projectMinPriorityScore: takeWiderFloor(activeRefinement?.projectMinPriorityScore, derivedRefinement?.projectMinPriorityScore),
			dailyMinSourceSessionCount: takeWiderFloor(
				activeRefinement?.dailyMinSourceSessionCount,
				derivedRefinement?.dailyMinSourceSessionCount,
			),
			projectMinSourceSessionCount: takeWiderFloor(
				activeRefinement?.projectMinSourceSessionCount,
				derivedRefinement?.projectMinSourceSessionCount,
			),
		},
		nidra: {
			// Nidra budgets widen how much follow-on refinement this cycle may touch.
			// I preserve the higher limit once either path widened it.
			maxResearchProjectsPerCycle: takeWiderCap(
				activeNidra?.maxResearchProjectsPerCycle,
				derivedNidra?.maxResearchProjectsPerCycle,
			),
			maxSemanticPressure: takeWiderCap(activeNidra?.maxSemanticPressure, derivedNidra?.maxSemanticPressure),
		},
	};
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
}): DailyRefinementGovernorPlan {
	const effectiveBudget = mergeResearchBudgetState(
		args.activeBudget,
		derivePostprocessResearchBudget({
			loopProjects: args.loopProjects,
			experimentProjects: args.experimentProjects,
			refinementScopes: args.refinementScopes,
		}),
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
		queuedDrainLimit:
			typeof nidraBudget?.maxResearchProjectsPerCycle === "number"
				? Math.max(nidraBudget.maxResearchProjectsPerCycle - selected.length, 0)
				: null,
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
