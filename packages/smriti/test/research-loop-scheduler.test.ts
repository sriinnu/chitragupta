import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { _resetDbInit } from "../src/session-db.js";
import {
	cancelResearchLoopSchedule,
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
			policyFingerprint: "policy-a",
			primaryObjectiveId: "metric-improvement",
			primaryStopConditionId: "budget-exhausted",
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
				policyFingerprint: "policy-a",
				primaryObjectiveId: "metric-improvement",
				primaryStopConditionId: "budget-exhausted",
				workflowContext: {
					researchTopic: "optimizer sweep",
					researchBudgetMs: 300_000,
				},
			}));
			expect(getResearchLoopSchedule("/repo/project", "loop-a")).toEqual(expect.objectContaining({
				status: "queued",
				objectives: [{ id: "metric-improvement", weight: 1.6 }],
				policyFingerprint: "policy-a",
				primaryObjectiveId: "metric-improvement",
				primaryStopConditionId: "budget-exhausted",
				workflowContext: {
					researchTopic: "optimizer sweep",
					researchBudgetMs: 300_000,
				},
			}));
		expect(listResearchLoopSchedules({ runnableOnly: true, limit: 10 })).toEqual([
			expect.objectContaining({ loopKey: "loop-a", status: "queued" }),
		]);
	});

	it("keeps delayed queued rows non-runnable until availableAt and only claims them once due", () => {
		upsertResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-delay",
			status: "queued",
			availableAt: 5_000,
		});

		expect(listResearchLoopSchedules({ runnableOnly: true, limit: 10, now: 4_999 })).toEqual([]);
		expect(claimResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-delay",
			leaseOwner: "worker-a",
			leaseTtlMs: 10_000,
			now: 4_999,
			phase: "resident-dispatch",
		})).toEqual({
			claimed: false,
			schedule: expect.objectContaining({
				loopKey: "loop-delay",
				status: "queued",
				availableAt: 5_000,
			}),
		});
		expect(listResearchLoopSchedules({ runnableOnly: true, limit: 10, now: 5_000 })).toEqual([
			expect.objectContaining({ loopKey: "loop-delay", status: "queued", availableAt: 5_000 }),
		]);
		expect(claimResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-delay",
			leaseOwner: "worker-a",
			leaseTtlMs: 10_000,
			now: 5_000,
			phase: "resident-dispatch",
		})).toEqual({
			claimed: true,
			schedule: expect.objectContaining({
				loopKey: "loop-delay",
				status: "leased",
				leaseOwner: "worker-a",
			}),
		});
	});

	it("requeues expired cancelling rows for cleanup after the old worker lease expires", () => {
		upsertResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-cancelling",
			status: "queued",
			availableAt: 0,
		});
		claimResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-cancelling",
			leaseOwner: "worker-a",
			leaseTtlMs: 10_000,
			now: 1_000,
			phase: "run",
		});
		cancelResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-cancelling",
			reason: "operator cancel",
		});

		expect(listResearchLoopSchedules({ runnableOnly: true, limit: 10, now: 5_000 })).toEqual([]);
		expect(listResearchLoopSchedules({ runnableOnly: true, limit: 10, now: 12_000 })).toEqual([
			expect.objectContaining({ loopKey: "loop-cancelling", status: "cancelling" }),
		]);
		expect(claimResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-cancelling",
			leaseOwner: "worker-b",
			leaseTtlMs: 10_000,
			now: 12_000,
			phase: "cleanup",
		})).toEqual({
			claimed: true,
			schedule: expect.objectContaining({
				loopKey: "loop-cancelling",
				status: "cancelling",
				leaseOwner: "worker-b",
				phase: "cleanup",
			}),
		});
	});

	it("claims, heartbeats, and completes a durable worker lease", () => {
		upsertResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-b",
			status: "queued",
			availableAt: 0,
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

	it("refuses terminal completion when another active worker owns the lease", () => {
		upsertResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-c",
			status: "queued",
			availableAt: 0,
		});
		claimResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-c",
			leaseOwner: "worker-a",
			leaseTtlMs: 10_000,
			now: 1_000,
		});

		const blocked = completeResearchLoopSchedule({
			projectPath: "/repo/project",
			loopKey: "loop-c",
			stopReason: "max-rounds",
			now: 2_000,
			leaseOwner: "worker-b",
		});

		expect(blocked).toBeNull();
		expect(getResearchLoopSchedule("/repo/project", "loop-c")).toEqual(expect.objectContaining({
			status: "leased",
			leaseOwner: "worker-a",
			stopReason: null,
			finishedAt: null,
		}));
	});
});
