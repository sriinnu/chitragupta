import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath } from "./services-helpers.js";
import {
	buildResearchLoopResumeContext,
	buildResearchLoopResumePlan,
	type ResearchLoopResumeAction,
} from "./services-research-resume.js";
import {
	buildResumedResearchLoopState,
	buildStartedResearchLoopState,
	canResumeResearchLoop,
	ensureResearchLoopKey,
	getResearchLoopState,
	isFailureResearchLoopStopReason,
	isTerminalResearchLoopStatus,
	listResearchLoopStates,
	setResearchLoopState,
	terminalResearchLoopStatus,
	type ResearchLoopControlState,
} from "./services-research-loop-state.js";
import {
	cancelDurableResearchLoop,
	claimResearchLoopLease,
	completeDurableResearchLoop,
	heartbeatResearchLoopLease,
} from "./services-research-scheduler.js";

/**
 * Narrow durable checkpoint row shape used by loop-control services.
 *
 * I keep this local instead of importing the full Smriti type graph because the
 * daemon only needs the stable control-plane subset for resume/start decisions.
 */
type ResearchLoopCheckpointRecord = {
	projectPath: string;
	loopKey: string;
	status?: string | null;
	topic?: string | null;
	hypothesis?: string | null;
	sessionId?: string | null;
	parentSessionId?: string | null;
	sessionLineageKey?: string | null;
	sabhaId?: string | null;
	currentRound?: number | null;
	nextRoundNumber?: number | null;
	totalRounds?: number | null;
	phase: string;
	cancelRequestedAt?: number | null;
	cancelReason?: string | null;
	updatedAt: number;
	createdAt: number;
	checkpoint?: unknown;
};

/**
 * Load the durable checkpoint record that belongs to one logical research
 * loop.
 *
 * I prefer the project-scoped lookup when a canonical project path is known so
 * loop-key collisions across projects cannot leak resume state.
 */
async function findResearchLoopCheckpointRecord(
	loopKey: string,
	projectPath: string | null,
): Promise<ResearchLoopCheckpointRecord | null> {
	const { getResearchLoopCheckpoint, listResearchLoopCheckpoints } = await import("@chitragupta/smriti");
	if (projectPath) {
		const checkpoint = (getResearchLoopCheckpoint(projectPath, loopKey) as ResearchLoopCheckpointRecord | null) ?? null;
		if (
			checkpoint
			&& checkpoint.loopKey === loopKey
			&& checkpoint.projectPath === projectPath
		) {
			return checkpoint;
		}
		return null;
	}
	const checkpointMatch = listResearchLoopCheckpoints({ limit: 200 }).find(
		(entry) => entry.loopKey === loopKey,
	);
	return (checkpointMatch as ResearchLoopCheckpointRecord | undefined) ?? null;
}

/**
 * Turn a duplicate-start request into one consistent operator-facing error.
 *
 * This keeps CLI, MCP, and HTTP surfaces aligned on whether the caller should
 * resume, inspect, or fork a new loop key.
 */
function researchLoopStartReuseError(loopKey: string, action: ResearchLoopResumeAction | null): Error {
	switch (action) {
		case "resume-rounds":
		case "complete-pending":
		case "inspect-failure":
			return new Error(`Research loop ${loopKey} already has durable checkpoint state; use resume`);
		case "acknowledge-cancelled":
			return new Error(`Research loop ${loopKey} was cancelled already; use a new loop key`);
		case "complete":
			return new Error(`Research loop ${loopKey} is already completed; use a new loop key`);
		default:
			return new Error(`Research loop ${loopKey} already has durable state; use a new loop key`);
	}
}

/**
 * Extract the persisted terminal summary from one durable checkpoint row.
 *
 * Resume logic uses this when live daemon loop state is gone but the caller
 * still needs the final stop reason and terminal summary envelope.
 */
function checkpointTerminalSummary(
	checkpoint: ResearchLoopCheckpointRecord,
): Record<string, unknown> | null {
	const checkpointRecord =
		checkpoint.checkpoint && typeof checkpoint.checkpoint === "object" && !Array.isArray(checkpoint.checkpoint)
			? checkpoint.checkpoint as Record<string, unknown>
			: null;
	const terminalSummary = checkpointRecord?.terminalSummary;
	return terminalSummary && typeof terminalSummary === "object" && !Array.isArray(terminalSummary)
		? terminalSummary as Record<string, unknown>
		: null;
}

