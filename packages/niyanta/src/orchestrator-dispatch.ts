/**
 * Orchestrator dispatch — types, constants, error class, and extracted
 * helper functions for the Orchestrator class.
 *
 * Keeps the main orchestrator.ts under the 450 LOC limit.
 */

import { ChitraguptaError } from "@chitragupta/core";
import type { AgentProfile } from "@chitragupta/core";
import type {
	AgentInfo, AgentSlot, FallbackConfig, OrchestratorEvent,
	OrchestratorStats, OrchestratorTask, TaskResult,
} from "./types.js";
import type { AgentInstance } from "./orchestrator-scaling.js";
import type { SwarmContext } from "./strategies.js";
import {
	cancelRaceSiblings,
	collectSwarmResult,
	checkPlanCompletion,
	handleTaskFailure,
	applyFallback,
} from "./orchestrator-scaling.js";

// ─── Duck-typed external interfaces (avoid phantom deps) ────────────────────

/** Duck-typed ActorSystem from @chitragupta/sutra. */
export interface OrchestratorActorSystem { [key: string]: unknown }
/** Duck-typed Samiti from @chitragupta/sutra. */
export interface OrchestratorSamiti { [key: string]: unknown }
/** Duck-typed ProviderDefinition from @chitragupta/swara. */
export interface OrchestratorProviderDef { [key: string]: unknown }
/** Duck-typed Agent from @chitragupta/anina. */
export interface OrchestratorRealAgent { [key: string]: unknown }

// ─── Priority Queue ─────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = {
	critical: 0, high: 1, normal: 2, low: 3, background: 4,
};

/** Compare tasks by priority then deadline for queue ordering. */
export function compareTasks(a: OrchestratorTask, b: OrchestratorTask): number {
	const pa = PRIORITY_ORDER[a.priority] ?? 2;
	const pb = PRIORITY_ORDER[b.priority] ?? 2;
	if (pa !== pb) return pa - pb;
	return (a.deadline ?? Infinity) - (b.deadline ?? Infinity);
}

// ─── Error ──────────────────────────────────────────────────────────────────

/** Error class for orchestrator-specific failures. */
export class OrchestratorError extends ChitraguptaError {
	constructor(message: string) {
		super(message, "ORCHESTRATOR_ERROR");
		this.name = "OrchestratorError";
	}
}

// ─── Agent Config ───────────────────────────────────────────────────────────

/** Optional configuration for wiring the orchestrator to real agent instances. */
export interface OrchestratorAgentConfig {
	actorSystem?: OrchestratorActorSystem;
	samiti?: OrchestratorSamiti;
	provider?: OrchestratorProviderDef;
	defaultProfile?: AgentProfile;
	defaultModel?: string;
	defaultProviderId?: string;
	agentFactory?: (slotId: string, slot: AgentSlot) => Promise<OrchestratorRealAgent | null> | OrchestratorRealAgent | null;
	taskExecutor?: (agent: OrchestratorRealAgent, task: OrchestratorTask) => Promise<TaskResult>;
}

// ─── Computed Helpers ───────────────────────────────────────────────────────

/** Compute orchestrator statistics from task/agent state. */
export function computeOrchestratorStats(
	tasks: Map<string, OrchestratorTask>, agents: Map<string, AgentInstance>,
	totalCost: number, totalTokens: number, completionTimes: number[],
): OrchestratorStats {
	let pending = 0, running = 0, completed = 0, failed = 0;
	for (const task of tasks.values()) {
		switch (task.status) {
			case "pending": case "queued": pending++; break;
			case "assigned": case "running": case "retrying": running++; break;
			case "completed": completed++; break;
			case "failed": case "cancelled": failed++; break;
			default: pending++; break;
		}
	}
	const avgLatency = completionTimes.length > 0
		? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length : 0;
	const elapsed = completionTimes.length > 1
		? (Math.max(...completionTimes) - Math.min(...completionTimes)) / 60000 : 0;
	return {
		totalTasks: tasks.size, pendingTasks: pending, runningTasks: running,
		completedTasks: completed, failedTasks: failed, activeAgents: agents.size,
		totalCost, totalTokens, averageLatency: avgLatency,
		throughput: elapsed > 0 ? completed / elapsed : 0,
	};
}

