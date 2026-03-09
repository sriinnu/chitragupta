import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import { type RpcNotification } from "../src/protocol.js";
import { RpcRouter } from "../src/rpc-router.js";
import { registerBindingMethods } from "../src/services-binding.js";

describe("binding services", () => {
	let tmpDir: string;
	let router: RpcRouter;
	let notifications: RpcNotification[];

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-binding-test-"));
		DatabaseManager.reset();
		initAgentSchema(DatabaseManager.instance(tmpDir));
		router = new RpcRouter();
		notifications = [];
		router.setNotifier((notification) => {
			notifications.push(notification);
			return 1;
		});
		registerBindingMethods(router);
	});

	afterEach(() => {
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("ingests observations, emits sequence patterns, and predicts the next action", async () => {
		const events: Array<Record<string, unknown>> = [];
		for (let index = 0; index < 8; index++) {
			events.push({ type: "tool_usage", sessionId: "sess-1", tool: "read", success: true, timestamp: Date.now() + index * 2 });
			events.push({ type: "tool_usage", sessionId: "sess-1", tool: "edit", success: true, timestamp: Date.now() + index * 2 + 1 });
		}

		router.attachClient("client-1", { transport: "socket" });
		const observed = await router.handle("observe.batch", { events }, {
			clientId: "client-1",
			transport: "socket",
			kind: "request",
		}) as Record<string, unknown>;
		expect(observed.accepted).toBe(events.length);
		expect(observed.clientId).toBe("client-1");
		expect(Number(observed.notificationsSent)).toBeGreaterThan(0);
		expect(notifications.some((notification) => notification.method === "pattern_detected")).toBe(true);

		const patterns = await router.handle("pattern.query", { type: "tool_sequence" }, {
			clientId: "client-1",
			transport: "socket",
			kind: "request",
		}) as { patterns: Array<Record<string, unknown>>; livePatterns: Array<Record<string, unknown>> };
		expect(patterns.patterns.length).toBeGreaterThan(0);
		expect(patterns.livePatterns.length).toBeGreaterThan(0);

		const prediction = await router.handle("predict.next", { currentTool: "read", sessionId: "sess-1" }, {
			clientId: "client-1",
			transport: "socket",
			kind: "request",
		}) as {
			predictions: Array<Record<string, unknown>>;
			liveSignals: Array<Record<string, unknown>>;
		};
		expect(prediction.predictions[0]).toMatchObject({
			type: "next_action",
			action: "edit",
		});
		expect(prediction.liveSignals.length).toBeGreaterThan(0);
	});

	it("stores preferences and broadcasts preference updates", async () => {
		router.attachClient("client-2", { transport: "socket" });
		const result = await router.handle("preference.update", {
			key: "indent_style",
			value: "spaces",
			confidence: 0.92,
			source: "takumi",
		}, {
			clientId: "client-2",
			transport: "socket",
			kind: "request",
		}) as Record<string, unknown>;

		expect(result.stored).toBe(true);
		expect(result.clientId).toBe("client-2");
		expect(result.preferences).toMatchObject({ indent_style: "spaces" });
		expect(Number(result.notificationsSent)).toBe(1);
		expect(notifications.at(-1)).toMatchObject({
			method: "preference_update",
			params: expect.objectContaining({
				clientId: "client-2",
				key: "indent_style",
				value: "spaces",
			}),
		});
	});

	it("accepts legacy observation event aliases from earlier binding drafts", async () => {
		const observed = await router.handle("observe.batch", {
			events: [
				{ type: "tool-usage", sessionId: "sess-legacy", tool: "read", success: true },
				{ type: "preference_update", key: "wrap_width", value: "100", confidence: 0.8 },
			],
		}) as Record<string, unknown>;

		expect(observed.accepted).toBe(2);
		expect(notifications.some((notification) => notification.method === "preference_update")).toBe(true);
	});

	it("reports health anomalies from repeated failures and loops", async () => {
		await router.handle("observe.batch", {
			events: [
				{ type: "tool_usage", sessionId: "sess-2", tool: "bash", argsHash: "same", success: false, timestamp: Date.now() - 1000 },
				{ type: "tool_usage", sessionId: "sess-2", tool: "bash", argsHash: "same", success: false, timestamp: Date.now() - 900 },
				{ type: "tool_usage", sessionId: "sess-2", tool: "bash", argsHash: "same", success: false, timestamp: Date.now() - 800 },
			],
		});

		const health = await router.handle("health.status", {}) as {
			status: string;
			errorRate: number;
			anomalies: Array<Record<string, unknown>>;
			clients: { connected: number };
			daemon: { serverPush: boolean };
		};
		expect(health.status).toBe("attention");
		expect(health.errorRate).toBeGreaterThan(0.3);
		expect(health.daemon.serverPush).toBe(true);
		expect(health.clients.connected).toBeGreaterThanOrEqual(0);
		expect(health.anomalies.some((anomaly) => anomaly.type === "error_spike")).toBe(true);
		expect(health.anomalies.some((anomaly) => anomaly.type === "loop_detected")).toBe(true);
	});

	it("records heal outcomes and returns effectiveness stats", async () => {
		const result = await router.handle("heal.report", {
			anomalyType: "loop_detected",
			actionTaken: "abort",
			outcome: "success",
			sessionId: "sess-3",
		}, {
			clientId: "client-3",
			transport: "socket",
			kind: "request",
		}) as Record<string, unknown>;

		expect(result.recorded).toBe(true);
		expect(result.clientId).toBe("client-3");
		expect(Number(result.notificationsSent)).toBe(1);
		expect(result.sampleCount).toBe(1);
		expect(result.successRate).toBe(1);
	});
});
