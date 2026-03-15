import type {
	ResearchFinalizeResult,
	ResearchObjective,
	ResearchObjectiveScore,
	ResearchScope,
	ResearchStopConditionHit,
	ResearchUpdateBudgets,
} from "./chitragupta-nodes-research-shared.js";
import { buildDefaultResearchUpdateBudgets } from "./chitragupta-nodes-research-shared-defaults.js";
import {
	buildResearchPolicySnapshot,
	selectPrimaryResearchStopConditionHit,
} from "./chitragupta-nodes-research-overnight-types.js";

/**
 * Minimal execution-binding envelope that I persist into research artifacts.
 *
 * I keep this deliberately narrow so the durable ledger captures the routing
 * decision that mattered without serializing the whole daemon capability graph.
 */
export interface ResearchExecutionBindingSummary {
	source?: string;
	kind?: string;
	query?: {
		capability?: string;
		mode?: string;
		role?: string;
	};
	selectedModelId?: string;
	selectedProviderId?: string;
	candidateModelIds?: string[];
	preferredModelIds?: string[];
	preferredProviderIds?: string[];
	preferLocalProviders?: boolean;
	allowCrossProvider?: boolean;
}

/**
 * Canonical route summary persisted with each research artifact.
 *
 * I store both the resolved lane and the execution-binding hints so the
 * overnight loop can be audited later without replaying the full route engine.
 */
export interface ResearchResolvedRouteSummary {
	routeClass: string | null;
	capability: string | null;
	selectedCapabilityId: string | null;
	executionBinding?: ResearchExecutionBindingSummary | null;
	degraded: boolean;
	discoverableOnly: boolean;
	reason: string | null;
	policyTrace: string[];
}

/**
 * Canonical per-attempt experiment payload persisted into the daemon-owned
 * research ledger.
 */
export interface ResearchExperimentRecord {
	experimentKey: string;
	attemptKey: string | null;
	loopKey: string | null;
	roundNumber: number | null;
	totalRounds: number | null;
	attemptNumber: number | null;
	topic: string;
	hypothesis: string;
	command: string;
	commandArgs: string[];
	projectPath: string;
	cwd: string;
	budgetMs: number;
	parentSessionId: string | null;
	sessionLineageKey: string | null;
	targetFiles: string[];
	immutableFiles: string[];
	metricName: string;
	objective: ResearchObjective;
	sessionId: string | null;
	sabhaId: string | null;
	route: ResearchResolvedRouteSummary | null;
	plannerRoute: ResearchResolvedRouteSummary | null;
	executionRoute: ResearchResolvedRouteSummary | null;
	councilVerdict: string;
	baselineMetric: number | null;
	observedMetric: number | null;
	delta: number | null;
	decision: "keep" | "discard" | "record";
	status: "completed" | "failed";
	errorMessage: string | null;
	finalize: ResearchFinalizeResult | null;
	run: {
		exitCode: number | null;
		timedOut: boolean;
		durationMs: number | null;
		roundWallClockDurationMs: number | null;
		targetFilesChanged: string[];
		selectedCapabilityId: string | null;
		selectedModelId: string | null;
		selectedProviderId: string | null;
		executionRouteClass: string | null;
		gitBranch: string | null;
		gitHeadCommit: string | null;
		gitDirtyBefore: boolean | null;
		gitDirtyAfter: boolean | null;
	};
	packing: {
		runtime: string | null;
		source: string | null;
		savings: number | null;
		sourceLength: number | null;
		reason: string | null;
	};
	updateBudgets: ResearchUpdateBudgets;
	objectiveScores: ResearchObjectiveScore[];
	stopConditionHits: ResearchStopConditionHit[];
	optimizerScore: number | null;
	paretoRank: number | null;
	paretoDominated: boolean | null;
	policyFingerprint: string;
	primaryObjectiveId: string | null;
	primaryStopConditionId: string | null;
	primaryStopConditionKind: string | null;
}

