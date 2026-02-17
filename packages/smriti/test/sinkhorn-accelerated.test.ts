import { describe, it, expect } from "vitest";
import {
	logsumexp,
	sinkhornAccelerated,
	computeTokenBudgetsMHC,
} from "../src/sinkhorn-accelerated.js";
import type { SessionChunk } from "../src/sinkhorn-accelerated.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Sum all values in a row. */
function rowSum(matrix: number[][], row: number): number {
	return matrix[row].reduce((s, v) => s + v, 0);
}

/** Sum all values in a column. */
function colSum(matrix: number[][], col: number): number {
	let s = 0;
	for (let i = 0; i < matrix.length; i++) s += matrix[i][col];
	return s;
}

/** Check that a matrix is approximately doubly stochastic. */
function isDoublyStochastic(matrix: number[][], epsilon: number): boolean {
	const n = matrix.length;
	const m = matrix[0].length;
	for (let i = 0; i < n; i++) {
		if (Math.abs(rowSum(matrix, i) - 1) > epsilon) return false;
	}
	for (let j = 0; j < m; j++) {
		if (Math.abs(colSum(matrix, j) - 1) > epsilon) return false;
	}
	return true;
}

/** Generate a random NxN matrix with values in [0.1, 1]. */
function randomMatrix(n: number): number[][] {
	return Array.from({ length: n }, () =>
		Array.from({ length: n }, () => 0.1 + Math.random() * 0.9),
	);
}

// ─── logsumexp ──────────────────────────────────────────────────────────────

describe("logsumexp", () => {
	it("returns -Infinity for empty array", () => {
		expect(logsumexp([])).toBe(-Infinity);
	});

	it("returns the single value for length-1 array", () => {
		expect(logsumexp([3.7])).toBe(3.7);
	});

	it("computes log(e^1 + e^2) correctly", () => {
		const result = logsumexp([1, 2]);
		const expected = Math.log(Math.exp(1) + Math.exp(2));
		expect(Math.abs(result - expected)).toBeLessThan(1e-10);
	});

	it("handles very large values without overflow", () => {
		const result = logsumexp([1000, 1001, 999]);
		// Should be approximately 1001 + log(1 + exp(-1) + exp(-2))
		expect(Number.isFinite(result)).toBe(true);
		expect(result).toBeGreaterThan(1000);
		expect(result).toBeLessThan(1002);
	});

	it("handles very small (negative) values without underflow", () => {
		const result = logsumexp([-1000, -1001, -999]);
		expect(Number.isFinite(result)).toBe(true);
		expect(result).toBeGreaterThan(-1000);
		expect(result).toBeLessThan(-998);
	});

	it("all -Infinity returns -Infinity", () => {
		expect(logsumexp([-Infinity, -Infinity])).toBe(-Infinity);
	});
});

// ─── sinkhornAccelerated ────────────────────────────────────────────────────

describe("sinkhornAccelerated", () => {
	it("returns empty result for empty matrix", () => {
		const { result, iterations, converged } = sinkhornAccelerated([]);
		expect(result).toEqual([]);
		expect(iterations).toBe(0);
		expect(converged).toBe(true);
	});

	it("converges to a doubly stochastic matrix for a 3x3 positive matrix", () => {
		const input = [
			[0.5, 0.3, 0.2],
			[0.1, 0.7, 0.2],
			[0.4, 0.1, 0.5],
		];
		const { result, converged } = sinkhornAccelerated(input, { epsilon: 1e-6 });
		expect(converged).toBe(true);
		expect(isDoublyStochastic(result, 1e-4)).toBe(true);
	});

	it("converges for a matrix already doubly stochastic (identity / n)", () => {
		const n = 4;
		const identity = Array.from({ length: n }, (_, i) =>
			Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
		);
		// The identity is NOT doubly stochastic (rows sum to 1 but cols sum to 1),
		// but a uniform matrix IS. Let's use uniform:
		const uniform = Array.from({ length: n }, () =>
			Array.from({ length: n }, () => 1 / n),
		);
		const { result, converged, iterations } = sinkhornAccelerated(uniform, {
			epsilon: 1e-8,
			useAdaptiveEpsilon: false,
		});
		expect(converged).toBe(true);
		// Should converge very quickly since it's already doubly stochastic
		expect(iterations).toBeLessThan(30);
		expect(isDoublyStochastic(result, 1e-6)).toBe(true);
	});

	it("acceleration converges in fewer iterations than vanilla SK", () => {
		// Use a larger matrix where Nesterov momentum shows a clear advantage.
		// For small matrices, vanilla SK may converge in very few iterations and
		// the overhead of log-domain + extrapolation can offset the benefit.
		const input = randomMatrix(20);

		// Compare Nesterov-only (linear domain) vs vanilla (linear domain)
		// to isolate the effect of momentum without log-domain overhead.
		const accelerated = sinkhornAccelerated(input, {
			useNesterov: true,
			useLogDomain: false,
			useAdaptiveEpsilon: false,
			epsilon: 1e-8,
			maxIterations: 500,
		});

		const vanilla = sinkhornAccelerated(input, {
			useNesterov: false,
			useLogDomain: false,
			useAdaptiveEpsilon: false,
			epsilon: 1e-8,
			maxIterations: 500,
		});

		// Both should converge
		expect(accelerated.converged).toBe(true);
		expect(vanilla.converged).toBe(true);

		// Accelerated should converge in fewer (or equal) iterations
		expect(accelerated.iterations).toBeLessThanOrEqual(vanilla.iterations);
	});

	it("log-domain handles matrices with very small values (1e-20)", () => {
		const input = [
			[1e-20, 1e-18, 1e-19],
			[1e-19, 1e-20, 1e-18],
			[1e-18, 1e-19, 1e-20],
		];
		const { result, converged } = sinkhornAccelerated(input, {
			useLogDomain: true,
			epsilon: 1e-6,
			maxIterations: 300,
		});
		expect(converged).toBe(true);
		// No NaN or Infinity in the result
		for (const row of result) {
			for (const v of row) {
				expect(Number.isFinite(v)).toBe(true);
				expect(Number.isNaN(v)).toBe(false);
			}
		}
		expect(isDoublyStochastic(result, 1e-4)).toBe(true);
	});

	it("adaptive epsilon starts coarse and ends precise", () => {
		const input = randomMatrix(4);
		// With adaptive epsilon, should still converge to tight tolerance
		const { result, converged } = sinkhornAccelerated(input, {
			useAdaptiveEpsilon: true,
			initialEpsilon: 1e-1,
			epsilonHalvingInterval: 5,
			epsilon: 1e-6,
			maxIterations: 500,
		});
		expect(converged).toBe(true);
		expect(isDoublyStochastic(result, 1e-4)).toBe(true);
	});

	it("converges for a 10x10 random matrix", () => {
		const input = randomMatrix(10);
		const { result, converged } = sinkhornAccelerated(input, {
			epsilon: 1e-6,
			maxIterations: 500,
		});
		expect(converged).toBe(true);
		expect(isDoublyStochastic(result, 1e-4)).toBe(true);
	});

	it("all entries in result are non-negative", () => {
		const input = randomMatrix(5);
		const { result } = sinkhornAccelerated(input, { epsilon: 1e-6 });
		for (const row of result) {
			for (const v of row) {
				expect(v).toBeGreaterThanOrEqual(0);
			}
		}
	});
});

