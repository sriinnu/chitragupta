/**
 * @chitragupta/niyanta — Orchestrator auto-scaling, failure handling,
 * and agent lifecycle helpers.
 *
 * Strategy-specific processing (competitive, swarm, hierarchical) and
 * their completion handlers live in scaling-policies.ts and are re-exported
 * here for backward compatibility.
 */

import type {
	AgentSlot,
	FallbackConfig,
	OrchestratorEvent,
	OrchestratorTask,
	TaskResult,
} from "./types.js";
import type { SlotStats } from "./strategies.js";

// Re-export strategy processing & completion from scaling-policies.ts
export {
	processCompetitive,
	processSwarm,
	processHierarchical,
	cancelRaceSiblings,
	collectSwarmResult,
} from "./scaling-policies.js";

// ─── Agent Instance Tracking ─────────────────────────────────────────────────

export interface AgentInstance {
	id: string;
	slotId: string;
	currentTask?: string;
	tasksCompleted: number;
	status: "idle" | "busy" | "overloaded";
}

// ─── Auto-Scaling ────────────────────────────────────────────────────────────

/**
 * Check if a slot should auto-scale and spawn a new agent if needed.
 *
 * Emits an `agent:overloaded` event when queue depth exceeds the current
 * agent count, and spawns a new agent if auto-scaling is enabled and the
 * slot has not reached its maximum instance limit.
 *
 * @param slotId - The agent slot identifier to check.
 * @param agents - All configured agent slots.
 * @param slotQueues - Map of slot ID to queued tasks.
 * @param slotAgents - Map of slot ID to active agent instance IDs.
 * @param spawnFn - Callback to spawn a new agent for the given slot.
 * @param emitFn - Callback to emit orchestrator events.
 */
export function checkAutoScale(
	slotId: string,
	agents: AgentSlot[],
	slotQueues: Map<string, OrchestratorTask[]>,
	slotAgents: Map<string, Set<string>>,
	spawnFn: (slotId: string) => void,
	emitFn: (event: OrchestratorEvent) => void,
): void {
	const slot = agents.find((s) => s.id === slotId);
	if (!slot) return;

	const queueDepth = slotQueues.get(slotId)?.length ?? 0;
	const currentCount = slotAgents.get(slotId)?.size ?? 0;
	const maxInstances = slot.maxInstances ?? Infinity;

	if (queueDepth > currentCount) {
		emitFn({ type: "agent:overloaded", agentSlot: slotId, queueDepth });
	}

	if (slot.autoScale && currentCount < maxInstances && queueDepth > 0) {
		spawnFn(slotId);
	}
}

// ─── Failure Handling ────────────────────────────────────────────────────────

/**
 * Handle task failure with retry/backoff logic and fallback application.
 *
 * If the task has remaining retries, it is re-enqueued with exponential
 * backoff (capped at 30 seconds). Otherwise, the task is marked as failed
 * and a `task:failed` event is emitted.
 *
 * @param taskId - The failed task's ID.
 * @param error - The error that caused the failure.
 * @param tasks - The global task map (mutated to update task status).
 * @param results - The global results map (mutated on permanent failure).
 * @param retryCount - Map tracking retry counts per task ID (mutated).
 * @param freeAgentFn - Callback to release the agent assigned to this task.
 * @param enqueueFn - Callback to re-enqueue a task for retry.
 * @param processQueueFn - Callback to trigger queue processing after retry.
 * @param emitFn - Callback to emit orchestrator events.
 * @param running - Whether the orchestrator is currently running.
 * @returns `true` if the task will be retried, `false` if retries are exhausted.
 */
export function handleTaskFailure(
	taskId: string,
	error: Error,
	tasks: Map<string, OrchestratorTask>,
	results: Map<string, TaskResult>,
	retryCount: Map<string, number>,
	freeAgentFn: (taskId: string) => void,
	enqueueFn: (task: OrchestratorTask) => void,
	processQueueFn: () => void,
	emitFn: (event: OrchestratorEvent) => void,
	running: boolean,
): boolean {
	const task = tasks.get(taskId);
	if (!task) return false;

	const retries = retryCount.get(taskId) ?? 0;
	const maxRetries = task.maxRetries ?? 0;

	if (retries < maxRetries) {
		retryCount.set(taskId, retries + 1);
		task.status = "retrying";
		tasks.set(taskId, task);
		emitFn({ type: "task:retry", taskId, attempt: retries + 1 });

		freeAgentFn(taskId);
		const backoffMs = Math.min(1000 * Math.pow(2, retries), 30000);
		setTimeout(() => {
			if (running) {
				enqueueFn(task);
				processQueueFn();
			}
		}, backoffMs);
		return true;
	}

	task.status = "failed";
	task.result = { success: false, output: "", error: error.message };
	tasks.set(taskId, task);
	results.set(taskId, task.result);

	emitFn({ type: "task:failed", taskId, error: error.message });
	freeAgentFn(taskId);
	return false;
}

/**
 * Apply fallback configuration when a task fails permanently.
 *
 * First attempts the custom fallback handler. If the handler returns a
 * retry task, it is registered and enqueued. If no handler succeeds and
 * `escalateToHuman` is enabled, an `escalation` event is emitted.
 *
 * @param task - The permanently failed task.
 * @param error - The error that caused the failure.
 * @param fallback - Optional fallback configuration.
 * @param tasks - The global task map (mutated if a retry task is created).
 * @param enqueueFn - Callback to enqueue a retry task.
 * @param emitFn - Callback to emit orchestrator events.
 */
