/**
 * Sthapana — Shared test fixture for load testing Chitragupta.
 * Sanskrit: Sthapana (स्थापन) = establishment, setting up.
 *
 * Spins up a real ChitraguptaServer with mock agent, mock memory,
 * and a mock job runner on a random port. No LLM calls — purely
 * tests the server and routing infrastructure.
 */

import { createChitraguptaAPI } from "../../src/http-server.js";
import type { ChitraguptaServer, ServerConfig } from "../../src/http-server.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TestServerHandle {
	/** The random port the server is listening on. */
	port: number;
	/** The server instance. */
	server: ChitraguptaServer;
	/** Base URL for HTTP requests (e.g. "http://127.0.0.1:12345"). */
	baseUrl: string;
	/** WebSocket URL (e.g. "ws://127.0.0.1:12345/"). */
	wsUrl: string;
	/** Auth token for authenticated requests. */
	authToken: string;
	/** Stop the server and clean up all state. */
	cleanup: () => Promise<void>;
}

// ─── Mock Agent ──────────────────────────────────────────────────────────────

/**
 * Creates a mock Agent that fully implements the tree interface
 * used by agent-api.ts serialization functions.
 *
 * Properties accessed by serializeAgent:
 *   agent.id, agent.getStatus(), agent.depth, agent.purpose,
 *   agent.getProfileId(), agent.getModel(), agent.getChildren(),
 *   agent.getParent()
 *
 * Properties accessed by listAllAgents / computeAgentStats:
 *   agent.getRoot(), root.getDescendants()
 *
 * Properties accessed by findAgentById:
 *   agent.findAgent(id)
 *
 * Properties accessed by serializeAgentDetail:
 *   agent.getAncestors()
 */
function createMockAgent() {
	// Self-referential mock: getRoot() returns itself
	const agent: Record<string, unknown> = {
		// ─── Properties (accessed directly) ────────────────────────
		id: "load-test-agent",
		depth: 0,
		purpose: "Load test root agent",
		model: "mock-model",
		providerId: "mock-provider",
		tokenUsage: { input: 0, output: 0 },

		// ─── Agent API methods ─────────────────────────────────────
		getStatus: () => "idle",
		getProfileId: () => "chitragupta",
		getModel: () => "mock-model",
		getChildren: () => [],
		getParent: () => null,
		getRoot: () => agent, // Self-referential for root agent
		getDescendants: () => [],
		getAncestors: () => [],
		findAgent: (id: string) => (id === "load-test-agent" ? agent : null),

		// ─── Agent execution methods ───────────────────────────────
		run: async (message: string): Promise<string> => {
			return `Test response to: ${message}`;
		},

		prompt: async (message: string) => ({
			id: `msg-${Date.now()}`,
			role: "assistant" as const,
			content: [{ type: "text" as const, text: `Test response to: ${message}` }],
			timestamp: Date.now(),
			cost: { total: 0.001, input: 0.0005, output: 0.0005 },
		}),

		abort: () => {},
		reset: () => {},

		spawn: () => {
			throw new Error("Cannot spawn in load test mode");
		},
	};

	return agent;
}

// ─── Mock Session ────────────────────────────────────────────────────────────

function createMockSession() {
	return {
		id: "load-test-session",
		meta: {
			id: "load-test-session",
			title: "Load Test Session",
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
			agent: "chitragupta",
			model: "mock-model",
			project: "/tmp/load-test",
			parent: null,
			branch: null,
			tags: [],
			totalCost: 0,
			totalTokens: 0,
		},
		turns: [],
	};
}

// ─── Server Factory ──────────────────────────────────────────────────────────

const AUTH_TOKEN = "load-test-token";

/**
 * Start a real ChitraguptaServer with mock dependencies for load testing.
 *
 * The server:
 * - Listens on a random port (port: 0)
 * - Uses a mock agent that responds instantly
 * - Has auth enabled with token "load-test-token"
 * - Has WebSocket support enabled (max 200 connections for load tests)
 * - Has logging disabled for quiet test output
 * - Has a very high rate limit to avoid throttling during load tests
 */
export async function startTestServer(configOverrides?: Partial<ServerConfig>): Promise<TestServerHandle> {
	const mockAgent = createMockAgent();
	const mockSession = createMockSession();

	const deps = {
		getAgent: () => mockAgent,
		getSession: () => mockSession,
		listSessions: () => [mockSession.meta],
		listProviders: () => [{ id: "mock-provider", name: "Mock" }],
		listTools: () => [],
		prompt: async (
			message: string,
			onEvent?: (type: string, data: unknown) => void,
			_signal?: AbortSignal,
		): Promise<string> => {
			// Simulate streaming events
			if (onEvent) {
				onEvent("stream:text", { text: `Test response to: ${message}` });
				onEvent("stream:done", { stopReason: "end_turn", cost: { total: 0.001 } });
			}
			return `Test response to: ${message}`;
		},
	};

	const config: ServerConfig = {
		port: 0,
		host: "127.0.0.1",
		authToken: AUTH_TOKEN,
		enableLogging: false,
		rateLimit: 100_000, // Effectively unlimited for load tests
		rateLimitWindowMs: 1_000,
		ws: {
			authToken: AUTH_TOKEN,
			maxConnections: 200,
			enableLogging: false,
			pingInterval: 60_000, // Long interval — don't interfere with tests
		},
		...configOverrides,
	};

	const server = createChitraguptaAPI(deps, config);
	const port = await server.start();

	const baseUrl = `http://127.0.0.1:${port}`;
	const wsUrl = `ws://127.0.0.1:${port}/`;

	return {
		port,
		server,
		baseUrl,
		wsUrl,
		authToken: AUTH_TOKEN,
		cleanup: async () => {
			if (server.isRunning) {
				await server.stop();
			}
		},
	};
}
