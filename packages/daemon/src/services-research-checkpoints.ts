/**
 * RPC registration for daemon-owned research-loop checkpoint storage.
 */

import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath } from "./services-helpers.js";
import { buildResearchLoopResumeContext } from "./services-research-resume.js";

/**
 * Register research-loop checkpoint persistence methods.
 *
 * These methods keep the daemon as the canonical owner of active overnight
 * loop progress so resume can continue from the last safe closure phase.
 */
export function registerResearchCheckpointMethods(router: RpcRouter): void {
	router.register("research.loops.checkpoint.list", async (params) => {
		const projectPath =
			typeof params.projectPath === "string" && params.projectPath.trim()
				? normalizeProjectPath(params.projectPath)
				: null;
		const limit = typeof params.limit === "number" && Number.isFinite(params.limit)
			? params.limit
			: undefined;

		const { listResearchLoopCheckpoints } = await import("@chitragupta/smriti");
		const checkpoints = listResearchLoopCheckpoints({ projectPath, limit });
		return {
			checkpoints: checkpoints.map((checkpoint) => ({
				...checkpoint,
				resumeContext: buildResearchLoopResumeContext(null, checkpoint),
			})),
		};
	}, "List recent durable phase checkpoints for bounded research loops");

	router.register("research.loops.checkpoint.get", async (params) => {
		const projectPath =
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: "";
		const loopKey = typeof params.loopKey === "string" ? params.loopKey.trim() : "";
		if (!projectPath || !loopKey) throw new Error("Missing projectPath or loopKey");

		const { getResearchLoopCheckpoint } = await import("@chitragupta/smriti");
		const checkpoint = getResearchLoopCheckpoint(projectPath, loopKey);
		return {
			checkpoint,
			resumeContext: buildResearchLoopResumeContext(null, checkpoint),
		};
	}, "Load the durable phase checkpoint for a bounded research loop");

	router.register("research.loops.checkpoint.save", async (params) => {
		const projectPath =
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: "";
		const loopKey = typeof params.loopKey === "string" ? params.loopKey.trim() : "";
		const phase = typeof params.phase === "string" ? params.phase.trim() : "";
		const status = params.status === "terminal" ? "terminal" : "active";
		const checkpoint =
			params.checkpoint && typeof params.checkpoint === "object" && !Array.isArray(params.checkpoint)
				? params.checkpoint as Record<string, unknown>
				: null;
		if (!projectPath || !loopKey || !phase || !checkpoint) {
			throw new Error("Missing checkpoint fields");
		}

		const { upsertResearchLoopCheckpoint } = await import("@chitragupta/smriti");
		return {
			checkpoint: upsertResearchLoopCheckpoint({
				projectPath,
				loopKey,
				sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
				parentSessionId: typeof params.parentSessionId === "string" ? params.parentSessionId : null,
				sessionLineageKey:
					typeof params.sessionLineageKey === "string" ? params.sessionLineageKey : null,
				sabhaId: typeof params.sabhaId === "string" ? params.sabhaId : null,
				topic: typeof params.topic === "string" ? params.topic : null,
				hypothesis: typeof params.hypothesis === "string" ? params.hypothesis : null,
				status,
				phase,
				currentRound:
					typeof params.currentRound === "number" ? params.currentRound : null,
				nextRoundNumber:
					typeof params.nextRoundNumber === "number" ? params.nextRoundNumber : null,
				totalRounds:
					typeof params.totalRounds === "number" ? params.totalRounds : null,
				cancelRequestedAt:
					typeof params.cancelRequestedAt === "number" ? params.cancelRequestedAt : null,
				cancelReason:
					typeof params.cancelReason === "string" ? params.cancelReason : null,
				checkpoint,
			}),
		};
	}, "Persist the current active phase for a bounded research loop");

	router.register("research.loops.checkpoint.clear", async (params) => {
		const projectPath =
			typeof params.projectPath === "string"
				? normalizeProjectPath(params.projectPath)
				: "";
		const loopKey = typeof params.loopKey === "string" ? params.loopKey.trim() : "";
		if (!projectPath || !loopKey) throw new Error("Missing projectPath or loopKey");

		const { clearResearchLoopCheckpoint } = await import("@chitragupta/smriti");
		return {
			cleared: clearResearchLoopCheckpoint(projectPath, loopKey),
		};
	}, "Clear the durable checkpoint after a bounded research loop finishes");
}