export function applyFallback(
	task: OrchestratorTask,
	error: Error,
	fallback: FallbackConfig | undefined,
	tasks: Map<string, OrchestratorTask>,
	enqueueFn: (task: OrchestratorTask) => void,
	emitFn: (event: OrchestratorEvent) => void,
): void {
	if (!fallback) return;

	if (fallback.handler) {
		const retryTask = fallback.handler(task, error);
		if (retryTask) {
			tasks.set(retryTask.id, retryTask);
			enqueueFn(retryTask);
			return;
		}
	}

	if (fallback.escalateToHuman) {
		emitFn({ type: "escalation", taskId: task.id, reason: error.message });
	}
}

// ─── Plan Completion ─────────────────────────────────────────────────────────

/**
 * Check if the orchestration plan is complete (all top-level tasks finished).
 *
 * Only considers top-level tasks (not race or swarm sub-tasks). When all
 * are in a terminal state, emits a `plan:complete` event.
 *
 * @param tasks - The global task map.
 * @param planId - The orchestration plan ID.
 * @param emitFn - Callback to emit the `plan:complete` event.
 */
export function checkPlanCompletion(
	tasks: Map<string, OrchestratorTask>,
	planId: string,
	emitFn: (event: OrchestratorEvent) => void,
): void {
	const allTasks = [...tasks.values()].filter(
		(t) => !t.metadata?.raceParent && !t.metadata?.swarmParent,
	);

	const allDone = allTasks.every(
		(t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
	);

	if (allDone && allTasks.length > 0) {
		const allResults = allTasks
			.map((t) => t.result)
			.filter((r): r is TaskResult => r !== undefined);
		emitFn({ type: "plan:complete", planId, results: allResults });
	}
}

// ─── Agent Lifecycle Helpers ─────────────────────────────────────────────────

/**
 * Spawn a new agent instance for a given slot.
 *
 * @param slotId - The slot to spawn the agent for.
 * @param agents - Map of agent ID to AgentInstance (mutated).
 * @param slotAgents - Map of slot ID to agent ID sets (mutated).
 * @param emitFn - Callback to emit orchestrator events.
 */
export function spawnAgent(
	slotId: string,
	agents: Map<string, AgentInstance>,
	slotAgents: Map<string, Set<string>>,
	emitFn: (event: OrchestratorEvent) => void,
): void {
	const agentId = `${slotId}:agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const agent: AgentInstance = { id: agentId, slotId, tasksCompleted: 0, status: "idle" };
	agents.set(agentId, agent);
	const slotSet = slotAgents.get(slotId) ?? new Set();
	slotSet.add(agentId);
	slotAgents.set(slotId, slotSet);
	emitFn({ type: "agent:spawned", agentSlot: slotId, agentId });
}

/**
 * Free an agent from its current task and assign the next queued task if any.
 *
 * @param taskId - The task ID that has finished.
 * @param agents - Map of agent ID to AgentInstance (mutated).
 * @param slotQueues - Map of slot ID to queued tasks (mutated).
 * @param tasks - The global task map (mutated to update next task status).
 * @param emitFn - Callback to emit orchestrator events.
 */
export function freeAgent(
	taskId: string,
	agents: Map<string, AgentInstance>,
	slotQueues: Map<string, OrchestratorTask[]>,
	tasks: Map<string, OrchestratorTask>,
	emitFn: (event: OrchestratorEvent) => void,
): void {
	for (const agent of agents.values()) {
		if (agent.currentTask === taskId) {
			agent.currentTask = undefined;
			agent.tasksCompleted++;
			agent.status = "idle";
			emitFn({ type: "agent:idle", agentSlot: agent.slotId, agentId: agent.id });

			const slotQueue = slotQueues.get(agent.slotId);
			if (slotQueue && slotQueue.length > 0) {
				const nextTask = slotQueue.shift()!;
				agent.currentTask = nextTask.id;
				agent.status = "busy";
				nextTask.status = "running";
				tasks.set(nextTask.id, nextTask);
				emitFn({ type: "task:assigned", taskId: nextTask.id, agentId: agent.id });
			}
			break;
		}
	}
}

/**
 * Build slot statistics from current agent state.
 *
 * @param planAgents - The configured agent slots.
 * @param agents - Map of agent ID to AgentInstance.
 * @param slotAgents - Map of slot ID to agent ID sets.
 * @param slotQueues - Map of slot ID to queued tasks.
 * @returns A map of slot ID to SlotStats.
 */
export function buildSlotStats(
	planAgents: AgentSlot[],
	agents: Map<string, AgentInstance>,
	slotAgents: Map<string, Set<string>>,
	slotQueues: Map<string, OrchestratorTask[]>,
): Map<string, SlotStats> {
	const stats = new Map<string, SlotStats>();
	for (const slot of planAgents) {
		let running = 0, completed = 0;
		const agentIds = slotAgents.get(slot.id);
		if (agentIds) {
			for (const agentId of agentIds) {
				const agent = agents.get(agentId);
				if (agent) {
					if (agent.status === "busy") running++;
					completed += agent.tasksCompleted;
				}
			}
		}
		stats.set(slot.id, {
			slotId: slot.id, runningTasks: running,
			queuedTasks: slotQueues.get(slot.id)?.length ?? 0, completedTasks: completed,
		});
	}
	return stats;
}
