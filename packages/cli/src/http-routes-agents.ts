/**
 * Agent tree HTTP route handlers.
 * @module http-routes-agents
 */

import type { ChitraguptaServer } from "./http-server.js";
import type { ApiDeps } from "./http-server-types.js";
import type { Agent, SpawnConfig } from "@chitragupta/anina";
import {
	serializeAgent,
	serializeAgentDetail,
	serializeTree,
	listAllAgents,
	findAgentById,
	countDescendants,
	computeAgentStats,
} from "./agent-api.js";

/** Resolve the root Agent from deps.getAgent(). Returns null if not initialized. */
function getRootAgent(deps: ApiDeps): Agent | null {
	const raw = deps.getAgent();
	if (!raw) return null;
	if (typeof (raw as Agent).getRoot !== "function") return null;
	return raw as Agent;
}

/** Mount all agent tree routes onto the server. */
export function mountAgentRoutes(server: ChitraguptaServer, deps: ApiDeps): void {
	// Registered BEFORE /api/agents/:id so "tree"/"stats" are not captured as :id.
	server.route("GET", "/api/agents/tree", async () => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			return { status: 200, body: { tree: serializeTree(root.getRoot()) } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get agent tree: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/agents/stats", async () => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			return { status: 200, body: computeAgentStats(root) };
		} catch (err) {
			return { status: 500, body: { error: `Failed to compute agent stats: ${(err as Error).message}` } };
		}
	});

	server.route("GET", "/api/agents", async (req) => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			let agents = listAllAgents(root);
			const statusFilter = req.query.status;
			if (statusFilter) {
				agents = agents.filter((a) => a.status === statusFilter);
			}
			return { status: 200, body: { agents } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to list agents: ${(err as Error).message}` } };
		}
	});

	// Registered BEFORE /api/agents/:id so the 3-segment pattern matches first.
	server.route("GET", "/api/agents/:id/tree", async (req) => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			const agent = findAgentById(root, req.params.id);
			if (!agent) return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			return { status: 200, body: { tree: serializeTree(agent) } };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get agent subtree: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/agents/:id/spawn", async (req) => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			const parent = findAgentById(root, req.params.id);
			if (!parent) return { status: 404, body: { error: `Parent agent not found: ${req.params.id}` } };
			const body = (req.body ?? {}) as Record<string, unknown>;
			const purpose = body.purpose;
			if (typeof purpose !== "string" || purpose.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'purpose' field in request body" } };
			}
			const spawnConfig: Record<string, unknown> = { purpose: purpose.trim() };
			if (typeof body.model === "string") spawnConfig.model = body.model;
			try {
				const child = parent.spawn(spawnConfig as unknown as SpawnConfig);
				return { status: 201, body: { agent: serializeAgent(child) } };
			} catch (spawnErr) {
				const msg = (spawnErr as Error).message;
				if (msg.includes("Cannot spawn")) {
					return { status: 409, body: { error: msg } };
				}
				throw spawnErr;
			}
		} catch (err) {
			return { status: 500, body: { error: `Failed to spawn agent: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/agents/:id/abort", async (req) => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			const agent = findAgentById(root, req.params.id);
			if (!agent) return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			const currentStatus = agent.getStatus();
			if (currentStatus === "completed" || currentStatus === "aborted") {
				return { status: 409, body: { error: `Agent is already ${currentStatus}`, agentId: agent.id } };
			}
			const childrenCount = countDescendants(agent);
			agent.abort();
			return {
				status: 200,
				body: { agentId: agent.id, status: "aborted", childrenAborted: childrenCount },
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to abort agent: ${(err as Error).message}` } };
		}
	});

	server.route("POST", "/api/agents/:id/prompt", async (req) => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			const agent = findAgentById(root, req.params.id);
			if (!agent) return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			const body = (req.body ?? {}) as Record<string, unknown>;
			const message = body.message;
			if (typeof message !== "string" || message.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'message' field in request body" } };
			}
			const result = await agent.prompt(message.trim());
			const text = result.content
				.filter((p): p is { type: "text"; text: string } => p.type === "text")
				.map((p) => p.text)
				.join("");
			return {
				status: 200,
				body: { response: text, agentId: agent.id, requestId: req.requestId },
			};
		} catch (err) {
			return { status: 500, body: { error: `Failed to prompt agent: ${(err as Error).message}` } };
		}
	});

	// Registered LAST among /api/agents/* so more specific routes match first.
	server.route("GET", "/api/agents/:id", async (req) => {
		try {
			const root = getRootAgent(deps);
			if (!root) return { status: 503, body: { error: "Agent not initialized" } };
			const agent = findAgentById(root, req.params.id);
			if (!agent) return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			return { status: 200, body: serializeAgentDetail(agent) };
		} catch (err) {
			return { status: 500, body: { error: `Failed to get agent: ${(err as Error).message}` } };
		}
	});
}
