interface AgentTaskCheckpointRecentEventLike {
	phase?: unknown;
	toolName?: unknown;
	subagentId?: unknown;
	subagentPurpose?: unknown;
	summary?: unknown;
	error?: unknown;
}

interface AgentTaskCheckpointSnapshotLike {
	taskKey?: unknown;
	promptRunId?: unknown;
	promptPreview?: unknown;
	resumeFromPromptPreview?: unknown;
	latestToolName?: unknown;
	latestSubagentId?: unknown;
	latestSubagentPurpose?: unknown;
	latestError?: unknown;
	resumeFromStatus?: unknown;
	resumeFromPhase?: unknown;
	resumeFromPromptRunId?: unknown;
	recentEvents?: unknown;
}

interface StoredAgentTaskCheckpointRecordLike {
	status?: unknown;
	phase?: unknown;
	taskKey?: unknown;
	checkpoint?: unknown;
}

export interface AgentTaskResumePlan {
	taskKey: string;
	previousStatus: string | null;
	previousPhase: string | null;
	promptRunId: string | null;
	latestToolName: string | null;
	latestSubagentId: string | null;
	latestSubagentPurpose: string | null;
	latestError: string | null;
	nextAction:
		| "resume-tool"
		| "resume-subagent"
		| "resume-error-handling"
		| "inspect-abort"
		| "reissue-prompt"
		| "none";
	needsHumanReview: boolean;
	detail: string | null;
}

function formatRecentEvent(event: AgentTaskCheckpointRecentEventLike): string {
	const parts: string[] = [];
	if (typeof event.phase === "string" && event.phase.trim()) parts.push(event.phase.trim());
	if (typeof event.toolName === "string" && event.toolName.trim()) parts.push(`tool=${event.toolName.trim()}`);
	if (typeof event.subagentPurpose === "string" && event.subagentPurpose.trim()) {
		parts.push(`subagent=${event.subagentPurpose.trim()}`);
	}
	if (typeof event.summary === "string" && event.summary.trim()) {
		parts.push(`summary=${event.summary.trim()}`);
	} else if (typeof event.error === "string" && event.error.trim()) {
		parts.push(`error=${event.error.trim()}`);
	}
	return `- ${parts.join(" | ")}`;
}

function trimText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildPromptPreviewLines(checkpoint: AgentTaskCheckpointSnapshotLike): string[] {
	const durablePromptPreview = trimText(checkpoint.resumeFromPromptPreview);
	const currentPromptPreview = trimText(checkpoint.promptPreview);
	if (!durablePromptPreview && !currentPromptPreview) return [];
	if (durablePromptPreview && currentPromptPreview && durablePromptPreview === currentPromptPreview) {
		return [`- durable prompt preview: ${durablePromptPreview}`];
	}
	return [
		durablePromptPreview ? `- durable prompt preview: ${durablePromptPreview}` : "",
		currentPromptPreview ? `- current attempt prompt preview: ${currentPromptPreview}` : "",
	].filter(Boolean);
}

function asCheckpointSnapshot(record: StoredAgentTaskCheckpointRecordLike | null): AgentTaskCheckpointSnapshotLike | null {
	return record?.checkpoint && typeof record.checkpoint === "object" && !Array.isArray(record.checkpoint)
		? record.checkpoint as AgentTaskCheckpointSnapshotLike
		: null;
}

function resolveDurableResumeBoundary(record: StoredAgentTaskCheckpointRecordLike | null): {
	taskKey: string;
	previousStatus: string | null;
	previousPhase: string | null;
	promptRunId: string | null;
	checkpoint: AgentTaskCheckpointSnapshotLike;
} | null {
	const checkpoint = asCheckpointSnapshot(record);
	const taskKey =
		(typeof record?.taskKey === "string" && record.taskKey.trim())
		|| (typeof checkpoint?.taskKey === "string" && checkpoint.taskKey.trim())
		|| "";
	if (!checkpoint || !taskKey) return null;
	const recordStatus = typeof record?.status === "string" ? record.status.trim() : null;
	const recordPhase = typeof record?.phase === "string" ? record.phase.trim() : null;
	const chainedPromptStart = recordPhase === "prompt:start"
		&& typeof checkpoint.resumeFromPhase === "string"
		&& checkpoint.resumeFromPhase.trim().length > 0;
	return {
		taskKey,
		previousStatus: chainedPromptStart
			? trimText(checkpoint.resumeFromStatus) ?? recordStatus
			: recordStatus,
		previousPhase: chainedPromptStart
			? trimText(checkpoint.resumeFromPhase) ?? recordPhase
			: recordPhase,
		promptRunId: chainedPromptStart
			? trimText(checkpoint.resumeFromPromptRunId) ?? trimText(checkpoint.promptRunId)
			: trimText(checkpoint.promptRunId),
		checkpoint,
	};
}

