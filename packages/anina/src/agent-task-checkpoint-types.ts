/** Durable lifecycle outcomes for an agent-owned logical task. */
export type AgentTaskCheckpointStatus = "active" | "completed" | "aborted" | "error";

/** Machine-usable next step derived from a durable task checkpoint. */
export type AgentTaskResumeAction =
	| "resume-tool"
	| "resume-subagent"
	| "resume-error-handling"
	| "inspect-abort"
	| "reissue-prompt"
	| "none";

/** Lightweight persisted breadcrumb for recent task activity. */
export interface AgentTaskCheckpointRecentEvent {
	event: string;
	phase: string;
	at: number;
	toolName?: string | null;
	subagentId?: string | null;
	subagentPurpose?: string | null;
	error?: string | null;
	summary?: string | null;
}

/**
 * Structured timeout-pickup summary for a logical agent task.
 *
 * This complements the human-readable resume text with a machine-usable
 * next action so callers can continue from the last durable phase boundary.
 */
export interface AgentTaskResumePlan {
	taskKey: string;
	previousStatus: AgentTaskCheckpointStatus | null;
	previousPhase: string | null;
	promptRunId: string | null;
	latestToolName: string | null;
	latestSubagentId: string | null;
	latestSubagentPurpose: string | null;
	latestError: string | null;
	nextAction: AgentTaskResumeAction;
	needsHumanReview: boolean;
	detail: string | null;
}

/**
 * Snapshot persisted for timeout inspection and pickup.
 *
 * This is intentionally small and event-oriented so humans can debug it
 * quickly and downstream runtimes can resume from a meaningful phase boundary.
 */
export interface AgentTaskCheckpointSnapshot {
	version: 1;
	taskKey: string;
	taskType: string;
	agentId: string;
	purpose: string;
	depth: number;
	sessionId: string;
	memorySessionId: string | null;
	parentTaskKey: string | null;
	sessionLineageKey: string | null;
	promptRunId: string;
	promptSequence: number;
	phase: string;
	latestEvent: string;
	promptPreview: string | null;
	latestToolName: string | null;
	latestSubagentId: string | null;
	latestSubagentPurpose: string | null;
	latestError: string | null;
	resumeFromStatus?: AgentTaskCheckpointStatus | null;
	resumeFromPhase?: string | null;
	resumeFromPromptRunId?: string | null;
	resumeFromPromptPreview?: string | null;
	resumeFromUpdatedAt?: number | null;
	recentEvents: AgentTaskCheckpointRecentEvent[];
	messagesCount: number;
	updatedAt: number;
}

/** Persisted record returned from the daemon/local checkpoint store. */
export interface StoredAgentTaskCheckpointRecord {
	id: string;
	projectPath: string;
	taskKey: string;
	taskType: string | null;
	agentId: string | null;
	sessionId: string | null;
	parentTaskKey: string | null;
	sessionLineageKey: string | null;
	status: AgentTaskCheckpointStatus;
	phase: string;
	checkpoint: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
}

/** Store contract for daemon-backed task checkpoints. */
export interface AgentTaskCheckpointStore {
	get(input: {
		projectPath: string;
		taskKey: string;
	}): Promise<StoredAgentTaskCheckpointRecord | null>;
	save(input: {
		projectPath: string;
		taskKey: string;
		taskType?: string | null;
		agentId?: string | null;
		sessionId?: string | null;
		parentTaskKey?: string | null;
		sessionLineageKey?: string | null;
		status: AgentTaskCheckpointStatus;
		phase: string;
		checkpoint: Record<string, unknown>;
	}): Promise<StoredAgentTaskCheckpointRecord>;
	clear(input: {
		projectPath: string;
		taskKey: string;
	}): Promise<boolean>;
}
