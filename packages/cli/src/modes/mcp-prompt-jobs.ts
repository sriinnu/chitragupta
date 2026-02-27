/**
 * Async Prompt Job Store with Heartbeat.
 *
 * Manages the lifecycle of long-running `chitragupta_prompt` jobs.
 * Each job tracks status, heartbeat timestamps, and current activity
 * so the calling MCP client can distinguish "still executing" from
 * "died midway" via the `chitragupta_prompt_status` tool.
 *
 * @module
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Maximum time to wait inline before returning a jobId for polling.
 * MCP clients enforce a 60s transport deadline — we stay safely under.
 */
export const INLINE_WAIT_MS = 45_000;

/**
 * If no heartbeat is received within this window, the job is considered
 * stale and likely dead. 60s gives generous room for provider latency.
 */
export const HEARTBEAT_STALE_MS = 60_000;

/** Auto-evict completed/failed jobs older than this (30 minutes). */
const JOB_TTL_MS = 30 * 60_000;

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single prompt job tracked by the store. */
export interface PromptJob {
	status: "running" | "completed" | "failed";
	response?: string;
	error?: string;
	createdAt: number;
	/** Last heartbeat timestamp — updated during execution phases. */
	lastHeartbeat: number;
	/** Human-readable description of current activity. */
	lastActivity?: string;
	/** Which provider fallback attempt is active (1-based). */
	attemptNumber?: number;
	/** The provider currently being tried. */
	providerAttempt?: string;
}

/** Payload emitted by the heartbeat callback during prompt execution. */
export interface HeartbeatInfo {
	activity: string;
	attempt: number;
	provider: string;
}

/** Callback signature for heartbeat updates from the prompt runner. */
export type HeartbeatCallback = (info: HeartbeatInfo) => void;

// ─── Job Store ──────────────────────────────────────────────────────────────

/** Module-level store for pending/completed prompt jobs. */
const promptJobs = new Map<string, PromptJob>();

/**
 * Indian names used as human-readable job identifiers.
 * Rotated round-robin to avoid ugly hash-based IDs.
 */
const AGENT_NAMES = [
	"amritha", "kavya", "arjun", "priya", "veda",
	"dhruv", "meera", "rishi", "ananya", "kiran",
	"tara", "surya", "leela", "arun", "nila",
	"rohan", "saira", "vikram", "devi", "hari",
] as const;

/** Tracks the next name index for round-robin assignment. */
let nameCounter = 0;

/** Generate a human-readable job ID using Indian names. */
export function generateJobId(): string {
	const name = AGENT_NAMES[nameCounter % AGENT_NAMES.length];
	nameCounter++;
	const suffix = Math.random().toString(36).slice(2, 5);
	return `${name}-${suffix}`;
}

/** Create a new running job and return its ID. */
export function createJob(): string {
	evictStaleJobs();
	const id = generateJobId();
	const now = Date.now();
	promptJobs.set(id, { status: "running", createdAt: now, lastHeartbeat: now });
	return id;
}

/** Get a job by ID, or undefined if not found / expired. */
export function getJob(id: string): PromptJob | undefined {
	return promptJobs.get(id);
}

/** Mark a job as completed with the final response text. */
export function completeJob(id: string, response: string): void {
	const job = promptJobs.get(id);
	if (job) {
		job.status = "completed";
		job.response = response;
		job.lastHeartbeat = Date.now();
	}
}

/** Mark a job as failed with the error message. */
export function failJob(id: string, error: string): void {
	const job = promptJobs.get(id);
	if (job) {
		job.status = "failed";
		job.error = error;
		job.lastHeartbeat = Date.now();
	}
}

/**
 * Build a heartbeat callback bound to a specific job ID.
 * Each call updates the job's lastHeartbeat, lastActivity, and provider info.
 */
export function createHeartbeat(jobId: string): HeartbeatCallback {
	return (info: HeartbeatInfo) => {
		const job = promptJobs.get(jobId);
		if (job && job.status === "running") {
			job.lastHeartbeat = Date.now();
			job.lastActivity = info.activity;
			job.attemptNumber = info.attempt;
			job.providerAttempt = info.provider;
		}
	};
}

/**
 * Check whether a running job's heartbeat is stale.
 * Returns true if the job is running but hasn't sent a heartbeat
 * within {@link HEARTBEAT_STALE_MS}.
 */
export function isJobStale(job: PromptJob): boolean {
	return job.status === "running" && (Date.now() - job.lastHeartbeat) > HEARTBEAT_STALE_MS;
}

/** Evict completed/failed jobs older than {@link JOB_TTL_MS}. */
export function evictStaleJobs(): void {
	const cutoff = Date.now() - JOB_TTL_MS;
	for (const [id, job] of promptJobs) {
		if (job.status !== "running" && job.createdAt < cutoff) {
			promptJobs.delete(id);
		}
	}
}

/** Number of jobs currently in the store (for testing). */
export function jobCount(): number {
	return promptJobs.size;
}

/** Clear all jobs (for testing). */
export function clearAllJobs(): void {
	promptJobs.clear();
}
