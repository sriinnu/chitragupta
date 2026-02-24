/**
 * Types for the RuntimeEventStream — job lifecycle monitoring layer
 * built on top of EventBridge.
 *
 * Sanskrit: Pravritti (प्रवृत्ति) = activity, ongoing process — the stream
 * of runtime events that traces each job's journey from queued to completion.
 *
 * @module runtime-events-types
 */

// ─── Job Lifecycle ──────────────────────────────────────────────────────────

/** Terminal states that indicate a job is no longer active. */
export const TERMINAL_STATUSES = new Set<JobStatus>([
	"completed",
	"failed",
	"cancelled",
]);

/** Job lifecycle states. */
export type JobStatus =
	| "queued"
	| "running"
	| "paused"
	| "completed"
	| "failed"
	| "cancelled";

/** A runtime job event describing a state transition or progress update. */
export interface RuntimeJobEvent {
	/** Unique job identifier. */
	jobId: string;
	/** Current job status. */
	status: JobStatus;
	/** The agent responsible for this job. */
	agentId: string;
	/** Progress percentage, 0-100. */
	progress?: number;
	/** Human-readable status message. */
	message?: string;
	/** Error description when status is "failed". */
	error?: string;
	/** Arbitrary metadata attached to the event. */
	metadata?: Record<string, unknown>;
	/** Epoch milliseconds when the event was published. */
	timestamp: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for {@link RuntimeEventStream}. */
export interface RuntimeEventStreamConfig {
	/** Max events to buffer for late joiners. Default: 500. */
	bufferSize?: number;
	/** Backpressure: max pending events per sink before dropping. Default: 1000. */
	maxPendingPerSink?: number;
	/** How many buffered events to replay on reconnect. Default: 50. */
	reconnectReplayCount?: number;
}

/** Snapshot of an active (non-terminal) job for {@link RuntimeEventStream.getActiveJobs}. */
export interface ActiveJobSnapshot {
	/** Unique job identifier. */
	jobId: string;
	/** Current job status. */
	status: JobStatus;
	/** Epoch ms of the last event for this job. */
	lastUpdate: number;
}
