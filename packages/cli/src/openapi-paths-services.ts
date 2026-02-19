/**
 * OpenAPI path definitions for Jobs (Karya) and Skills (Vidya) endpoints.
 *
 * @module openapi-paths-services
 */

import {
	type PathEntries,
	errorResponse,
	jsonResponse,
} from "./openapi-helpers.js";

/** Job queue (Karya) endpoints: list, submit, stats, get, cancel. */
function jobPaths(): PathEntries {
	return {
		"/api/jobs": {
			get: {
				tags: ["jobs"],
				summary: "List jobs",
				description: "Returns all jobs, optionally filtered by status.",
				operationId: "listJobs",
				parameters: [{
					name: "status",
					in: "query",
					required: false,
					description: "Filter by job status",
					schema: { type: "string", enum: ["pending", "running", "completed", "failed", "cancelled"] },
				}],
				responses: {
					"200": jsonResponse("Job list", { type: "object" }),
					"500": errorResponse("Internal error"),
				},
			},
			post: {
				tags: ["jobs"],
				summary: "Submit job",
				description: "Submit a new async job to the queue.",
				operationId: "submitJob",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["message"],
								properties: {
									message: { type: "string", description: "The prompt to execute" },
									metadata: { type: "object", description: "Optional metadata" },
								},
							},
						},
					},
				},
				responses: {
					"202": jsonResponse("Job submitted", { type: "object" }),
					"400": errorResponse("Missing message"),
					"429": errorResponse("Queue full"),
				},
			},
		},
		"/api/jobs/stats": {
			get: {
				tags: ["jobs"],
				summary: "Job queue statistics",
				description: "Returns aggregate statistics for the job queue.",
				operationId: "getJobStats",
				responses: {
					"200": jsonResponse("Queue stats", { type: "object" }),
					"500": errorResponse("Internal error"),
				},
			},
		},
		"/api/jobs/{id}": {
			get: {
				tags: ["jobs"],
				summary: "Get job by ID",
				description: "Returns detailed information about a specific job, including events.",
				operationId: "getJob",
				parameters: [
					{
						name: "id",
						in: "path",
						required: true,
						description: "Job identifier",
						schema: { type: "string" },
					},
					{
						name: "events",
						in: "query",
						required: false,
						description: "Include events (default: true, set to 'false' to exclude)",
						schema: { type: "string", default: "true" },
					},
				],
				responses: {
					"200": jsonResponse("Job details", { type: "object" }),
					"404": errorResponse("Job not found"),
					"500": errorResponse("Internal error"),
				},
			},
		},
		"/api/jobs/{id}/cancel": {
			post: {
				tags: ["jobs"],
				summary: "Cancel job",
				description: "Cancel a pending or running job.",
				operationId: "cancelJob",
				parameters: [{
					name: "id",
					in: "path",
					required: true,
					description: "Job identifier",
					schema: { type: "string" },
				}],
				responses: {
					"200": jsonResponse("Job cancelled", { type: "object" }),
					"404": errorResponse("Job not found"),
					"409": errorResponse("Cannot cancel in current state"),
				},
			},
		},
	};
}

/** Skill ecosystem (Vidya) endpoints: list, learn, evaluate, promote, deprecate. */
function skillPaths(): PathEntries {
	return {
		"/api/skills": {
			get: {
				tags: ["skills"],
				summary: "List all skills",
				description: "Returns reports for all registered skills.",
				operationId: "listSkills",
				responses: {
					"200": jsonResponse("Skill list", { type: "object" }),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
		"/api/skills/ecosystem": {
			get: {
				tags: ["skills"],
				summary: "Ecosystem statistics",
				description: "Returns aggregate statistics for the entire skill ecosystem.",
				operationId: "getSkillEcosystem",
				responses: {
					"200": jsonResponse("Ecosystem stats", { type: "object" }),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
		"/api/skills/compositions": {
			get: {
				tags: ["skills"],
				summary: "List skill compositions",
				description: "Returns all Yoga (skill composition) entries.",
				operationId: "listSkillCompositions",
				responses: {
					"200": jsonResponse("Composition list", { type: "object" }),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
		"/api/skills/learn": {
			post: {
				tags: ["skills"],
				summary: "Learn a skill",
				description: "Trigger Shiksha to learn a new skill from a natural language query.",
				operationId: "learnSkill",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["query"],
								properties: {
									query: { type: "string", description: "Natural language learning query" },
								},
							},
						},
					},
				},
				responses: {
					"200": jsonResponse("Skill learned", { type: "object" }),
					"400": errorResponse("Missing query"),
					"422": jsonResponse("Learning failed", { type: "object" }),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
		"/api/skills/evaluate": {
			post: {
				tags: ["skills"],
				summary: "Evaluate skill lifecycles",
				description: "Run lifecycle evaluation across all skills.",
				operationId: "evaluateSkillLifecycles",
				responses: {
					"200": jsonResponse("Evaluation report", { type: "object" }),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
		"/api/skills/{name}": {
			get: {
				tags: ["skills"],
				summary: "Get skill by name",
				description: "Returns the detailed report for a specific skill.",
				operationId: "getSkill",
				parameters: [{
					name: "name",
					in: "path",
					required: true,
					description: "Skill name",
					schema: { type: "string" },
				}],
				responses: {
					"200": jsonResponse("Skill report", { type: "object" }),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
		"/api/skills/{name}/promote": {
			post: {
				tags: ["skills"],
				summary: "Promote skill",
				description: "Advance a skill to the next lifecycle stage.",
				operationId: "promoteSkill",
				parameters: [{
					name: "name",
					in: "path",
					required: true,
					description: "Skill name",
					schema: { type: "string" },
				}],
				requestBody: {
					required: false,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									reviewer: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": jsonResponse("Skill promoted", { type: "object" }),
					"400": errorResponse("Transition not allowed"),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
		"/api/skills/{name}/deprecate": {
			post: {
				tags: ["skills"],
				summary: "Deprecate skill",
				description: "Mark a skill as deprecated.",
				operationId: "deprecateSkill",
				parameters: [{
					name: "name",
					in: "path",
					required: true,
					description: "Skill name",
					schema: { type: "string" },
				}],
				requestBody: {
					required: false,
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									reason: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": jsonResponse("Skill deprecated", { type: "object" }),
					"400": errorResponse("Transition not allowed"),
					"503": errorResponse("Vidya Orchestrator not available"),
				},
			},
		},
	};
}

/**
 * Build all Jobs and Skills path entries.
 *
 * @returns Combined path entries for job queue and skill ecosystem.
 */
export function buildServicePaths(): PathEntries {
	return {
		...jobPaths(),
		...skillPaths(),
	};
}
