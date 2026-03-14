/**
 * OpenAPI path definitions for operator-facing agent task checkpoint endpoints.
 * @module openapi-paths-task-checkpoints
 */

import {
	type PathEntries,
	errorResponse,
	jsonResponse,
	limitParam,
	projectParam,
} from "./openapi-helpers.js";

/**
 * Build path entries for daemon-first task checkpoint inspection.
 */
export function buildTaskCheckpointPaths(): PathEntries {
	return {
		"/api/agent/tasks/checkpoints": {
			get: {
				tags: ["agents"],
				summary: "List task checkpoints",
				description:
					"Returns recent daemon-owned task checkpoints so operators can inspect where " +
					"long-running agent work stopped before resuming it.",
				operationId: "listAgentTaskCheckpoints",
				parameters: [
					projectParam(),
					limitParam(),
					{
						name: "status",
						in: "query",
						required: false,
						description: "Filter by checkpoint status",
						schema: { type: "string", enum: ["active", "completed", "aborted", "error"] },
					},
					{
						name: "taskType",
						in: "query",
						required: false,
						description: "Filter by logical task type",
						schema: { type: "string" },
					},
					{
						name: "sessionId",
						in: "query",
						required: false,
						description: "Filter by canonical session id",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": jsonResponse("Task checkpoint list", { type: "object" }),
					"500": errorResponse("Internal error"),
				},
			},
		},
		"/api/agent/tasks/checkpoints/{taskKey}": {
			get: {
				tags: ["agents"],
				summary: "Get task checkpoint by key",
				description:
					"Returns one durable task checkpoint with its bounded resumeContext and " +
					"machine-usable resumePlan.",
				operationId: "getAgentTaskCheckpoint",
				parameters: [
					{
						name: "taskKey",
						in: "path",
						required: true,
						description: "Logical task checkpoint key",
						schema: { type: "string" },
					},
					projectParam(),
				],
				responses: {
					"200": jsonResponse("Task checkpoint detail", { type: "object" }),
					"400": errorResponse("Missing project path"),
					"404": errorResponse("Task checkpoint not found"),
					"500": errorResponse("Internal error"),
				},
			},
		},
	};
}
