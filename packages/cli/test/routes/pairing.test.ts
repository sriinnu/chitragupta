/**
 * Integration tests for Dvara-Bandhu pairing API routes.
 * @module test/routes/pairing
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChitraguptaServer } from "../../src/http-server.js";
import { PairingEngine } from "../../src/pairing-engine.js";
import { mountPairingRoutes } from "../../src/routes/pairing.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function req(
	port: number,
	path: string,
	opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: opts.method ?? "GET",
		headers,
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
	const body = (await res.json()) as Record<string, unknown>;
	return { status: res.status, body };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pairing routes", () => {
	let server: ChitraguptaServer;
	let engine: PairingEngine;
	let port: number;

	beforeEach(async () => {
		engine = new PairingEngine({
			port: 0,
			jwtSecret: "test-secret-for-pairing-routes-32chars",
			maxAttempts: 3,
			lockoutMs: 500,
		});
		engine.generateChallenge();

		server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
		mountPairingRoutes(server as unknown as Parameters<typeof mountPairingRoutes>[0], () => engine);
		port = await server.start();
	});

	afterEach(async () => {
		if (server?.isRunning) await server.stop();
	});

	it("GET /api/pair/challenge returns challenge data", async () => {
		const { status, body } = await req(port, "/api/pair/challenge");
		expect(status).toBe(200);
		expect(body.challengeId).toBeTruthy();
		expect(body.methods).toEqual(["passphrase", "qr", "visual", "number"]);
		expect(Array.isArray(body.wordList)).toBe(true);
		expect(Array.isArray(body.iconSet)).toBe(true);
		expect(body.numberCodeLength).toBe(7);
		expect(typeof body.expiresAt).toBe("number");
	});

	it("POST /api/pair/verify with correct passphrase returns JWT", async () => {
		const ch = engine.getChallenge()!;
		const { status, body } = await req(port, "/api/pair/verify", {
			method: "POST",
			body: {
				method: "passphrase",
				response: { words: ch.passphrase },
			},
		});
		expect(status).toBe(200);
		expect(body.success).toBe(true);
		expect(typeof body.jwt).toBe("string");
		expect(body.deviceId).toBeTruthy();
	});

	it("POST /api/pair/verify with wrong passphrase returns 401", async () => {
		const { status, body } = await req(port, "/api/pair/verify", {
			method: "POST",
			body: {
				method: "passphrase",
				response: { words: ["bad", "words", "here", "now"] },
			},
		});
		expect(status).toBe(401);
		expect(body.success).toBe(false);
		expect(body.error).toBeTruthy();
	});

	it("POST /api/pair/verify with number code succeeds", async () => {
		const ch = engine.getChallenge()!;
		const { status, body } = await req(port, "/api/pair/verify", {
			method: "POST",
			body: {
				method: "number",
				response: { code: ch.numberCode },
			},
		});
		expect(status).toBe(200);
		expect(body.success).toBe(true);
	});

	it("POST /api/pair/verify with QR token succeeds", async () => {
		const ch = engine.getChallenge()!;
		const { status, body } = await req(port, "/api/pair/verify", {
			method: "POST",
			body: {
				method: "qr",
				response: { qrToken: ch.qrToken },
			},
		});
		expect(status).toBe(200);
		expect(body.success).toBe(true);
	});

	it("GET /api/pair/devices returns device list after pairing", async () => {
		const ch = engine.getChallenge()!;
		const verifyRes = await req(port, "/api/pair/verify", {
			method: "POST",
			body: { method: "passphrase", response: { words: ch.passphrase } },
		});
		const jwt = verifyRes.body.jwt as string;

		const { status, body } = await req(port, "/api/pair/devices", { token: jwt });
		expect(status).toBe(200);
		expect(Array.isArray(body.devices)).toBe(true);
		expect((body.devices as unknown[]).length).toBeGreaterThanOrEqual(1);
	});

	it("DELETE /api/pair/devices/:id revokes a device", async () => {
		const ch = engine.getChallenge()!;
		const verifyRes = await req(port, "/api/pair/verify", {
			method: "POST",
			body: { method: "passphrase", response: { words: ch.passphrase } },
		});
		const jwt = verifyRes.body.jwt as string;

		const devices = engine.listDevices();
		const deviceId = devices[0].id;

		const { status, body } = await req(port, `/api/pair/devices/${deviceId}`, {
			method: "DELETE",
			token: jwt,
		});
		expect(status).toBe(200);
		expect(body.revoked).toBe(true);
	});

	it("POST /api/pair/refresh refreshes a valid JWT", async () => {
		const ch = engine.getChallenge()!;
		const verifyRes = await req(port, "/api/pair/verify", {
			method: "POST",
			body: { method: "passphrase", response: { words: ch.passphrase } },
		});

		const { status, body } = await req(port, "/api/pair/refresh", {
			method: "POST",
			body: { token: verifyRes.body.jwt },
		});
		expect(status).toBe(200);
		expect(typeof body.token).toBe("string");
	});

	it("returns 423 after too many failures", async () => {
		for (let i = 0; i < 3; i++) {
			await req(port, "/api/pair/verify", {
				method: "POST",
				body: { method: "passphrase", response: { words: ["a", "b", "c", "d"] } },
			});
		}
		const { status, body } = await req(port, "/api/pair/challenge");
		expect(status).toBe(423);
		expect(body.error).toBeTruthy();
	});
});
