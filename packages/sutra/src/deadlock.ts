/**
 * Deadlock detection and resolution for the CommHub lock system.
 *
 * Builds a wait-for graph from the current lock state and uses DFS-based
 * cycle detection to find deadlocks. Provides strategies for automatic
 * resolution by force-releasing one agent's lock.
 */

import type { CommHub } from "./hub.js";
import type { DeadlockInfo } from "./types.js";

/**
 * Build a wait-for graph from the current lock state.
 *
 * The graph maps each waiting agent to the set of agents it is waiting for.
 * Agent A waits for Agent B if:
 * - Agent A is in the waitQueue of some lock
 * - Agent B holds that lock
 *
 * Returns: Map<waitingAgentId, Set<holdingAgentId>>
 */
function buildWaitForGraph(hub: CommHub): Map<string, Set<string>> {
	const graph = new Map<string, Set<string>>();
	const locks = hub.getLocks();

	for (const lock of locks.values()) {
		const holder = lock.holder;

		for (const waiter of lock.waitQueue) {
			if (!graph.has(waiter)) {
				graph.set(waiter, new Set());
			}
			graph.get(waiter)!.add(holder);
		}
	}

	return graph;
}

/**
 * Detect all deadlock cycles in the current lock state.
 *
 * Uses iterative DFS with three coloring states (white/gray/black).
 * When a gray node is encountered during traversal, a cycle is found
 * and extracted by walking back along the DFS path.
 *
 * @param hub - The CommHub instance to inspect.
 * @returns An array of detected deadlock cycles. Empty if no deadlocks exist.
 *
 * @example
 * ```ts
 * const deadlocks = detectDeadlocks(hub);
 * if (deadlocks.length > 0) {
 *   resolveDeadlock(hub, deadlocks[0], "youngest");
 * }
 * ```
 */
export function detectDeadlocks(hub: CommHub): DeadlockInfo[] {
	const graph = buildWaitForGraph(hub);
	const locks = hub.getLocks();

	if (graph.size === 0) return [];

	const WHITE = 0;
	const GRAY = 1;
	const BLACK = 2;

	const color = new Map<string, number>();
	const parent = new Map<string, string | null>();
	const deadlocks: DeadlockInfo[] = [];
	const foundCycles = new Set<string>();

	// Initialize all nodes as white
	for (const node of graph.keys()) {
		color.set(node, WHITE);
	}
	// Also include nodes that are pointed to but not in the graph keys
	for (const targets of graph.values()) {
		for (const target of targets) {
			if (!color.has(target)) {
				color.set(target, WHITE);
			}
		}
	}

	/**
	 * DFS from a given start node.
	 */
	function dfs(start: string): void {
		const stack: Array<{ node: string; neighbors: string[]; idx: number }> = [];

		color.set(start, GRAY);
		parent.set(start, null);

		const startNeighbors = graph.has(start) ? Array.from(graph.get(start)!) : [];
		stack.push({ node: start, neighbors: startNeighbors, idx: 0 });

		while (stack.length > 0) {
			const frame = stack[stack.length - 1];

			if (frame.idx >= frame.neighbors.length) {
				// Done exploring this node
				color.set(frame.node, BLACK);
				stack.pop();
				continue;
			}

			const neighbor = frame.neighbors[frame.idx];
			frame.idx++;

			const neighborColor = color.get(neighbor) ?? WHITE;

			if (neighborColor === GRAY) {
				// Found a cycle — extract it
				const cycle: string[] = [neighbor];
				for (let i = stack.length - 1; i >= 0; i--) {
					cycle.push(stack[i].node);
					if (stack[i].node === neighbor) break;
				}

				// Normalize: sort the cycle to create a canonical representation
				const cycleKey = [...cycle].sort().join(",");
				if (!foundCycles.has(cycleKey)) {
					foundCycles.add(cycleKey);

					// Find the resources involved in this cycle
					const resources = findResourcesForCycle(cycle, locks);

					deadlocks.push({ cycle, resources });
				}
			} else if (neighborColor === WHITE) {
				color.set(neighbor, GRAY);
				parent.set(neighbor, frame.node);

				const neighborNeighbors = graph.has(neighbor) ? Array.from(graph.get(neighbor)!) : [];
				stack.push({ node: neighbor, neighbors: neighborNeighbors, idx: 0 });
			}
			// BLACK nodes are already fully explored — skip
		}
	}

	// Run DFS from every unvisited node
	for (const node of color.keys()) {
		if (color.get(node) === WHITE) {
			dfs(node);
		}
	}

	return deadlocks;
}

/**
 * Find the resources involved in a deadlock cycle.
 */
function findResourcesForCycle(
	cycle: string[],
	locks: ReadonlyMap<string, { holder: string; waitQueue: string[] }>,
): string[] {
	const resources: string[] = [];
	const cycleSet = new Set(cycle);

	for (const [resource, lock] of locks) {
		if (cycleSet.has(lock.holder)) {
			// Check if any waiter in the cycle is waiting for this resource
			for (const waiter of lock.waitQueue) {
				if (cycleSet.has(waiter)) {
					resources.push(resource);
					break;
				}
			}
		}
	}

	return resources;
}

/**
 * Resolve a deadlock by force-releasing one agent's lock.
 *
 * @param hub - The CommHub instance.
 * @param deadlock - The detected deadlock cycle to resolve.
 * @param strategy - Resolution strategy: "youngest", "lowest-priority", or "random".
 * @returns The agent ID whose lock was force-released.
 * @throws If the cycle or resources array is empty.
 */
export function resolveDeadlock(
	hub: CommHub,
	deadlock: DeadlockInfo,
	strategy: "youngest" | "lowest-priority" | "random" = "youngest",
): string {
	if (deadlock.cycle.length === 0) {
		throw new Error("Cannot resolve an empty deadlock cycle.");
	}

	if (deadlock.resources.length === 0) {
		throw new Error("Cannot resolve a deadlock with no resources.");
	}

	const locks = hub.getLocks();
	let victimAgent: string;
	let victimResource: string;

	switch (strategy) {
		case "youngest": {
			// Find the lock acquired most recently among cycle agents
			let latestTime = -1;
			victimAgent = deadlock.cycle[0];
			victimResource = deadlock.resources[0];

			for (const resource of deadlock.resources) {
				const lock = locks.get(resource);
				if (lock && deadlock.cycle.includes(lock.holder) && lock.acquiredAt > latestTime) {
					latestTime = lock.acquiredAt;
					victimAgent = lock.holder;
					victimResource = resource;
				}
			}
			break;
		}

		case "lowest-priority": {
			// Use the first agent in the cycle (deterministic)
			victimAgent = deadlock.cycle[0];
			// Find a resource held by this agent
			victimResource = deadlock.resources[0];
			for (const resource of deadlock.resources) {
				const lock = locks.get(resource);
				if (lock && lock.holder === victimAgent) {
					victimResource = resource;
					break;
				}
			}
			break;
		}

		case "random": {
			// Pick a random resource from the cycle
			const idx = Math.floor(Math.random() * deadlock.resources.length);
			victimResource = deadlock.resources[idx];
			const lock = locks.get(victimResource);
			victimAgent = lock ? lock.holder : deadlock.cycle[0];
			break;
		}
	}

	// Force release the victim's lock
	hub.forceReleaseLock(victimResource);

	return victimAgent;
}
