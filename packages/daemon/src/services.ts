/**
 * @chitragupta/daemon — Service layer wiring.
 *
 * Registers smriti-backed RPC methods on the router:
 * session.*, memory.*, turn.*, akasha.*, consolidation.*.
 *
 * @module
 */

import { createLogger } from "@chitragupta/core";
import type { RpcRouter } from "./rpc-router.js";
import { registerTelemetryMethods } from "./services-telemetry.js";

const log = createLogger("daemon:services");

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 200;

function parseNonNegativeInt(value: unknown, field: string, fallback = 0): number {
	const parsed = value == null ? fallback : Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Invalid ${field}`);
	}
	return Math.trunc(parsed);
}

function parseLimit(value: unknown, fallback = DEFAULT_LIMIT, max = MAX_LIMIT): number {
	const parsed = value == null ? fallback : Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error("Invalid limit");
	}
	return Math.min(max, Math.trunc(parsed));
}

/**
 * Register all smriti-backed services on the RPC router.
 *
 * Uses dynamic import so the daemon process owns DB initialization.
 * All database access is single-writer through this process.
 */
export async function registerServices(router: RpcRouter): Promise<void> {
	const sessionStore = await import("@chitragupta/smriti/session-store");
	const sessionDb = await import("@chitragupta/smriti/session-db");

	registerSessionMethods(router, sessionStore, sessionDb);
	registerTurnMethods(router, sessionStore);
	registerMemoryMethods(router, sessionDb);
	registerReadMethods(router);
	registerWriteMethods(router);
	registerKnowledgeMethods(router, sessionStore);
	registerDaemonMethods(router, sessionDb);
	registerTelemetryMethods(router);

	log.info("Services registered", { methods: router.listMethods().length });
}

/** Session CRUD methods. */
function registerSessionMethods(
	router: RpcRouter,
	store: typeof import("@chitragupta/smriti/session-store"),
	_db: typeof import("@chitragupta/smriti/session-db"),
): void {
	router.register("session.list", async (params) => {
		const project = typeof params.project === "string" ? params.project : undefined;
		return { sessions: store.listSessions(project) };
	}, "List sessions, optionally filtered by project");

	router.register("session.show", async (params) => {
		const id = String(params.id ?? "");
		const project = String(params.project ?? "");
		if (!id || !project) throw new Error("Missing id or project");
		return store.loadSession(id, project);
	}, "Load a session by ID and project");

	router.register("session.create", async (params) => {
		const opts = {
			project: String(params.project ?? ""),
			title: typeof params.title === "string" ? params.title : undefined,
			agent: typeof params.agent === "string" ? params.agent : undefined,
			model: typeof params.model === "string" ? params.model : undefined,
			provider: typeof params.provider === "string" ? params.provider : undefined,
			branch: typeof params.branch === "string" ? params.branch : undefined,
		};
		if (!opts.project) throw new Error("Missing project");
		const session = store.createSession(opts);
		return { id: session.meta.id, created: true };
	}, "Create a new session");

	router.register("session.delete", async (params) => {
		const id = String(params.id ?? "");
		const project = String(params.project ?? "");
		if (!id || !project) throw new Error("Missing id or project");
		store.deleteSession(id, project);
		return { deleted: true };
	}, "Delete a session");

	router.register("session.dates", async (params) => {
		const project = typeof params.project === "string" ? params.project : undefined;
		return { dates: store.listSessionDates(project) };
	}, "List available session dates");

	router.register("session.projects", async () => {
		return { projects: store.listSessionProjects() };
	}, "List projects with session counts");

	router.register("session.modified_since", async (params) => {
		const project = String(params.project ?? "");
		const sinceMs = parseNonNegativeInt(params.sinceMs, "sinceMs");
		if (!project) throw new Error("Missing project");
		return { sessions: store.getSessionsModifiedSince(project, sinceMs) };
	}, "Get sessions modified since a timestamp");

	router.register("session.meta.update", async (params) => {
		const id = String(params.id ?? "");
		const updates = (params.updates ?? {}) as Parameters<typeof store.updateSessionMeta>[1];
		if (!id) throw new Error("Missing id");
		store.updateSessionMeta(id, updates);
		return { updated: true };
	}, "Update session metadata");
}

/** Turn read/write methods. */
function registerTurnMethods(
	router: RpcRouter,
	store: typeof import("@chitragupta/smriti/session-store"),
): void {
	router.register("turn.add", async (params) => {
		const sessionId = String(params.sessionId ?? "");
		const project = String(params.project ?? "");
		const turn = params.turn as Parameters<typeof store.addTurn>[2];
		if (!sessionId || !project || !turn) throw new Error("Missing sessionId, project, or turn");
		await store.addTurn(sessionId, project, turn);
		return { added: true };
	}, "Add a turn to a session");

	router.register("turn.list", async (params) => {
		const sessionId = String(params.sessionId ?? "");
		const project = String(params.project ?? "");
		if (!sessionId || !project) throw new Error("Missing sessionId or project");
		return { turns: store.listTurnsWithTimestamps(sessionId, project) };
	}, "List turns with timestamps for a session");

	router.register("turn.since", async (params) => {
		const sessionId = String(params.sessionId ?? "");
		const sinceTurn = parseNonNegativeInt(params.sinceTurnNumber, "sinceTurnNumber");
		if (!sessionId) throw new Error("Missing sessionId");
		return { turns: store.getTurnsSince(sessionId, sinceTurn) };
	}, "Get turns since a given turn number");

	router.register("turn.max_number", async (params) => {
		const sessionId = String(params.sessionId ?? "");
		if (!sessionId) throw new Error("Missing sessionId");
		return { maxTurn: store.getMaxTurnNumber(sessionId) };
	}, "Get max turn number for a session");
}

/** Memory recall and search methods. */
function registerMemoryMethods(
	router: RpcRouter,
	db: typeof import("@chitragupta/smriti/session-db"),
): void {
	router.register("memory.search", async (params) => {
		const query = String(params.query ?? "");
		const limit = parseLimit(params.limit);
		if (!query) throw new Error("Missing query");

		// FTS5 search on turns table
		const agentDb = db.getAgentDb();
		const rows = agentDb.prepare(
			`SELECT t.session_id, t.role, t.content, t.turn_number,
			        rank AS score
			 FROM turns_fts
			 JOIN turns t ON turns_fts.rowid = t.rowid
			 WHERE turns_fts MATCH ?
			 ORDER BY rank
			 LIMIT ?`,
		).all(query, limit) as Array<Record<string, unknown>>;

		return { results: rows };
	}, "Full-text search across all turns");

	router.register("memory.append", async (params) => {
		const scopeType = String(params.scopeType ?? "project");
		const scopePath = typeof params.scopePath === "string" ? params.scopePath : undefined;
		const entry = String(params.entry ?? "");
		if (!entry) throw new Error("Missing entry");

		const memStore = await import("@chitragupta/smriti/memory-store");
		const scope = scopeType === "global"
			? { type: "global" as const }
			: { type: "project" as const, path: scopePath ?? "" };
		await memStore.appendMemory(scope, entry);
		return { appended: true };
	}, "Append entry to memory (project or global scope)");

	router.register("memory.recall", async (params) => {
		const query = String(params.query ?? "");
		const project = typeof params.project === "string" ? params.project : undefined;
		const limit = parseLimit(params.limit, 5);
		if (!query) throw new Error("Missing query");

		const agentDb = db.getAgentDb();

		// Search turns via FTS5
		const whereClause = project
			? `WHERE turns_fts MATCH ? AND t.session_id IN (SELECT id FROM sessions WHERE project = ?)`
			: `WHERE turns_fts MATCH ?`;
		const bindParams = project ? [query, project, limit] : [query, limit];

		const rows = agentDb.prepare(
			`SELECT t.session_id, t.role, t.content, t.turn_number,
			        rank AS score
			 FROM turns_fts
			 JOIN turns t ON turns_fts.rowid = t.rowid
			 ${whereClause}
			 ORDER BY rank
			 LIMIT ?`,
		).all(...bindParams) as Array<Record<string, unknown>>;

		return { results: rows, query, project };
	}, "Recall memories relevant to a query");
}

/** Read-through methods for memory files, day files, recall, and context. */
function registerReadMethods(router: RpcRouter): void {
	router.register("memory.unified_recall", async (params) => {
		const query = String(params.query ?? "");
		const project = typeof params.project === "string" ? params.project : undefined;
		const limit = parseLimit(params.limit, 5);
		if (!query) throw new Error("Missing query");
		const { recall } = await import("@chitragupta/smriti/unified-recall");
		const results = await recall(query, { limit, project });
		return { results };
	}, "Unified recall across all memory layers");

	router.register("memory.file_search", async (params) => {
		const query = String(params.query ?? "");
		if (!query) throw new Error("Missing query");
		const { searchMemory } = await import("@chitragupta/smriti/search");
		const results = searchMemory(query);
		return { results };
	}, "Search memory markdown files");

	router.register("memory.scopes", async () => {
		const { listMemoryScopes } = await import("@chitragupta/smriti/memory-store");
		return { scopes: listMemoryScopes() };
	}, "List available memory scopes");

	router.register("day.show", async (params) => {
		const date = String(params.date ?? "");
		if (!date) throw new Error("Missing date");
		const { readDayFile } = await import("@chitragupta/smriti/day-consolidation");
		const content = readDayFile(date);
		return { date, content: content ?? null };
	}, "Read a consolidated day file");

	router.register("day.list", async () => {
		const { listDayFiles } = await import("@chitragupta/smriti/day-consolidation");
		return { dates: listDayFiles() };
	}, "List available day files");

	router.register("day.search", async (params) => {
		const query = String(params.query ?? "");
		const limit = parseLimit(params.limit);
		if (!query) throw new Error("Missing query");
		const { searchDayFiles } = await import("@chitragupta/smriti/day-consolidation");
		const results = searchDayFiles(query, { limit });
		return { results };
	}, "Search across day files");

	router.register("context.load", async (params) => {
		const project = String(params.project ?? "");
		if (!project) throw new Error("Missing project");
		const { loadProviderContext } = await import("@chitragupta/smriti/provider-bridge");
		const ctx = await loadProviderContext(project);
		return { assembled: ctx.assembled, itemCount: ctx.itemCount };
	}, "Load provider context for a project");
}

/** Knowledge lifecycle methods (Vidhis + consolidation) via single-writer daemon. */
function registerKnowledgeMethods(
	router: RpcRouter,
	store: typeof import("@chitragupta/smriti/session-store"),
): void {
	router.register("vidhi.list", async (params) => {
		const project = String(params.project ?? "");
		const limit = parseLimit(params.limit, 10, 100);
		if (!project) throw new Error("Missing project");
		const { VidhiEngine } = await import("@chitragupta/smriti");
		const engine = new VidhiEngine({ project });
		return { vidhis: engine.getVidhis(project, limit) };
	}, "List learned procedures (vidhis) for a project");

	router.register("vidhi.match", async (params) => {
		const project = String(params.project ?? "");
		const query = String(params.query ?? "");
		if (!project) throw new Error("Missing project");
		if (!query) throw new Error("Missing query");
		const { VidhiEngine } = await import("@chitragupta/smriti");
		const engine = new VidhiEngine({ project });
		return { match: engine.match(query) ?? null };
	}, "Match a learned procedure (vidhi) for a query");

	router.register("consolidation.run", async (params) => {
		const project = String(params.project ?? "");
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
	}, "Run Svapna consolidation and Vidhi extraction for a project");
}

/** Daemon introspection methods for observability. */
function registerDaemonMethods(
	router: RpcRouter,
	db: typeof import("@chitragupta/smriti/session-db"),
): void {
	router.register("daemon.status", async () => {
		const agentDb = db.getAgentDb();

		/** Count rows in a table, returning 0 if the table doesn't exist. */
		const count = (table: string): number => {
			try {
				const row = agentDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
				return row?.n ?? 0;
			} catch {
				return 0;
			}
		};

		return {
			counts: {
				turns: count("turns"),
				sessions: count("sessions"),
				rules: count("rules"),
				vidhis: count("vidhis"),
				samskaras: count("samskaras"),
				vasanas: count("vasanas"),
				akashaTraces: count("akasha_traces"),
			},
			timestamp: Date.now(),
		};
	}, "Aggregated DB table counts for observability dashboards");
}

/** Write methods that enforce single-writer through daemon. */
function registerWriteMethods(router: RpcRouter): void {
	router.register("fact.extract", async (params) => {
		const text = String(params.text ?? "");
		const projectPath = typeof params.projectPath === "string" ? params.projectPath : undefined;
		if (!text) throw new Error("Missing text");

		const { getFactExtractor } = await import("@chitragupta/smriti/fact-extractor");
		const extractor = getFactExtractor();
		const facts = await extractor.extractAndSave(
			text,
			{ type: "global" },
			projectPath ? { type: "project", path: projectPath } : undefined,
		);
		return { extracted: facts.length, facts };
	}, "Extract and save facts from text (single-writer)");
}
