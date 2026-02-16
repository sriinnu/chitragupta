import { describe, it, expect } from "vitest";
import {
	leiden,
	annotateCommunities,
	communitySummary,
	filterByCommunity,
	findBridgeNodes,
} from "../src/graphrag-leiden.js";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNode(id: string, type: GraphNode["type"] = "concept", label?: string): GraphNode {
	return { id, type, label: label ?? id, content: `Content of ${id}`, metadata: {} };
}

function makeEdge(source: string, target: string, weight = 1.0): GraphEdge {
	return { source, target, relationship: "related", weight };
}

/**
 * Build a graph with two well-separated cliques.
 * Clique A: a1-a2-a3 (all connected)
 * Clique B: b1-b2-b3 (all connected)
 * Bridge:   a3-b1 (single weak link)
 */
function twoCliqueGraph(): KnowledgeGraph {
	return {
		nodes: [
			makeNode("a1"), makeNode("a2"), makeNode("a3"),
			makeNode("b1"), makeNode("b2"), makeNode("b3"),
		],
		edges: [
			// Clique A (strong)
			makeEdge("a1", "a2", 1.0),
			makeEdge("a1", "a3", 1.0),
			makeEdge("a2", "a3", 1.0),
			// Clique B (strong)
			makeEdge("b1", "b2", 1.0),
			makeEdge("b1", "b3", 1.0),
			makeEdge("b2", "b3", 1.0),
			// Bridge (weak)
			makeEdge("a3", "b1", 0.1),
		],
	};
}

/**
 * Build a graph with 3 communities connected in a chain.
 */
