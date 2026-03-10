/**
 * Packing and persistence helpers for research workflows.
 */

import { dynamicImport } from "./chitragupta-nodes.js";
import type { ResearchScope } from "./chitragupta-nodes-research-shared.js";
import {
	buildResearchExperimentRecord,
	buildResearchRecord,
} from "./chitragupta-nodes-research-records.js";
import { councilLucyRecommendation, withDaemonClient } from "./chitragupta-nodes-research-daemon.js";

const DAEMON_UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES", "EPIPE", "ECONNRESET"]);

function normalizeStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
	return normalized.length > 0 ? normalized : undefined;
}

function shouldFallbackToLocalResearchRecording(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (typeof code === "string" && DAEMON_UNAVAILABLE_CODES.has(code)) return true;
	if (!(error instanceof Error)) return false;
	return /daemon unavailable|connect econnrefused|enoent|eacces|epipe|econnreset|socket hang up|socket closed/i.test(
		error.message.toLowerCase(),
	);
}

export async function packResearchContext(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const route = council.executionRoute && typeof council.executionRoute === "object"
		? council.executionRoute as {
			routeClass?: unknown;
			capability?: unknown;
			selectedCapabilityId?: unknown;
		}
		: null;
	const text = [
		`topic: ${scope.topic}`,
		`hypothesis: ${scope.hypothesis}`,
		`session id: ${typeof council.sessionId === "string" ? council.sessionId : "none"}`,
		`council verdict: ${String(council.finalVerdict ?? "unknown")}`,
		`lucy recommendation: ${councilLucyRecommendation(council)}`,
		`route class: ${typeof route?.routeClass === "string" ? route.routeClass : "none"}`,
		`route capability: ${typeof route?.capability === "string" ? route.capability : "none"}`,
		`route selected capability: ${typeof route?.selectedCapabilityId === "string" ? route.selectedCapabilityId : "none"}`,
		`metric: ${scope.metricName} (${scope.objective})`,
		`target files: ${scope.targetFiles.join(", ")}`,
		`immutable files: ${scope.immutableFiles.join(", ")}`,
		typeof evaluation?.baselineMetric === "number" ? `baseline: ${evaluation.baselineMetric}` : "",
		typeof evaluation?.observedMetric === "number" ? `observed: ${evaluation.observedMetric}` : "",
		typeof evaluation?.delta === "number" ? `delta: ${evaluation.delta}` : "",
		typeof evaluation?.decision === "string" ? `decision: ${evaluation.decision}` : "",
		`stdout:\n${String(run.stdout ?? "").slice(0, 8_000)}`,
		`stderr:\n${String(run.stderr ?? "").slice(0, 4_000)}`,
	].filter(Boolean).join("\n\n").trim();
	if (!text) {
		return { packed: false, runtime: null, savings: 0, sourceLength: 0, source: "none" };
	}
	const daemonPacked = await withDaemonClient(async (client) => {
		try {
			return await client.call("compression.pack_context", { text }) as Record<string, unknown>;
		} catch {
			return null;
		}
	});
	if (daemonPacked) {
		const packedText = typeof daemonPacked.packedText === "string" ? daemonPacked.packedText : null;
		return {
			...daemonPacked,
			packed: daemonPacked.packed === false ? false : packedText !== null,
			packedText: packedText ?? undefined,
			sourceLength: text.length,
			source: "daemon",
		};
	}
	const { packLiveContextText } = await dynamicImport("@chitragupta/smriti");
	const localPacked = await packLiveContextText(text);
	if (!localPacked) {
		return { packed: false, runtime: null, savings: 0, sourceLength: text.length, source: "fallback" };
	}
	return {
		packed: true,
		runtime: localPacked.runtime,
		savings: localPacked.savings,
		sourceLength: text.length,
		packedText: localPacked.packedText,
		source: "fallback",
	};
}

