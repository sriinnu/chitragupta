/**
 * Built-in orchestration strategies — assignment, decomposition, and
 * coordination algorithms used by the Orchestrator.
 */

import type { AgentSlot, OrchestratorTask, TaskMetrics, TaskResult } from "./types.js";
import { jaccardSimilarity } from "./router.js";

// ─── Slot Statistics (used by strategies) ────────────────────────────────────

/** Per-slot statistics used for load-aware assignment. */
export interface SlotStats {
	slotId: string;
	runningTasks: number;
	queuedTasks: number;
	completedTasks: number;
}

// ─── Round Robin ─────────────────────────────────────────────────────────────

/**
 * Assign to next slot in rotation.
 *
 * @param slots - Available agent slots.
 * @param _task - The task (unused, kept for API consistency).
 * @param counter - Mutable counter object tracking the current rotation index.
 * @returns The selected slot ID.
 * @throws If no slots are available.
 */
export function roundRobinAssign(
	slots: AgentSlot[],
	_task: OrchestratorTask,
	counter: { value: number },
): string {
	if (slots.length === 0) {
		throw new Error("No slots available for round-robin assignment");
	}
	const index = counter.value % slots.length;
	counter.value++;
	return slots[index].id;
}

// ─── Least Loaded ────────────────────────────────────────────────────────────

/**
 * Pick the slot with fewest running tasks. Ties broken by fewest queued tasks.
 *
 * @param slots - Available agent slots.
 * @param slotStats - Map of slot ID to running/queued task counts.
 * @returns The selected slot ID.
 * @throws If no slots are available.
 */
export function leastLoadedAssign(
	slots: AgentSlot[],
	slotStats: Map<string, SlotStats>,
): string {
	if (slots.length === 0) {
		throw new Error("No slots available for least-loaded assignment");
	}

	let bestSlot = slots[0].id;
	let bestRunning = Infinity;
	let bestQueued = Infinity;

	for (const slot of slots) {
		const stats = slotStats.get(slot.id);
		const running = stats?.runningTasks ?? 0;
		const queued = stats?.queuedTasks ?? 0;

		if (running < bestRunning || (running === bestRunning && queued < bestQueued)) {
			bestSlot = slot.id;
			bestRunning = running;
			bestQueued = queued;
		}
	}

	return bestSlot;
}

// ─── Specialized ─────────────────────────────────────────────────────────────

/**
 * Match task to the slot with best capability overlap using Jaccard similarity.
 *
 * Falls back to the first slot if no capability hints are extracted from the task.
 *
 * @param slots - Available agent slots with capabilities arrays.
 * @param task - The task to match.
 * @returns The selected slot ID.
 * @throws If no slots are available.
 */
export function specializedAssign(
	slots: AgentSlot[],
	task: OrchestratorTask,
): string {
	if (slots.length === 0) {
		throw new Error("No slots available for specialized assignment");
	}

	// Extract capability hints from the task
	const taskCapabilities = extractCapabilities(task);
	if (taskCapabilities.length === 0) {
		return slots[0].id;
	}

	let bestSlot = slots[0].id;
	let bestSimilarity = -1;

	for (const slot of slots) {
		const similarity = jaccardSimilarity(taskCapabilities, slot.capabilities);
		if (similarity > bestSimilarity) {
			bestSimilarity = similarity;
			bestSlot = slot.id;
		}
	}

	return bestSlot;
}

/**
 * Extract capability hints from a task's description and metadata.
 */
function extractCapabilities(task: OrchestratorTask): string[] {
	const capabilities: string[] = [];
	const desc = task.description.toLowerCase();

	// Map keywords to capabilities
	const keywordMap: Record<string, string> = {
		"test": "testing",
		"spec": "testing",
		"review": "code-review",
		"refactor": "refactoring",
		"document": "documentation",
		"docs": "documentation",
		"fix": "debugging",
		"bug": "debugging",
		"debug": "debugging",
		"write": "code-writing",
		"implement": "code-writing",
		"create": "code-writing",
		"analyze": "analysis",
		"performance": "optimization",
		"optimize": "optimization",
		"security": "security",
		"deploy": "devops",
		"ci": "devops",
		"css": "frontend",
		"html": "frontend",
		"ui": "frontend",
		"api": "backend",
		"database": "backend",
		"sql": "backend",
	};

	for (const [keyword, capability] of Object.entries(keywordMap)) {
		if (desc.includes(keyword)) {
			capabilities.push(capability);
		}
	}

	// Also include the task type as a capability hint
	capabilities.push(task.type);

	return [...new Set(capabilities)];
}

// ─── Hierarchical Decompose ──────────────────────────────────────────────────

/**
 * Break a complex task into sub-tasks for a tree of agents.
 *
 * Splits on "then" for sequential steps and "and" for parallel sub-tasks.
 * Returns the original task if no decomposition is possible.
 *
 * @param task - The parent task to decompose.
 * @param depth - How deep to decompose (1 = single level, 2 = nested). Default 1.
 * @returns Array of child tasks with appropriate dependencies.
 */
