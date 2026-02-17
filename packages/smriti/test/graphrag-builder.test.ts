import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	scopeToId,
	scopeToLabel,
	createSessionNode,
	extractConceptsFromNodes,
	indexSessionTurns,
	removeSessionFromGraph,
	removeMemoryFromGraph,
} from "../src/graphrag-builder.js";
import type { GraphRAGContext } from "../src/graphrag-builder.js";
import type {
	Session,
	MemoryScope,
	GraphNode,
	GraphEdge,
	KnowledgeGraph,
} from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<GraphRAGContext> = {}): GraphRAGContext {
	return {
		getEmbedding: overrides.getEmbedding ?? (async (_text: string) => [0.1, 0.2, 0.3]),
		extractEntities: overrides.extractEntities ?? (async (_text: string) => []),
	};
}

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		meta: {
			id: "sess-1",
			title: "Test Session",
			created: "2026-01-01T00:00:00Z",
			updated: "2026-01-01T01:00:00Z",
			agent: "chitragupta",
			model: "claude-3",
			project: "/tmp/project",
			parent: null,
			branch: null,
			tags: ["typescript", "testing"],
			totalCost: 0.05,
			totalTokens: 500,
			...overrides.meta,
		},
		turns: overrides.turns ?? [],
	};
}

function makeTurn(
	turnNumber: number,
	role: "user" | "assistant",
	content: string,
	toolCalls?: Array<{ name: string; input: string; result: string; isError?: boolean }>,
) {
	return { turnNumber, role: role as "user" | "assistant", content, toolCalls };
}

function makeNode(id: string, type: GraphNode["type"] = "session", content = "content"): GraphNode {
	return { id, type, label: id, content, metadata: {} };
}

