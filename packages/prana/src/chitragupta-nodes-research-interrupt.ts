import type {
	ResearchCouncilSummary,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import { withDaemonClient } from "./chitragupta-nodes-research-daemon.js";
import { researchCancellationError } from "./chitragupta-nodes-research-abort.js";

type ActiveResearchLoop = {
	loopKey: string;
	controller: AbortController;
	cancelReason: string | null;
	startedAt: number;
};

type LoopHeartbeatMeta = {
	currentRound?: number;
	totalRounds?: number;
	attemptNumber?: number;
	phase?: string;
};

export type ResearchLoopInterruptHandle = {
	loopKey: string;
	signal: AbortSignal;
	getCancelReason(): string | null;
	isCancelled(): boolean;
};

const activeResearchLoops = new Map<string, ActiveResearchLoop>();

function getActiveLoop(loopKey: string): ActiveResearchLoop | null {
	return activeResearchLoops.get(loopKey) ?? null;
}

function abortLoop(loopKey: string, reason: string): boolean {
	const active = getActiveLoop(loopKey);
	if (!active) return false;
	if (active.cancelReason) return true;
	active.cancelReason = reason;
	active.controller.abort(researchCancellationError(reason));
	return true;
}

export function cancelResearchLoop(loopKey: string, reason = "operator-interrupt"): boolean {
	return abortLoop(loopKey, reason);
}

/**
 * List locally tracked active overnight research loops.
 *
 * This is a local process view only. The daemon control plane remains the
 * canonical authority for durable loop lifecycle state.
 */
export function listActiveResearchLoops(): Array<{
	loopKey: string;
	startedAt: number;
	cancelReason: string | null;
}> {
	return [...activeResearchLoops.values()].map((loop) => ({
		loopKey: loop.loopKey,
		startedAt: loop.startedAt,
		cancelReason: loop.cancelReason,
	}));
}

/**
 * Start daemon-backed interrupt control for an overnight research loop.
 *
 * The daemon registration is mandatory. If the daemon control plane cannot
 * accept the loop start, the local interrupt handle is discarded and the
 * start fails closed.
 */
export async function startResearchLoopInterrupt(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	loopKey: string,
): Promise<ResearchLoopInterruptHandle> {
	if (activeResearchLoops.has(loopKey)) {
		throw new Error(`Research loop ${loopKey} is already active locally`);
	}
	const controller = new AbortController();
	const active: ActiveResearchLoop = {
		loopKey,
		controller,
		cancelReason: null,
		startedAt: Date.now(),
	};
	activeResearchLoops.set(loopKey, active);
	try {
		const started = await withDaemonClient(async (client) => {
			await client.call("research.loops.start", {
				loopKey,
				projectPath: scope.projectPath,
				topic: scope.topic,
				sessionId: council.sessionId,
				sabhaId: council.sabhaId,
				workflowId: "autoresearch-overnight",
				totalRounds: scope.maxRounds,
				phase: "start",
			});
		});
		if (started === null) {
			throw new Error("Research loop control daemon unavailable");
		}
	} catch (error) {
		activeResearchLoops.delete(loopKey);
		throw error;
	}
	return {
		loopKey,
		signal: controller.signal,
		getCancelReason: () => active.cancelReason,
		isCancelled: () => active.cancelReason !== null,
	};
}

/**
 * Poll daemon loop-control state and surface operator cancellation into the
 * local AbortSignal.
 */
export async function heartbeatResearchLoopInterrupt(
	handle: ResearchLoopInterruptHandle,
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	meta: LoopHeartbeatMeta = {},
): Promise<{ cancelled: boolean; reason: string | null }> {
	if (handle.isCancelled()) {
		return { cancelled: true, reason: handle.getCancelReason() };
	}
	const daemonState = await withDaemonClient(async (client) => {
		try {
			return await client.call("research.loops.heartbeat", {
				loopKey: handle.loopKey,
				projectPath: scope.projectPath,
				topic: scope.topic,
				sessionId: council.sessionId,
				sabhaId: council.sabhaId,
				workflowId: "autoresearch-overnight",
				currentRound: meta.currentRound ?? null,
				totalRounds: meta.totalRounds ?? scope.maxRounds,
				attemptNumber: meta.attemptNumber ?? null,
				phase: meta.phase ?? null,
			}) as { state?: Record<string, unknown> } | null;
		} catch {
			return null;
		}
	});
	const state = daemonState?.state;
	if (
		state
		&& typeof state.cancelRequestedAt === "number"
		&& Number.isFinite(state.cancelRequestedAt)
	) {
		const reason =
			typeof state.cancelReason === "string" && state.cancelReason.trim()
				? state.cancelReason.trim()
				: "operator-interrupt";
		abortLoop(handle.loopKey, reason);
		return { cancelled: true, reason };
	}
	return { cancelled: handle.isCancelled(), reason: handle.getCancelReason() };
}

/**
 * Complete daemon-backed interrupt control for an overnight research loop.
 *
 * Local loop state is only cleared after daemon completion succeeds, so a
 * transient daemon failure does not erase the local handle needed for retry
 * or inspection.
 */
export async function completeResearchLoopInterrupt(
	handle: ResearchLoopInterruptHandle,
	stopReason: string,
): Promise<Record<string, unknown> | null> {
	let finalState: Record<string, unknown> | null = null;
	const completed = await withDaemonClient(async (client) => {
		try {
			const result = await client.call("research.loops.complete", {
				loopKey: handle.loopKey,
				stopReason,
			}) as { state?: Record<string, unknown> } | null;
			finalState = result?.state ?? null;
		} catch {
			// Preserve local loop state for retry/inspection when daemon completion fails.
		}
	});
	if (completed !== null && finalState) {
		activeResearchLoops.delete(handle.loopKey);
	}
	return finalState;
}
