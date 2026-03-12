import { dynamicImport } from "./chitragupta-nodes.js";
import type { ResearchScope } from "./chitragupta-nodes-research-shared.js";

export function normalizeStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
	return normalized.length > 0 ? normalized : undefined;
}

type TraceMetadataExtras = Record<string, unknown>;

function plannerRouteMetadata(council: Record<string, unknown>): TraceMetadataExtras {
	return {
		plannerRouteClass: typeof (council.plannerRoute as { routeClass?: unknown } | undefined)?.routeClass === "string"
			? (council.plannerRoute as { routeClass: string }).routeClass
			: null,
		plannerSelectedCapabilityId: typeof (council.plannerRoute as { selectedCapabilityId?: unknown } | undefined)?.selectedCapabilityId === "string"
			? (council.plannerRoute as { selectedCapabilityId: string }).selectedCapabilityId
			: null,
		plannerSelectedModelId: typeof (council.plannerRoute as { executionBinding?: { selectedModelId?: unknown } } | undefined)?.executionBinding?.selectedModelId === "string"
			? (council.plannerRoute as { executionBinding: { selectedModelId: string } }).executionBinding.selectedModelId
			: null,
		plannerSelectedProviderId: typeof (council.plannerRoute as { executionBinding?: { selectedProviderId?: unknown } } | undefined)?.executionBinding?.selectedProviderId === "string"
			? (council.plannerRoute as { executionBinding: { selectedProviderId: string } }).executionBinding.selectedProviderId
			: null,
	};
}

function executionRouteMetadata(council: Record<string, unknown>): TraceMetadataExtras {
	return {
		routeClass: typeof (council.executionRoute as { routeClass?: unknown } | undefined)?.routeClass === "string"
			? (council.executionRoute as { routeClass: string }).routeClass
			: null,
		selectedCapabilityId: typeof (council.executionRoute as { selectedCapabilityId?: unknown } | undefined)?.selectedCapabilityId === "string"
			? (council.executionRoute as { selectedCapabilityId: string }).selectedCapabilityId
			: null,
		selectedModelId: typeof (council.executionRoute as { executionBinding?: { selectedModelId?: unknown } } | undefined)?.executionBinding?.selectedModelId === "string"
			? (council.executionRoute as { executionBinding: { selectedModelId: string } }).executionBinding.selectedModelId
			: null,
		selectedProviderId: typeof (council.executionRoute as { executionBinding?: { selectedProviderId?: unknown } } | undefined)?.executionBinding?.selectedProviderId === "string"
			? (council.executionRoute as { executionBinding: { selectedProviderId: string } }).executionBinding.selectedProviderId
			: null,
		executionBindingSource: typeof (council.executionRoute as { executionBinding?: { source?: unknown } } | undefined)?.executionBinding?.source === "string"
			? (council.executionRoute as { executionBinding: { source: string } }).executionBinding.source
			: null,
		preferredModelIds: normalizeStringList((council.executionRoute as { executionBinding?: { preferredModelIds?: unknown } } | undefined)?.executionBinding?.preferredModelIds) ?? null,
		preferredProviderIds: normalizeStringList((council.executionRoute as { executionBinding?: { preferredProviderIds?: unknown } } | undefined)?.executionBinding?.preferredProviderIds) ?? null,
	};
}

/**
 * Build the trace metadata shared by daemon recording and local fallback persistence.
 */
