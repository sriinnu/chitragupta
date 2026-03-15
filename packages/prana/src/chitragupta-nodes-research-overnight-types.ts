import { createHash, randomBytes } from "node:crypto";
import type {
	ResearchCouncilSummary,
	ResearchObjectiveScore,
	ResearchObjectiveSpec,
	ResearchScope,
	ResearchStopConditionHit,
	ResearchStopConditionKind,
	ResearchStopConditionSpec,
	ResearchUpdateBudgets,
} from "./chitragupta-nodes-research-shared.js";
import {
	DEFAULT_IMMUTABLE_FILES as DEFAULT_SCOPE_IMMUTABLE_FILES,
	DEFAULT_TARGET_FILES as DEFAULT_SCOPE_TARGET_FILES,
} from "./chitragupta-nodes-research-shared-types.js";
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
	paretoDominated?: boolean | null;
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
	paretoRank?: number | null;
	paretoDominated?: boolean | null;
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
	legacyFingerprint?: string | null;
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
 * Canonical stop reasons the overnight loop itself currently emits.
 *
 * I keep these explicit so control-plane code can still switch on the known
 * engine outcomes while summary replay remains free to preserve a future or
 * foreign persisted reason verbatim.
 */
export type KnownOvernightResearchStopReason =
	| "max-rounds"
	| "no-improvement"
	| "pareto-stagnation"
	| "budget-exhausted"
	| "cancelled"
	| "control-plane-lost"
	| "unsafe-discard"
	| "round-failed"
	| "closure-failed";

/**
 * Operator-facing stop reason carried by persisted summaries.
 *
 * Summary replay intentionally preserves unknown strings so newer daemon
 * writers do not get collapsed into older local unions during resume.
 */
export type OvernightResearchStopReason = KnownOvernightResearchStopReason | (string & {});

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
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
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

type PartialResearchUpdateBudgets = Partial<{
	packing: Partial<ResearchUpdateBudgets["packing"]>;
	retrieval: Partial<ResearchUpdateBudgets["retrieval"]>;
	refinement: Partial<ResearchUpdateBudgets["refinement"]>;
	nidra: Partial<ResearchUpdateBudgets["nidra"]>;
}>;

function clampTextBudget(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(256, Math.min(64_000, normalized));
}

function clampReuseChars(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(512, Math.min(64_000, normalized));
}

function clampCandidateLimit(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(64, normalized));
}

function clampScoreThreshold(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	return Math.round(Math.max(0, Math.min(5, normalized)) * 100) / 100;
}

function clampSourceSessionCount(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(64, normalized));
}

function clampFrontierEntries(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(16, normalized));
}

function clampProjectCycleLimit(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(16, normalized));
}

function clampSemanticPressure(value: unknown, fallback: number): number {
	const normalized = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(16, normalized));
}

function cloneObjectives(scope: ResearchScope): ResearchObjectiveSpec[] {
	const objectives = (scope.objectives?.length ?? 0) > 0 ? scope.objectives : buildDefaultResearchObjectives();
	return objectives.map((objective) => ({ ...objective }));
}

function cloneStopConditions(scope: ResearchScope): ResearchStopConditionSpec[] {
	const stopConditions =
		(scope.stopConditions?.length ?? 0) > 0
			? scope.stopConditions
			: buildDefaultResearchStopConditions(scope.maxRounds);
	return stopConditions.map((condition) => ({ ...condition }));
}

/**
 * Normalize one file-bound scope boundary before it participates in policy
 * identity. I sort/dedupe here so equivalent caller orderings stay resumable.
 */
