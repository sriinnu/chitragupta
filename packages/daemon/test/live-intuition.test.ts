import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import { RpcRouter } from "../src/rpc-router.js";
import { registerReadMethods } from "../src/services-read.js";

describe("lucy.live_context", () => {
	let tmpDir: string;
	let router: RpcRouter;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-live-intuition-"));
		DatabaseManager.reset();
		initAgentSchema(DatabaseManager.instance(tmpDir));
		router = new RpcRouter();
		registerReadMethods(router);
	});

	afterEach(() => {
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns shared live predictions and suppresses healed Scarlett warnings", async () => {
		const db = DatabaseManager.instance().get("agent");
		const now = Date.now();
		db.prepare(`
			INSERT INTO akasha_traces
				(id, agent_id, trace_type, topic, content, strength, reinforcements, metadata, created_at, last_reinforced_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"warn-smriti",
			"scarlett-internal",
			"warning",
			"smriti",
			"[critical] Smriti unhealthy",
			0.8,
			0,
			JSON.stringify({ severity: "critical" }),
			now,
			now,
		);
		db.prepare(`
			INSERT INTO akasha_traces
				(id, agent_id, trace_type, topic, content, strength, reinforcements, metadata, created_at, last_reinforced_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"warn-nidra",
			"scarlett-internal",
			"warning",
			"nidra",
			"[warning] Nidra lagging",
			0.7,
			0,
			JSON.stringify({ severity: "warning" }),
			now + 10,
			now + 10,
		);
		db.prepare(`
			INSERT INTO akasha_traces
				(id, agent_id, trace_type, topic, content, strength, reinforcements, metadata, created_at, last_reinforced_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"heal-nidra",
			"scarlett-internal",
			"correction",
			"nidra",
			"[recovered] Nidra healthy again",
			0.6,
			0,
			JSON.stringify({ cleared: true, outcome: "success" }),
			now + 20,
			now + 20,
		);

		const result = await router.handle("lucy.live_context", { query: "smriti", limit: 5 }) as {
			predictions: Array<{ entity: string; confidence: number; source: string }>;
			hit: { entity: string; content: string; source: string } | null;
			liveSignals: Array<{ errorSignature: string }>;
			guidanceBlock?: string;
			predictionsBlock?: string;
		};

		expect(result.hit).toMatchObject({
			entity: "smriti",
			source: "regression",
		});
		expect(result.predictions.some((prediction) => prediction.entity === "smriti")).toBe(true);
		expect(result.liveSignals).toEqual([
			expect.objectContaining({ errorSignature: "smriti" }),
		]);
		expect(result.guidanceBlock).toContain("## Lucy live guidance");
		expect(result.predictionsBlock).toContain("## Predicted Context (Transcendence pre-cache)");
	});

	it("keeps project-scoped Scarlett warnings out of other projects", async () => {
		const db = DatabaseManager.instance().get("agent");
		const now = Date.now();
		db.prepare(`
			INSERT INTO akasha_traces
				(id, agent_id, trace_type, topic, content, strength, reinforcements, metadata, created_at, last_reinforced_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"warn-global-smriti",
			"scarlett-internal",
			"warning",
			"smriti",
			"[critical] Smriti unhealthy",
			0.8,
			0,
			JSON.stringify({ severity: "critical", scope: "global" }),
			now,
			now,
		);
		db.prepare(`
			INSERT INTO akasha_traces
				(id, agent_id, trace_type, topic, content, strength, reinforcements, metadata, created_at, last_reinforced_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"warn-proj-a-lint",
			"scarlett-internal",
			"warning",
			"lint",
			"[warning] Project A lint failure",
			0.7,
			0,
			JSON.stringify({ severity: "warning", project: "/proj-a" }),
			now + 10,
			now + 10,
		);

		const projA = await router.handle("lucy.live_context", {
			query: "lint",
			project: "/proj-a",
			limit: 5,
		}) as {
			predictions: Array<{ entity: string; confidence: number; source: string }>;
			hit: { entity: string; content: string; source: string } | null;
			liveSignals: Array<{ errorSignature: string; scope?: string; project?: string }>;
		};
		const projB = await router.handle("lucy.live_context", {
			query: "lint",
			project: "/proj-b",
			limit: 5,
		}) as {
			predictions: Array<{ entity: string; confidence: number; source: string }>;
			hit: { entity: string; content: string; source: string } | null;
			liveSignals: Array<{ errorSignature: string; scope?: string; project?: string }>;
			guidanceBlock?: string;
		};

		expect(projA.hit).toMatchObject({
			entity: "lint",
			source: "regression",
		});
		expect(projA.liveSignals).toEqual(expect.arrayContaining([
			expect.objectContaining({ errorSignature: "lint", scope: "project", project: "/proj-a" }),
			expect.objectContaining({ errorSignature: "smriti", scope: "global" }),
		]));

		expect(projB.hit).toBeNull();
		expect(projB.predictions.some((prediction) => prediction.entity === "lint")).toBe(false);
		expect(projB.liveSignals.some((signal) => signal.errorSignature === "lint")).toBe(false);
		expect(projB.liveSignals).toEqual(expect.arrayContaining([
			expect.objectContaining({ errorSignature: "smriti", scope: "global" }),
		]));
		expect(projA.guidanceBlock).toContain("Project A lint failure");
		expect(projB.guidanceBlock).not.toContain("Project A lint failure");
	});
});
