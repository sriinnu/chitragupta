import { createHash, randomBytes } from "node:crypto";
import type {
	ResearchCouncilSummary,
	ResearchObjectiveSpec,
	ResearchObjectiveScore,
	ResearchScope,
	ResearchStopConditionHit,
	ResearchStopConditionKind,
	ResearchStopConditionSpec,
	ResearchUpdateBudgets,
} from "./chitragupta-nodes-research-shared.js";
import {
	buildDefaultResearchObjectives,
	buildDefaultResearchStopConditions,
	buildDefaultResearchUpdateBudgets,
} from "./chitragupta-nodes-research-shared-defaults.js";

/** Baseline metric snapshot carried across rounds and persisted into checkpoints. */
export type BaselineData = {
	metricName: string;
	objective: "minimize" | "maximize";
	baselineMetric: number | null;
	hypothesis?: string;
};

/**
 * Public round record emitted by the overnight loop.
 *
 * This is the canonical per-round artifact used by summaries, experiment
 * records, and checkpoint replay.
 */
export type OvernightResearchRound = {
	roundNumber: number;
	decision: string;
	observedMetric: number | null;
	delta: number | null;
	finalizeAction: string | null;
	traceId: string | null;
	experimentId: string | null;
	packedRuntime: string | null;
	packedSource: string | null;
	selectedModelId: string | null;
	selectedProviderId: string | null;
	executionRouteClass: string | null;
	objectiveScores?: ResearchObjectiveScore[];
	stopConditionHits?: ResearchStopConditionHit[];
	optimizerScore?: number | null;
	paretoRank?: number | null;
	paretoDominated?: boolean;
};

/**
 * Normalized evaluation payload shared across run closure, recording, and
 * loop-summary construction.
 */
export type ResearchEvaluationRecord = {
	metricName: string;
	objective: "minimize" | "maximize";
	baselineMetric: number | null;
	observedMetric: number | null;
	delta: number | null;
	improved: boolean;
	decision: string;
	status?: string;
	errorMessage?: string;
	objectiveScores?: ResearchObjectiveScore[];
	stopConditionHits?: ResearchStopConditionHit[];
	optimizerScore?: number | null;
};

/** Aggregate progress carried across overnight research rounds. */
export type OvernightResearchProgress = {
	bestMetric: number | null;
	bestRoundNumber: number | null;
	noImprovementStreak: number;
	totalDurationMs: number;
};

/** Durable committed round counters used by summaries and checkpoints. */
export type OvernightResearchRoundCounts = {
	keptRounds: number;
	revertedRounds: number;
};

/** Stable optimizer-policy snapshot persisted with checkpoints and summaries. */
export type ResearchPolicySnapshot = {
	fingerprint: string;
	objectives: ResearchObjectiveSpec[];
	stopConditions: ResearchStopConditionSpec[];
	updateBudgets: ResearchUpdateBudgets;
	primaryObjectiveId: string | null;
	primaryStopConditionId: string | null;
};

/** Mutable round-loop state carried between resumable overnight iterations. */
export interface OvernightResearchMutableState {
	currentBaseline: BaselineData;
	progress: OvernightResearchProgress;
	roundCounts: OvernightResearchRoundCounts;
	carryContext: string;
	rounds: OvernightResearchRound[];
	resumeCheckpoint: OvernightResearchCheckpoint | null;
	finalSummary: OvernightResearchSummary | null;
}

/** Exact durable phase markers for timeout/restart-safe overnight loops. */
export type OvernightResearchCheckpointPhase =
	| "run"
	| "closure-pack"
	| "closure-record"
	| "closure-unpack"
	| "closure-normalize"
	| "failure-finalize"
	| "failure-pack"
	| "failure-record"
	| "complete-pending"
	| "terminal";

/** Serialized in-flight round state needed to resume the current loop phase exactly. */
export type OvernightResearchCheckpointActiveRound = {
	roundNumber: number;
	roundBase?: OvernightResearchRound | null;
	runData?: Record<string, unknown> | null;
	evaluation?: ResearchEvaluationRecord | null;
	finalize?: Record<string, unknown> | null;
	failedRun?: Record<string, unknown> | null;
	packed?: Record<string, unknown> | null;
	recorded?: Record<string, unknown> | null;
};

