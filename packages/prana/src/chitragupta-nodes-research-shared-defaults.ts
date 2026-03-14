/**
 * Default optimizer and subsystem-budget policies for bounded research loops.
 */

import {
	DEFAULT_NO_IMPROVEMENT_STOP,
	DEFAULT_PACKING_CARRY_CONTEXT_CHARS,
	DEFAULT_PACKING_STDERR_CHARS,
	DEFAULT_PACKING_STDOUT_CHARS,
	DEFAULT_PACKING_CARRY_CONTEXT_CHARS as DEFAULT_RETRIEVAL_REUSE_CHARS,
	DEFAULT_REFINEMENT_DAILY_CANDIDATE_LIMIT,
	DEFAULT_REFINEMENT_DAILY_MIN_MDL_SCORE,
	DEFAULT_REFINEMENT_DAILY_MIN_PRIORITY_SCORE,
	DEFAULT_REFINEMENT_DAILY_MIN_SOURCE_SESSION_COUNT,
	DEFAULT_REFINEMENT_PROJECT_CANDIDATE_LIMIT,
	DEFAULT_REFINEMENT_PROJECT_MIN_MDL_SCORE,
	DEFAULT_REFINEMENT_PROJECT_MIN_PRIORITY_SCORE,
	DEFAULT_REFINEMENT_PROJECT_MIN_SOURCE_SESSION_COUNT,
	type ResearchObjectiveSpec,
	type ResearchStopConditionSpec,
	type ResearchUpdateBudgets,
} from "./chitragupta-nodes-research-shared-types.js";

/**
 * Build the default optimizer registry for the overnight loop.
 *
 * I keep the defaults small and measurable: experiment quality, runtime cost,
 * context compactness, and execution stability. Anything more abstract should
 * prove itself with a benchmark before it becomes a first-class objective.
 */
export function buildDefaultResearchObjectives(): ResearchObjectiveSpec[] {
	return [
		{
			id: "metric-improvement",
			label: "Metric Improvement",
			metric: "metric-improvement",
			weight: 1.6,
			threshold: 0,
			enabled: true,
		},
		{
			id: "duration-efficiency",
			label: "Duration Efficiency",
			metric: "duration-efficiency",
			weight: 0.7,
			enabled: true,
		},
		{
			id: "packing-efficiency",
			label: "Packing Efficiency",
			metric: "packing-efficiency",
			weight: 0.45,
			enabled: true,
		},
		{
			id: "stability",
			label: "Execution Stability",
			metric: "stability",
			weight: 1.1,
			threshold: 0.5,
			enabled: true,
		},
	];
}

/** Build the default stop-condition registry for a bounded research loop. */
export function buildDefaultResearchStopConditions(maxRounds: number): ResearchStopConditionSpec[] {
	return [
		{
			id: "max-rounds",
			kind: "max-rounds",
			threshold: maxRounds,
			enabled: true,
		},
		{
			id: "budget-exhausted",
			kind: "budget-exhausted",
			enabled: true,
		},
		{
			id: "no-improvement",
			kind: "no-improvement",
			patience: Math.max(1, Math.min(maxRounds, DEFAULT_NO_IMPROVEMENT_STOP)),
			enabled: true,
		},
		{
			id: "pareto-stagnation",
			kind: "pareto-stagnation",
			patience: Math.max(2, Math.min(maxRounds, DEFAULT_NO_IMPROVEMENT_STOP + 1)),
			enabled: false,
		},
	];
}

/**
 * Build default subsystem budgets for packing and semantic refinement.
 *
 * I keep these explicit so nightly loops can tune how much they are allowed to
 * mutate each subsystem without sprinkling raw numbers across the runtime.
 */
export function buildDefaultResearchUpdateBudgets(): ResearchUpdateBudgets {
	return {
		packing: {
			maxStdoutChars: DEFAULT_PACKING_STDOUT_CHARS,
			maxStderrChars: DEFAULT_PACKING_STDERR_CHARS,
			maxCarryContextChars: DEFAULT_PACKING_CARRY_CONTEXT_CHARS,
		},
		retrieval: {
			// I keep retrieval slightly tighter than the raw carry envelope so one
			// round cannot stuff the next prompt with more reused context than it
			// can actually reason over coherently.
			maxReuseChars: Math.max(4_000, Math.floor(DEFAULT_RETRIEVAL_REUSE_CHARS * 0.75)),
			maxFrontierEntries: 4,
		},
		refinement: {
			dailyCandidateLimit: DEFAULT_REFINEMENT_DAILY_CANDIDATE_LIMIT,
			projectCandidateLimit: DEFAULT_REFINEMENT_PROJECT_CANDIDATE_LIMIT,
			dailyMinMdlScore: DEFAULT_REFINEMENT_DAILY_MIN_MDL_SCORE,
			projectMinMdlScore: DEFAULT_REFINEMENT_PROJECT_MIN_MDL_SCORE,
			dailyMinPriorityScore: DEFAULT_REFINEMENT_DAILY_MIN_PRIORITY_SCORE,
			projectMinPriorityScore: DEFAULT_REFINEMENT_PROJECT_MIN_PRIORITY_SCORE,
			dailyMinSourceSessionCount: DEFAULT_REFINEMENT_DAILY_MIN_SOURCE_SESSION_COUNT,
			projectMinSourceSessionCount: DEFAULT_REFINEMENT_PROJECT_MIN_SOURCE_SESSION_COUNT,
		},
		nidra: {
			// I cap nightly follow-up to a small project set so one overnight loop
			// cannot monopolize the daemon-wide refinement pass.
			maxResearchProjectsPerCycle: 3,
			maxSemanticPressure: 6,
		},
	};
}
