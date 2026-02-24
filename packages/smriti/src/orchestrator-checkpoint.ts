/**
 * Sanchaalaka-Sthiti — Durable orchestrator checkpoint and resume system.
 *
 * Provides checkpointing for long-running orchestration jobs so they
 * survive crashes and resume with idempotency guarantees. Uses SQLite
 * (agent.db). Complementary to {@link CheckpointManager} (session snapshots).
 */

import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { getAgentDb } from "./session-db.js";
import type {
	StepStatus,
	StepCheckpoint,
	JobCheckpoint,
	OrchestratorCheckpointConfig,
	StepDefinition,
	JobListFilter,
} from "./orchestrator-checkpoint-types.js";

// Re-export types for consumers
export type {
	StepStatus,
	StepCheckpoint,
	JobCheckpoint,
	OrchestratorCheckpointConfig,
	StepDefinition,
	JobListFilter,
} from "./orchestrator-checkpoint-types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_PER_TYPE = 100;
const DEFAULT_RETENTION_DAYS = 30;
const MS_PER_DAY = 86_400_000;

// ─── SQL DDL ────────────────────────────────────────────────────────────────

const CREATE_JOBS_TABLE = `
CREATE TABLE IF NOT EXISTS orchestrator_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const CREATE_STEPS_TABLE = `
CREATE TABLE IF NOT EXISTS orchestrator_steps (
  job_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT,
  output TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, step_id),
  FOREIGN KEY (job_id) REFERENCES orchestrator_jobs(job_id) ON DELETE CASCADE
)`;

const CREATE_JOBS_TYPE_IDX = `CREATE INDEX IF NOT EXISTS idx_orch_jobs_type ON orchestrator_jobs(job_type)`;
const CREATE_JOBS_STATUS_IDX = `CREATE INDEX IF NOT EXISTS idx_orch_jobs_status ON orchestrator_jobs(status)`;
const CREATE_STEPS_JOB_IDX = `CREATE INDEX IF NOT EXISTS idx_orch_steps_job ON orchestrator_steps(job_id)`;

// ─── Row Conversion ─────────────────────────────────────────────────────────

/** Convert a database row to a StepCheckpoint. */
function rowToStep(row: Record<string, unknown>): StepCheckpoint {
	return {
		stepId: row.step_id as string,
		status: row.status as StepStatus,
		input: row.input ? JSON.parse(row.input as string) as Record<string, unknown> : undefined,
		output: row.output ? JSON.parse(row.output as string) as Record<string, unknown> : undefined,
		error: (row.error as string | null) ?? undefined,
		startedAt: (row.started_at as number | null) ?? undefined,
		completedAt: (row.completed_at as number | null) ?? undefined,
		retryCount: (row.retry_count as number) ?? 0,
	};
}

/** Assemble a JobCheckpoint from a job row and its step rows. */
function assembleJob(
	jobRow: Record<string, unknown>,
	stepRows: Array<Record<string, unknown>>,
): JobCheckpoint {
	const steps = stepRows
		.sort((a, b) => (a.step_index as number) - (b.step_index as number))
		.map(rowToStep);

	return {
		jobId: jobRow.job_id as string,
		jobType: jobRow.job_type as string,
		status: jobRow.status as JobCheckpoint["status"],
		steps,
		currentStepIndex: jobRow.current_step_index as number,
		metadata: jobRow.metadata
			? JSON.parse(jobRow.metadata as string) as Record<string, unknown>
			: {},
		createdAt: jobRow.created_at as number,
		updatedAt: jobRow.updated_at as number,
		idempotencyKey: jobRow.idempotency_key as string,
	};
}

// ─── OrchestratorCheckpoint ─────────────────────────────────────────────────

/**
 * Durable orchestration checkpoint manager backed by SQLite.
 * Provides create, advance, fail, retry, resume, and purge operations
 * for multi-step orchestration jobs with idempotency guarantees.
 */
export class OrchestratorCheckpoint {
	private readonly db: BetterSqlite3.Database;
	private readonly maxPerType: number;
	private readonly retentionDays: number;
	private initialized = false;

	constructor(config?: OrchestratorCheckpointConfig) {
		this.db = getAgentDb();
		this.maxPerType = config?.maxPerType ?? DEFAULT_MAX_PER_TYPE;
		this.retentionDays = config?.retentionDays ?? DEFAULT_RETENTION_DAYS;
		this.ensureSchema();
	}

	/**
	 * Create a new orchestration job with the given steps.
	 *
	 * Idempotency: throws if a job with the same key exists in a non-terminal state.
	 * If the key exists but the prior job is completed or failed, allows re-creation.
	 *
	 * @param jobType - Category of this job (e.g. "code-review", "deploy").
	 * @param steps - Ordered step definitions for the job.
	 * @param idempotencyKey - Unique key to prevent duplicate execution.
	 * @param metadata - Optional metadata to attach to the job.
	 * @returns The newly created job checkpoint.
	 */
	createJob(
		jobType: string,
		steps: StepDefinition[],
		idempotencyKey: string,
		metadata?: Record<string, unknown>,
	): JobCheckpoint {
		const existing = this.db.prepare(
			"SELECT job_id, status FROM orchestrator_jobs WHERE idempotency_key = ?",
		).get(idempotencyKey) as { job_id: string; status: string } | undefined;

		if (existing && existing.status !== "completed" && existing.status !== "failed") {
			throw new Error(
				`Duplicate idempotency key "${idempotencyKey}": job ${existing.job_id} is still ${existing.status}`,
			);
		}

		// Remove terminal job with same key to allow re-creation
		if (existing) {
			this.deleteJob(existing.job_id);
		}

		const jobId = `job-${randomUUID().slice(0, 12)}`;
		const now = Date.now();

		const txn = this.db.transaction(() => {
			this.db.prepare(`
				INSERT INTO orchestrator_jobs (job_id, job_type, status, current_step_index, metadata, idempotency_key, created_at, updated_at)
				VALUES (?, ?, 'running', 0, ?, ?, ?, ?)
			`).run(jobId, jobType, metadata ? JSON.stringify(metadata) : null, idempotencyKey, now, now);

			for (let i = 0; i < steps.length; i++) {
				const step = steps[i];
				const status: StepStatus = i === 0 ? "running" : "pending";
				const startedAt = i === 0 ? now : null;
				this.db.prepare(`
					INSERT INTO orchestrator_steps (job_id, step_id, step_index, status, input, retry_count, started_at)
					VALUES (?, ?, ?, ?, ?, 0, ?)
				`).run(jobId, step.stepId, i, status, step.input ? JSON.stringify(step.input) : null, startedAt);
			}
		});
		txn();

		this.enforceMaxPerType(jobType);
		return this.loadJob(jobId)!;
	}

	/**
	 * Load a job checkpoint by ID.
	 * @returns The job checkpoint, or null if not found.
	 */
	loadJob(jobId: string): JobCheckpoint | null {
		const jobRow = this.db.prepare(
			"SELECT * FROM orchestrator_jobs WHERE job_id = ?",
		).get(jobId) as Record<string, unknown> | undefined;
		if (!jobRow) return null;

		const stepRows = this.db.prepare(
			"SELECT * FROM orchestrator_steps WHERE job_id = ? ORDER BY step_index",
		).all(jobId) as Array<Record<string, unknown>>;

		return assembleJob(jobRow, stepRows);
	}

	/**
	 * Mark the current step as completed and advance to the next step.
	 * @returns The completed step checkpoint.
	 */
	advanceStep(jobId: string, output?: Record<string, unknown>): StepCheckpoint {
		const job = this.requireJob(jobId);
		const currentStep = job.steps[job.currentStepIndex];
		if (!currentStep) throw new Error(`No current step at index ${job.currentStepIndex}`);

		const now = Date.now();
		const txn = this.db.transaction(() => {
			this.db.prepare(`
				UPDATE orchestrator_steps SET status = 'completed', output = ?, completed_at = ?
				WHERE job_id = ? AND step_id = ?
			`).run(output ? JSON.stringify(output) : null, now, jobId, currentStep.stepId);

			const nextIndex = job.currentStepIndex + 1;
			if (nextIndex < job.steps.length) {
				const nextStep = job.steps[nextIndex];
				this.db.prepare(`
					UPDATE orchestrator_steps SET status = 'running', started_at = ?
					WHERE job_id = ? AND step_id = ?
				`).run(now, jobId, nextStep.stepId);
				this.db.prepare(
					"UPDATE orchestrator_jobs SET current_step_index = ?, updated_at = ? WHERE job_id = ?",
				).run(nextIndex, now, jobId);
			} else {
				this.db.prepare(
					"UPDATE orchestrator_jobs SET updated_at = ? WHERE job_id = ?",
				).run(now, jobId);
			}
		});
		txn();

		return { ...currentStep, status: "completed", output, completedAt: now };
	}

	/**
	 * Mark the current step as failed and increment its retry count.
	 * @returns The failed step checkpoint.
	 */
	failStep(jobId: string, error: string): StepCheckpoint {
		const job = this.requireJob(jobId);
		const currentStep = job.steps[job.currentStepIndex];
		if (!currentStep) throw new Error(`No current step at index ${job.currentStepIndex}`);

		const now = Date.now();
		const newRetry = currentStep.retryCount + 1;

		this.db.prepare(`
			UPDATE orchestrator_steps SET status = 'failed', error = ?, retry_count = ?
			WHERE job_id = ? AND step_id = ?
		`).run(error, newRetry, jobId, currentStep.stepId);
		this.db.prepare(
			"UPDATE orchestrator_jobs SET updated_at = ? WHERE job_id = ?",
		).run(now, jobId);

		return { ...currentStep, status: "failed", error, retryCount: newRetry };
	}

	/**
	 * Retry the current failed step (reset to running).
	 * @throws If the current step is not in "failed" status.
	 */
	retryStep(jobId: string): StepCheckpoint {
		const job = this.requireJob(jobId);
		const currentStep = job.steps[job.currentStepIndex];
		if (!currentStep) throw new Error(`No current step at index ${job.currentStepIndex}`);
		if (currentStep.status !== "failed") {
			throw new Error(`Cannot retry step "${currentStep.stepId}" — status is "${currentStep.status}", not "failed"`);
		}

		const now = Date.now();
		this.db.prepare(`
			UPDATE orchestrator_steps SET status = 'running', error = NULL, started_at = ?
			WHERE job_id = ? AND step_id = ?
		`).run(now, jobId, currentStep.stepId);
		this.db.prepare(
			"UPDATE orchestrator_jobs SET status = 'running', updated_at = ? WHERE job_id = ?",
		).run(now, jobId);

		return { ...currentStep, status: "running", error: undefined, startedAt: now };
	}

	/** Mark the entire job as completed. */
	completeJob(jobId: string): JobCheckpoint {
		this.requireJob(jobId);
		const now = Date.now();
		this.db.prepare(
			"UPDATE orchestrator_jobs SET status = 'completed', updated_at = ? WHERE job_id = ?",
		).run(now, jobId);
		return this.loadJob(jobId)!;
	}

	/** Mark the entire job as failed with an error message stored in metadata. */
	failJob(jobId: string, error: string): JobCheckpoint {
		const job = this.requireJob(jobId);
		const now = Date.now();
		const meta = { ...job.metadata, failureError: error };
		this.db.prepare(
			"UPDATE orchestrator_jobs SET status = 'failed', metadata = ?, updated_at = ? WHERE job_id = ?",
		).run(JSON.stringify(meta), now, jobId);
		return this.loadJob(jobId)!;
	}

	/**
	 * Resume a paused or failed job from the last incomplete step.
	 * @throws If the job is already completed.
	 */
	resumeJob(jobId: string): JobCheckpoint {
		const job = this.requireJob(jobId);
		if (job.status === "completed") {
			throw new Error(`Cannot resume job ${jobId} — already completed`);
		}

		const now = Date.now();
		let resumeIndex = -1;
		for (let i = 0; i < job.steps.length; i++) {
			if (job.steps[i].status !== "completed" && job.steps[i].status !== "skipped") {
				resumeIndex = i;
				break;
			}
		}

		if (resumeIndex === -1) {
			this.db.prepare(
				"UPDATE orchestrator_jobs SET status = 'running', updated_at = ? WHERE job_id = ?",
			).run(now, jobId);
			return this.loadJob(jobId)!;
		}

		const txn = this.db.transaction(() => {
			const step = job.steps[resumeIndex];
			this.db.prepare(`
				UPDATE orchestrator_steps SET status = 'running', error = NULL, started_at = ?
				WHERE job_id = ? AND step_id = ?
			`).run(now, jobId, step.stepId);
			this.db.prepare(`
				UPDATE orchestrator_jobs SET status = 'running', current_step_index = ?, updated_at = ?
				WHERE job_id = ?
			`).run(resumeIndex, now, jobId);
		});
		txn();

		return this.loadJob(jobId)!;
	}

	/** List jobs with optional type and status filters. */
	listJobs(filter?: JobListFilter): JobCheckpoint[] {
		let sql = "SELECT * FROM orchestrator_jobs WHERE 1=1";
		const params: unknown[] = [];

		if (filter?.jobType) {
			sql += " AND job_type = ?";
			params.push(filter.jobType);
		}
		if (filter?.status) {
			sql += " AND status = ?";
			params.push(filter.status);
		}
		sql += " ORDER BY updated_at DESC";

		const jobRows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
		return jobRows.map((row) => {
			const stepRows = this.db.prepare(
				"SELECT * FROM orchestrator_steps WHERE job_id = ? ORDER BY step_index",
			).all(row.job_id as string) as Array<Record<string, unknown>>;
			return assembleJob(row, stepRows);
		});
	}

	/**
	 * Purge completed/failed jobs older than retentionDays.
	 * @returns Number of jobs removed.
	 */
	purgeOld(): number {
		const cutoff = Date.now() - this.retentionDays * MS_PER_DAY;
		const rows = this.db.prepare(`
			SELECT job_id FROM orchestrator_jobs
			WHERE status IN ('completed', 'failed') AND updated_at < ?
		`).all(cutoff) as Array<{ job_id: string }>;

		if (rows.length === 0) return 0;

		const txn = this.db.transaction(() => {
			for (const row of rows) { this.deleteJob(row.job_id); }
		});
		txn();
		return rows.length;
	}

	// ─── Private ──────────────────────────────────────────────────────────────

	/** Create tables if they don't exist. Idempotent. */
	private ensureSchema(): void {
		if (this.initialized) return;
		this.db.exec(CREATE_JOBS_TABLE);
		this.db.exec(CREATE_STEPS_TABLE);
		this.db.exec(CREATE_JOBS_TYPE_IDX);
		this.db.exec(CREATE_JOBS_STATUS_IDX);
		this.db.exec(CREATE_STEPS_JOB_IDX);
		this.initialized = true;
	}

	/** Load a job or throw if not found. */
	private requireJob(jobId: string): JobCheckpoint {
		const job = this.loadJob(jobId);
		if (!job) throw new Error(`Job not found: ${jobId}`);
		return job;
	}

	/** Delete a job and all its steps. */
	private deleteJob(jobId: string): void {
		this.db.prepare("DELETE FROM orchestrator_steps WHERE job_id = ?").run(jobId);
		this.db.prepare("DELETE FROM orchestrator_jobs WHERE job_id = ?").run(jobId);
	}

	/** Evict oldest completed/failed jobs when exceeding maxPerType. */
	private enforceMaxPerType(jobType: string): void {
		const count = this.db.prepare(
			"SELECT COUNT(*) as cnt FROM orchestrator_jobs WHERE job_type = ?",
		).get(jobType) as { cnt: number };
		if (count.cnt <= this.maxPerType) return;

		const excess = count.cnt - this.maxPerType;
		const toRemove = this.db.prepare(`
			SELECT job_id FROM orchestrator_jobs
			WHERE job_type = ? AND status IN ('completed', 'failed')
			ORDER BY updated_at ASC LIMIT ?
		`).all(jobType, excess) as Array<{ job_id: string }>;

		for (const row of toRemove) { this.deleteJob(row.job_id); }
	}
}