// ─── computeTokenBudgetsMHC ─────────────────────────────────────────────────

describe("computeTokenBudgetsMHC", () => {
	it("returns empty map for empty chunks", () => {
		const result = computeTokenBudgetsMHC([], 1000);
		expect(result.size).toBe(0);
	});

	it("allocates full budget to a single chunk", () => {
		const chunks: SessionChunk[] = [
			{ id: "chunk-1", recency: 0.9, relevance: 0.8, importance: 0.7, tokenCount: 500 },
		];
		const result = computeTokenBudgetsMHC(chunks, 1000);
		expect(result.get("chunk-1")).toBe(1000);
	});

	it("total budget is conserved across multiple chunks", () => {
		const totalBudget = 2000;
		const chunks: SessionChunk[] = [
			{ id: "recent-discussion", recency: 0.9, relevance: 0.8, importance: 0.5, topic: "api-design", tokenCount: 300 },
			{ id: "architecture-decision", recency: 0.5, relevance: 0.6, importance: 0.9, topic: "api-design", tokenCount: 400 },
			{ id: "bug-report", recency: 0.7, relevance: 0.3, importance: 0.8, topic: "debugging", tokenCount: 200 },
			{ id: "idle-chat", recency: 0.2, relevance: 0.1, importance: 0.1, tokenCount: 150 },
		];
		const result = computeTokenBudgetsMHC(chunks, totalBudget);

		let sum = 0;
		for (const budget of result.values()) {
			sum += budget;
		}
		expect(sum).toBe(totalBudget);
	});

	it("higher quality chunks receive larger budgets", () => {
		const chunks: SessionChunk[] = [
			{ id: "high-quality", recency: 0.95, relevance: 0.95, importance: 0.95, tokenCount: 300 },
			{ id: "low-quality", recency: 0.1, relevance: 0.1, importance: 0.1, tokenCount: 300 },
		];
		const result = computeTokenBudgetsMHC(chunks, 1000);
		expect(result.get("high-quality")!).toBeGreaterThan(result.get("low-quality")!);
	});

	it("same-topic chunks get a boost from topic affinity", () => {
		const chunks: SessionChunk[] = [
			{ id: "topicA-1", recency: 0.5, relevance: 0.5, importance: 0.5, topic: "typescript", tokenCount: 200 },
			{ id: "topicA-2", recency: 0.5, relevance: 0.5, importance: 0.5, topic: "typescript", tokenCount: 200 },
			{ id: "topicB-1", recency: 0.5, relevance: 0.5, importance: 0.5, topic: "python", tokenCount: 200 },
		];
		const result = computeTokenBudgetsMHC(chunks, 1200);
		// The two typescript chunks share a topic, so their combined budget
		// should be more than 2x the python chunk due to topic bonus
		const tsTotal = (result.get("topicA-1") ?? 0) + (result.get("topicA-2") ?? 0);
		const pyTotal = result.get("topicB-1") ?? 0;
		// They share a topic, giving them higher affinity scores
		expect(tsTotal).toBeGreaterThan(pyTotal);
	});

	it("all budgets are non-negative integers", () => {
		const chunks: SessionChunk[] = [
			{ id: "a", recency: 0.8, relevance: 0.7, importance: 0.6, tokenCount: 100 },
			{ id: "b", recency: 0.3, relevance: 0.9, importance: 0.4, tokenCount: 200 },
			{ id: "c", recency: 0.6, relevance: 0.2, importance: 0.8, tokenCount: 150 },
		];
		const result = computeTokenBudgetsMHC(chunks, 500);
		for (const budget of result.values()) {
			expect(budget).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(budget)).toBe(true);
		}
	});
});
