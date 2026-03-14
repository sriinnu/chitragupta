import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath, parseLimit } from "./services-helpers.js";
import { ensureResearchLoopKey } from "./services-research-loop-state.js";

type ResearchLoopScheduleRecord = {
	projectPath: string;
	loopKey: string;
	leaseOwner: string | null;
	leaseExpiresAt: number | null;
};

type ResearchLoopSchedulerModule = {
	upsertResearchLoopSchedule: (input: Record<string, unknown>) => ResearchLoopScheduleRecord;
	getResearchLoopSchedule: (projectPath: string, loopKey: string) => ResearchLoopScheduleRecord | null;
	listResearchLoopSchedules: (options?: Record<string, unknown>) => ResearchLoopScheduleRecord[];
	claimResearchLoopSchedule: (input: Record<string, unknown>) => {
		claimed: boolean;
		schedule: ResearchLoopScheduleRecord | null;
	};
	heartbeatResearchLoopSchedule: (input: Record<string, unknown>) => ResearchLoopScheduleRecord | null;
	cancelResearchLoopSchedule: (input: Record<string, unknown>) => ResearchLoopScheduleRecord | null;
	completeResearchLoopSchedule: (input: Record<string, unknown>) => ResearchLoopScheduleRecord | null;
};
type ScheduleLookup = {
	projectPath: string;
	loopKey: string;
};

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLeaseOwner(value: unknown): string {
	return typeof value === "string" && value.trim() ? value.trim() : "daemon:research-worker";
}

function normalizeLeaseTtlMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(5_000, Math.min(15 * 60_000, Math.floor(value)))
		: 90_000;
}

function resolveScheduleLookup(params: Record<string, unknown>): ScheduleLookup {
	const projectPath = typeof params.projectPath === "string" && params.projectPath.trim()
		? normalizeProjectPath(params.projectPath)
		: null;
	const loopKey = ensureResearchLoopKey(params.loopKey);
	if (!projectPath) {
		throw new Error("Missing projectPath for research loop schedule");
	}
	return { projectPath, loopKey };
}

async function loadResearchLoopScheduler(): Promise<ResearchLoopSchedulerModule> {
	return await import("@chitragupta/smriti") as unknown as ResearchLoopSchedulerModule;
}

/**
 * Persist or refresh the durable queued schedule row before a worker claims it.
 *
 * I keep queueing and lease-claim separate so the daemon can later enqueue work
 * without starting it immediately, while direct callers can still use the same
 * helpers for start/resume.
 */
async function upsertDurableSchedule(
	params: Record<string, unknown>,
	status: "queued" | "leased" | "cancelling",
): Promise<void> {
	const lookup = resolveScheduleLookup(params);
	const { upsertResearchLoopSchedule } = await loadResearchLoopScheduler();
	upsertResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		topic: normalizeOptionalString(params.topic),
		hypothesis: normalizeOptionalString(params.hypothesis),
		sessionId: normalizeOptionalString(params.sessionId),
		parentSessionId: normalizeOptionalString(params.parentSessionId),
		sessionLineageKey: normalizeOptionalString(params.sessionLineageKey),
		sabhaId: normalizeOptionalString(params.sabhaId),
		workflowId: normalizeOptionalString(params.workflowId),
		status,
		availableAt: typeof params.availableAt === "number" ? params.availableAt : null,
		currentRound: typeof params.currentRound === "number" ? params.currentRound : null,
		totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
		attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
			phase: normalizeOptionalString(params.phase),
			objectives: params.objectives,
			stopConditions: params.stopConditions,
			updateBudgets: params.updateBudgets,
			workflowContext: params.workflowContext,
		});
}

/**
 * Claim or refresh a durable worker lease for one logical loop.
 *
 * I fail closed when another worker still holds a live lease because overlapping
 * overnight workers are worse than a brief delay in daemon-owned scheduling.
 */
