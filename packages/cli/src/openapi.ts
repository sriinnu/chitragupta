/**
 * OpenAPI 3.0 Specification Generator for Chitragupta REST API.
 *
 * Programmatically generates a comprehensive OpenAPI 3.0 spec covering
 * all registered API endpoints across all phases: core, sessions, memory,
 * agents, auth, jobs, skills, evolution, intelligence, collaboration,
 * and autonomy.
 *
 * @module openapi
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface OpenAPISpec {
	openapi: string;
	info: {
		title: string;
		description: string;
		version: string;
		contact?: { name: string; url: string };
		license?: { name: string; url: string };
	};
	servers: Array<{ url: string; description: string }>;
	tags: Array<{ name: string; description: string }>;
	paths: Record<string, Record<string, PathOperation>>;
	components: {
		securitySchemes: Record<string, unknown>;
		schemas: Record<string, unknown>;
	};
	security: Array<Record<string, string[]>>;
}

interface PathOperation {
	tags: string[];
	summary: string;
	description?: string;
	operationId: string;
	parameters?: Array<{
		name: string;
		in: string;
		required?: boolean;
		description?: string;
		schema: { type: string; default?: unknown; enum?: string[] };
	}>;
	requestBody?: {
		required?: boolean;
		content: {
			"application/json": {
				schema: unknown;
			};
		};
	};
	responses: Record<string, {
		description: string;
		content?: {
			"application/json": {
				schema: unknown;
			};
		};
	}>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ref(name: string): { $ref: string } {
	return { $ref: `#/components/schemas/${name}` };
}

function errorResponse(description: string): {
	description: string;
	content: { "application/json": { schema: unknown } };
} {
	return {
		description,
		content: {
			"application/json": {
				schema: ref("ErrorResponse"),
			},
		},
	};
}

function jsonResponse(description: string, schema: unknown): {
	description: string;
	content: { "application/json": { schema: unknown } };
} {
	return {
		description,
		content: {
			"application/json": { schema },
		},
	};
}

function limitParam(): {
	name: string;
	in: string;
	required: boolean;
	description: string;
	schema: { type: string; default: number };
} {
	return {
		name: "limit",
		in: "query",
		required: false,
		description: "Maximum number of results to return",
		schema: { type: "integer", default: 20 },
	};
}

function projectParam(): {
	name: string;
	in: string;
	required: boolean;
	description: string;
	schema: { type: string };
} {
	return {
		name: "project",
		in: "query",
		required: false,
		description: "Project path scope",
		schema: { type: "string" },
	};
}

// ─── Spec Generator ─────────────────────────────────────────────────────────

/**
 * Generate a complete OpenAPI 3.0 specification for the Chitragupta REST API.
 *
 * @param version - API version string. Defaults to "0.5.0".
 * @param serverUrl - Base server URL. Defaults to "http://127.0.0.1:3141".
 * @returns The OpenAPI specification as a plain object.
 */
