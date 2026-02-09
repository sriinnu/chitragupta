/**
 * @chitragupta/niyanta — Orchestrator auto-scaling, failure handling, and
 * strategy-specific processing (competitive, swarm, hierarchical).
 *
 * Extracted from orchestrator.ts to keep file sizes manageable.
 */

import type {
	AgentSlot,
	FallbackConfig,
	OrchestratorEvent,
	OrchestratorTask,
	TaskResult,
} from "./types.js";
import {
	competitiveRace,
	hierarchicalDecompose,
	mergeSwarmResults,
	swarmCoordinate,
} from "./strategies.js";
import type { SlotStats, SwarmContext } from "./strategies.js";

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

	// Emit overloaded if queue is building up
	if (queueDepth > currentCount) {
		emitFn({ type: "agent:overloaded", agentSlot: slotId, queueDepth });
	}

	// Auto-spawn if enabled and under limit
	if (slot.autoScale && currentCount < maxInstances && queueDepth > 0) {
		spawnFn(slotId);
	}
}

// ─── Strategy Processing ─────────────────────────────────────────────────────

/**
 * Process a task using competitive (race) strategy.
 *
 * Spawns copies of the task on multiple slots; the first to complete wins.
 * Each racer task is given a unique ID of the form `{taskId}:race-{slotId}`.
 *
 * @param task - The original task to race.
 * @param agents - All configured agent slots.
 * @param tasks - The global task map (mutated to add racer tasks).
 * @param assignFn - Callback to assign a task to a specific slot.
 */
export function processCompetitive(
	task: OrchestratorTask,
	agents: AgentSlot[],
	tasks: Map<string, OrchestratorTask>,
	assignFn: (task: OrchestratorTask, slotId: string) => void,
): void {
	const raceSlots = competitiveRace(agents, task);
	for (const slotId of raceSlots) {
		const racerTask: OrchestratorTask = {
			...task,
			id: `${task.id}:race-${slotId}`,
			metadata: { ...task.metadata, raceParent: task.id },
		};
		tasks.set(racerTask.id, racerTask);
		assignFn(racerTask, slotId);
	}
}

/**
 * Process a task using swarm strategy.
 *
 * Distributes the task to multiple agents that work collaboratively,
 * sharing a common SwarmContext. Each swarm sub-task gets a unique ID
 * of the form `{taskId}:swarm-{slotId}`.
 *
 * @param task - The original task to distribute.
 * @param agents - All configured agent slots.
 * @param sharedContext - Shared context data for the swarm.
 * @param tasks - The global task map (mutated to add swarm sub-tasks).
 * @param swarmContexts - Map tracking active swarm contexts (mutated).
 * @param assignFn - Callback to assign a task to a specific slot.
 */
export function processSwarm(
	task: OrchestratorTask,
	agents: AgentSlot[],
	sharedContext: unknown,
	tasks: Map<string, OrchestratorTask>,
	swarmContexts: Map<string, SwarmContext>,
	assignFn: (task: OrchestratorTask, slotId: string) => void,
): void {
	const { slotIds, context } = swarmCoordinate(agents, task, sharedContext as boolean | undefined);
	swarmContexts.set(task.id, context);
	for (const slotId of slotIds) {
		const swarmTask: OrchestratorTask = {
			...task,
			id: `${task.id}:swarm-${slotId}`,
			metadata: { ...task.metadata, swarmParent: task.id },
		};
		tasks.set(swarmTask.id, swarmTask);
		assignFn(swarmTask, slotId);
	}
}

/**
 * Process a task using hierarchical decomposition.
 *
 * Breaks a task into subtasks using {@link hierarchicalDecompose}. If the task
 * cannot be decomposed further (single subtask with same ID), it is assigned
 * directly. Otherwise, subtasks are registered and enqueued for processing.
 *
 * @param task - The task to decompose.
 * @param tasks - The global task map (mutated to add subtasks).
 * @param routeFn - Callback to determine which slot should handle a task.
 * @param assignFn - Callback to assign a task to a specific slot.
 * @param enqueueFn - Callback to enqueue a task for processing.
 */
