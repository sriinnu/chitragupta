/**
 * Bhaaravaha Pariksha — Load tests for Chitragupta HTTP & WebSocket servers.
 * Sanskrit: Bhaaravaha (भारवाह) = load carrier, Pariksha (परीक्षा) = examination.
 *
 * Exercises the server infrastructure under controlled load using the
 * LoadRunner engine, LoadHttpClient, and LoadWsClient. All tests use
 * a real server with mock agent/memory — no actual LLM calls.
 *
 * Performance thresholds are intentionally generous to avoid flaky
 * results on slow CI machines.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LoadRunner } from "./load-runner.js";
import { LoadHttpClient } from "./http-client.js";
import { LoadWsClient } from "./ws-client.js";
import {
	healthCheckScenario,
	memorySearchScenario,
	memoryCrudScenario,
	jobSubmitScenario,
	agentListScenario,
	mixedApiScenario,
	wsConnectionStorm,
	wsChatScenario,
} from "./scenarios.js";
import { formatReport, type LoadReport } from "./reporter.js";
import { startTestServer, type TestServerHandle } from "./server-fixture.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Generous thresholds to avoid flaky tests on slow CI machines.
 * These are "the server is not broken" thresholds, not performance targets.
 */
const GENEROUS_P99_MS = 500; // 500ms — very lenient
const GENEROUS_ERROR_RATE = 0.05; // 5% error rate allowed
const GENEROUS_THROUGHPUT_FACTOR = 0.3; // Achieve at least 30% of target RPS

// ─── Test Setup ──────────────────────────────────────────────────────────────

let handle: TestServerHandle;
let httpClient: LoadHttpClient;

beforeAll(async () => {
	handle = await startTestServer();
	httpClient = new LoadHttpClient(handle.baseUrl, handle.authToken);
}, 30_000);

