/**
 * Karya — Async job queue for Chitragupta HTTP server.
 * Sanskrit: Karya (कार्य) = task, work, action.
 *
 * Provides fire-and-forget job submission with polling-based result retrieval.
 * Jobs run with configurable concurrency, abort support, and automatic TTL
 * cleanup. Designed for external consumers like Vaayu that need non-blocking
 * agent interactions.
 */

import { randomBytes } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
	/** Unique identifier: job-<base36-timestamp>-<random-hex>. */
	id: string;
	/** Current status of the job. */
	status: JobStatus;
	/** The user's prompt message. */
	message: string;
	/** Agent's final response (when completed). */
	response?: string;
	/** Error message (when failed). */
	error?: string;
	/** Streaming events captured during execution. */
	events: JobEvent[];
	/** Unix timestamp (ms) when the job was created. */
	createdAt: number;
	/** Unix timestamp (ms) when execution started. */
	startedAt?: number;
	/** Unix timestamp (ms) when execution finished. */
	completedAt?: number;
	/** Total cost in USD (if available). */
	cost?: number;
	/** Token usage counters (if available). */
	tokens?: { input: number; output: number };
	/** Arbitrary metadata attached at submission time. */
	metadata?: Record<string, unknown>;
}

export interface JobEvent {
	/** Event type (e.g. "stream:text", "tool:start", "tool:end"). */
	type: string;
	/** Event payload. */
	data: unknown;
	/** Unix timestamp (ms) when event was emitted. */
	timestamp: number;
}

export interface JobQueueConfig {
	/** Maximum number of concurrently running jobs. Default: 3. */
	maxConcurrent?: number;
	/** Maximum number of jobs in the queue (pending + running). Default: 50. */
	maxQueueSize?: number;
	/** TTL in ms for completed/failed/cancelled jobs before auto-cleanup. Default: 3600000 (1 hour). */
	jobTTL?: number;
	/** Maximum events stored per job. Default: 1000. */
	maxEventsPerJob?: number;
}

/**
 * Callback that the queue invokes to actually run a job.
 * Receives the user message, an event sink, and an AbortSignal.
 * Must return the agent's final response string.
 */
export type JobRunner = (
	message: string,
	onEvent: (type: string, data: unknown) => void,
	signal: AbortSignal,
) => Promise<string>;

export interface JobStats {
	pending: number;
	running: number;
	completed: number;
	failed: number;
	cancelled: number;
	total: number;
	maxConcurrent: number;
	maxQueueSize: number;
}

// ─── System ceilings ─────────────────────────────────────────────────────────

