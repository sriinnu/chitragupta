/**
 * Scheduler types for the Niyanta background job scheduler.
 *
 * Provides deferred execution, priority queuing, and worker pool management
 * for agentic tasks. Part of the @chitragupta/niyanta orchestrator package.
 *
 * @module scheduler-types
 */

// ─── Priority & Status ──────────────────────────────────────────────────────

/** Job priority levels, from highest to lowest urgency. */
export type JobPriority = "critical" | "high" | "normal" | "low" | "background";

/** Lifecycle states of a scheduled job. */
export type SchedulerJobStatus =
	| "pending"
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "deferred";

/**
 * Numeric weights for priority ordering.
 * Lower value = higher priority (used by the min-heap).
 */
export const PRIORITY_WEIGHT: Record<JobPriority, number> = {
	critical: 0,
	high: 1,
	normal: 2,
	low: 3,
	background: 4,
};

// ─── Job ─────────────────────────────────────────────────────────────────────

/** A unit of work managed by the job scheduler. */
export interface SchedulerJob {
	/** Unique job identifier. */
	id: string;
	/** Job type — used to route to registered handlers. */
	type: string;
	/** Execution priority. */
	priority: JobPriority;
	/** Current lifecycle status. */
	status: SchedulerJobStatus;
	/** Arbitrary data passed to the handler. */
	payload: Record<string, unknown>;
	/** Epoch ms — for deferred execution. Job becomes eligible after this time. */
	scheduledAt?: number;
	/** Epoch ms when execution began. */
	startedAt?: number;
	/** Epoch ms when execution finished. */
	completedAt?: number;
	/** Number of retries attempted so far. */
	retryCount: number;
	/** Maximum retry attempts before marking as failed. */
	maxRetries: number;
	/** Per-job timeout in milliseconds. */
	timeoutMs: number;
	/** Handler return value on success. */
	result?: unknown;
	/** Error message on failure. */
	error?: string;
	/** Epoch ms when the job was created. */
	createdAt: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

/** Configuration for the JobScheduler. */
export interface SchedulerConfig {
	/** Maximum number of jobs executing concurrently. Default: 4. */
	maxConcurrent?: number;
	/** How often (ms) the scheduler checks for eligible jobs. Default: 1000. */
	pollIntervalMs?: number;
	/** Default per-job timeout in ms. Default: 300000 (5 min). */
	defaultTimeout?: number;
	/** Default retry limit for jobs without explicit maxRetries. Default: 3. */
	defaultMaxRetries?: number;
	/** Whether to persist jobs across restarts (future use). Default: true. */
	persistJobs?: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Async function that executes a job.
 * Receives the full SchedulerJob and returns a result value.
 */
export type JobHandler = (job: SchedulerJob) => Promise<unknown>;

// ─── Stats ───────────────────────────────────────────────────────────────────

/** Snapshot of scheduler queue and worker pool statistics. */
export interface SchedulerStats {
	/** Jobs waiting in the queue. */
	pending: number;
	/** Jobs currently executing. */
	running: number;
	/** Jobs that completed successfully. */
	completed: number;
	/** Jobs that exhausted retries and failed. */
	failed: number;
	/** Worker pool state. */
	workers: {
		active: number;
		idle: number;
		total: number;
	};
}

// ─── Events ──────────────────────────────────────────────────────────────────

/** Callback invoked when a job transitions state. */
export type JobChangeCallback = (job: SchedulerJob) => void;