function normalizeScopeFiles(files: readonly string[]): string[] {
	return [...new Set(files.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}

/** Build the canonical experiment record persisted by the daemon research ledger. */
export function buildResearchExperimentRecord(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	finalize: Record<string, unknown> | null,
	packed: Record<string, unknown>,
): ResearchExperimentRecord {
	const updateBudgets =
		scope.updateBudgets
		?? buildDefaultResearchUpdateBudgets();
	const policy = buildResearchPolicySnapshot(scope);
	const route = council.route && typeof council.route === "object"
		? council.route as ResearchResolvedRouteSummary
		: null;
	const plannerRoute = council.plannerRoute && typeof council.plannerRoute === "object"
		? council.plannerRoute as ResearchResolvedRouteSummary
		: null;
	const executionRoute = council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as ResearchResolvedRouteSummary
		: null;
	const targetFiles = normalizeScopeFiles(scope.targetFiles);
	const immutableFiles = normalizeScopeFiles(scope.immutableFiles);
	// I anchor the experiment key to the logical scope and lane selection so the
	// ledger can dedupe/reconcile retries without losing route provenance.
	const experimentKey = JSON.stringify({
		projectPath: scope.projectPath,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		command: scope.command,
		commandArgs: [...scope.commandArgs],
		cwd: scope.cwd,
		targetFiles,
		immutableFiles,
		metricName: scope.metricName,
		objective: scope.objective,
		executionRouteClass: scope.executionRouteClass,
		plannerRouteClass: scope.plannerRouteClass,
		plannerCapability: scope.plannerCapability,
		executionCapability: scope.executionCapability,
		sessionLineageKey: scope.sessionLineageKey,
		loopKey: scope.loopKey,
		roundNumber: scope.roundNumber,
		totalRounds: scope.totalRounds,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
	});
	const attemptNumber = typeof scope.attemptNumber === "number" && Number.isFinite(scope.attemptNumber)
		? scope.attemptNumber
		: null;
	const attemptKey = attemptNumber !== null
		? `${experimentKey}#attempt:${attemptNumber}`
		: null;
	const status =
		typeof evaluation.status === "string" && evaluation.status.trim().toLowerCase() === "failed"
			? "failed"
			: "completed";
	const errorMessage =
		typeof evaluation.errorMessage === "string" && evaluation.errorMessage.trim()
			? evaluation.errorMessage.trim()
			: typeof run.errorMessage === "string" && run.errorMessage.trim()
				? run.errorMessage.trim()
				: null;
	const durationMs =
		typeof run.durationMs === "number" ? run.durationMs : null;
	const roundWallClockDurationMs =
		typeof run.roundWallClockDurationMs === "number"
			? run.roundWallClockDurationMs
			: durationMs;
	const objectiveScores = Array.isArray(evaluation.objectiveScores)
		? evaluation.objectiveScores.filter(
			(score): score is ResearchObjectiveScore =>
				Boolean(score)
				&& typeof score === "object"
				&& typeof (score as ResearchObjectiveScore).id === "string"
				&& typeof (score as ResearchObjectiveScore).metric === "string"
				&& typeof (score as ResearchObjectiveScore).score === "number",
		)
		: [];
	const stopConditionHits = Array.isArray(evaluation.stopConditionHits)
		? evaluation.stopConditionHits.filter(
			(hit): hit is ResearchStopConditionHit =>
				Boolean(hit)
				&& typeof hit === "object"
				&& typeof (hit as ResearchStopConditionHit).id === "string"
				&& typeof (hit as ResearchStopConditionHit).kind === "string"
				&& typeof (hit as ResearchStopConditionHit).triggered === "boolean",
		)
		: [];
	const primaryStopCondition = selectPrimaryResearchStopConditionHit(stopConditionHits);
	return {
		experimentKey,
		attemptKey,
		loopKey: scope.loopKey,
		roundNumber: scope.roundNumber,
		totalRounds: scope.totalRounds,
		attemptNumber,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		command: scope.command,
		commandArgs: [...scope.commandArgs],
		projectPath: scope.projectPath,
		cwd: scope.cwd,
		budgetMs: scope.budgetMs,
		parentSessionId: scope.parentSessionId,
		sessionLineageKey: scope.sessionLineageKey,
		targetFiles,
		immutableFiles,
		metricName: scope.metricName,
		objective: scope.objective,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
		sabhaId: typeof council.sabhaId === "string" ? council.sabhaId : null,
		route,
		plannerRoute,
		executionRoute,
		councilVerdict: typeof council.finalVerdict === "string" ? council.finalVerdict : "unknown",
		baselineMetric: typeof evaluation.baselineMetric === "number" ? evaluation.baselineMetric : null,
		observedMetric: typeof evaluation.observedMetric === "number" ? evaluation.observedMetric : null,
		delta: typeof evaluation.delta === "number" ? evaluation.delta : null,
		decision: typeof evaluation.decision === "string" ? evaluation.decision as "keep" | "discard" | "record" : "record",
		status,
		errorMessage,
		finalize: finalize && typeof finalize === "object"
			? {
				decision: finalize.decision === "keep" ? "keep" : "discard",
				action:
					finalize.action === "kept" || finalize.action === "reverted" || finalize.action === "skipped"
						? finalize.action
						: "skipped",
				revertedFiles: Array.isArray(finalize.revertedFiles)
					? finalize.revertedFiles.filter((value): value is string => typeof value === "string")
					: [],
				reason: typeof finalize.reason === "string" ? finalize.reason : null,
				scopeGuard: finalize.scopeGuard === "hash-only" ? "hash-only" : "git",
			}
			: null,
		run: {
			exitCode: typeof run.exitCode === "number" ? run.exitCode : null,
			timedOut: run.timedOut === true,
			durationMs,
			roundWallClockDurationMs,
			targetFilesChanged: Array.isArray(run.targetFilesChanged)
				? run.targetFilesChanged.filter(
					(value): value is string => typeof value === "string",
				)
				: [],
			selectedCapabilityId:
				typeof run.selectedCapabilityId === "string"
					? run.selectedCapabilityId
					: null,
			selectedModelId:
				typeof run.selectedModelId === "string" ? run.selectedModelId : null,
			selectedProviderId:
				typeof run.selectedProviderId === "string"
					? run.selectedProviderId
					: null,
			executionRouteClass:
				typeof run.executionRouteClass === "string"
					? run.executionRouteClass
					: null,
			gitBranch: typeof run.gitBranch === "string" ? run.gitBranch : null,
			gitHeadCommit:
				typeof run.gitHeadCommit === "string" ? run.gitHeadCommit : null,
			gitDirtyBefore:
				typeof run.gitDirtyBefore === "boolean" ? run.gitDirtyBefore : null,
			gitDirtyAfter:
				typeof run.gitDirtyAfter === "boolean" ? run.gitDirtyAfter : null,
		},
		packing: {
			runtime: typeof packed.runtime === "string" ? packed.runtime : null,
			source: typeof packed.source === "string" ? packed.source : null,
			savings: typeof packed.savings === "number" ? packed.savings : null,
			sourceLength: typeof packed.sourceLength === "number" ? packed.sourceLength : null,
			reason: typeof packed.reason === "string" ? packed.reason : null,
		},
			updateBudgets,
			objectiveScores,
			stopConditionHits,
			optimizerScore: typeof evaluation.optimizerScore === "number" ? evaluation.optimizerScore : null,
			paretoRank: typeof evaluation.paretoRank === "number" ? evaluation.paretoRank : null,
			paretoDominated: typeof evaluation.paretoDominated === "boolean" ? evaluation.paretoDominated : null,
			policyFingerprint: policy.fingerprint,
			primaryObjectiveId: policy.primaryObjectiveId,
			primaryStopConditionId: primaryStopCondition?.id ?? null,
			primaryStopConditionKind: primaryStopCondition?.kind ?? null,
	};
}

/**
 * Render one operator-facing markdown record from the canonical experiment
 * payload.
 *
 * I keep the markdown layer derived from the canonical record so the operator
 * view and the daemon ledger cannot drift independently.
 */
export function buildResearchRecord(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	finalize: Record<string, unknown> | null,
	packed: Record<string, unknown>,
): string {
	const experiment = buildResearchExperimentRecord(scope, council, run, evaluation, finalize, packed);
	const observed = experiment.observedMetric ?? "unknown";
	const baseline = experiment.baselineMetric ?? "unknown";
	const delta = typeof experiment.delta === "number" ? experiment.delta.toFixed(6) : "n/a";
	const route = experiment.route;
	const executionRoute = experiment.executionRoute;
	const packRuntime = experiment.packing.runtime ?? "none";
	const packSavings = typeof experiment.packing.savings === "number" ? `${experiment.packing.savings}%` : "n/a";
	const packSource = experiment.packing.source ?? "unknown";
	const packingBudgetSummary = [
		`stdout<=${experiment.updateBudgets.packing.maxStdoutChars}`,
		`stderr<=${experiment.updateBudgets.packing.maxStderrChars}`,
		`carry<=${experiment.updateBudgets.packing.maxCarryContextChars}`,
	].join(", ");
	const retrievalBudgetSummary = [
		`reuse<=${experiment.updateBudgets.retrieval.maxReuseChars}`,
		`frontier<=${experiment.updateBudgets.retrieval.maxFrontierEntries}`,
	].join(", ");
	const nidraBudgetSummary = [
		`projects<=${experiment.updateBudgets.nidra.maxResearchProjectsPerCycle}`,
		`semanticPressure<=${experiment.updateBudgets.nidra.maxSemanticPressure}`,
	].join(", ");
	const finalizeSummary = experiment.finalize
		? [
			`- finalize action: ${experiment.finalize.action}`,
			`- reverted files: ${experiment.finalize.revertedFiles.length > 0 ? experiment.finalize.revertedFiles.join(", ") : "none"}`,
			`- finalize reason: ${experiment.finalize.reason ?? "n/a"}`,
		].join("\n")
		: `- finalize action: n/a`;
	const packSummary = typeof packed.packedText === "string" && packed.packedText.trim()
		? `\n\n### Packed Context\n${packed.packedText.trim()}`
		: "";
	return [
		`## Autoresearch Experiment`,
		``,
		`- topic: ${experiment.topic}`,
		`- experiment key: ${experiment.experimentKey}`,
		`- attempt key: ${experiment.attemptKey ?? "none"}`,
		`- loop key: ${experiment.loopKey ?? "none"}`,
		`- round: ${experiment.roundNumber ?? "n/a"} / ${experiment.totalRounds ?? "n/a"}`,
		`- attempt: ${experiment.attemptNumber ?? "n/a"}`,
		`- hypothesis: ${experiment.hypothesis}`,
		`- command: ${experiment.command} ${experiment.commandArgs.join(" ")}`.trim(),
		`- cwd: ${experiment.cwd}`,
		`- budget ms: ${experiment.budgetMs}`,
		`- parent session: ${experiment.parentSessionId ?? "none"}`,
		`- session lineage: ${experiment.sessionLineageKey ?? "none"}`,
		`- target files: ${experiment.targetFiles.join(", ")}`,
		`- immutable files: ${experiment.immutableFiles.join(", ")}`,
		`- metric: ${experiment.metricName}`,
		`- objective: ${experiment.objective}`,
		`- session id: ${experiment.sessionId ?? "none"}`,
		`- sabha id: ${experiment.sabhaId ?? "none"}`,
		`- route class: ${typeof route?.routeClass === "string" ? route.routeClass : "none"}`,
		`- route capability: ${typeof route?.capability === "string" ? route.capability : "none"}`,
		`- route selected capability: ${typeof route?.selectedCapabilityId === "string" ? route.selectedCapabilityId : "none"}`,
		`- route reason: ${typeof route?.reason === "string" ? route.reason : "n/a"}`,
		`- route preferred providers: ${Array.isArray((route as { executionBinding?: { preferredProviderIds?: unknown } } | null)?.executionBinding?.preferredProviderIds) ? ((route as { executionBinding: { preferredProviderIds: string[] } }).executionBinding.preferredProviderIds.join(", ") || "none") : "none"}`,
		`- packing budget: ${packingBudgetSummary}`,
		`- retrieval budget: ${retrievalBudgetSummary}`,
		`- nidra budget: ${nidraBudgetSummary}`,
		`- route preferred models: ${Array.isArray((route as { executionBinding?: { preferredModelIds?: unknown } } | null)?.executionBinding?.preferredModelIds) ? ((route as { executionBinding: { preferredModelIds: string[] } }).executionBinding.preferredModelIds.join(", ") || "none") : "none"}`,
		`- planner route class: ${typeof experiment.plannerRoute?.routeClass === "string" ? experiment.plannerRoute.routeClass : "none"}`,
		`- planner capability: ${typeof experiment.plannerRoute?.capability === "string" ? experiment.plannerRoute.capability : "none"}`,
		`- planner selected capability: ${typeof experiment.plannerRoute?.selectedCapabilityId === "string" ? experiment.plannerRoute.selectedCapabilityId : "none"}`,
		`- planner route reason: ${typeof experiment.plannerRoute?.reason === "string" ? experiment.plannerRoute.reason : "n/a"}`,
		`- execution route class: ${typeof executionRoute?.routeClass === "string" ? executionRoute.routeClass : "none"}`,
		`- execution capability: ${typeof executionRoute?.capability === "string" ? executionRoute.capability : "none"}`,
		`- execution selected capability: ${typeof executionRoute?.selectedCapabilityId === "string" ? executionRoute.selectedCapabilityId : "none"}`,
		`- execution route reason: ${typeof executionRoute?.reason === "string" ? executionRoute.reason : "n/a"}`,
		`- execution preferred providers: ${Array.isArray((executionRoute as { executionBinding?: { preferredProviderIds?: unknown } } | null)?.executionBinding?.preferredProviderIds) ? ((executionRoute as { executionBinding: { preferredProviderIds: string[] } }).executionBinding.preferredProviderIds.join(", ") || "none") : "none"}`,
			`- execution preferred models: ${Array.isArray((executionRoute as { executionBinding?: { preferredModelIds?: unknown } } | null)?.executionBinding?.preferredModelIds) ? ((executionRoute as { executionBinding: { preferredModelIds: string[] } }).executionBinding.preferredModelIds.join(", ") || "none") : "none"}`,
			`- git branch: ${experiment.run.gitBranch ?? "none"}`,
			`- git head: ${experiment.run.gitHeadCommit ?? "none"}`,
			`- git dirty before: ${experiment.run.gitDirtyBefore == null ? "n/a" : String(experiment.run.gitDirtyBefore)}`,
			`- git dirty after: ${experiment.run.gitDirtyAfter == null ? "n/a" : String(experiment.run.gitDirtyAfter)}`,
			`- baseline: ${baseline}`,
		`- observed: ${observed}`,
		`- delta: ${delta}`,
		`- decision: ${experiment.decision}`,
		`- status: ${experiment.status}`,
		`- error: ${experiment.errorMessage ?? "none"}`,
		`- council verdict: ${experiment.councilVerdict}`,
		finalizeSummary,
		`- packed runtime: ${packRuntime}`,
		`- packed source: ${packSource}`,
		`- packed savings: ${packSavings}`,
		`- packing budgets: ${packingBudgetSummary}`,
	].join("\n") + packSummary;
}