const SYSTEM_MAX_CONCURRENT = 16;
const SYSTEM_MAX_QUEUE_SIZE = 500;
const SYSTEM_MAX_EVENTS_PER_JOB = 10_000;

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_QUEUE_SIZE = 50;
const DEFAULT_JOB_TTL = 3_600_000; // 1 hour
const DEFAULT_MAX_EVENTS = 1_000;
const CLEANUP_INTERVAL = 60_000; // 1 minute

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateJobId(): string {
	const ts = Date.now().toString(36);
	const rand = randomBytes(4).toString("hex");
	return `job-${ts}-${rand}`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// ─── JobQueue ────────────────────────────────────────────────────────────────

export class JobQueue {
	private readonly jobs = new Map<string, Job>();
	private readonly pendingQueue: string[] = []; // FIFO of job IDs
	private readonly abortControllers = new Map<string, AbortController>();
	private readonly runner: JobRunner;
	private readonly maxConcurrent: number;
	private readonly maxQueueSize: number;
	private readonly jobTTL: number;
	private readonly maxEventsPerJob: number;
	private runningCount = 0;
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;
	private destroyed = false;

	constructor(runner: JobRunner, config: JobQueueConfig = {}) {
		this.runner = runner;
		this.maxConcurrent = clamp(
			config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
			1,
			SYSTEM_MAX_CONCURRENT,
		);
		this.maxQueueSize = clamp(
			config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
			1,
			SYSTEM_MAX_QUEUE_SIZE,
		);
		this.jobTTL = Math.max(0, config.jobTTL ?? DEFAULT_JOB_TTL);
		this.maxEventsPerJob = clamp(
			config.maxEventsPerJob ?? DEFAULT_MAX_EVENTS,
			0,
			SYSTEM_MAX_EVENTS_PER_JOB,
		);

		// Periodic cleanup of expired completed/failed/cancelled jobs
		this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL);
	}

	// ─── Public API ────────────────────────────────────────────────────

	/**
	 * Submit a new job to the queue.
	 * Returns the created Job immediately (status = "pending").
	 * Throws if the queue is full or the queue has been destroyed.
	 */
	submit(message: string, metadata?: Record<string, unknown>): Job {
		if (this.destroyed) {
			throw new Error("Job queue has been destroyed");
		}

		const totalActive = this.pendingQueue.length + this.runningCount;
		if (totalActive >= this.maxQueueSize) {
			throw new QueueFullError(this.maxQueueSize);
		}

		const job: Job = {
			id: generateJobId(),
			status: "pending",
			message,
			events: [],
			createdAt: Date.now(),
			metadata,
		};

		this.jobs.set(job.id, job);
		this.pendingQueue.push(job.id);
		this.drain();

		return job;
	}

	/** Get a job by ID. Returns undefined if not found. */
	getJob(id: string): Job | undefined {
		return this.jobs.get(id);
	}

	/** List all jobs, optionally filtered by status. */
	listJobs(filter?: { status?: JobStatus }): Job[] {
		const all = Array.from(this.jobs.values());
		if (filter?.status) {
			return all.filter((j) => j.status === filter.status);
		}
		return all;
	}

	/**
	 * Cancel a pending or running job.
	 * Returns true if the job was successfully cancelled.
	 * Returns false if the job is already in a terminal state.
	 */
	cancelJob(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job) return false;

		if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
			return false;
		}

		if (job.status === "pending") {
			// Remove from pending queue
			const idx = this.pendingQueue.indexOf(id);
			if (idx !== -1) {
				this.pendingQueue.splice(idx, 1);
			}
			job.status = "cancelled";
			job.completedAt = Date.now();
			return true;
		}

		if (job.status === "running") {
			// Abort the running job
			const controller = this.abortControllers.get(id);
			if (controller) {
				controller.abort();
			}
			job.status = "cancelled";
			job.completedAt = Date.now();
			this.abortControllers.delete(id);
			this.runningCount = Math.max(0, this.runningCount - 1);
			// Drain queue — a slot just opened
			this.drain();
			return true;
		}

		return false;
	}

	/** Get aggregate queue statistics. */
	getStats(): JobStats {
		let pending = 0;
		let running = 0;
		let completed = 0;
		let failed = 0;
		let cancelled = 0;

		for (const job of this.jobs.values()) {
			switch (job.status) {
				case "pending": pending++; break;
				case "running": running++; break;
				case "completed": completed++; break;
				case "failed": failed++; break;
				case "cancelled": cancelled++; break;
			}
		}

		return {
			pending,
			running,
			completed,
			failed,
			cancelled,
			total: this.jobs.size,
			maxConcurrent: this.maxConcurrent,
			maxQueueSize: this.maxQueueSize,
		};
	}

	/** Cancel all jobs, stop timers, and mark the queue as destroyed. */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}

		// Cancel all running jobs
		for (const [id, controller] of this.abortControllers) {
			controller.abort();
			const job = this.jobs.get(id);
			if (job && job.status === "running") {
				job.status = "cancelled";
				job.completedAt = Date.now();
			}
		}
		this.abortControllers.clear();
		this.runningCount = 0;

		// Cancel all pending jobs
		for (const id of this.pendingQueue) {
			const job = this.jobs.get(id);
			if (job && job.status === "pending") {
				job.status = "cancelled";
				job.completedAt = Date.now();
			}
		}
		this.pendingQueue.length = 0;
	}

	// ─── Internal ──────────────────────────────────────────────────────

	/**
	 * Process the next pending job(s) if we have concurrency capacity.
	 * Called after submit, after a job completes, and after cancel.
	 */
	private drain(): void {
		while (this.runningCount < this.maxConcurrent && this.pendingQueue.length > 0) {
			const jobId = this.pendingQueue.shift()!;
			const job = this.jobs.get(jobId);

			// Job may have been cancelled while pending
			if (!job || job.status !== "pending") continue;

			this.executeJob(job);
		}
	}

	/**
	 * Execute a single job. Transitions: pending -> running -> completed|failed.
	 * Non-blocking — fires and forgets the async execution.
	 */
	private executeJob(job: Job): void {
		job.status = "running";
		job.startedAt = Date.now();
		this.runningCount++;

		const controller = new AbortController();
		this.abortControllers.set(job.id, controller);

		const onEvent = (type: string, data: unknown): void => {
			if (job.events.length < this.maxEventsPerJob) {
				job.events.push({ type, data, timestamp: Date.now() });
			}
		};

		// Fire and forget — the promise chain handles completion
		this.runner(job.message, onEvent, controller.signal)
			.then((response) => {
				// Only update if the job hasn't been cancelled mid-flight
				if (job.status === "running") {
					job.status = "completed";
					job.response = response;
					job.completedAt = Date.now();
				}
			})
			.catch((err) => {
				if (job.status === "running") {
					// Distinguish between abort-cancellation and genuine errors
					if (controller.signal.aborted) {
						job.status = "cancelled";
					} else {
						job.status = "failed";
						job.error = err instanceof Error ? err.message : String(err);
					}
					job.completedAt = Date.now();
				}
			})
			.finally(() => {
				this.abortControllers.delete(job.id);
				this.runningCount = Math.max(0, this.runningCount - 1);
				this.drain();
			});
	}

	/** Remove terminal jobs older than jobTTL. */
	private cleanupExpired(): void {
		if (this.jobTTL === 0) return;

		const now = Date.now();
		const terminalStates: JobStatus[] = ["completed", "failed", "cancelled"];

		for (const [id, job] of this.jobs) {
			if (terminalStates.includes(job.status) && job.completedAt) {
				if (now - job.completedAt > this.jobTTL) {
					this.jobs.delete(id);
				}
			}
		}
	}
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class QueueFullError extends Error {
	readonly maxQueueSize: number;

	constructor(maxQueueSize: number) {
		super(`Job queue is full (max ${maxQueueSize})`);
		this.name = "QueueFullError";
		this.maxQueueSize = maxQueueSize;
	}
}
