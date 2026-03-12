import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { _resetDbInit } from "../src/session-db.js";
import { listResearchLoopSummaries, upsertResearchLoopSummary } from "../src/research-loop-summaries.js";

describe("research loop summaries", () => {
	let tmpDir = "";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-research-loop-"));
		DatabaseManager.reset();
		DatabaseManager.instance(tmpDir);
		_resetDbInit();
	});

	afterEach(() => {
		_resetDbInit();
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("persists and lists durable overnight loop summaries", () => {
		const stored = upsertResearchLoopSummary({
			projectPath: "/repo/project",
			loopKey: "loop-a",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
			councilVerdict: "accepted",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			roundsRequested: 6,
			roundsCompleted: 4,
			stopReason: "no-improvement",
			bestMetric: 0.991,
			bestRoundNumber: 2,
			noImprovementStreak: 2,
			totalDurationMs: 240000,
			totalBudgetMs: 300000,
			keptRounds: 1,
			revertedRounds: 3,
			plannerRouteClass: "coding.deep-reasoning",
			executionRouteClass: "tool.use.flex",
			record: { rounds: 4, council: { verdict: "accepted" } },
		});

		expect(stored.id).toHaveLength(24);
		expect(stored.loopKey).toBe("loop-a");
		expect(stored.record).toEqual({ rounds: 4, council: { verdict: "accepted" } });

		const summaries = listResearchLoopSummaries({ projectPath: "/repo/project", loopKey: "loop-a", limit: 10 });
		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toEqual(expect.objectContaining({
			id: stored.id,
			projectPath: "/repo/project",
			sessionLineageKey: "lineage-a",
			roundsRequested: 6,
			roundsCompleted: 4,
			stopReason: "no-improvement",
			plannerRouteClass: "coding.deep-reasoning",
			executionRouteClass: "tool.use.flex",
		}));
	});
});
