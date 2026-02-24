/**
 * Sanchaalaka-Sthiti Types — Types for the orchestrator checkpoint system.
 *
 * Defines step status, step checkpoints, job checkpoints, and configuration
 * interfaces used by {@link OrchestratorCheckpoint}.
 */

// ─── Step Types ─────────────────────────────────────────────────────────────

/** State of a single step in an orchestration job. */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** A checkpoint for a single orchestration step. */
export interface StepCheckpoint {
	stepId: string;
	status: StepStatus;
	input?: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: string;
	startedAt?: number;
	completedAt?: number;
	retryCount: number;
}

// ─── Job Types ──────────────────────────────────────────────────────────────

/** Terminal status values that allow idempotency key reuse. */
export type JobTerminalStatus = "completed" | "failed";

/** Active status values that block idempotency key reuse. */
export type JobActiveStatus = "running" | "paused";

/** All possible job status values. */
export type JobStatus = JobActiveStatus | JobTerminalStatus;

/** Full orchestration job checkpoint. */
export interface JobCheckpoint {
	jobId: string;
	/** Job type identifier, e.g. "code-review", "refactor", "deploy". */
	jobType: string;
	status: JobStatus;
	steps: StepCheckpoint[];
	currentStepIndex: number;
	metadata: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
	/** Idempotency key — prevents duplicate job execution. */
	idempotencyKey: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for the orchestrator checkpoint system. */
export interface OrchestratorCheckpointConfig {
	/** Max checkpoints to retain per job type. Default: 100. */
	maxPerType?: number;
	/** Auto-purge completed jobs older than N days. Default: 30. */
	retentionDays?: number;
}

/** Input shape for defining a step when creating a job. */
export interface StepDefinition {
	stepId: string;
	input?: Record<string, unknown>;
}

/** Filter options for listing jobs. */
export interface JobListFilter {
	jobType?: string;
	status?: string;
}
