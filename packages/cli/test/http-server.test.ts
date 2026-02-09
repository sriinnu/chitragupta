import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChitraguptaServer, createChitraguptaAPI } from "../src/http-server.js";
import type { ServerConfig } from "../src/http-server.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal fetch wrapper for tests (Node 20+ has global fetch). */
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ChitraguptaServer", () => {
	let server: ChitraguptaServer;

	afterEach(async () => {
		if (server?.isRunning) await server.stop();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Basic routing (no auth)
	// ═══════════════════════════════════════════════════════════════════════

	describe("basic routing", () => {
		it("should start and respond to registered routes", async () => {
			server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
			server.route("GET", "/api/ping", async () => ({
				status: 200,
				body: { pong: true },
			}));

			const port = await server.start();
			expect(port).toBeGreaterThan(0);
			expect(server.isRunning).toBe(true);

			const { status, body } = await req(port, "/api/ping");
			expect(status).toBe(200);
			expect(body).toEqual({ pong: true });
		});

		it("should return 404 for unmatched routes", async () => {
			server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
			const port = await server.start();

			const { status, body } = await req(port, "/api/nonexistent");
			expect(status).toBe(404);
			expect(body.error).toBe("Not Found");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Auth: authToken
	// ═══════════════════════════════════════════════════════════════════════

	describe("authToken", () => {
		const token = "test-secret-token-42";

		beforeEach(async () => {
			server = createChitraguptaAPI(makeDeps(), {
				port: 0,
				host: "127.0.0.1",
				authToken: token,
			});
		});

		it("should allow GET /api/health without auth", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/health");
			expect(status).toBe(200);
			expect(body.status).toBe("ok");
		});

		it("should reject requests without auth header", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/sessions");
			expect(status).toBe(401);
			expect(body.error).toBe("Unauthorized");
		});

		it("should reject requests with wrong bearer token", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/sessions", {
				headers: { Authorization: "Bearer wrong-token" },
			});
			expect(status).toBe(401);
			expect(body.error).toBe("Unauthorized");
		});

		it("should accept requests with correct bearer token", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/sessions", {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(status).toBe(200);
			expect(body.sessions).toBeDefined();
		});

		it("should reject POST without auth", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions", {
				method: "POST",
				body: { title: "test" },
			});
			expect(status).toBe(401);
		});

		it("should accept POST with correct bearer token", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/sessions", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: { title: "test" },
			});
			expect(status).toBe(201);
			expect(body.title).toBe("test");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Auth: apiKeys
	// ═══════════════════════════════════════════════════════════════════════

	describe("apiKeys", () => {
		const keys = ["key-alpha", "key-beta"];

		beforeEach(async () => {
			server = createChitraguptaAPI(makeDeps(), {
				port: 0,
				host: "127.0.0.1",
				apiKeys: keys,
			});
		});

		it("should allow GET /api/health without auth", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/health");
			expect(status).toBe(200);
		});

		it("should reject requests without any key", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/sessions");
			expect(status).toBe(401);
			expect(body.error).toBe("Unauthorized");
		});

		it("should accept X-API-Key header with valid key", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/sessions", {
				headers: { "X-API-Key": "key-alpha" },
			});
			expect(status).toBe(200);
			expect(body.sessions).toBeDefined();
		});

		it("should accept Bearer header with valid API key", async () => {
			const port = await server.start();
			const { status, body } = await req(port, "/api/sessions", {
				headers: { Authorization: "Bearer key-beta" },
			});
			expect(status).toBe(200);
			expect(body.sessions).toBeDefined();
		});

		it("should reject X-API-Key header with invalid key", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions", {
				headers: { "X-API-Key": "key-gamma" },
			});
			expect(status).toBe(401);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Auth: both authToken + apiKeys
	// ═══════════════════════════════════════════════════════════════════════

	describe("authToken + apiKeys combined", () => {
		const token = "master-token";
		const keys = ["api-key-1"];

		beforeEach(async () => {
			server = createChitraguptaAPI(makeDeps(), {
				port: 0,
				host: "127.0.0.1",
				authToken: token,
				apiKeys: keys,
			});
		});

		it("should accept the authToken via Bearer", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions", {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(status).toBe(200);
		});

		it("should accept an API key via X-API-Key", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions", {
				headers: { "X-API-Key": "api-key-1" },
			});
			expect(status).toBe(200);
		});

		it("should accept an API key via Bearer", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions", {
				headers: { Authorization: "Bearer api-key-1" },
			});
			expect(status).toBe(200);
		});

		it("should reject an unknown token", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions", {
				headers: { Authorization: "Bearer unknown" },
			});
			expect(status).toBe(401);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// No auth configured (backwards compatible)
	// ═══════════════════════════════════════════════════════════════════════

	describe("no auth configured", () => {
		beforeEach(async () => {
			server = createChitraguptaAPI(makeDeps(), {
				port: 0,
				host: "127.0.0.1",
			});
		});

		it("should allow all requests without any auth headers", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions");
			expect(status).toBe(200);
		});

		it("should allow POST without auth headers", async () => {
			const port = await server.start();
			const { status } = await req(port, "/api/sessions", {
				method: "POST",
				body: { title: "no-auth" },
			});
			expect(status).toBe(201);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Server lifecycle
	// ═══════════════════════════════════════════════════════════════════════

	describe("lifecycle", () => {
		it("should report uptime >= 0 while running", async () => {
			server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
			await server.start();
			// Allow a small delay so Date.now() advances past startTime
			await new Promise((r) => setTimeout(r, 5));
			expect(server.uptime).toBeGreaterThanOrEqual(1);
			expect(server.isRunning).toBe(true);
		});

		it("should report uptime 0 after stopping", async () => {
			server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
			await server.start();
			await server.stop();
			expect(server.uptime).toBe(0);
			expect(server.isRunning).toBe(false);
		});

		it("should throw if started twice", async () => {
			server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
			await server.start();
			await expect(server.start()).rejects.toThrow("already running");
		});
	});
});
