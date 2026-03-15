import crypto from "node:crypto";
import os from "node:os";
import {
	claimResearchLoopSchedule,
	completeResearchLoopSchedule,
	getResearchLoopSchedule,
	listResearchLoopSchedules,
	upsertResearchLoopSchedule,
} from "@chitragupta/smriti";
import type { EmitFn } from "./daemon-periodic.js";

/** Default cadence for the daemon-owned resident research dispatcher. */
export const DEFAULT_RESEARCH_DISPATCH_INTERVAL_MS = 60_000;
const DEFAULT_DISPATCH_SCAN_LIMIT = 25;

type DispatchableResearchLoop = {
	projectPath: string;
	loopKey: string;
	topic: string | null;
	hypothesis: string | null;
	status?: string;
	workflowId: string | null;
	objectives?: Array<Record<string, unknown>>;
	stopConditions?: Array<Record<string, unknown>>;
	updateBudgets?: Record<string, unknown> | null;
	policyFingerprint?: string | null;
	primaryObjectiveId?: string | null;
	primaryStopConditionId?: string | null;
	workflowContext: Record<string, unknown> | null;
	parentSessionId: string | null;
	sessionLineageKey: string | null;
	attemptNumber?: number | null;
	phase?: string | null;
	leaseOwner?: string | null;
	leaseExpiresAt?: number | null;
	finishedAt?: number | null;
	cancelRequestedAt?: number | null;
};

type QueuedResearchWorkflow = {
	id: string;
	context?: Record<string, unknown>;
	[key: string]: unknown;
};

type PranaDispatchRuntime = {
	WorkflowExecutor: new() => {
		execute(workflow: QueuedResearchWorkflow): Promise<{ status: string }>;
	};
	getChitraguptaWorkflow: (workflowId: string) => QueuedResearchWorkflow | null;
};

type ResearchDispatchControlPlane = {
	claimNextDispatch(params: {
		leaseOwner: string;
		leaseTtlMs: number;
	}): Promise<DispatchableResearchLoop | null>;
	requeueDispatch(schedule: DispatchableResearchLoop, params: {
		availableAt: number;
		attemptNumber: number;
		phase: string;
	}): Promise<void>;
	failDispatch(schedule: DispatchableResearchLoop, params: {
		stopReason: string;
	}): Promise<void | boolean>;
};

async function loadPranaDispatchRuntime(): Promise<PranaDispatchRuntime> {
	return await import(new URL("../../prana/dist/index.js", import.meta.url).href) as PranaDispatchRuntime;
}

