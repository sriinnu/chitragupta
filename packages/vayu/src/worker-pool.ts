/**
 * Shramika — Worker thread pool for CPU-intensive operations.
 * Sanskrit: Shramika (श्रमिक) = laborer, worker.
 *
 * Manages a pool of Node.js worker threads for parallel execution
 * of CPU-bound tasks (code analysis, large file processing, etc.)
 * without blocking the main event loop.
 *
 * Workers communicate via structured-clone postMessage. Each task
 * is a { id, type, data } object; the worker script must post back
 * { taskId, success, data?, error? }.
 */

import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import os from "node:os";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkerTask {
	id: string;
	type: string;
	data: unknown;
}

export interface WorkerResult {
	taskId: string;
	success: boolean;
	data?: unknown;
	error?: string;
	duration: number;
}

export interface WorkerPoolConfig {
	/** Number of workers. Default: CPU cores - 1, min 1, max 16 */
	size?: number;
	/** Task timeout in ms. Default: 30000 */
	taskTimeout?: number;
	/** Maximum queued tasks before submit() rejects. Default: 1000 */
	maxQueueSize?: number;
}

export interface WorkerPoolStats {
	activeWorkers: number;
	idleWorkers: number;
	queuedTasks: number;
	completedTasks: number;
	failedTasks: number;
	averageDuration: number;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface ManagedWorker {
	worker: Worker;
	busy: boolean;
}

interface QueuedItem {
	task: WorkerTask;
	resolve: (result: WorkerResult) => void;
	reject: (error: Error) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SYSTEM_MAX_POOL_SIZE = 16;
const DEFAULT_TASK_TIMEOUT = 30_000;
const DEFAULT_MAX_QUEUE = 1_000;

// ─── WorkerPool ─────────────────────────────────────────────────────────────

/**
 * A fixed-size pool of worker threads that accepts tasks via `submit()`
 * and returns results as Promises.
 *
 * @example
 * ```ts
 * const pool = new WorkerPool("./analyzer-worker.js", { size: 4 });
 * const result = await pool.submit({ type: "analyze", data: sourceCode });
 * await pool.shutdown();
 * ```
 */
export class WorkerPool {
	private readonly workers: ManagedWorker[] = [];
	private readonly queue: QueuedItem[] = [];
	private readonly workerScript: string;
	private readonly taskTimeout: number;
	private readonly maxQueueSize: number;
	private readonly poolSize: number;

	private completedTasks = 0;
	private failedTasks = 0;
	private totalDuration = 0;
	private shuttingDown = false;
	private killed = false;

	constructor(workerScript: string, config?: WorkerPoolConfig) {
		this.workerScript = workerScript;
		this.taskTimeout = config?.taskTimeout ?? DEFAULT_TASK_TIMEOUT;
		this.maxQueueSize = config?.maxQueueSize ?? DEFAULT_MAX_QUEUE;

		const cpus = os.cpus().length;
		const requestedSize = config?.size ?? Math.max(1, cpus - 1);
		this.poolSize = Math.max(1, Math.min(requestedSize, SYSTEM_MAX_POOL_SIZE));

		for (let i = 0; i < this.poolSize; i++) {
			this.workers.push(this.spawnWorker());
		}
	}

	/**
	 * Submit a single task to the pool.
	 * Resolves when a worker completes (or times out) the task.
	 */
	async submit(task: Omit<WorkerTask, "id">): Promise<WorkerResult> {
		if (this.killed) {
			throw new Error("WorkerPool has been killed");
		}
		if (this.shuttingDown) {
			throw new Error("WorkerPool is shutting down");
		}

		const fullTask: WorkerTask = { ...task, id: randomUUID() };

		return new Promise<WorkerResult>((resolve, reject) => {
			const idle = this.workers.find((w) => !w.busy);
			if (idle) {
				this.dispatch(idle, fullTask, resolve, reject);
			} else {
				if (this.queue.length >= this.maxQueueSize) {
					reject(new Error(
						`Task queue full (${this.maxQueueSize}). ` +
						`Try again later or increase maxQueueSize.`,
					));
					return;
				}
				this.queue.push({ task: fullTask, resolve, reject });
			}
		});
	}

	/**
	 * Submit multiple tasks and wait for all results.
	 * Individual task failures do not reject the whole batch; check
	 * each WorkerResult's `success` field.
	 */
	async submitAll(tasks: Array<Omit<WorkerTask, "id">>): Promise<WorkerResult[]> {
		return Promise.all(tasks.map((t) => this.submit(t)));
	}

	/**
	 * Current pool statistics.
	 */
	getStats(): WorkerPoolStats {
		const active = this.workers.filter((w) => w.busy).length;
		return {
			activeWorkers: active,
			idleWorkers: this.workers.length - active,
			queuedTasks: this.queue.length,
			completedTasks: this.completedTasks,
			failedTasks: this.failedTasks,
			averageDuration:
				this.completedTasks + this.failedTasks > 0
					? this.totalDuration / (this.completedTasks + this.failedTasks)
					: 0,
		};
	}