/**
 * Reconstruct the minimum viable control-plane state from a durable checkpoint
 * when the original daemon-owned live loop state is gone.
 */
function checkpointOnlyLoopState(checkpoint: ResearchLoopCheckpointRecord): ResearchLoopControlState {
	const terminalSummary = checkpointTerminalSummary(checkpoint);
	const requestedStopReason =
		typeof terminalSummary?.stopReason === "string" ? terminalSummary.stopReason : null;
	const checkpointStatus = typeof checkpoint.status === "string" ? checkpoint.status.trim() : null;
	const hasTerminalSummary = requestedStopReason != null;
	const isActiveCheckpoint = checkpointStatus == null || checkpointStatus === "active";
	const isCompletionCheckpoint = checkpoint.phase === "complete-pending";
	const stopReason = checkpoint.phase === "complete-pending"
		? requestedStopReason
		: hasTerminalSummary
			? requestedStopReason
			: "control-plane-lost";
	const status = isCompletionCheckpoint
		? "running"
		: isActiveCheckpoint
			? "failed"
			: checkpoint.status === "terminal" || hasTerminalSummary
				? terminalResearchLoopStatus(stopReason)
				: "failed";
	// I reconstruct the minimum viable live control state from the durable
	// checkpoint so timeout pickup can resume or inspect work without requiring a
	// still-running daemon process.
	return {
		loopKey: checkpoint.loopKey,
		projectPath: checkpoint.projectPath,
		topic: checkpoint.topic ?? null,
		sessionId: checkpoint.sessionId ?? null,
		sabhaId: checkpoint.sabhaId ?? null,
		workflowId: null,
		status,
		startedAt: checkpoint.createdAt,
		updatedAt: checkpoint.updatedAt,
		heartbeatAt: checkpoint.updatedAt,
		cancelRequestedAt:
			typeof checkpoint.cancelRequestedAt === "number" ? checkpoint.cancelRequestedAt : null,
		cancelReason: typeof checkpoint.cancelReason === "string" ? checkpoint.cancelReason : null,
		requestedBy: null,
		currentRound: checkpoint.currentRound ?? null,
		totalRounds: checkpoint.totalRounds ?? null,
		attemptNumber: null,
		phase: checkpoint.phase,
		stopReason,
		finishedAt: status === "running" ? null : checkpoint.updatedAt,
	};
}

/**
 * Register daemon-owned research loop control methods.
 *
 * These methods are the authoritative control plane for bounded overnight
 * loops. They track live status, cancellation, and resumability separately
 * from the durable experiment ledger.
 */