afterAll(async () => {
	httpClient?.destroy();
	await handle?.cleanup();
}, 15_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReport(
	name: string,
	scenarioName: string,
	config: { targetRps: number; duration: number; concurrency: number },
	result: Awaited<ReturnType<LoadRunner["run"]>>,
): LoadReport {
	return {
		name,
		timestamp: new Date().toISOString(),
		config: { ...config },
		result,
		scenarioName,
	};
}

function printReport(report: LoadReport): void {
	const formatted = formatReport(report);
	process.stdout.write(`\n${formatted}\n\n`);
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Chitragupta Load Tests", () => {

	// ═══════════════════════════════════════════════════════════════════════
	// 1. Health check baseline
	// ═══════════════════════════════════════════════════════════════════════

	it("health check baseline — 500 RPS for 10s", { timeout: 60_000 }, async () => {
		const config = { targetRps: 500, duration: 10, concurrency: 50, warmup: 2 };
		const runner = new LoadRunner(config);
		const scenario = healthCheckScenario(httpClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("health-check-baseline", "health-check", config, result);
		printReport(report);

		expect(result.p99).toBeLessThan(GENEROUS_P99_MS);
		expect(result.errorRate).toBeLessThan(GENEROUS_ERROR_RATE);
		expect(result.throughput).toBeGreaterThan(config.targetRps * GENEROUS_THROUGHPUT_FACTOR);
		expect(result.totalRequests).toBeGreaterThan(0);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. Memory CRUD throughput
	// ═══════════════════════════════════════════════════════════════════════

	it("memory CRUD throughput — 100 RPS for 10s", { timeout: 60_000 }, async () => {
		const config = { targetRps: 100, duration: 10, concurrency: 20, warmup: 2 };
		const runner = new LoadRunner(config);
		const scenario = memoryCrudScenario(httpClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("memory-crud", "memory-crud", config, result);
		printReport(report);

		expect(result.p99).toBeLessThan(GENEROUS_P99_MS);
		expect(result.errorRate).toBeLessThan(GENEROUS_ERROR_RATE);
		expect(result.totalRequests).toBeGreaterThan(0);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Memory search throughput
	// ═══════════════════════════════════════════════════════════════════════

	it("memory search throughput — 50 RPS for 10s", { timeout: 60_000 }, async () => {
		const config = { targetRps: 50, duration: 10, concurrency: 15, warmup: 2 };
		const runner = new LoadRunner(config);
		const scenario = memorySearchScenario(httpClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("memory-search", "memory-search", config, result);
		printReport(report);

		expect(result.p99).toBeLessThan(GENEROUS_P99_MS);
		expect(result.totalRequests).toBeGreaterThan(0);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Job submission throughput
	// ═══════════════════════════════════════════════════════════════════════

	it("job submission throughput — 100 RPS for 10s", { timeout: 60_000 }, async () => {
		const config = { targetRps: 100, duration: 10, concurrency: 20, warmup: 2 };
		const runner = new LoadRunner(config);
		const scenario = jobSubmitScenario(httpClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("job-submit", "job-submit", config, result);
		printReport(report);

		expect(result.p99).toBeLessThan(GENEROUS_P99_MS);
		expect(result.totalRequests).toBeGreaterThan(0);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. Agent listing throughput
	// ═══════════════════════════════════════════════════════════════════════

	it("agent listing throughput — 200 RPS for 10s", { timeout: 60_000 }, async () => {
		const config = { targetRps: 200, duration: 10, concurrency: 30, warmup: 2 };
		const runner = new LoadRunner(config);
		const scenario = agentListScenario(httpClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("agent-list", "agent-list", config, result);
		printReport(report);

		expect(result.p99).toBeLessThan(GENEROUS_P99_MS);
		expect(result.errorRate).toBeLessThan(GENEROUS_ERROR_RATE);
		expect(result.totalRequests).toBeGreaterThan(0);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Mixed API load
	// ═══════════════════════════════════════════════════════════════════════

	it("mixed API load — 200 RPS for 15s", { timeout: 60_000 }, async () => {
		const config = { targetRps: 200, duration: 15, concurrency: 40, warmup: 3 };
		const runner = new LoadRunner(config);
		const scenario = mixedApiScenario(httpClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("mixed-api", "mixed-api", config, result);
		printReport(report);

		expect(result.p99).toBeLessThan(GENEROUS_P99_MS);
		expect(result.errorRate).toBeLessThan(GENEROUS_ERROR_RATE);
		expect(result.throughput).toBeGreaterThan(config.targetRps * GENEROUS_THROUGHPUT_FACTOR);
		expect(result.totalRequests).toBeGreaterThan(0);
		expect(result.timeline.length).toBeGreaterThan(0);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 7. WebSocket connection storm
	// ═══════════════════════════════════════════════════════════════════════

	it("WebSocket connection storm — 100 simultaneous connections", { timeout: 60_000 }, async () => {
		const result = await wsConnectionStorm(handle.wsUrl, 100, handle.authToken);

		process.stdout.write(
			`\n[WS Storm] Connected: ${result.connected}, Failed: ${result.failed}\n\n`,
		);

		// Allow up to 50% failure since maxConnections on the server is 200
		// and we might hit connection limits or race conditions
		expect(result.connected).toBeGreaterThan(50);

		// Clean up all clients
		for (const client of result.clients) {
			client.disconnect();
		}

		// Give sockets time to close
		await new Promise<void>((r) => setTimeout(r, 500));
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 8. WebSocket chat throughput
	// ═══════════════════════════════════════════════════════════════════════

	it("WebSocket chat throughput — 50 msg/s for 10s", { timeout: 60_000 }, async () => {
		const wsClient = new LoadWsClient(handle.wsUrl, handle.authToken);
		await wsClient.connect();

		const config = { targetRps: 50, duration: 10, concurrency: 10, warmup: 2 };
		const runner = new LoadRunner(config);
		const scenario = wsChatScenario(wsClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("ws-chat", "ws-chat", config, result);
		printReport(report);

		expect(result.totalRequests).toBeGreaterThan(0);
		expect(result.p99).toBeLessThan(5000); // WS chat is slower (round-trip)
		expect(result.errorRate).toBeLessThan(0.2); // Allow 20% errors for WS

		wsClient.disconnect();
		await new Promise<void>((r) => setTimeout(r, 200));
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 9. Spike test
	// ═══════════════════════════════════════════════════════════════════════

	it("spike test — 100 RPS baseline, spike to 500 RPS, then recovery", { timeout: 60_000 }, async () => {
		const scenario = healthCheckScenario(httpClient);

		// Phase 1: Baseline (100 RPS for 5s)
		const baselineRunner = new LoadRunner({
			targetRps: 100,
			duration: 5,
			concurrency: 20,
			warmup: 1,
		});
		const baseline = await baselineRunner.run((_i) => scenario());

		const baselineReport = makeReport("spike-baseline", "spike-baseline", {
			targetRps: 100, duration: 5, concurrency: 20,
		}, baseline);
		printReport(baselineReport);

		// Phase 2: Spike (500 RPS for 5s)
		const spikeRunner = new LoadRunner({
			targetRps: 500,
			duration: 5,
			concurrency: 80,
			warmup: 0,
		});
		const spike = await spikeRunner.run((_i) => scenario());

		const spikeReport = makeReport("spike-peak", "spike-peak", {
			targetRps: 500, duration: 5, concurrency: 80,
		}, spike);
		printReport(spikeReport);

		// Phase 3: Recovery (100 RPS for 5s)
		const recoveryRunner = new LoadRunner({
			targetRps: 100,
			duration: 5,
			concurrency: 20,
			warmup: 0,
		});
		const recovery = await recoveryRunner.run((_i) => scenario());

		const recoveryReport = makeReport("spike-recovery", "spike-recovery", {
			targetRps: 100, duration: 5, concurrency: 20,
		}, recovery);
		printReport(recoveryReport);

		// Assertions: server should handle the spike and recover
		expect(baseline.totalRequests).toBeGreaterThan(0);
		expect(spike.totalRequests).toBeGreaterThan(0);
		expect(recovery.totalRequests).toBeGreaterThan(0);

		// Recovery p99 should not be dramatically worse than baseline
		// (generous: within 10x of baseline)
		expect(recovery.p99).toBeLessThan(Math.max(baseline.p99 * 10, GENEROUS_P99_MS));
		expect(recovery.errorRate).toBeLessThan(GENEROUS_ERROR_RATE);
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 10. Concurrent connections
	// ═══════════════════════════════════════════════════════════════════════

	it("concurrent connections — 50 parallel HTTP connections, 200 RPS for 10s", { timeout: 60_000 }, async () => {
		const config = { targetRps: 200, duration: 10, concurrency: 50, warmup: 2 };
		const runner = new LoadRunner(config);
		const scenario = healthCheckScenario(httpClient);

		const result = await runner.run((_i) => scenario());

		const report = makeReport("concurrent-connections", "concurrent-http", config, result);
		printReport(report);

		expect(result.p99).toBeLessThan(GENEROUS_P99_MS);
		expect(result.errorRate).toBeLessThan(GENEROUS_ERROR_RATE);
		expect(result.throughput).toBeGreaterThan(config.targetRps * GENEROUS_THROUGHPUT_FACTOR);
		expect(result.totalRequests).toBeGreaterThan(0);
	});
});
