/**
 * Krama — DAG-based workflow engine for multi-step orchestration.
 *
 * Sanskrit: Krama (क्रम) = sequential order, systematic arrangement.
 *
 * Executes a directed acyclic graph of tasks where nodes represent units of
 * work and edges represent data/ordering dependencies. Independent nodes at
 * the same topological level execute concurrently via Promise.allSettled.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single node in a DAG workflow. */
export interface DAGNode {
	/** Unique identifier for this node within the workflow. */
	id: string;
	/** Human-readable label describing what this node does. */
	label: string;
	/** IDs of nodes that must complete before this node can execute. */
	dependencies: string[];
	/**
	 * Executor function. Receives a map of dependency outputs keyed by node ID.
	 * The promise should resolve with this node's output value.
	 */
	executor: (input: Map<string, unknown>) => Promise<unknown>;
	/** Optional timeout for this specific node in milliseconds. */
	timeout?: number;
}

/** A complete DAG workflow definition. */
export interface DAGWorkflow {
	/** Unique identifier for this workflow. */
	id: string;
	/** Human-readable workflow name. */
	name: string;
	/** All nodes in the DAG. */
	nodes: DAGNode[];
}

/** Result of executing a DAG workflow. */
export interface DAGExecutionResult {
	/** The workflow that was executed. */
	workflowId: string;
	/** Whether all nodes completed successfully. */
	success: boolean;
	/** Map of node ID to its output value (only for successful nodes). */
	outputs: Map<string, unknown>;
	/** Map of node ID to its error (only for failed nodes). */
	errors: Map<string, Error>;
	/** Total wall-clock duration in milliseconds. */
	duration: number;
}

// ─── DAG Engine ──────────────────────────────────────────────────────────────

/**
 * DAGEngine — validates and executes DAG workflows with concurrent level
 * execution, per-node timeouts, and dependency data passing.
 *
 * @example
 * ```ts
 * const engine = new DAGEngine();
 * const workflow: DAGWorkflow = {
 *   id: "w1", name: "Build pipeline",
 *   nodes: [
 *     { id: "lint", label: "Lint", dependencies: [], executor: async () => "clean" },
 *     { id: "test", label: "Test", dependencies: ["lint"], executor: async (inputs) => {
 *       const lintResult = inputs.get("lint");
 *       return lintResult === "clean" ? "passed" : "skipped";
 *     }},
 *   ],
 * };
 * const { valid } = engine.validate(workflow);
 * if (valid) {
 *   const result = await engine.execute(workflow);
 * }
 * ```
 */
export class DAGEngine {
	/**
	 * Validate a workflow for structural correctness.
	 *
	 * Checks for:
	 * - At least one node
	 * - Unique node IDs
	 * - All dependencies reference existing nodes
	 * - No cycles (via DFS)
	 *
	 * @param workflow - The workflow to validate.
	 * @returns An object with `valid` boolean and an array of error messages.
	 */
	validate(workflow: DAGWorkflow): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		const nodeIds = new Set<string>();

		// Check for empty workflow
		if (workflow.nodes.length === 0) {
			errors.push("Workflow has no nodes");
			return { valid: false, errors };
		}

		// Check for duplicate IDs
		for (const node of workflow.nodes) {
			if (nodeIds.has(node.id)) {
				errors.push(`Duplicate node ID: "${node.id}"`);
			}
			nodeIds.add(node.id);
		}

		// Check for missing dependencies
		for (const node of workflow.nodes) {
			for (const dep of node.dependencies) {
				if (!nodeIds.has(dep)) {
					errors.push(`Node "${node.id}" depends on unknown node "${dep}"`);
				}
			}
		}

		// Check for self-dependencies
		for (const node of workflow.nodes) {
			if (node.dependencies.includes(node.id)) {
				errors.push(`Node "${node.id}" depends on itself`);
			}
		}

		// Cycle detection via DFS with 3-coloring
		const cycleErrors = this.detectCycles(workflow.nodes);
		errors.push(...cycleErrors);