let pranaDispatchRuntimeLoader: (() => Promise<PranaDispatchRuntime>) | null = null;
let researchDispatchControlPlane: ResearchDispatchControlPlane | null = null;
const RESIDENT_RESEARCH_LEASE_OWNER = `daemon:research-worker:${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;

class ResearchDispatchConfigurationError extends Error {}

/**
 * Override the runtime workflow loader in tests without introducing a workspace
 * package cycle between anina and prana.
 */
export function _setResearchDispatchRuntimeLoaderForTests(
	loader: (() => Promise<PranaDispatchRuntime>) | null,
): void {
	pranaDispatchRuntimeLoader = loader;
}

/**
 * Install the daemon-owned dispatch control plane used by the resident
 * scheduler when the full socket daemon is running.
 *
 * I keep this injectable so the standalone Anina daemon can still fall back to
 * direct durable schedule access without introducing a package cycle.
 */
export function setResearchDispatchControlPlane(
	controlPlane: ResearchDispatchControlPlane | null,
): void {
	researchDispatchControlPlane = controlPlane;
}

function formatDispatchDate(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

function defaultResearchLeaseOwner(): string {
	return RESIDENT_RESEARCH_LEASE_OWNER;
}

function dispatchRetryBackoffMs(attemptNumber: number | null | undefined): number {
	const normalizedAttempt = Math.max(0, Math.min((attemptNumber ?? 0) + 1, 6));
	return Math.min(30 * 60_000, 30_000 * (2 ** normalizedAttempt));
}

function isSuccessfulWorkflowExecutionStatus(status: string): boolean {
	return status === "completed";
}

/**
 * Only requeue dispatch failures while the durable row is still in the
 * pre-start resident-dispatch window.
 *
 * Once the workflow has advanced into a real running phase under the same
 * lease, rewriting the row back to `dispatch-retry` would silently erase the
 * loop's newer control-plane truth.
 */
function canRewriteDispatchRetry(
	existing: DispatchableResearchLoop | null,
	schedule: DispatchableResearchLoop,
	now: number,
): boolean {
	if (
		!existing
		|| existing.finishedAt != null
		|| (
			typeof existing.leaseOwner === "string"
			&& existing.leaseOwner.trim()
			&& typeof existing.leaseExpiresAt === "number"
			&& existing.leaseExpiresAt > now
			&& existing.leaseOwner !== schedule.leaseOwner
		)
	) {
		return false;
	}
	if (existing.cancelRequestedAt != null || existing.status === "cancelling") return false;
	const phase = typeof existing.phase === "string" ? existing.phase.trim() : "";
	const preStartPhase = phase === "" || phase === "resident-dispatch" || phase === "dispatch-retry";
	const preStartStatus = existing.status === "queued" || existing.status === "leased";
	return preStartPhase && preStartStatus;
}

/**
 * Requeue a dispatch attempt when the resident scheduler hit a transient loader
 * or executor problem before the loop could reconcile itself durably.
 */
async function claimNextDispatchableLoop(leaseOwner: string): Promise<DispatchableResearchLoop | null> {
	if (researchDispatchControlPlane) {
		return await researchDispatchControlPlane.claimNextDispatch({
			leaseOwner,
			leaseTtlMs: 90_000,
		});
	}
	const dispatchable = listResearchLoopSchedules({
		runnableOnly: true,
		limit: DEFAULT_DISPATCH_SCAN_LIMIT,
	}) as DispatchableResearchLoop[];
	for (const nextSchedule of dispatchable) {
		const leaseClaim = claimResearchLoopSchedule({
			projectPath: nextSchedule.projectPath,
			loopKey: nextSchedule.loopKey,
			leaseOwner,
			leaseTtlMs: 90_000,
			attemptNumber: nextSchedule.attemptNumber ?? null,
			phase: "resident-dispatch",
		});
		if (!leaseClaim.claimed) continue;
		const claimedSchedule = leaseClaim.schedule as DispatchableResearchLoop | null | undefined;
		return {
			...nextSchedule,
			...(claimedSchedule ?? {}),
			leaseOwner:
				typeof claimedSchedule?.leaseOwner === "string" && claimedSchedule.leaseOwner.trim()
					? claimedSchedule.leaseOwner
					: leaseOwner,
		};
	}
	return null;
}

async function requeueResearchDispatchAttempt(
	schedule: DispatchableResearchLoop,
): Promise<void> {
	const params = {
		availableAt: Date.now() + dispatchRetryBackoffMs(schedule.attemptNumber),
		attemptNumber: (schedule.attemptNumber ?? 0) + 1,
		phase: "dispatch-retry",
	};
	if (researchDispatchControlPlane) {
		await researchDispatchControlPlane.requeueDispatch(schedule, params);
		return;
	}
	const existing = getResearchLoopSchedule(schedule.projectPath, schedule.loopKey);
	const now = Date.now();
	if (!canRewriteDispatchRetry(existing as DispatchableResearchLoop | null, schedule, now)) {
		if (existing && existing.finishedAt == null && (existing.cancelRequestedAt != null || existing.status === "cancelling")) {
			const reconciled = await failResearchDispatch(schedule, "cancelled");
			if (!reconciled) {
				throw new Error(`Research loop ${schedule.loopKey} lost its durable lease before cancellation could be reconciled`);
			}
			throw new Error(`Research loop ${schedule.loopKey} cancellation was reconciled before dispatch retry`);
		}
		if (
			existing
			&& existing.finishedAt == null
			&& existing.leaseOwner === schedule.leaseOwner
			&& typeof existing.phase === "string"
			&& existing.phase.trim()
			&& existing.phase !== "resident-dispatch"
			&& existing.phase !== "dispatch-retry"
		) {
			throw new Error(
				`Research loop ${schedule.loopKey} advanced to phase ${existing.phase} before dispatch retry could be recorded`,
			);
		}
		throw new Error(`Research loop ${schedule.loopKey} lost its durable lease before dispatch retry could be recorded`);
	}
	upsertResearchLoopSchedule({
		...existing,
		projectPath: schedule.projectPath,
		loopKey: schedule.loopKey,
		topic: schedule.topic,
		hypothesis: schedule.hypothesis,
		workflowId: schedule.workflowId,
		workflowContext: schedule.workflowContext,
		parentSessionId: schedule.parentSessionId,
		sessionLineageKey: schedule.sessionLineageKey,
		objectives: schedule.objectives,
		stopConditions: schedule.stopConditions,
		updateBudgets: schedule.updateBudgets,
		status: "queued",
		availableAt: params.availableAt,
		attemptNumber: params.attemptNumber,
		phase: params.phase,
	});
}

async function failResearchDispatch(
	schedule: DispatchableResearchLoop,
	stopReason: "dispatch-failed" | "cancelled",
): Promise<boolean> {
	if (researchDispatchControlPlane) {
		try {
			// I accept both the newer thrown lease-loss signal and the older
			// boolean-return contract so resident dispatch stays compatible while
			// the daemon-owned control plane converges on one shape.
			const reconciled = await researchDispatchControlPlane.failDispatch(schedule, { stopReason });
			if (reconciled === false) {
				return false;
			}
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("durable terminal reconciliation lost the lease")) {
				return false;
			}
			throw error;
		}
	}
	const existing = getResearchLoopSchedule(schedule.projectPath, schedule.loopKey);
	if (!existing || existing.finishedAt != null) {
		return false;
	}
	return completeResearchLoopSchedule({
		projectPath: schedule.projectPath,
		loopKey: schedule.loopKey,
		leaseOwner: schedule.leaseOwner ?? null,
		stopReason,
	}) !== null;
}

/**
 * Rebuild the workflow context that the resident daemon scheduler needs to
 * execute one queued overnight loop.
 *
 * I only dispatch workflows that persisted a durable context envelope. That
 * keeps resident scheduling honest: if the queue row cannot reconstruct the
 * exact loop contract, the daemon should fail closed instead of guessing.
 */
function buildQueuedResearchWorkflow(
	schedule: DispatchableResearchLoop,
	getWorkflow: PranaDispatchRuntime["getChitraguptaWorkflow"],
): QueuedResearchWorkflow {
	if (!schedule.workflowContext) {
		throw new ResearchDispatchConfigurationError(`Research loop ${schedule.loopKey} is missing workflowContext`);
	}
	const workflowId = schedule.workflowId ?? "autoresearch-overnight";
	const workflow = getWorkflow(workflowId);
	if (!workflow) {
		throw new ResearchDispatchConfigurationError(
			`Research loop ${schedule.loopKey} references unknown workflow '${workflowId}'`,
		);
	}
	const persistedContext = schedule.workflowContext ?? {};
	const persistedObjectives = Array.isArray(schedule.objectives) ? schedule.objectives : [];
	const persistedStopConditions = Array.isArray(schedule.stopConditions) ? schedule.stopConditions : [];
	const persistedUpdateBudgets =
		schedule.updateBudgets && typeof schedule.updateBudgets === "object" && !Array.isArray(schedule.updateBudgets)
			? schedule.updateBudgets
			: null;
	return {
		...workflow,
		context: {
			...(workflow.context ?? {}),
			...persistedContext,
			projectPath: schedule.projectPath,
			researchLoopKey: schedule.loopKey,
			researchTopic:
				schedule.topic
				?? (typeof persistedContext.researchTopic === "string"
					? persistedContext.researchTopic
					: undefined),
			researchHypothesis:
				schedule.hypothesis
				?? (typeof persistedContext.researchHypothesis === "string"
					? persistedContext.researchHypothesis
					: undefined),
			researchParentSessionId:
				schedule.parentSessionId
				?? (typeof persistedContext.researchParentSessionId === "string"
					? persistedContext.researchParentSessionId
					: undefined),
			researchSessionLineageKey:
				schedule.sessionLineageKey
				?? (typeof persistedContext.researchSessionLineageKey === "string"
					? persistedContext.researchSessionLineageKey
					: undefined),
			// The durable schedule row is the authority for queued resident pickup.
			// If it already persisted a registry or budget envelope, I replay that
			// exact contract instead of trusting stale workflow defaults.
			researchObjectives:
				persistedObjectives.length > 0
					? persistedObjectives
					: persistedContext.researchObjectives,
			researchStopConditions:
				persistedStopConditions.length > 0
					? persistedStopConditions
					: persistedContext.researchStopConditions,
			researchUpdateBudgets:
				persistedUpdateBudgets
				?? (persistedContext.researchUpdateBudgets && typeof persistedContext.researchUpdateBudgets === "object"
					? persistedContext.researchUpdateBudgets
					: undefined),
			// I replay the durable optimizer identity alongside the raw registry so
			// dispatch, resume, and downstream analysis can all prove they are
			// operating under the same queue-time policy contract.
			researchPolicyFingerprint:
				typeof schedule.policyFingerprint === "string"
					? schedule.policyFingerprint
					: (typeof persistedContext.researchPolicyFingerprint === "string"
						? persistedContext.researchPolicyFingerprint
						: undefined),
			researchPrimaryObjectiveId:
				typeof schedule.primaryObjectiveId === "string"
					? schedule.primaryObjectiveId
					: (typeof persistedContext.researchPrimaryObjectiveId === "string"
						? persistedContext.researchPrimaryObjectiveId
						: undefined),
			researchPrimaryStopConditionId:
				typeof schedule.primaryStopConditionId === "string"
					? schedule.primaryStopConditionId
					: (typeof persistedContext.researchPrimaryStopConditionId === "string"
						? persistedContext.researchPrimaryStopConditionId
						: undefined),
			researchLeaseOwner:
				typeof schedule.leaseOwner === "string" && schedule.leaseOwner.trim()
					? schedule.leaseOwner.trim()
					: typeof persistedContext.researchLeaseOwner === "string" && persistedContext.researchLeaseOwner.trim()
						? persistedContext.researchLeaseOwner.trim()
						: defaultResearchLeaseOwner(),
		},
	};
}

/**
 * Dispatch at most one queued overnight research workflow from the durable
 * daemon-owned schedule queue after claiming its worker lease.
 *
 * I keep this intentionally narrow: one resident dispatch at a time, no hidden
 * fan-out, and fail-closed behavior when the queue row cannot reconstruct the
 * workflow context safely.
 */
export async function dispatchNextQueuedResearchLoop(emit: EmitFn): Promise<boolean> {
	const leaseOwner = defaultResearchLeaseOwner();
	const nextSchedule = await claimNextDispatchableLoop(leaseOwner);
	if (!nextSchedule) return false;
	const date = formatDispatchDate();
	if (nextSchedule.status === "cancelling" || nextSchedule.cancelRequestedAt != null) {
		const reconciled = await failResearchDispatch(nextSchedule, "cancelled");
		emit("consolidation", {
			type: reconciled ? "progress" : "error",
			date,
			phase: "research-dispatch",
			detail: reconciled
				? `skipped ${nextSchedule.loopKey} because the durable queue row is cancelling`
				: `skipped ${nextSchedule.loopKey} because cancellation won before resident dispatch, but durable terminal reconciliation lost the lease`,
		});
		return true;
	}
	try {
		const runtime = await (pranaDispatchRuntimeLoader ?? loadPranaDispatchRuntime)();
		const workflow = buildQueuedResearchWorkflow(nextSchedule, runtime.getChitraguptaWorkflow);
		emit("consolidation", {
			type: "progress",
			date,
			phase: "research-dispatch",
			detail: `dispatching ${nextSchedule.loopKey} via ${workflow.id}`,
		});
		const executor = new runtime.WorkflowExecutor();
		const execution = await executor.execute(workflow);
		if (!isSuccessfulWorkflowExecutionStatus(execution.status)) {
			const reconciled = await failResearchDispatch(
				nextSchedule,
				execution.status === "cancelled" ? "cancelled" : "dispatch-failed",
			);
			emit("consolidation", {
				type: reconciled ? "error" : "progress",
				date,
				phase: "research-dispatch",
				detail: reconciled
					? `dispatch of ${nextSchedule.loopKey} finished with non-success status ${execution.status}`
					: `dispatch of ${nextSchedule.loopKey} finished with non-success status ${execution.status}, but the durable lease had already moved`,
			});
			return true;
		}
		emit("consolidation", {
			type: "progress",
			date,
			phase: "research-dispatch",
			detail: `completed ${nextSchedule.loopKey} with status ${execution.status}`,
		});
		return true;
	} catch (error) {
		if (error instanceof ResearchDispatchConfigurationError) {
			const reconciled = await failResearchDispatch(nextSchedule, "dispatch-failed");
			emit("consolidation", {
				type: reconciled ? "error" : "progress",
				date,
				phase: "research-dispatch",
				detail: reconciled
					? error.message
					: `${error.message} (durable lease moved before terminal reconciliation)`,
			});
			} else {
				try {
					await requeueResearchDispatchAttempt(nextSchedule);
					emit("consolidation", {
						type: "error",
						date,
						phase: "research-dispatch",
						detail: error instanceof Error ? error.message : String(error),
					});
				} catch (requeueError) {
					const detail = requeueError instanceof Error ? requeueError.message : String(requeueError);
					emit("consolidation", {
						type: detail.includes("cancellation was reconciled before dispatch retry") ? "progress" : "error",
						date,
						phase: "research-dispatch",
						detail,
					});
				}
			}
		return true;
	}
}
