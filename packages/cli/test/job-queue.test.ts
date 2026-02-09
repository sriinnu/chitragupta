import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JobQueue, QueueFullError } from "../src/job-queue.js";
import type { JobRunner, JobQueueConfig } from "../src/job-queue.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a runner that resolves after a delay. */
function delayRunner(ms: number, response = "done"): JobRunner {
	return async (_msg, _onEvent, signal) => {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(resolve, ms);
			signal.addEventListener("abort", () => {
				clearTimeout(timer);
				reject(new Error("Aborted"));
			});
		});
		return response;
	};
}

/** Create a runner that immediately resolves. */
function immediateRunner(response = "ok"): JobRunner {
	return async () => response;
}

/** Create a runner that immediately rejects. */
function failRunner(errorMsg = "boom"): JobRunner {
	return async () => { throw new Error(errorMsg); };
}

/** Wait for a condition with timeout. */
async function waitFor(
	predicate: () => boolean,
	timeoutMs = 2000,
	intervalMs = 10,
): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitFor timed out after ${timeoutMs}ms`);
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("JobQueue", () => {
	let queue: JobQueue;

	afterEach(() => {
		queue?.destroy();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Job creation
	// ═══════════════════════════════════════════════════════════════════════

	describe("submit", () => {
		it("should create a job with a valid ID and correct fields", () => {
			queue = new JobQueue(delayRunner(5000), { maxConcurrent: 1 });
			// First job takes the running slot
			queue.submit("blocker");
			// Second job stays pending
			const job = queue.submit("Hello");

			expect(job.id).toMatch(/^job-[a-z0-9]+-[a-f0-9]{8}$/);
			expect(job.status).toBe("pending");
			expect(job.message).toBe("Hello");
			expect(job.events).toEqual([]);
			expect(job.createdAt).toBeGreaterThan(0);
			expect(job.response).toBeUndefined();
			expect(job.error).toBeUndefined();
		});

		it("should start a job immediately when concurrency permits", () => {
			queue = new JobQueue(delayRunner(5000), { maxConcurrent: 1 });
			const job = queue.submit("Hello");

			// Job transitions to running synchronously because slot is available
			expect(job.id).toMatch(/^job-[a-z0-9]+-[a-f0-9]{8}$/);
			expect(job.status).toBe("running");
			expect(job.startedAt).toBeGreaterThan(0);
		});

		it("should attach metadata to the job", () => {
			queue = new JobQueue(delayRunner(5000));
			const job = queue.submit("test", { source: "vaayu", priority: 1 });

			expect(job.metadata).toEqual({ source: "vaayu", priority: 1 });
		});

		it("should throw QueueFullError when queue is full", () => {
			queue = new JobQueue(delayRunner(5000), { maxQueueSize: 2, maxConcurrent: 1 });

			// First job starts running immediately (slot 1 of maxQueueSize)
			queue.submit("job-1");
			// Second job goes to pending queue (slot 2 of maxQueueSize)
			queue.submit("job-2");
			// Third job should be rejected — 1 running + 1 pending = 2 = maxQueueSize
			expect(() => queue.submit("job-3")).toThrow(QueueFullError);
			expect(() => queue.submit("job-3")).toThrow(/full/);
		});

		it("should throw when queue is destroyed", () => {
			queue = new JobQueue(immediateRunner());
			queue.destroy();

			expect(() => queue.submit("test")).toThrow(/destroyed/);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Queue processing lifecycle
	// ═══════════════════════════════════════════════════════════════════════

	describe("processing", () => {
		it("should transition job from pending to running to completed", async () => {
			queue = new JobQueue(immediateRunner("hello world"));
			const job = queue.submit("test");

			await waitFor(() => job.status === "completed");

			expect(job.status).toBe("completed");
			expect(job.response).toBe("hello world");
			expect(job.startedAt).toBeGreaterThan(0);
			expect(job.completedAt).toBeGreaterThanOrEqual(job.startedAt!);
		});

		it("should mark jobs as failed when the runner throws", async () => {
			queue = new JobQueue(failRunner("something broke"));
			const job = queue.submit("test");

			await waitFor(() => job.status === "failed");

			expect(job.status).toBe("failed");
			expect(job.error).toBe("something broke");
			expect(job.completedAt).toBeGreaterThan(0);
		});

		it("should process pending jobs after earlier jobs complete", async () => {
			let resolvers: (() => void)[] = [];
			const controlledRunner: JobRunner = async (msg) => {
				await new Promise<void>((resolve) => { resolvers.push(resolve); });
				return `done-${msg}`;
			};

			queue = new JobQueue(controlledRunner, { maxConcurrent: 1 });
			const job1 = queue.submit("first");
			const job2 = queue.submit("second");

			// job1 should be running, job2 pending
			await waitFor(() => resolvers.length === 1);
			expect(job1.status).toBe("running");
			expect(job2.status).toBe("pending");

			// Complete job1 — job2 should start
			resolvers[0]();
			await waitFor(() => job1.status === "completed");
			await waitFor(() => resolvers.length === 2);
			expect(job2.status).toBe("running");

			// Complete job2
			resolvers[1]();
			await waitFor(() => job2.status === "completed");
			expect(job2.response).toBe("done-second");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Concurrency control
	// ═══════════════════════════════════════════════════════════════════════

	describe("concurrency", () => {
		it("should only run maxConcurrent jobs at a time", async () => {
			let activeCount = 0;
			let maxActive = 0;

			const trackingRunner: JobRunner = async () => {
				activeCount++;
				maxActive = Math.max(maxActive, activeCount);
				await new Promise((r) => setTimeout(r, 50));
				activeCount--;
				return "done";
			};

			queue = new JobQueue(trackingRunner, { maxConcurrent: 2 });

			const jobs = Array.from({ length: 5 }, (_, i) => queue.submit(`job-${i}`));

			await waitFor(() => jobs.every((j) => j.status === "completed"), 5000);

			expect(maxActive).toBe(2);
			expect(jobs.every((j) => j.response === "done")).toBe(true);
		});

		it("should clamp maxConcurrent to system ceiling", () => {
			// System max is 16 — requesting 100 should be clamped
			queue = new JobQueue(immediateRunner(), { maxConcurrent: 100 });
			const stats = queue.getStats();
			expect(stats.maxConcurrent).toBe(16);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Cancellation
	// ═══════════════════════════════════════════════════════════════════════

	describe("cancelJob", () => {
		it("should cancel a pending job", () => {
			queue = new JobQueue(delayRunner(5000), { maxConcurrent: 1 });
			queue.submit("blocker"); // takes the running slot
			const pending = queue.submit("to-cancel");

			expect(pending.status).toBe("pending");
			const result = queue.cancelJob(pending.id);

			expect(result).toBe(true);
			expect(pending.status).toBe("cancelled");
			expect(pending.completedAt).toBeGreaterThan(0);
		});

		it("should cancel a running job via abort signal", async () => {
			let aborted = false;
			const abortableRunner: JobRunner = async (_msg, _onEvent, signal) => {
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(resolve, 5000);
					signal.addEventListener("abort", () => {
						clearTimeout(timer);
						aborted = true;
						reject(new Error("Aborted"));
					});
				});
				return "never";
			};

			queue = new JobQueue(abortableRunner, { maxConcurrent: 1 });
			const job = queue.submit("test");

			await waitFor(() => job.status === "running");

			const result = queue.cancelJob(job.id);
			expect(result).toBe(true);
			expect(job.status).toBe("cancelled");
			expect(aborted).toBe(true);
		});

		it("should return false for completed jobs", async () => {
			queue = new JobQueue(immediateRunner());
			const job = queue.submit("test");

			await waitFor(() => job.status === "completed");

			expect(queue.cancelJob(job.id)).toBe(false);
		});

		it("should return false for non-existent jobs", () => {
			queue = new JobQueue(immediateRunner());
			expect(queue.cancelJob("job-nonexistent")).toBe(false);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Job retrieval
	// ═══════════════════════════════════════════════════════════════════════

	describe("getJob", () => {
		it("should return the job by ID", () => {
			queue = new JobQueue(delayRunner(5000));
			const job = queue.submit("test");

			const found = queue.getJob(job.id);
			expect(found).toBe(job);
		});

		it("should return undefined for unknown ID", () => {
			queue = new JobQueue(immediateRunner());
			expect(queue.getJob("job-xxx")).toBeUndefined();
		});
	});

	describe("listJobs", () => {
		it("should return all jobs", () => {
			queue = new JobQueue(delayRunner(5000), { maxConcurrent: 1 });
			queue.submit("a");
			queue.submit("b");
			queue.submit("c");

			const all = queue.listJobs();
			expect(all).toHaveLength(3);
		});

		it("should filter by status", async () => {
			queue = new JobQueue(delayRunner(5000), { maxConcurrent: 1 });
			queue.submit("running-job");
			queue.submit("pending-job");

			await waitFor(() => queue.getStats().running === 1);

			const pending = queue.listJobs({ status: "pending" });
			expect(pending).toHaveLength(1);
			expect(pending[0].message).toBe("pending-job");

			const running = queue.listJobs({ status: "running" });
			expect(running).toHaveLength(1);
			expect(running[0].message).toBe("running-job");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Events
	// ═══════════════════════════════════════════════════════════════════════

	describe("events", () => {
		it("should capture events emitted by the runner", async () => {
			const eventRunner: JobRunner = async (_msg, onEvent) => {
				onEvent("stream:text", { text: "Hello" });
				onEvent("tool:start", { name: "search" });
				onEvent("tool:done", { name: "search", result: "found" });
				return "complete";
			};

			queue = new JobQueue(eventRunner);
			const job = queue.submit("test");

			await waitFor(() => job.status === "completed");

			expect(job.events).toHaveLength(3);
			expect(job.events[0].type).toBe("stream:text");
			expect(job.events[0].data).toEqual({ text: "Hello" });
			expect(job.events[0].timestamp).toBeGreaterThan(0);
			expect(job.events[1].type).toBe("tool:start");
			expect(job.events[2].type).toBe("tool:done");
		});

		it("should cap events at maxEventsPerJob", async () => {
			const floodRunner: JobRunner = async (_msg, onEvent) => {
				for (let i = 0; i < 100; i++) {
					onEvent("tick", { i });
				}
				return "done";
			};

			queue = new JobQueue(floodRunner, { maxEventsPerJob: 10 });
			const job = queue.submit("test");

			await waitFor(() => job.status === "completed");

			expect(job.events).toHaveLength(10);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Statistics
	// ═══════════════════════════════════════════════════════════════════════

	describe("getStats", () => {
		it("should return correct initial stats", () => {
			queue = new JobQueue(immediateRunner(), { maxConcurrent: 5, maxQueueSize: 100 });
			const stats = queue.getStats();

			expect(stats.pending).toBe(0);
			expect(stats.running).toBe(0);
			expect(stats.completed).toBe(0);
			expect(stats.failed).toBe(0);
			expect(stats.cancelled).toBe(0);
			expect(stats.total).toBe(0);
			expect(stats.maxConcurrent).toBe(5);
			expect(stats.maxQueueSize).toBe(100);
		});

		it("should reflect accurate counts across states", async () => {
			queue = new JobQueue(delayRunner(5000), { maxConcurrent: 1 });
			const j1 = queue.submit("running");
			const j2 = queue.submit("pending");

			await waitFor(() => j1.status === "running");

			let stats = queue.getStats();
			expect(stats.running).toBe(1);
			expect(stats.pending).toBe(1);
			expect(stats.total).toBe(2);

			queue.cancelJob(j2.id);
			stats = queue.getStats();
			expect(stats.cancelled).toBe(1);
			expect(stats.pending).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// TTL cleanup
	// ═══════════════════════════════════════════════════════════════════════

	describe("TTL cleanup", () => {
		it("should not delete jobs before TTL expires", async () => {
			// Use a very short TTL but don't trigger cleanup manually
			queue = new JobQueue(immediateRunner(), { jobTTL: 60_000 });
			const job = queue.submit("test");

			await waitFor(() => job.status === "completed");

			// Job should still exist
			expect(queue.getJob(job.id)).toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Destroy
	// ═══════════════════════════════════════════════════════════════════════

	describe("destroy", () => {
		it("should cancel all running and pending jobs", async () => {
			queue = new JobQueue(delayRunner(5000), { maxConcurrent: 1 });
			const j1 = queue.submit("running");
			const j2 = queue.submit("pending");

			await waitFor(() => j1.status === "running");

			queue.destroy();

			expect(j1.status).toBe("cancelled");
			expect(j2.status).toBe("cancelled");
			expect(j1.completedAt).toBeGreaterThan(0);
			expect(j2.completedAt).toBeGreaterThan(0);
		});

		it("should be idempotent", () => {
			queue = new JobQueue(immediateRunner());
			queue.destroy();
			queue.destroy(); // second call should not throw
		});
	});
});
