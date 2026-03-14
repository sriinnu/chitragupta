/**
 * Shared research workflow types and stable defaults.
 */

import type { ResearchResolvedRouteSummary } from "./chitragupta-nodes-research-records.js";

/** Default mutable files for Karpathy-style bounded research scopes. */
export const DEFAULT_TARGET_FILES = ["train.py"];
/** Default immutable files that a bounded research loop must not modify. */
export const DEFAULT_IMMUTABLE_FILES = ["prepare.py"];
/** Default primary metric name used by the overnight loop. */
export const DEFAULT_METRIC_NAME = "val_bpb";
/** Default regex used to extract the primary metric from run logs. */
export const DEFAULT_METRIC_PATTERN = "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)";
/** Default per-round execution budget for one bounded research attempt. */
export const DEFAULT_BUDGET_MS = 300_000;
/** Hard cap on per-round execution budget, regardless of caller input. */
export const MAX_BUDGET_MS = 300_000;
/** Default engine lane used by the planner/council side of the loop. */
export const DEFAULT_PLANNER_ROUTE_CLASS = "coding.deep-reasoning";
/** Default maximum number of overnight rounds before forced stop. */
export const DEFAULT_OVERNIGHT_ROUNDS = 6;
/** Default number of council/worker participants requested by the loop. */
export const DEFAULT_OVERNIGHT_AGENT_COUNT = 5;
/** Default patience before stop-on-no-improvement triggers. */
export const DEFAULT_NO_IMPROVEMENT_STOP = 2;
/** Default minimum improvement delta required to reset stagnation state. */
export const DEFAULT_MIN_IMPROVEMENT_DELTA = 0;
/** Default stdout slice retained for packed carry-context generation. */
export const DEFAULT_PACKING_STDOUT_CHARS = 8_000;
/** Default stderr slice retained for packed carry-context generation. */
export const DEFAULT_PACKING_STDERR_CHARS = 4_000;
/** Default maximum packed carry-context payload allowed between rounds. */
export const DEFAULT_PACKING_CARRY_CONTEXT_CHARS = 16_000;
/** Default daily repair frontier size for research-driven semantic refresh. */
export const DEFAULT_REFINEMENT_DAILY_CANDIDATE_LIMIT = 4;
/** Default project-scoped repair frontier size for research refinement. */
export const DEFAULT_REFINEMENT_PROJECT_CANDIDATE_LIMIT = 3;
/** Default daily MDL floor before a semantic artifact is considered repairable. */
export const DEFAULT_REFINEMENT_DAILY_MIN_MDL_SCORE = 0.5;
/** Default project-scoped MDL floor before a semantic artifact is repairable. */
export const DEFAULT_REFINEMENT_PROJECT_MIN_MDL_SCORE = 0.55;
/** Default daily priority threshold used to bound research-driven repairs. */
export const DEFAULT_REFINEMENT_DAILY_MIN_PRIORITY_SCORE = 1.35;
/** Default project-scoped priority threshold used to bound repairs. */
export const DEFAULT_REFINEMENT_PROJECT_MIN_PRIORITY_SCORE = 1.5;
/** Default minimum daily provenance depth before one artifact is repairable. */
export const DEFAULT_REFINEMENT_DAILY_MIN_SOURCE_SESSION_COUNT = 1;
/** Default minimum project provenance depth before one artifact is repairable. */
export const DEFAULT_REFINEMENT_PROJECT_MIN_SOURCE_SESSION_COUNT = 1;

/** Direction of the primary objective metric used by one research scope. */
export type ResearchObjective = "minimize" | "maximize";

/**
 * Engine-visible optimization dimensions for bounded research loops.
 *
 * I normalize these into "higher is better" scores later so the overnight
 * loop can compare rounds across several objectives without special-casing the
 * original metric direction on every branch.
 */
