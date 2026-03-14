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

type DispatchableResearchLoop = {
	projectPath: string;
	loopKey: string;
	topic: string | null;
	hypothesis: string | null;
	workflowId: string | null;
	workflowContext: Record<string, unknown> | null;
	parentSessionId: string | null;
	sessionLineageKey: string | null;
	attemptNumber?: number | null;
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

async function loadPranaDispatchRuntime(): Promise<PranaDispatchRuntime> {
	return await import(new URL("../../prana/dist/index.js", import.meta.url).href) as PranaDispatchRuntime;
}

let pranaDispatchRuntimeLoader: (() => Promise<PranaDispatchRuntime>) | null = null;
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
 * Requeue a dispatch attempt when the resident scheduler hit a transient loader
 * or executor problem before the loop could reconcile itself durably.
 */
function requeueResearchDispatchAttempt(schedule: DispatchableResearchLoop): void {
	upsertResearchLoopSchedule({
		projectPath: schedule.projectPath,
		loopKey: schedule.loopKey,
		status: "queued",
		availableAt: Date.now() + dispatchRetryBackoffMs(schedule.attemptNumber),
		attemptNumber: (schedule.attemptNumber ?? 0) + 1,
		phase: "dispatch-retry",
	});
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
		return {
			...workflow,
			context: {
			...(workflow.context ?? {}),
			...schedule.workflowContext,
			researchLoopKey: schedule.loopKey,
			researchTopic:
				schedule.topic
				?? (typeof schedule.workflowContext.researchTopic === "string"
					? schedule.workflowContext.researchTopic
					: undefined),
			researchHypothesis:
				schedule.hypothesis
				?? (typeof schedule.workflowContext.researchHypothesis === "string"
					? schedule.workflowContext.researchHypothesis
					: undefined),
			researchParentSessionId:
				schedule.parentSessionId
				?? (typeof schedule.workflowContext.researchParentSessionId === "string"
					? schedule.workflowContext.researchParentSessionId
					: undefined),
				researchSessionLineageKey:
					schedule.sessionLineageKey
					?? (typeof schedule.workflowContext.researchSessionLineageKey === "string"
						? schedule.workflowContext.researchSessionLineageKey
						: undefined),
				researchLeaseOwner:
					typeof schedule.workflowContext.researchLeaseOwner === "string"
						&& schedule.workflowContext.researchLeaseOwner.trim()
						? schedule.workflowContext.researchLeaseOwner.trim()
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
	const [nextSchedule] = listResearchLoopSchedules({ runnableOnly: true, limit: 1 }) as DispatchableResearchLoop[];
	if (!nextSchedule) return false;
	const date = formatDispatchDate();
	try {
		const runtime = await (pranaDispatchRuntimeLoader ?? loadPranaDispatchRuntime)();
		const workflow = buildQueuedResearchWorkflow(nextSchedule, runtime.getChitraguptaWorkflow);
		const leaseOwner =
			typeof workflow.context?.researchLeaseOwner === "string" && workflow.context.researchLeaseOwner.trim()
				? workflow.context.researchLeaseOwner.trim()
				: defaultResearchLeaseOwner();
		const leaseClaim = claimResearchLoopSchedule({
			projectPath: nextSchedule.projectPath,
			loopKey: nextSchedule.loopKey,
			leaseOwner,
			leaseTtlMs: 90_000,
			attemptNumber: nextSchedule.attemptNumber ?? null,
			phase: "resident-dispatch",
		});
		if (!leaseClaim.claimed) {
			emit("consolidation", {
				type: "progress",
				date,
				phase: "research-dispatch",
				detail: `skipped ${nextSchedule.loopKey}; another worker already holds the durable lease`,
			});
			return false;
		}
		emit("consolidation", {
			type: "progress",
			date,
			phase: "research-dispatch",
			detail: `dispatching ${nextSchedule.loopKey} via ${workflow.id}`,
		});
		const executor = new runtime.WorkflowExecutor();
		const execution = await executor.execute(workflow);
		if (!isSuccessfulWorkflowExecutionStatus(execution.status)) {
			const existing = getResearchLoopSchedule(nextSchedule.projectPath, nextSchedule.loopKey);
			if (existing && existing.finishedAt == null) {
				completeResearchLoopSchedule({
					projectPath: nextSchedule.projectPath,
					loopKey: nextSchedule.loopKey,
					stopReason: execution.status === "cancelled" ? "cancelled" : "dispatch-failed",
				});
			}
			emit("consolidation", {
				type: "error",
				date,
				phase: "research-dispatch",
				detail: `dispatch of ${nextSchedule.loopKey} finished with non-success status ${execution.status}`,
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
			const existing = getResearchLoopSchedule(nextSchedule.projectPath, nextSchedule.loopKey);
			if (existing && existing.finishedAt == null) {
				completeResearchLoopSchedule({
					projectPath: nextSchedule.projectPath,
					loopKey: nextSchedule.loopKey,
					stopReason: "dispatch-failed",
				});
			}
		} else {
			requeueResearchDispatchAttempt(nextSchedule);
		}
		emit("consolidation", {
			type: "error",
			date,
			phase: "research-dispatch",
			detail: error instanceof Error ? error.message : String(error),
		});
		return true;
	}
}