export function buildResearchTraceMetadata(args: {
	scope: ResearchScope;
	council: Record<string, unknown>;
	packed: Record<string, unknown>;
	finalize: Record<string, unknown> | null;
	extras?: TraceMetadataExtras;
}): TraceMetadataExtras {
	const { scope, council, packed, finalize, extras = {} } = args;
	return {
		projectPath: scope.projectPath,
		metricName: scope.metricName,
		objective: scope.objective,
		finalizeAction: typeof finalize?.action === "string" ? finalize.action : null,
		workflow: "autoresearch",
		packedRuntime: packed.runtime ?? null,
		packedSource: packed.source ?? null,
		packedSourceLength: typeof packed.sourceLength === "number" ? packed.sourceLength : null,
		packedDeclinedReason: typeof packed.reason === "string" ? packed.reason : null,
		councilVerdict: council.finalVerdict ?? null,
		sessionId: typeof council.sessionId === "string" ? council.sessionId : null,
		parentSessionId: scope.parentSessionId,
		sessionLineageKey: scope.sessionLineageKey,
		loopKey: scope.loopKey,
		roundNumber: scope.roundNumber,
		totalRounds: scope.totalRounds,
		...plannerRouteMetadata(council),
		...executionRouteMetadata(council),
		...extras,
	};
}

/**
 * Build the daemon RPC payload for recording a research experiment outcome.
 */
export function buildResearchOutcomePayload(args: {
	scope: ResearchScope;
	council: Record<string, unknown>;
	experimentRecord: Record<string, any>;
	entry: string;
	packed: Record<string, unknown>;
	traceContent: string;
	traceMetadata: TraceMetadataExtras;
}): Record<string, unknown> {
	const { scope, experimentRecord, entry, packed, traceContent, traceMetadata } = args;
	return {
		projectPath: scope.projectPath,
		hypothesis: scope.hypothesis,
		topic: experimentRecord.topic,
		metricName: experimentRecord.metricName,
		objective: experimentRecord.objective,
		decision: experimentRecord.decision,
		entry,
		agentId: "prana:autoresearch",
		traceContent,
		traceMetadata,
		sessionId: experimentRecord.sessionId,
		parentSessionId: experimentRecord.parentSessionId,
		sessionLineageKey: experimentRecord.sessionLineageKey,
		loopKey: experimentRecord.loopKey,
		roundNumber: experimentRecord.roundNumber,
		totalRounds: experimentRecord.totalRounds,
		experimentKey: experimentRecord.experimentKey,
		attemptKey: experimentRecord.attemptKey,
		attemptNumber: experimentRecord.attemptNumber,
		budgetMs: experimentRecord.budgetMs,
		sabhaId: experimentRecord.sabhaId,
		councilVerdict: experimentRecord.councilVerdict,
		routeClass: experimentRecord.route?.routeClass ?? null,
		plannerRouteClass: experimentRecord.plannerRoute?.routeClass ?? null,
		plannerSelectedCapabilityId: experimentRecord.plannerRoute?.selectedCapabilityId ?? null,
		plannerSelectedModelId: experimentRecord.plannerRoute?.executionBinding?.selectedModelId ?? null,
		plannerSelectedProviderId: experimentRecord.plannerRoute?.executionBinding?.selectedProviderId ?? null,
		executionRouteClass: experimentRecord.executionRoute?.routeClass ?? null,
		selectedCapabilityId: experimentRecord.executionRoute?.selectedCapabilityId ?? experimentRecord.route?.selectedCapabilityId ?? null,
		selectedModelId: experimentRecord.executionRoute?.executionBinding?.selectedModelId ?? null,
		selectedProviderId: experimentRecord.executionRoute?.executionBinding?.selectedProviderId ?? null,
		gitBranch: experimentRecord.run.gitBranch,
		gitHeadCommit: experimentRecord.run.gitHeadCommit,
		gitDirtyBefore: experimentRecord.run.gitDirtyBefore,
		gitDirtyAfter: experimentRecord.run.gitDirtyAfter,
		baselineMetric: experimentRecord.baselineMetric,
		observedMetric: experimentRecord.observedMetric,
		delta: experimentRecord.delta,
		status: experimentRecord.status,
		errorMessage: experimentRecord.errorMessage,
		packedContext: typeof packed.packedText === "string" ? packed.packedText : null,
		packedRuntime: experimentRecord.packing.runtime,
		packedSource: experimentRecord.packing.source,
		record: experimentRecord as Record<string, unknown>,
	};
}

