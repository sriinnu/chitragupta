import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	serializeAgent,
	serializeAgentDetail,
	serializeTree,
	listAllAgents,
	findAgentById,
	countDescendants,
	computeAgentStats,
} from "../src/agent-api.js";
import type { AgentInfo, AgentDetail, AgentTreeNode, AgentStats } from "../src/agent-api.js";
import { createChitraguptaAPI } from "../src/http-server.js";
import type { ChitraguptaServer } from "../src/http-server.js";

// ── Mock Agent ──────────────────────────────────────────────────────────────

/**
 * Lightweight mock that satisfies the Agent public API surface used by
 * agent-api.ts without pulling in the real Agent class and its heavy
 * dependency tree (LLM providers, tools, etc.).
 */
function createMockAgent(overrides: {
	id?: string;
	purpose?: string;
	depth?: number;
	status?: string;
	profile?: string;
	model?: string;
	parent?: ReturnType<typeof createMockAgent> | null;
	children?: ReturnType<typeof createMockAgent>[];
} = {}) {
	const agent: Record<string, unknown> = {
		id: overrides.id ?? crypto.randomUUID(),
		purpose: overrides.purpose ?? "root",
		depth: overrides.depth ?? 0,
	};

	const children = overrides.children ?? [];
	const parent = overrides.parent ?? null;
	const status = overrides.status ?? "idle";
	const profile = overrides.profile ?? "chitragupta";
	const model = overrides.model ?? "claude-sonnet-4-20250514";

	agent.getStatus = () => status;
	agent.getAgentStatus = () => status;
	agent.getProfileId = () => profile;
	agent.getModel = () => model;
	agent.getChildren = () => children;
	agent.getParent = () => parent;

	// Tree traversal delegates (mimic real Agent)
	agent.getRoot = () => {
		let current = agent;
		while ((current as any).getParent() !== null) {
			current = (current as any).getParent();
		}
		return current;
	};

	agent.getAncestors = () => {
		const ancestors: unknown[] = [];
		let current = parent;
		while (current !== null) {
			ancestors.push(current);
			current = (current as any).getParent();
		}
		return ancestors;
	};

	agent.getDescendants = () => {
		const descendants: unknown[] = [];
		// Use getChildren() dynamically so test overrides are respected
		const stack = [...(agent as any).getChildren()];
		while (stack.length > 0) {
			const c = stack.pop()!;
			descendants.push(c);
			stack.push(...(c as any).getChildren());
		}
		return descendants;
	};

	agent.findAgent = (targetId: string) => {
		const root = (agent as any).getRoot();
		if (root.id === targetId) return root;
		const stack = [...(root as any).getChildren()];
		while (stack.length > 0) {
			const c = stack.pop()!;
			if ((c as any).id === targetId) return c;
			stack.push(...(c as any).getChildren());
		}
		return null;
	};

	agent.abort = vi.fn(() => {
		(agent as any)._aborted = true;
		for (const child of children) {
			(child as any).abort();
		}
	});

	agent.spawn = vi.fn((config: { purpose: string }) => {
		if (children.length >= 4) {
			throw new Error("Cannot spawn sub-agent: parent already has 4 children (max).");
		}
		if ((agent as any).depth + 1 > 3) {
			throw new Error("Cannot spawn sub-agent: would exceed max depth of 3. Current depth: 3.");
		}
		const child = createMockAgent({
			purpose: config.purpose,
			depth: (agent as any).depth + 1,
			parent: agent as any,
			status: "idle",
		});
		children.push(child as any);
		return child;
	});

	agent.prompt = vi.fn(async (message: string) => ({
		id: crypto.randomUUID(),
		role: "assistant",
		content: [{ type: "text", text: `Response to: ${message}` }],
		timestamp: Date.now(),
	}));

	return agent as any;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function req(
	port: number,
	path: string,
	opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
	const url = `http://127.0.0.1:${port}${path}`;
	const res = await fetch(url, {
		method: opts.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			...(opts.headers ?? {}),
		},
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
	const body = (await res.json()) as Record<string, unknown>;
	return { status: res.status, body };
}

// ── Unit Tests: Serialization Functions ─────────────────────────────────────

describe("agent-api serialization", () => {
	it("serializeAgent returns correct shape", () => {
		const agent = createMockAgent({
			id: "agent-1",
			purpose: "root",
			depth: 0,
			status: "running",
			profile: "chitragupta",
			model: "claude-sonnet-4-20250514",
		});

		const info: AgentInfo = serializeAgent(agent);
		expect(info).toEqual({
			id: "agent-1",
			status: "running",
			depth: 0,
			purpose: "root",
			profile: "chitragupta",
			model: "claude-sonnet-4-20250514",
			childCount: 0,
			parentId: null,
		});
	});

	it("serializeAgent includes parentId when parent exists", () => {
		const parent = createMockAgent({ id: "parent-1" });
		const child = createMockAgent({
			id: "child-1",
			depth: 1,
			parent,
			purpose: "sub-task",
		});

		const info = serializeAgent(child);
		expect(info.parentId).toBe("parent-1");
		expect(info.depth).toBe(1);
	});

	it("serializeAgentDetail includes childIds and ancestry", () => {
		const root = createMockAgent({ id: "root-1" });
		const child1 = createMockAgent({ id: "c1", depth: 1, parent: root, purpose: "reviewer" });
		const child2 = createMockAgent({ id: "c2", depth: 1, parent: root, purpose: "tester" });
		(root as any).getChildren = () => [child1, child2];

		const detail: AgentDetail = serializeAgentDetail(root);
		expect(detail.childIds).toEqual(["c1", "c2"]);
		expect(detail.ancestry).toEqual([]); // root has no ancestors

		const childDetail = serializeAgentDetail(child1);
		expect(childDetail.ancestry).toEqual(["root-1"]);
		expect(childDetail.childIds).toEqual([]);
	});

	it("serializeTree produces recursive structure", () => {
		const root = createMockAgent({ id: "root-1", purpose: "root", status: "completed" });
		const child = createMockAgent({
			id: "child-1", depth: 1, parent: root, purpose: "reviewer", status: "running",
		});
		const grandchild = createMockAgent({
			id: "gc-1", depth: 2, parent: child, purpose: "lint", status: "idle",
		});
		(root as any).getChildren = () => [child];
		(child as any).getChildren = () => [grandchild];

		const tree: AgentTreeNode = serializeTree(root);
		expect(tree.id).toBe("root-1");
		expect(tree.children).toHaveLength(1);
		expect(tree.children[0].id).toBe("child-1");
		expect(tree.children[0].children).toHaveLength(1);
		expect(tree.children[0].children[0].id).toBe("gc-1");
		expect(tree.children[0].children[0].children).toEqual([]);
	});

	it("listAllAgents returns flat list from tree root", () => {
		const root = createMockAgent({ id: "root-1" });
		const c1 = createMockAgent({ id: "c1", depth: 1, parent: root });
		const c2 = createMockAgent({ id: "c2", depth: 1, parent: root });
		(root as any).getChildren = () => [c1, c2];

		const agents = listAllAgents(root);
		expect(agents).toHaveLength(3);
		expect(agents.map((a) => a.id)).toContain("root-1");
		expect(agents.map((a) => a.id)).toContain("c1");
		expect(agents.map((a) => a.id)).toContain("c2");
	});

	it("findAgentById returns agent when found", () => {
		const root = createMockAgent({ id: "root-1" });
		const child = createMockAgent({ id: "target-1", depth: 1, parent: root });
		(root as any).getChildren = () => [child];

		const found = findAgentById(root, "target-1");
		expect(found).not.toBeNull();
		expect(found!.id).toBe("target-1");
	});

	it("findAgentById returns null when not found", () => {
		const root = createMockAgent({ id: "root-1" });
		const found = findAgentById(root, "nonexistent");
		expect(found).toBeNull();
	});

	it("countDescendants counts all nested children", () => {
		const root = createMockAgent({ id: "root-1" });
		const c1 = createMockAgent({ id: "c1", depth: 1, parent: root });
		const c2 = createMockAgent({ id: "c2", depth: 1, parent: root });
		const gc1 = createMockAgent({ id: "gc1", depth: 2, parent: c1 });
		(root as any).getChildren = () => [c1, c2];
		(c1 as any).getChildren = () => [gc1];

		expect(countDescendants(root)).toBe(3); // c1, c2, gc1
		expect(countDescendants(c1)).toBe(1); // gc1
		expect(countDescendants(c2)).toBe(0);
	});

	it("computeAgentStats aggregates correctly", () => {
		const root = createMockAgent({ id: "r", status: "idle", depth: 0 });
		const c1 = createMockAgent({ id: "c1", status: "running", depth: 1, parent: root });
		const c2 = createMockAgent({ id: "c2", status: "completed", depth: 1, parent: root });
		const gc = createMockAgent({ id: "gc", status: "error", depth: 2, parent: c1 });
		(root as any).getChildren = () => [c1, c2];
		(c1 as any).getChildren = () => [gc];

		const stats: AgentStats = computeAgentStats(root);
		expect(stats.total).toBe(4);
		expect(stats.idle).toBe(1);
		expect(stats.running).toBe(1);
		expect(stats.completed).toBe(1);
		expect(stats.error).toBe(1);
		expect(stats.aborted).toBe(0);
		expect(stats.maxDepth).toBe(2);
		expect(stats.avgDepth).toBe(1); // (0+1+1+2)/4 = 1.0
	});
});

// ── Integration Tests: HTTP Routes ──────────────────────────────────────────

describe("Agent Tree HTTP API", () => {
	let server: ChitraguptaServer;
	let port: number;
	let mockRoot: ReturnType<typeof createMockAgent>;

	beforeEach(async () => {
		mockRoot = createMockAgent({ id: "root-42", purpose: "root", status: "idle" });
		const child1 = createMockAgent({
			id: "child-1", depth: 1, parent: mockRoot, purpose: "reviewer", status: "running",
		});
		const child2 = createMockAgent({
			id: "child-2", depth: 1, parent: mockRoot, purpose: "tester", status: "completed",
		});
		(mockRoot as any).getChildren = () => [child1, child2];

		server = createChitraguptaAPI({
			getAgent: () => mockRoot,
			getSession: () => null,
			listSessions: () => [],
		}, { port: 0, host: "127.0.0.1" });

		port = await server.start();
	});

	afterEach(async () => {
		if (server?.isRunning) await server.stop();
	});

	describe("GET /api/agents", () => {
		it("returns flat list of all agents", async () => {
			const { status, body } = await req(port, "/api/agents");
			expect(status).toBe(200);
			const agents = body.agents as AgentInfo[];
			expect(agents).toHaveLength(3);
			expect(agents.map((a) => a.id)).toContain("root-42");
			expect(agents.map((a) => a.id)).toContain("child-1");
		});

		it("filters by status query param", async () => {
			const { status, body } = await req(port, "/api/agents?status=running");
			expect(status).toBe(200);
			const agents = body.agents as AgentInfo[];
			expect(agents).toHaveLength(1);
			expect(agents[0].id).toBe("child-1");
		});

		it("returns empty array for unmatched status filter", async () => {
			const { status, body } = await req(port, "/api/agents?status=aborted");
			expect(status).toBe(200);
			expect(body.agents).toEqual([]);
		});
	});

	describe("GET /api/agents/:id", () => {
		it("returns agent detail for valid ID", async () => {
			const { status, body } = await req(port, "/api/agents/root-42");
			expect(status).toBe(200);
			expect(body.id).toBe("root-42");
			expect(body.childIds).toEqual(["child-1", "child-2"]);
			expect(body.ancestry).toEqual([]);
		});

		it("returns 404 for unknown ID", async () => {
			const { status, body } = await req(port, "/api/agents/nonexistent");
			expect(status).toBe(404);
			expect(body.error).toContain("Agent not found");
		});
	});

	describe("GET /api/agents/tree", () => {
		it("returns full tree from root", async () => {
			const { status, body } = await req(port, "/api/agents/tree");
			expect(status).toBe(200);
			const tree = body.tree as AgentTreeNode;
			expect(tree.id).toBe("root-42");
			expect(tree.children).toHaveLength(2);
		});
	});

	describe("GET /api/agents/:id/tree", () => {
		it("returns subtree for specific agent", async () => {
			const { status, body } = await req(port, "/api/agents/child-1/tree");
			expect(status).toBe(200);
			const tree = body.tree as AgentTreeNode;
			expect(tree.id).toBe("child-1");
			expect(tree.children).toEqual([]);
		});

		it("returns 404 for unknown agent subtree", async () => {
			const { status } = await req(port, "/api/agents/unknown/tree");
			expect(status).toBe(404);
		});
	});

	describe("GET /api/agents/stats", () => {
		it("returns aggregate stats", async () => {
			const { status, body } = await req(port, "/api/agents/stats");
			expect(status).toBe(200);
			expect(body.total).toBe(3);
			expect(body.running).toBe(1);
			expect(body.idle).toBe(1);
			expect(body.completed).toBe(1);
			expect(body.maxDepth).toBe(1);
		});
	});

	describe("POST /api/agents/:id/spawn", () => {
		it("spawns a sub-agent and returns its info", async () => {
			const { status, body } = await req(port, "/api/agents/root-42/spawn", {
				method: "POST",
				body: { purpose: "code-reviewer" },
			});
			expect(status).toBe(201);
			const agent = body.agent as AgentInfo;
			expect(agent.purpose).toBe("code-reviewer");
			expect(agent.depth).toBe(1);
			expect(agent.parentId).toBe("root-42");
		});

		it("returns 404 for unknown parent", async () => {
			const { status } = await req(port, "/api/agents/nonexistent/spawn", {
				method: "POST",
				body: { purpose: "task" },
			});
			expect(status).toBe(404);
		});

		it("returns 400 for missing purpose", async () => {
			const { status, body } = await req(port, "/api/agents/root-42/spawn", {
				method: "POST",
				body: {},
			});
			expect(status).toBe(400);
			expect(body.error).toContain("purpose");
		});

		it("returns 409 when max children exceeded", async () => {
			// Create a mock where spawn always throws max-children
			const limitedAgent = createMockAgent({ id: "limited-1" });
			(limitedAgent as any).spawn = vi.fn(() => {
				throw new Error("Cannot spawn sub-agent: parent already has 4 children (max).");
			});
			// Replace root's findAgent to return the limited agent
			(mockRoot as any).findAgent = (id: string) => {
				if (id === "limited-1") return limitedAgent;
				return null;
			};

			const { status, body } = await req(port, "/api/agents/limited-1/spawn", {
				method: "POST",
				body: { purpose: "overflow" },
			});
			expect(status).toBe(409);
			expect(body.error).toContain("Cannot spawn");
		});
	});

	describe("POST /api/agents/:id/abort", () => {
		it("aborts a running agent and returns count", async () => {
			const { status, body } = await req(port, "/api/agents/child-1/abort", {
				method: "POST",
			});
			expect(status).toBe(200);
			expect(body.agentId).toBe("child-1");
			expect(body.status).toBe("aborted");
			expect(body.childrenAborted).toBe(0);
		});

		it("returns 404 for unknown agent", async () => {
			const { status } = await req(port, "/api/agents/nonexistent/abort", {
				method: "POST",
			});
			expect(status).toBe(404);
		});

		it("returns 409 for already completed agent", async () => {
			const { status, body } = await req(port, "/api/agents/child-2/abort", {
				method: "POST",
			});
			expect(status).toBe(409);
			expect(body.error).toContain("already completed");
		});
	});

	describe("POST /api/agents/:id/prompt", () => {
		it("sends prompt to specific agent and returns response", async () => {
			const { status, body } = await req(port, "/api/agents/root-42/prompt", {
				method: "POST",
				body: { message: "Hello agent" },
			});
			expect(status).toBe(200);
			expect(body.response).toBe("Response to: Hello agent");
			expect(body.agentId).toBe("root-42");
		});

		it("returns 404 for unknown agent", async () => {
			const { status } = await req(port, "/api/agents/nonexistent/prompt", {
				method: "POST",
				body: { message: "Hello" },
			});
			expect(status).toBe(404);
		});

		it("returns 400 for missing message", async () => {
			const { status, body } = await req(port, "/api/agents/root-42/prompt", {
				method: "POST",
				body: {},
			});
			expect(status).toBe(400);
			expect(body.error).toContain("message");
		});
	});

	describe("503 when agent not initialized", () => {
		let noAgentServer: ChitraguptaServer;
		let noAgentPort: number;

		beforeEach(async () => {
			noAgentServer = createChitraguptaAPI({
				getAgent: () => null,
				getSession: () => null,
				listSessions: () => [],
			}, { port: 0, host: "127.0.0.1" });
			noAgentPort = await noAgentServer.start();
		});

		afterEach(async () => {
			if (noAgentServer?.isRunning) await noAgentServer.stop();
		});

		it("GET /api/agents returns 503", async () => {
			const { status } = await req(noAgentPort, "/api/agents");
			expect(status).toBe(503);
		});

		it("GET /api/agents/tree returns 503", async () => {
			const { status } = await req(noAgentPort, "/api/agents/tree");
			expect(status).toBe(503);
		});

		it("GET /api/agents/stats returns 503", async () => {
			const { status } = await req(noAgentPort, "/api/agents/stats");
			expect(status).toBe(503);
		});
	});
});
