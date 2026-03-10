import type {
	ResearchFinalizeResult,
	ResearchObjective,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";

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

export interface ResearchExperimentRecord {
	experimentKey: string;
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
	executionRoute: ResearchResolvedRouteSummary | null;
	councilVerdict: string;
	baselineMetric: number | null;
	observedMetric: number | null;
	delta: number | null;
	decision: "keep" | "discard" | "record";
	finalize: ResearchFinalizeResult | null;
	run: {
		exitCode: number | null;
		timedOut: boolean;
		durationMs: number | null;
		targetFilesChanged: string[];
		selectedCapabilityId: string | null;
		selectedModelId: string | null;
		selectedProviderId: string | null;
		executionRouteClass: string | null;
	};
	packing: {
		runtime: string | null;
		source: string | null;
		savings: number | null;
		sourceLength: number | null;
		reason: string | null;
	};
}

export function buildResearchExperimentRecord(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	finalize: Record<string, unknown> | null,
	packed: Record<string, unknown>,
): ResearchExperimentRecord {
	const route = council.route && typeof council.route === "object"
		? council.route as ResearchResolvedRouteSummary
		: null;
	const executionRoute = council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as ResearchResolvedRouteSummary
		: null;
	const experimentKey = JSON.stringify({
		projectPath: scope.projectPath,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		command: scope.command,
		commandArgs: [...scope.commandArgs],
		cwd: scope.cwd,
		targetFiles: [...scope.targetFiles],
		immutableFiles: [...scope.immutableFiles],
		metricName: scope.metricName,
		objective: scope.objective,
		executionRouteClass: scope.executionRouteClass,
		executionCapability: scope.executionCapability,
		sessionLineageKey: scope.sessionLineageKey,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
	});
	return {
		experimentKey,
		topic: scope.topic,
		hypothesis: scope.hypothesis,
		command: scope.command,
		commandArgs: [...scope.commandArgs],
		projectPath: scope.projectPath,
		cwd: scope.cwd,
		budgetMs: scope.budgetMs,
		parentSessionId: scope.parentSessionId,
		sessionLineageKey: scope.sessionLineageKey,
		targetFiles: [...scope.targetFiles],
		immutableFiles: [...scope.immutableFiles],
		metricName: scope.metricName,
		objective: scope.objective,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
		sabhaId: typeof council.sabhaId === "string" ? council.sabhaId : null,
		route,
		executionRoute,
		councilVerdict: typeof council.finalVerdict === "string" ? council.finalVerdict : "unknown",
		baselineMetric: typeof evaluation.baselineMetric === "number" ? evaluation.baselineMetric : null,
		observedMetric: typeof evaluation.observedMetric === "number" ? evaluation.observedMetric : null,
		delta: typeof evaluation.delta === "number" ? evaluation.delta : null,
		decision: typeof evaluation.decision === "string" ? evaluation.decision as "keep" | "discard" | "record" : "record",
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
			durationMs: typeof run.durationMs === "number" ? run.durationMs : null,
			targetFilesChanged: Array.isArray(run.targetFilesChanged)
				? run.targetFilesChanged.filter((value): value is string => typeof value === "string")
				: [],
			selectedCapabilityId: typeof run.selectedCapabilityId === "string" ? run.selectedCapabilityId : null,
			selectedModelId: typeof run.selectedModelId === "string" ? run.selectedModelId : null,
			selectedProviderId: typeof run.selectedProviderId === "string" ? run.selectedProviderId : null,
			executionRouteClass: typeof run.executionRouteClass === "string" ? run.executionRouteClass : null,
		},
		packing: {
			runtime: typeof packed.runtime === "string" ? packed.runtime : null,
			source: typeof packed.source === "string" ? packed.source : null,
			savings: typeof packed.savings === "number" ? packed.savings : null,
			sourceLength: typeof packed.sourceLength === "number" ? packed.sourceLength : null,
			reason: typeof packed.reason === "string" ? packed.reason : null,
		},
	};
}

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
		`- route preferred models: ${Array.isArray((route as { executionBinding?: { preferredModelIds?: unknown } } | null)?.executionBinding?.preferredModelIds) ? ((route as { executionBinding: { preferredModelIds: string[] } }).executionBinding.preferredModelIds.join(", ") || "none") : "none"}`,
		`- execution route class: ${typeof executionRoute?.routeClass === "string" ? executionRoute.routeClass : "none"}`,
		`- execution capability: ${typeof executionRoute?.capability === "string" ? executionRoute.capability : "none"}`,
		`- execution selected capability: ${typeof executionRoute?.selectedCapabilityId === "string" ? executionRoute.selectedCapabilityId : "none"}`,
		`- execution route reason: ${typeof executionRoute?.reason === "string" ? executionRoute.reason : "n/a"}`,
		`- execution preferred providers: ${Array.isArray((executionRoute as { executionBinding?: { preferredProviderIds?: unknown } } | null)?.executionBinding?.preferredProviderIds) ? ((executionRoute as { executionBinding: { preferredProviderIds: string[] } }).executionBinding.preferredProviderIds.join(", ") || "none") : "none"}`,
		`- execution preferred models: ${Array.isArray((executionRoute as { executionBinding?: { preferredModelIds?: unknown } } | null)?.executionBinding?.preferredModelIds) ? ((executionRoute as { executionBinding: { preferredModelIds: string[] } }).executionBinding.preferredModelIds.join(", ") || "none") : "none"}`,
		`- baseline: ${baseline}`,
		`- observed: ${observed}`,
		`- delta: ${delta}`,
		`- decision: ${experiment.decision}`,
		`- council verdict: ${experiment.councilVerdict}`,
		finalizeSummary,
		`- packed runtime: ${packRuntime}`,
		`- packed source: ${packSource}`,
		`- packed savings: ${packSavings}`,
	].join("\n") + packSummary;
}
