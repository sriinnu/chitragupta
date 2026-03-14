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
import { registerBindingMethods } from "./services-binding.js";
import { registerKnowledgeMethods } from "./services-knowledge.js";
import { registerContractMethods } from "./services-contract.js";
import { registerCollaborationMethods } from "./services-collaboration.js";
import { registerMeshMethods } from "./services-mesh.js";
import { registerCompressionMethods } from "./services-compression.js";
import { registerDiscoveryMethods } from "./services-discovery.js";
import { registerSemanticMethods } from "./services-semantic.js";
import { registerResearchMethods } from "./services-research.js";
import { registerAgentTaskMethods } from "./services-agent-tasks.js";
import { registerResearchCheckpointMethods } from "./services-research-checkpoints.js";
import {
	registerReadMethods,
	knownProjectsFromStore,
} from "./services-read.js";
import { registerDaemonMethods } from "./services-daemon.js";
import { registerWriteMethods } from "./services-write.js";
import {
	normalizeParams,
	parseNonNegativeInt,
	parseLimit,
} from "./services-helpers.js";
import {
	findReusableSessionId,
	knownProjectsFromDb,
	localDatePrefix,
	normalizeSessionMetadata,
	resolveLineageKey,
	resolveProjectAgainstKnown,
} from "./services-session-helpers.js";

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
	registerReadMethods(router);
	registerWriteMethods(router);
	registerKnowledgeMethods(router, sessionStore);
	registerContractMethods(router);
	registerCollaborationMethods(router);
	registerMeshMethods(router);
	registerCompressionMethods(router);
	registerDiscoveryMethods(router);
	registerSemanticMethods(router);
	registerResearchMethods(router);
	registerAgentTaskMethods(router);
	registerResearchCheckpointMethods(router);
	registerDaemonMethods(router, sessionDb);
	registerTelemetryMethods(router);
	registerBindingMethods(router);

	log.info("Services registered", { methods: router.listMethods().length });
}

