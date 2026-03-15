import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { _resetDbInit } from "../src/session-db.js";
import {
	clearQueuedResearchRefinementScope,
	listQueuedResearchRefinementScopes,
	upsertResearchRefinementQueue,
} from "../src/research-refinement-queue.js";

describe("research refinement queue", () => {
	let tmpDir = "";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-research-queue-"));
		DatabaseManager.reset();
		DatabaseManager.instance(tmpDir);
		_resetDbInit();
	});

	afterEach(() => {
		_resetDbInit();
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("merges duplicate scope upserts without dropping exact repair intent", () => {
		upsertResearchRefinementQueue([{
			label: "2026-03-14",
			projectPath: "/repo/project",
			sessionIds: ["sess-1"],
			sessionLineageKeys: ["lineage-1"],
			policyFingerprints: ["policy-a"],
			primaryObjectiveIds: ["metric-improvement"],
			primaryStopConditionIds: ["budget-cap"],
			primaryStopConditionKinds: ["budget-exhausted"],
			frontierBestScore: 0.61,
			refinementBudget: {
				dailyCandidateLimit: 4,
				dailyMinMdlScore: 0.58,
			},
			nidraBudget: {
				maxResearchProjectsPerCycle: 2,
			},
			repairIntent: {
				daily: { dates: ["2026-03-14"], levels: ["daily"] },
			},
		}]);
		upsertResearchRefinementQueue([{
			label: "2026-03-14",
			projectPath: "/repo/project",
			sessionIds: ["sess-1"],
			sessionLineageKeys: ["lineage-1"],
			policyFingerprints: ["policy-b"],
			primaryObjectiveIds: ["stability"],
			primaryStopConditionIds: ["pareto-halt"],
			primaryStopConditionKinds: ["pareto-stagnation"],
			frontierBestScore: 0.88,
			refinementBudget: {
				dailyCandidateLimit: 7,
				dailyMinMdlScore: 0.49,
			},
			nidraBudget: {
				maxResearchProjectsPerCycle: 4,
				maxSemanticPressure: 6,
			},
			repairIntent: {
				project: { projects: ["/repo/project"], levels: ["monthly"], periods: ["2026-03"] },
			},
		}]);

		const queued = listQueuedResearchRefinementScopes({ limit: 10 });
		expect(queued).toHaveLength(1);
		expect(queued[0]).toEqual(expect.objectContaining({
				projectPath: "/repo/project",
				sessionIds: ["sess-1"],
				sessionLineageKeys: ["lineage-1"],
				policyFingerprints: ["policy-a", "policy-b"],
				primaryObjectiveIds: ["metric-improvement", "stability"],
				primaryStopConditionIds: ["budget-cap", "pareto-halt"],
				primaryStopConditionKinds: ["budget-exhausted", "pareto-stagnation"],
				frontierBestScore: 0.88,
				refinementBudget: {
					dailyCandidateLimit: 7,
					dailyMinMdlScore: 0.49,
				},
				nidraBudget: {
					maxResearchProjectsPerCycle: 4,
					maxSemanticPressure: 6,
				},
				repairIntent: {
				daily: { dates: ["2026-03-14"], levels: ["daily"] },
				project: { projects: ["/repo/project"], levels: ["monthly"], periods: ["2026-03"] },
			},
			parseError: null,
		}));
	});

	it("surfaces malformed queued scope rows without crashing queue listing", () => {
		upsertResearchRefinementQueue([{
			label: "2026-03-14",
			projectPath: "/repo/project",
		}]);
		const db = DatabaseManager.instance(tmpDir).get("agent");
		db.prepare("UPDATE research_refinement_queue SET scope_json = ?").run("{not-json");

		const queued = listQueuedResearchRefinementScopes({ limit: 10 });
		expect(queued).toHaveLength(1);
		expect(queued[0]?.parseError).toMatch(/json|unexpected|unterminated/i);
		expect(queued[0]?.repairIntent).toBeNull();

		clearQueuedResearchRefinementScope(queued[0]!.id);
		expect(listQueuedResearchRefinementScopes({ limit: 10 })).toHaveLength(0);
	});
});
