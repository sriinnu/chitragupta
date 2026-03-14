import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath, parseLimit } from "./services-helpers.js";
import {
	buildTaskCheckpointResumeContextFromRecord,
	buildTaskCheckpointResumePlanFromRecord,
} from "./services-agent-tasks-resume.js";

const MAX_CHECKPOINT_EVENTS = 12;
const MAX_CHECKPOINT_TEXT = 280;

function truncateCheckpointText(value: unknown, max = MAX_CHECKPOINT_TEXT): string | null {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizeCheckpointRecentEvent(event: unknown): Record<string, unknown> | null {
	if (!event || typeof event !== "object" || Array.isArray(event)) return null;
	const input = event as Record<string, unknown>;
	const phase = truncateCheckpointText(input.phase, 120);
	if (!phase) return null;
	return {
		event: truncateCheckpointText(input.event, 120) ?? phase,
		phase,
		at: typeof input.at === "number" && Number.isFinite(input.at) ? input.at : Date.now(),
		toolName: truncateCheckpointText(input.toolName, 120),
		subagentId: truncateCheckpointText(input.subagentId, 120),
		subagentPurpose: truncateCheckpointText(input.subagentPurpose, 160),
		error: truncateCheckpointText(input.error),
		summary: truncateCheckpointText(input.summary),
	};
}

function normalizeTaskCheckpointPayload(checkpoint: Record<string, unknown>): Record<string, unknown> {
	const normalized: Record<string, unknown> = { ...checkpoint };
	if (Array.isArray(checkpoint.recentEvents)) {
		normalized.recentEvents = checkpoint.recentEvents
			.map(normalizeCheckpointRecentEvent)
			.filter((event): event is Record<string, unknown> => !!event)
			.slice(-MAX_CHECKPOINT_EVENTS);
	}
	normalized.promptPreview = truncateCheckpointText(checkpoint.promptPreview);
	normalized.latestError = truncateCheckpointText(checkpoint.latestError);
	normalized.latestToolName = truncateCheckpointText(checkpoint.latestToolName, 120);
	normalized.latestSubagentId = truncateCheckpointText(checkpoint.latestSubagentId, 120);
	normalized.latestSubagentPurpose = truncateCheckpointText(checkpoint.latestSubagentPurpose, 160);
	normalized.resumeFromStatus = truncateCheckpointText(checkpoint.resumeFromStatus, 40);
	normalized.resumeFromPhase = truncateCheckpointText(checkpoint.resumeFromPhase, 120);
	normalized.resumeFromPromptRunId = truncateCheckpointText(checkpoint.resumeFromPromptRunId, 120);
	normalized.resumeFromPromptPreview = truncateCheckpointText(checkpoint.resumeFromPromptPreview);
	return normalized;
}

/**
 * Register generic task-checkpoint methods for long-running agent work.
 *
 * These methods keep timeout/pickup state daemon-owned so consumers can inspect
 * or resume work without replaying the whole task from scratch.
 */
export function registerAgentTaskMethods(router: RpcRouter): void {
	router.register("agent.tasks.checkpoint.get", async (params) => {
		const projectPath =
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: "";
		const taskKey = typeof params.taskKey === "string" ? params.taskKey.trim() : "";
		if (!projectPath || !taskKey) throw new Error("Missing projectPath or taskKey");

		const { getAgentTaskCheckpoint } = await import("@chitragupta/smriti");
		const checkpoint = getAgentTaskCheckpoint(projectPath, taskKey);
		return {
			checkpoint,
			resumeContext: buildTaskCheckpointResumeContextFromRecord(checkpoint),
			resumePlan: buildTaskCheckpointResumePlanFromRecord(checkpoint),
		};
	}, "Load the durable checkpoint for a logical agent task");

	router.register("agent.tasks.checkpoint.list", async (params) => {
		const { listAgentTaskCheckpoints } = await import("@chitragupta/smriti");
		const checkpoints = listAgentTaskCheckpoints({
			projectPath:
				typeof params.projectPath === "string"
					? normalizeProjectPath(params.projectPath)
					: undefined,
			status:
				params.status === "active"
				|| params.status === "completed"
				|| params.status === "aborted"
				|| params.status === "error"
					? params.status
					: undefined,
			taskType: typeof params.taskType === "string" ? params.taskType : undefined,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
			limit: parseLimit(params.limit, 25, 200),
		});
		return {
			checkpoints: checkpoints.map((checkpoint) => ({
				...checkpoint,
				resumeContext: buildTaskCheckpointResumeContextFromRecord(checkpoint),
				resumePlan: buildTaskCheckpointResumePlanFromRecord(checkpoint),
			})),
		};
	}, "List recent durable task checkpoints for timeout inspection and pickup");

	router.register("agent.tasks.checkpoint.save", async (params) => {
		const projectPath =
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: "";
		const taskKey = typeof params.taskKey === "string" ? params.taskKey.trim() : "";
		const phase = typeof params.phase === "string" ? params.phase.trim() : "";
		const checkpoint =
			params.checkpoint && typeof params.checkpoint === "object" && !Array.isArray(params.checkpoint)
				? params.checkpoint as Record<string, unknown>
				: null;
		const status =
			params.status === "completed" || params.status === "aborted" || params.status === "error"
				? params.status
				: "active";
		if (!projectPath || !taskKey || !phase || !checkpoint) {
			throw new Error("Missing checkpoint fields");
		}

		const { upsertAgentTaskCheckpoint } = await import("@chitragupta/smriti");
		const normalizedCheckpoint = normalizeTaskCheckpointPayload(checkpoint);
		return {
			checkpoint: upsertAgentTaskCheckpoint({
				projectPath,
				taskKey,
				taskType: typeof params.taskType === "string" ? params.taskType : null,
				agentId: typeof params.agentId === "string" ? params.agentId : null,
				sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
				parentTaskKey: typeof params.parentTaskKey === "string" ? params.parentTaskKey : null,
				sessionLineageKey:
					typeof params.sessionLineageKey === "string" ? params.sessionLineageKey : null,
				status,
				phase,
				checkpoint: normalizedCheckpoint,
			}),
		};
	}, "Persist the latest durable phase for a logical agent task");

	router.register("agent.tasks.checkpoint.clear", async (params) => {
		const projectPath =
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: "";
		const taskKey = typeof params.taskKey === "string" ? params.taskKey.trim() : "";
		if (!projectPath || !taskKey) throw new Error("Missing projectPath or taskKey");

		const { clearAgentTaskCheckpoint } = await import("@chitragupta/smriti");
		return {
			cleared: clearAgentTaskCheckpoint(projectPath, taskKey),
		};
	}, "Clear a durable task checkpoint after explicit cleanup");
}
