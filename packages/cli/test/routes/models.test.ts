/**
 * Integration tests for model catalog API routes.
 * @module test/routes/models
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChitraguptaServer } from "../../src/http-server.js";
import { mountModelRoutes } from "../../src/routes/models.js";

// ── Mock Provider List ───────────────────────────────────────────────────────

function mockProviders() {
	return [
		{
			id: "anthropic",
			name: "Anthropic",
			models: [
				{ id: "claude-3-opus", displayName: "Claude 3 Opus", capabilities: ["text"] },
				{ id: "claude-3-sonnet", displayName: "Claude 3 Sonnet", capabilities: ["text", "vision"] },
			],
		},
		{
			id: "openai",
			name: "OpenAI",
			models: [
				{ id: "gpt-4o", displayName: "GPT-4o", capabilities: ["text", "vision"] },
			],
		},
	];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function req(
	port: number,
	urlPath: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
	const body = (await res.json()) as Record<string, unknown>;
	return { status: res.status, body };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("model routes", () => {
	let server: ChitraguptaServer;
	let port: number;

	beforeEach(async () => {
		server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
		mountModelRoutes(
			server as unknown as Parameters<typeof mountModelRoutes>[0],
			{
				listProviders: () => mockProviders(),
				getTuriyaRouter: () => ({
					getState: () => ({ strategy: "cost-optimized" }),
				}),
			},
		);
		port = await server.start();
	});

	afterEach(async () => {
		if (server?.isRunning) await server.stop();
	});

	it("GET /api/models returns all models across providers", async () => {
		const { status, body } = await req(port, "/api/models");
		expect(status).toBe(200);
		expect(Array.isArray(body.models)).toBe(true);
		const models = body.models as Array<Record<string, unknown>>;
		expect(models.length).toBe(3);
		expect(body.count).toBe(3);
	});

	it("GET /api/models/router returns router state", async () => {
		const { status, body } = await req(port, "/api/models/router");
		expect(status).toBe(200);
		const router = body.router as Record<string, unknown>;
		expect(router.strategy).toBe("cost-optimized");
	});

	it("GET /api/models/:id returns a specific model", async () => {
		const { status, body } = await req(port, "/api/models/gpt-4o");
		expect(status).toBe(200);
		const model = body.model as Record<string, unknown>;
		expect(model.id).toBe("gpt-4o");
	});

	it("GET /api/models/:id returns 404 for unknown model", async () => {
		const { status } = await req(port, "/api/models/nonexistent");
		expect(status).toBe(404);
	});
});
