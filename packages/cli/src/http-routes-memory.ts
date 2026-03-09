/**
 * Memory CRUD (Smriti Dvaara) HTTP route handlers.
 * @module http-routes-memory
 */

import type { ChitraguptaServer } from "./http-server.js";
import { okResponse, errorResponse } from "./server-response.js";
import {
	parseScopeParam,
	toMemoryScopeInfo,
} from "./memory-api.js";
import {
	appendMemoryViaDaemon,
	deleteMemoryViaDaemon,
	getMemoryEntryViaDaemon,
	listMemoryScopesViaDaemon,
	searchMemoryFiles,
	updateMemoryViaDaemon,
} from "./modes/daemon-bridge.js";

type DaemonMemoryScope =
	| { type: "global" }
	| { type: "project"; path: string }
	| { type: "agent"; agentId: string };

function isDaemonMemoryScope(scope: ReturnType<typeof parseScopeParam>): scope is DaemonMemoryScope {
	return scope !== null && scope.type !== "session";
}

/** Mount all memory CRUD routes onto the server. */
export function mountMemoryRoutes(server: ChitraguptaServer): void {
	server.route("GET", "/api/memory/scopes", async () => {
		try {
			const rawScopes = await listMemoryScopesViaDaemon();
			const scopes = rawScopes.map((scope) => toMemoryScopeInfo(scope));
			return {
				status: 200,
				body: okResponse({ scopes }, { count: scopes.length }),
			};
		} catch (err) {
			return { status: 500, body: errorResponse(`Failed to list memory scopes: ${(err as Error).message}`) };
		}
	});

	// Registered before :scope routes so "/api/memory/search" is not captured by :scope.
	server.route("POST", "/api/memory/search", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const query = body.query;
			if (typeof query !== "string" || query.trim().length === 0) {
				return { status: 400, body: errorResponse("Missing or empty 'query' field in request body") };
			}
			const limit = typeof body.limit === "number" && body.limit > 0
				? Math.floor(body.limit)
				: 20;
			const raw = await searchMemoryFiles(query.trim());
			const results = raw.slice(0, limit).map((r) => ({
				content: r.content,
				score: r.relevance ?? 0,
				source: r.scope.type,
			}));
			return {
				status: 200,
				body: okResponse({ results }, { count: results.length }),
			};
		} catch (err) {
			return { status: 500, body: errorResponse(`Memory search failed: ${(err as Error).message}`) };
		}
	});

	server.route("GET", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);
			if (!isDaemonMemoryScope(scope)) {
				const msg = scopeStr.startsWith("session:")
					? "Session-scoped memory is accessed via the session API, not /api/memory"
					: `Invalid scope format: "${scopeStr}". Use "global", "project:<path>", or "agent:<id>"`;
				return { status: 400, body: errorResponse(msg) };
			}
			const entry = await getMemoryEntryViaDaemon(scope);
			return { status: 200, body: okResponse(entry) };
		} catch (err) {
			return { status: 500, body: errorResponse(`Failed to get memory: ${(err as Error).message}`) };
		}
	});

	server.route("PUT", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);
			if (!isDaemonMemoryScope(scope)) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.content !== "string") {
				return { status: 400, body: { error: "Missing 'content' field in request body (must be a string)" } };
			}
			const result = await updateMemoryViaDaemon(scope, body.content);
			return { status: 200, body: { ...result, message: "Memory updated" } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to update memory: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);
			if (!isDaemonMemoryScope(scope)) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.entry !== "string" || body.entry.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'entry' field in request body" } };
			}
			const scopeRef = scope.type === "project"
				? scope.path
				: scope.type === "agent"
					? scope.agentId
					: undefined;
			await appendMemoryViaDaemon(scope.type, body.entry.trim(), scopeRef);
			return {
				status: 200,
				body: { scope: scopeStr, message: "Entry appended", timestamp: new Date().toISOString() },
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to append memory: ${(err as Error).message}` } };
		}
	});

	server.route("DELETE", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);
			if (!isDaemonMemoryScope(scope)) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}
			const entry = await getMemoryEntryViaDaemon(scope);
			if (!entry.exists) {
				return { status: 404, body: { error: `Memory not found for scope: "${scopeStr}"` } };
			}
			const result = await deleteMemoryViaDaemon(scope);
			return { status: 200, body: { ...result, message: "Memory deleted" } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to delete memory: ${(err as Error).message}` } };
		}
	});
}
