/**
 * OpenAPI path definitions for Collaboration (Phase 3) and Autonomy (Phase 4) endpoints.
 * @module openapi-paths-collaboration
 */
import {
	type PathEntries, ref, errorResponse, jsonResponse, limitParam, projectParam,
} from "./openapi-helpers.js";

/** Samiti ambient channel endpoints. */
function samitiPaths(): PathEntries {
	return {
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
	};
}

/** Sabha deliberation endpoints. */
function sabhaPaths(): PathEntries {
	return {
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
	};
}

/** Lokapala guardian and Akasha knowledge field endpoints. */
function lokapalaAndAkashaPaths(): PathEntries {
	return {
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
	};
}

/** Autonomy endpoints: kartavya pipeline, kala chakra. */
function autonomyPaths(): PathEntries {
	return {
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
	};
}

/**
 * Build all Collaboration and Autonomy path entries.
 *
 * @returns Combined path entries for multi-agent collaboration and behavioral autonomy.
 */
export function buildCollaborationPaths(): PathEntries {
	return {
		...samitiPaths(),
		...sabhaPaths(),
		...lokapalaAndAkashaPaths(),
		...autonomyPaths(),
	};
}