function normalizePolicyFiles(files: readonly string[]): string[] {
	return [...new Set(files.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}

/**
 * Deep-fill subsystem budgets so partially restored legacy policy snapshots do
 * not lose nested defaults when they re-enter resume or summary code paths.
 */
export function normalizeResearchUpdateBudgets(
	budgets: PartialResearchUpdateBudgets | ResearchUpdateBudgets | null | undefined,
): ResearchUpdateBudgets {
	const defaults = buildDefaultResearchUpdateBudgets();
	const envelope = budgets ?? {};
	return {
		packing: {
			maxStdoutChars: clampTextBudget(envelope.packing?.maxStdoutChars, defaults.packing.maxStdoutChars),
			maxStderrChars: clampTextBudget(envelope.packing?.maxStderrChars, defaults.packing.maxStderrChars),
			maxCarryContextChars: clampTextBudget(
				envelope.packing?.maxCarryContextChars,
				defaults.packing.maxCarryContextChars,
			),
		},
		retrieval: {
			maxReuseChars: clampReuseChars(envelope.retrieval?.maxReuseChars, defaults.retrieval.maxReuseChars),
			maxFrontierEntries: clampFrontierEntries(
				envelope.retrieval?.maxFrontierEntries,
				defaults.retrieval.maxFrontierEntries,
			),
		},
		refinement: {
			dailyCandidateLimit: clampCandidateLimit(
				envelope.refinement?.dailyCandidateLimit,
				defaults.refinement.dailyCandidateLimit,
			),
			projectCandidateLimit: clampCandidateLimit(
				envelope.refinement?.projectCandidateLimit,
				defaults.refinement.projectCandidateLimit,
			),
			dailyMinMdlScore: clampScoreThreshold(
				envelope.refinement?.dailyMinMdlScore,
				defaults.refinement.dailyMinMdlScore,
			),
			projectMinMdlScore: clampScoreThreshold(
				envelope.refinement?.projectMinMdlScore,
				defaults.refinement.projectMinMdlScore,
			),
			dailyMinPriorityScore: clampScoreThreshold(
				envelope.refinement?.dailyMinPriorityScore,
				defaults.refinement.dailyMinPriorityScore,
			),
			projectMinPriorityScore: clampScoreThreshold(
				envelope.refinement?.projectMinPriorityScore,
				defaults.refinement.projectMinPriorityScore,
			),
			dailyMinSourceSessionCount: clampSourceSessionCount(
				envelope.refinement?.dailyMinSourceSessionCount,
				defaults.refinement.dailyMinSourceSessionCount,
			),
			projectMinSourceSessionCount: clampSourceSessionCount(
				envelope.refinement?.projectMinSourceSessionCount,
				defaults.refinement.projectMinSourceSessionCount,
			),
		},
		nidra: {
			maxResearchProjectsPerCycle: clampProjectCycleLimit(
				envelope.nidra?.maxResearchProjectsPerCycle,
				defaults.nidra.maxResearchProjectsPerCycle,
			),
			maxSemanticPressure: clampSemanticPressure(
				envelope.nidra?.maxSemanticPressure,
				defaults.nidra.maxSemanticPressure,
			),
		},
	};
}

function cloneUpdateBudgets(scope: ResearchScope): ResearchUpdateBudgets {
	return normalizeResearchUpdateBudgets(scope.updateBudgets);
}

/**
 * Build the stable optimizer-policy snapshot that checkpoints and summaries must
 * carry forward across timeout pickup and later analysis.
 */
export function buildResearchPolicySnapshot(scope: ResearchScope): ResearchPolicySnapshot {
	const objectives = cloneObjectives(scope);
	const stopConditions = cloneStopConditions(scope);
	const updateBudgets = cloneUpdateBudgets(scope);
	const targetFiles = normalizePolicyFiles(scope.targetFiles);
	const immutableFiles = normalizePolicyFiles(scope.immutableFiles);
	const legacyFingerprint = createHash("sha1")
		.update(
			JSON.stringify({
				objectives,
				stopConditions,
				updateBudgets,
			}),
		)
		.digest("hex")
		.slice(0, 16);
	const fingerprint = createHash("sha1")
		.update(
			JSON.stringify({
				command: scope.command,
				commandArgs: [...scope.commandArgs],
				cwd: scope.cwd,
				metricName: scope.metricName,
				metricPattern: scope.metricPattern,
				objective: scope.objective,
				budgetMs: scope.budgetMs,
				totalBudgetMs: scope.totalBudgetMs,
				allowDirtyWorkspace: scope.allowDirtyWorkspace,
				plannerRouteClass: scope.plannerRouteClass,
				plannerCapability: scope.plannerCapability,
				executionRouteClass: scope.executionRouteClass,
				executionCapability: scope.executionCapability,
					maxRounds: scope.maxRounds,
					agentCount: scope.agentCount,
					stopAfterNoImprovementRounds: scope.stopAfterNoImprovementRounds,
					minimumImprovementDelta: scope.minimumImprovementDelta ?? null,
					requireTargetFileChangesForKeep: scope.requireTargetFileChangesForKeep ?? false,
					allowHashOnlyKeep: scope.allowHashOnlyKeep ?? false,
					targetFiles,
					immutableFiles,
					objectives,
					stopConditions,
					updateBudgets,
				}),
		)
		.digest("hex")
		.slice(0, 16);
	return {
		fingerprint,
		legacyFingerprint,
		objectives,
		stopConditions,
		updateBudgets,
		primaryObjectiveId: objectives.find((objective) => objective.enabled)?.id ?? objectives[0]?.id ?? null,
		primaryStopConditionId: stopConditions.find((condition) => condition.enabled)?.id ?? stopConditions[0]?.id ?? null,
	};
}

/**
 * Choose the canonical primary stop hit from a triggered stop-condition set.
 *
 * I keep this selection in the shared policy module so the live loop, summary
 * builder, and resume reconstruction all speak the same terminal truth.
 */
export function selectPrimaryResearchStopConditionHit(
	hits: readonly ResearchStopConditionHit[] | null | undefined,
): ResearchStopConditionHit | null {
	const triggeredHits = hits?.filter((hit) => hit.triggered) ?? [];
	const findTriggered = (kind: ResearchStopConditionKind): ResearchStopConditionHit | null =>
		triggeredHits.find((hit) => hit.kind === kind) ?? null;
	return (
		findTriggered("budget-exhausted")
		?? findTriggered("pareto-stagnation")
		?? findTriggered("no-improvement")
		?? findTriggered("max-rounds")
	);
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
	const currentTargetFiles = normalizePolicyFiles(scope.targetFiles);
	const currentImmutableFiles = normalizePolicyFiles(scope.immutableFiles);
	const defaultTargetFiles = normalizePolicyFiles(DEFAULT_SCOPE_TARGET_FILES);
	const defaultImmutableFiles = normalizePolicyFiles(DEFAULT_SCOPE_IMMUTABLE_FILES);
	const usesDefaultFileBounds =
		currentTargetFiles.length === defaultTargetFiles.length
		&& currentImmutableFiles.length === defaultImmutableFiles.length
		&& currentTargetFiles.every((value, index) => value === defaultTargetFiles[index])
		&& currentImmutableFiles.every((value, index) => value === defaultImmutableFiles[index]);
	const compatible =
		current.fingerprint === persisted.fingerprint
		// Older checkpoints and summaries only stored the narrow fingerprint that
		// later became `legacyFingerprint`. I only accept that upgrade path when
		// the current scope still uses the legacy default file bounds. Any
		// explicit file-bound scope change must fail closed instead of resuming
		// under the old logical loop key.
		|| (
			!persisted.legacyFingerprint
			&& usesDefaultFileBounds
			&& current.legacyFingerprint === persisted.fingerprint
		);
	if (!compatible) {
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
 * Rebuild the pre-upgrade logical loop key so newer runtimes can still discover
 * older in-flight loops whose identity only tracked the narrow optimizer
 * fingerprint.
 */
export function buildLegacyLoopKey(scope: ResearchScope, council: Record<string, unknown>): string {
	const policy = buildResearchPolicySnapshot(scope);
	const base = JSON.stringify({
		projectPath: scope.projectPath,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		sessionLineageKey: scope.sessionLineageKey,
		parentSessionId: scope.parentSessionId,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
		sabhaId: typeof council.sabhaId === "string" ? council.sabhaId : null,
		policyFingerprint: policy.legacyFingerprint ?? policy.fingerprint,
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
		.find((round) => Array.isArray(round.stopConditionHits) && round.stopConditionHits.length > 0)?.stopConditionHits;
	const primaryStopCondition = selectPrimaryResearchStopConditionHit(latestStopConditionHits);
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
		policyFingerprint: policy.fingerprint,
		primaryObjectiveId: policy.primaryObjectiveId,
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
export function withDegradedClosure(summary: OvernightResearchSummary, error: unknown): OvernightResearchSummary {
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
