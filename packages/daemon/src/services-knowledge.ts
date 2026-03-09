import type { RpcRouter } from "./rpc-router.js";
import { knownProjectsFromStore } from "./services-read.js";
import {
	normalizeProjectPath,
	parseLimit,
	resolveProjectKey,
} from "./services-helpers.js";
import { getSharedAkasha, getSharedBuddhi, persistSharedAkasha } from "./services-knowledge-state.js";

function resolveProjectAgainstKnown(project: string, knownProjects: readonly string[]): string {
	const normalized = normalizeProjectPath(project);
	if (!normalized) return "";
	return resolveProjectKey(normalized, knownProjects);
}

/** Knowledge lifecycle methods (Akasha, Buddhi, Vidhis + consolidation) via single-writer daemon. */
export function registerKnowledgeMethods(
	router: RpcRouter,
	store: typeof import("@chitragupta/smriti/session-store"),
): void {
	const resolveWithStore = (project: string): string =>
		resolveProjectAgainstKnown(project, knownProjectsFromStore(store));

	router.register("akasha.query", async (params) => {
		const topic = String(params.topic ?? "").trim();
		if (!topic) throw new Error("Missing topic");
		const type = typeof params.type === "string" && params.type.trim()
			? params.type.trim() as unknown as import("@chitragupta/smriti").TraceType
			: undefined;
		const limit = parseLimit(params.limit, 20, 200);
		const akasha = await getSharedAkasha();
		return { traces: akasha.query(topic, { type, limit }) };
	}, "Query Akasha traces");

	router.register("akasha.strongest", async (params) => {
		const limit = parseLimit(params.limit, 20, 200);
		const akasha = await getSharedAkasha();
		return { traces: akasha.strongest(limit) };
	}, "List strongest Akasha traces");

	router.register("akasha.leave", async (params) => {
		const agentId = String(params.agentId ?? "").trim();
		const traceType = String(params.type ?? "").trim() as unknown as import("@chitragupta/smriti").TraceType;
		const topic = String(params.topic ?? "").trim();
		const content = String(params.content ?? "").trim();
		if (!agentId || !traceType || !topic || !content) {
			throw new Error("Missing agentId, type, topic, or content");
		}
		const metadata =
			typeof params.metadata === "object" && params.metadata !== null && !Array.isArray(params.metadata)
				? params.metadata as Record<string, unknown>
				: undefined;
		const akasha = await getSharedAkasha();
		const trace = akasha.leave(agentId, traceType, topic, content, metadata);
		await persistSharedAkasha();
		router.notify("akasha.trace_added", {
			type: "trace_added",
			trace,
		});
		return { trace };
	}, "Leave an Akasha trace through the daemon");

	router.register("akasha.stats", async () => {
		const akasha = await getSharedAkasha();
		return akasha.stats();
	}, "Read Akasha statistics");

	router.register("buddhi.record", async (params) => {
		const category = String(params.category ?? "").trim();
		const sessionId = String(params.sessionId ?? "").trim();
		const project = String(params.project ?? "").trim();
		const description = String(params.description ?? "").trim();
		const confidence = Number(params.confidence ?? 0);
		const reasoning =
			typeof params.reasoning === "object" && params.reasoning !== null && !Array.isArray(params.reasoning)
				? params.reasoning as Record<string, unknown>
				: null;
		if (!category || !sessionId || !project || !description || !reasoning) {
			throw new Error("Missing Buddhi decision fields");
		}
		const alternatives = Array.isArray(params.alternatives)
			? params.alternatives as Array<{ description: string; reason_rejected: string }>
			: undefined;
		const metadata =
			typeof params.metadata === "object" && params.metadata !== null && !Array.isArray(params.metadata)
				? params.metadata as Record<string, unknown>
				: undefined;
		const { DatabaseManager } = await import("@chitragupta/smriti");
		const dbm = DatabaseManager.instance();
		const buddhi = getSharedBuddhi();
		const decision = buddhi.recordDecision({
			sessionId,
			project,
			category: category as import("@chitragupta/anina").DecisionCategory,
			description,
			reasoning: reasoning as unknown as import("@chitragupta/anina").NyayaReasoning,
			confidence,
			alternatives,
			metadata,
		}, dbm);
		return { decision };
	}, "Record a Buddhi decision through the daemon");

	router.register("buddhi.list", async (params) => {
		const projectInput = typeof params.project === "string" ? params.project : undefined;
		const project = projectInput ? resolveWithStore(projectInput) : undefined;
		const category = typeof params.category === "string" ? params.category : undefined;
		const limit = parseLimit(params.limit, 20, 200);
		const { DatabaseManager } = await import("@chitragupta/smriti");
		const dbm = DatabaseManager.instance();
		const buddhi = getSharedBuddhi();
		return { decisions: buddhi.listDecisions({ project, category: category as never, limit }, dbm) };
	}, "List Buddhi decisions");

	router.register("buddhi.get", async (params) => {
		const id = String(params.id ?? "").trim();
		if (!id) throw new Error("Missing id");
		const { DatabaseManager } = await import("@chitragupta/smriti");
		const dbm = DatabaseManager.instance();
		const buddhi = getSharedBuddhi();
		return { decision: buddhi.getDecision(id, dbm) };
	}, "Get a Buddhi decision by id");

	router.register("buddhi.explain", async (params) => {
		const id = String(params.id ?? "").trim();
		if (!id) throw new Error("Missing id");
		const { DatabaseManager } = await import("@chitragupta/smriti");
		const dbm = DatabaseManager.instance();
		const buddhi = getSharedBuddhi();
		return { explanation: buddhi.explainDecision(id, dbm) };
	}, "Explain a Buddhi decision");

	router.register("vidhi.list", async (params) => {
		const project = resolveWithStore(String(params.project ?? ""));
		const limit = parseLimit(params.limit, 10, 100);
		if (!project) throw new Error("Missing project");
		const { VidhiEngine } = await import("@chitragupta/smriti");
		const engine = new VidhiEngine({ project });
		return { vidhis: engine.getVidhis(project, limit) };
	}, "List learned procedures (vidhis) for a project");

	router.register("vidhi.match", async (params) => {
		const project = resolveWithStore(String(params.project ?? ""));
		const query = String(params.query ?? "");
		if (!project) throw new Error("Missing project");
		if (!query) throw new Error("Missing query");
		const { VidhiEngine } = await import("@chitragupta/smriti");
		const engine = new VidhiEngine({ project });
		return { match: engine.match(query) ?? null };
	}, "Match a learned procedure (vidhi) for a query");

	router.register("consolidation.run", async (params) => {
		const project = resolveWithStore(String(params.project ?? ""));
		const sessionCount = parseLimit(params.sessionCount, 10, 100);
		if (!project) throw new Error("Missing project");

		const { ConsolidationEngine, VidhiEngine } = await import("@chitragupta/smriti");
		const consolidator = new ConsolidationEngine();
		consolidator.load();

		const recentMetas = store.listSessions(project).slice(0, sessionCount);
		const sessions: Array<Record<string, unknown>> = [];
		for (const meta of recentMetas) {
			try {
				const loaded = store.loadSession(String(meta.id), project);
				if (loaded) sessions.push(loaded as unknown as Record<string, unknown>);
			} catch {
				// Skip unreadable sessions in consolidation pass.
			}
		}

		if (sessions.length === 0) {
			return {
				sessionsAnalyzed: 0,
				newRulesCount: 0,
				reinforcedRulesCount: 0,
				weakenedRulesCount: 0,
				patternsDetectedCount: 0,
				newRulesPreview: [] as string[],
				vidhisNewCount: 0,
				vidhisReinforcedCount: 0,
			};
		}

		const result = consolidator.consolidate(
			sessions as unknown as import("@chitragupta/smriti/types").Session[],
		);
		consolidator.decayRules();
		consolidator.pruneRules();
		consolidator.save();

		let vidhisNewCount = 0;
		let vidhisReinforcedCount = 0;
		try {
			const vidhiEngine = new VidhiEngine({ project });
			const vidhiResult = vidhiEngine.extract();
			vidhisNewCount = vidhiResult.newVidhis.length;
			vidhisReinforcedCount = vidhiResult.reinforced.length;
		} catch {
			// Optional — consolidation still succeeds without vidhi extraction.
		}

		return {
			sessionsAnalyzed: result.sessionsAnalyzed,
			newRulesCount: result.newRules.length,
			reinforcedRulesCount: result.reinforcedRules.length,
			weakenedRulesCount: result.weakenedRules.length,
			patternsDetectedCount: result.patternsDetected.length,
			newRulesPreview: result.newRules.slice(0, 20).map((rule) => `[${rule.category}] ${rule.rule}`),
			vidhisNewCount,
			vidhisReinforcedCount,
		};
	}, "Run Swapna consolidation and Vidhi extraction for a project");
}