/** Session CRUD methods. */
export function registerSessionMethods(
	router: RpcRouter,
	store: typeof import("@chitragupta/smriti/session-store"),
	_db: typeof import("@chitragupta/smriti/session-db"),
): void {
	router.register("session.list", async (params) => {
		const projectInput = typeof params.project === "string" ? params.project : undefined;
		const project = projectInput
			? resolveProjectAgainstKnown(projectInput, knownProjectsFromStore(store))
			: undefined;
		return { sessions: store.listSessions(project) };
	}, "List sessions, optionally filtered by project");

	router.register("session.show", async (params) => {
		const id = String(params.id ?? "");
		const project = resolveProjectAgainstKnown(String(params.project ?? ""), knownProjectsFromStore(store));
		if (!id || !project) throw new Error("Missing id or project");
		return store.loadSession(id, project);
	}, "Load a session by ID and project");

	router.register("session.open", async (params) => {
		const id = typeof params.id === "string" ? params.id.trim() : "";
		if (id) {
			const project = resolveProjectAgainstKnown(String(params.project ?? ""), knownProjectsFromStore(store));
			if (!project) throw new Error("Missing project");
			return {
				session: store.loadSession(id, project),
				created: false,
			};
		}

		const metadata = normalizeSessionMetadata(params);
		const opts = {
			project: String(params.project ?? ""),
			title: typeof params.title === "string" ? params.title : undefined,
			agent: typeof params.agent === "string" ? params.agent : undefined,
			model: typeof params.model === "string" ? params.model : undefined,
			provider: typeof params.provider === "string" ? params.provider : undefined,
			branch: typeof params.branch === "string" ? params.branch : undefined,
			parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : undefined,
			tags: Array.isArray(params.tags) ? params.tags.filter((v): v is string => typeof v === "string") : undefined,
			metadata,
		};
		opts.project = resolveProjectAgainstKnown(opts.project, knownProjectsFromStore(store));
		if (!opts.project) throw new Error("Missing project");
		const lineageKey = resolveLineageKey(params, metadata);
		const reusableSessionId = findReusableSessionId(store, opts.project, lineageKey);
		if (reusableSessionId) {
			return {
				session: store.loadSession(reusableSessionId, opts.project),
				created: false,
			};
		}
		const session = store.createSession(opts);
		return {
			session,
			created: true,
		};
	}, "Open an existing session or create a new one");

	router.register("session.collaborate", async (params) => {
		const metadata = normalizeSessionMetadata(params) ?? {};
		const lineageKey = resolveLineageKey(params, metadata);
		if (!lineageKey) throw new Error("Missing sessionLineageKey or lineageKey");
		const opts = {
			project: String(params.project ?? ""),
			title: typeof params.title === "string" ? params.title : "Shared Collaboration Session",
			agent: typeof params.agent === "string" ? params.agent : undefined,
			model: typeof params.model === "string" ? params.model : undefined,
			provider: typeof params.provider === "string" ? params.provider : undefined,
			branch: typeof params.branch === "string" ? params.branch : undefined,
			parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : undefined,
			tags: Array.isArray(params.tags) ? params.tags.filter((v): v is string => typeof v === "string") : undefined,
			consumer: typeof params.consumer === "string" ? params.consumer : "chitragupta",
			surface: typeof params.surface === "string" ? params.surface : "collaboration",
			channel: typeof params.channel === "string" ? params.channel : "shared",
			actorId: typeof params.actorId === "string" ? params.actorId : undefined,
			metadata: {
				...metadata,
				sessionLineageKey: lineageKey,
				sessionReusePolicy: "same_day",
				collaboration: true,
			},
		};
		opts.project = resolveProjectAgainstKnown(opts.project, knownProjectsFromStore(store));
		if (!opts.project) throw new Error("Missing project");
		const reusableSessionId = findReusableSessionId(store, opts.project, lineageKey);
		if (reusableSessionId) {
			return {
				session: store.loadSession(reusableSessionId, opts.project),
				created: false,
				lineageKey,
				sessionReusePolicy: "same_day",
			};
		}
		const session = store.createSession(opts);
		const created = !reusableSessionId && session.meta.id.startsWith(localDatePrefix());
		return {
			session,
			created,
			lineageKey,
			sessionReusePolicy: "same_day",
		};
	}, "Open or reuse an explicit shared collaboration session for a lineage key");

	router.register("session.create", async (params) => {
			const opts = {
				project: String(params.project ?? ""),
				title: typeof params.title === "string" ? params.title : undefined,
				agent: typeof params.agent === "string" ? params.agent : undefined,
				model: typeof params.model === "string" ? params.model : undefined,
				provider: typeof params.provider === "string" ? params.provider : undefined,
				branch: typeof params.branch === "string" ? params.branch : undefined,
				parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : undefined,
				tags: Array.isArray(params.tags) ? params.tags.filter((v): v is string => typeof v === "string") : undefined,
				metadata: normalizeSessionMetadata(params),
			};
		opts.project = resolveProjectAgainstKnown(opts.project, knownProjectsFromStore(store));
		if (!opts.project) throw new Error("Missing project");
		const session = store.createSession(opts);
		return { id: session.meta.id, created: true };
	}, "Create a new session");

	router.register("session.delete", async (params) => {
		const id = String(params.id ?? "");
		const project = resolveProjectAgainstKnown(String(params.project ?? ""), knownProjectsFromStore(store));
		if (!id || !project) throw new Error("Missing id or project");
		store.deleteSession(id, project);
		return { deleted: true };
	}, "Delete a session");

	router.register("session.dates", async (params) => {
		const projectInput = typeof params.project === "string" ? params.project : undefined;
		const project = projectInput
			? resolveProjectAgainstKnown(projectInput, knownProjectsFromStore(store))
			: undefined;
		return { dates: store.listSessionDates(project) };
	}, "List available session dates");

	router.register("session.projects", async () => {
		return { projects: store.listSessionProjects() };
	}, "List projects with session counts");

	router.register("session.lineage_policy", async () => {
		return {
			defaultReusePolicy: "isolated",
			explicitReusePolicy: "same_day",
			headers: {
				lineage: "x-chitragupta-lineage",
				client: "x-chitragupta-client",
			},
			bodyFields: ["sessionLineageKey", "lineageKey", "sessionReusePolicy", "consumer", "surface", "channel", "actorId"],
			guidance: "Use isolated sessions by default. Reuse a lineage key only for intentional same-thread collaboration across tabs, agents, or surfaces.",
		};
	}, "Describe the canonical session-lineage policy and headers for consumers");

	router.register("session.modified_since", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const project = resolveProjectAgainstKnown(String(params.project ?? ""), knownProjectsFromStore(store));
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
export function registerTurnMethods(
	router: RpcRouter,
	store: typeof import("@chitragupta/smriti/session-store"),
): void {
	const resolveWithStore = (project: string): string =>
		resolveProjectAgainstKnown(project, knownProjectsFromStore(store));

	/**
	 * CPH4 Catalyst — tool_calls persistence fix
	 * Normalize nested turn object to ensure toolCalls survives snake_case
	 * clients (e.g. Takumi, HTTP) and camelCase clients (MCP). Without this,
	 * tool_calls sent as snake_case are silently dropped, starving the
	 * Swapna consolidation pipeline of tool usage data.
	 */
	const addTurnHandler = async (rawParams: Record<string, unknown>) => {
		const params = normalizeParams(rawParams);
		const sessionId = String(params.sessionId ?? "");
		const project = resolveWithStore(String(params.project ?? ""));
		const turn = params.turn as Record<string, unknown> | undefined;
		if (!sessionId || !project || !turn) throw new Error("Missing sessionId, project, or turn");

		// Normalize snake_case tool_calls / turn_number / content_parts to camelCase
		// so session-store always receives a canonical SessionTurn shape.
		if (turn.tool_calls !== undefined && turn.toolCalls === undefined) {
			turn.toolCalls = turn.tool_calls;
			delete turn.tool_calls;
		}
		if (turn.turn_number !== undefined && turn.turnNumber === undefined) {
			turn.turnNumber = turn.turn_number;
			delete turn.turn_number;
		}
		if (turn.content_parts !== undefined && turn.contentParts === undefined) {
			turn.contentParts = turn.content_parts;
			delete turn.content_parts;
		}

		await store.addTurn(sessionId, project, turn as unknown as Parameters<typeof store.addTurn>[2]);
		return { added: true };
	};

	router.register("turn.add", addTurnHandler, "Add a turn to a session");
	router.register("session.turn", addTurnHandler, "Consumer-friendly alias for adding a turn to a session");

	router.register("turn.list", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const sessionId = String(params.sessionId ?? "");
		if (!sessionId) throw new Error("Missing sessionId");

		// Project is optional — look up from sessions table if not provided
		let project = String(params.project ?? "");
		if (!project) {
			const sessions = store.listSessions();
			const match = sessions.find((s) => String(s.id) === sessionId);
			project = match ? String(match.project ?? "") : "";
		} else {
			project = resolveWithStore(project);
		}
		if (!project) throw new Error(`Cannot resolve project for session ${sessionId}`);

		return { turns: store.listTurnsWithTimestamps(sessionId, project) };
	}, "List turns with timestamps for a session");

	router.register("turn.since", async (rawParams) => {
		const params = normalizeParams(rawParams);
		const sessionId = String(params.sessionId ?? "");
		const sinceTurn = parseNonNegativeInt(params.sinceTurnNumber, "sinceTurnNumber");
		if (!sessionId) throw new Error("Missing sessionId");
		return { turns: store.getTurnsSince(sessionId, sinceTurn) };
	}, "Get turns since a given turn number");

	router.register("turn.max_number", async (rawParams) => {
		const params = normalizeParams(rawParams);
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
		const agentDb = db.getAgentDb();
		const scopePathRaw = typeof params.scopePath === "string" ? params.scopePath : undefined;
		const scopePath = scopeType === "project" && scopePathRaw
			? resolveProjectAgainstKnown(scopePathRaw, knownProjectsFromDb(agentDb))
			: scopePathRaw;
		const agentId = typeof params.agentId === "string" ? params.agentId.trim() : undefined;
		const entry = String(params.entry ?? "").trim();
		if (!entry) throw new Error("Missing entry");

		const memStore = await import("@chitragupta/smriti/memory-store");
		const scope = scopeType === "global"
			? { type: "global" as const }
			: scopeType === "agent"
				? { type: "agent" as const, agentId: agentId ?? scopePath ?? "" }
				: { type: "project" as const, path: scopePath ?? "" };
		if (scope.type === "project" && !scope.path) throw new Error("Missing scopePath for project memory");
		if (scope.type === "agent" && !scope.agentId) throw new Error("Missing agentId for agent memory");
		await memStore.appendMemory(scope, entry, { dedupe: params.dedupe !== false });
		return { appended: true };
	}, "Append entry to memory (global, project, or agent scope)");

	router.register("memory.recall", async (params) => {
		const query = String(params.query ?? "");
		const agentDb = db.getAgentDb();
		const projectInput = typeof params.project === "string" ? params.project : undefined;
		const project = projectInput
			? resolveProjectAgainstKnown(projectInput, knownProjectsFromDb(agentDb))
			: undefined;
		const limit = parseLimit(params.limit, 5);
		if (!query) throw new Error("Missing query");

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