/** Build a machine-usable next durable action from a stored task checkpoint row. */
export function buildTaskCheckpointResumePlanFromRecord(
	record: StoredAgentTaskCheckpointRecordLike | null,
): AgentTaskResumePlan | null {
	const resolved = resolveDurableResumeBoundary(record);
	if (!resolved) return null;
	const checkpoint = resolved.checkpoint;
	const previousStatus = resolved.previousStatus;
	const previousPhase = resolved.previousPhase;
	const latestToolName = trimText(checkpoint.latestToolName);
	const latestSubagentId = trimText(checkpoint.latestSubagentId);
	const latestSubagentPurpose = trimText(checkpoint.latestSubagentPurpose);
	const latestError = trimText(checkpoint.latestError);

	let nextAction: AgentTaskResumePlan["nextAction"] = "none";
	let needsHumanReview = false;
	let detail: string | null = null;

	if (previousStatus === "aborted") {
		nextAction = "inspect-abort";
		needsHumanReview = true;
		detail = "Inspect the last abort reason before resuming work.";
	} else if (latestError || previousStatus === "error" || previousPhase?.endsWith(":error")) {
		nextAction = "resume-error-handling";
		needsHumanReview = previousStatus === "error";
		detail = latestToolName
			? `Recover or re-run the last failing tool step '${latestToolName}'.`
			: "Recover from the last durable error boundary.";
	} else if (latestSubagentId || latestSubagentPurpose || previousPhase?.startsWith("subagent:")) {
		nextAction = "resume-subagent";
		detail = latestSubagentPurpose
			? `Resume from the delegated subagent boundary '${latestSubagentPurpose}'.`
			: "Resume from the last delegated subagent boundary.";
	} else if (latestToolName || previousPhase?.startsWith("tool:")) {
		nextAction = "resume-tool";
		detail = latestToolName
			? `Resume from the durable tool boundary for '${latestToolName}'.`
			: "Resume from the last durable tool boundary.";
	} else if (previousStatus === "completed") {
		nextAction = "none";
		detail = "The last durable task run already completed.";
	} else if (previousPhase) {
		nextAction = "reissue-prompt";
		detail = `Continue from the durable prompt phase '${previousPhase}'.`;
	}

	return {
		taskKey: resolved.taskKey,
		previousStatus,
		previousPhase,
		promptRunId: resolved.promptRunId,
		latestToolName,
		latestSubagentId,
		latestSubagentPurpose,
		latestError,
		nextAction,
		needsHumanReview,
		detail,
	};
}

/** Build the bounded human-readable durable resume hint from a stored checkpoint row. */
export function buildTaskCheckpointResumeContextFromRecord(
	record: StoredAgentTaskCheckpointRecordLike | null,
): string {
	const checkpoint = asCheckpointSnapshot(record);
	const plan = buildTaskCheckpointResumePlanFromRecord(record);
	if (!checkpoint || !plan || (!plan.previousPhase && !plan.previousStatus)) return "";
	const recentEvents = Array.isArray(checkpoint.recentEvents)
		? checkpoint.recentEvents.filter(
			(event): event is AgentTaskCheckpointRecentEventLike =>
				!!event && typeof event === "object" && typeof (event as AgentTaskCheckpointRecentEventLike).phase === "string",
		)
		: [];

	return [
		"Durable resume context:",
		plan.previousStatus ? `- previous status: ${plan.previousStatus}` : "",
		plan.previousPhase ? `- previous phase: ${plan.previousPhase}` : "",
		plan.promptRunId ? `- previous prompt run: ${plan.promptRunId}` : "",
		...buildPromptPreviewLines(checkpoint),
		plan.nextAction !== "none" ? `- suggested next action: ${plan.nextAction}` : "",
		plan.detail ? `- detail: ${plan.detail}` : "",
		"Recent durable events:",
		...recentEvents.slice(-6).map(formatRecentEvent),
		"Continue from the last durable phase when appropriate instead of restarting completed work.",
	].filter(Boolean).join("\n");
}