export async function recordResearchOutcome(
	scope: ResearchScope,
	council: Record<string, unknown>,
	run: Record<string, unknown>,
	evaluation: Record<string, unknown>,
	finalize: Record<string, unknown> | null,
	packed: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const experimentRecord = buildResearchExperimentRecord(scope, council, run, evaluation, finalize, packed);
	const entry = buildResearchRecord(scope, council, run, evaluation, finalize, packed);
	let daemonRecorded: Record<string, unknown> | null = null;
	try {
		daemonRecorded = await withDaemonClient(async (client) => {
			const outcome = await client.call("research.outcome.record", {
			projectPath: scope.projectPath,
			hypothesis: scope.hypothesis,
			topic: experimentRecord.topic,
			metricName: experimentRecord.metricName,
			objective: experimentRecord.objective,
			decision: experimentRecord.decision,
			entry,
			agentId: "prana:autoresearch",
			traceContent: `${scope.hypothesis}\nDecision: ${String(evaluation.decision ?? "record")}\nMetric: ${String(evaluation.observedMetric ?? "unknown")}`,
			traceMetadata: {
				projectPath: scope.projectPath,
				metricName: scope.metricName,
				objective: scope.objective,
				decision: evaluation.decision ?? "record",
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
			},
			sessionId: experimentRecord.sessionId,
			parentSessionId: experimentRecord.parentSessionId,
			sessionLineageKey: experimentRecord.sessionLineageKey,
			experimentKey: experimentRecord.experimentKey,
			budgetMs: experimentRecord.budgetMs,
			sabhaId: experimentRecord.sabhaId,
			councilVerdict: experimentRecord.councilVerdict,
			routeClass: experimentRecord.route?.routeClass ?? null,
			executionRouteClass: experimentRecord.executionRoute?.routeClass ?? null,
			selectedCapabilityId: experimentRecord.executionRoute?.selectedCapabilityId ?? experimentRecord.route?.selectedCapabilityId ?? null,
			selectedModelId: experimentRecord.executionRoute?.executionBinding?.selectedModelId ?? null,
			selectedProviderId: experimentRecord.executionRoute?.executionBinding?.selectedProviderId ?? null,
			baselineMetric: experimentRecord.baselineMetric,
			observedMetric: experimentRecord.observedMetric,
			delta: experimentRecord.delta,
			packedContext: typeof packed.packedText === "string" ? packed.packedText : null,
			packedRuntime: experimentRecord.packing.runtime,
			packedSource: experimentRecord.packing.source,
			record: experimentRecord as unknown as Record<string, unknown>,
		}) as { traceId: string; experimentId: string };
			return {
				...(typeof outcome === "object" && outcome !== null ? outcome : {}),
				recorded: true,
				decision: evaluation.decision ?? "record",
				finalizeAction: typeof finalize?.action === "string" ? finalize.action : null,
				experimentRecord,
				source: "daemon",
			};
		});
	} catch (error) {
		if (!shouldFallbackToLocalResearchRecording(error)) throw error;
		daemonRecorded = null;
	}
	if (daemonRecorded) return daemonRecorded;

	const { appendMemory, AkashaField, DatabaseManager, upsertResearchExperiment } = await dynamicImport("@chitragupta/smriti");
	await appendMemory({ type: "project", path: scope.projectPath }, entry, { dedupe: false });
	const db = DatabaseManager.instance().get("agent");
	const akasha = new AkashaField();
	akasha.restore(db);
	const trace = akasha.leave(
		"prana:autoresearch",
		evaluation.decision === "keep" ? "pattern" : "correction",
		scope.topic,
		`${scope.hypothesis}\nDecision: ${String(evaluation.decision ?? "record")}\nMetric: ${String(evaluation.observedMetric ?? "unknown")}`,
		{
			projectPath: scope.projectPath,
			metricName: scope.metricName,
			objective: scope.objective,
			decision: evaluation.decision ?? "record",
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
		},
	);
	akasha.persist(db);
	const experiment = upsertResearchExperiment({
		projectPath: scope.projectPath,
		experimentKey: experimentRecord.experimentKey,
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
		executionRouteClass: experimentRecord.executionRoute?.routeClass ?? null,
		selectedCapabilityId: experimentRecord.executionRoute?.selectedCapabilityId ?? experimentRecord.route?.selectedCapabilityId ?? null,
		selectedModelId: experimentRecord.executionRoute?.executionBinding?.selectedModelId ?? null,
		selectedProviderId: experimentRecord.executionRoute?.executionBinding?.selectedProviderId ?? null,
		baselineMetric: experimentRecord.baselineMetric,
		observedMetric: experimentRecord.observedMetric,
		delta: experimentRecord.delta,
		packedContext: typeof packed.packedText === "string" ? packed.packedText : null,
		packedRuntime: experimentRecord.packing.runtime,
		packedSource: experimentRecord.packing.source,
		record: experimentRecord as unknown as Record<string, unknown>,
	});
	return {
		recorded: true,
		memoryScope: "project",
		traceId: trace.id,
		experimentId: experiment.id,
		decision: evaluation.decision ?? "record",
		finalizeAction: typeof finalize?.action === "string" ? finalize.action : null,
		experimentRecord,
		source: "fallback",
	};
}
