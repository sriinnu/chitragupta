import crypto from "node:crypto";
import os from "node:os";
import type { RpcRouter } from "./rpc-router.js";
import { normalizeProjectPath, parseLimit } from "./services-helpers.js";
import { ensureResearchLoopKey } from "./services-research-loop-state.js";

export type ResearchLoopScheduleRecord = {
	projectPath: string;
	loopKey: string;
	topic: string | null;
	hypothesis: string | null;
	sessionId?: string | null;
	workflowId: string | null;
	workflowContext: Record<string, unknown> | null;
	parentSessionId: string | null;
	sessionLineageKey: string | null;
	sabhaId?: string | null;
	attemptNumber: number | null;
	availableAt?: number | null;
	currentRound?: number | null;
	totalRounds?: number | null;
	phase?: string | null;
	objectives?: Array<Record<string, unknown>>;
	stopConditions?: Array<Record<string, unknown>>;
	updateBudgets?: Record<string, unknown> | null;
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
	primaryStopConditionId?: string | null;
	status: string;
	cancelRequestedAt?: number | null;
	cancelReason?: string | null;
	requestedBy?: string | null;
	stopReason?: string | null;
	leaseOwner: string | null;
	leaseExpiresAt: number | null;
	finishedAt?: number | null;
};

export type ResearchLoopScheduleClaimStatus =
	| "missing"
	| "claimable"
	| "available-later"
	| "lease-active"
	| "terminal";

/**
 * Durable lease inspection result for one queued overnight loop.
 *
 * I expose this narrow shape so daemon control-plane methods can reuse the same
 * lease truth that resident dispatch uses before they declare a loop resumable,
 * blocked, or terminal.
 */
export interface ResearchLoopScheduleInspection {
	schedule: ResearchLoopScheduleRecord | null;
	claimStatus: ResearchLoopScheduleClaimStatus;
}

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

