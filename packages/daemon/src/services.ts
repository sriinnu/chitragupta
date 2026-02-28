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

const log = createLogger("daemon:services");

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
	registerWriteMethods(router);

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
		const sinceTurn = Number(params.sinceTurnNumber ?? 0);
		if (!sessionId) throw new Error("Missing sessionId");
		return { turns: store.getTurnsSince(sessionId, sinceTurn) };
	}, "Get turns since a given turn number");
}

/** Memory recall and search methods. */
function registerMemoryMethods(
	router: RpcRouter,
	db: typeof import("@chitragupta/smriti/session-db"),
): void {
	router.register("memory.search", async (params) => {
		const query = String(params.query ?? "");
		const limit = Number(params.limit ?? 10);
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
		const limit = Number(params.limit ?? 5);
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
