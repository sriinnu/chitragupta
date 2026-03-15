import crypto from "node:crypto";
import os from "node:os";
import type {
	ResearchCouncilSummary,
	ResearchScope,
} from "./chitragupta-nodes-research-shared.js";
import { withDaemonClient } from "./chitragupta-nodes-research-daemon.js";
import { researchCancellationError } from "./chitragupta-nodes-research-abort.js";

type ActiveResearchLoop = {
	loopKey: string;
	projectPath: string;
	controller: AbortController;
	leaseOwner: string | null;
	cancelReason: string | null;
	cancelRequestedAt: number | null;
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
	projectPath: string;
	signal: AbortSignal;
	getLeaseOwner(): string | null;
	getCancelReason(): string | null;
	getCancelRequestedAt(): number | null;
	isCancelled(): boolean;
};

type ResearchLoopStartMode = "start" | "resume" | "attach";

const activeResearchLoops = new Map<string, ActiveResearchLoop>();
const LOCAL_RESEARCH_LEASE_NAMESPACE = `prana:research-loop:${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;

function buildActiveLoopMapKey(projectPath: string, loopKey: string): string {
	return `${projectPath}::${loopKey}`;
}

function getActiveLoop(loopKey: string, projectPath?: string): ActiveResearchLoop | null {
	if (typeof projectPath === "string" && projectPath.trim()) {
		return activeResearchLoops.get(buildActiveLoopMapKey(projectPath, loopKey)) ?? null;
	}
	let match: ActiveResearchLoop | null = null;
	for (const active of activeResearchLoops.values()) {
		if (active.loopKey !== loopKey) continue;
		if (match) return null;
		match = active;
	}
	return match;
}

function abortLoop(loopKey: string, reason: string, projectPath?: string): boolean {
	const active = getActiveLoop(loopKey, projectPath);
	if (!active) return false;
	if (active.cancelReason) return true;
	active.cancelReason = reason;
	active.cancelRequestedAt = Date.now();
	active.controller.abort(researchCancellationError(reason));
	return true;
}

/**
 * Resolve the durable worker identity for one running loop instance.
 *
 * I keep the explicit scope-provided owner when it exists. Otherwise I derive a
 * process-unique loop owner so start, heartbeat, and complete all refer to the
 * same durable lease identity instead of relying on an ownerless fallback.
 */
function resolveLoopLeaseOwner(scope: ResearchScope, loopKey: string): string {
	if (typeof scope.leaseOwner === "string" && scope.leaseOwner.trim()) {
		return scope.leaseOwner.trim();
	}
	return `${LOCAL_RESEARCH_LEASE_NAMESPACE}:${loopKey}`;
}

export function cancelResearchLoop(loopKey: string, reason = "operator-interrupt", projectPath?: string): boolean {
	return abortLoop(loopKey, reason, projectPath);
}

/**
 * Release the local interrupt handle for a loop that will be retried via a
 * durable checkpoint. The daemon control plane remains the source of truth for
 * whether the logical loop is still active.
 */
export function releaseResearchLoopInterrupt(loopKey: string, projectPath?: string): void {
	if (typeof projectPath === "string" && projectPath.trim()) {
		activeResearchLoops.delete(buildActiveLoopMapKey(projectPath, loopKey));
		return;
	}
	const active = getActiveLoop(loopKey);
	if (!active) return;
	activeResearchLoops.delete(buildActiveLoopMapKey(active.projectPath, active.loopKey));
}

/**
 * List locally tracked active overnight research loops.
 *
 * This is a local process view only. The daemon control plane remains the
 * canonical authority for durable loop lifecycle state.
 */
export function listActiveResearchLoops(): Array<{
	loopKey: string;
	projectPath: string;
	startedAt: number;
	cancelReason: string | null;
}> {
	return [...activeResearchLoops.values()].map((loop) => ({
		loopKey: loop.loopKey,
		projectPath: loop.projectPath,
		startedAt: loop.startedAt,
		cancelReason: loop.cancelReason,
		cancelRequestedAt: loop.cancelRequestedAt,
	}));
}

/**
 * Start daemon-backed interrupt control for an overnight research loop.
 *
 * The daemon is the lifecycle authority. The local AbortController is only the
 * process-level projection of that authority for one running loop instance.
 */
export async function startResearchLoopInterrupt(
	scope: ResearchScope,
	council: ResearchCouncilSummary,
	loopKey: string,
	mode: ResearchLoopStartMode = "start",
): Promise<ResearchLoopInterruptHandle> {
	const activeLoopMapKey = buildActiveLoopMapKey(scope.projectPath, loopKey);
	if (activeResearchLoops.has(activeLoopMapKey)) {
		throw new Error(`Research loop ${loopKey} is already active locally`);
	}
	const leaseOwner = resolveLoopLeaseOwner(scope, loopKey);
	const controller = new AbortController();
	const active: ActiveResearchLoop = {
		loopKey,
		projectPath: scope.projectPath,
		controller,
		leaseOwner,
		cancelReason: null,
		cancelRequestedAt: null,
		startedAt: Date.now(),
	};
	activeResearchLoops.set(activeLoopMapKey, active);
	try {
		const started = await withDaemonClient(async (client) => {
			if (mode === "attach") {
				const result = await client.call("research.loops.get", {
					loopKey,
					projectPath: scope.projectPath,
				}) as {
					state?: Record<string, unknown> | null;
				} | null;
				if (!result?.state) {
					await client.call("research.loops.start", {
						loopKey,
						projectPath: scope.projectPath,
						topic: scope.topic,
						sessionId: council.sessionId,
						sabhaId: council.sabhaId,
						workflowId: "autoresearch-overnight",
						leaseOwner,
						totalRounds: scope.maxRounds,
						phase: "attach",
					});
					return;
				}
				await client.call("research.loops.resume", {
					loopKey,
					projectPath: scope.projectPath,
					topic: scope.topic,
					sessionId: council.sessionId,
					sabhaId: council.sabhaId,
					workflowId: "autoresearch-overnight",
					leaseOwner,
					totalRounds: scope.maxRounds,
					phase: "attach",
				});
				return;
			}
			await client.call(mode === "resume" ? "research.loops.resume" : "research.loops.start", {
				loopKey,
				projectPath: scope.projectPath,
				topic: scope.topic,
				sessionId: council.sessionId,
				sabhaId: council.sabhaId,
				workflowId: "autoresearch-overnight",
				leaseOwner,
				totalRounds: scope.maxRounds,
				phase: "start",
			});
		});
		if (started === null) {
			throw new Error("Research loop control daemon unavailable");
		}
	} catch (error) {
		activeResearchLoops.delete(activeLoopMapKey);
		throw error;
	}
	return {
		loopKey,
		projectPath: active.projectPath,
		signal: controller.signal,
		getLeaseOwner: () => active.leaseOwner,
		getCancelReason: () => active.cancelReason,
		getCancelRequestedAt: () => active.cancelRequestedAt,
		isCancelled: () => active.cancelReason !== null,
	};
}

/**
 * Poll daemon loop-control state and surface operator cancellation into the
 * local AbortSignal.
 *
 * Heartbeats are what make remote cancellation observable to a still-running
 * local round without waiting for the round to finish first.
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
				leaseOwner: handle.getLeaseOwner(),
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
	if (!state) {
		const reason = "control-plane-lost";
		abortLoop(handle.loopKey, reason, handle.projectPath);
		return { cancelled: true, reason };
	}
	if (
		typeof state.cancelRequestedAt === "number"
		&& Number.isFinite(state.cancelRequestedAt)
	) {
		const reason =
			typeof state.cancelReason === "string" && state.cancelReason.trim()
				? state.cancelReason.trim()
				: "operator-interrupt";
		abortLoop(handle.loopKey, reason, handle.projectPath);
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
					projectPath: handle.projectPath,
					leaseOwner: handle.getLeaseOwner(),
					stopReason,
				}) as { state?: Record<string, unknown> } | null;
			finalState = result?.state ?? null;
		} catch {
			// Preserve local loop state for retry/inspection when daemon completion fails.
		}
	});
	if (completed !== null && finalState) {
		activeResearchLoops.delete(buildActiveLoopMapKey(handle.projectPath, handle.loopKey));
	}
	return finalState;
}

/**
 * Reconcile a terminal loop summary back into daemon loop-control state when
 * resume discovered the loop was already finished before a local worker
 * attached its normal interrupt handle.
 */
export async function reconcileTerminalResearchLoopInterrupt(args: {
	loopKey: string;
	projectPath: string;
	leaseOwner?: string | null;
	stopReason: string;
}): Promise<Record<string, unknown> | null> {
	let finalState: Record<string, unknown> | null = null;
	await withDaemonClient(async (client) => {
		try {
			const result = await client.call("research.loops.complete", {
				loopKey: args.loopKey,
				projectPath: args.projectPath,
				leaseOwner: args.leaseOwner,
				stopReason: args.stopReason,
			}) as { state?: Record<string, unknown> } | null;
			finalState = result?.state ?? null;
		} catch {
			// A missing daemon or already-reconciled control row is non-fatal here.
		}
	});
	return finalState;
}
