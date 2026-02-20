/**
 * Integration tests for budget API routes.
 * @module test/routes/budget
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChitraguptaServer } from "../../src/http-server.js";
import { mountBudgetRoutes } from "../../src/routes/budget.js";

// ── Mock Budget Tracker ──────────────────────────────────────────────────────

function makeMockTracker() {
	return {
		getStatus: () => ({
			sessionCost: 0.0042,
			dailyCost: 0.15,
			sessionLimit: 1.0,
			dailyLimit: 10.0,
			sessionWarning: false,
			sessionExceeded: false,
			dailyWarning: false,
			dailyExceeded: false,
		}),
		canProceed: () => ({ allowed: true }),
	};
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function req(
	port: number,
	path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const res = await fetch(`http://127.0.0.1:${port}${path}`);
	const body = (await res.json()) as Record<string, unknown>;
	return { status: res.status, body };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("budget routes", () => {
	let server: ChitraguptaServer;
	let port: number;

	beforeEach(async () => {
		const tracker = makeMockTracker();
		server = new ChitraguptaServer({ port: 0, host: "127.0.0.1" });
		mountBudgetRoutes(
			server as unknown as Parameters<typeof mountBudgetRoutes>[0],
			() => tracker as unknown as ReturnType<Parameters<typeof mountBudgetRoutes>[1]>,
		);
		port = await server.start();
	});

	afterEach(async () => {
		if (server?.isRunning) await server.stop();
	});

	it("GET /api/budget/status returns budget status", async () => {
		const { status, body } = await req(port, "/api/budget/status");
		expect(status).toBe(200);
		expect(body.sessionCost).toBe(0.0042);
		expect(body.dailyCost).toBe(0.15);
		expect(body.sessionLimit).toBe(1.0);
		expect(body.dailyLimit).toBe(10.0);
		expect(body.canProceed).toEqual({ allowed: true });
	});

	it("GET /api/budget/history returns history array", async () => {
		const { status, body } = await req(port, "/api/budget/history");
		expect(status).toBe(200);
		expect(Array.isArray(body.history)).toBe(true);
	});

	it("GET /api/budget/breakdown returns breakdown data", async () => {
		const { status, body } = await req(port, "/api/budget/breakdown");
		expect(status).toBe(200);
		expect(body.byProvider).toBeTruthy();
		expect(body.byModel).toBeTruthy();
	});
});
