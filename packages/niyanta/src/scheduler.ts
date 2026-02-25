/**
 * JobScheduler — Background job scheduler for agentic tasks.
 *
 * Provides deferred execution, priority queuing, worker pool management,
 * retry with exponential backoff, timeout enforcement, and graceful shutdown.
 * Part of the @chitragupta/niyanta orchestrator package.
 *
 * @module scheduler
 */

import { randomUUID } from "node:crypto";
import { JobQueue } from "./job-queue.js";
import type {
	JobChangeCallback,
	JobHandler,
	JobPriority,
	SchedulerConfig,
	SchedulerJob,
	SchedulerJobStatus,
	SchedulerStats,
} from "./scheduler-types.js";

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const DEFAULT_MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms). Doubles per retry. */
const BACKOFF_BASE_MS = 500;

// ─── JobScheduler ────────────────────────────────────────────────────────────

/**
 * Background job scheduler with priority queuing and worker pool management.
 *
 * @example
 * ```ts
 * const scheduler = new JobScheduler({ maxConcurrent: 2 });
 * scheduler.registerHandler("email", async (job) => sendEmail(job.payload));
 * scheduler.start();
 *
 * const jobId = scheduler.submit({ type: "email", priority: "normal", payload: { to: "a@b.c" }, timeoutMs: 10000, maxRetries: 2 });
 * ```
 */
export class JobScheduler {
	private readonly config: Required<SchedulerConfig>;
	private readonly queue: JobQueue;
	private readonly handlers = new Map<string, JobHandler>();
	private readonly jobs = new Map<string, SchedulerJob>();
	private readonly listeners: Set<JobChangeCallback> = new Set();

	/** IDs of jobs currently being executed. */
	private readonly activeWorkers = new Set<string>();

	/** Completed/failed counters for stats. */
	private completedCount = 0;
	private failedCount = 0;

	/** Poll timer handle. */
	private pollTimer: ReturnType<typeof setInterval> | undefined;

	/** Whether the scheduler loop is running. */
	private running = false;

	/** Resolvers waiting for graceful shutdown. */
	private shutdownResolvers: Array<() => void> = [];

	constructor(config?: SchedulerConfig) {
		this.config = {
			maxConcurrent: config?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
			pollIntervalMs: config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
			defaultTimeout: config?.defaultTimeout ?? DEFAULT_TIMEOUT_MS,
			defaultMaxRetries: config?.defaultMaxRetries ?? DEFAULT_MAX_RETRIES,
			persistJobs: config?.persistJobs ?? true,
		};
		this.queue = new JobQueue();
	}

	// ─── Handler Registration ────────────────────────────────────────────

	/**
	 * Register a handler for a job type.
	 * @param jobType - The job type string to handle.
	 * @param handler - Async function that executes the job.
	 */
	registerHandler(jobType: string, handler: JobHandler): void {
		this.handlers.set(jobType, handler);
	}

	// ─── Job Submission ──────────────────────────────────────────────────

	/**
	 * Submit a job for execution. Returns the job ID.
	 *
	 * The job is queued immediately and will be picked up by a worker
	 * on the next poll cycle (or sooner if workers are idle).
	 *
	 * @param partial - Job definition without auto-generated fields.
	 * @returns The generated job ID.
	 */
	submit(
		partial: Omit<SchedulerJob, "id" | "status" | "retryCount" | "createdAt">,
	): string {
		const job: SchedulerJob = {
			...partial,
			id: `job-${randomUUID().slice(0, 12)}`,
			status: "queued",
			retryCount: 0,
			createdAt: Date.now(),
			maxRetries: partial.maxRetries ?? this.config.defaultMaxRetries,
			timeoutMs: partial.timeoutMs ?? this.config.defaultTimeout,
		};

		this.jobs.set(job.id, job);
		this.queue.enqueue(job);
		this.emitChange(job);

		// Try to dispatch immediately if running
		if (this.running) {
			this.dispatch();
		}

		return job.id;
	}