/** Durable checkpoint for a resumable overnight research loop. */
export type OvernightResearchCheckpoint = {
	version: 1;
	loopKey: string;
	phase: OvernightResearchCheckpointPhase;
	policy?: ResearchPolicySnapshot | null;
	currentBaseline: BaselineData;
	progress: OvernightResearchProgress;
	roundCounts: OvernightResearchRoundCounts;
	carryContext: string;
	rounds: OvernightResearchRound[];
	nextRoundNumber: number;
	activeRound: OvernightResearchCheckpointActiveRound | null;
	terminalSummary?: OvernightResearchSummary | null;
};

/**
 * Canonical terminal reasons for one overnight research loop.
 *
 * I keep this narrower than generic task status so daemon control state,
 * summaries, and downstream digests all speak the same terminal language.
 */
export type OvernightResearchStopReason =
	| "max-rounds"
	| "no-improvement"
	| "budget-exhausted"
	| "cancelled"
	| "control-plane-lost"
	| "unsafe-discard"
	| "round-failed"
	| "closure-failed";

/**
 * Durable terminal summary for one logical overnight research loop.
 *
 * `stopReason` is the authoritative operator-facing explanation once daemon
 * loop completion succeeds. `closureStatus` records whether post-run summary
 * persistence degraded after the logical loop was already complete.
 */
export type OvernightResearchSummary = {
	loopKey: string;
	roundsRequested: number;
	roundsCompleted: number;
	stopReason: OvernightResearchStopReason;
	bestMetric: number | null;
	bestRoundNumber: number | null;
	noImprovementStreak: number;
	totalDurationMs: number;
	totalBudgetMs: number;
	keptRounds: number;
	revertedRounds: number;
	sessionId: string | null;
	sabhaId: string | null;
	councilVerdict: string;
	plannerRoute: Record<string, unknown> | null;
	executionRoute: Record<string, unknown> | null;
	rounds: OvernightResearchRound[];
	policy?: ResearchPolicySnapshot;
	frontier: Array<{
		roundNumber: number;
		optimizerScore: number | null;
		objectiveScores: ResearchObjectiveScore[];
	}>;
	stopConditionHits?: ResearchStopConditionHit[];
	primaryStopConditionId?: string | null;
	primaryStopConditionKind?: ResearchStopConditionKind | null;
	summaryId?: string | null;
	summarySource?: "daemon" | "fallback" | null;
	closureStatus?: "complete" | "degraded";
	closureError?: string | null;
};

function cloneObjectives(scope: ResearchScope): ResearchObjectiveSpec[] {
	const objectives = scope.objectives.length > 0
		? scope.objectives
		: buildDefaultResearchObjectives();
	return objectives.map((objective) => ({ ...objective }));
}

function cloneStopConditions(scope: ResearchScope): ResearchStopConditionSpec[] {
	const stopConditions = scope.stopConditions.length > 0
		? scope.stopConditions
		: buildDefaultResearchStopConditions(scope.maxRounds);
	return stopConditions.map((condition) => ({ ...condition }));
}

function cloneUpdateBudgets(scope: ResearchScope): ResearchUpdateBudgets {
	const budgets = scope.updateBudgets ?? buildDefaultResearchUpdateBudgets();
	return {
		packing: { ...budgets.packing },
		retrieval: { ...budgets.retrieval },
		refinement: { ...budgets.refinement },
		nidra: { ...budgets.nidra },
	};
}

/**
 * Build the stable optimizer-policy snapshot that checkpoints and summaries must
 * carry forward across timeout pickup and later analysis.
 */
export function buildResearchPolicySnapshot(scope: ResearchScope): ResearchPolicySnapshot {
	const objectives = cloneObjectives(scope);
	const stopConditions = cloneStopConditions(scope);
	const updateBudgets = cloneUpdateBudgets(scope);
	const fingerprint = createHash("sha1").update(JSON.stringify({
		objectives,
		stopConditions,
		updateBudgets,
	})).digest("hex").slice(0, 16);
	return {
		fingerprint,
		objectives,
		stopConditions,
		updateBudgets,
		primaryObjectiveId: objectives.find((objective) => objective.enabled)?.id ?? objectives[0]?.id ?? null,
		primaryStopConditionId: stopConditions.find((condition) => condition.enabled)?.id ?? stopConditions[0]?.id ?? null,
	};
}

/**
 * Reject resume drift when a loop is about to continue under a different policy
 * than the one that produced the persisted checkpoint or summary.
 */
