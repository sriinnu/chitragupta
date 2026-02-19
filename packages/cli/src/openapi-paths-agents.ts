/**
 * OpenAPI path definitions for Agent and Memory endpoints.
 *
 * @module openapi-paths-agents
 */

import {
	type PathEntries,
	errorResponse,
	jsonResponse,
} from "./openapi-helpers.js";

/** Agent management endpoints: status, reset, list, tree, spawn, abort, prompt. */
function agentPaths(): PathEntries {
	return {
		"/api/agent/status": {
			get: {
				tags: ["agents"],
				summary: "Agent status",
				description: "Returns the current agent's initialization state, model, and token usage.",
				operationId: "getAgentStatus",
				responses: {
					"200": jsonResponse("Agent status", { type: "object" }),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agent/reset": {
			post: {
				tags: ["agents"],
				summary: "Reset agent state",
				description: "Reset the agent's internal state.",
				operationId: "resetAgent",
				responses: {
					"200": jsonResponse("Agent reset", { type: "object" }),
					"501": errorResponse("Agent does not support reset"),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents": {
			get: {
				tags: ["agents"],
				summary: "List all agents (flat)",
				description: "Returns a flat list of all agents in the tree. Optionally filter by status.",
				operationId: "listAgents",
				parameters: [{
					name: "status",
					in: "query",
					required: false,
					description: "Filter by agent status",
					schema: { type: "string", enum: ["idle", "running", "completed", "aborted", "error"] },
				}],
				responses: {
					"200": jsonResponse("Agent list", { type: "object" }),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents/tree": {
			get: {
				tags: ["agents"],
				summary: "Full agent tree",
				description: "Returns the complete agent tree from the root.",
				operationId: "getAgentTree",
				responses: {
					"200": jsonResponse("Agent tree", { type: "object" }),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents/stats": {
			get: {
				tags: ["agents"],
				summary: "Aggregate agent statistics",
				description: "Returns aggregate statistics across all agents in the tree.",
				operationId: "getAgentStats",
				responses: {
					"200": jsonResponse("Agent statistics", { type: "object" }),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents/{id}": {
			get: {
				tags: ["agents"],
				summary: "Get agent by ID",
				description: "Returns detailed information about a specific agent.",
				operationId: "getAgent",
				parameters: [{
					name: "id",
					in: "path",
					required: true,
					description: "Agent identifier",
					schema: { type: "string" },
				}],
				responses: {
					"200": jsonResponse("Agent details", { type: "object" }),
					"404": errorResponse("Agent not found"),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents/{id}/tree": {
			get: {
				tags: ["agents"],
				summary: "Agent subtree",
				description: "Returns the subtree rooted at the specified agent.",
				operationId: "getAgentSubtree",
				parameters: [{
					name: "id",
					in: "path",
					required: true,
					description: "Agent identifier",
					schema: { type: "string" },
				}],
				responses: {
					"200": jsonResponse("Agent subtree", { type: "object" }),
					"404": errorResponse("Agent not found"),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents/{id}/spawn": {
			post: {
				tags: ["agents"],
				summary: "Spawn sub-agent",
				description: "Spawn a new child agent under the specified parent.",
				operationId: "spawnAgent",
				parameters: [{
					name: "id",
					in: "path",
					required: true,
					description: "Parent agent identifier",
					schema: { type: "string" },
				}],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["purpose"],
								properties: {
									purpose: { type: "string" },
									model: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"201": jsonResponse("Agent spawned", { type: "object" }),
					"400": errorResponse("Missing purpose"),
					"404": errorResponse("Parent agent not found"),
					"409": errorResponse("Spawn limit reached"),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents/{id}/abort": {
			post: {
				tags: ["agents"],
				summary: "Abort agent",
				description: "Abort the specified agent and all its children.",
				operationId: "abortAgent",
				parameters: [{
					name: "id",
					in: "path",
					required: true,
					description: "Agent identifier",
					schema: { type: "string" },
				}],
				responses: {
					"200": jsonResponse("Agent aborted", { type: "object" }),
					"404": errorResponse("Agent not found"),
					"409": errorResponse("Agent already terminated"),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
		"/api/agents/{id}/prompt": {
			post: {
				tags: ["agents"],
				summary: "Prompt specific agent",
				description: "Send a message to a specific agent in the tree.",
				operationId: "promptAgent",
				parameters: [{
					name: "id",
					in: "path",
					required: true,
					description: "Agent identifier",
					schema: { type: "string" },
				}],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["message"],
								properties: {
									message: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": jsonResponse("Agent response", { type: "object" }),
					"400": errorResponse("Missing message"),
					"404": errorResponse("Agent not found"),
					"503": errorResponse("Agent not initialized"),
				},
			},
		},
	};
}

/** Memory CRUD endpoints: scopes, search, read, write, append, delete. */
function memoryPaths(): PathEntries {
	return {
		"/api/memory/scopes": {
			get: {
				tags: ["memory"],
				summary: "List memory scopes",
				description: "Returns all available memory scopes (global, project, agent).",
				operationId: "listMemoryScopes",
				responses: {
					"200": jsonResponse("Scope list", { type: "object" }),
					"500": errorResponse("Internal error"),
				},
			},
		},
		"/api/memory/search": {
			post: {
				tags: ["memory"],
				summary: "Search memory",
				description: "Full-text search across all memory scopes.",
				operationId: "searchMemory",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["query"],
								properties: {
									query: { type: "string", description: "Search query" },
									limit: { type: "integer", default: 20, description: "Max results" },
								},
							},
						},
					},
				},
				responses: {
					"200": jsonResponse("Search results", {
						type: "object",
						properties: {
							results: {
								type: "array",
								items: {
									type: "object",
									properties: {
										content: { type: "string" },
										score: { type: "number" },
										source: { type: "string" },
									},
								},
							},
						},
					}),
					"400": errorResponse("Missing query"),
					"500": errorResponse("Search failed"),
				},
			},
		},
		"/api/memory/{scope}": {
			get: {
				tags: ["memory"],
				summary: "Get memory by scope",
				description: "Read memory content for a specific scope (global, project:<path>, agent:<id>).",
				operationId: "getMemory",
				parameters: [{
					name: "scope",
					in: "path",
					required: true,
					description: "Memory scope identifier",
					schema: { type: "string" },
				}],
				responses: {
					"200": jsonResponse("Memory content", { type: "object" }),
					"400": errorResponse("Invalid scope format"),
					"500": errorResponse("Internal error"),
				},
			},
			put: {
				tags: ["memory"],
				summary: "Update memory",
				description: "Replace the entire memory content for a scope.",
				operationId: "updateMemory",
				parameters: [{
					name: "scope",
					in: "path",
					required: true,
					description: "Memory scope identifier",
					schema: { type: "string" },
				}],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["content"],
								properties: {
									content: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": jsonResponse("Memory updated", { type: "object" }),
					"400": errorResponse("Invalid scope or missing content"),
					"500": errorResponse("Internal error"),
				},
			},
			post: {
				tags: ["memory"],
				summary: "Append to memory",
				description: "Append an entry to the memory for a scope.",
				operationId: "appendMemory",
				parameters: [{
					name: "scope",
					in: "path",
					required: true,
					description: "Memory scope identifier",
					schema: { type: "string" },
				}],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["entry"],
								properties: {
									entry: { type: "string" },
								},
							},
						},
					},
				},
				responses: {
					"200": jsonResponse("Entry appended", { type: "object" }),
					"400": errorResponse("Invalid scope or missing entry"),
					"500": errorResponse("Internal error"),
				},
			},
			delete: {
				tags: ["memory"],
				summary: "Delete memory",
				description: "Delete the memory content for a scope.",
				operationId: "deleteMemory",
				parameters: [{
					name: "scope",
					in: "path",
					required: true,
					description: "Memory scope identifier",
					schema: { type: "string" },
				}],
				responses: {
					"200": jsonResponse("Memory deleted", { type: "object" }),
					"400": errorResponse("Invalid scope format"),
					"404": errorResponse("Memory not found"),
					"500": errorResponse("Internal error"),
				},
			},
		},
	};
}

/**
 * Build all Agent and Memory path entries.
 *
 * @returns Combined path entries for agent management and memory CRUD.
 */
export function buildAgentPaths(): PathEntries {
	return {
		...agentPaths(),
		...memoryPaths(),
	};
}