	/**
	 * Submit a deferred job that runs after `delayMs` milliseconds.
	 *
	 * @param partial - Job definition without auto-generated fields.
	 * @param delayMs - Delay in milliseconds from now.
	 * @returns The generated job ID.
	 */
	defer(
		partial: Omit<SchedulerJob, "id" | "status" | "retryCount" | "createdAt">,
		delayMs: number,
	): string {
		const scheduledAt = Date.now() + delayMs;
		return this.submit({ ...partial, scheduledAt });
	}

	// ─── Job Management ──────────────────────────────────────────────────

	/**
	 * Cancel a pending or queued job.
	 * Running jobs cannot be cancelled through this method.
	 *
	 * @param jobId - ID of the job to cancel.
	 * @returns True if the job was cancelled, false if not found or not cancellable.
	 */
	cancel(jobId: string): boolean {
		const job = this.jobs.get(jobId);
		if (!job) return false;

		const cancellable: Set<SchedulerJobStatus> = new Set([
			"pending",
			"queued",
			"deferred",
		]);
		if (!cancellable.has(job.status)) return false;

		this.queue.remove(jobId);
		this.updateJob(job, { status: "cancelled" });
		return true;
	}

	/**
	 * Get a job by ID.
	 * @param jobId - The job ID.
	 * @returns The job snapshot, or undefined if not found.
	 */
	getJob(jobId: string): SchedulerJob | undefined {
		return this.jobs.get(jobId);
	}

	/**
	 * List jobs, optionally filtered by status.
	 * @param status - If provided, only jobs with this status are returned.
	 * @returns Array of matching jobs.
	 */
	listJobs(status?: SchedulerJobStatus): SchedulerJob[] {
		const all = [...this.jobs.values()];
		if (!status) return all;
		return all.filter((j) => j.status === status);
	}

	// ─── Stats ───────────────────────────────────────────────────────────

	/**
	 * Get a snapshot of scheduler statistics.
	 * @returns Current stats including queue depth, workers, and counters.
	 */
	getStats(): SchedulerStats {
		const pending = this.queue.size;
		const running = this.activeWorkers.size;
		const total = this.config.maxConcurrent;

		return {
			pending,
			running,
			completed: this.completedCount,
			failed: this.failedCount,
			workers: {
				active: running,
				idle: total - running,
				total,
			},
		};
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────

	/**
	 * Start the scheduler poll loop.
	 * Workers begin picking up eligible jobs from the queue.
	 */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.pollTimer = setInterval(() => this.dispatch(), this.config.pollIntervalMs);
		// Dispatch once immediately
		this.dispatch();
	}

	/**
	 * Stop the scheduler.
	 *
	 * @param graceful - If true, waits for all running jobs to finish
	 *   before resolving. If false, stops immediately (running jobs
	 *   continue but new jobs are not dispatched). Default: true.
	 */
	async stop(graceful = true): Promise<void> {
		if (!this.running) return;
		this.running = false;

		if (this.pollTimer !== undefined) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}

