import { describe, expect, it, beforeEach } from "vitest";
import {
	createJob, getJob, completeJob, failJob,
	createHeartbeat, isJobStale, evictStaleJobs, clearAllJobs,
	HEARTBEAT_STALE_MS,
} from "../src/modes/mcp-prompt-jobs.js";

describe("mcp-prompt-jobs", () => {
	beforeEach(() => {
		clearAllJobs();
	});

	it("creates a running job with fresh heartbeat", () => {
		const id = createJob();
		const job = getJob(id);
		expect(job).toBeDefined();
		expect(job!.status).toBe("running");
		expect(job!.lastHeartbeat).toBeGreaterThan(0);
		expect(isJobStale(job!)).toBe(false);
	});

	it("completes a job and stores the response", () => {
		const id = createJob();
		completeJob(id, "The architecture review is done.");
		const job = getJob(id)!;
		expect(job.status).toBe("completed");
		expect(job.response).toBe("The architecture review is done.");
	});

	it("fails a job and stores the error", () => {
		const id = createJob();
		failJob(id, "All providers exhausted");
		const job = getJob(id)!;
		expect(job.status).toBe("failed");
		expect(job.error).toBe("All providers exhausted");
	});

	it("heartbeat callback updates job activity and timestamp", () => {
		const id = createJob();
		const hb = createHeartbeat(id);

		hb({ activity: "connecting to anthropic", attempt: 1, provider: "anthropic" });
		const job = getJob(id)!;
		expect(job.lastActivity).toBe("connecting to anthropic");
		expect(job.attemptNumber).toBe(1);
		expect(job.providerAttempt).toBe("anthropic");

		hb({ activity: "prompting anthropic", attempt: 1, provider: "anthropic" });
		expect(job.lastActivity).toBe("prompting anthropic");

		hb({ activity: "failed anthropic, retrying", attempt: 1, provider: "anthropic" });
		hb({ activity: "connecting to openai", attempt: 2, provider: "openai" });
		expect(job.attemptNumber).toBe(2);
		expect(job.providerAttempt).toBe("openai");
	});

	it("detects stale heartbeat when threshold exceeded", () => {
		const id = createJob();
		const job = getJob(id)!;
		expect(isJobStale(job)).toBe(false);

		// Simulate stale heartbeat by backdating
		job.lastHeartbeat = Date.now() - HEARTBEAT_STALE_MS - 1000;
		expect(isJobStale(job)).toBe(true);
	});

	it("does not consider completed/failed jobs as stale", () => {
		const id = createJob();
		const job = getJob(id)!;
		job.lastHeartbeat = Date.now() - HEARTBEAT_STALE_MS - 5000;

		completeJob(id, "done");
		expect(isJobStale(job)).toBe(false);

		const id2 = createJob();
		const job2 = getJob(id2)!;
		job2.lastHeartbeat = Date.now() - HEARTBEAT_STALE_MS - 5000;
		failJob(id2, "error");
		expect(isJobStale(job2)).toBe(false);
	});

	it("heartbeat does not update completed jobs", () => {
		const id = createJob();
		completeJob(id, "result");
		const hb = createHeartbeat(id);

		hb({ activity: "should not update", attempt: 99, provider: "ghost" });
		const job = getJob(id)!;
		expect(job.lastActivity).toBeUndefined();
		expect(job.attemptNumber).toBeUndefined();
	});

	it("evicts old completed jobs but keeps running ones", () => {
		const runningId = createJob();
		const completedId = createJob();
		completeJob(completedId, "done");

		// Backdate the completed job
		const completedJob = getJob(completedId)!;
		completedJob.createdAt = Date.now() - 31 * 60_000;

		evictStaleJobs();

		expect(getJob(runningId)).toBeDefined();
		expect(getJob(completedId)).toBeUndefined();
	});

	it("returns undefined for unknown job IDs", () => {
		expect(getJob("pj-nonexistent")).toBeUndefined();
	});
});