export function processHierarchical(
	task: OrchestratorTask,
	tasks: Map<string, OrchestratorTask>,
	routeFn: (task: OrchestratorTask) => string,
	assignFn: (task: OrchestratorTask, slotId: string) => void,
	enqueueFn: (task: OrchestratorTask) => void,
): void {
	const subtasks = hierarchicalDecompose(task, 1);
	if (subtasks.length === 1 && subtasks[0].id === task.id) {
		// No decomposition -- assign directly
		const slotId = routeFn(task);
		assignFn(task, slotId);
	} else {
		for (const subtask of subtasks) {
			tasks.set(subtask.id, subtask);
			enqueueFn(subtask);
		}
	}
}

// ─── Completion & Failure Handling ───────────────────────────────────────────

/**
 * Cancel race siblings when a race sub-task completes (winner take all).
 *
 * Cancels all other racer tasks sharing the same parent, then propagates
 * the winner's result to the parent task.
 *
 * @param winnerId - The task ID of the winning racer.
 * @param raceParent - The parent task ID that originated the race.
 * @param tasks - The global task map (mutated to update parent status).
 * @param results - The global results map (mutated to propagate winner result).
 * @param cancelFn - Callback to cancel a task by ID.
 */
export function cancelRaceSiblings(
	winnerId: string,
	raceParent: string,
	tasks: Map<string, OrchestratorTask>,
	results: Map<string, TaskResult>,
	cancelFn: (taskId: string) => void,
): void {
	for (const [id, task] of tasks) {
		if (id !== winnerId && task.metadata?.raceParent === raceParent) {
			cancelFn(id);
		}
	}
	// Propagate the winner's result to the parent task
	const winnerResult = results.get(winnerId);
	if (winnerResult) {
		const parent = tasks.get(raceParent);
		if (parent) {
			parent.status = "completed";
			parent.result = winnerResult;
			tasks.set(raceParent, parent);
			results.set(raceParent, winnerResult);
		}
	}
}

/**
 * Collect a swarm sub-task result. When all swarm agents are done,
 * merge results and update the parent task.
 *
 * Adds the result to the swarm context's contributions. Once every swarm
 * sub-task has finished (completed, failed, or cancelled), merges all
 * contributions via {@link mergeSwarmResults} and updates the parent task.
 *
 * @param taskId - The swarm sub-task ID that completed.
 * @param swarmParent - The parent task ID that originated the swarm.
 * @param result - The sub-task's result.
 * @param tasks - The global task map (mutated to update parent status).
 * @param results - The global results map (mutated to store merged result).
 * @param swarmContexts - Map tracking active swarm contexts.
 */
export function collectSwarmResult(
	taskId: string,
	swarmParent: string,
	result: TaskResult,
	tasks: Map<string, OrchestratorTask>,
	results: Map<string, TaskResult>,
	swarmContexts: Map<string, SwarmContext>,
): void {
	const context = swarmContexts.get(swarmParent);
	if (!context) return;

	context.contributions.set(taskId, result);

	// Check if all swarm agents are done
	const allSwarmTasks = [...tasks.values()].filter(
		(t) => t.metadata?.swarmParent === swarmParent,
	);
	const allDone = allSwarmTasks.every(
		(t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
	);

	if (allDone) {
		const allResults = [...context.contributions.values()];
		const merged = mergeSwarmResults(allResults);
		const parent = tasks.get(swarmParent);
		if (parent) {
			parent.status = merged.success ? "completed" : "failed";
			parent.result = merged;
			tasks.set(swarmParent, parent);
			results.set(swarmParent, merged);
		}
	}
}

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
		// Retry with backoff
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

	// Max retries exhausted
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
 * @param fallback - Optional fallback configuration with handler and escalation settings.
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

	// Try custom handler first
	if (fallback.handler) {
		const retryTask = fallback.handler(task, error);
		if (retryTask) {
			tasks.set(retryTask.id, retryTask);
			enqueueFn(retryTask);
			return;
		}
	}

	// Escalate to human
	if (fallback.escalateToHuman) {
		emitFn({ type: "escalation", taskId: task.id, reason: error.message });
	}
}

/**
 * Check if the orchestration plan is complete (all top-level tasks finished).
 *
 * Only considers top-level tasks (not race or swarm sub-tasks). When all
 * top-level tasks are in a terminal state (completed, failed, or cancelled),
 * emits a `plan:complete` event with all collected results.
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