export function hierarchicalDecompose(
	task: OrchestratorTask,
	depth: number = 1,
): OrchestratorTask[] {
	if (depth <= 0) return [task];

	const subtasks: OrchestratorTask[] = [];
	const desc = task.description;

	// Split on "and" for parallel tasks, "then" for sequential
	const sequentialParts = desc.split(/\s+then\s+/i).map((s) => s.trim()).filter(Boolean);

	let previousId: string | undefined;

	for (let i = 0; i < sequentialParts.length; i++) {
		const part = sequentialParts[i];
		// Further split on "and" for parallel sub-tasks within a sequential step
		const parallelParts = part.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);

		const stepIds: string[] = [];

		for (let j = 0; j < parallelParts.length; j++) {
			const subId = `${task.id}:sub-${i}-${j}`;
			stepIds.push(subId);

			const subtask: OrchestratorTask = {
				id: subId,
				type: inferTaskType(parallelParts[j]),
				description: parallelParts[j],
				context: { ...task.context, parentTask: task.id },
				priority: task.priority,
				dependencies: previousId ? [previousId] : task.dependencies,
				maxRetries: task.maxRetries,
				status: "pending",
				metadata: { ...task.metadata, hierarchyDepth: depth },
			};

			if (depth > 1) {
				// Recursively decompose
				const children = hierarchicalDecompose(subtask, depth - 1);
				subtasks.push(...children);
			} else {
				subtasks.push(subtask);
			}
		}

		// For sequential ordering: next step depends on all parallel tasks of this step
		if (stepIds.length > 0) {
			previousId = stepIds[stepIds.length - 1];
		}
	}

	// If no decomposition happened, return the original task
	if (subtasks.length === 0) {
		return [task];
	}

	return subtasks;
}

/**
 * Infer task type from description text.
 */
function inferTaskType(description: string): OrchestratorTask["type"] {
	const lower = description.toLowerCase();
	if (/\b(tests?|specs?|assert)\b/.test(lower)) return "test";
	if (/\b(reviews?|check|inspect)\b/.test(lower)) return "review";
	if (/\b(refactor|restructure|clean)\b/.test(lower)) return "refactor";
	if (/\b(analyze|investigate|examine|diagnose)\b/.test(lower)) return "analyze";
	if (/\b(fix|implement|write|create|build|add)\b/.test(lower)) return "prompt";
	return "custom";
}

// ─── Competitive Race ────────────────────────────────────────────────────────

/**
 * Assign the same task to N agents for competitive execution.
 *
 * The orchestrator should take the first completion and cancel the rest.
 *
 * @param slots - Available agent slots.
 * @param _task - The task to race (unused, kept for API consistency).
 * @param count - Number of agents to race (default 2).
 * @returns Array of selected slot IDs.
 * @throws If no slots are available.
 */
export function competitiveRace(
	slots: AgentSlot[],
	_task: OrchestratorTask,
	count: number = 2,
): string[] {
	if (slots.length === 0) {
		throw new Error("No slots available for competitive race");
	}

	const racers = Math.min(count, slots.length);
	// Select the first N slots (could be improved with random selection)
	return slots.slice(0, racers).map((s) => s.id);
}

// ─── Swarm Coordinate ────────────────────────────────────────────────────────

/** Shared context for swarm coordination. */
export interface SwarmContext {
	taskId: string;
	contributions: Map<string, TaskResult>;
	sharedNotes: string[];
}

/**
 * All agents work on the same task with shared context.
 *
 * @param slots - Available agent slots.
 * @param task - The task for all agents to work on.
 * @param _sharedContext - Whether to enable shared context (default true).
 * @returns An object with `slotIds` and the initialized `context`.
 * @throws If no slots are available.
 */
export function swarmCoordinate(
	slots: AgentSlot[],
	task: OrchestratorTask,
	_sharedContext: boolean = true,
): { slotIds: string[]; context: SwarmContext } {
	if (slots.length === 0) {
		throw new Error("No slots available for swarm coordination");
	}

	const context: SwarmContext = {
		taskId: task.id,
		contributions: new Map(),
		sharedNotes: [],
	};

	return {
		slotIds: slots.map((s) => s.id),
		context,
	};
}

/**
 * Merge results from multiple swarm agents into a combined result.
 *
 * Successful results are concatenated with separator lines. Metrics are
 * aggregated across all successful results.
 *
 * @param results - Array of task results from swarm agents.
 * @returns A single merged result. Fails if all agents failed.
 */
export function mergeSwarmResults(results: TaskResult[]): TaskResult {
	const successful = results.filter((r) => r.success);
	if (successful.length === 0) {
		return {
			success: false,
			output: "All swarm agents failed",
			error: results.map((r) => r.error).filter(Boolean).join("; "),
		};
	}

	const mergedOutput = successful.map((r) => r.output).join("\n\n---\n\n");
	const mergedArtifacts = successful.flatMap((r) => r.artifacts ?? []);
	const totalMetrics: TaskMetrics | undefined = successful[0].metrics ? {
		startTime: Math.min(...successful.map((r) => r.metrics?.startTime ?? Infinity)),
		endTime: Math.max(...successful.map((r) => r.metrics?.endTime ?? 0)),
		tokenUsage: successful.reduce((sum, r) => sum + (r.metrics?.tokenUsage ?? 0), 0),
		cost: successful.reduce((sum, r) => sum + (r.metrics?.cost ?? 0), 0),
		toolCalls: successful.reduce((sum, r) => sum + (r.metrics?.toolCalls ?? 0), 0),
		retries: successful.reduce((sum, r) => sum + (r.metrics?.retries ?? 0), 0),
	} : undefined;

	return {
		success: true,
		output: mergedOutput,
		artifacts: [...new Set(mergedArtifacts)],
		metrics: totalMetrics,
	};
}
