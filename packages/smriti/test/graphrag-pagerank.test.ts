import { describe, it, expect } from "vitest";
import { computePageRank, getPageRank } from "../src/graphrag-pagerank.js";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "@chitragupta/smriti";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNode(id: string): GraphNode {
	return {
		id,
		type: "concept",
		label: id,
		content: `Content for ${id}`,
		metadata: {},
	};
}

function makeEdge(source: string, target: string, weight = 1): GraphEdge {
	return { source, target, relationship: "related", weight };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): KnowledgeGraph {
	return { nodes, edges };
}

// ─── computePageRank ─────────────────────────────────────────────────────────

describe("computePageRank", () => {
	it("should return empty map for empty graph", () => {
		const ranks = computePageRank({ nodes: [], edges: [] });
		expect(ranks.size).toBe(0);
	});

	it("should return 1.0 for a single-node graph", () => {
		const graph = makeGraph([makeNode("A")], []);
		const ranks = computePageRank(graph);
		expect(ranks.size).toBe(1);
		expect(ranks.get("A")).toBeCloseTo(1.0, 2);
	});

	it("should distribute rank evenly for a cycle", () => {
		// A -> B -> C -> A (cycle of 3)
		const graph = makeGraph(
			[makeNode("A"), makeNode("B"), makeNode("C")],
			[makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "A")],
		);
		const ranks = computePageRank(graph);

		// In a symmetric cycle, all ranks should be approximately equal
		const rankA = ranks.get("A")!;
		const rankB = ranks.get("B")!;
		const rankC = ranks.get("C")!;

		expect(rankA).toBeCloseTo(rankB, 2);
		expect(rankB).toBeCloseTo(rankC, 2);
	});

	it("should have all ranks sum to a consistent total", () => {
		const graph = makeGraph(
			[makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")],
			[
				makeEdge("A", "B"),
				makeEdge("B", "C"),
				makeEdge("C", "D"),
				makeEdge("D", "A"),
			],
		);
		const ranks = computePageRank(graph);
		let sum = 0;
		for (const rank of ranks.values()) sum += rank;
		// The sum of ranks should be positive and consistent
		expect(sum).toBeGreaterThan(0);
		// In a 4-cycle, all ranks should be approximately equal
		const rankA = ranks.get("A")!;
		const rankB = ranks.get("B")!;
		expect(rankA).toBeCloseTo(rankB, 2);
	});

	it("should give higher rank to nodes with more incoming links", () => {
		// A -> C, B -> C, C -> A
		// C receives links from both A and B, should have highest rank
		const graph = makeGraph(
			[makeNode("A"), makeNode("B"), makeNode("C")],
			[makeEdge("A", "C"), makeEdge("B", "C"), makeEdge("C", "A")],
		);
		const ranks = computePageRank(graph);
		expect(ranks.get("C")!).toBeGreaterThan(ranks.get("A")!);
		expect(ranks.get("C")!).toBeGreaterThan(ranks.get("B")!);
	});

	it("should handle dangling nodes (no outgoing edges)", () => {
		// A -> B, A -> C — B and C are dangling
		const graph = makeGraph(
			[makeNode("A"), makeNode("B"), makeNode("C")],
			[makeEdge("A", "B"), makeEdge("A", "C")],
		);
		const ranks = computePageRank(graph);

		// All nodes should have positive rank
		expect(ranks.get("A")!).toBeGreaterThan(0);
		expect(ranks.get("B")!).toBeGreaterThan(0);
		expect(ranks.get("C")!).toBeGreaterThan(0);
	});

	it("should handle disconnected components", () => {
		// Component 1: A -> B
		// Component 2: C -> D (no edges between components)
		const graph = makeGraph(
			[makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")],
			[makeEdge("A", "B"), makeEdge("C", "D")],
		);
		const ranks = computePageRank(graph);

		// All nodes should have positive rank due to damping factor
		for (const [, rank] of ranks) {
			expect(rank).toBeGreaterThan(0);
		}
	});

	it("should handle self-loops", () => {
		const graph = makeGraph(
			[makeNode("A"), makeNode("B")],
			[makeEdge("A", "A"), makeEdge("A", "B")],
		);
		const ranks = computePageRank(graph);
		expect(ranks.get("A")!).toBeGreaterThan(0);
		expect(ranks.get("B")!).toBeGreaterThan(0);
	});

	it("should ignore edges referencing non-existent nodes", () => {
		const graph = makeGraph(
			[makeNode("A"), makeNode("B")],
			[makeEdge("A", "B"), makeEdge("A", "Z"), makeEdge("Z", "B")],
		);
		const ranks = computePageRank(graph);
		expect(ranks.size).toBe(2);
		expect(ranks.has("Z")).toBe(false);
	});

	it("should handle a star topology (one hub, many spokes)", () => {
		// All spokes point to hub
		const nodes = [makeNode("hub"), ...Array.from({ length: 5 }, (_, i) => makeNode(`s${i}`))];
		const edges = Array.from({ length: 5 }, (_, i) => makeEdge(`s${i}`, "hub"));
		const graph = makeGraph(nodes, edges);
		const ranks = computePageRank(graph);

		// Hub should have the highest rank
		const hubRank = ranks.get("hub")!;
		for (let i = 0; i < 5; i++) {
			expect(hubRank).toBeGreaterThan(ranks.get(`s${i}`)!);
		}
	});

	it("should converge to stable values for a complete graph", () => {
		// Complete graph K4: every node connects to every other
		const nodes = ["A", "B", "C", "D"].map(makeNode);
		const edges: GraphEdge[] = [];
		for (const s of ["A", "B", "C", "D"]) {
			for (const t of ["A", "B", "C", "D"]) {
				if (s !== t) edges.push(makeEdge(s, t));
			}
		}
		const graph = makeGraph(nodes, edges);
		const ranks = computePageRank(graph);

		// In a complete graph, all ranks should be equal
		const rankA = ranks.get("A")!;
		const rankB = ranks.get("B")!;
		const rankC = ranks.get("C")!;
		const rankD = ranks.get("D")!;
		expect(rankA).toBeCloseTo(rankB, 3);
		expect(rankB).toBeCloseTo(rankC, 3);
		expect(rankC).toBeCloseTo(rankD, 3);
	});

	it("should produce all positive ranks", () => {
		const graph = makeGraph(
			[makeNode("A"), makeNode("B"), makeNode("C")],
			[makeEdge("A", "B")],
		);
		const ranks = computePageRank(graph);
		for (const [, rank] of ranks) {
			expect(rank).toBeGreaterThan(0);
		}
	});
});

// ─── getPageRank ─────────────────────────────────────────────────────────────

describe("getPageRank", () => {
	it("should return score for existing node", () => {
		const scores = new Map<string, number>([["A", 0.5], ["B", 0.3]]);
		expect(getPageRank(scores, "A")).toBe(0.5);
	});

	it("should return 0 for non-existent node", () => {
		const scores = new Map<string, number>([["A", 0.5]]);
		expect(getPageRank(scores, "Z")).toBe(0);
	});

	it("should return 0 for empty scores map", () => {
		expect(getPageRank(new Map(), "A")).toBe(0);
	});
});
