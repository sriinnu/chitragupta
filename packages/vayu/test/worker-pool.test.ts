import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

// ─── Mock Worker ────────────────────────────────────────────────────────────

let mockWorkerInstances: MockWorker[] = [];

class MockWorker extends EventEmitter {
	postMessage = vi.fn();
	terminate = vi.fn().mockResolvedValue(0);

	constructor() {
		super();
		mockWorkerInstances.push(this);
	}
}

vi.mock("node:worker_threads", () => ({
	Worker: vi.fn(function (this: any) {
		return new MockWorker();
	}),
}));

import { WorkerPool } from "../src/worker-pool.js";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("WorkerPool", () => {
	beforeEach(() => {
		mockWorkerInstances = [];
		vi.clearAllMocks();
	});

	afterEach(() => {
		mockWorkerInstances = [];
	});

	// ── Constructor ──────────────────────────────────────────────────────

	describe("constructor", () => {
		it("should create the specified number of workers", () => {
			const pool = new WorkerPool("test.js", { size: 3 });
			expect(mockWorkerInstances).toHaveLength(3);
			pool.kill();
		});

		it("should default to at least 1 worker", () => {
			const pool = new WorkerPool("test.js", { size: 0 });
			expect(mockWorkerInstances.length).toBeGreaterThanOrEqual(1);
			pool.kill();
		});

		it("should cap at 16 workers maximum", () => {
			const pool = new WorkerPool("test.js", { size: 100 });
			expect(mockWorkerInstances).toHaveLength(16);
			pool.kill();
		});

		it("should enforce minimum of 1 worker", () => {
			const pool = new WorkerPool("test.js", { size: -5 });
			expect(mockWorkerInstances.length).toBeGreaterThanOrEqual(1);
			pool.kill();
		});
	});

	// ── getStats ─────────────────────────────────────────────────────────

	describe("getStats", () => {
		it("should show all workers as idle initially", () => {
			const pool = new WorkerPool("test.js", { size: 4 });
			const stats = pool.getStats();
			expect(stats.activeWorkers).toBe(0);
			expect(stats.idleWorkers).toBe(4);
			expect(stats.queuedTasks).toBe(0);
			expect(stats.completedTasks).toBe(0);
			expect(stats.failedTasks).toBe(0);
			expect(stats.averageDuration).toBe(0);
			pool.kill();
		});

		it("should show active workers when tasks are dispatched", () => {
			const pool = new WorkerPool("test.js", { size: 2 });
			// Submit a task — it will be dispatched to an idle worker
			pool.submit({ type: "test", data: {} });
			const stats = pool.getStats();
			expect(stats.activeWorkers).toBe(1);
			expect(stats.idleWorkers).toBe(1);
			pool.kill();
		});

		it("should show queued tasks when all workers are busy", () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			pool.submit({ type: "t1", data: {} }).catch(() => {});
			pool.submit({ type: "t2", data: {} }).catch(() => {});

			const stats = pool.getStats();
			expect(stats.activeWorkers).toBe(1);
			expect(stats.queuedTasks).toBe(1);
			pool.kill();
		});
	});

	// ── submit ───────────────────────────────────────────────────────────

	describe("submit", () => {
		it("should dispatch task to an idle worker via postMessage", () => {
			const pool = new WorkerPool("test.js", { size: 2 });
			pool.submit({ type: "analyze", data: { code: "x" } });

			// At least one worker should have received a message
			const posted = mockWorkerInstances.some(
				(w) => w.postMessage.mock.calls.length > 0,
			);
			expect(posted).toBe(true);
			pool.kill();
		});

		it("should include an id in the dispatched task", () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			pool.submit({ type: "test", data: {} });

			const worker = mockWorkerInstances[0];
			const sentTask = worker.postMessage.mock.calls[0][0];
			expect(sentTask).toHaveProperty("id");
			expect(typeof sentTask.id).toBe("string");
			expect(sentTask.type).toBe("test");
			pool.kill();
		});

		it("should resolve with success when worker responds", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			const resultPromise = pool.submit({ type: "test", data: {} });

			const worker = mockWorkerInstances[0];
			const sentTask = worker.postMessage.mock.calls[0][0];

			// Simulate worker response
			worker.emit("message", {
				taskId: sentTask.id,
				success: true,
				data: { answer: 42 },
			});

			const result = await resultPromise;
			expect(result.success).toBe(true);
			expect(result.taskId).toBe(sentTask.id);
			expect(result.data).toEqual({ answer: 42 });
			expect(result.duration).toBeGreaterThanOrEqual(0);
			pool.kill();
		});

		it("should resolve with failure when worker responds with success=false", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			const resultPromise = pool.submit({ type: "test", data: {} });

			const worker = mockWorkerInstances[0];
			const sentTask = worker.postMessage.mock.calls[0][0];

			worker.emit("message", {
				taskId: sentTask.id,
				success: false,
				error: "Something went wrong",
			});

			const result = await resultPromise;
			expect(result.success).toBe(false);
			expect(result.error).toBe("Something went wrong");
			pool.kill();
		});

		it("should resolve with failure when worker emits error", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			const resultPromise = pool.submit({ type: "test", data: {} });

			const worker = mockWorkerInstances[0];
			// Need to add error listener to avoid unhandled error crash on the spawnWorker error handler
			// The pool's spawnWorker adds an error listener, but the mock worker
			// also sees the error. Let's just emit.
			worker.emit("error", new Error("Worker crashed"));

			const result = await resultPromise;
			expect(result.success).toBe(false);
			expect(result.error).toBe("Worker crashed");
			pool.kill();
		});

		it("should reject when pool has been killed", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			pool.kill();

			await expect(pool.submit({ type: "test", data: {} })).rejects.toThrow(
				"WorkerPool has been killed",
			);
		});

		it("should reject when pool is shutting down", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			// Start shutdown
			const shutdownPromise = pool.shutdown();

			await expect(pool.submit({ type: "test", data: {} })).rejects.toThrow(
				"WorkerPool is shutting down",
			);

			await shutdownPromise;
		});

		it("should reject when queue is full", async () => {
			const pool = new WorkerPool("test.js", { size: 1, maxQueueSize: 2 });

			// Fill the single worker
			pool.submit({ type: "t1", data: {} }).catch(() => {});
			// These go to the queue
			pool.submit({ type: "t2", data: {} }).catch(() => {});
			pool.submit({ type: "t3", data: {} }).catch(() => {});

			// Queue is now full (2)
			await expect(pool.submit({ type: "overflow", data: {} })).rejects.toThrow(
				"Task queue full",
			);
			pool.kill();
		});

		it("should drain the queue when a worker becomes idle", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });

			const p1 = pool.submit({ type: "first", data: {} });
			const p2 = pool.submit({ type: "second", data: {} });

			const worker = mockWorkerInstances[0];
			const firstTask = worker.postMessage.mock.calls[0][0];

			// Complete first task
			worker.emit("message", {
				taskId: firstTask.id,
				success: true,
				data: "done1",
			});

			await p1;

			// The second task should now be dispatched
			expect(worker.postMessage.mock.calls.length).toBe(2);

			const secondTask = worker.postMessage.mock.calls[1][0];
			worker.emit("message", {
				taskId: secondTask.id,
				success: true,
				data: "done2",
			});

			const result2 = await p2;
			expect(result2.success).toBe(true);
			pool.kill();
		});

		it("should update completedTasks count on success", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			const resultPromise = pool.submit({ type: "test", data: {} });

			const worker = mockWorkerInstances[0];
			const sentTask = worker.postMessage.mock.calls[0][0];
			worker.emit("message", { taskId: sentTask.id, success: true });

			await resultPromise;
			expect(pool.getStats().completedTasks).toBe(1);
			pool.kill();
		});

		it("should update failedTasks count on failure", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			const resultPromise = pool.submit({ type: "test", data: {} });

			const worker = mockWorkerInstances[0];
			const sentTask = worker.postMessage.mock.calls[0][0];
			worker.emit("message", { taskId: sentTask.id, success: false, error: "fail" });

			await resultPromise;
			expect(pool.getStats().failedTasks).toBe(1);
			pool.kill();
		});
	});

	// ── submitAll ────────────────────────────────────────────────────────

	describe("submitAll", () => {
		it("should submit all tasks and return results", async () => {
			const pool = new WorkerPool("test.js", { size: 3 });

			const promise = pool.submitAll([
				{ type: "a", data: {} },
				{ type: "b", data: {} },
				{ type: "c", data: {} },
			]);

			// Each task goes to a different worker
			for (const worker of mockWorkerInstances) {
				if (worker.postMessage.mock.calls.length > 0) {
					const task = worker.postMessage.mock.calls[0][0];
					worker.emit("message", { taskId: task.id, success: true });
				}
			}

			const results = await promise;
			expect(results).toHaveLength(3);
			expect(results.every((r) => r.success)).toBe(true);
			pool.kill();
		});
	});

	// ── shutdown ─────────────────────────────────────────────────────────

	describe("shutdown", () => {
		it("should terminate all idle workers", async () => {
			const pool = new WorkerPool("test.js", { size: 2 });
			const workers = [...mockWorkerInstances];
			await pool.shutdown();

			for (const w of workers) {
				expect(w.terminate).toHaveBeenCalled();
			}
		});

		it("should reject queued tasks that have not been dispatched", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			// Occupy the only worker — catch to prevent unhandled rejection on kill
			const busyPromise = pool.submit({ type: "busy", data: {} }).catch(() => {});
			// This goes to the queue
			const queuedPromise = pool.submit({ type: "queued", data: {} });

			// Shutdown: queued task should be rejected
			const shutdownPromise = pool.shutdown();

			await expect(queuedPromise).rejects.toThrow("shutting down");

			// Complete the busy task so shutdown can finish
			const worker = mockWorkerInstances[0];
			const busyTask = worker.postMessage.mock.calls[0][0];
			worker.emit("message", { taskId: busyTask.id, success: true });

			await shutdownPromise;
		});

		it("should set shuttingDown flag so new submits are rejected", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			const shutdownPromise = pool.shutdown();

			await expect(pool.submit({ type: "late", data: {} })).rejects.toThrow(
				"shutting down",
			);

			await shutdownPromise;
		});
	});

	// ── kill ─────────────────────────────────────────────────────────────

	describe("kill", () => {
		it("should terminate all workers immediately", () => {
			const pool = new WorkerPool("test.js", { size: 3 });
			const workers = [...mockWorkerInstances];
			pool.kill();

			for (const w of workers) {
				expect(w.terminate).toHaveBeenCalled();
			}
		});

		it("should set killed flag", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			pool.kill();

			await expect(pool.submit({ type: "test", data: {} })).rejects.toThrow(
				"killed",
			);
		});

		it("should reject all queued tasks", async () => {
			const pool = new WorkerPool("test.js", { size: 1 });
			// busy task will also be orphaned — catch it
			pool.submit({ type: "busy", data: {} }).catch(() => {});
			const queued = pool.submit({ type: "queued", data: {} });

			pool.kill();

			await expect(queued).rejects.toThrow("killed");
		});

		it("should clear the workers array", () => {
			const pool = new WorkerPool("test.js", { size: 2 });
			pool.kill();
			const stats = pool.getStats();
			expect(stats.activeWorkers).toBe(0);
			expect(stats.idleWorkers).toBe(0);
		});
	});

	// ── Timeout ──────────────────────────────────────────────────────────

	describe("task timeout", () => {
		it("should resolve with failure after timeout", async () => {
			vi.useFakeTimers();
			const pool = new WorkerPool("test.js", { size: 1, taskTimeout: 100 });
			const resultPromise = pool.submit({ type: "slow", data: {} });

			vi.advanceTimersByTime(150);

			const result = await resultPromise;
			expect(result.success).toBe(false);
			expect(result.error).toContain("timed out");

			vi.useRealTimers();
			pool.kill();
		});
	});
});