export async function claimResearchLoopLease(params: Record<string, unknown>): Promise<void> {
	const lookup = resolveScheduleLookup(params);
	await upsertDurableSchedule(params, "queued");
	const { claimResearchLoopSchedule } = await loadResearchLoopScheduler();
	const claimed = claimResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		leaseOwner: normalizeLeaseOwner(params.leaseOwner),
		leaseTtlMs: normalizeLeaseTtlMs(params.leaseTtlMs),
		currentRound: typeof params.currentRound === "number" ? params.currentRound : null,
		totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
		attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
		phase: normalizeOptionalString(params.phase),
	});
	if (!claimed.claimed) {
		throw new Error(`Research loop ${lookup.loopKey} is leased already; resume after the active worker lease expires`);
	}
}

/** Extend the existing worker lease while the loop is still making progress. */
export async function heartbeatResearchLoopLease(params: Record<string, unknown>): Promise<void> {
	const lookup = resolveScheduleLookup(params);
	const { heartbeatResearchLoopSchedule } = await loadResearchLoopScheduler();
	const heartbeat = heartbeatResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		leaseOwner: normalizeLeaseOwner(params.leaseOwner),
		leaseTtlMs: normalizeLeaseTtlMs(params.leaseTtlMs),
		currentRound: typeof params.currentRound === "number" ? params.currentRound : null,
		totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
		attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
		phase: normalizeOptionalString(params.phase),
	});
	if (!heartbeat) {
		throw new Error(`Research loop ${lookup.loopKey} lost its durable worker lease`);
	}
}

/** Persist operator cancellation into the durable schedule row. */
export async function cancelDurableResearchLoop(params: Record<string, unknown>): Promise<void> {
	const lookup = resolveScheduleLookup(params);
	const { cancelResearchLoopSchedule } = await loadResearchLoopScheduler();
	cancelResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		reason: normalizeOptionalString(params.reason),
		requestedBy: normalizeOptionalString(params.requestedBy),
	});
}

/** Persist the terminal outcome into the durable schedule row. */
export async function completeDurableResearchLoop(params: Record<string, unknown>): Promise<void> {
	const lookup = resolveScheduleLookup(params);
	const { completeResearchLoopSchedule } = await loadResearchLoopScheduler();
	completeResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		stopReason: normalizeOptionalString(params.stopReason),
	});
}

/**
 * Register daemon-owned queue/dispatch surfaces for overnight research loops.
 *
 * These methods expose the durable schedule/lease layer directly so the daemon
 * can later become a resident scheduler instead of relying on ad hoc external
 * triggers to discover what work should run next.
 */
export function registerResearchLoopSchedulerMethods(router: RpcRouter): void {
	router.register("research.loops.enqueue", async (params) => {
		await upsertDurableSchedule(params as Record<string, unknown>, "queued");
		const { getResearchLoopSchedule } = await loadResearchLoopScheduler();
		const lookup = resolveScheduleLookup(params as Record<string, unknown>);
		return {
			schedule: getResearchLoopSchedule(lookup.projectPath, lookup.loopKey),
		};
	}, "Queue an overnight research loop for daemon-owned dispatch");

	router.register("research.loops.schedule.get", async (params) => {
		const { getResearchLoopSchedule, listResearchLoopSchedules } = await loadResearchLoopScheduler();
		if (typeof params.projectPath === "string" && params.projectPath.trim()) {
			const lookup = resolveScheduleLookup(params as Record<string, unknown>);
			return { schedule: getResearchLoopSchedule(lookup.projectPath, lookup.loopKey) };
		}
		const loopKey = ensureResearchLoopKey(params.loopKey);
		const schedule = listResearchLoopSchedules({ limit: 200 }).find(
			(entry: ResearchLoopScheduleRecord) => entry.loopKey === loopKey,
		) ?? null;
		return { schedule };
	}, "Get the durable queue/lease state for one overnight research loop");

	router.register("research.loops.dispatchable", async (params) => {
		const { listResearchLoopSchedules } = await loadResearchLoopScheduler();
		const projectPath = typeof params.projectPath === "string" && params.projectPath.trim()
			? normalizeProjectPath(params.projectPath)
			: undefined;
		return {
			schedules: listResearchLoopSchedules({
				projectPath,
				runnableOnly: true,
				limit: parseLimit(params.limit, 50),
			}),
		};
	}, "List queued or expired-lease overnight research loops that the daemon can dispatch");
}
