/**
 * Scaling policies — strategy-specific processing and completion handlers.
 *
 * Extracted from orchestrator-scaling.ts. Contains the competitive, swarm,
 * and hierarchical strategy processors plus their completion/cancellation logic.
 */

import type {
	AgentSlot,
	OrchestratorTask,
	TaskResult,
} from "./types.js";
import {
	competitiveRace,
	hierarchicalDecompose,
	mergeSwarmResults,
	swarmCoordinate,
} from "./strategies.js";
import type { SwarmContext } from "./strategies.js";

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
		const slotId = routeFn(task);
		assignFn(task, slotId);
	} else {
		for (const subtask of subtasks) {
			tasks.set(subtask.id, subtask);
			enqueueFn(subtask);
		}
	}
}

// ─── Completion & Cancellation ───────────────────────────────────────────────

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
