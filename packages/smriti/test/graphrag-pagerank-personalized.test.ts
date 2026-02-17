import { describe, it, expect } from "vitest";
import {
	computePersonalizedPageRank,
	IncrementalPageRank,
} from "../src/graphrag-pagerank-personalized.js";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "../src/types.js";

// ─── Graph Builders ─────────────────────────────────────────────────────────

function makeNode(id: string, content: string = ""): GraphNode {
	return { id, type: "concept", label: id, content, metadata: {} };
}

function makeEdge(source: string, target: string, weight: number = 1): GraphEdge {
	return { source, target, relationship: "related", weight };
}

/**
 * Build a simple 3-node triangle: A -> B -> C -> A.
 */
function triangleGraph(): KnowledgeGraph {
	return {
		nodes: [makeNode("A", "memory management"), makeNode("B", "session store"), makeNode("C", "graph engine")],
		edges: [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "A")],
	};
}

/**
 * Build a star graph: center node with N leaf nodes connected outward.
 */
function starGraph(center: string, leaves: string[]): KnowledgeGraph {
	const nodes = [makeNode(center, "hub node"), ...leaves.map((l) => makeNode(l, `leaf ${l}`))];
	const edges = leaves.map((l) => makeEdge(center, l));
	return { nodes, edges };
}

/**
 * Build a disconnected graph with two components.
 */
function disconnectedGraph(): KnowledgeGraph {
	return {
		nodes: [
			makeNode("A1", "component one alpha"),
			makeNode("A2", "component one beta"),
			makeNode("B1", "component two alpha"),
			makeNode("B2", "component two beta"),
		],
		edges: [
			makeEdge("A1", "A2"),
			makeEdge("A2", "A1"),
			makeEdge("B1", "B2"),
			makeEdge("B2", "B1"),
		],
	};
}

// ─── computePersonalizedPageRank ────────────────────────────────────────────

describe("computePersonalizedPageRank", () => {
	it("returns empty map for empty graph", () => {
		const graph: KnowledgeGraph = { nodes: [], edges: [] };
		const ranks = computePersonalizedPageRank(graph);
		expect(ranks.size).toBe(0);
	});

	it("returns rank 1.0 for a single isolated node", () => {
		const graph: KnowledgeGraph = {
			nodes: [makeNode("solo", "only node")],
			edges: [],
		};
		const ranks = computePersonalizedPageRank(graph);
		expect(ranks.size).toBe(1);
		// A single dangling node gets all the rank
		expect(ranks.get("solo")!).toBeGreaterThan(0.5);
	});

	it("uniform bias produces standard PageRank (symmetric graph has equal ranks)", () => {
		const graph = triangleGraph();
		const ranks = computePersonalizedPageRank(graph, undefined, {
			damping: 0.85,
			epsilon: 1e-8,
		});

		// In a symmetric cycle A->B->C->A, all nodes should have approximately equal rank
		const rankA = ranks.get("A")!;
		const rankB = ranks.get("B")!;
		const rankC = ranks.get("C")!;
		expect(Math.abs(rankA - rankB)).toBeLessThan(0.01);
		expect(Math.abs(rankB - rankC)).toBeLessThan(0.01);
	});

	it("topic bias shifts ranks toward biased nodes", () => {
		const graph: KnowledgeGraph = {
			nodes: [
				makeNode("memory", "memory management and vector search"),
				makeNode("session", "session store and persistence"),
				makeNode("graph", "graph database and knowledge base"),
			],
			edges: [
				makeEdge("memory", "session"),
				makeEdge("session", "graph"),
				makeEdge("graph", "memory"),
			],
		};

		// Bias toward "memory" topic
		const biasedRanks = computePersonalizedPageRank(graph, "memory management vector", {
			damping: 0.85,
			epsilon: 1e-8,
		});

		// Uniform (standard) PR for comparison
		const uniformRanks = computePersonalizedPageRank(graph, undefined, {
			damping: 0.85,
			epsilon: 1e-8,
		});

		// The "memory" node should have a higher rank with topic bias than with uniform
		expect(biasedRanks.get("memory")!).toBeGreaterThan(uniformRanks.get("memory")!);
	});

	it("Gauss-Seidel converges to same result as Jacobi", () => {
		const graph = triangleGraph();

		const gsRanks = computePersonalizedPageRank(graph, undefined, {
			useGaussSeidel: true,
			epsilon: 1e-8,
			maxIterations: 200,
		});

		const jacobiRanks = computePersonalizedPageRank(graph, undefined, {
			useGaussSeidel: false,
			epsilon: 1e-8,
			maxIterations: 200,
		});

		for (const [id, gsRank] of gsRanks) {
			const jacobiRank = jacobiRanks.get(id)!;
			expect(Math.abs(gsRank - jacobiRank)).toBeLessThan(0.01);
		}
	});

	it("all ranks are non-negative", () => {
		const graph = starGraph("hub", ["leaf1", "leaf2", "leaf3", "leaf4"]);
		const ranks = computePersonalizedPageRank(graph, undefined, {
			epsilon: 1e-8,
		});
		for (const rank of ranks.values()) {
			expect(rank).toBeGreaterThanOrEqual(0);
		}
	});

	it("ranks sum to approximately 1 for a well-formed graph", () => {
		const graph = triangleGraph();
		const ranks = computePersonalizedPageRank(graph, undefined, {
			epsilon: 1e-8,
			maxIterations: 300,
		});
		let total = 0;
		for (const rank of ranks.values()) total += rank;
		expect(Math.abs(total - 1.0)).toBeLessThan(0.05);
	});

	it("disconnected graph distributes rank within components", () => {
		const graph = disconnectedGraph();
		const ranks = computePersonalizedPageRank(graph, undefined, {
			epsilon: 1e-8,
		});

		// Both components should have approximately equal total rank
		const comp1 = (ranks.get("A1") ?? 0) + (ranks.get("A2") ?? 0);
		const comp2 = (ranks.get("B1") ?? 0) + (ranks.get("B2") ?? 0);
		expect(Math.abs(comp1 - comp2)).toBeLessThan(0.05);
	});

	it("accepts a Map as topic bias", () => {
		const graph = triangleGraph();
		const bias = new Map<string, number>([
			["A", 0.8],
			["B", 0.1],
			["C", 0.1],
		]);
		const ranks = computePersonalizedPageRank(graph, bias, {
			epsilon: 1e-8,
		});

		// Node A should have the highest rank due to strong teleportation bias
		expect(ranks.get("A")!).toBeGreaterThan(ranks.get("B")!);
		expect(ranks.get("A")!).toBeGreaterThan(ranks.get("C")!);
	});
});

