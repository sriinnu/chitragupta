/**
 * Workflow API Routes — REST endpoints for Vayu DAG engine.
 *
 * Mounts onto the existing ChitraguptaServer via `server.route()`.
 * Returns JSON responses for CLI, Vaayu, and external consumers.
 */

import type { Workflow, WorkflowExecution, StepExecution } from "@chitragupta/vayu";

// Duck-typed server to avoid hard import dependency
interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
		}) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>,
	): void;
}

/** Serialized execution (Maps converted to plain objects). */
interface SerializedExecution {
	workflowId: string;
	executionId: string;
	status: string;
	startTime: number;
	endTime?: number;
	steps: Record<string, StepExecution>;
	context: Record<string, unknown>;
}

function serializeExecution(exec: WorkflowExecution): SerializedExecution {
	const steps: Record<string, StepExecution> = {};
	for (const [id, step] of exec.steps) {
		steps[id] = step;
	}
	return {
		workflowId: exec.workflowId,
		executionId: exec.executionId,
		status: exec.status,
		startTime: exec.startTime,
		endTime: exec.endTime,
		steps,
		context: exec.context,
	};
}

/**
 * Mount all workflow API routes onto the server.
 *
 * @param server - ChitraguptaServer instance
 */
export function mountWorkflowRoutes(server: ServerLike): void {

	// ─── GET /api/workflows ──────────────────────────────────────────
	// List all available workflows (built-in templates + saved custom).
	server.route("GET", "/api/workflows", async () => {
		try {
			const {
				listChitraguptaWorkflows,
				listWorkflows: listSavedWorkflows,
			} = await import("@chitragupta/vayu");

			const builtIn = listChitraguptaWorkflows().map((w) => ({
				...w,
				source: "built-in" as const,
			}));

			const saved = listSavedWorkflows().map((w) => ({
				id: w.id,
				name: w.name,
				description: w.description,
				stepCount: w.steps.length,
				source: "custom" as const,
			}));

			return {
				status: 200,
				body: { workflows: [...builtIn, ...saved] },
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list workflows: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/workflows/executions ────────────────────────────────
	// List recent executions across all workflows.
	// Registered BEFORE :name so "executions" is not captured as a param.
	server.route("GET", "/api/workflows/executions", async (req) => {
		try {
			const {
				listChitraguptaWorkflows,
				listWorkflows: listSavedWorkflows,
				listExecutions,
			} = await import("@chitragupta/vayu");

			const limit = parseInt(req.query.limit ?? "20", 10);

			// Gather workflow IDs from both built-in and saved
			const builtInIds = listChitraguptaWorkflows().map((w) => w.id);
			const savedIds = listSavedWorkflows().map((w) => w.id);
			const allIds = new Set([...builtInIds, ...savedIds]);

			// Collect executions from all workflows
			const allExecutions: SerializedExecution[] = [];
			for (const wfId of allIds) {
				const execs = listExecutions(wfId);
				for (const exec of execs) {
					allExecutions.push(serializeExecution(exec));
				}
			}

			// Sort by start time (newest first) and limit
			allExecutions.sort((a, b) => b.startTime - a.startTime);
			const limited = allExecutions.slice(0, limit);

			return {
				status: 200,
				body: {
					executions: limited.map((e) => ({
						executionId: e.executionId,
						workflowId: e.workflowId,
						status: e.status,
						startTime: e.startTime,
						endTime: e.endTime,
						stepCount: Object.keys(e.steps).length,
					})),
					total: allExecutions.length,
				},
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list executions: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/workflows/executions/:id ────────────────────────────
	// Get a specific execution by ID.
	server.route("GET", "/api/workflows/executions/:id", async (req) => {
		try {
			const { loadExecution } = await import("@chitragupta/vayu");
			const exec = loadExecution(req.params.id);

			if (!exec) {
				return {
					status: 404,
					body: { error: `Execution not found: ${req.params.id}` },
				};
			}

			return {
				status: 200,
				body: { execution: serializeExecution(exec) },
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get execution: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/workflows/:name ────────────────────────────────────
	// Get workflow DAG details (steps, dependencies, metadata).
	server.route("GET", "/api/workflows/:name", async (req) => {
		try {
			const {
				getChitraguptaWorkflow,
				loadWorkflow,
				getExecutionLevels,
				getCriticalPath,
			} = await import("@chitragupta/vayu");

			const name = req.params.name;
			const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);

			if (!workflow) {
				return {
					status: 404,
					body: { error: `Workflow not found: ${name}` },
				};
			}

			// Compute execution levels for parallel info
			let levels: string[][] = [];
			let criticalPath: string[] = [];
			try {
				levels = getExecutionLevels(workflow.steps);
				criticalPath = getCriticalPath(workflow.steps, new Map());
			} catch {
				// DAG analysis may fail for invalid graphs
			}

			return {
				status: 200,
				body: {
					workflow: {
						id: workflow.id,
						name: workflow.name,
						description: workflow.description,
						version: workflow.version,
						stepCount: workflow.steps.length,
						steps: workflow.steps.map((s) => ({
							id: s.id,
							name: s.name,
							actionType: s.action.type,
							dependsOn: s.dependsOn,
							tags: s.tags,
							timeout: s.timeout,
							onFailure: s.onFailure,
						})),
						maxConcurrency: workflow.maxConcurrency,
						timeout: workflow.timeout,
					},
					analysis: {
						levels,
						criticalPath,
						parallelSteps: levels.filter((l) => l.length > 1).length,
					},
				},
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get workflow: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/workflows/:name/run ───────────────────────────────
	// Execute a workflow.
	server.route("POST", "/api/workflows/:name/run", async (req) => {
		try {
			const {
				getChitraguptaWorkflow,
				loadWorkflow,
				WorkflowExecutor,
				saveExecution,
			} = await import("@chitragupta/vayu");

			const name = req.params.name;
			const workflow = getChitraguptaWorkflow(name) ?? loadWorkflow(name);

			if (!workflow) {
				return {
					status: 404,
					body: { error: `Workflow not found: ${name}` },
				};
			}

			const body = (req.body ?? {}) as Record<string, unknown>;
			const contextOverrides = (typeof body.context === "object" && body.context !== null)
				? body.context as Record<string, unknown>
				: {};

			// Merge context overrides
			const workflowWithContext: Workflow = {
				...workflow,
				context: { ...workflow.context, ...contextOverrides },
			};

			const executor = new WorkflowExecutor();
			const events: Array<Record<string, unknown>> = [];

			const execution = await executor.execute(
				workflowWithContext,
				(event) => {
					events.push(event as unknown as Record<string, unknown>);
				},
			);

			// Persist execution history
			try {
				saveExecution(execution);
			} catch {
				// Non-fatal: persistence failure should not fail the response
			}

			return {
				status: 200,
				body: {
					execution: serializeExecution(execution),
					events,
				},
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to execute workflow: ${(err as Error).message}` },
			};
		}
	});
}
