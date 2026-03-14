import type { AgentTaskCheckpointRuntime } from "./agent-task-checkpoint-runtime.js";
import { AgentTaskCheckpointRuntime as AgentTaskCheckpointRuntimeImpl } from "./agent-task-checkpoint-runtime.js";
import type {
	AgentTaskCheckpointSnapshot,
	AgentTaskResumePlan,
	StoredAgentTaskCheckpointRecord,
} from "./agent-task-checkpoint-types.js";
import type { AgentEventType } from "./types.js";
import type { AgentConfig } from "./types.js";
import {
	buildTaskCheckpointResumeContextFromRecord as buildTaskCheckpointResumeContextFromStoredRecord,
	buildTaskCheckpointResumeContextFromSnapshot,
	buildTaskCheckpointResumePlanFromRecord as buildTaskCheckpointResumePlanFromStoredRecord,
	buildTaskCheckpointResumePlanFromSnapshot,
} from "./agent-task-checkpoint-resume.js";

export interface AgentTaskCheckpointIdentity {
	projectPath: string;
	taskKey: string;
	taskType: string;
	parentTaskKey: string | null;
	sessionLineageKey: string | null;
}

export interface AgentTaskCheckpointBindingState {
	key: string | null;
	runtime: AgentTaskCheckpointRuntime | null;
}

/**
 * Resolve the canonical durable task identity for an agent prompt run.
 *
 * The runtime only activates when the caller provides both a checkpoint store
 * and a stable task key. This keeps timeout pickup tied to real session/task
 * lineage instead of creating a second orchestration truth.
 */
export function resolveTaskCheckpointIdentity(
	config: AgentConfig,
	workingDirectory: string,
): AgentTaskCheckpointIdentity | null {
	const projectPath = typeof config.project === "string" && config.project.trim()
		? config.project.trim()
		: workingDirectory.trim();
	const taskKey = typeof config.taskKeyResolver === "function"
		? config.taskKeyResolver()?.trim() ?? ""
		: typeof config.taskKey === "string"
			? config.taskKey.trim()
			: "";
	if (!config.taskCheckpointStore || !projectPath || !taskKey) return null;

	return {
		projectPath,
		taskKey,
		taskType: typeof config.taskType === "string" && config.taskType.trim()
			? config.taskType.trim()
			: "agent.task",
		parentTaskKey:
			typeof config.parentTaskKey === "string" && config.parentTaskKey.trim()
				? config.parentTaskKey.trim()
				: null,
		sessionLineageKey:
			typeof config.sessionLineageKey === "string" && config.sessionLineageKey.trim()
				? config.sessionLineageKey.trim()
				: null,
	};
}

/** Create a checkpoint runtime once the agent has a stable task identity. */
export function createTaskCheckpointRuntime(
	config: AgentConfig,
	workingDirectory: string,
	options: {
		agentId: string;
		purpose: string;
		depth: number;
	},
): { key: string; runtime: AgentTaskCheckpointRuntime } | null {
	const identity = resolveTaskCheckpointIdentity(config, workingDirectory);
	if (!identity || !config.taskCheckpointStore) return null;

	return {
		key: identity.taskKey,
		runtime: new AgentTaskCheckpointRuntimeImpl({
			store: config.taskCheckpointStore,
			projectPath: identity.projectPath,
			taskKey: identity.taskKey,
			taskType: identity.taskType,
			agentId: options.agentId,
			purpose: options.purpose,
			depth: options.depth,
			parentTaskKey: identity.parentTaskKey,
			sessionLineageKey: identity.sessionLineageKey,
		}),
	};
}

/**
 * Start or resume the durable checkpoint record for a prompt run.
 *
 * When a prior checkpoint exists for the same logical task, the runtime
 * rehydrates the last durable phase metadata so the next run can continue from
 * the last known boundary instead of treating the task as brand new.
 */
export async function beginTaskCheckpointPrompt(
	state: AgentTaskCheckpointBindingState,
	config: AgentConfig,
	workingDirectory: string,
	options: {
		agentId: string;
		purpose: string;
		depth: number;
		prompt: string;
		fallbackSessionId: string;
		memorySessionId: string | null;
		messagesCount: number;
	},
): Promise<void> {
	const taskCheckpoint = createTaskCheckpointRuntime(config, workingDirectory, {
		agentId: options.agentId,
		purpose: options.purpose,
		depth: options.depth,
	});
	if (!taskCheckpoint) return;
	await state.runtime?.flush();
	state.key = taskCheckpoint.key;
	state.runtime = taskCheckpoint.runtime;
	await state.runtime?.beginPrompt({
		prompt: options.prompt,
		sessionId: config.taskSessionIdResolver?.()?.trim() || options.fallbackSessionId,
		memorySessionId: options.memorySessionId,
		messagesCount: options.messagesCount,
	});
}

/**
 * Append an event-level breadcrumb to the active durable task checkpoint.
 *
 * These breadcrumbs are intentionally lightweight; they make timeout pickup and
 * post-mortem inspection useful without turning the checkpoint into a second
 * full transcript store.
 */
export function recordTaskCheckpointEvent(
	state: AgentTaskCheckpointBindingState,
	event: AgentEventType,
	data: unknown,
	messagesCount: number,
): void {
	state.runtime?.recordEvent(event, data, messagesCount);
}

/**
 * Mark the current prompt run as terminal while preserving the last durable
 * phase, status, and error envelope for later pickup or inspection.
 */
export async function finishTaskCheckpointPrompt(
	state: AgentTaskCheckpointBindingState,
	status: "completed" | "aborted" | "error",
	messagesCount: number,
	error?: unknown,
): Promise<void> {
	await state.runtime?.finish(status, { error, messagesCount });
}

/** Flush any buffered checkpoint writes before the caller tears the task down. */
export async function flushTaskCheckpointPrompt(
	state: AgentTaskCheckpointBindingState,
): Promise<void> {
	await state.runtime?.flush();
}

/**
 * Build a bounded prompt hint for timeout pickup/resume.
 *
 * This is intentionally short. The goal is to tell the model where the last
 * durable phase stopped and what recent events happened, so the next prompt can
 * continue from that boundary instead of starting from scratch.
 */
export function buildTaskCheckpointResumeContext(
	state: AgentTaskCheckpointBindingState,
): string {
	const snapshot = state.runtime?.getSnapshot();
	return buildTaskCheckpointResumeContextFromSnapshot(snapshot ?? null);
}

/** Return the machine-usable next durable action for the active task checkpoint. */
export function buildTaskCheckpointResumePlan(
	state: AgentTaskCheckpointBindingState,
): AgentTaskResumePlan | null {
	const snapshot = state.runtime?.getSnapshot();
	return buildTaskCheckpointResumePlanFromSnapshot(snapshot ?? null);
}

/**
 * Build the same bounded timeout-pickup context from a persisted checkpoint row.
 *
 * This lets daemon/operator surfaces expose a usable resume summary even when
 * the original in-memory runtime has already disappeared.
 */
export function buildTaskCheckpointResumeContextFromRecord(
	record: StoredAgentTaskCheckpointRecord | null,
): string {
	return buildTaskCheckpointResumeContextFromStoredRecord(record);
}

/** Rebuild the machine-usable next durable action from a persisted checkpoint row. */
export function buildTaskCheckpointResumePlanFromRecord(
	record: StoredAgentTaskCheckpointRecord | null,
): AgentTaskResumePlan | null {
	return buildTaskCheckpointResumePlanFromStoredRecord(record);
}