export function registerResearchLoopControlMethods(router: RpcRouter): void {
	router.register("research.loops.start", async (params) => {
		const loopKey = ensureResearchLoopKey(params.loopKey);
		const existing = getResearchLoopState(loopKey);
		if (existing) {
			if (isTerminalResearchLoopStatus(existing.status)) {
				throw new Error(`Research loop ${loopKey} is already completed; use a new loop key`);
			}
			throw new Error(`Research loop ${loopKey} is already active`);
		}
		const projectPath =
			typeof params.projectPath === "string" && params.projectPath.trim()
				? normalizeProjectPath(params.projectPath)
				: null;
		const checkpoint = await findResearchLoopCheckpointRecord(loopKey, projectPath);
		if (checkpoint) {
			// A durable checkpoint outranks "start a new loop" because restarting
			// under the same key would fork history and lose resume semantics.
			const checkpointState = checkpointOnlyLoopState(checkpoint);
			const resumePlan = buildResearchLoopResumePlan(checkpointState, checkpoint);
			throw researchLoopStartReuseError(loopKey, resumePlan?.nextAction ?? null);
		}
		const now = Date.now();
		await claimResearchLoopLease({
			...(params as Record<string, unknown>),
			loopKey,
			projectPath,
			now,
		});
		const state = buildStartedResearchLoopState(loopKey, params as Record<string, unknown>, now);
		setResearchLoopState(loopKey, state);
		return { state };
	}, "Register or refresh an active overnight research loop in daemon control state");

	router.register("research.loops.resume", async (params) => {
		const loopKey = ensureResearchLoopKey(params.loopKey);
		const now = Date.now();
		const projectPath =
			typeof params.projectPath === "string" && params.projectPath.trim()
				? normalizeProjectPath(params.projectPath)
				: null;
		const existing = getResearchLoopState(loopKey);
		const checkpoint = await findResearchLoopCheckpointRecord(loopKey, projectPath);
		const resumeState = existing ?? (checkpoint ? checkpointOnlyLoopState(checkpoint) : null);
		if (!resumeState) {
			throw new Error(`Research loop ${loopKey} has no durable state to resume`);
		}
		if (isTerminalResearchLoopStatus(resumeState.status)) {
			throw new Error(`Research loop ${loopKey} is already ${resumeState.status} and cannot be resumed`);
		}
		if (!canResumeResearchLoop(resumeState, now)) {
			throw new Error(`Research loop ${loopKey} is still active and cannot be resumed yet`);
		}
		await claimResearchLoopLease({
			...(params as Record<string, unknown>),
			loopKey,
			projectPath: projectPath ?? resumeState.projectPath,
			now,
			currentRound: resumeState.currentRound,
			totalRounds: resumeState.totalRounds,
			attemptNumber: resumeState.attemptNumber,
		});
		const state = buildResumedResearchLoopState(
			loopKey,
			params as Record<string, unknown>,
			resumeState,
			now,
		);
		setResearchLoopState(loopKey, state);
		return { state };
	}, "Resume a logical overnight research loop after a local timeout or process restart");

	router.register("research.loops.heartbeat", async (params) => {
		const loopKey = ensureResearchLoopKey(params.loopKey);
		const existing = getResearchLoopState(loopKey);
		if (!existing) {
			throw new Error(`Research loop ${loopKey} is not active`);
		}
		if (isTerminalResearchLoopStatus(existing.status)) {
			return { state: existing };
		}
		const now = Date.now();
		await heartbeatResearchLoopLease({
			...(params as Record<string, unknown>),
			loopKey,
			projectPath: typeof params.projectPath === "string" ? params.projectPath : existing.projectPath,
			now,
			currentRound: typeof params.currentRound === "number" ? params.currentRound : existing.currentRound,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : existing.totalRounds,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : existing.attemptNumber,
		});
		const state: ResearchLoopControlState = {
			loopKey,
			projectPath:
				typeof params.projectPath === "string"
					? normalizeProjectPath(params.projectPath)
					: existing.projectPath ?? null,
			topic: typeof params.topic === "string" ? params.topic.trim() : existing.topic ?? null,
			sessionId: typeof params.sessionId === "string" ? params.sessionId : existing.sessionId ?? null,
			sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : existing.sabhaId ?? null,
			workflowId: typeof params.workflowId === "string" ? params.workflowId : existing.workflowId ?? null,
			status: existing.cancelRequestedAt ? "cancelling" : "running",
			startedAt: existing.startedAt ?? now,
			updatedAt: now,
			heartbeatAt: now,
			cancelRequestedAt: existing.cancelRequestedAt ?? null,
			cancelReason: existing.cancelReason ?? null,
			requestedBy: existing.requestedBy ?? null,
			currentRound: typeof params.currentRound === "number" ? params.currentRound : existing.currentRound ?? null,
			totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : existing.totalRounds ?? null,
			attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : existing.attemptNumber ?? null,
			phase: typeof params.phase === "string" ? params.phase : existing.phase ?? null,
			stopReason: existing.stopReason ?? null,
			finishedAt: existing.finishedAt ?? null,
		};
		setResearchLoopState(loopKey, state);
		return { state };
	}, "Heartbeat an active overnight research loop and surface cancel intent");

	router.register("research.loops.get", async (params) => {
		const state = getResearchLoopState(params.loopKey);
		let checkpoint: { checkpoint?: unknown } | null = null;
		const projectPath =
			state?.projectPath
			?? (
				typeof params.projectPath === "string" && params.projectPath.trim()
					? normalizeProjectPath(params.projectPath)
					: null
			);
		checkpoint = await findResearchLoopCheckpointRecord(String(params.loopKey ?? "").trim(), projectPath);
		const effectiveState = state ?? (checkpoint ? checkpointOnlyLoopState(checkpoint as ResearchLoopCheckpointRecord) : null);
		return {
			state: effectiveState,
			checkpointOnly: !state && Boolean(checkpoint),
			resumeContext: buildResearchLoopResumeContext(effectiveState, checkpoint),
			resumePlan: buildResearchLoopResumePlan(effectiveState, checkpoint),
		};
	}, "Get active daemon control state for an overnight research loop");

	router.register("research.loops.active", async (params) => {
		const now = Date.now();
		const projectPath =
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: null;
		const baseStates = listResearchLoopStates()
			.filter((state) => !projectPath || state.projectPath === projectPath)
			.map((state) => ({
				...state,
				resumable: canResumeResearchLoop(state, now),
			}));
		const { getResearchLoopCheckpoint, listResearchLoopCheckpoints } = await import("@chitragupta/smriti");
		const checkpointEntries = listResearchLoopCheckpoints({ projectPath, limit: 200 });
		const states = baseStates.map((state) => {
			const checkpoint = state.projectPath ? getResearchLoopCheckpoint(state.projectPath, state.loopKey) : null;
			return {
				...state,
				checkpointOnly: false,
				resumeContext: buildResearchLoopResumeContext(state, checkpoint),
				resumePlan: buildResearchLoopResumePlan(state, checkpoint),
			};
		});
		const knownLoopKeys = new Set(states.map((state) => state.loopKey));
		for (const checkpoint of checkpointEntries) {
			if (knownLoopKeys.has(checkpoint.loopKey)) continue;
			const state = checkpointOnlyLoopState(checkpoint);
			states.push({
				...state,
				checkpointOnly: true,
				resumable: true,
				resumeContext: buildResearchLoopResumeContext(state, checkpoint),
				resumePlan: buildResearchLoopResumePlan(state, checkpoint),
			});
		}
		states.sort((left, right) => right.updatedAt - left.updatedAt);
		return { states };
	}, "List active or recent daemon-owned research loop control states for timeout inspection");

	router.register("research.loops.cancel", async (params) => {
		const loopKey = ensureResearchLoopKey(params.loopKey);
		const existing = getResearchLoopState(loopKey);
		const now = Date.now();
		if (!existing) {
			return { cancelled: false, state: null };
		}
		if (isTerminalResearchLoopStatus(existing.status)) {
			return { cancelled: false, state: existing };
		}
		await cancelDurableResearchLoop({
			...(params as Record<string, unknown>),
			loopKey,
			projectPath: existing.projectPath,
			now,
		});
		const state: ResearchLoopControlState = {
			...existing,
			status: "cancelling",
			updatedAt: now,
			cancelRequestedAt: existing.cancelRequestedAt ?? now,
			cancelReason: typeof params.reason === "string" && params.reason.trim()
				? params.reason.trim()
				: existing.cancelReason ?? "operator-interrupt",
			requestedBy: typeof params.requestedBy === "string" && params.requestedBy.trim()
				? params.requestedBy.trim()
				: existing.requestedBy ?? null,
		};
		setResearchLoopState(loopKey, state);
		return { cancelled: true, state };
	}, "Request cancellation of an active overnight research loop");

	router.register("research.loops.complete", async (params) => {
		const loopKey = ensureResearchLoopKey(params.loopKey);
		const existing = getResearchLoopState(loopKey);
		const now = Date.now();
		const requestedStopReason =
			typeof params.stopReason === "string" ? params.stopReason : existing?.stopReason ?? null;
		const stopReason = isFailureResearchLoopStopReason(requestedStopReason)
			? requestedStopReason
			: existing?.cancelRequestedAt
				? "cancelled"
				: requestedStopReason;
		const state: ResearchLoopControlState = {
			loopKey,
			projectPath: existing?.projectPath ?? null,
			topic: existing?.topic ?? null,
			sessionId: existing?.sessionId ?? null,
			sabhaId: existing?.sabhaId ?? null,
			workflowId: existing?.workflowId ?? null,
			status: terminalResearchLoopStatus(stopReason),
			startedAt: existing?.startedAt ?? now,
			updatedAt: now,
			heartbeatAt: existing?.heartbeatAt ?? null,
			cancelRequestedAt: existing?.cancelRequestedAt ?? null,
			cancelReason: existing?.cancelReason ?? null,
			requestedBy: existing?.requestedBy ?? null,
			currentRound: existing?.currentRound ?? null,
			totalRounds: existing?.totalRounds ?? null,
			attemptNumber: existing?.attemptNumber ?? null,
			phase: "complete",
			stopReason,
			finishedAt: now,
		};
		if (existing?.projectPath ?? (typeof params.projectPath === "string" ? params.projectPath : null)) {
			await completeDurableResearchLoop({
				...(params as Record<string, unknown>),
				loopKey,
				projectPath: existing?.projectPath ?? params.projectPath,
				stopReason,
				now,
			});
		}
		setResearchLoopState(loopKey, state);
		return { state };
	}, "Mark an overnight research loop as completed or cancelled in daemon control state");
}
