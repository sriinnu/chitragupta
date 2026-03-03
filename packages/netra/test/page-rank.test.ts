import { describe, it, expect } from "vitest";
import { computePageRank, normalizeScores } from "../src/page-rank.js";

describe("computePageRank", () => {
	it("returns empty scores for an empty graph", () => {
		const result = computePageRank(new Map());
		expect(result.scores.size).toBe(0);
		expect(result.iterationsRun).toBe(0);
		expect(result.converged).toBe(true);
	});

	it("handles a single node with no edges", () => {
		const graph = new Map([["a.ts", []]]);
		const result = computePageRank(graph);
		expect(result.scores.get("a.ts")).toBeCloseTo(1.0, 3);
	});

	it("converges on a simple 3-node chain: A → B → C", () => {
		const graph = new Map<string, string[]>([
			["a.ts", ["b.ts"]],
			["b.ts", ["c.ts"]],
			["c.ts", []],
		]);
		const result = computePageRank(graph);

		// C is the sink — receives all flow. Should have highest rank.
		const scoreA = result.scores.get("a.ts")!;
		const scoreB = result.scores.get("b.ts")!;
		const scoreC = result.scores.get("c.ts")!;

		expect(scoreC).toBeGreaterThan(scoreB);
		expect(scoreB).toBeGreaterThan(scoreA);
		expect(result.converged).toBe(true);
	});

	it("ranks hub nodes highest in a star topology", () => {
		// Hub: all nodes import "core.ts"
		const graph = new Map<string, string[]>([
			["a.ts", ["core.ts"]],
			["b.ts", ["core.ts"]],
			["c.ts", ["core.ts"]],
			["d.ts", ["core.ts"]],
			["core.ts", []],
		]);
		const result = computePageRank(graph);

		const coreScore = result.scores.get("core.ts")!;
		const aScore = result.scores.get("a.ts")!;

		// Core should have the highest score
		expect(coreScore).toBeGreaterThan(aScore);
	});

	it("handles a cycle without diverging", () => {
		const graph = new Map<string, string[]>([
			["a.ts", ["b.ts"]],
			["b.ts", ["c.ts"]],
			["c.ts", ["a.ts"]],
		]);
		const result = computePageRank(graph);

		// In a perfect cycle, all scores should be equal (~1/3)
		const scoreA = result.scores.get("a.ts")!;
		const scoreB = result.scores.get("b.ts")!;
		const scoreC = result.scores.get("c.ts")!;

		expect(scoreA).toBeCloseTo(scoreB, 4);
		expect(scoreB).toBeCloseTo(scoreC, 4);
		expect(result.converged).toBe(true);
	});

	it("scores sum to approximately 1.0", () => {
		const graph = new Map<string, string[]>([
			["a.ts", ["b.ts", "c.ts"]],
			["b.ts", ["c.ts"]],
			["c.ts", []],
			["d.ts", ["a.ts"]],
		]);
		const result = computePageRank(graph);

		let total = 0;
		for (const score of result.scores.values()) {
			total += score;
		}
		expect(total).toBeCloseTo(1.0, 2);
	});

	it("respects custom damping factor", () => {
		const graph = new Map<string, string[]>([
			["a.ts", ["b.ts"]],
			["b.ts", []],
		]);
		const low = computePageRank(graph, { dampingFactor: 0.5 });
		const high = computePageRank(graph, { dampingFactor: 0.95 });

		// With higher damping, the gap between source and sink increases
		const gapLow = low.scores.get("b.ts")! - low.scores.get("a.ts")!;
		const gapHigh = high.scores.get("b.ts")! - high.scores.get("a.ts")!;

		expect(gapHigh).toBeGreaterThan(gapLow);
	});

	it("respects max iterations", () => {
		// Asymmetric graph that won't converge instantly
		const graph = new Map<string, string[]>([
			["a.ts", ["b.ts"]],
			["b.ts", ["c.ts"]],
			["c.ts", ["a.ts", "b.ts"]],
		]);
		const result = computePageRank(graph, { iterations: 2, convergenceThreshold: 1e-20 });
		expect(result.iterationsRun).toBe(2);
		expect(result.converged).toBe(false);
	});

	it("handles disconnected components", () => {
		const graph = new Map<string, string[]>([
			["a.ts", ["b.ts"]],
			["b.ts", []],
			["x.ts", ["y.ts"]],
			["y.ts", []],
		]);
		const result = computePageRank(graph);

		// Both sinks should have similar scores (symmetric graph)
		const scoreB = result.scores.get("b.ts")!;
		const scoreY = result.scores.get("y.ts")!;
		expect(scoreB).toBeCloseTo(scoreY, 4);
	});
});

describe("normalizeScores", () => {
	it("returns empty map for empty input", () => {
		const result = normalizeScores(new Map());
		expect(result.size).toBe(0);
	});

	it("normalizes to [0, 1] range", () => {
		const scores = new Map([
			["a.ts", 0.1],
			["b.ts", 0.5],
			["c.ts", 0.3],
		]);
		const result = normalizeScores(scores);

		expect(result.get("a.ts")).toBeCloseTo(0.0);
		expect(result.get("c.ts")).toBeCloseTo(0.5);
		expect(result.get("b.ts")).toBeCloseTo(1.0);
	});

	it("handles all-equal scores", () => {
		const scores = new Map([
			["a.ts", 0.5],
			["b.ts", 0.5],
		]);
		const result = normalizeScores(scores);

		// When all scores are equal, default to 0.5
		expect(result.get("a.ts")).toBeCloseTo(0.5);
		expect(result.get("b.ts")).toBeCloseTo(0.5);
	});

	it("handles single-entry map", () => {
		const scores = new Map([["a.ts", 0.42]]);
		const result = normalizeScores(scores);
		expect(result.get("a.ts")).toBeCloseTo(0.5);
	});
});
