/**
 * OpenAPI 3.0 Specification Generator for Chitragupta REST API.
 *
 * Assembles the full spec from domain-specific path builder modules.
 * Each builder is kept under 450 LOC for maintainability.
 *
 * @module openapi
 */

import type { OpenAPISpec } from "./openapi-helpers.js";
import { buildCorePaths } from "./openapi-paths-core.js";
import { buildAgentPaths } from "./openapi-paths-agents.js";
import { buildServicePaths } from "./openapi-paths-services.js";
import { buildEvolutionPaths } from "./openapi-paths-evolution.js";
import { buildCollaborationPaths } from "./openapi-paths-collaboration.js";
import { buildComponents } from "./openapi-schemas.js";

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
			...buildCorePaths(),
			...buildAgentPaths(),
			...buildServicePaths(),
			...buildEvolutionPaths(),
			...buildCollaborationPaths(),
		},
		components: buildComponents(),
		security: [
			{ bearerAuth: [] },
			{ apiKeyAuth: [] },
		],
	};
}