/** Build AgentInfo array from current agent instances. */
export function getActiveAgentInfos(
	agents: Map<string, AgentInstance>, planAgents: AgentSlot[],
): AgentInfo[] {
	const infos: AgentInfo[] = [];
	for (const agent of agents.values()) {
		const slot = planAgents.find((s) => s.id === agent.slotId);
		infos.push({
			id: agent.id, slotId: agent.slotId, role: slot?.role ?? "unknown",
			currentTask: agent.currentTask, tasksCompleted: agent.tasksCompleted,
			status: agent.status,
		});
	}
	return infos;
}

// ─── Completion / Failure Logic ─────────────────────────────────────────────

/** Callbacks injected by the Orchestrator class. */
export interface CompletionCallbacks {
	emit: (event: OrchestratorEvent) => void;
	freeAgent: (taskId: string) => void;
	cancel: (taskId: string) => boolean;
	processQueue: () => void;
}

/** Mutable metrics bucket passed by reference. */
export interface MetricsBucket {
	totalCost: number;
	totalTokens: number;
	completionTimes: number[];
}

/** Handle task completion: update state, propagate race/swarm, check plan. */
export function handleOrchestratorCompletion(
	taskId: string, result: TaskResult,
	tasks: Map<string, OrchestratorTask>,
	results: Map<string, TaskResult>,
	metrics: MetricsBucket,
	swarmContexts: Map<string, SwarmContext>,
	planId: string, cb: CompletionCallbacks,
): void {
	const task = tasks.get(taskId);
	if (!task) return;
	task.status = "completed";
	task.result = result;
	tasks.set(taskId, task);
	results.set(taskId, result);
	if (result.metrics) {
		metrics.totalCost += result.metrics.cost;
		metrics.totalTokens += result.metrics.tokenUsage;
		metrics.completionTimes.push(result.metrics.endTime - result.metrics.startTime);
	}
	cb.emit({ type: "task:completed", taskId, result });
	cb.freeAgent(taskId);
	const raceParent = task.metadata?.raceParent as string | undefined;
	if (raceParent) cancelRaceSiblings(taskId, raceParent, tasks, results, (id) => cb.cancel(id));
	const swarmParent = task.metadata?.swarmParent as string | undefined;
	if (swarmParent) collectSwarmResult(taskId, swarmParent, result, tasks, results, swarmContexts);
	checkPlanCompletion(tasks, planId, cb.emit);
	cb.processQueue();
}

/** Callbacks injected by the Orchestrator class for failure handling. */
export interface FailureCallbacks {
	emit: (event: OrchestratorEvent) => void;
	freeAgent: (taskId: string) => void;
	enqueue: (task: OrchestratorTask) => void;
	processQueue: () => void;
	stop: () => void;
}

/** Handle task failure: retry, fallback, max-failure check. */
export function handleOrchestratorFailure(
	taskId: string, error: Error,
	tasks: Map<string, OrchestratorTask>,
	results: Map<string, TaskResult>,
	retryCount: Map<string, number>,
	plan: { id: string; fallback?: FallbackConfig; coordination: { maxFailures?: number; tolerateFailures?: boolean } },
	running: boolean, cb: FailureCallbacks,
): void {
	const retried = handleTaskFailure(
		taskId, error, tasks, results, retryCount,
		cb.freeAgent, cb.enqueue, cb.processQueue, cb.emit, running,
	);
	if (retried) return;
	const task = tasks.get(taskId);
	if (task) applyFallback(task, error, plan.fallback, tasks, cb.enqueue, cb.emit);
	const failedCount = [...tasks.values()].filter((t) => t.status === "failed").length;
	if (plan.coordination.maxFailures !== undefined && failedCount >= plan.coordination.maxFailures) {
		cb.emit({ type: "plan:failed", planId: plan.id, error: `Max failures (${plan.coordination.maxFailures}) reached` });
		cb.stop();
		return;
	}
	if (plan.coordination.tolerateFailures) {
		checkPlanCompletion(tasks, plan.id, cb.emit);
		cb.processQueue();
	} else {
		cb.emit({ type: "plan:failed", planId: plan.id, error: error.message });
		cb.stop();
	}
}
