/**
 * Operator-facing HTTP routes for daemon-owned agent task checkpoints.
 * @module http-routes-agent-tasks
 */

import type { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps } from "./http-server-types.js";
import { getDaemonTaskCheckpoint, listDaemonTaskCheckpoints } from "./runtime-daemon-task-checkpoints.js";
import { errorResponse, okResponse } from "./server-response.js";

const TASK_STATUSES = new Set(["active", "completed", "aborted", "error"] as const);

type TaskCheckpointStatus = "active" | "completed" | "aborted" | "error";

function parseTaskCheckpointStatus(value: string | undefined): TaskCheckpointStatus | undefined {
	return value && TASK_STATUSES.has(value as TaskCheckpointStatus)
		? value as TaskCheckpointStatus
		: undefined;
}

function parseTaskCheckpointLimit(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Mount daemon-first task-checkpoint routes so operators can inspect where a
 * long-running agent task stopped before retrying from scratch.
 */
export function mountAgentTaskCheckpointRoutes(
	server: ChitraguptaServer,
	deps: ApiDeps,
): void {
	server.route("GET", "/api/agent/tasks/checkpoints", async (req) => {
		try {
			const checkpoints = await listDaemonTaskCheckpoints({
				projectPath:
					typeof req.query.project === "string" && req.query.project.trim().length > 0
						? req.query.project
						: deps.getProjectPath?.(),
				status: parseTaskCheckpointStatus(req.query.status),
				taskType: typeof req.query.taskType === "string" ? req.query.taskType : undefined,
				sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
				limit: parseTaskCheckpointLimit(req.query.limit),
			});
			return {
				status: 200,
				body: okResponse({ checkpoints }, { count: checkpoints.length }),
			};
		} catch (err) {
			return {
				status: 500,
				body: errorResponse(`Failed to list task checkpoints: ${(err as Error).message}`),
			};
		}
	});

	server.route("GET", "/api/agent/tasks/checkpoints/:taskKey", async (req) => {
		try {
			const projectPath =
				typeof req.query.project === "string" && req.query.project.trim().length > 0
					? req.query.project
					: deps.getProjectPath?.();
			if (!projectPath) {
				return {
					status: 400,
					body: errorResponse("Missing project query parameter and no default project path is available"),
				};
			}

			const result = await getDaemonTaskCheckpoint({
				projectPath,
				taskKey: req.params.taskKey,
			});
			if (!result.checkpoint) {
				return {
					status: 404,
					body: errorResponse(`Task checkpoint not found: ${req.params.taskKey}`),
				};
			}

			return {
				status: 200,
				body: okResponse(result),
			};
		} catch (err) {
			return {
				status: 500,
				body: errorResponse(`Failed to load task checkpoint: ${(err as Error).message}`),
			};
		}
	});
}
