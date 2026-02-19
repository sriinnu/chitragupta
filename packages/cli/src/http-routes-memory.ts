/**
 * Memory CRUD (Smriti Dvaara) HTTP route handlers.
 * @module http-routes-memory
 */

import type { ChitraguptaServer } from "./http-server.js";
import {
	updateMemory,
	appendMemory,
	deleteMemory,
	searchMemory,
} from "@chitragupta/smriti";
import {
	parseScopeParam,
	getMemoryEntry,
	listAllScopes,
} from "./memory-api.js";

/** Mount all memory CRUD routes onto the server. */
export function mountMemoryRoutes(server: ChitraguptaServer): void {
	server.route("GET", "/api/memory/scopes", async () => {
		try {
			const scopes = listAllScopes();
			return { status: 200, body: { scopes } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list memory scopes: ${(err as Error).message}` } };
		}
	});

	// Registered before :scope routes so "/api/memory/search" is not captured by :scope.
	server.route("POST", "/api/memory/search", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const query = body.query;
			if (typeof query !== "string" || query.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'query' field in request body" } };
			}
			const limit = typeof body.limit === "number" && body.limit > 0
				? Math.floor(body.limit)
				: 20;
			const raw = searchMemory(query.trim());
			const results = raw.slice(0, limit).map((r) => ({
				content: r.content,
				score: r.relevance ?? 0,
				source: r.scope.type,
			}));
			return { status: 200, body: { results } };
		} catch (err) {
			return { status: 500, body: { error: `Memory search failed: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);
			if (!scope) {
				const isSession = scopeStr.startsWith("session:");
				const msg = isSession
					? "Session-scoped memory is accessed via the session API, not /api/memory"
					: `Invalid scope format: "${scopeStr}". Use "global", "project:<path>", or "agent:<id>"`;
				return { status: 400, body: { error: msg } };
			}
			const entry = getMemoryEntry(scope);
			return { status: 200, body: entry };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get memory: ${(err as Error).message}` } };
		}
	});

	server.route("PUT", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);
			if (!scope) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.content !== "string") {
				return { status: 400, body: { error: "Missing 'content' field in request body (must be a string)" } };
			}
			await updateMemory(scope, body.content);
			return {
				status: 200,
				body: { scope: scopeStr, message: "Memory updated", timestamp: new Date().toISOString() },
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to update memory: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);
			if (!scope) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}
			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.entry !== "string" || body.entry.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'entry' field in request body" } };
			}
			await appendMemory(scope, body.entry.trim());
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
			if (!scope) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}
			const entry = getMemoryEntry(scope);
			if (!entry.exists) {
				return { status: 404, body: { error: `Memory not found for scope: "${scopeStr}"` } };
			}
			deleteMemory(scope);
			return { status: 200, body: { scope: scopeStr, message: "Memory deleted" } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to delete memory: ${(err as Error).message}` } };
		}
	});
}