const DAEMON_CONTROL_LEASE_OWNER = `daemon:research-control:${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve the durable lease identity used by daemon control-plane mutations.
 *
 * I keep one process-unique fallback owner so direct daemon surfaces never
 * collapse onto the old shared `daemon:research-worker` identity when the
 * caller omitted an explicit lease owner.
 */
export function resolveResearchLoopLeaseOwner(value: unknown): string {
	return typeof value === "string" && value.trim() ? value.trim() : DAEMON_CONTROL_LEASE_OWNER;
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

function canRewriteScheduledRow(
	schedule: ResearchLoopScheduleRecord | null,
	leaseOwner: string | null,
	now: number,
): boolean {
	if (!schedule || schedule.finishedAt != null) return false;
	if (!schedule.leaseOwner || typeof schedule.leaseExpiresAt !== "number" || schedule.leaseExpiresAt <= now) {
		return true;
	}
	return leaseOwner === schedule.leaseOwner;
}

/**
 * Only rewrite one queued row back to `dispatch-retry` while it is still inside
 * the resident-dispatch pre-start window.
 *
 * If the same lease already advanced the loop into a running phase, forcing the
 * row back to queued would erase fresher control-plane truth.
 */
function classifyDispatchRetryOutcome(
	schedule: ResearchLoopScheduleRecord | null,
	leaseOwner: string | null,
	now: number,
): ResearchLoopDispatchRetryOutcome {
	if (!canRewriteScheduledRow(schedule, leaseOwner, now)) return "lease-lost";
	if (!schedule) return "lease-lost";
	if (schedule.cancelRequestedAt != null || schedule.status === "cancelling") return "cancelled";
	const phase = typeof schedule.phase === "string" ? schedule.phase.trim() : "";
	const preStartPhase = phase === "" || phase === "resident-dispatch" || phase === "dispatch-retry";
	const preStartStatus = schedule.status === "queued" || schedule.status === "leased";
	if (preStartPhase && preStartStatus) return "requeued";
	return phase ? "phase-advanced" : "lease-lost";
}

function isTerminalResearchLoopSchedule(schedule: ResearchLoopScheduleRecord | null): boolean {
	return Boolean(
		schedule
		&& (
			schedule.finishedAt != null
			|| schedule.status === "cancelled"
			|| schedule.status === "completed"
			|| schedule.status === "failed"
		),
	);
}

function hasActiveResearchLoopScheduleLease(
	schedule: ResearchLoopScheduleRecord | null,
	now: number,
	leaseOwner: string | null,
): boolean {
	if (
		!schedule
		|| !schedule.leaseOwner
		|| typeof schedule.leaseExpiresAt !== "number"
		|| schedule.leaseExpiresAt <= now
	) {
		return false;
	}
	return !leaseOwner || leaseOwner !== schedule.leaseOwner;
}

function describeClaimFailure(
	lookup: ScheduleLookup,
	inspection: ResearchLoopScheduleInspection,
): Error {
	switch (inspection.claimStatus) {
		case "terminal":
			return new Error(
				`Research loop ${lookup.loopKey} is already ${inspection.schedule?.status ?? "completed"} and cannot be claimed again`,
			);
		case "available-later":
			return new Error(
				`Research loop ${lookup.loopKey} is queued already and cannot be claimed before its next retry window`,
			);
		case "lease-active":
			return new Error(
				`Research loop ${lookup.loopKey} is leased already; resume after the active worker lease expires`,
			);
		default:
			return new Error(
				`Research loop ${lookup.loopKey} is not claimable right now; inspect the durable schedule row before retrying`,
			);
	}
}

async function loadResearchLoopScheduler(): Promise<ResearchLoopSchedulerModule> {
	return await import("@chitragupta/smriti") as unknown as ResearchLoopSchedulerModule;
}

/**
 * Resolve one project-less durable queue row only when the loop key is unique.
 *
 * I fail closed on ambiguity so a caller cannot accidentally inspect or act on
 * the wrong repo when two projects reuse the same logical loop key.
 */
function findUniqueResearchLoopSchedule(
	schedules: readonly ResearchLoopScheduleRecord[],
	loopKey: string,
): ResearchLoopScheduleRecord | null {
	const matches = schedules.filter((entry) => entry.loopKey === loopKey);
	return matches.length === 1 ? matches[0] ?? null : null;
}

/** One daemon-owned claim result for resident research dispatch. */
export interface ResearchDispatchPlan {
	schedule: ResearchLoopScheduleRecord;
}

/** Stable outcomes when a resident dispatch failure tries to rewrite the durable row. */
export type ResearchLoopDispatchRetryOutcome =
	| "requeued"
	| "cancelled"
	| "phase-advanced"
	| "lease-lost";

/**
 * Inspect whether one durable queue row is currently safe to claim.
 *
 * I keep this logic next to the scheduler helpers so resident dispatch and the
 * daemon control plane cannot drift on available-at, terminal, or lease-active
 * truth.
 */
export async function inspectResearchLoopScheduleClaim(
	params: Record<string, unknown>,
): Promise<ResearchLoopScheduleInspection> {
	const lookup = resolveScheduleLookup(params);
	const { getResearchLoopSchedule } = await loadResearchLoopScheduler();
	const schedule = getResearchLoopSchedule(lookup.projectPath, lookup.loopKey);
	if (!schedule) {
		return { schedule: null, claimStatus: "missing" };
	}
	const now = typeof params.now === "number" ? params.now : Date.now();
	const leaseOwner = normalizeOptionalString(params.leaseOwner);
	if (isTerminalResearchLoopSchedule(schedule)) {
		return { schedule, claimStatus: "terminal" };
	}
	if (
		(schedule.status === "queued" || schedule.status === "cancelling")
		&& typeof schedule.availableAt === "number"
		&& schedule.availableAt > now
	) {
		return { schedule, claimStatus: "available-later" };
	}
	if (hasActiveResearchLoopScheduleLease(schedule, now, leaseOwner)) {
		return { schedule, claimStatus: "lease-active" };
	}
	return { schedule, claimStatus: "claimable" };
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
			policyFingerprint: normalizeOptionalString(params.policyFingerprint),
			primaryObjectiveId: normalizeOptionalString(params.primaryObjectiveId),
			primaryStopConditionId: normalizeOptionalString(params.primaryStopConditionId),
			workflowContext: params.workflowContext,
		});
}

/**
 * Claim or refresh a durable worker lease for one logical loop.
 *
 * I fail closed when another worker still holds a live lease because overlapping
 * overnight workers are worse than a brief delay in daemon-owned scheduling.
 */
export async function claimResearchLoopLease(
	params: Record<string, unknown>,
): Promise<ResearchLoopScheduleRecord> {
	const lookup = resolveScheduleLookup(params);
	const { claimResearchLoopSchedule } = await loadResearchLoopScheduler();
	const inspection = await inspectResearchLoopScheduleClaim({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		leaseOwner: params.leaseOwner,
		now: params.now,
	});
	const existing = inspection.schedule;
	if (!existing) {
		await upsertDurableSchedule(params, "queued");
	}
	const claimed = claimResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		leaseOwner: resolveResearchLoopLeaseOwner(params.leaseOwner),
		leaseTtlMs: normalizeLeaseTtlMs(params.leaseTtlMs),
		currentRound: typeof params.currentRound === "number" ? params.currentRound : null,
		totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
		attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
		phase: normalizeOptionalString(params.phase),
	});
	if (!claimed.claimed) {
		throw describeClaimFailure(
			lookup,
			await inspectResearchLoopScheduleClaim({
				projectPath: lookup.projectPath,
				loopKey: lookup.loopKey,
				leaseOwner: params.leaseOwner,
				now: params.now,
			}),
		);
	}
	if (!claimed.schedule) {
		throw new Error(`Research loop ${lookup.loopKey} lost its durable schedule row during lease claim`);
	}
	return claimed.schedule;
}

/**
 * Claim exactly one runnable queued loop for resident daemon dispatch.
 *
 * I keep selection and lease acquisition in one daemon-owned step so multiple
 * resident workers cannot read the same runnable row and race each other into
 * duplicate overnight execution.
 */
export async function claimNextResearchLoopDispatch(
	params: Record<string, unknown>,
): Promise<ResearchDispatchPlan | null> {
	const { listResearchLoopSchedules, claimResearchLoopSchedule } = await loadResearchLoopScheduler();
	const projectPath = typeof params.projectPath === "string" && params.projectPath.trim()
		? normalizeProjectPath(params.projectPath)
		: undefined;
	const leaseOwner = resolveResearchLoopLeaseOwner(params.leaseOwner);
	const leaseTtlMs = normalizeLeaseTtlMs(params.leaseTtlMs);
	const limit = parseLimit(params.limit, 25);
	const dispatchable = listResearchLoopSchedules({
		projectPath,
		runnableOnly: true,
		limit,
	});
	for (const schedule of dispatchable) {
		const claimed = claimResearchLoopSchedule({
			projectPath: schedule.projectPath,
			loopKey: schedule.loopKey,
			leaseOwner,
			leaseTtlMs,
			attemptNumber: schedule.attemptNumber,
			phase: "resident-dispatch",
		});
		if (claimed.claimed && claimed.schedule) {
			return { schedule: claimed.schedule };
		}
	}
	return null;
}

/** Extend the existing worker lease while the loop is still making progress. */
export async function heartbeatResearchLoopLease(
	params: Record<string, unknown>,
): Promise<ResearchLoopScheduleRecord> {
	const lookup = resolveScheduleLookup(params);
	const { heartbeatResearchLoopSchedule } = await loadResearchLoopScheduler();
	const heartbeat = heartbeatResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		leaseOwner: resolveResearchLoopLeaseOwner(params.leaseOwner),
		leaseTtlMs: normalizeLeaseTtlMs(params.leaseTtlMs),
		currentRound: typeof params.currentRound === "number" ? params.currentRound : null,
		totalRounds: typeof params.totalRounds === "number" ? params.totalRounds : null,
		attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
		phase: normalizeOptionalString(params.phase),
	});
	if (!heartbeat) {
		throw new Error(`Research loop ${lookup.loopKey} lost its durable worker lease`);
	}
	return heartbeat;
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
export async function completeDurableResearchLoop(
	params: Record<string, unknown>,
): Promise<ResearchLoopScheduleRecord | null> {
	const lookup = resolveScheduleLookup(params);
	const { completeResearchLoopSchedule } = await loadResearchLoopScheduler();
	return completeResearchLoopSchedule({
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		stopReason: normalizeOptionalString(params.stopReason),
		leaseOwner: resolveResearchLoopLeaseOwner(params.leaseOwner),
	});
}

/**
 * Requeue a transient resident-dispatch failure without losing the durable row.
 *
 * I only use this when the resident worker failed before the loop could start
 * and reconcile itself through the normal control-plane lifecycle.
 */
export async function requeueDurableResearchLoopDispatch(
	params: Record<string, unknown>,
): Promise<{ outcome: ResearchLoopDispatchRetryOutcome; schedule: ResearchLoopScheduleRecord | null }> {
	const lookup = resolveScheduleLookup(params);
	const { getResearchLoopSchedule } = await loadResearchLoopScheduler();
	const existing = getResearchLoopSchedule(lookup.projectPath, lookup.loopKey);
	const leaseOwner = normalizeOptionalString(params.leaseOwner);
	const outcome = classifyDispatchRetryOutcome(existing, leaseOwner, Date.now());
	if (outcome !== "requeued") {
		return { outcome, schedule: existing };
	}
	await upsertDurableSchedule({
		...(existing ?? {}),
		...params,
		projectPath: lookup.projectPath,
		loopKey: lookup.loopKey,
		availableAt: typeof params.availableAt === "number" ? params.availableAt : Date.now(),
		attemptNumber: typeof params.attemptNumber === "number" ? params.attemptNumber : null,
		phase: normalizeOptionalString(params.phase) ?? "dispatch-retry",
	}, "queued");
	return {
		outcome,
		schedule: getResearchLoopSchedule(lookup.projectPath, lookup.loopKey),
	};
}

/**
 * Mark a resident-dispatch failure as terminal when the queued row is invalid.
 */
export async function failDurableResearchLoopDispatch(params: Record<string, unknown>): Promise<boolean> {
	const completed = await completeDurableResearchLoop({
		...params,
		leaseOwner: params.leaseOwner,
		stopReason: normalizeOptionalString(params.stopReason) ?? "dispatch-failed",
	});
	return completed !== null;
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
		const schedule = findUniqueResearchLoopSchedule(
			listResearchLoopSchedules({ limit: 200 }) as ResearchLoopScheduleRecord[],
			loopKey,
		);
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

	router.register("research.loops.dispatch.next", async (params) => {
		return {
			dispatch: await claimNextResearchLoopDispatch(params as Record<string, unknown>),
		};
	}, "Claim one runnable overnight research loop for resident daemon dispatch");
}