	/**
	 * Gracefully shutdown the pool.
	 * Waits for all in-flight tasks to complete, then terminates workers.
	 * Queued tasks that have not been dispatched are rejected.
	 */
	async shutdown(): Promise<void> {
		this.shuttingDown = true;

		// Reject all queued (not-yet-dispatched) tasks
		for (const item of this.queue.splice(0)) {
			item.reject(new Error("WorkerPool is shutting down"));
		}

		// Wait for busy workers to finish, then terminate all
		await Promise.all(
			this.workers.map((mw) => {
				if (!mw.busy) {
					return mw.worker.terminate();
				}
				// Wait for the worker to become idle (timeout after 30s)
				return new Promise<void>((resolve) => {
					const check = setInterval(() => {
						if (!mw.busy) {
							clearInterval(check);
							void mw.worker.terminate().then(() => resolve());
						}
					}, 50);
					// Safety timeout: force-terminate after 30 seconds
					setTimeout(() => {
						clearInterval(check);
						void mw.worker.terminate().then(() => resolve());
					}, 30_000).unref();
				});
			}),
		);

		this.workers.length = 0;
	}

	/**
	 * Forcibly terminate all workers immediately.
	 * In-flight tasks will not complete.
	 */
	kill(): void {
		this.killed = true;
		this.shuttingDown = true;

		for (const item of this.queue.splice(0)) {
			item.reject(new Error("WorkerPool killed"));
		}

		for (const mw of this.workers) {
			void mw.worker.terminate();
		}
		this.workers.length = 0;
	}

	// ─── Private ──────────────────────────────────────────────────────────────

	private spawnWorker(): ManagedWorker {
		const worker = new Worker(this.workerScript);
		const managed: ManagedWorker = { worker, busy: false };

		worker.on("error", () => {
			// Replace crashed worker if pool is still alive
			if (!this.killed && !this.shuttingDown) {
				const idx = this.workers.indexOf(managed);
				if (idx !== -1) {
					this.workers[idx] = this.spawnWorker();
					this.drainQueue();
				}
			}
		});

		worker.on("exit", () => {
			// No-op: handled by error listener or explicit terminate
		});

		return managed;
	}

	private dispatch(
		mw: ManagedWorker,
		task: WorkerTask,
		resolve: (r: WorkerResult) => void,
		reject: (e: Error) => void,
	): void {
		mw.busy = true;
		const startTime = Date.now();
		let settled = false;

		const timeoutHandle = setTimeout(() => {
			if (settled) return;
			settled = true;
			mw.busy = false;

			this.failedTasks++;
			const duration = Date.now() - startTime;
			this.totalDuration += duration;

			// Terminate the timed-out worker and spawn a replacement
			void mw.worker.terminate();
			const idx = this.workers.indexOf(mw);
			if (idx !== -1 && !this.killed && !this.shuttingDown) {
				this.workers[idx] = this.spawnWorker();
			}

			resolve({
				taskId: task.id,
				success: false,
				error: `Task timed out after ${this.taskTimeout}ms`,
				duration,
			});
			this.drainQueue();
		}, this.taskTimeout);

		const onMessage = (msg: { taskId?: string; success?: boolean; data?: unknown; error?: string }) => {
			if (settled) return;
			if (msg.taskId !== task.id) return;

			settled = true;
			clearTimeout(timeoutHandle);
			mw.worker.off("message", onMessage);
			mw.worker.off("error", onError);
			mw.busy = false;

			const duration = Date.now() - startTime;
			this.totalDuration += duration;

			if (msg.success) {
				this.completedTasks++;
			} else {
				this.failedTasks++;
			}

			resolve({
				taskId: task.id,
				success: msg.success ?? false,
				data: msg.data,
				error: msg.error,
				duration,
			});
			this.drainQueue();
		};

		const onError = (err: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			mw.worker.off("message", onMessage);
			mw.busy = false;

			this.failedTasks++;
			const duration = Date.now() - startTime;
			this.totalDuration += duration;

			// Replace crashed worker
			const idx = this.workers.indexOf(mw);
			if (idx !== -1 && !this.killed && !this.shuttingDown) {
				this.workers[idx] = this.spawnWorker();
			}

			resolve({
				taskId: task.id,
				success: false,
				error: err.message,
				duration,
			});
			this.drainQueue();
		};

		mw.worker.on("message", onMessage);
		mw.worker.on("error", onError);
		mw.worker.postMessage(task);
	}

	private drainQueue(): void {
		while (this.queue.length > 0) {
			const idle = this.workers.find((w) => !w.busy);
			if (!idle) break;
			const item = this.queue.shift()!;
			this.dispatch(idle, item.task, item.resolve, item.reject);
		}
	}
}
