import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JobQueue } from "../src/job-queue.js";
import { JobScheduler } from "../src/scheduler.js";
import type { SchedulerJob, SchedulerJobStatus, JobPriority } from "../src/scheduler-types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal SchedulerJob for queue tests. */
function makeJob(
	overrides: Partial<SchedulerJob> & { id: string },
): SchedulerJob {
	return {
		type: "test",
		priority: "normal",
		status: "queued",
		payload: {},
		retryCount: 0,
		maxRetries: 3,
		timeoutMs: 5000,
		createdAt: Date.now(),
		...overrides,
	};
}

/** Small delay helper for async scheduler tests. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── JobQueue Tests ───────────────────────────────────────────────────────────

describe("JobQueue", () => {
	let queue: JobQueue;

	beforeEach(() => {
		queue = new JobQueue();
	});

	it("starts empty", () => {
		expect(queue.size).toBe(0);
		expect(queue.isEmpty).toBe(true);
		expect(queue.peek()).toBeUndefined();
	});

	it("enqueues and dequeues a single job", () => {
		const job = makeJob({ id: "j1" });
		queue.enqueue(job);
		expect(queue.size).toBe(1);
		expect(queue.peek()?.id).toBe("j1");

		const dequeued = queue.dequeueEligible();
		expect(dequeued?.id).toBe("j1");
		expect(queue.isEmpty).toBe(true);
	});

	it("orders by priority (critical before background)", () => {
		const priorities: JobPriority[] = ["background", "low", "normal", "high", "critical"];
		for (const p of priorities) {
			queue.enqueue(makeJob({ id: `job-${p}`, priority: p }));
		}

		const result: string[] = [];
		while (!queue.isEmpty) {
			const job = queue.dequeueEligible();
			if (job) result.push(job.id);
		}

		expect(result).toEqual([
			"job-critical",
			"job-high",
			"job-normal",
			"job-low",
			"job-background",
		]);
	});

	it("orders by scheduledAt within same priority", () => {
		const now = Date.now();
		queue.enqueue(makeJob({ id: "later", priority: "normal", scheduledAt: now + 100, createdAt: now }));
		queue.enqueue(makeJob({ id: "earlier", priority: "normal", scheduledAt: now - 100, createdAt: now }));

		const first = queue.dequeueEligible();
		expect(first?.id).toBe("earlier");
	});

	it("skips deferred jobs not yet eligible", () => {
		const future = Date.now() + 60_000;
		queue.enqueue(makeJob({ id: "deferred", scheduledAt: future }));
		queue.enqueue(makeJob({ id: "ready" }));

		const next = queue.dequeueEligible();
		expect(next?.id).toBe("ready");
		expect(queue.size).toBe(1); // deferred still in queue
	});

	it("returns undefined when only deferred jobs remain", () => {
		const future = Date.now() + 60_000;
		queue.enqueue(makeJob({ id: "deferred", scheduledAt: future }));

		const next = queue.dequeueEligible();
		expect(next).toBeUndefined();
		expect(queue.size).toBe(1);
	});

	it("removes a job by ID", () => {
		queue.enqueue(makeJob({ id: "a" }));
		queue.enqueue(makeJob({ id: "b" }));
		queue.enqueue(makeJob({ id: "c" }));

		const removed = queue.remove("b");
		expect(removed?.id).toBe("b");
		expect(queue.size).toBe(2);
		expect(queue.has("b")).toBe(false);
	});

	it("returns undefined when removing non-existent job", () => {
		expect(queue.remove("ghost")).toBeUndefined();
	});

	it("drains all jobs in priority order", () => {
		queue.enqueue(makeJob({ id: "low", priority: "low" }));
		queue.enqueue(makeJob({ id: "high", priority: "high" }));
		queue.enqueue(makeJob({ id: "normal", priority: "normal" }));

		const drained = queue.drain();
		expect(drained.map((j) => j.id)).toEqual(["high", "normal", "low"]);
		expect(queue.isEmpty).toBe(true);
	});

	it("throws on duplicate enqueue", () => {
		queue.enqueue(makeJob({ id: "dup" }));
		expect(() => queue.enqueue(makeJob({ id: "dup" }))).toThrow("already in the queue");
	});

	it("has() returns correct membership", () => {
		queue.enqueue(makeJob({ id: "x" }));
		expect(queue.has("x")).toBe(true);
		expect(queue.has("y")).toBe(false);
	});

	it("toArray returns a snapshot of all jobs", () => {
		queue.enqueue(makeJob({ id: "a" }));
		queue.enqueue(makeJob({ id: "b" }));
		const arr = queue.toArray();
		expect(arr).toHaveLength(2);
		// Snapshot should not affect queue
		expect(queue.size).toBe(2);
	});
});

// ── JobScheduler Tests ───────────────────────────────────────────────────────

describe("JobScheduler", () => {
	let scheduler: JobScheduler;

	beforeEach(() => {
		vi.useFakeTimers();
		scheduler = new JobScheduler({
			maxConcurrent: 2,
			pollIntervalMs: 50,
			defaultTimeout: 5000,
			defaultMaxRetries: 2,
		});
	});

	afterEach(async () => {
		await scheduler.stop(false);
		vi.useRealTimers();
	});

	it("submits a job and returns a valid ID", () => {
		const id = scheduler.submit({
			type: "test",
			priority: "normal",
			payload: { key: "value" },
			timeoutMs: 1000,
			maxRetries: 1,
		});
		expect(id).toMatch(/^job-/);
		const job = scheduler.getJob(id);
		expect(job).toBeDefined();
		expect(job!.status).toBe("queued");
		expect(job!.payload).toEqual({ key: "value" });
	});

	it("executes a submitted job to completion", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		scheduler.registerHandler("simple", async () => "done");

		const id = scheduler.submit({
			type: "simple",
			priority: "normal",
			payload: {},
			timeoutMs: 5000,
			maxRetries: 0,
		});

		scheduler.start();
		await delay(100);

		const job = scheduler.getJob(id);
		expect(job?.status).toBe("completed");
		expect(job?.result).toBe("done");
		await scheduler.stop(false);
	});

	it("executes jobs in priority order", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 1, pollIntervalMs: 10 });

		const order: string[] = [];
		scheduler.registerHandler("ordered", async (job) => {
			order.push(job.priority);
			return job.priority;
		});

		// Submit in reverse priority order before starting
		scheduler.submit({ type: "ordered", priority: "background", payload: {}, timeoutMs: 5000, maxRetries: 0 });
		scheduler.submit({ type: "ordered", priority: "critical", payload: {}, timeoutMs: 5000, maxRetries: 0 });
		scheduler.submit({ type: "ordered", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });

		scheduler.start();
		await delay(300);

		expect(order).toEqual(["critical", "normal", "background"]);
		await scheduler.stop(false);
	});

	it("respects concurrency limit", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		let peakConcurrent = 0;
		let currentConcurrent = 0;

		scheduler.registerHandler("conc", async () => {
			currentConcurrent++;
			if (currentConcurrent > peakConcurrent) {
				peakConcurrent = currentConcurrent;
			}
			await delay(50);
			currentConcurrent--;
			return "ok";
		});

		for (let i = 0; i < 5; i++) {
			scheduler.submit({ type: "conc", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });
		}

		scheduler.start();
		await delay(500);

		expect(peakConcurrent).toBeLessThanOrEqual(2);
		const stats = scheduler.getStats();
		expect(stats.completed).toBe(5);
		await scheduler.stop(false);
	});

	it("defers job execution by delay", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		let executed = false;
		scheduler.registerHandler("deferred", async () => {
			executed = true;
			return "deferred-result";
		});

		const id = scheduler.defer(
			{ type: "deferred", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 },
			100,
		);

		scheduler.start();

		// Should not have run yet
		await delay(30);
		expect(executed).toBe(false);

		// Wait for the deferred time to pass
		await delay(200);
		expect(executed).toBe(true);
		expect(scheduler.getJob(id)?.status).toBe("completed");
		await scheduler.stop(false);
	});

	it("cancels a queued job", () => {
		const id = scheduler.submit({
			type: "test",
			priority: "normal",
			payload: {},
			timeoutMs: 1000,
			maxRetries: 0,
		});

		const cancelled = scheduler.cancel(id);
		expect(cancelled).toBe(true);
		expect(scheduler.getJob(id)?.status).toBe("cancelled");
	});

	it("cannot cancel a non-existent job", () => {
		expect(scheduler.cancel("nope")).toBe(false);
	});

	it("retries a failing job with exponential backoff", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10, defaultMaxRetries: 2 });

		let attempts = 0;
		scheduler.registerHandler("flaky", async () => {
			attempts++;
			throw new Error("boom");
		});

		const id = scheduler.submit({
			type: "flaky",
			priority: "normal",
			payload: {},
			timeoutMs: 5000,
			maxRetries: 2,
		});

		scheduler.start();
		// Wait enough for initial + 2 retries with backoff (500ms + 1000ms + margin)
		await delay(2500);

		const job = scheduler.getJob(id);
		expect(job?.status).toBe("failed");
		expect(job?.error).toBe("boom");
		// 1 initial + 2 retries = 3 attempts
		expect(attempts).toBe(3);
		expect(job?.retryCount).toBe(3);
		await scheduler.stop(false);
	});

	it("enforces per-job timeout", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		scheduler.registerHandler("slow", async () => {
			await delay(10_000); // Much longer than timeout
			return "should not reach";
		});

		const id = scheduler.submit({
			type: "slow",
			priority: "normal",
			payload: {},
			timeoutMs: 50,
			maxRetries: 0,
		});

		scheduler.start();
		await delay(200);

		const job = scheduler.getJob(id);
		expect(job?.status).toBe("failed");
		expect(job?.error).toContain("timed out");
		await scheduler.stop(false);
	});

	it("fails immediately when no handler is registered", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		const id = scheduler.submit({
			type: "unregistered",
			priority: "normal",
			payload: {},
			timeoutMs: 5000,
			maxRetries: 0,
		});

		scheduler.start();
		await delay(100);

		const job = scheduler.getJob(id);
		expect(job?.status).toBe("failed");
		expect(job?.error).toContain("No handler registered");
		await scheduler.stop(false);
	});

	it("getStats returns correct counters", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 4, pollIntervalMs: 10 });

		scheduler.registerHandler("stat", async () => "ok");

		scheduler.submit({ type: "stat", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });
		scheduler.submit({ type: "stat", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });

		scheduler.start();
		await delay(200);

		const stats = scheduler.getStats();
		expect(stats.completed).toBe(2);
		expect(stats.failed).toBe(0);
		expect(stats.pending).toBe(0);
		expect(stats.workers.total).toBe(4);
		await scheduler.stop(false);
	});

	it("listJobs returns all jobs", () => {
		scheduler.submit({ type: "test", priority: "normal", payload: {}, timeoutMs: 1000, maxRetries: 0 });
		scheduler.submit({ type: "test", priority: "high", payload: {}, timeoutMs: 1000, maxRetries: 0 });

		const all = scheduler.listJobs();
		expect(all).toHaveLength(2);
	});

	it("listJobs filters by status", () => {
		const id = scheduler.submit({ type: "test", priority: "normal", payload: {}, timeoutMs: 1000, maxRetries: 0 });
		scheduler.cancel(id);
		scheduler.submit({ type: "test", priority: "normal", payload: {}, timeoutMs: 1000, maxRetries: 0 });

		const cancelled = scheduler.listJobs("cancelled");
		expect(cancelled).toHaveLength(1);
		expect(cancelled[0].id).toBe(id);

		const queued = scheduler.listJobs("queued");
		expect(queued).toHaveLength(1);
	});

	it("emits job change events", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		const statuses: SchedulerJobStatus[] = [];
		const unsub = scheduler.onJobChange((job) => {
			statuses.push(job.status);
		});

		scheduler.registerHandler("evented", async () => "done");
		scheduler.submit({ type: "evented", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });

		scheduler.start();
		await delay(200);

		// Expect at least: queued -> running -> completed
		expect(statuses).toContain("queued");
		expect(statuses).toContain("running");
		expect(statuses).toContain("completed");

		unsub();
		await scheduler.stop(false);
	});

	it("onJobChange unsubscribe stops events", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		let callCount = 0;
		const unsub = scheduler.onJobChange(() => {
			callCount++;
		});

		scheduler.registerHandler("test", async () => "ok");
		scheduler.submit({ type: "test", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });
		unsub(); // Unsubscribe before start

		scheduler.start();
		await delay(200);

		// Should have received at most the initial "queued" event before unsub
		expect(callCount).toBeLessThanOrEqual(1);
		await scheduler.stop(false);
	});

	it("graceful shutdown waits for running jobs", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		let completed = false;
		scheduler.registerHandler("long", async () => {
			await delay(100);
			completed = true;
			return "done";
		});

		scheduler.submit({ type: "long", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });
		scheduler.start();
		await delay(20); // Let it start running

		await scheduler.stop(true); // Graceful
		expect(completed).toBe(true);
	});

	it("non-graceful shutdown stops immediately", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		scheduler.registerHandler("long", async () => {
			await delay(500);
			return "done";
		});

		scheduler.submit({ type: "long", priority: "normal", payload: {}, timeoutMs: 5000, maxRetries: 0 });
		scheduler.start();
		await delay(20);

		// Non-graceful stop returns immediately
		await scheduler.stop(false);
		// Scheduler is stopped — no new dispatches
		expect(scheduler.getStats().running).toBeLessThanOrEqual(1);
	});

	it("start is idempotent", () => {
		scheduler.start();
		scheduler.start(); // Should not throw or create duplicate timers
		expect(scheduler.getStats().workers.total).toBe(2);
	});

	it("stop is idempotent when already stopped", async () => {
		await scheduler.stop(false);
		await scheduler.stop(false); // Should not throw
	});

	it("handles handler that throws synchronously in async context", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 2, pollIntervalMs: 10 });

		scheduler.registerHandler("sync-throw", async () => {
			throw new TypeError("sync error in async handler");
		});

		const id = scheduler.submit({
			type: "sync-throw",
			priority: "normal",
			payload: {},
			timeoutMs: 5000,
			maxRetries: 0,
		});

		scheduler.start();
		await delay(100);

		const job = scheduler.getJob(id);
		expect(job?.status).toBe("failed");
		expect(job?.error).toBe("sync error in async handler");
		await scheduler.stop(false);
	});

	it("uses default config values when none provided", () => {
		vi.useRealTimers();
		const defaultScheduler = new JobScheduler();
		const stats = defaultScheduler.getStats();
		expect(stats.workers.total).toBe(4); // DEFAULT_MAX_CONCURRENT
	});

	it("getJob returns undefined for non-existent ID", () => {
		expect(scheduler.getJob("nonexistent")).toBeUndefined();
	});

	it("processes many jobs sequentially with concurrency of 1", async () => {
		vi.useRealTimers();
		scheduler = new JobScheduler({ maxConcurrent: 1, pollIntervalMs: 10 });

		const results: number[] = [];
		scheduler.registerHandler("seq", async (job) => {
			const val = job.payload.n as number;
			results.push(val);
			return val;
		});

		for (let i = 0; i < 5; i++) {
			scheduler.submit({
				type: "seq",
				priority: "normal",
				payload: { n: i },
				timeoutMs: 5000,
				maxRetries: 0,
			});
		}

		scheduler.start();
		await delay(300);

		expect(results).toHaveLength(5);
		const stats = scheduler.getStats();
		expect(stats.completed).toBe(5);
		await scheduler.stop(false);
	});
});