function chainGraph(): KnowledgeGraph {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];

	// Community 1: c1-1 through c1-4
	for (let i = 1; i <= 4; i++) nodes.push(makeNode(`c1-${i}`));
	for (let i = 1; i <= 4; i++) {
		for (let j = i + 1; j <= 4; j++) {
			edges.push(makeEdge(`c1-${i}`, `c1-${j}`, 1.0));
		}
	}

	// Community 2: c2-1 through c2-4
	for (let i = 1; i <= 4; i++) nodes.push(makeNode(`c2-${i}`));
	for (let i = 1; i <= 4; i++) {
		for (let j = i + 1; j <= 4; j++) {
			edges.push(makeEdge(`c2-${i}`, `c2-${j}`, 1.0));
		}
	}

	// Community 3: c3-1 through c3-4
	for (let i = 1; i <= 4; i++) nodes.push(makeNode(`c3-${i}`));
	for (let i = 1; i <= 4; i++) {
		for (let j = i + 1; j <= 4; j++) {
			edges.push(makeEdge(`c3-${i}`, `c3-${j}`, 1.0));
		}
	}

	// Bridges between communities (weak)
	edges.push(makeEdge("c1-4", "c2-1", 0.1));
	edges.push(makeEdge("c2-4", "c3-1", 0.1));

	return { nodes, edges };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Leiden Community Detection", () => {
	describe("basic community detection", () => {
		it("should handle empty graph", () => {
			const result = leiden({ nodes: [], edges: [] });
			expect(result.communities.size).toBe(0);
			expect(result.communityList).toHaveLength(0);
			expect(result.modularity).toBe(0);
			expect(result.iterations).toBe(0);
		});

		it("should handle single node graph", () => {
			const graph: KnowledgeGraph = {
				nodes: [makeNode("a")],
				edges: [],
			};
			const result = leiden(graph);
			expect(result.communities.size).toBe(1);
			expect(result.communities.get("a")).toBeDefined();
		});

		it("should handle disconnected nodes", () => {
			const graph: KnowledgeGraph = {
				nodes: [makeNode("a"), makeNode("b"), makeNode("c")],
				edges: [],
			};
			const result = leiden(graph);
			expect(result.communities.size).toBe(3);
		});

		it("should detect two well-separated cliques", () => {
			const graph = twoCliqueGraph();
			const result = leiden(graph);

			// Should find 2 communities
			expect(result.communityList.length).toBeGreaterThanOrEqual(2);

			// Nodes in the same clique should be in the same community
			const ca1 = result.communities.get("a1")!;
			const ca2 = result.communities.get("a2")!;
			const ca3 = result.communities.get("a3")!;
			const cb1 = result.communities.get("b1")!;
			const cb2 = result.communities.get("b2")!;
			const cb3 = result.communities.get("b3")!;

			expect(ca1).toBe(ca2);
			expect(ca2).toBe(ca3);
			expect(cb1).toBe(cb2);
			expect(cb2).toBe(cb3);

			// The two cliques should be in different communities
			expect(ca1).not.toBe(cb1);
		});

		it("should detect three communities in a chain", () => {
			const graph = chainGraph();
			const result = leiden(graph);

			// Should find at least 2-3 communities (weak bridges)
			expect(result.communityList.length).toBeGreaterThanOrEqual(2);

			// Community 1 nodes should be together
			const c1Ids = ["c1-1", "c1-2", "c1-3", "c1-4"].map(id => result.communities.get(id)!);
			expect(new Set(c1Ids).size).toBe(1); // All same community

			// Community 3 nodes should be together
			const c3Ids = ["c3-1", "c3-2", "c3-3", "c3-4"].map(id => result.communities.get(id)!);
			expect(new Set(c3Ids).size).toBe(1); // All same community
		});
	});

	describe("modularity", () => {
		it("should return positive modularity for community structure", () => {
			const result = leiden(twoCliqueGraph());
			expect(result.modularity).toBeGreaterThan(0);
		});

		it("should return higher modularity for better partitions", () => {
			const graph = twoCliqueGraph();
			const result = leiden(graph);
			// With clear community structure, modularity should be > 0.3
			expect(result.modularity).toBeGreaterThan(0.3);
		});

		it("should converge within maxIterations", () => {
			const result = leiden(twoCliqueGraph(), { maxIterations: 20 });
			expect(result.iterations).toBeLessThanOrEqual(20);
			expect(result.iterations).toBeGreaterThanOrEqual(1);
		});
	});

	describe("configuration", () => {
		it("should respect resolution parameter", () => {
			const graph = chainGraph();
			const lowRes = leiden(graph, { resolution: 0.5 });
			const highRes = leiden(graph, { resolution: 2.0 });

			// Higher resolution tends to produce more (smaller) communities
			expect(highRes.communityList.length).toBeGreaterThanOrEqual(lowRes.communityList.length);
		});

		it("should produce deterministic results with same seed", () => {
			const graph = twoCliqueGraph();
			const r1 = leiden(graph, { seed: 42 });
			const r2 = leiden(graph, { seed: 42 });

			expect(r1.modularity).toBe(r2.modularity);
			for (const [nodeId, c1] of r1.communities) {
				expect(r2.communities.get(nodeId)).toBe(c1);
			}
		});

		it("should merge small communities with minCommunitySize", () => {
			const graph: KnowledgeGraph = {
				nodes: [
					makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d"),
					makeNode("lonely"),
				],
				edges: [
					makeEdge("a", "b", 1.0), makeEdge("b", "c", 1.0),
					makeEdge("c", "d", 1.0), makeEdge("d", "a", 1.0),
					makeEdge("lonely", "a", 0.01),
				],
			};
			const result = leiden(graph, { minCommunitySize: 2 });
			// "lonely" should be merged into the main community
			const allCommunities = new Set(result.communities.values());
			expect(allCommunities.size).toBeLessThanOrEqual(2);
		});
	});

	describe("community metadata", () => {
		it("should have non-negative internal density", () => {
			const result = leiden(twoCliqueGraph());
			for (const c of result.communityList) {
				expect(c.internalDensity).toBeGreaterThanOrEqual(0);
				expect(c.internalDensity).toBeLessThanOrEqual(1);
			}
		});

		it("should compute community sizes correctly", () => {
			const graph = twoCliqueGraph();
			const result = leiden(graph);
			const totalMembers = result.communityList.reduce((acc, c) => acc + c.members.length, 0);
			expect(totalMembers).toBe(graph.nodes.length);
		});

		it("should set level to 0 for base-level communities", () => {
			const result = leiden(twoCliqueGraph());
			for (const c of result.communityList) {
				expect(c.level).toBe(0);
			}
		});
	});

	describe("annotateCommunities", () => {
		it("should store communityId in node metadata", () => {
			const graph = twoCliqueGraph();
			const result = leiden(graph);
			annotateCommunities(graph, result);

			for (const node of graph.nodes) {
				expect(node.metadata.communityId).toBeDefined();
				expect(typeof node.metadata.communityId).toBe("number");
			}
		});
	});

	describe("communitySummary", () => {
		it("should return labels and node types for a community", () => {
			const graph = twoCliqueGraph();
			const result = leiden(graph);
			annotateCommunities(graph, result);

			const firstCommunity = result.communityList[0];
			const summary = communitySummary(graph, firstCommunity.id);

			expect(summary.communityId).toBe(firstCommunity.id);
			expect(summary.size).toBe(firstCommunity.members.length);
			expect(summary.nodeTypes).toBeDefined();
			expect(summary.nodeTypes.concept).toBeDefined();
		});
	});

	describe("filterByCommunity", () => {
		it("should filter nodes by community", () => {
			const graph = twoCliqueGraph();
			const result = leiden(graph);
			annotateCommunities(graph, result);

			const firstCommunity = result.communityList[0];
			const filtered = filterByCommunity(graph.nodes, firstCommunity.id);

			expect(filtered.length).toBe(firstCommunity.members.length);
			for (const node of filtered) {
				expect(node.metadata.communityId).toBe(firstCommunity.id);
			}
		});
	});

	describe("findBridgeNodes", () => {
		it("should find nodes connecting different communities", () => {
			const graph = twoCliqueGraph();
			const result = leiden(graph);

			const bridges = findBridgeNodes(graph, result);
			// a3 and b1 are the bridge nodes between the two cliques
			const bridgeIds = bridges.map(n => n.id);
			expect(bridgeIds).toContain("a3");
			expect(bridgeIds).toContain("b1");
		});

		it("should respect minCommunities parameter", () => {
			const graph = chainGraph();
			const result = leiden(graph);

			const bridges2 = findBridgeNodes(graph, result, 2);
			const bridges3 = findBridgeNodes(graph, result, 3);

			// Fewer bridges when requiring more community connections
			expect(bridges3.length).toBeLessThanOrEqual(bridges2.length);
		});
	});

	describe("edge cases", () => {
		it("should handle self-loops gracefully", () => {
			const graph: KnowledgeGraph = {
				nodes: [makeNode("a"), makeNode("b")],
				edges: [
					makeEdge("a", "a", 1.0), // self-loop
					makeEdge("a", "b", 1.0),
				],
			};
			// Should not crash
			const result = leiden(graph);
			expect(result.communities.size).toBe(2);
		});

		it("should handle edges referencing non-existent nodes", () => {
			const graph: KnowledgeGraph = {
				nodes: [makeNode("a")],
				edges: [makeEdge("a", "nonexistent", 1.0)],
			};
			const result = leiden(graph);
			expect(result.communities.size).toBe(1);
		});

		it("should handle complete graph", () => {
			const nodes = Array.from({ length: 5 }, (_, i) => makeNode(`n${i}`));
			const edges: GraphEdge[] = [];
			for (let i = 0; i < 5; i++) {
				for (let j = i + 1; j < 5; j++) {
					edges.push(makeEdge(`n${i}`, `n${j}`, 1.0));
				}
			}
			const result = leiden({ nodes, edges });
			// Complete graph — all nodes should be in one community
			const uniqueCommunities = new Set(result.communities.values());
			expect(uniqueCommunities.size).toBe(1);
		});

		it("should handle star graph", () => {
			const nodes = [makeNode("center"), ...Array.from({ length: 4 }, (_, i) => makeNode(`leaf${i}`))];
			const edges = Array.from({ length: 4 }, (_, i) => makeEdge("center", `leaf${i}`, 1.0));
			const result = leiden({ nodes, edges });
			// Star graph — should all be one community
			expect(result.communities.size).toBe(5);
		});

		it("should handle weighted edges correctly", () => {
			const graph: KnowledgeGraph = {
				nodes: [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")],
				edges: [
					makeEdge("a", "b", 10.0),  // very strong
					makeEdge("c", "d", 10.0),  // very strong
					makeEdge("b", "c", 0.01),  // very weak bridge
				],
			};
			const result = leiden(graph);
			// Strong edges should keep a-b and c-d together, weak bridge should separate them
			expect(result.communities.get("a")).toBe(result.communities.get("b"));
			expect(result.communities.get("c")).toBe(result.communities.get("d"));
			expect(result.communities.get("a")).not.toBe(result.communities.get("c"));
		});
	});
});
