/**
 * Tests for the OrchestratorCheckpoint durable job checkpoint system.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";
import { OrchestratorCheckpoint } from "../src/orchestrator-checkpoint.js";
import type { JobCheckpoint } from "../src/orchestrator-checkpoint-types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tmpDir: string;

/** Create a fresh OrchestratorCheckpoint against a temporary database. */
function freshCheckpoint(config?: { maxPerType?: number; retentionDays?: number }): OrchestratorCheckpoint {
	return new OrchestratorCheckpoint(config);
}

const STEPS_3 = [
	{ stepId: "lint" },
	{ stepId: "type-check" },
	{ stepId: "test" },
];

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-cp-test-"));
	DatabaseManager.reset();
	const dbm = DatabaseManager.instance(tmpDir);
	initAgentSchema(dbm);
});

afterEach(() => {
	DatabaseManager.reset();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("OrchestratorCheckpoint", () => {
	describe("createJob", () => {
		it("should create a job with correct checkpoint structure", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("code-review", STEPS_3, "key-1", { pr: 42 });

			expect(job.jobId).toMatch(/^job-/);
			expect(job.jobType).toBe("code-review");
			expect(job.status).toBe("running");
			expect(job.idempotencyKey).toBe("key-1");
			expect(job.metadata).toEqual({ pr: 42 });
			expect(job.steps).toHaveLength(3);
			expect(job.currentStepIndex).toBe(0);
			expect(job.createdAt).toBeGreaterThan(0);
			expect(job.updatedAt).toBeGreaterThan(0);

			// First step should be running, rest pending
			expect(job.steps[0].status).toBe("running");
			expect(job.steps[0].startedAt).toBeGreaterThan(0);
			expect(job.steps[1].status).toBe("pending");
			expect(job.steps[2].status).toBe("pending");
		});

		it("should store step input when provided", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("deploy", [
				{ stepId: "build", input: { env: "prod" } },
				{ stepId: "push" },
			], "deploy-1");

			expect(job.steps[0].input).toEqual({ env: "prod" });
			expect(job.steps[1].input).toBeUndefined();
		});
	});

	describe("idempotency", () => {
		it("should throw when creating with same key while job is running", () => {
			const oc = freshCheckpoint();
			oc.createJob("review", STEPS_3, "idem-1");

			expect(() => oc.createJob("review", STEPS_3, "idem-1")).toThrow(
				/Duplicate idempotency key/,
			);
		});

		it("should allow re-creation with same key after completion", () => {
			const oc = freshCheckpoint();
			const first = oc.createJob("review", STEPS_3, "idem-2");
			oc.completeJob(first.jobId);

			// Should not throw — terminal state allows reuse
			const second = oc.createJob("review", STEPS_3, "idem-2");
			expect(second.jobId).not.toBe(first.jobId);
			expect(second.status).toBe("running");
		});

		it("should allow re-creation with same key after failure", () => {
			const oc = freshCheckpoint();
			const first = oc.createJob("review", STEPS_3, "idem-3");
			oc.failJob(first.jobId, "crashed");

			const second = oc.createJob("review", STEPS_3, "idem-3");
			expect(second.jobId).not.toBe(first.jobId);
		});
	});

	describe("advanceStep", () => {
		it("should progress through steps correctly", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("pipeline", STEPS_3, "adv-1");

			// Advance step 0 (lint) -> completed; step 1 -> running
			const completed0 = oc.advanceStep(job.jobId, { lintOk: true });
			expect(completed0.status).toBe("completed");
			expect(completed0.stepId).toBe("lint");
			expect(completed0.output).toEqual({ lintOk: true });
			expect(completed0.completedAt).toBeGreaterThan(0);

			const afterAdv1 = oc.loadJob(job.jobId)!;
			expect(afterAdv1.currentStepIndex).toBe(1);
			expect(afterAdv1.steps[0].status).toBe("completed");
			expect(afterAdv1.steps[1].status).toBe("running");
			expect(afterAdv1.steps[2].status).toBe("pending");

			// Advance step 1 (type-check)
			oc.advanceStep(job.jobId);
			const afterAdv2 = oc.loadJob(job.jobId)!;
			expect(afterAdv2.currentStepIndex).toBe(2);
			expect(afterAdv2.steps[1].status).toBe("completed");
			expect(afterAdv2.steps[2].status).toBe("running");

			// Advance step 2 (test) — last step
			oc.advanceStep(job.jobId);
			const afterAdv3 = oc.loadJob(job.jobId)!;
			expect(afterAdv3.steps[2].status).toBe("completed");
		});
	});

	describe("failStep + retryStep", () => {
		it("should fail a step and allow retry", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("pipeline", STEPS_3, "fail-retry-1");

			// Fail step 0
			const failed = oc.failStep(job.jobId, "lint error");
			expect(failed.status).toBe("failed");
			expect(failed.error).toBe("lint error");
			expect(failed.retryCount).toBe(1);

			const afterFail = oc.loadJob(job.jobId)!;
			expect(afterFail.steps[0].status).toBe("failed");
			expect(afterFail.steps[0].retryCount).toBe(1);

			// Retry step 0
			const retried = oc.retryStep(job.jobId);
			expect(retried.status).toBe("running");
			expect(retried.error).toBeUndefined();

			const afterRetry = oc.loadJob(job.jobId)!;
			expect(afterRetry.steps[0].status).toBe("running");
			expect(afterRetry.status).toBe("running");
		});

		it("should increment retryCount on repeated failures", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("pipeline", STEPS_3, "multi-fail");

			oc.failStep(job.jobId, "err 1");
			oc.retryStep(job.jobId);
			oc.failStep(job.jobId, "err 2");

			const loaded = oc.loadJob(job.jobId)!;
			expect(loaded.steps[0].retryCount).toBe(2);
			expect(loaded.steps[0].error).toBe("err 2");
		});

		it("should throw when retrying a non-failed step", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("pipeline", STEPS_3, "retry-bad");

			expect(() => oc.retryStep(job.jobId)).toThrow(/not "failed"/);
		});
	});

	describe("completeJob", () => {
		it("should mark job as completed", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("deploy", STEPS_3, "complete-1");

			// Advance all steps
			oc.advanceStep(job.jobId);
			oc.advanceStep(job.jobId);
			oc.advanceStep(job.jobId);

			const completed = oc.completeJob(job.jobId);
			expect(completed.status).toBe("completed");
		});
	});

	describe("failJob", () => {
		it("should mark job as failed with error in metadata", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("deploy", STEPS_3, "fail-job-1", { env: "staging" });

			const failed = oc.failJob(job.jobId, "deployment timed out");
			expect(failed.status).toBe("failed");
			expect(failed.metadata.failureError).toBe("deployment timed out");
			expect(failed.metadata.env).toBe("staging");
		});
	});

	describe("resumeJob", () => {
		it("should resume from the last incomplete step", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("pipeline", STEPS_3, "resume-1");

			// Complete step 0, step 1 is now running
			oc.advanceStep(job.jobId);
			// Fail step 1
			oc.failStep(job.jobId, "type error");

			// Resume should pick up step 1
			const resumed = oc.resumeJob(job.jobId);
			expect(resumed.status).toBe("running");
			expect(resumed.currentStepIndex).toBe(1);
			expect(resumed.steps[1].status).toBe("running");
		});

		it("should throw when resuming a completed job", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("pipeline", STEPS_3, "resume-bad");
			oc.completeJob(job.jobId);

			expect(() => oc.resumeJob(job.jobId)).toThrow(/already completed/);
		});
	});

	describe("loadJob", () => {
		it("should return null for a non-existent job", () => {
			const oc = freshCheckpoint();
			expect(oc.loadJob("job-nonexistent")).toBeNull();
		});

		it("should round-trip all fields correctly", () => {
			const oc = freshCheckpoint();
			const job = oc.createJob("review", [
				{ stepId: "s1", input: { file: "a.ts" } },
			], "load-1", { reviewer: "bot" });

			const loaded = oc.loadJob(job.jobId)!;
			expect(loaded.jobType).toBe("review");
			expect(loaded.metadata.reviewer).toBe("bot");
			expect(loaded.steps[0].input).toEqual({ file: "a.ts" });
			expect(loaded.idempotencyKey).toBe("load-1");
		});
	});

	describe("listJobs", () => {
		it("should list all jobs when no filter is provided", () => {
			const oc = freshCheckpoint();
			oc.createJob("review", STEPS_3, "list-1");
			oc.createJob("deploy", STEPS_3, "list-2");

			const all = oc.listJobs();
			expect(all).toHaveLength(2);
		});

		it("should filter by jobType", () => {
			const oc = freshCheckpoint();
			oc.createJob("review", STEPS_3, "filter-1");
			oc.createJob("deploy", STEPS_3, "filter-2");
			oc.createJob("review", STEPS_3, "filter-3");

			const reviews = oc.listJobs({ jobType: "review" });
			expect(reviews).toHaveLength(2);
			expect(reviews.every((j: JobCheckpoint) => j.jobType === "review")).toBe(true);
		});

		it("should filter by status", () => {
			const oc = freshCheckpoint();
			const j1 = oc.createJob("review", STEPS_3, "status-1");
			oc.createJob("review", STEPS_3, "status-2");
			oc.completeJob(j1.jobId);

			const completed = oc.listJobs({ status: "completed" });
			expect(completed).toHaveLength(1);
			expect(completed[0].status).toBe("completed");
		});

		it("should filter by both jobType and status", () => {
			const oc = freshCheckpoint();
			const j1 = oc.createJob("review", STEPS_3, "both-1");
			oc.createJob("deploy", STEPS_3, "both-2");
			oc.completeJob(j1.jobId);

			const result = oc.listJobs({ jobType: "review", status: "completed" });
			expect(result).toHaveLength(1);
		});
	});

	describe("purgeOld", () => {
		it("should remove old completed/failed jobs", () => {
			const oc = freshCheckpoint({ retentionDays: 1 });
			const j1 = oc.createJob("review", STEPS_3, "purge-1");
			const j2 = oc.createJob("deploy", STEPS_3, "purge-2");
			oc.completeJob(j1.jobId);
			oc.failJob(j2.jobId, "failed");

			// Backdate updated_at to 2 days ago so they exceed retentionDays=1
			const twoDaysAgo = Date.now() - 2 * 86_400_000;
			const dbm = DatabaseManager.instance(tmpDir);
			const db = dbm.get("agent");
			db.prepare("UPDATE orchestrator_jobs SET updated_at = ?").run(twoDaysAgo);

			const removed = oc.purgeOld();
			expect(removed).toBe(2);

			const remaining = oc.listJobs();
			expect(remaining).toHaveLength(0);
		});

		it("should not remove running jobs", () => {
			const oc = freshCheckpoint({ retentionDays: 0 });
			oc.createJob("review", STEPS_3, "purge-running");

			// Even with retentionDays=0, running jobs should not be purged
			const removed = oc.purgeOld();
			expect(removed).toBe(0);

			const remaining = oc.listJobs();
			expect(remaining).toHaveLength(1);
		});

		it("should return 0 when nothing to purge", () => {
			const oc = freshCheckpoint();
			expect(oc.purgeOld()).toBe(0);
		});
	});

	describe("failure injection — crash simulation", () => {
		it("should survive a simulated kill and resume from DB", () => {
			// Phase 1: create job, advance 2 steps, then "crash"
			const oc1 = freshCheckpoint();
			const job = oc1.createJob("ci-pipeline", [
				{ stepId: "clone" },
				{ stepId: "build" },
				{ stepId: "test" },
				{ stepId: "deploy" },
			], "crash-test-1");

			oc1.advanceStep(job.jobId, { cloned: true });
			oc1.advanceStep(job.jobId, { built: true });

			// Capture the jobId — this is all we'd have after a crash
			const savedJobId = job.jobId;

			// Phase 2: "Restart" — create a new OrchestratorCheckpoint
			// (simulates a process restart reading from the same DB)
			const oc2 = freshCheckpoint();
			const recovered = oc2.loadJob(savedJobId);

			// Verify state is consistent
			expect(recovered).not.toBeNull();
			expect(recovered!.status).toBe("running");
			expect(recovered!.currentStepIndex).toBe(2);
			expect(recovered!.steps[0].status).toBe("completed");
			expect(recovered!.steps[0].output).toEqual({ cloned: true });
			expect(recovered!.steps[1].status).toBe("completed");
			expect(recovered!.steps[1].output).toEqual({ built: true });
			expect(recovered!.steps[2].status).toBe("running");
			expect(recovered!.steps[3].status).toBe("pending");

			// Resume and continue
			const resumed = oc2.resumeJob(savedJobId);
			expect(resumed.currentStepIndex).toBe(2);
			expect(resumed.steps[2].status).toBe("running");

			// Complete the remaining steps
			oc2.advanceStep(savedJobId, { tested: true });
			oc2.advanceStep(savedJobId, { deployed: true });
			oc2.completeJob(savedJobId);

			const final = oc2.loadJob(savedJobId)!;
			expect(final.status).toBe("completed");
			expect(final.steps.every(s => s.status === "completed")).toBe(true);
		});
	});
});