		return { valid: errors.length === 0, errors };
	}

	/**
	 * Execute a DAG workflow, running independent nodes concurrently.
	 *
	 * Nodes are grouped into topological levels. All nodes within a level
	 * execute concurrently via Promise.allSettled. A node only executes if
	 * all its dependencies succeeded. Failed dependencies cause dependent
	 * nodes to be skipped with a descriptive error.
	 *
	 * @param workflow - The workflow to execute. Should be validated first.
	 * @returns Execution result with outputs, errors, and duration.
	 */
	async execute(workflow: DAGWorkflow): Promise<DAGExecutionResult> {
		const start = Date.now();
		const outputs = new Map<string, unknown>();
		const errors = new Map<string, Error>();

		const levels = this.getExecutionOrder(workflow);
		const nodeMap = new Map<string, DAGNode>();
		for (const node of workflow.nodes) {
			nodeMap.set(node.id, node);
		}

		for (const level of levels) {
			const levelPromises = level.map(async (nodeId) => {
				const node = nodeMap.get(nodeId);
				if (!node) {
					errors.set(nodeId, new Error(`Node "${nodeId}" not found in workflow`));
					return;
				}

				// Check if all dependencies succeeded
				const failedDeps = node.dependencies.filter((dep) => errors.has(dep) || !outputs.has(dep));
				if (failedDeps.length > 0) {
					errors.set(nodeId, new Error(
						`Skipped: dependencies failed or missing: ${failedDeps.join(", ")}`,
					));
					return;
				}

				// Build input map from dependency outputs
				const input = new Map<string, unknown>();
				for (const dep of node.dependencies) {
					input.set(dep, outputs.get(dep));
				}

				try {
					const result = await this.executeNode(node, input);
					outputs.set(nodeId, result);
				} catch (err) {
					errors.set(nodeId, err instanceof Error ? err : new Error(String(err)));
				}
			});

			await Promise.allSettled(levelPromises);
		}

		return {
			workflowId: workflow.id,
			success: errors.size === 0,
			outputs,
			errors,
			duration: Date.now() - start,
		};
	}

	/**
	 * Compute topological execution order grouped by levels.
	 *
	 * Each inner array contains node IDs that can execute concurrently.
	 * The outer array represents sequential levels — level N+1 nodes depend
	 * on at least one node in a prior level.
	 *
	 * Uses Kahn's algorithm (BFS-based topological sort).
	 *
	 * @param workflow - The workflow to compute order for.
	 * @returns Array of levels, each containing node IDs.
	 */
	getExecutionOrder(workflow: DAGWorkflow): string[][] {
		const nodeIds = new Set(workflow.nodes.map((n) => n.id));
		const adjacency = new Map<string, string[]>();
		const inDegree = new Map<string, number>();

		// Initialize
		for (const node of workflow.nodes) {
			adjacency.set(node.id, []);
			inDegree.set(node.id, 0);
		}

		// Build adjacency list and in-degree counts
		for (const node of workflow.nodes) {
			for (const dep of node.dependencies) {
				if (nodeIds.has(dep)) {
					const edges = adjacency.get(dep);
					if (edges) edges.push(node.id);
					inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
				}
			}
		}

		const levels: string[][] = [];
		let queue = workflow.nodes
			.filter((n) => (inDegree.get(n.id) ?? 0) === 0)
			.map((n) => n.id);

		while (queue.length > 0) {
			levels.push([...queue]);
			const nextQueue: string[] = [];

			for (const nodeId of queue) {
				const dependents = adjacency.get(nodeId) ?? [];
				for (const dep of dependents) {
					const degree = (inDegree.get(dep) ?? 1) - 1;
					inDegree.set(dep, degree);
					if (degree === 0) {
						nextQueue.push(dep);
					}
				}
			}

			queue = nextQueue;
		}

		return levels;
	}

	/**
	 * Compute the critical path — the longest chain of dependent nodes.
	 *
	 * This determines the minimum possible execution time regardless of
	 * parallelism, as these nodes form a sequential dependency chain.
	 *
	 * Uses dynamic programming on the topological order.
	 *
	 * @param workflow - The workflow to analyze.
	 * @returns Array of node IDs forming the critical path, from start to end.
	 */
	getCriticalPath(workflow: DAGWorkflow): string[] {
		if (workflow.nodes.length === 0) return [];

		const nodeMap = new Map<string, DAGNode>();
		for (const node of workflow.nodes) {
			nodeMap.set(node.id, node);
		}

		// Compute longest path to each node using DP on topological order
		const longestTo = new Map<string, number>();
		const predecessor = new Map<string, string | null>();

		const levels = this.getExecutionOrder(workflow);

		// Initialize all nodes
		for (const node of workflow.nodes) {
			longestTo.set(node.id, 0);
			predecessor.set(node.id, null);
		}

		// Process nodes level by level
		for (const level of levels) {
			for (const nodeId of level) {
				const node = nodeMap.get(nodeId);
				if (!node) continue;

				const currentLength = longestTo.get(nodeId) ?? 0;

				// Update all dependents
				for (const otherNode of workflow.nodes) {
					if (otherNode.dependencies.includes(nodeId)) {
						const newLength = currentLength + 1;
						if (newLength > (longestTo.get(otherNode.id) ?? 0)) {
							longestTo.set(otherNode.id, newLength);
							predecessor.set(otherNode.id, nodeId);
						}
					}
				}
			}
		}

		// Find the node with the longest path
		let endNode = "";
		let maxLength = -1;
		for (const [nodeId, length] of longestTo) {
			if (length > maxLength) {
				maxLength = length;
				endNode = nodeId;
			}
		}

		if (maxLength < 0) return [];

		// Reconstruct path by walking predecessors
		const path: string[] = [];
		let current: string | null = endNode;
		while (current !== null) {
			path.unshift(current);
			current = predecessor.get(current) ?? null;
		}

		return path;
	}

	// ─── Internal Helpers ────────────────────────────────────────────────────

	/**
	 * Execute a single node with optional timeout.
	 * Uses Promise.race against a timeout if the node specifies one.
	 */
	private async executeNode(node: DAGNode, input: Map<string, unknown>): Promise<unknown> {
		if (!node.timeout || node.timeout <= 0) {
			return node.executor(input);
		}

		let timer: ReturnType<typeof setTimeout>;

		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				reject(new Error(`Node "${node.id}" timed out after ${node.timeout}ms`));
			}, node.timeout);
		});

		try {
			return await Promise.race([node.executor(input), timeoutPromise]);
		} finally {
			clearTimeout(timer!);
		}
	}

	/**
	 * Detect cycles in the DAG using DFS with three-color marking.
	 *
	 * WHITE (unvisited) → GRAY (in current DFS path) → BLACK (fully explored).
	 * A back-edge to a GRAY node indicates a cycle.
	 */
	private detectCycles(nodes: DAGNode[]): string[] {
		const errors: string[] = [];
		const WHITE = 0, GRAY = 1, BLACK = 2;
		const color = new Map<string, number>();
		const adjacency = new Map<string, string[]>();

		const nodeIds = new Set(nodes.map((n) => n.id));

		for (const node of nodes) {
			color.set(node.id, WHITE);
			// Build adjacency: node -> nodes that depend on it
			// Actually for cycle detection, we need forward edges: dep -> node
			adjacency.set(node.id, []);
		}

		// Forward edges: from dependency to dependent
		for (const node of nodes) {
			for (const dep of node.dependencies) {
				if (nodeIds.has(dep)) {
					const edges = adjacency.get(dep);
					if (edges) edges.push(node.id);
				}
			}
		}

		function dfs(nodeId: string, path: string[]): boolean {
			color.set(nodeId, GRAY);
			path.push(nodeId);

			const neighbors = adjacency.get(nodeId) ?? [];
			for (const neighbor of neighbors) {
				const neighborColor = color.get(neighbor) ?? WHITE;
				if (neighborColor === GRAY) {
					// Found a cycle — extract the cycle from the path
					const cycleStart = path.indexOf(neighbor);
					const cycle = path.slice(cycleStart).concat(neighbor);
					errors.push(`Cycle detected: ${cycle.join(" -> ")}`);
					return true;
				}
				if (neighborColor === WHITE) {
					if (dfs(neighbor, path)) return true;
				}
			}

			path.pop();
			color.set(nodeId, BLACK);
			return false;
		}

		for (const node of nodes) {
			if ((color.get(node.id) ?? WHITE) === WHITE) {
				dfs(node.id, []);
			}
		}

		return errors;
	}
}
