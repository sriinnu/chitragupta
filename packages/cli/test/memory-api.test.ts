import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChitraguptaAPI, ChitraguptaServer } from "../src/http-server.js";
import {
	parseScopeParam,
	serializeScope,
	listAllScopes,
	getMemoryEntry,
} from "../src/memory-api.js";

// ─── Mock smriti ─────────────────────────────────────────────────────────────
// Mock the entire @chitragupta/smriti module so no real filesystem I/O occurs.

const mockMemoryStore = new Map<string, string>();

vi.mock("@chitragupta/smriti", () => ({
	getMemory: vi.fn((scope: { type: string; path?: string; agentId?: string }) => {
		const key = scopeToKey(scope);
		return mockMemoryStore.get(key) ?? "";
	}),
	updateMemory: vi.fn((scope: { type: string; path?: string; agentId?: string }, content: string) => {
		const key = scopeToKey(scope);
		mockMemoryStore.set(key, content);
	}),
	appendMemory: vi.fn((scope: { type: string; path?: string; agentId?: string }, entry: string) => {
		const key = scopeToKey(scope);
		const existing = mockMemoryStore.get(key) ?? "";
		mockMemoryStore.set(key, existing + `\n---\n${entry}\n`);
	}),
	deleteMemory: vi.fn((scope: { type: string; path?: string; agentId?: string }) => {
		const key = scopeToKey(scope);
		mockMemoryStore.delete(key);
	}),
	listMemoryScopes: vi.fn(() => {
		const scopes: Array<Record<string, string>> = [];
		for (const key of mockMemoryStore.keys()) {
			if (key === "global") {
				scopes.push({ type: "global" });
			} else if (key.startsWith("project:")) {
				scopes.push({ type: "project", path: key.slice("project:".length) });
			} else if (key.startsWith("agent:")) {
				scopes.push({ type: "agent", agentId: key.slice("agent:".length) });
			}
		}
		return scopes;
	}),
	searchMemory: vi.fn((query: string) => {
		const results: Array<{
			scope: { type: string; path?: string; agentId?: string };
			content: string;
			relevance: number;
		}> = [];
		for (const [key, content] of mockMemoryStore.entries()) {
			if (content.toLowerCase().includes(query.toLowerCase())) {
				let scope: { type: string; path?: string; agentId?: string };
				if (key === "global") {
					scope = { type: "global" };
				} else if (key.startsWith("project:")) {
					scope = { type: "project", path: key.slice("project:".length) };
				} else {
					scope = { type: "agent", agentId: key.slice("agent:".length) };
				}
				results.push({ scope, content, relevance: 0.9 });
			}
		}
		return results;
	}),
}));

// Mock @chitragupta/core — pass through the real module, only override getChitraguptaHome
vi.mock("@chitragupta/core", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		getChitraguptaHome: vi.fn(() => "/tmp/chitragupta-test-memory"),
	};
});

function scopeToKey(scope: { type: string; path?: string; agentId?: string }): string {
	if (scope.type === "global") return "global";
	if (scope.type === "project") return `project:${scope.path}`;
	if (scope.type === "agent") return `agent:${scope.agentId}`;
	return "unknown";
}

// ─── HTTP test helpers ───────────────────────────────────────────────────────