export function generateOpenAPISpec(
	version = "0.5.0",
	serverUrl = "http://127.0.0.1:3141",
): OpenAPISpec {
	return {
		openapi: "3.0.3",
		info: {
			title: "Chitragupta API",
			description:
				"REST API for Chitragupta -- the self-evolving AI agent platform. " +
				"Provides endpoints for agent management, memory CRUD, session handling, " +
				"skill lifecycle, model routing intelligence, multi-agent collaboration, " +
				"behavioral autonomy, and observability. Named after the Vedic deity " +
				"who records every soul's deeds.",
			version,
			contact: { name: "Chitragupta", url: "https://github.com/auriva/chitragupta" },
			license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
		},
		servers: [
			{ url: serverUrl, description: "Local development server" },
		],
		tags: [
			{ name: "core", description: "Health checks, metrics, and server status" },
			{ name: "sessions", description: "Session lifecycle management" },
			{ name: "memory", description: "Memory CRUD (Smriti Dvaara)" },
			{ name: "agents", description: "Agent tree management and prompting" },
			{ name: "auth", description: "Authentication and authorization (Dvarpalaka)" },
			{ name: "jobs", description: "Async job queue (Karya)" },
			{ name: "skills", description: "Skill ecosystem (Vidya)" },
			{ name: "evolution", description: "Phase 1: Self-Evolution (Vasana, Nidra, Vidhi)" },
			{ name: "intelligence", description: "Phase 2: Intelligence Layer (Turiya, Triguna, Rta, Buddhi)" },
			{ name: "collaboration", description: "Phase 3: Multi-Agent Collaboration (Samiti, Sabha, Lokapala, Akasha)" },
			{ name: "autonomy", description: "Phase 4: Behavioral Autonomy (Kartavya, Kala Chakra)" },
		],
		paths: {
			// ═══════════════════════════════════════════════════════════════
			// Core
			// ═══════════════════════════════════════════════════════════════
			"/api/health": {
				get: {
					tags: ["core"],
					summary: "Health check",
					description: "Returns server status, version, and uptime. No authentication required.",
					operationId: "getHealth",
					responses: {
						"200": jsonResponse("Server is healthy", {
							type: "object",
							properties: {
								status: { type: "string", enum: ["ok"] },
								version: { type: "string" },
								uptime: { type: "integer", description: "Uptime in milliseconds" },
								timestamp: { type: "string", format: "date-time" },
							},
						}),
					},
				},
			},
			"/api/health/deep": {
				get: {
					tags: ["core"],
					summary: "Deep health check",
					description: "Comprehensive health check including memory, event loop, and disk subsystems.",
					operationId: "getDeepHealth",
					responses: {
						"200": jsonResponse("All subsystems healthy", { type: "object" }),
						"503": errorResponse("One or more subsystems degraded"),
					},
				},
			},
			"/api/metrics": {
				get: {
					tags: ["core"],
					summary: "Prometheus metrics",
					description: "Returns Prometheus-formatted metrics for HTTP requests and system performance.",
					operationId: "getMetrics",
					responses: {
						"200": {
							description: "Prometheus metrics in text exposition format",
							content: {
								"application/json": {
									schema: { type: "string" },
								},
							},
						},
					},
				},
			},
			"/api/openapi.json": {
				get: {
					tags: ["core"],
					summary: "OpenAPI specification",
					description: "Returns this OpenAPI 3.0 specification as JSON.",
					operationId: "getOpenAPISpec",
					responses: {
						"200": jsonResponse("OpenAPI specification", { type: "object" }),
					},
				},
			},
			"/api/providers": {
				get: {
					tags: ["core"],
					summary: "List AI providers",
					description: "Returns the list of configured AI providers (Claude, Codex, Gemini, etc.).",
					operationId: "listProviders",
					responses: {
						"200": jsonResponse("Provider list", {
							type: "object",
							properties: {
								providers: { type: "array", items: { type: "object" } },
							},
						}),
						"500": errorResponse("Internal error"),
					},
				},
			},
			"/api/tools": {
				get: {
					tags: ["core"],
					summary: "List available tools",
					description: "Returns the list of registered Yantra tools available to agents.",
					operationId: "listTools",
					responses: {
						"200": jsonResponse("Tool list", {
							type: "object",
							properties: {
								tools: { type: "array", items: { type: "object" } },
							},
						}),
						"500": errorResponse("Internal error"),
					},
				},
			},

			// ═══════════════════════════════════════════════════════════════
			// Sessions
			// ═══════════════════════════════════════════════════════════════
			"/api/sessions": {
				get: {
					tags: ["sessions"],
					summary: "List sessions",
					description: "Returns all available sessions.",
					operationId: "listSessions",
					responses: {
						"200": jsonResponse("Session list", {
							type: "object",
							properties: {
								sessions: { type: "array", items: { type: "object" } },
							},
						}),
						"500": errorResponse("Internal error"),
					},
				},
				post: {
					tags: ["sessions"],
					summary: "Create session",
					description: "Request creation of a new session.",
					operationId: "createSession",
					requestBody: {
						required: false,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										title: { type: "string", description: "Session title" },
									},
								},
							},
						},
					},
					responses: {
						"201": jsonResponse("Session creation requested", { type: "object" }),
						"500": errorResponse("Internal error"),
					},
				},
			},
			"/api/sessions/{id}": {
				get: {
					tags: ["sessions"],
					summary: "Get session by ID",
					description: "Returns the session matching the given ID.",
					operationId: "getSession",
					parameters: [{
						name: "id",
						in: "path",
						required: true,
						description: "Session identifier",
						schema: { type: "string" },
					}],
					responses: {
						"200": jsonResponse("Session details", { type: "object" }),
						"404": errorResponse("Session not found"),
						"500": errorResponse("Internal error"),
					},
				},
			},

			// ═══════════════════════════════════════════════════════════════
			// Chat
			// ═══════════════════════════════════════════════════════════════
			"/api/chat": {
				post: {
					tags: ["agents"],
					summary: "Send chat message",
					description: "Send a message to the active agent and receive a response.",
					operationId: "chat",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["message"],
									properties: {
										message: { type: "string", description: "The message to send to the agent" },
									},
								},
							},
						},
					},
					responses: {
						"200": jsonResponse("Agent response", {
							type: "object",
							properties: {
								response: { type: "string" },
								requestId: { type: "string" },
							},
						}),
						"400": errorResponse("Missing message field"),
						"503": errorResponse("Agent not initialized"),
					},
				},
			},

			// ═══════════════════════════════════════════════════════════════
			// Agent
			// ═══════════════════════════════════════════════════════════════
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

			// ═══════════════════════════════════════════════════════════════
			// Memory
			// ═══════════════════════════════════════════════════════════════
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

			// ═══════════════════════════════════════════════════════════════
			// Auth
			// ═══════════════════════════════════════════════════════════════
			"/api/auth/token": {
				post: {
					tags: ["auth"],
					summary: "OAuth token exchange",
					description: "Exchange an OAuth provider token for a Chitragupta JWT.",
					operationId: "tokenExchange",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["provider", "token"],
									properties: {
										provider: { type: "string", enum: ["google", "apple", "github"] },
										token: { type: "string" },
									},
								},
							},
						},
					},
					responses: {
						"200": jsonResponse("JWT token", { type: "object" }),
						"401": errorResponse("Invalid provider token"),
						"501": errorResponse("Token exchange not configured"),
					},
				},
			},
			"/api/auth/refresh": {
				post: {
					tags: ["auth"],
					summary: "Refresh JWT",
					description: "Refresh an expired JWT using a refresh token.",
					operationId: "refreshToken",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["refreshToken"],
									properties: {
										refreshToken: { type: "string" },
									},
								},
							},
						},
					},
					responses: {
						"200": jsonResponse("Refreshed JWT", { type: "object" }),
						"401": errorResponse("Invalid refresh token"),
						"501": errorResponse("Token exchange not configured"),
					},
				},
			},
			"/api/auth/me": {
				get: {
					tags: ["auth"],
					summary: "Current user info",
					description: "Returns information about the authenticated user.",
					operationId: "getAuthMe",
					responses: {
						"200": jsonResponse("User info", { type: "object" }),
						"401": errorResponse("Not authenticated"),
					},
				},
			},

			// ═══════════════════════════════════════════════════════════════
			// Jobs (Karya)
			// ═══════════════════════════════════════════════════════════════
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

			// ═══════════════════════════════════════════════════════════════
			// Skills (Vidya)
			// ═══════════════════════════════════════════════════════════════
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

			// ═══════════════════════════════════════════════════════════════
			// Evolution (Phase 1)
			// ═══════════════════════════════════════════════════════════════
			"/api/vasanas": {
				get: {
					tags: ["evolution"],
					summary: "List vasanas",
					description: "Returns crystallized behavioral tendencies, ordered by strength.",
					operationId: "listVasanas",
					parameters: [limitParam(), projectParam()],
					responses: {
						"200": jsonResponse("Vasana list", { type: "object" }),
						"503": errorResponse("Vasana engine not available"),
					},
				},
			},
			"/api/vasanas/{id}": {
				get: {
					tags: ["evolution"],
					summary: "Get vasana by ID",
					description: "Returns a specific crystallized tendency.",
					operationId: "getVasana",
					parameters: [{
						name: "id",
						in: "path",
						required: true,
						description: "Vasana identifier",
						schema: { type: "string" },
					}],
					responses: {
						"200": jsonResponse("Vasana details", { type: "object" }),
						"404": errorResponse("Vasana not found"),
						"503": errorResponse("Vasana engine not available"),
					},
				},
			},
			"/api/nidra/status": {
				get: {
					tags: ["evolution"],
					summary: "Nidra daemon status",
					description: "Returns the sleep/consolidation daemon's current state and progress.",
					operationId: "getNidraStatus",
					responses: {
						"200": jsonResponse("Nidra status", { type: "object" }),
						"503": errorResponse("Nidra daemon not available"),
					},
				},
			},
			"/api/nidra/wake": {
				post: {
					tags: ["evolution"],
					summary: "Wake Nidra daemon",
					description: "Force-wake the Nidra daemon from its sleep cycle.",
					operationId: "wakeNidra",
					responses: {
						"200": jsonResponse("Daemon woken", { type: "object" }),
						"503": errorResponse("Nidra daemon not available"),
					},
				},
			},
			"/api/vidhi": {
				get: {
					tags: ["evolution"],
					summary: "List vidhis",
					description: "Returns learned procedural memories (tool sequences).",
					operationId: "listVidhis",
					parameters: [limitParam(), projectParam()],
					responses: {
						"200": jsonResponse("Vidhi list", { type: "object" }),
						"503": errorResponse("Vidhi engine not available"),
					},
				},
			},
			"/api/vidhi/{name}": {
				get: {
					tags: ["evolution"],
					summary: "Get vidhi by name",
					description: "Returns a specific procedural memory by name or ID.",
					operationId: "getVidhi",
					parameters: [{
						name: "name",
						in: "path",
						required: true,
						description: "Vidhi name or ID",
						schema: { type: "string" },
					}],
					responses: {
						"200": jsonResponse("Vidhi details", { type: "object" }),
						"404": errorResponse("Vidhi not found"),
						"503": errorResponse("Vidhi engine not available"),
					},
				},
			},

			// ═══════════════════════════════════════════════════════════════
			// Intelligence (Phase 2)
			// ═══════════════════════════════════════════════════════════════
			"/api/turiya/status": {
				get: {
					tags: ["intelligence"],
					summary: "Turiya router status",
					description: "Returns the model routing engine's aggregate stats and active tiers.",
					operationId: "getTuriyaStatus",
					responses: {
						"200": jsonResponse("Turiya status", { type: "object" }),
						"503": errorResponse("Turiya router not available"),
					},
				},
			},
			"/api/turiya/routing": {
				get: {
					tags: ["intelligence"],
					summary: "Turiya routing details",
					description: "Returns per-tier routing statistics and cost savings analysis.",
					operationId: "getTuriyaRouting",
					responses: {
						"200": jsonResponse("Routing details", { type: "object" }),
						"503": errorResponse("Turiya router not available"),
					},
				},
			},
			"/api/health/guna": {
				get: {
					tags: ["intelligence"],
					summary: "Triguna system health",
					description: "Returns the three-quality (sattva/rajas/tamas) system health state.",
					operationId: "getGunaHealth",
					responses: {
						"200": jsonResponse("Guna state", { type: "object" }),
						"503": errorResponse("Triguna monitor not available"),
					},
				},
			},
			"/api/rta/rules": {
				get: {
					tags: ["intelligence"],
					summary: "List Rta rules",
					description: "Returns all invariant rules with violation counts.",
					operationId: "listRtaRules",
					responses: {
						"200": jsonResponse("Rule list", { type: "object" }),
						"503": errorResponse("Rta engine not available"),
					},
				},
			},
			"/api/rta/audit": {
				get: {
					tags: ["intelligence"],
					summary: "Rta audit log",
					description: "Returns the most recent audit entries from invariant rule checks.",
					operationId: "getRtaAudit",
					parameters: [limitParam()],
					responses: {
						"200": jsonResponse("Audit log", { type: "object" }),
						"503": errorResponse("Rta engine not available"),
					},
				},
			},
			"/api/decisions": {
				get: {
					tags: ["intelligence"],
					summary: "List decisions",
					description: "Returns Buddhi decision records, optionally filtered by category.",
					operationId: "listDecisions",
					parameters: [
						limitParam(),
						projectParam(),
						{
							name: "category",
							in: "query",
							required: false,
							description: "Filter by decision category",
							schema: { type: "string" },
						},
					],
					responses: {
						"200": jsonResponse("Decision list", { type: "object" }),
						"503": errorResponse("Buddhi framework not available"),
					},
				},
			},
			"/api/decisions/{id}/reasoning": {
				get: {
					tags: ["intelligence"],
					summary: "Decision reasoning (Nyaya)",
					description: "Returns the full Nyaya five-limbed reasoning for a decision.",
					operationId: "getDecisionReasoning",
					parameters: [{
						name: "id",
						in: "path",
						required: true,
						description: "Decision identifier",
						schema: { type: "string" },
					}],
					responses: {
						"200": jsonResponse("Decision with reasoning", { type: "object" }),
						"404": errorResponse("Decision not found"),
						"503": errorResponse("Buddhi framework not available"),
					},
				},
			},

			// ═══════════════════════════════════════════════════════════════
			// Collaboration (Phase 3)
			// ═══════════════════════════════════════════════════════════════
			"/api/samiti/channels": {
				get: {
					tags: ["collaboration"],
					summary: "List ambient channels",
					description: "Returns all Samiti ambient communication channels with subscriber counts and message counts.",
					operationId: "listSamitiChannels",
					responses: {
						"200": jsonResponse("Channel list", {
							type: "object",
							properties: {
								channels: { type: "array", items: ref("SamitiChannelSummary") },
								count: { type: "integer" },
								stats: ref("SamitiStats"),
							},
						}),
						"503": errorResponse("Samiti not available"),
					},
				},
			},
			"/api/samiti/channels/{name}": {
				get: {
					tags: ["collaboration"],
					summary: "Get channel messages",
					description: "Returns messages from a specific Samiti channel with optional severity/time filters.",
					operationId: "getSamitiChannel",
					parameters: [
						{
							name: "name",
							in: "path",
							required: true,
							description: "Channel name (with or without # prefix)",
							schema: { type: "string" },
						},
						{
							name: "since",
							in: "query",
							required: false,
							description: "Only messages after this Unix timestamp (ms)",
							schema: { type: "integer" },
						},
						{
							name: "severity",
							in: "query",
							required: false,
							description: "Filter by severity",
							schema: { type: "string", enum: ["info", "warning", "critical"] },
						},
						limitParam(),
					],
					responses: {
						"200": jsonResponse("Channel messages", { type: "object" }),
						"404": errorResponse("Channel not found"),
						"503": errorResponse("Samiti not available"),
					},
				},
			},
			"/api/samiti/channels/{name}/broadcast": {
				post: {
					tags: ["collaboration"],
					summary: "Broadcast to channel",
					description: "Send a message to a Samiti ambient channel.",
					operationId: "broadcastSamiti",
					parameters: [{
						name: "name",
						in: "path",
						required: true,
						description: "Channel name (with or without # prefix)",
						schema: { type: "string" },
					}],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["sender", "content"],
									properties: {
										sender: { type: "string", description: "Agent ID or system component" },
										severity: { type: "string", enum: ["info", "warning", "critical"], default: "info" },
										category: { type: "string", default: "general" },
										content: { type: "string", description: "Message content" },
										data: { type: "object", description: "Optional structured payload" },
										references: { type: "array", items: { type: "string" }, description: "Related message IDs" },
										ttl: { type: "integer", description: "Time-to-live in ms (0 = infinite)" },
									},
								},
							},
						},
					},
					responses: {
						"201": jsonResponse("Message broadcast", { type: "object" }),
						"400": errorResponse("Missing required fields"),
						"503": errorResponse("Samiti not available"),
					},
				},
			},
			"/api/sabha/deliberations": {
				get: {
					tags: ["collaboration"],
					summary: "List deliberations",
					description: "Returns all active (non-concluded) Sabha deliberations.",
					operationId: "listSabhaDeliberations",
					responses: {
						"200": jsonResponse("Deliberation list", { type: "object" }),
						"503": errorResponse("Sabha engine not available"),
					},
				},
			},
			"/api/sabha/deliberate": {
				post: {
					tags: ["collaboration"],
					summary: "Start deliberation",
					description: "Convene a new Sabha for multi-agent deliberation on a topic.",
					operationId: "startSabhaDeliberation",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["topic", "convener", "participants"],
									properties: {
										topic: { type: "string", description: "Topic to deliberate" },
										convener: { type: "string", description: "Who is convening the assembly" },
										participants: {
											type: "array",
											minItems: 2,
											items: {
												type: "object",
												required: ["id", "role", "expertise", "credibility"],
												properties: {
													id: { type: "string" },
													role: { type: "string" },
													expertise: { type: "number", minimum: 0, maximum: 1 },
													credibility: { type: "number", minimum: 0, maximum: 1 },
												},
											},
										},
									},
								},
							},
						},
					},
					responses: {
						"201": jsonResponse("Sabha convened", { type: "object" }),
						"400": errorResponse("Missing required fields"),
						"503": errorResponse("Sabha engine not available"),
					},
				},
			},
			"/api/sabha/deliberations/{id}": {
				get: {
					tags: ["collaboration"],
					summary: "Get deliberation result",
					description: "Returns the full Sabha record including rounds, votes, and verdict.",
					operationId: "getSabhaDeliberation",
					parameters: [{
						name: "id",
						in: "path",
						required: true,
						description: "Sabha identifier",
						schema: { type: "string" },
					}],
					responses: {
						"200": jsonResponse("Deliberation details", { type: "object" }),
						"404": errorResponse("Deliberation not found"),
						"503": errorResponse("Sabha engine not available"),
					},
				},
			},
			"/api/lokapala/guardians": {
				get: {
					tags: ["collaboration"],
					summary: "List guardian agents",
					description: "Returns all Lokapala guardian agents (security, performance, correctness) with their statistics.",
					operationId: "listLokapalaGuardians",
					responses: {
						"200": jsonResponse("Guardian list", { type: "object" }),
						"503": errorResponse("Lokapala guardians not available"),
					},
				},
			},
			"/api/lokapala/violations": {
				get: {
					tags: ["collaboration"],
					summary: "Recent violations",
					description: "Returns recent findings from guardian agents, optionally filtered by domain or severity.",
					operationId: "getLokapalaViolations",
					parameters: [
						limitParam(),
						{
							name: "domain",
							in: "query",
							required: false,
							description: "Filter by guardian domain",
							schema: { type: "string", enum: ["security", "performance", "correctness"] },
						},
						{
							name: "severity",
							in: "query",
							required: false,
							description: "Filter by severity",
							schema: { type: "string", enum: ["info", "warning", "critical"] },
						},
					],
					responses: {
						"200": jsonResponse("Violation list", { type: "object" }),
						"503": errorResponse("Lokapala guardians not available"),
					},
				},
			},
			"/api/lokapala/stats": {
				get: {
					tags: ["collaboration"],
					summary: "Guardian statistics",
					description: "Returns aggregate statistics for all Lokapala guardians.",
					operationId: "getLokapalaStats",
					responses: {
						"200": jsonResponse("Guardian statistics", { type: "object" }),
						"503": errorResponse("Lokapala guardians not available"),
					},
				},
			},
			"/api/akasha/traces": {
				get: {
					tags: ["collaboration"],
					summary: "Query knowledge traces",
					description: "Query stigmergic traces from the Akasha shared knowledge field. If topic is provided, returns relevance-ranked matches; otherwise returns strongest traces.",
					operationId: "queryAkashaTraces",
					parameters: [
						{
							name: "topic",
							in: "query",
							required: false,
							description: "Topic to search for",
							schema: { type: "string" },
						},
						{
							name: "type",
							in: "query",
							required: false,
							description: "Filter by trace type",
							schema: { type: "string", enum: ["solution", "warning", "shortcut", "pattern", "correction", "preference"] },
						},
						limitParam(),
					],
					responses: {
						"200": jsonResponse("Trace list", { type: "object" }),
						"503": errorResponse("Akasha not available"),
					},
				},
				post: {
					tags: ["collaboration"],
					summary: "Deposit trace",
					description: "Leave a new stigmergic trace in the Akasha shared knowledge field.",
					operationId: "depositAkashaTrace",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["agentId", "traceType", "topic", "content"],
									properties: {
										agentId: { type: "string", description: "Agent leaving the trace" },
										traceType: {
											type: "string",
											enum: ["solution", "warning", "shortcut", "pattern", "correction", "preference"],
										},
										topic: { type: "string", description: "What the trace is about" },
										content: { type: "string", description: "The knowledge content" },
										metadata: { type: "object", description: "Optional metadata" },
									},
								},
							},
						},
					},
					responses: {
						"201": jsonResponse("Trace deposited", { type: "object" }),
						"400": errorResponse("Missing required fields"),
						"503": errorResponse("Akasha not available"),
					},
				},
			},
			"/api/akasha/stats": {
				get: {
					tags: ["collaboration"],
					summary: "Trace statistics",
					description: "Returns aggregate statistics for the Akasha knowledge field.",
					operationId: "getAkashaStats",
					responses: {
						"200": jsonResponse("Akasha statistics", { type: "object" }),
						"503": errorResponse("Akasha not available"),
					},
				},
			},

			// ═══════════════════════════════════════════════════════════════
			// Autonomy (Phase 4)
			// ═══════════════════════════════════════════════════════════════
			"/api/kartavya/pipeline": {
				get: {
					tags: ["autonomy"],
					summary: "Pipeline status",
					description: "Returns the full auto-execution pipeline status including all kartavyas, stats, and status breakdown.",
					operationId: "getKartavyaPipeline",
					parameters: [projectParam()],
					responses: {
						"200": jsonResponse("Pipeline status", { type: "object" }),
						"503": errorResponse("Kartavya engine not available"),
					},
				},
			},
			"/api/kartavya/pending": {
				get: {
					tags: ["autonomy"],
					summary: "Pending auto-tasks",
					description: "Returns all pending niyama proposals awaiting approval.",
					operationId: "getKartavyaPending",
					responses: {
						"200": jsonResponse("Pending proposals", { type: "object" }),
						"503": errorResponse("Kartavya engine not available"),
					},
				},
			},
			"/api/kartavya/execute/{id}": {
				post: {
					tags: ["autonomy"],
					summary: "Trigger execution",
					description: "Manually trigger execution of an active kartavya and record the result.",
					operationId: "executeKartavya",
					parameters: [{
						name: "id",
						in: "path",
						required: true,
						description: "Kartavya identifier",
						schema: { type: "string" },
					}],
					requestBody: {
						required: false,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										success: { type: "boolean", default: true, description: "Whether execution succeeded" },
										result: { type: "string", description: "Optional result description" },
									},
								},
							},
						},
					},
					responses: {
						"200": jsonResponse("Execution recorded", { type: "object" }),
						"404": errorResponse("Kartavya not found"),
						"409": errorResponse("Cannot execute in current status"),
						"503": errorResponse("Kartavya engine not available"),
					},
				},
			},
			"/api/kala/scales": {
				get: {
					tags: ["autonomy"],
					summary: "Active temporal scales",
					description: "Returns the 7 temporal scales with their half-life decay rates and importance weights.",
					operationId: "getKalaScales",
					responses: {
						"200": jsonResponse("Temporal scales", {
							type: "object",
							properties: {
								scales: {
									type: "array",
									items: {
										type: "object",
										properties: {
											scale: { type: "string" },
											halfLifeMs: { type: "integer" },
											weight: { type: "number" },
										},
									},
								},
								count: { type: "integer" },
							},
						}),
						"503": errorResponse("Kala Chakra not available"),
					},
				},
			},
			"/api/kala/context": {
				get: {
					tags: ["autonomy"],
					summary: "Current temporal context",
					description: "Returns temporal relevance scores at multiple time horizons, plus optional relevance for a specific timestamp.",
					operationId: "getKalaContext",
					parameters: [{
						name: "timestamp",
						in: "query",
						required: false,
						description: "Unix timestamp (ms) to compute specific relevance for",
						schema: { type: "integer" },
					}],
					responses: {
						"200": jsonResponse("Temporal context", { type: "object" }),
						"503": errorResponse("Kala Chakra not available"),
					},
				},
			},
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					bearerFormat: "JWT",
					description: "JWT obtained from /api/auth/token or legacy bearer token",
				},
				apiKeyAuth: {
					type: "apiKey",
					in: "header",
					name: "X-API-Key",
					description: "API key authentication",
				},
			},
			schemas: {
				ErrorResponse: {
					type: "object",
					properties: {
						error: { type: "string", description: "Error message" },
						requestId: { type: "string", description: "Request trace ID" },
					},
					required: ["error"],
				},
				SamitiChannelSummary: {
					type: "object",
					properties: {
						name: { type: "string" },
						description: { type: "string" },
						maxHistory: { type: "integer" },
						subscribers: { type: "array", items: { type: "string" } },
						messageCount: { type: "integer" },
						createdAt: { type: "integer" },
					},
				},
				SamitiStats: {
					type: "object",
					properties: {
						channels: { type: "integer" },
						totalMessages: { type: "integer" },
						subscribers: { type: "integer" },
					},
				},
				SamitiMessage: {
					type: "object",
					properties: {
						id: { type: "string" },
						channel: { type: "string" },
						sender: { type: "string" },
						severity: { type: "string", enum: ["info", "warning", "critical"] },
						category: { type: "string" },
						content: { type: "string" },
						data: { type: "object" },
						timestamp: { type: "integer" },
						ttl: { type: "integer" },
						references: { type: "array", items: { type: "string" } },
					},
				},
				StigmergicTrace: {
					type: "object",
					properties: {
						id: { type: "string" },
						agentId: { type: "string" },
						traceType: { type: "string", enum: ["solution", "warning", "shortcut", "pattern", "correction", "preference"] },
						topic: { type: "string" },
						content: { type: "string" },
						strength: { type: "number", minimum: 0, maximum: 1 },
						reinforcements: { type: "integer" },
						metadata: { type: "object" },
						createdAt: { type: "integer" },
						lastReinforcedAt: { type: "integer" },
					},
				},
				Finding: {
					type: "object",
					properties: {
						id: { type: "string" },
						guardianId: { type: "string" },
						domain: { type: "string", enum: ["security", "performance", "correctness"] },
						severity: { type: "string", enum: ["info", "warning", "critical"] },
						title: { type: "string" },
						description: { type: "string" },
						location: { type: "string" },
						suggestion: { type: "string" },
						confidence: { type: "number", minimum: 0, maximum: 1 },
						autoFixable: { type: "boolean" },
						timestamp: { type: "integer" },
					},
				},
				KartavyaSummary: {
					type: "object",
					properties: {
						id: { type: "string" },
						name: { type: "string" },
						status: { type: "string", enum: ["proposed", "approved", "active", "paused", "completed", "failed", "retired"] },
						triggerType: { type: "string", enum: ["cron", "event", "threshold", "pattern"] },
						triggerCondition: { type: "string" },
						confidence: { type: "number" },
						successCount: { type: "integer" },
						failureCount: { type: "integer" },
						lastExecuted: { type: "integer", nullable: true },
					},
				},
			},
		},
		security: [
			{ bearerAuth: [] },
			{ apiKeyAuth: [] },
		],
	};
}
