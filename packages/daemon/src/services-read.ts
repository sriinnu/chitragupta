/**
 * @chitragupta/daemon — Read-through, write, and daemon introspection services.
 *
 * Extracted from services.ts to keep each file under 450 LOC.
 * Registers memory recall, file search, day files, context loading,
 * fact extraction, and daemon health/status methods.
 *
 * @module
 */

import type { RpcRouter } from "./rpc-router.js";
import {
	parseLimit,
	DAEMON_START_MS,
	normalizeProjectPath,
	resolveProjectKey,
} from "./services-helpers.js";

// ─── Project Resolution Helpers ─────────────────────────────────────────────

/** Extract known project paths from the session store. */
export function knownProjectsFromStore(
	store: typeof import("@chitragupta/smriti/session-store"),
): string[] {
	return store
		.listSessionProjects()
		.map((p) => (typeof p.project === "string" ? p.project : ""))
		.filter((p) => p.length > 0);
}

/** Resolve a requested project path against known projects. */
function resolveProjectAgainstKnown(project: string, knownProjects: readonly string[]): string {
	const normalized = normalizeProjectPath(project);
	if (!normalized) return "";
	return resolveProjectKey(normalized, knownProjects);
}

// ─── Read-Through Methods ───────────────────────────────────────────────────

/** Read-through methods for memory files, day files, recall, and context. */
export function registerReadMethods(router: RpcRouter): void {
	router.register("memory.unified_recall", async (params) => {
		const query = String(params.query ?? "");
		const limit = parseLimit(params.limit, 5);
		if (!query) throw new Error("Missing query");
		let project: string | undefined;
		if (typeof params.project === "string") {
			const store = await import("@chitragupta/smriti/session-store");
			project = resolveProjectAgainstKnown(params.project, knownProjectsFromStore(store));
		}
		const { recall } = await import("@chitragupta/smriti/unified-recall");
		const results = await recall(query, { limit, project });
		return { results };
	}, "Unified recall across all memory layers");

	router.register("memory.file_search", async (params) => {
		const query = String(params.query ?? "");
		const projectInput = typeof params.project === "string" ? params.project : undefined;
		if (!query) throw new Error("Missing query");
		const { searchMemory } = await import("@chitragupta/smriti/search");
		const allResults = searchMemory(query);

		if (!projectInput) {
			return { results: allResults };
		}

		const store = await import("@chitragupta/smriti/session-store");
		const project = resolveProjectAgainstKnown(projectInput, knownProjectsFromStore(store));
		const filtered = allResults.filter((result) => {
			const scope = result.scope as Record<string, unknown>;
			const scopeType = String(scope.type ?? "");
			if (scopeType === "global") return true;
			if (scopeType !== "project") return false;
			return normalizeProjectPath(String(scope.path ?? "")) === project;
		});
		return { results: filtered };
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
		const projectInput = String(params.project ?? "");
		const store = await import("@chitragupta/smriti/session-store");
		const project = resolveProjectAgainstKnown(projectInput, knownProjectsFromStore(store));
		if (!project) throw new Error("Missing project");

		// Extract optional adaptive-budget params forwarded from CLI/MCP side.
		const providerContextWindow =
			typeof params.providerContextWindow === "number" && params.providerContextWindow > 0
				? params.providerContextWindow
				: undefined;
		const deviceId =
			typeof params.deviceId === "string" && params.deviceId.trim()
				? params.deviceId.trim()
				: undefined;

		const { loadProviderContext } = await import("@chitragupta/smriti/provider-bridge");
		const ctx = await loadProviderContext(project, { providerContextWindow, deviceId });
		return { assembled: ctx.assembled, itemCount: ctx.itemCount };
	}, "Load provider context for a project — accepts providerContextWindow and deviceId");
}

// ─── Daemon Introspection ───────────────────────────────────────────────────

/** Daemon introspection methods for observability. */
export function registerDaemonMethods(
	router: RpcRouter,
	db: typeof import("@chitragupta/smriti/session-db"),
): void {
	router.register("daemon.status", async () => {
		const agentDb = db.getAgentDb();
		const mem = process.memoryUsage();

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
			version: "0.1.26",
			pid: process.pid,
			uptime: (Date.now() - DAEMON_START_MS) / 1000,
			memory: {
				rss: mem.rss,
				heapUsed: mem.heapUsed,
				heapTotal: mem.heapTotal,
				external: mem.external,
			},
			methods: router.listMethods().length,
			counts: {
				turns: count("turns"),
				sessions: count("sessions"),
				rules: count("consolidation_rules"),
				vidhis: count("vidhis"),
				samskaras: count("samskaras"),
				vasanas: count("vasanas"),
				akashaTraces: count("akasha_traces"),
			},
			timestamp: Date.now(),
		};
	}, "Full daemon status: version, PID, uptime, memory, DB counts");

	router.register("daemon.health", async () => {
		const mem = process.memoryUsage();
		return {
			alive: true,
			pid: process.pid,
			uptime: (Date.now() - DAEMON_START_MS) / 1000,
			memory: mem.rss,
			methods: router.listMethods().length,
			connections: null,
		};
	}, "Lightweight health check for monitoring");
}

// ─── Write Methods ──────────────────────────────────────────────────────────

/** Write methods that enforce single-writer through daemon. */
export function registerWriteMethods(router: RpcRouter): void {
	router.register("fact.extract", async (params) => {
		const text = String(params.text ?? "");
		let projectPath = typeof params.projectPath === "string" ? params.projectPath : undefined;
		if (!text) throw new Error("Missing text");
		if (projectPath) {
			projectPath = normalizeProjectPath(projectPath);
		}

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