async function req(
	port: number,
	path: string,
	opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
	const url = `http://127.0.0.1:${port}${path}`;
	const res = await fetch(url, {
		method: opts.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			...(opts.headers ?? {}),
		},
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
	const body = (await res.json()) as Record<string, unknown>;
	return { status: res.status, body };
}

function makeDeps() {
	return {
		getAgent: () => null,
		getSession: () => null,
		listSessions: () => [],
	};
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: parseScopeParam and serializeScope
// ═════════════════════════════════════════════════════════════════════════════

describe("parseScopeParam", () => {
	it("should parse 'global' scope", () => {
		const scope = parseScopeParam("global");
		expect(scope).toEqual({ type: "global" });
	});

	it("should parse 'project:<path>' scope", () => {
		const scope = parseScopeParam("project:/my/awesome/project");
		expect(scope).toEqual({ type: "project", path: "/my/awesome/project" });
	});

	it("should parse 'agent:<id>' scope", () => {
		const scope = parseScopeParam("agent:kartru");
		expect(scope).toEqual({ type: "agent", agentId: "kartru" });
	});

	it("should return null for empty string", () => {
		expect(parseScopeParam("")).toBeNull();
	});

	it("should return null for random invalid string", () => {
		expect(parseScopeParam("foobar")).toBeNull();
	});

	it("should return null for session scope", () => {
		expect(parseScopeParam("session:abc123")).toBeNull();
	});

	it("should return null for project: with empty path", () => {
		expect(parseScopeParam("project:")).toBeNull();
	});

	it("should return null for agent: with empty id", () => {
		expect(parseScopeParam("agent:")).toBeNull();
	});

	it("should trim whitespace", () => {
		const scope = parseScopeParam("  global  ");
		expect(scope).toEqual({ type: "global" });
	});
});

describe("serializeScope", () => {
	it("should serialize global scope", () => {
		expect(serializeScope({ type: "global" })).toBe("global");
	});

	it("should serialize project scope", () => {
		expect(serializeScope({ type: "project", path: "/foo/bar" })).toBe("project:/foo/bar");
	});

	it("should serialize agent scope", () => {
		expect(serializeScope({ type: "agent", agentId: "kartru" })).toBe("agent:kartru");
	});

	it("should serialize session scope", () => {
		expect(serializeScope({ type: "session", sessionId: "s1" })).toBe("session:s1");
	});

	it("should roundtrip with parseScopeParam for global", () => {
		const scope = parseScopeParam("global")!;
		expect(serializeScope(scope)).toBe("global");
	});

	it("should roundtrip with parseScopeParam for project", () => {
		const scope = parseScopeParam("project:/my/path")!;
		expect(serializeScope(scope)).toBe("project:/my/path");
	});

	it("should roundtrip with parseScopeParam for agent", () => {
		const scope = parseScopeParam("agent:vaayu")!;
		expect(serializeScope(scope)).toBe("agent:vaayu");
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests: listAllScopes and getMemoryEntry
// ═════════════════════════════════════════════════════════════════════════════

describe("listAllScopes", () => {
	beforeEach(() => {
		mockMemoryStore.clear();
	});

	it("should return empty array when no scopes exist", () => {
		expect(listAllScopes()).toEqual([]);
	});

	it("should list global scope with display name", () => {
		mockMemoryStore.set("global", "some content");
		const scopes = listAllScopes();
		expect(scopes).toHaveLength(1);
		expect(scopes[0]).toEqual({
			type: "global",
			displayName: "Global Memory",
		});
	});

	it("should list project scope with display name", () => {
		mockMemoryStore.set("project:/my/project", "data");
		const scopes = listAllScopes();
		expect(scopes).toHaveLength(1);
		expect(scopes[0]).toEqual({
			type: "project",
			identifier: "/my/project",
			displayName: "Project: /my/project",
		});
	});

	it("should list agent scope with display name", () => {
		mockMemoryStore.set("agent:kartru", "data");
		const scopes = listAllScopes();
		expect(scopes).toHaveLength(1);
		expect(scopes[0]).toEqual({
			type: "agent",
			identifier: "kartru",
			displayName: "Agent: kartru",
		});
	});

	it("should list multiple scopes", () => {
		mockMemoryStore.set("global", "g");
		mockMemoryStore.set("project:/a", "p");
		mockMemoryStore.set("agent:b", "a");
		const scopes = listAllScopes();
		expect(scopes).toHaveLength(3);
	});
});

describe("getMemoryEntry", () => {
	beforeEach(() => {
		mockMemoryStore.clear();
	});

	it("should return empty entry for nonexistent global memory", () => {
		const entry = getMemoryEntry({ type: "global" });
		expect(entry.scope).toBe("global");
		expect(entry.content).toBe("");
		// Note: exists is filesystem-based and will be false since no real files
		expect(entry.exists).toBe(false);
	});

	it("should return scope string for project scope", () => {
		const entry = getMemoryEntry({ type: "project", path: "/test" });
		expect(entry.scope).toBe("project:/test");
	});

	it("should return scope string for agent scope", () => {
		const entry = getMemoryEntry({ type: "agent", agentId: "kartru" });
		expect(entry.scope).toBe("agent:kartru");
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// HTTP route tests
// ═════════════════════════════════════════════════════════════════════════════

describe("Memory HTTP routes", () => {
	let server: ChitraguptaServer;
	let port: number;

	beforeEach(async () => {
		mockMemoryStore.clear();
		server = createChitraguptaAPI(makeDeps(), { port: 0, host: "127.0.0.1" });
		port = await server.start();
	});

	afterEach(async () => {
		if (server?.isRunning) await server.stop();
	});

	// ─── GET /api/memory/scopes ─────────────────────────────────────

	describe("GET /api/memory/scopes", () => {
		it("should return empty scopes list", async () => {
			const { status, body } = await req(port, "/api/memory/scopes");
			expect(status).toBe(200);
			expect(body.scopes).toEqual([]);
		});

		it("should return scopes when memory exists", async () => {
			mockMemoryStore.set("global", "hello");
			mockMemoryStore.set("agent:kartru", "agent data");

			const { status, body } = await req(port, "/api/memory/scopes");
			expect(status).toBe(200);
			const scopes = body.scopes as Array<Record<string, unknown>>;
			expect(scopes.length).toBe(2);
		});
	});

	// ─── GET /api/memory/:scope ─────────────────────────────────────

	describe("GET /api/memory/:scope", () => {
		it("should return memory for global scope", async () => {
			mockMemoryStore.set("global", "Global knowledge");

			const { status, body } = await req(port, "/api/memory/global");
			expect(status).toBe(200);
			expect(body.scope).toBe("global");
			expect(body.content).toBe("Global knowledge");
		});

		it("should return empty content for nonexistent scope", async () => {
			const { status, body } = await req(port, "/api/memory/global");
			expect(status).toBe(200);
			expect(body.content).toBe("");
		});

		it("should return 400 for invalid scope format", async () => {
			const { status, body } = await req(port, "/api/memory/invalid");
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid scope format");
		});

		it("should return 400 for session scope with helpful message", async () => {
			const { status, body } = await req(port, "/api/memory/session:abc");
			expect(status).toBe(400);
			expect(body.error).toContain("session API");
		});
	});

	// ─── PUT /api/memory/:scope ─────────────────────────────────────

	describe("PUT /api/memory/:scope", () => {
		it("should update (overwrite) global memory", async () => {
			const { status, body } = await req(port, "/api/memory/global", {
				method: "PUT",
				body: { content: "New global content" },
			});
			expect(status).toBe(200);
			expect(body.message).toBe("Memory updated");
			expect(body.scope).toBe("global");
			expect(body.timestamp).toBeDefined();
			expect(mockMemoryStore.get("global")).toBe("New global content");
		});

		it("should return 400 for missing content", async () => {
			const { status, body } = await req(port, "/api/memory/global", {
				method: "PUT",
				body: {},
			});
			expect(status).toBe(400);
			expect(body.error).toContain("content");
		});

		it("should return 400 for invalid scope", async () => {
			const { status, body } = await req(port, "/api/memory/invalid", {
				method: "PUT",
				body: { content: "test" },
			});
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid scope format");
		});
	});

	// ─── POST /api/memory/:scope ────────────────────────────────────

	describe("POST /api/memory/:scope", () => {
		it("should append entry to global memory", async () => {
			const { status, body } = await req(port, "/api/memory/global", {
				method: "POST",
				body: { entry: "New learning about TypeScript" },
			});
			expect(status).toBe(200);
			expect(body.message).toBe("Entry appended");
			expect(body.scope).toBe("global");
			expect(body.timestamp).toBeDefined();
		});

		it("should return 400 for missing entry", async () => {
			const { status, body } = await req(port, "/api/memory/global", {
				method: "POST",
				body: {},
			});
			expect(status).toBe(400);
			expect(body.error).toContain("entry");
		});

		it("should return 400 for empty entry string", async () => {
			const { status, body } = await req(port, "/api/memory/global", {
				method: "POST",
				body: { entry: "   " },
			});
			expect(status).toBe(400);
			expect(body.error).toContain("entry");
		});

		it("should return 400 for invalid scope", async () => {
			const { status, body } = await req(port, "/api/memory/badscope", {
				method: "POST",
				body: { entry: "test" },
			});
			expect(status).toBe(400);
		});
	});

	// ─── DELETE /api/memory/:scope ──────────────────────────────────

	describe("DELETE /api/memory/:scope", () => {
		it("should return 404 for nonexistent memory", async () => {
			const { status, body } = await req(port, "/api/memory/global", {
				method: "DELETE",
			});
			expect(status).toBe(404);
			expect(body.error).toContain("not found");
		});

		it("should return 400 for invalid scope", async () => {
			const { status, body } = await req(port, "/api/memory/badscope", {
				method: "DELETE",
			});
			expect(status).toBe(400);
			expect(body.error).toContain("Invalid scope format");
		});
	});

	// ─── POST /api/memory/search ────────────────────────────────────

	describe("POST /api/memory/search", () => {
		it("should return search results", async () => {
			mockMemoryStore.set("global", "TypeScript is great for type safety");
			mockMemoryStore.set("agent:kartru", "Python is great for ML");

			const { status, body } = await req(port, "/api/memory/search", {
				method: "POST",
				body: { query: "TypeScript" },
			});
			expect(status).toBe(200);
			const results = body.results as Array<Record<string, unknown>>;
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].content).toContain("TypeScript");
			expect(results[0].score).toBeDefined();
			expect(results[0].source).toBeDefined();
		});

		it("should return 400 for missing query", async () => {
			const { status, body } = await req(port, "/api/memory/search", {
				method: "POST",
				body: {},
			});
			expect(status).toBe(400);
			expect(body.error).toContain("query");
		});

		it("should return 400 for empty query", async () => {
			const { status, body } = await req(port, "/api/memory/search", {
				method: "POST",
				body: { query: "  " },
			});
			expect(status).toBe(400);
			expect(body.error).toContain("query");
		});

		it("should respect limit parameter", async () => {
			mockMemoryStore.set("global", "data");
			mockMemoryStore.set("agent:a", "data");
			mockMemoryStore.set("agent:b", "data");

			const { status, body } = await req(port, "/api/memory/search", {
				method: "POST",
				body: { query: "data", limit: 1 },
			});
			expect(status).toBe(200);
			const results = body.results as Array<Record<string, unknown>>;
			expect(results.length).toBeLessThanOrEqual(1);
		});

		it("should return empty results for no matches", async () => {
			const { status, body } = await req(port, "/api/memory/search", {
				method: "POST",
				body: { query: "nonexistent-term-xyz" },
			});
			expect(status).toBe(200);
			expect(body.results).toEqual([]);
		});
	});
});
