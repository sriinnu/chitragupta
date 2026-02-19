/**
 * Integration tests for settings API routes.
 * @module test/routes/settings
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ChitraguptaServer } from "../../src/http-server.js";
import { mountSettingsRoutes } from "../../src/routes/settings.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function req(
	port: number,
	urlPath: string,
	opts: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
	const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
		method: opts.method ?? "GET",
		headers: { "Content-Type": "application/json" },
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
	const body = (await res.json()) as Record<string, unknown>;
	return { status: res.status, body };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("settings routes", () => {
	let server: ChitraguptaServer;
	let port: number;
	let tmpHome: string;

	beforeEach(async () => {
		// Create a temp chitragupta home for settings file I/O
		tmpHome = path.join(os.tmpdir(), `cg-settings-test-${Date.now()}`);
		fs.mkdirSync(path.join(tmpHome, "config"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpHome, "config", "settings.json"),
			JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-3" }),
		);
		vi.stubEnv("CHITRAGUPTA_HOME", tmpHome);

		server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
		mountSettingsRoutes(server as unknown as Parameters<typeof mountSettingsRoutes>[0]);
		port = await server.start();
	});

	afterEach(async () => {
		if (server?.isRunning) await server.stop();
		vi.unstubAllEnvs();
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	it("GET /api/settings returns current settings", async () => {
		const { status, body } = await req(port, "/api/settings");
		expect(status).toBe(200);
		expect(body.settings).toBeTruthy();
		const settings = body.settings as Record<string, unknown>;
		expect(settings.defaultProvider).toBe("anthropic");
	});

	it("PUT /api/settings merges partial updates", async () => {
		const { status, body } = await req(port, "/api/settings", {
			method: "PUT",
			body: { defaultModel: "gpt-4o" },
		});
		expect(status).toBe(200);
		const settings = body.settings as Record<string, unknown>;
		expect(settings.defaultModel).toBe("gpt-4o");
		// Original field preserved
		expect(settings.defaultProvider).toBe("anthropic");
	});
});
