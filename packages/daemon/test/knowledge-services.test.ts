import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import { type RpcNotification } from "../src/protocol.js";
import { RpcRouter } from "../src/rpc-router.js";
import { registerKnowledgeMethods } from "../src/services-knowledge.js";
import * as sessionStore from "../../smriti/src/session-store.ts";

describe("knowledge services", () => {
	let tmpDir: string;
	let router: RpcRouter;
	let notifications: RpcNotification[];

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-knowledge-services-"));
		DatabaseManager.reset();
		initAgentSchema(DatabaseManager.instance(tmpDir));
		router = new RpcRouter();
		notifications = [];
		router.setNotifier((notification) => {
			notifications.push(notification);
			return 1;
		});
		registerKnowledgeMethods(router, sessionStore);
	});

	afterEach(() => {
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("records and queries Akasha traces through daemon services", async () => {
		const leave = await router.handle("akasha.leave", {
			agentId: "lucy-bridge",
			type: "solution",
			topic: "auth",
			content: "Prefer narrow auth fixes",
			metadata: { source: "test" },
		}) as { trace: { id: string; topic: string; content: string } };

		expect(leave.trace.topic).toBe("auth");
		expect(leave.trace.content).toContain("narrow auth");
		expect(notifications.at(-1)).toMatchObject({
			method: "akasha.trace_added",
			params: expect.objectContaining({
				type: "trace_added",
				trace: expect.objectContaining({ id: leave.trace.id }),
			}),
		});

		const queried = await router.handle("akasha.query", {
			topic: "auth",
			limit: 5,
		}) as { traces: Array<{ id: string; topic: string }> };
		expect(queried.traces).toEqual([
			expect.objectContaining({ id: leave.trace.id, topic: "auth" }),
		]);

		const stats = await router.handle("akasha.stats", {}) as {
			totalTraces: number;
			activeTraces: number;
		};
		expect(stats.totalTraces).toBeGreaterThanOrEqual(1);
		expect(stats.activeTraces).toBeGreaterThanOrEqual(1);
	});

	it("records and reads Buddhi decisions through daemon services", async () => {
		const recorded = await router.handle("buddhi.record", {
			sessionId: "sess-1",
			project: "/tmp/project",
			category: "tool-selection",
			description: "Use bash for repo grep",
			confidence: 0.82,
			reasoning: {
				thesis: "bash is appropriate",
				reason: "rg is available",
				example: "shell grep is fast in local repos",
				application: "current repo search needs speed",
				conclusion: "use bash",
			},
		}) as { decision: { id: string; description: string } };

		expect(recorded.decision.id).toMatch(/^bud-/);
		expect(recorded.decision.description).toContain("bash");

		const listed = await router.handle("buddhi.list", {
			project: "/tmp/project",
			limit: 10,
		}) as { decisions: Array<{ id: string }> };
		expect(listed.decisions).toEqual([
			expect.objectContaining({ id: recorded.decision.id }),
		]);

		const loaded = await router.handle("buddhi.get", {
			id: recorded.decision.id,
		}) as { decision: { id: string; category: string } | null };
		expect(loaded.decision).toMatchObject({
			id: recorded.decision.id,
			category: "tool-selection",
		});

		const explanation = await router.handle("buddhi.explain", {
			id: recorded.decision.id,
		}) as { explanation: string | null };
		expect(explanation.explanation).toContain("Pratij");
	});
});
