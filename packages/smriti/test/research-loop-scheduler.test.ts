import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { _resetDbInit } from "../src/session-db.js";
import {
	claimResearchLoopSchedule,
	completeResearchLoopSchedule,
	getResearchLoopSchedule,
	heartbeatResearchLoopSchedule,
	listResearchLoopSchedules,
	upsertResearchLoopSchedule,
} from "../src/research-loop-scheduler.js";

describe("research loop scheduler", () => {
	let tmpDir = "";

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-research-scheduler-"));
		DatabaseManager.reset();
		DatabaseManager.instance(tmpDir);
		_resetDbInit();
	});

	afterEach(() => {
		_resetDbInit();
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("queues one durable schedule row with registry metadata intact", () => {
		const queued = upsertResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-a",
			topic: "optimizer sweep",
			status: "queued",
			objectives: [{ id: "metric-improvement", weight: 1.6 }],
			stopConditions: [{ id: "budget-exhausted", kind: "budget-exhausted" }],
			updateBudgets: { nidra: { maxResearchProjectsPerCycle: 3 } },
			workflowContext: {
				researchTopic: "optimizer sweep",
				researchBudgetMs: 300_000,
			},
		});

		expect(queued).toEqual(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-a",
				status: "queued",
				objectives: [{ id: "metric-improvement", weight: 1.6 }],
				stopConditions: [{ id: "budget-exhausted", kind: "budget-exhausted" }],
				updateBudgets: { nidra: { maxResearchProjectsPerCycle: 3 } },
				workflowContext: {
					researchTopic: "optimizer sweep",
					researchBudgetMs: 300_000,
				},
			}));
		expect(getResearchLoopSchedule("/repo/project", "loop-a")).toEqual(expect.objectContaining({
			status: "queued",
			objectives: [{ id: "metric-improvement", weight: 1.6 }],
			workflowContext: {
				researchTopic: "optimizer sweep",
				researchBudgetMs: 300_000,
			},
		}));
		expect(listResearchLoopSchedules({ runnableOnly: true, limit: 10 })).toEqual([
			expect.objectContaining({ loopKey: "loop-a", status: "queued" }),
		]);
	});

	it("claims, heartbeats, and completes a durable worker lease", () => {
		upsertResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-b",
			status: "queued",
		});

		const claimed = claimResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-b",
			leaseOwner: "worker-a",
			leaseTtlMs: 10_000,
			now: 1_000,
			currentRound: 1,
			totalRounds: 6,
			attemptNumber: 1,
			phase: "run",
		});
		expect(claimed).toEqual({
			claimed: true,
			schedule: expect.objectContaining({
				loopKey: "loop-b",
				status: "leased",
				leaseOwner: "worker-a",
				leaseExpiresAt: 11_000,
				currentRound: 1,
				totalRounds: 6,
				attemptNumber: 1,
				phase: "run",
			}),
		});

		const heartbeat = heartbeatResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-b",
			leaseOwner: "worker-a",
			leaseTtlMs: 10_000,
			now: 5_000,
			currentRound: 2,
			attemptNumber: 2,
			phase: "closure-record",
		});
		expect(heartbeat).toEqual(expect.objectContaining({
			status: "leased",
			leaseOwner: "worker-a",
			leaseExpiresAt: 15_000,
			currentRound: 2,
			attemptNumber: 2,
			phase: "closure-record",
		}));

		const completed = completeResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-b",
			stopReason: "max-rounds",
			now: 9_000,
		});
		expect(completed).toEqual(expect.objectContaining({
			status: "completed",
			stopReason: "max-rounds",
			leaseOwner: null,
			leaseExpiresAt: null,
			finishedAt: 9_000,
		}));
		expect(listResearchLoopSchedules({ runnableOnly: true, limit: 10 })).toEqual([]);
	});
});