// ─── IncrementalPageRank ────────────────────────────────────────────────────

describe("IncrementalPageRank", () => {
	it("incremental add gives approximately same result as full recompute", () => {
		// Start with a triangle graph
		const graph = triangleGraph();
		const incr = new IncrementalPageRank(0.85, 1e-6);
		incr.initialize(graph);

		// Add edge C -> B
		incr.addEdge("C", "B");

		// Full recompute with the new edge
		const fullGraph: KnowledgeGraph = {
			nodes: graph.nodes,
			edges: [...graph.edges, makeEdge("C", "B")],
		};
		const fullRanks = computePersonalizedPageRank(fullGraph, undefined, {
			damping: 0.85,
			epsilon: 1e-6,
		});

		const incrRanks = incr.getRanks();

		for (const [id, fullRank] of fullRanks) {
			const incrRank = incrRanks.get(id) ?? 0;
			// Allow tolerance due to incremental approximation
			expect(Math.abs(fullRank - incrRank)).toBeLessThan(0.1);
		}
	});

	it("getRanks returns a copy (not the internal map)", () => {
		const graph = triangleGraph();
		const incr = new IncrementalPageRank();
		incr.initialize(graph);

		const ranks1 = incr.getRanks();
		const ranks2 = incr.getRanks();
		expect(ranks1).not.toBe(ranks2); // different references
		expect(ranks1.get("A")).toBe(ranks2.get("A")); // same values
	});

	it("handles adding edges to new nodes", () => {
		const graph = triangleGraph();
		const incr = new IncrementalPageRank(0.85, 1e-6);
		incr.initialize(graph);

		// Add edge from A to a brand-new node D
		incr.addEdge("A", "D");
		const ranks = incr.getRanks();

		expect(ranks.has("D")).toBe(true);
		expect(ranks.get("D")!).toBeGreaterThan(0);
	});

	it("remove edge changes ranks", () => {
		const graph = triangleGraph();
		const incr = new IncrementalPageRank(0.85, 1e-6);
		incr.initialize(graph);

		const ranksBefore = incr.getRanks();
		const bBefore = ranksBefore.get("B") ?? 0;

		// Remove the edge A -> B, so B loses incoming from A
		incr.removeEdge("A", "B");
		const ranksAfter = incr.getRanks();
		const bAfter = ranksAfter.get("B") ?? 0;

		// B should have less rank after losing an incoming edge
		expect(bAfter).toBeLessThan(bBefore);
	});
});