export function assertCompatibleResearchPolicy(
	scope: ResearchScope,
	persisted: ResearchPolicySnapshot | null | undefined,
	source: string,
): void {
	if (!persisted?.fingerprint) return;
	const current = buildResearchPolicySnapshot(scope);
	if (current.fingerprint !== persisted.fingerprint) {
		throw new Error(
			`Research policy drift detected for ${source}: persisted ${persisted.fingerprint}, current ${current.fingerprint}`,
		);
	}
}

/**
 * Build the stable logical loop key used for daemon lifecycle state and
 * resumable checkpoints.
 */
export function buildLoopKey(scope: ResearchScope, council: Record<string, unknown>): string {
	const policy = buildResearchPolicySnapshot(scope);
	const base = JSON.stringify({
		projectPath: scope.projectPath,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		sessionLineageKey: scope.sessionLineageKey,
		parentSessionId: scope.parentSessionId,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
		sabhaId: typeof council.sabhaId === "string" ? council.sabhaId : null,
		policyFingerprint: policy.fingerprint,
	});
	return createHash("sha1").update(base).digest("hex").slice(0, 16);
}

/**
 * Build a one-shot runtime loop key when the caller wants a fresh logical run
 * instead of resuming a previously durable loop identity.
 */
export function buildRuntimeLoopKey(scope: ResearchScope, council: Record<string, unknown>): string {
	const base = buildLoopKey(scope, council);
	const nonce = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
	return `${base}-${nonce}`;
}

/**
 * Construct the canonical loop summary before daemon completion and summary
 * persistence normalize the final terminal state.
 */
export function buildSummary(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	rounds: OvernightResearchRound[],
	stopReason: OvernightResearchStopReason,
	bestMetric: number | null,
	bestRoundNumber: number | null,
	noImprovementStreak: number,
	totalDurationMs: number,
	keptRounds: number,
	revertedRounds: number,
	loopKey: string,
): OvernightResearchSummary {
	const policy = buildResearchPolicySnapshot(scope);
	const updateBudgets = policy.updateBudgets;
	const latestStopConditionHits = [...rounds]
		.reverse()
		.find((round) => Array.isArray(round.stopConditionHits) && round.stopConditionHits.length > 0)
		?.stopConditionHits;
	const primaryStopCondition = latestStopConditionHits?.find((hit) => hit.triggered) ?? null;
	return {
		loopKey,
		roundsRequested: scope.maxRounds,
		roundsCompleted: rounds.length,
		stopReason,
		bestMetric,
		bestRoundNumber,
		noImprovementStreak,
		totalDurationMs,
		totalBudgetMs: scope.totalBudgetMs,
		keptRounds,
		revertedRounds,
		sessionId: council.sessionId,
		sabhaId: council.sabhaId,
		councilVerdict: council.finalVerdict,
		plannerRoute: council.plannerRoute as Record<string, unknown> | null,
		executionRoute: council.executionRoute as Record<string, unknown> | null,
		rounds,
		policy,
		frontier: rounds
			.filter((round) => round.paretoDominated === false && Array.isArray(round.objectiveScores))
			.slice(0, updateBudgets.retrieval.maxFrontierEntries)
			.map((round) => ({
				roundNumber: round.roundNumber,
				optimizerScore: typeof round.optimizerScore === "number" ? round.optimizerScore : null,
				objectiveScores: round.objectiveScores ?? [],
			})),
		stopConditionHits: latestStopConditionHits,
		primaryStopConditionId: primaryStopCondition?.id ?? null,
		primaryStopConditionKind: primaryStopCondition?.kind ?? null,
		closureStatus: "complete",
		closureError: null,
	};
}

/**
 * Preserve the logical loop result while recording that summary persistence or
 * reporting degraded after the loop had already reached a terminal outcome.
 */
export function withDegradedClosure(
	summary: OvernightResearchSummary,
	error: unknown,
): OvernightResearchSummary {
	return {
		...summary,
		closureStatus: "degraded",
		closureError: error instanceof Error ? error.message : String(error),
	};
}

/**
 * Preserve distinct cancellation classes instead of collapsing them all to a
 * generic cancelled stop reason.
 */
export function stopReasonFromCancelReason(reason: string | null): OvernightResearchStopReason {
	return reason === "control-plane-lost" ? "control-plane-lost" : "cancelled";
}