export type ResearchObjectiveMetric =
	| "metric-improvement"
	| "duration-efficiency"
	| "packing-efficiency"
	| "stability";

/** One weighted optimization target in the bounded overnight loop. */
export interface ResearchObjectiveSpec {
	id: string;
	label: string;
	metric: ResearchObjectiveMetric;
	weight: number;
	threshold?: number;
	enabled: boolean;
}

/**
 * Stable stop-condition kinds for research loops.
 *
 * I keep these narrow on purpose. The overnight loop should stop for explicit
 * reasons, not because loosely-related heuristics all mutate control flow.
 */
export type ResearchStopConditionKind =
	| "max-rounds"
	| "no-improvement"
	| "budget-exhausted"
	| "pareto-stagnation";

/** One configured stop condition attached to the loop scope. */
export interface ResearchStopConditionSpec {
	id: string;
	kind: ResearchStopConditionKind;
	patience?: number;
	threshold?: number;
	enabled: boolean;
}

/** One normalized objective score emitted for a single round. */
export interface ResearchObjectiveScore {
	id: string;
	label: string;
	metric: ResearchObjectiveMetric;
	score: number;
	value: number | null;
	threshold?: number;
	satisfied: boolean;
	explanation: string;
}

/** One evaluated stop-condition outcome for a single round. */
export interface ResearchStopConditionHit {
	id: string;
	kind: ResearchStopConditionKind;
	triggered: boolean;
	reason: string;
}

/** Budget for how much raw run output I allow into the packed carry context. */
export interface ResearchPackingBudget {
	maxStdoutChars: number;
	maxStderrChars: number;
	maxCarryContextChars: number;
}

/**
 * Budget for how much historical context one loop may reuse while it is
 * reasoning about the next round.
 *
 * I keep this separate from packing because retrieval governs *which* prior
 * context survives, while packing governs *how* the surviving context is
 * compressed and carried forward.
 */
export interface ResearchRetrievalBudget {
	maxReuseChars: number;
	maxFrontierEntries: number;
}

/**
 * Budget for how aggressively the daemon may widen semantic repair after one
 * overnight research outcome.
 */
export interface ResearchRefinementBudget {
	dailyCandidateLimit: number;
	projectCandidateLimit: number;
	dailyMinMdlScore: number;
	projectMinMdlScore: number;
	dailyMinPriorityScore: number;
	projectMinPriorityScore: number;
	dailyMinSourceSessionCount: number;
	projectMinSourceSessionCount: number;
}

/**
 * Budget for how much research-derived refinement pressure Nidra may consume
 * during the next daemon-owned postprocess cycle.
 *
 * I keep this bounded so one noisy overnight run cannot widen the daemon into
 * a whole-project rewrite when only a few high-value scopes should be refined.
 */
export interface ResearchNidraBudget {
	maxResearchProjectsPerCycle: number;
	maxSemanticPressure: number;
}

/** Modular update budgets carried with the research scope and experiment log. */
export interface ResearchUpdateBudgets {
	packing: ResearchPackingBudget;
	retrieval: ResearchRetrievalBudget;
	refinement: ResearchRefinementBudget;
	nidra: ResearchNidraBudget;
}

/**
 * Canonical runtime scope for one bounded research attempt.
 *
 * I keep every execution, lineage, optimization, and update-budget control in
 * one normalized object so checkpoints and resumes can reconstruct the exact
 * loop contract instead of rebuilding policy from scattered inputs.
 */