/**
 * Persist a research outcome locally when the daemon is unavailable but only then.
 */
export async function persistResearchFallback(args: {
	scope: ResearchScope;
	entry: string;
	experimentRecord: Record<string, any>;
	traceType: "pattern" | "correction";
	traceContent: string;
	traceMetadata: TraceMetadataExtras;
	packed: Record<string, unknown>;
	decision?: string;
	finalizeAction?: string | null;
}): Promise<Record<string, unknown>> {
	const { scope, entry, experimentRecord, traceType, traceContent, traceMetadata, packed, decision, finalizeAction } = args;
	const { appendMemory, AkashaField, DatabaseManager, upsertResearchExperiment } = await dynamicImport("@chitragupta/smriti");
	await appendMemory({ type: "project", path: scope.projectPath }, entry, { dedupe: false });
	const db = DatabaseManager.instance().get("agent");
	const akasha = new AkashaField();
	akasha.restore(db);
	const trace = akasha.leave("prana:autoresearch", traceType, scope.topic, traceContent, traceMetadata);
	akasha.persist(db);
	const experiment = upsertResearchExperiment({
		projectPath: scope.projectPath,
		experimentKey: experimentRecord.experimentKey,
		attemptKey: experimentRecord.attemptKey,
		loopKey: experimentRecord.loopKey,
		roundNumber: experimentRecord.roundNumber,
		totalRounds: experimentRecord.totalRounds,
		attemptNumber: experimentRecord.attemptNumber,
		budgetMs: experimentRecord.budgetMs,
		topic: experimentRecord.topic,
		metricName: experimentRecord.metricName,
		objective: experimentRecord.objective,
		decision: experimentRecord.decision,
		sessionId: experimentRecord.sessionId,
		parentSessionId: experimentRecord.parentSessionId,
		sessionLineageKey: experimentRecord.sessionLineageKey,
		sabhaId: experimentRecord.sabhaId,
		councilVerdict: experimentRecord.councilVerdict,
		routeClass: experimentRecord.route?.routeClass ?? null,
		plannerRouteClass: experimentRecord.plannerRoute?.routeClass ?? null,
		plannerSelectedCapabilityId: experimentRecord.plannerRoute?.selectedCapabilityId ?? null,
		plannerSelectedModelId: experimentRecord.plannerRoute?.executionBinding?.selectedModelId ?? null,
		plannerSelectedProviderId: experimentRecord.plannerRoute?.executionBinding?.selectedProviderId ?? null,
		executionRouteClass: experimentRecord.executionRoute?.routeClass ?? null,
		selectedCapabilityId: experimentRecord.executionRoute?.selectedCapabilityId ?? experimentRecord.route?.selectedCapabilityId ?? null,
		selectedModelId: experimentRecord.executionRoute?.executionBinding?.selectedModelId ?? null,
		selectedProviderId: experimentRecord.executionRoute?.executionBinding?.selectedProviderId ?? null,
		gitBranch: experimentRecord.run.gitBranch,
		gitHeadCommit: experimentRecord.run.gitHeadCommit,
		gitDirtyBefore: experimentRecord.run.gitDirtyBefore,
		gitDirtyAfter: experimentRecord.run.gitDirtyAfter,
		baselineMetric: experimentRecord.baselineMetric,
		observedMetric: experimentRecord.observedMetric,
		delta: experimentRecord.delta,
		status: experimentRecord.status,
		errorMessage: experimentRecord.errorMessage,
		packedContext: typeof packed.packedText === "string" ? packed.packedText : null,
		packedRuntime: experimentRecord.packing.runtime,
		packedSource: experimentRecord.packing.source,
		record: experimentRecord as Record<string, unknown>,
	});
	return {
		recorded: true,
		memoryScope: "project",
		traceId: trace.id,
		experimentId: experiment.id,
		experimentRecord,
		decision: decision ?? experimentRecord.decision ?? "record",
		finalizeAction: finalizeAction ?? null,
		source: "fallback",
	};
}
