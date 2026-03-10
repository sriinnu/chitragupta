import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath, parseLimit } from "./services-helpers.js";

type ExpandableExperiment = {
	id: string;
	packedContext?: string | null;
};

async function expandPackedContext<T extends ExpandableExperiment>(
	experiment: T,
): Promise<T & { expandedPackedContext?: string | null }> {
	if (!experiment.packedContext?.trim()) return experiment;
	try {
		const { autoProcessTextThroughPolicy } = await import("@chitragupta/smriti");
		const expanded = await autoProcessTextThroughPolicy({ text: experiment.packedContext });
		if (typeof expanded.result === "string" && expanded.result.trim()) {
			return { ...experiment, expandedPackedContext: expanded.result };
		}
	} catch {
		// Best-effort: keep the stored packed form when expansion is unavailable.
	}
	return experiment;
}

export function registerResearchMethods(router: RpcRouter): void {
	router.register("research.experiments.record", async (params) => {
		const projectPath = normalizeProjectPath(typeof params.projectPath === "string" ? params.projectPath : "");
		const topic = typeof params.topic === "string" ? params.topic.trim() : "";
		const metricName = typeof params.metricName === "string" ? params.metricName.trim() : "";
		const objective = typeof params.objective === "string" ? params.objective.trim() : "";
		const decision = typeof params.decision === "string" ? params.decision.trim() : "";
		const record = params.record && typeof params.record === "object"
			? params.record as Record<string, unknown>
			: null;
		if (!projectPath || !topic || !metricName || !objective || !decision || !record) {
			throw new Error("Missing research experiment fields");
		}

		const { upsertResearchExperiment } = await import("@chitragupta/smriti");
		const experiment = upsertResearchExperiment({
			projectPath,
			experimentKey:
				typeof params.experimentKey === "string" ? params.experimentKey : null,
			budgetMs:
				typeof params.budgetMs === "number" ? params.budgetMs : null,
			topic,
			metricName,
			objective,
			decision,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
			parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : null,
			sessionLineageKey: typeof params.sessionLineageKey === "string" ? params.sessionLineageKey : null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
			councilVerdict: typeof params.councilVerdict === "string" ? params.councilVerdict : null,
			routeClass: typeof params.routeClass === "string" ? params.routeClass : null,
			executionRouteClass: typeof params.executionRouteClass === "string" ? params.executionRouteClass : null,
			selectedCapabilityId: typeof params.selectedCapabilityId === "string" ? params.selectedCapabilityId : null,
			selectedModelId: typeof params.selectedModelId === "string" ? params.selectedModelId : null,
			selectedProviderId: typeof params.selectedProviderId === "string" ? params.selectedProviderId : null,
			baselineMetric: typeof params.baselineMetric === "number" ? params.baselineMetric : null,
			observedMetric: typeof params.observedMetric === "number" ? params.observedMetric : null,
			delta: typeof params.delta === "number" ? params.delta : null,
			packedContext: typeof params.packedContext === "string" ? params.packedContext : null,
			packedRuntime: typeof params.packedRuntime === "string" ? params.packedRuntime : null,
			packedSource: typeof params.packedSource === "string" ? params.packedSource : null,
			record,
		});
		return { experiment };
	}, "Persist a bounded research experiment record into the canonical engine ledger");

	router.register("research.outcome.record", async (params) => {
		const projectPath = normalizeProjectPath(typeof params.projectPath === "string" ? params.projectPath : "");
		const topic = typeof params.topic === "string" ? params.topic.trim() : "";
		const metricName = typeof params.metricName === "string" ? params.metricName.trim() : "";
		const objective = typeof params.objective === "string" ? params.objective.trim() : "";
		const decision = typeof params.decision === "string" ? params.decision.trim() : "";
		const hypothesis = typeof params.hypothesis === "string" ? params.hypothesis.trim() : "";
		const content = typeof params.traceContent === "string" ? params.traceContent.trim() : "";
		const entry = typeof params.entry === "string" ? params.entry : "";
		const record =
			params.record && typeof params.record === "object"
				? params.record as Record<string, unknown>
				: null;
		if (!projectPath || !topic || !metricName || !objective || !decision || !hypothesis || !content || !entry || !record) {
			throw new Error("Missing research outcome fields");
		}
		const {
			appendMemory,
			AkashaField,
			DatabaseManager,
			upsertResearchExperiment,
		} = await import("@chitragupta/smriti");
		await appendMemory({ type: "project", path: projectPath }, entry, { dedupe: false });
		const db = DatabaseManager.instance().get("agent");
		const akasha = new AkashaField();
		akasha.restore(db);
		const trace = akasha.leave(
			String(params.agentId ?? "prana:autoresearch"),
			decision === "keep" ? "pattern" : "correction",
			topic,
			content,
			typeof params.traceMetadata === "object" && params.traceMetadata !== null && !Array.isArray(params.traceMetadata)
				? params.traceMetadata as Record<string, unknown>
				: undefined,
		);
		akasha.persist(db);
		const experiment = upsertResearchExperiment({
			projectPath,
			experimentKey:
				typeof params.experimentKey === "string" ? params.experimentKey : null,
			budgetMs:
				typeof params.budgetMs === "number" ? params.budgetMs : null,
			topic,
			metricName,
			objective,
			decision,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
			parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : null,
			sessionLineageKey: typeof params.sessionLineageKey === "string" ? params.sessionLineageKey : null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
			councilVerdict: typeof params.councilVerdict === "string" ? params.councilVerdict : null,
			routeClass: typeof params.routeClass === "string" ? params.routeClass : null,
			executionRouteClass: typeof params.executionRouteClass === "string" ? params.executionRouteClass : null,
			selectedCapabilityId: typeof params.selectedCapabilityId === "string" ? params.selectedCapabilityId : null,
			selectedModelId: typeof params.selectedModelId === "string" ? params.selectedModelId : null,
			selectedProviderId: typeof params.selectedProviderId === "string" ? params.selectedProviderId : null,
			baselineMetric: typeof params.baselineMetric === "number" ? params.baselineMetric : null,
			observedMetric: typeof params.observedMetric === "number" ? params.observedMetric : null,
			delta: typeof params.delta === "number" ? params.delta : null,
			packedContext: typeof params.packedContext === "string" ? params.packedContext : null,
			packedRuntime: typeof params.packedRuntime === "string" ? params.packedRuntime : null,
			packedSource: typeof params.packedSource === "string" ? params.packedSource : null,
			record,
		});
		return {
			recorded: true,
			memoryScope: "project",
			traceId: trace.id,
			experimentId: experiment.id,
			experiment,
		};
	}, "Atomically record research outcome artifacts through the daemon-owned memory and ledger path");

	router.register("research.experiments.list", async (params) => {
		const { listResearchExperiments } = await import("@chitragupta/smriti");
		const experiments = listResearchExperiments({
			projectPath: typeof params.projectPath === "string" ? normalizeProjectPath(params.projectPath) : undefined,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
			decision: typeof params.decision === "string" ? params.decision : undefined,
			limit: parseLimit(params.limit, 10, 100),
		});
		if (params.expandPackedContext !== true) {
			return { experiments };
		}
		return {
			experiments: await Promise.all(experiments.map((experiment) => expandPackedContext(experiment))),
		};
	}, "List bounded research experiments from the canonical engine ledger");
}