export interface ResearchScope {
	hypothesis: string;
	topic: string;
	command: string;
	commandArgs: string[];
	projectPath: string;
	cwd: string;
	parentSessionId: string | null;
	sessionLineageKey: string | null;
	targetFiles: string[];
	immutableFiles: string[];
	metricName: string;
	metricPattern: string;
	objective: ResearchObjective;
	budgetMs: number;
	totalBudgetMs: number;
	allowDirtyWorkspace: boolean;
	plannerRouteClass: string;
	plannerCapability: string | null;
	executionRouteClass: string;
	executionCapability: string | null;
	maxRounds: number;
	agentCount: number;
	stopAfterNoImprovementRounds: number;
	minimumImprovementDelta?: number;
	objectives: ResearchObjectiveSpec[];
	stopConditions: ResearchStopConditionSpec[];
	updateBudgets: ResearchUpdateBudgets;
	/** Optional durable worker lease owner for daemon-scheduled overnight loops. */
	leaseOwner: string | null;
	requireTargetFileChangesForKeep?: boolean;
	/**
	 * Hash-only scopes are easier to recover but weaker as a source-of-truth for
	 * unattended keeps. I default to rejecting keep decisions there unless the
	 * caller opts in deliberately.
	 */
	allowHashOnlyKeep?: boolean;
	loopKey: string | null;
	roundNumber: number | null;
	totalRounds: number | null;
	attemptNumber: number | null;
	interruptSignal?: AbortSignal;
}

/**
 * Durable run record for one experiment attempt inside a research loop.
 *
 * This is the bridge between raw execution, governance, and later evaluation.
 */
export interface ResearchRunData {
	command: string;
	commandArgs: string[];
	cwd: string;
	metricName: string;
	metric: number | null;
	executionRouteClass?: string;
	selectedCapabilityId?: string | null;
	selectedModelId?: string | null;
	selectedProviderId?: string | null;
	gitBranch?: string | null;
	gitHeadCommit?: string | null;
	gitDirtyBefore?: boolean | null;
	gitDirtyAfter?: boolean | null;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	durationMs: number;
	scopeGuard: "git" | "hash-only";
	targetFilesChanged: string[];
	scopeSnapshot?: ResearchScopeSnapshot;
}

/** One bounded workspace snapshot used by keep/discard/revert governance. */
export interface ResearchScopeSnapshot {
	mode: "git" | "hash-only";
	/**
	 * Git status paths captured before the run.
	 *
	 * I only persist these for git-backed scopes so keep verification can prove
	 * that no new out-of-scope mutable edits appeared between the pre-run and
	 * post-run snapshots.
	 */
	changedPaths?: string[];
	/** Git branch captured before the run when the workspace was git-backed. */
	gitBranch?: string | null;
	/** Git HEAD captured before the run when the workspace was git-backed. */
	gitHeadCommit?: string | null;
	hashes?: Record<string, string | null>;
	fileContents: Record<string, string | null>;
}

/** Public council participant metadata returned with one research verdict. */
export interface CouncilParticipantSummary {
	id: string;
	role: string;
	expertise: number;
	credibility: number;
}

/**
 * Operator-facing summary of the planner/executor council used by one loop.
 *
 * I persist route and Lucy state here so the overnight loop remains
 * debuggable even after the raw council exchange has aged out of memory.
 */
export interface ResearchCouncilSummary {
	sabhaId: string;
	sessionId: string | null;
	topic: string;
	participantCount: number;
	participants: CouncilParticipantSummary[];
	finalVerdict: string;
	rounds: number;
	councilSummary: Array<{
		roundNumber: number;
		verdict: string;
		voteCount: number;
		challengeCount: number;
	}>;
	lucy: {
		hitEntity: string | null;
		predictionCount: number;
		criticalSignalCount: number;
		recommendation: "support" | "caution" | "block";
	};
	route: ResearchResolvedRouteSummary | null;
	plannerRoute: ResearchResolvedRouteSummary | null;
	executionRoute: ResearchResolvedRouteSummary | null;
	source: "daemon" | "local-fallback";
}

/** Final keep/discard/revert decision for one completed research round. */
export interface ResearchFinalizeResult {
	decision: "keep" | "discard";
	action: "kept" | "reverted" | "skipped";
	revertedFiles: string[];
	reason: string | null;
	scopeGuard: "git" | "hash-only";
}
