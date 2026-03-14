import { normalizeProjectPath } from "./services-helpers.js";

/**
 * Canonical daemon-owned control-plane state for one overnight research loop.
 *
 * This is intentionally separate from the richer experiment ledger so the
 * daemon can answer fast lifecycle questions such as running/cancelling/stale
 * without loading the full research history.
 */
export type ResearchLoopControlState = {
	loopKey: string;
	projectPath: string | null;
	topic: string | null;
	sessionId: string | null;
	sabhaId: string | null;
	workflowId: string | null;
	status: "running" | "cancelling" | "cancelled" | "completed" | "failed";
	startedAt: number;
	updatedAt: number;
	heartbeatAt: number | null;
	cancelRequestedAt: number | null;
	cancelReason: string | null;
	requestedBy: string | null;
	currentRound: number | null;
	totalRounds: number | null;
	attemptNumber: number | null;
	phase: string | null;
	stopReason: string | null;
	finishedAt: number | null;
};

const activeResearchLoops = new Map<string, ResearchLoopControlState>();
const RESEARCH_LOOP_STALE_AFTER_MS = 5_000;

/** Test/helper reset for daemon-owned research loop control state. */
export function clearResearchLoopStates(): void {
	activeResearchLoops.clear();
}

/** Return true when a loop is already in a terminal control-plane state. */
export function isTerminalResearchLoopStatus(
	status: ResearchLoopControlState["status"] | undefined,
): boolean {
	return status === "completed" || status === "cancelled" || status === "failed";
}

/** Preserve distinct abnormal outcomes for control consumers. */
export function terminalResearchLoopStatus(
	stopReason: string | null,
): "completed" | "failed" | "cancelled" {
	if (stopReason === "cancelled") return "cancelled";
	if (
		stopReason === "control-plane-lost"
		|| stopReason === "closure-failed"
		|| stopReason === "round-failed"
		|| stopReason === "unsafe-discard"
	) {
		return "failed";
	}
	return "completed";
}

/**
 * Collapse stop-reason strings into a simple abnormal-terminal predicate for
 * control-plane consumers that only need to distinguish healthy completion
 * from failure.
 */
export function isFailureResearchLoopStopReason(stopReason: string | null): boolean {
	return stopReason === "control-plane-lost"
		|| stopReason === "closure-failed"
		|| stopReason === "round-failed"
		|| stopReason === "unsafe-discard";
}

/**
 * Validate and normalize a daemon research loop key.
 */
export function ensureResearchLoopKey(loopKey: unknown): string {
	if (typeof loopKey !== "string" || !loopKey.trim()) {
		throw new Error("Missing research loop key");
	}
	return loopKey.trim();
}

/**
 * Look up one daemon-owned research loop control record.
 */
export function getResearchLoopState(loopKey: unknown): ResearchLoopControlState | null {
	return typeof loopKey === "string" && loopKey.trim()
		? activeResearchLoops.get(loopKey.trim()) ?? null
		: null;
}

/**
 * Replace the daemon-owned control record for one loop key.
 */
export function setResearchLoopState(loopKey: string, state: ResearchLoopControlState): void {
	activeResearchLoops.set(loopKey, state);
}

/** Return a recent-first view of active daemon-owned research loop control state. */
export function listResearchLoopStates(): ResearchLoopControlState[] {
	return [...activeResearchLoops.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * A loop can only be resumed when there is no prior owner or the prior owner
 * has stopped heartbeating long enough that takeover is safer than overlap.
 *
 * Terminal loops are not resumed here; they are restarted through
 * `buildResumedResearchLoopState(...)`, which keeps identity/context fields but
 * clears terminal lifecycle metadata.
 */
export function canResumeResearchLoop(
	state: ResearchLoopControlState | null,
	now: number,
): boolean {
	if (!state) return true;
	if (isTerminalResearchLoopStatus(state.status)) return false;
	const freshestActivityAt = Math.max(
		state.heartbeatAt ?? 0,
		state.updatedAt ?? 0,
		state.startedAt ?? 0,
	);
	return now - freshestActivityAt >= RESEARCH_LOOP_STALE_AFTER_MS;
}

/**
 * Build a fresh running control record for a newly started research loop.
 */
export function buildStartedResearchLoopState(
	loopKey: string,
	params: Record<string, unknown>,
	now: number,
): ResearchLoopControlState {
	return {
		loopKey,
		projectPath:
			typeof params.projectPath === "string" ? normalizeProjectPath(params.projectPath) : null,
		topic: typeof params.topic === "string" ? params.topic.trim() : null,
		sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
		sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
		workflowId: typeof params.workflowId === "string" ? params.workflowId : null,
		status: "running",
		startedAt: now,
		updatedAt: now,
		heartbeatAt: now,
		cancelRequestedAt: null,
		cancelReason: null,
		requestedBy: null,
		currentRound: typeof params.currentRound === "number" ? params.currentRound : null,
		totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
		attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
		phase: typeof params.phase === "string" ? params.phase : null,
		stopReason: null,
		finishedAt: null,
	};
}

/**
 * Reattach to a logical loop after a local timeout/crash. Terminal metadata is
 * cleared, while active cancellation requests remain visible to the resumed
 * process.
 */
export function buildResumedResearchLoopState(
	loopKey: string,
	params: Record<string, unknown>,
	existing: ResearchLoopControlState | null,
	now: number,
): ResearchLoopControlState {
	const base = existing ?? buildStartedResearchLoopState(loopKey, params, now);
	const resetFromTerminal = isTerminalResearchLoopStatus(base.status);
	return {
		...base,
		projectPath:
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: base.projectPath,
		topic: typeof params.topic === "string" ? params.topic.trim() : base.topic,
		sessionId: typeof params.sessionId === "string" ? params.sessionId : base.sessionId,
		sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : base.sabhaId,
		workflowId: typeof params.workflowId === "string" ? params.workflowId : base.workflowId,
		status: !resetFromTerminal && base.cancelRequestedAt ? "cancelling" : "running",
		updatedAt: now,
		heartbeatAt: now,
		currentRound:
			typeof params.currentRound === "number" ? params.currentRound : base.currentRound,
		totalRounds:
			typeof params.totalRounds === "number" ? params.totalRounds : base.totalRounds,
		attemptNumber:
			typeof params.attemptNumber === "number" ? params.attemptNumber : base.attemptNumber,
		phase: typeof params.phase === "string" ? params.phase : "resume",
		stopReason: null,
		finishedAt: null,
		cancelRequestedAt: resetFromTerminal ? null : base.cancelRequestedAt,
		cancelReason: resetFromTerminal ? null : base.cancelReason,
		requestedBy: resetFromTerminal ? null : base.requestedBy,
	};
}
