/**
 * OpenAPI path definitions for Evolution (Phase 1) and Intelligence (Phase 2) endpoints.
 *
 * @module openapi-paths-evolution
 */

import {
	type PathEntries,
	errorResponse,
	jsonResponse,
	limitParam,
	projectParam,
} from "./openapi-helpers.js";

/** Evolution endpoints: vasanas, nidra, vidhis. */
function evolutionPaths(): PathEntries {
	return {
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
	};
}

/** Intelligence layer endpoints: turiya, triguna, rta, buddhi. */
function intelligencePaths(): PathEntries {
	return {
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
	};
}

/**
 * Build all Evolution and Intelligence path entries.
 *
 * @returns Combined path entries for self-evolution and intelligence layer.
 */
export function buildEvolutionPaths(): PathEntries {
	return {
		...evolutionPaths(),
		...intelligencePaths(),
	};
}