		if (graceful && this.activeWorkers.size > 0) {
			return new Promise<void>((resolve) => {
				this.shutdownResolvers.push(resolve);
			});
		}
	}

	// ─── Events ──────────────────────────────────────────────────────────

	/**
	 * Register a callback for job state changes.
	 *
	 * @param callback - Invoked whenever a job transitions state.
	 * @returns An unsubscribe function.
	 */
	onJobChange(callback: JobChangeCallback): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	// ─── Private: Dispatch Loop ──────────────────────────────────────────

	/** Try to dispatch eligible jobs to idle workers. */
	private dispatch(): void {
		while (
			this.running &&
			this.activeWorkers.size < this.config.maxConcurrent
		) {
			const job = this.queue.dequeueEligible();
			if (!job) break;
			this.executeJob(job);
		}
	}

	/** Execute a single job in a worker slot. */
	private executeJob(job: SchedulerJob): void {
		const handler = this.handlers.get(job.type);
		if (!handler) {
			this.updateJob(job, {
				status: "failed",
				error: `No handler registered for job type "${job.type}"`,
			});
			this.failedCount++;
			this.resolveShutdownIfDone();
			return;
		}

		this.activeWorkers.add(job.id);
		this.updateJob(job, { status: "running", startedAt: Date.now() });

		// Set up timeout
		const timeoutHandle = setTimeout(() => {
			this.handleTimeout(job);
		}, job.timeoutMs);

		handler(job)
			.then((result) => {
				clearTimeout(timeoutHandle);
				if (!this.activeWorkers.has(job.id)) return; // Timed out already
				this.handleSuccess(job, result);
			})
			.catch((err: unknown) => {
				clearTimeout(timeoutHandle);
				if (!this.activeWorkers.has(job.id)) return; // Timed out already
				const message = err instanceof Error ? err.message : String(err);
				this.handleFailure(job, message);
			});
	}

	/** Handle successful job completion. */
	private handleSuccess(job: SchedulerJob, result: unknown): void {
		this.activeWorkers.delete(job.id);
		this.updateJob(job, {
			status: "completed",
			completedAt: Date.now(),
			result,
		});
		this.completedCount++;
		this.resolveShutdownIfDone();
		this.dispatch();
	}

	/** Handle job failure — retry with exponential backoff or mark failed. */
	private handleFailure(job: SchedulerJob, error: string): void {
		this.activeWorkers.delete(job.id);
		const newRetry = job.retryCount + 1;

		if (newRetry <= job.maxRetries) {
			// Re-queue with exponential backoff
			const delay = BACKOFF_BASE_MS * Math.pow(2, newRetry - 1);
			const retryAt = Date.now() + delay;

			this.updateJob(job, {
				status: "queued",
				retryCount: newRetry,
				error,
				scheduledAt: retryAt,
			});

			// Re-enqueue for deferred retry
			this.queue.enqueue(job);
		} else {
			this.updateJob(job, {
				status: "failed",
				retryCount: newRetry,
				completedAt: Date.now(),
				error,
			});
			this.failedCount++;
		}

		this.resolveShutdownIfDone();
		this.dispatch();
	}

	/** Handle job timeout — treat as a failure. */
	private handleTimeout(job: SchedulerJob): void {
		if (!this.activeWorkers.has(job.id)) return;
		this.activeWorkers.delete(job.id);

		const newRetry = job.retryCount + 1;
		if (newRetry <= job.maxRetries) {
			const delay = BACKOFF_BASE_MS * Math.pow(2, newRetry - 1);
			this.updateJob(job, {
				status: "queued",
				retryCount: newRetry,
				error: `Job timed out after ${job.timeoutMs}ms`,
				scheduledAt: Date.now() + delay,
			});
			this.queue.enqueue(job);
		} else {
			this.updateJob(job, {
				status: "failed",
				retryCount: newRetry,
				completedAt: Date.now(),
				error: `Job timed out after ${job.timeoutMs}ms`,
			});
			this.failedCount++;
		}

		this.resolveShutdownIfDone();
		this.dispatch();
	}

	// ─── Private: Helpers ────────────────────────────────────────────────

	/** Update a job's fields in place and emit a change event. */
	private updateJob(
		job: SchedulerJob,
		updates: Partial<SchedulerJob>,
	): void {
		Object.assign(job, updates);
		this.emitChange(job);
	}

	/** Emit a job change event to all listeners. */
	private emitChange(job: SchedulerJob): void {
		for (const cb of this.listeners) {
			try {
				cb(job);
			} catch {
				// Best-effort delivery — swallow subscriber errors.
			}
		}
	}

	/** If we are shutting down gracefully and all workers are done, resolve. */
	private resolveShutdownIfDone(): void {
		if (this.shutdownResolvers.length > 0 && this.activeWorkers.size === 0) {
			for (const resolve of this.shutdownResolvers) {
				resolve();
			}
			this.shutdownResolvers = [];
		}
	}
}