function makeEdge(source: string, target: string, relationship = "related"): GraphEdge {
	return { source, target, relationship, weight: 0.5 };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("graphrag-builder.ts", () => {
	describe("scopeToId", () => {
		it("should return 'memory-global' for global scope", () => {
			expect(scopeToId({ type: "global" })).toBe("memory-global");
		});

		it("should return 'memory-project-/path' for project scope", () => {
			expect(scopeToId({ type: "project", path: "/my/project" })).toBe("memory-project-/my/project");
		});

		it("should return 'memory-agent-agent1' for agent scope", () => {
			expect(scopeToId({ type: "agent", agentId: "agent1" })).toBe("memory-agent-agent1");
		});

		it("should return 'memory-session-sess1' for session scope", () => {
			expect(scopeToId({ type: "session", sessionId: "sess1" })).toBe("memory-session-sess1");
		});
	});

	describe("scopeToLabel", () => {
		it("should return 'Global Memory' for global scope", () => {
			expect(scopeToLabel({ type: "global" })).toBe("Global Memory");
		});

		it("should return 'Project Memory: /path' for project scope", () => {
			expect(scopeToLabel({ type: "project", path: "/path" })).toBe("Project Memory: /path");
		});

		it("should return 'Agent Memory: agent1' for agent scope", () => {
			expect(scopeToLabel({ type: "agent", agentId: "agent1" })).toBe("Agent Memory: agent1");
		});

		it("should return 'Session Memory: sess1' for session scope", () => {
			expect(scopeToLabel({ type: "session", sessionId: "sess1" })).toBe("Session Memory: sess1");
		});
	});

	describe("createSessionNode", () => {
		it("should return a node with id=session.meta.id, type='session', label=title", async () => {
			const ctx = makeCtx();
			const session = makeSession();
			const node = await createSessionNode(ctx, session);

			expect(node.id).toBe("sess-1");
			expect(node.type).toBe("session");
			expect(node.label).toBe("Test Session");
		});

		it("should call ctx.getEmbedding with title + tags", async () => {
			const getEmbedding = vi.fn(async () => [0.5, 0.6]);
			const ctx = makeCtx({ getEmbedding });
			const session = makeSession();

			await createSessionNode(ctx, session);

			expect(getEmbedding).toHaveBeenCalledOnce();
			const callArg = (getEmbedding.mock.calls[0] as any[])[0];
			expect(callArg).toContain("Test Session");
			expect(callArg).toContain("typescript");
			expect(callArg).toContain("testing");
		});

		it("should include metadata from session.meta", async () => {
			const ctx = makeCtx();
			const session = makeSession();
			const node = await createSessionNode(ctx, session);

			expect(node.metadata.agent).toBe("chitragupta");
			expect(node.metadata.model).toBe("claude-3");
			expect(node.metadata.project).toBe("/tmp/project");
			expect(node.metadata.turnCount).toBe(0);
		});

		it("should set turnCount to the number of turns", async () => {
			const ctx = makeCtx();
			const session = makeSession({
				turns: [makeTurn(1, "user", "q"), makeTurn(2, "assistant", "a")],
			});
			const node = await createSessionNode(ctx, session);
			expect(node.metadata.turnCount).toBe(2);
		});
	});

	describe("extractConceptsFromNodes", () => {
		it("should skip entities that appear in only 1 node", async () => {
			const ctx = makeCtx({
				extractEntities: async () => [
					{ name: "TypeScript", type: "technology", description: "A typed JS superset" },
				],
			});

			const nodes: GraphNode[] = [makeNode("n1", "session", "TypeScript code")];
			const edges: GraphEdge[] = [];

			await extractConceptsFromNodes(ctx, nodes, edges);

			// Only 1 node references TypeScript, so no concept node should be created
			const conceptNodes = nodes.filter((n) => n.type === "concept");
			expect(conceptNodes).toHaveLength(0);
		});

		it("should create concept nodes for entities in 2+ nodes", async () => {
			const ctx = makeCtx({
				extractEntities: async () => [
					{ name: "TypeScript", type: "technology", description: "A typed JS superset" },
				],
			});

			const nodes: GraphNode[] = [
				makeNode("n1", "session", "TypeScript code"),
				makeNode("n2", "session", "More TypeScript code"),
			];
			const edges: GraphEdge[] = [];

			await extractConceptsFromNodes(ctx, nodes, edges);

			const conceptNodes = nodes.filter((n) => n.type === "concept");
			expect(conceptNodes).toHaveLength(1);
			expect(conceptNodes[0].id).toBe("concept-typescript");
			expect(conceptNodes[0].label).toBe("TypeScript");
		});

		it("should create 'mentions_concept' edges from source nodes to concept", async () => {
			const ctx = makeCtx({
				extractEntities: async () => [
					{ name: "Redis", type: "technology", description: "In-memory data store" },
				],
			});

			const nodes: GraphNode[] = [
				makeNode("n1", "session", "Uses Redis"),
				makeNode("n2", "session", "Redis cache"),
			];
			const edges: GraphEdge[] = [];

			await extractConceptsFromNodes(ctx, nodes, edges);

			const mentionEdges = edges.filter((e) => e.relationship === "mentions_concept");
			expect(mentionEdges).toHaveLength(2);
			expect(mentionEdges[0].source).toBe("n1");
			expect(mentionEdges[0].target).toBe("concept-redis");
			expect(mentionEdges[1].source).toBe("n2");
			expect(mentionEdges[1].target).toBe("concept-redis");
		});

		it("should skip existing concept nodes (no duplicates)", async () => {
			const ctx = makeCtx({
				extractEntities: async () => [
					{ name: "React", type: "technology", description: "UI library" },
				],
			});

			const existingConcept = makeNode("concept-react", "concept", "React");
			const nodes: GraphNode[] = [
				existingConcept,
				makeNode("n1", "session", "React code"),
				makeNode("n2", "session", "More React code"),
			];
			const edges: GraphEdge[] = [];

			await extractConceptsFromNodes(ctx, nodes, edges);

			// Should not add a duplicate concept-react
			const conceptNodes = nodes.filter((n) => n.id === "concept-react");
			expect(conceptNodes).toHaveLength(1);
		});

		it("should skip concept-type nodes when extracting entities", async () => {
			const extractEntities = vi.fn(async () => []);
			const ctx = makeCtx({ extractEntities });

			const nodes: GraphNode[] = [
				makeNode("concept-old", "concept", "Old concept content"),
				makeNode("n1", "session", "Session content"),
			];
			const edges: GraphEdge[] = [];

			await extractConceptsFromNodes(ctx, nodes, edges);

			// extractEntities should only be called for non-concept nodes
			expect(extractEntities).toHaveBeenCalledTimes(1);
			expect(extractEntities).toHaveBeenCalledWith("Session content");
		});
	});

	describe("indexSessionTurns", () => {
		it("should create chunk nodes for each semantic chunk", async () => {
			const ctx = makeCtx();
			const session = makeSession({
				turns: [makeTurn(1, "user", "Hello world. This is a test.")],
			});
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const chunkNodes = nodes.filter((n) => n.id.includes("-chunk-"));
			expect(chunkNodes.length).toBeGreaterThan(0);
			expect(chunkNodes[0].id).toBe("sess-1-turn-1-chunk-0");
		});

		it("should create 'contains_chunk' edges from session to chunks", async () => {
			const ctx = makeCtx();
			const session = makeSession({
				turns: [makeTurn(1, "user", "Short content. Nothing big.")],
			});
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const containsEdges = edges.filter((e) => e.relationship === "contains_chunk");
			expect(containsEdges.length).toBeGreaterThan(0);
			expect(containsEdges[0].source).toBe("sess-1");
		});

		it("should create 'followed_by' edges between consecutive chunks", async () => {
			const ctx = makeCtx();
			// Create content that generates multiple chunks (>500 tokens)
			const longContent = Array.from({ length: 200 }, (_, i) =>
				`Sentence number ${i} with enough words to be a valid sentence.`,
			).join(" ");
			const session = makeSession({
				turns: [makeTurn(1, "user", longContent)],
			});
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const followedByEdges = edges.filter((e) => e.relationship === "followed_by");
			if (nodes.filter((n) => n.id.includes("-chunk-")).length > 1) {
				expect(followedByEdges.length).toBeGreaterThan(0);
			}
		});

		it("should create tool call nodes with type 'file'", async () => {
			const ctx = makeCtx();
			const session = makeSession({
				turns: [
					makeTurn(1, "assistant", "Running a tool.", [
						{ name: "read_file", input: "/src/index.ts", result: "content" },
					]),
				],
			});
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const toolNodes = nodes.filter((n) => n.type === "file");
			expect(toolNodes).toHaveLength(1);
			expect(toolNodes[0].label).toBe("Tool: read_file");
			expect(toolNodes[0].metadata.toolName).toBe("read_file");
		});

		it("should create 'uses_tool' edges", async () => {
			const ctx = makeCtx();
			const session = makeSession({
				turns: [
					makeTurn(1, "assistant", "Using tools now.", [
						{ name: "search", input: "query", result: "results" },
					]),
				],
			});
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const toolEdges = edges.filter((e) => e.relationship === "uses_tool");
			expect(toolEdges).toHaveLength(1);
		});

		it("should create 'branched_to' edge if session has parent", async () => {
			const ctx = makeCtx();
			const session = makeSession({
				meta: { parent: "parent-sess-1" } as any,
				turns: [makeTurn(1, "user", "Branched content here.")],
			});
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const branchEdges = edges.filter((e) => e.relationship === "branched_to");
			expect(branchEdges).toHaveLength(1);
			expect(branchEdges[0].source).toBe("parent-sess-1");
			expect(branchEdges[0].target).toBe("sess-1");
		});

		it("should NOT create 'branched_to' edge if session has no parent", async () => {
			const ctx = makeCtx();
			const session = makeSession();
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const branchEdges = edges.filter((e) => e.relationship === "branched_to");
			expect(branchEdges).toHaveLength(0);
		});

		it("should set chunk metadata correctly", async () => {
			const ctx = makeCtx();
			const session = makeSession({
				turns: [makeTurn(1, "user", "Hello world. This is a test sentence.")],
			});
			const nodes: GraphNode[] = [];
			const edges: GraphEdge[] = [];

			await indexSessionTurns(ctx, session, nodes, edges);

			const chunkNode = nodes.find((n) => n.id.includes("-chunk-"));
			expect(chunkNode).toBeDefined();
			expect(chunkNode!.metadata.sessionId).toBe("sess-1");
			expect(chunkNode!.metadata.turnNumber).toBe(1);
			expect(chunkNode!.metadata.role).toBe("user");
		});
	});

	describe("removeSessionFromGraph", () => {
		it("should remove the session node and all turn nodes", () => {
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("sess-1"),
					makeNode("sess-1-turn-1-chunk-0"),
					makeNode("sess-1-turn-1-chunk-1"),
					makeNode("sess-1-turn-2-chunk-0"),
					makeNode("sess-2"), // unrelated
				],
				edges: [
					makeEdge("sess-1", "sess-1-turn-1-chunk-0"),
					makeEdge("sess-1-turn-1-chunk-0", "sess-1-turn-1-chunk-1"),
					makeEdge("sess-2", "other-node"), // unrelated
				],
			};

			removeSessionFromGraph(graph, "sess-1");

			expect(graph.nodes).toHaveLength(1);
			expect(graph.nodes[0].id).toBe("sess-2");
		});

		it("should remove edges involving removed nodes", () => {
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("sess-1"),
					makeNode("sess-1-turn-1-chunk-0"),
					makeNode("other"),
				],
				edges: [
					makeEdge("sess-1", "sess-1-turn-1-chunk-0"),
					makeEdge("other", "sess-1"),
					makeEdge("other", "unrelated"),
				],
			};

			removeSessionFromGraph(graph, "sess-1");

			expect(graph.edges).toHaveLength(1);
			expect(graph.edges[0].source).toBe("other");
			expect(graph.edges[0].target).toBe("unrelated");
		});

		it("should not remove unrelated nodes", () => {
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("sess-1"),
					makeNode("sess-2"),
					makeNode("sess-3"),
				],
				edges: [],
			};

			removeSessionFromGraph(graph, "sess-1");

			expect(graph.nodes).toHaveLength(2);
			expect(graph.nodes.map((n) => n.id)).toEqual(["sess-2", "sess-3"]);
		});

		it("should handle empty graph gracefully", () => {
			const graph: KnowledgeGraph = { nodes: [], edges: [] };
			expect(() => removeSessionFromGraph(graph, "nonexistent")).not.toThrow();
		});
	});

	describe("removeMemoryFromGraph", () => {
		it("should remove memory node and chunk nodes", () => {
			const scope: MemoryScope = { type: "global" };
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("memory-global", "memory"),
					makeNode("memory-global-chunk-0", "memory"),
					makeNode("memory-global-chunk-1", "memory"),
					makeNode("other-node"),
				],
				edges: [
					makeEdge("memory-global", "memory-global-chunk-0"),
					makeEdge("memory-global", "memory-global-chunk-1"),
					makeEdge("other-node", "other-target"),
				],
			};

			removeMemoryFromGraph(graph, scope);

			expect(graph.nodes).toHaveLength(1);
			expect(graph.nodes[0].id).toBe("other-node");
		});

		it("should remove edges involving removed nodes", () => {
			const scope: MemoryScope = { type: "project", path: "/foo" };
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("memory-project-/foo", "memory"),
					makeNode("memory-project-/foo-chunk-0", "memory"),
					makeNode("other"),
				],
				edges: [
					makeEdge("memory-project-/foo", "memory-project-/foo-chunk-0"),
					makeEdge("other", "memory-project-/foo"),
					makeEdge("memory-project-/foo-chunk-0", "concept-1"),
					makeEdge("other", "safe-target"),
				],
			};

			removeMemoryFromGraph(graph, scope);

			expect(graph.edges).toHaveLength(1);
			expect(graph.edges[0].target).toBe("safe-target");
		});

		it("should handle agent scope", () => {
			const scope: MemoryScope = { type: "agent", agentId: "agent-1" };
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("memory-agent-agent-1", "memory"),
					makeNode("memory-agent-agent-1-chunk-0", "memory"),
				],
				edges: [makeEdge("memory-agent-agent-1", "memory-agent-agent-1-chunk-0")],
			};

			removeMemoryFromGraph(graph, scope);

			expect(graph.nodes).toHaveLength(0);
			expect(graph.edges).toHaveLength(0);
		});

		it("should handle session scope", () => {
			const scope: MemoryScope = { type: "session", sessionId: "s-42" };
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("memory-session-s-42", "memory"),
					makeNode("unrelated"),
				],
				edges: [makeEdge("memory-session-s-42", "unrelated")],
			};

			removeMemoryFromGraph(graph, scope);

			expect(graph.nodes).toHaveLength(1);
			expect(graph.nodes[0].id).toBe("unrelated");
			expect(graph.edges).toHaveLength(0);
		});

		it("should not remove unrelated memory nodes", () => {
			const scope: MemoryScope = { type: "global" };
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("memory-global", "memory"),
					makeNode("memory-project-/other", "memory"),
				],
				edges: [],
			};

			removeMemoryFromGraph(graph, scope);

			expect(graph.nodes).toHaveLength(1);
			expect(graph.nodes[0].id).toBe("memory-project-/other");
		});
	});
});
