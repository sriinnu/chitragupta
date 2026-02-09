/**
 * @chitragupta/vayu — DAG validation and topological sort.
 *
 * Validates workflow step graphs for cycles, missing references,
 * orphaned steps, and duplicate IDs. Provides topological ordering
 * and parallel execution level computation.
 */

import type { WorkflowStep, StepExecution } from "./types.js";

// ─── DAG Validation ─────────────────────────────────────────────────────────

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate that the given steps form a valid directed acyclic graph (DAG).
 *
 * Checks:
 * - No duplicate step IDs
 * - All `dependsOn` references point to existing steps
 * - No cycles (DFS with white/gray/black coloring)
 * - No orphaned steps (every step is reachable from a root)
 *
 * @param steps - Array of workflow steps to validate.
 * @returns Validation result with a `valid` flag and error messages.
 *
 * @example
 * ```ts
 * const result = validateDAG(workflow.steps);
 * if (!result.valid) {
 *   console.error("DAG errors:", result.errors);
 * }
 * ```
 */
export function validateDAG(steps: WorkflowStep[]): ValidationResult {
	const errors: string[] = [];

	// Check for duplicate IDs
	const idSet = new Set<string>();
	for (const step of steps) {
		if (idSet.has(step.id)) {
			errors.push(`Duplicate step ID: "${step.id}"`);
		}
		idSet.add(step.id);
	}

	// Build lookup map
	const stepMap = new Map<string, WorkflowStep>();
	for (const step of steps) {
		stepMap.set(step.id, step);
	}

	// Check that all dependsOn references exist
	for (const step of steps) {
		for (const dep of step.dependsOn) {
			if (!stepMap.has(dep)) {
				errors.push(`Step "${step.id}" depends on unknown step "${dep}"`);
			}
		}
	}

	// Cycle detection using DFS with coloring
	// WHITE = unvisited, GRAY = in current path, BLACK = fully explored
	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;
	const color = new Map<string, number>();
	for (const step of steps) {
		color.set(step.id, WHITE);
	}

	// Build adjacency list (step -> steps that depend on it)
	const adjacency = new Map<string, string[]>();
	for (const step of steps) {
		if (!adjacency.has(step.id)) {
			adjacency.set(step.id, []);
		}
		for (const dep of step.dependsOn) {
			if (!adjacency.has(dep)) {
				adjacency.set(dep, []);
			}
			adjacency.get(dep)!.push(step.id);
		}
	}

	let hasCycle = false;
	const cyclePath: string[] = [];

	function dfs(nodeId: string): void {
		if (hasCycle) return;

		color.set(nodeId, GRAY);
		cyclePath.push(nodeId);

		const neighbors = adjacency.get(nodeId) || [];
		for (const neighbor of neighbors) {
			const neighborColor = color.get(neighbor);
			if (neighborColor === GRAY) {
				// Found a cycle — extract the cycle portion
				const cycleStart = cyclePath.indexOf(neighbor);
				const cycle = cyclePath.slice(cycleStart);
				cycle.push(neighbor);
				errors.push(`Cycle detected: ${cycle.join(" -> ")}`);
				hasCycle = true;
				return;
			}
			if (neighborColor === WHITE) {
				dfs(neighbor);
				if (hasCycle) return;
			}
		}

		cyclePath.pop();
		color.set(nodeId, BLACK);
	}

	for (const step of steps) {
		if (color.get(step.id) === WHITE) {
			dfs(step.id);
		}
		if (hasCycle) break;
	}

	// Check for orphaned steps (no path from any root)
	// Roots are steps with no dependencies
	const roots = steps.filter((s) => s.dependsOn.length === 0);

	if (roots.length === 0 && steps.length > 0) {
		errors.push("No root steps found (all steps have dependencies — possible cycle)");
	} else {
		const reachable = new Set<string>();
		const queue: string[] = roots.map((r) => r.id);
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (reachable.has(current)) continue;
			reachable.add(current);

			const neighbors = adjacency.get(current) || [];
			for (const neighbor of neighbors) {
				if (!reachable.has(neighbor)) {
					queue.push(neighbor);
				}
			}
		}

		for (const step of steps) {
			if (!reachable.has(step.id)) {
				errors.push(`Orphaned step "${step.id}" is not reachable from any root step`);
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

// ─── Topological Sort (Kahn's Algorithm) ────────────────────────────────────

/**
 * Topological sort using Kahn's algorithm (BFS-based).
 *
 * Returns step IDs in a valid execution order where all dependencies
 * come before their dependents.
 *
 * @param steps - Array of workflow steps.
 * @returns Array of step IDs in topological order.
 * @throws If a cycle is detected (not all steps can be sorted).
 *
 * @example
 * ```ts
 * const order = topologicalSort(workflow.steps);
 * // order = ["lint", "test", "build"]
 * ```
 */
export function topologicalSort(steps: WorkflowStep[]): string[] {
	// Compute in-degrees
	const inDegree = new Map<string, number>();
	for (const step of steps) {
		if (!inDegree.has(step.id)) {
			inDegree.set(step.id, 0);
		}
		for (const dep of step.dependsOn) {
			// dep is a predecessor — the current step has one more in-edge
		}
	}

	// Actually count in-degrees properly
	for (const step of steps) {
		inDegree.set(step.id, step.dependsOn.length);
	}

	// Build adjacency list: dependency -> dependents
	const dependents = new Map<string, string[]>();
	for (const step of steps) {
		if (!dependents.has(step.id)) {
			dependents.set(step.id, []);
		}
		for (const dep of step.dependsOn) {
			if (!dependents.has(dep)) {
				dependents.set(dep, []);
			}
			dependents.get(dep)!.push(step.id);
		}
	}

	// BFS from zero in-degree nodes
	const queue: string[] = [];
	for (const step of steps) {
		if (inDegree.get(step.id) === 0) {
			queue.push(step.id);
		}
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift()!;
		sorted.push(current);

		const deps = dependents.get(current) || [];
		for (const dependent of deps) {
			const newDegree = (inDegree.get(dependent) ?? 0) - 1;
			inDegree.set(dependent, newDegree);
			if (newDegree === 0) {
				queue.push(dependent);
			}
		}
	}

	if (sorted.length !== steps.length) {
		const remaining = steps
			.filter((s) => !sorted.includes(s.id))
			.map((s) => s.id);
		throw new Error(`Cycle detected — unable to sort steps: ${remaining.join(", ")}`);
	}

	return sorted;
}

// ─── Execution Levels ───────────────────────────────────────────────────────

/**
 * Group steps into parallelizable execution levels.
 *
 * Each level contains steps whose dependencies are all satisfied
 * by steps in previous levels. Steps within the same level can
 * execute concurrently.
 *
 * @param steps - Array of workflow steps.
 * @returns Array of levels, where each level is an array of step IDs.
 * @throws If the steps contain a cycle (via topologicalSort).
 *
 * @example
 * ```ts
 * const levels = getExecutionLevels(workflow.steps);
 * // levels = [["lint"], ["unit-tests", "e2e-tests"], ["build"]]
 * ```
 */
export function getExecutionLevels(steps: WorkflowStep[]): string[][] {
	const stepMap = new Map<string, WorkflowStep>();
	for (const step of steps) {
		stepMap.set(step.id, step);
	}

	// Track which level each step is assigned to
	const levelOf = new Map<string, number>();
	const sorted = topologicalSort(steps);

	for (const stepId of sorted) {
		const step = stepMap.get(stepId)!;
		if (step.dependsOn.length === 0) {
			levelOf.set(stepId, 0);
		} else {
			let maxDepLevel = 0;
			for (const dep of step.dependsOn) {
				const depLevel = levelOf.get(dep) ?? 0;
				if (depLevel >= maxDepLevel) {
					maxDepLevel = depLevel + 1;
				}
			}
			levelOf.set(stepId, maxDepLevel);
		}
	}

	// Group by level
	const maxLevel = Math.max(...Array.from(levelOf.values()), 0);
	const levels: string[][] = [];
	for (let i = 0; i <= maxLevel; i++) {
		levels.push([]);
	}

	for (const [stepId, level] of levelOf) {
		levels[level].push(stepId);
	}

	return levels.filter((level) => level.length > 0);
}

// ─── Critical Path ──────────────────────────────────────────────────────────

/**
 * Find the critical path through the DAG -- the longest path by execution time.
 *
 * This identifies bottleneck steps in the workflow. The critical path
 * determines the minimum possible total execution time even with
 * infinite parallelism.
 *
 * @param steps - Array of workflow steps.
 * @param executions - Map of step ID to execution data (for duration information).
 * @returns Array of step IDs forming the critical path from root to leaf.
 */
export function getCriticalPath(
	steps: WorkflowStep[],
	executions: Map<string, StepExecution>,
): string[] {
	const stepMap = new Map<string, WorkflowStep>();
	for (const step of steps) {
		stepMap.set(step.id, step);
	}

	// Build adjacency list: dependency -> dependents
	const dependents = new Map<string, string[]>();
	for (const step of steps) {
		if (!dependents.has(step.id)) {
			dependents.set(step.id, []);
		}
		for (const dep of step.dependsOn) {
			if (!dependents.has(dep)) {
				dependents.set(dep, []);
			}
			dependents.get(dep)!.push(step.id);
		}
	}

	// Compute longest path ending at each node using dynamic programming
	const sorted = topologicalSort(steps);
	const longestTo = new Map<string, number>();
	const predecessor = new Map<string, string | null>();

	for (const stepId of sorted) {
		const exec = executions.get(stepId);
		const duration = exec?.duration ?? 0;
		const step = stepMap.get(stepId)!;

		if (step.dependsOn.length === 0) {
			longestTo.set(stepId, duration);
			predecessor.set(stepId, null);
		} else {
			let maxCost = -1;
			let bestPred: string | null = null;
			for (const dep of step.dependsOn) {
				const depCost = longestTo.get(dep) ?? 0;
				if (depCost > maxCost) {
					maxCost = depCost;
					bestPred = dep;
				}
			}
			longestTo.set(stepId, maxCost + duration);
			predecessor.set(stepId, bestPred);
		}
	}

	// Find the end node with the greatest accumulated cost
	let endNode = sorted[0];
	let maxCost = 0;
	for (const [stepId, cost] of longestTo) {
		if (cost > maxCost) {
			maxCost = cost;
			endNode = stepId;
		}
	}

	// Trace back from end to build the critical path
	const path: string[] = [];
	let current: string | null = endNode;
	while (current !== null) {
		path.unshift(current);
		current = predecessor.get(current) ?? null;
	}

	return path;
}
