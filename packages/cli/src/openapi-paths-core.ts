/**
 * OpenAPI path definitions for Core, Sessions, Chat, and Auth endpoints.
 *
 * @module openapi-paths-core
 */

import {
	type PathEntries,
	errorResponse,
	jsonResponse,
} from "./openapi-helpers.js";

/** Core endpoints: health, metrics, providers, tools, openapi spec. */
function corePaths(): PathEntries {
	return {
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
	};
}

/** Session lifecycle endpoints. */
function sessionPaths(): PathEntries {
	return {
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
	};
}

/** Chat endpoint. */
function chatPaths(): PathEntries {
	return {
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
	};
}

/** Authentication endpoints: token exchange, refresh, user info. */
function authPaths(): PathEntries {
	return {
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
	};
}

/**
 * Build all Core, Sessions, Chat, and Auth path entries.
 *
 * @returns Combined path entries for foundational API endpoints.
 */
export function buildCorePaths(): PathEntries {
	return {
		...corePaths(),
		...sessionPaths(),
		...chatPaths(),
		...authPaths(),
	};
}
