import type {
	AgentTaskCheckpointStatus,
	AgentTaskCheckpointRecentEvent,
	AgentTaskCheckpointSnapshot,
	AgentTaskResumePlan,
	StoredAgentTaskCheckpointRecord,
} from "./agent-task-checkpoint-types.js";

function formatRecentEvent(event: AgentTaskCheckpointRecentEvent): string {
	const parts = [event.phase];
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

function trimText(value: string | null | undefined): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildPromptPreviewLines(snapshot: Partial<AgentTaskCheckpointSnapshot>): string[] {
	const durablePromptPreview = trimText(snapshot.resumeFromPromptPreview);
	const currentPromptPreview = trimText(snapshot.promptPreview);
	if (!durablePromptPreview && !currentPromptPreview) return [];
	if (durablePromptPreview && currentPromptPreview && durablePromptPreview === currentPromptPreview) {
		return [`- durable prompt preview: ${durablePromptPreview}`];
	}
	return [
		durablePromptPreview ? `- durable prompt preview: ${durablePromptPreview}` : "",
		currentPromptPreview ? `- current attempt prompt preview: ${currentPromptPreview}` : "",
	].filter(Boolean);
}

function resolveDurableResumeBoundary(input: {
	recordStatus?: AgentTaskCheckpointStatus | null;
	recordPhase?: string | null;
	snapshot: Partial<AgentTaskCheckpointSnapshot>;
}): {
	status: AgentTaskCheckpointStatus | null;
	phase: string | null;
	promptRunId: string | null;
} {
	const recordStatus = input.recordStatus ?? null;
	const recordPhase = input.recordPhase?.trim() || null;
	const chainedPromptStart = recordPhase === "prompt:start"
		&& typeof input.snapshot.resumeFromPhase === "string"
		&& input.snapshot.resumeFromPhase.trim().length > 0;
	if (chainedPromptStart) {
		return {
			status: input.snapshot.resumeFromStatus ?? recordStatus,
			phase: input.snapshot.resumeFromPhase ?? recordPhase,
			promptRunId: input.snapshot.resumeFromPromptRunId ?? input.snapshot.promptRunId ?? null,
		};
	}
	return {
		status: recordStatus,
		phase: recordPhase,
		promptRunId: input.snapshot.promptRunId ?? null,
	};
}

function buildTaskCheckpointResumePlanCore(input: {
	taskKey: string;
	previousStatus: AgentTaskCheckpointStatus | null;
	previousPhase: string | null;
	promptRunId: string | null;
	latestToolName: string | null;
	latestSubagentId: string | null;
	latestSubagentPurpose: string | null;
	latestError: string | null;
}): AgentTaskResumePlan {
	const previousStatus = input.previousStatus ?? null;
	const previousPhase = input.previousPhase ?? null;
	const latestToolName = input.latestToolName ?? null;
	const latestSubagentId = input.latestSubagentId ?? null;
	const latestSubagentPurpose = input.latestSubagentPurpose ?? null;
	const latestError = input.latestError ?? null;

	let nextAction: AgentTaskResumePlan["nextAction"] = "none";
	let needsHumanReview = false;
	let detail: string | null = null;

	if (previousStatus === "aborted") {
		nextAction = "inspect-abort";
		needsHumanReview = true;
		detail = "Inspect the last abort reason before resuming work.";
	} else if (previousStatus === "completed") {
		nextAction = "none";
		detail = "The last durable task run already completed.";
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
	} else if (previousPhase) {
		nextAction = "reissue-prompt";
		detail = `Continue from the durable prompt phase '${previousPhase}'.`;
	}

	return {
		taskKey: input.taskKey,
		previousStatus,
		previousPhase,
		promptRunId: input.promptRunId,
		latestToolName,
		latestSubagentId,
		latestSubagentPurpose,
		latestError,
		nextAction,
		needsHumanReview,
		detail,
	};
}

/**
 * Derive a structured timeout-pickup plan from a durable task checkpoint.
 *
 * The plan is intentionally conservative: it points the caller at the last
 * durable phase boundary instead of trying to reconstruct volatile in-flight
 * model state.
 */
export function buildTaskCheckpointResumePlanFromSnapshot(
	snapshot: Partial<AgentTaskCheckpointSnapshot> | null,
): AgentTaskResumePlan | null {
	if (!snapshot?.taskKey) return null;
	const boundary = resolveDurableResumeBoundary({ snapshot });
	return buildTaskCheckpointResumePlanCore({
		taskKey: snapshot.taskKey,
		previousStatus: boundary.status,
		previousPhase: boundary.phase,
		promptRunId: boundary.promptRunId,
		latestToolName: snapshot.latestToolName ?? null,
		latestSubagentId: snapshot.latestSubagentId ?? null,
		latestSubagentPurpose: snapshot.latestSubagentPurpose ?? null,
		latestError: snapshot.latestError ?? null,
	});
}

/**
 * Build the bounded human-readable timeout-pickup context used in prompts and
 * operator inspection surfaces.
 */
export function buildTaskCheckpointResumeContextFromSnapshot(
	snapshot: Partial<AgentTaskCheckpointSnapshot> | null,
): string {
	const plan = buildTaskCheckpointResumePlanFromSnapshot(snapshot);
	if (!plan || (!snapshot?.resumeFromPhase && !snapshot?.resumeFromStatus)) return "";
	const recentEvents = Array.isArray(snapshot.recentEvents)
		? snapshot.recentEvents.filter(
			(event): event is AgentTaskCheckpointRecentEvent =>
				!!event && typeof event === "object" && typeof (event as AgentTaskCheckpointRecentEvent).phase === "string",
		)
		: [];

	const lines = [
		"Durable resume context:",
		plan.previousStatus ? `- previous status: ${plan.previousStatus}` : "",
		plan.previousPhase ? `- previous phase: ${plan.previousPhase}` : "",
		plan.promptRunId ? `- previous prompt run: ${plan.promptRunId}` : "",
		...buildPromptPreviewLines(snapshot),
		plan.nextAction !== "none" ? `- suggested next action: ${plan.nextAction}` : "",
		plan.detail ? `- detail: ${plan.detail}` : "",
		"Recent durable events:",
		...recentEvents.slice(-6).map(formatRecentEvent),
		"Continue from the last durable phase when appropriate instead of restarting completed work.",
	].filter(Boolean);
	return lines.join("\n");
}

/**
 * Rebuild the same prompt/operator resume hint from a persisted checkpoint row.
 */
export function buildTaskCheckpointResumeContextFromRecord(
	record: StoredAgentTaskCheckpointRecord | null,
): string {
	const plan = buildTaskCheckpointResumePlanFromRecord(record);
	const snapshot =
		record?.checkpoint && typeof record.checkpoint === "object"
			? record.checkpoint as Partial<AgentTaskCheckpointSnapshot>
			: null;
	if (!plan || (!plan.previousPhase && !plan.previousStatus)) return "";
	const recentEvents = Array.isArray(snapshot?.recentEvents)
		? snapshot.recentEvents.filter(
			(event): event is AgentTaskCheckpointRecentEvent =>
				!!event && typeof event === "object" && typeof (event as AgentTaskCheckpointRecentEvent).phase === "string",
		)
		: [];
	const lines = [
		"Durable resume context:",
		plan.previousStatus ? `- previous status: ${plan.previousStatus}` : "",
		plan.previousPhase ? `- previous phase: ${plan.previousPhase}` : "",
		plan.promptRunId ? `- previous prompt run: ${plan.promptRunId}` : "",
		...(snapshot ? buildPromptPreviewLines(snapshot) : []),
		plan.nextAction !== "none" ? `- suggested next action: ${plan.nextAction}` : "",
		plan.detail ? `- detail: ${plan.detail}` : "",
		"Recent durable events:",
		...recentEvents.slice(-6).map(formatRecentEvent),
		"Continue from the last durable phase when appropriate instead of restarting completed work.",
	].filter(Boolean);
	return lines.join("\n");
}

/** Derive the machine-usable resume plan from a persisted checkpoint row. */
export function buildTaskCheckpointResumePlanFromRecord(
	record: StoredAgentTaskCheckpointRecord | null,
): AgentTaskResumePlan | null {
	if (!record?.checkpoint || typeof record.checkpoint !== "object") return null;
	const snapshot = record.checkpoint as Partial<AgentTaskCheckpointSnapshot>;
	const boundary = resolveDurableResumeBoundary({
		recordStatus: record.status,
		recordPhase: record.phase,
		snapshot,
	});
	return buildTaskCheckpointResumePlanCore({
		taskKey: record.taskKey,
		previousStatus: boundary.status,
		previousPhase: boundary.phase,
		promptRunId: boundary.promptRunId,
		latestToolName: snapshot.latestToolName ?? null,
		latestSubagentId: snapshot.latestSubagentId ?? null,
		latestSubagentPurpose: snapshot.latestSubagentPurpose ?? null,
		latestError: snapshot.latestError ?? null,
	});
}
