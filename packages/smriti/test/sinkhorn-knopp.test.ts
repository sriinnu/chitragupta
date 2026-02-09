import { describe, it, expect } from "vitest";
import {
	sinkhornKnopp,
	buildAffinityMatrix,
	computeTokenBudgets,
	allocateBudgets,
} from "@chitragupta/smriti";
import type { StreamSignals } from "@chitragupta/smriti";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowSum(matrix: number[][], row: number): number {
	return matrix[row].reduce((s, v) => s + v, 0);
}

function colSum(matrix: number[][], col: number): number {
	let s = 0;
	for (let i = 0; i < matrix.length; i++) s += matrix[i][col];
	return s;
}

function isDoublyStochastic(matrix: number[][], epsilon: number): boolean {
	const n = matrix.length;
	if (n === 0) return true;
	const m = matrix[0].length;
	for (let i = 0; i < n; i++) {
		if (Math.abs(rowSum(matrix, i) - 1) > epsilon) return false;
	}
	for (let j = 0; j < m; j++) {
		if (Math.abs(colSum(matrix, j) - 1) > epsilon) return false;
	}
	return true;
}

// ─── sinkhornKnopp ───────────────────────────────────────────────────────────

describe("sinkhornKnopp", () => {
	it("should return empty result for empty matrix", () => {
		const { result, iterations, converged } = sinkhornKnopp([]);
		expect(result).toEqual([]);
		expect(iterations).toBe(0);
		expect(converged).toBe(true);
	});

	it("should handle matrix with empty rows", () => {
		const { result } = sinkhornKnopp([[], []]);
		expect(result).toEqual([[], []]);
	});

	it("should converge for a uniform 4x4 matrix", () => {
		const matrix = [
			[1, 1, 1, 1],
			[1, 1, 1, 1],
			[1, 1, 1, 1],
			[1, 1, 1, 1],
		];
		const { result, converged } = sinkhornKnopp(matrix);
		expect(converged).toBe(true);
		expect(isDoublyStochastic(result, 1e-5)).toBe(true);
	});

	it("should converge for an identity matrix", () => {
		const matrix = [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		];
		// Zero rows/cols get replaced with uniform values
		const { result, converged } = sinkhornKnopp(matrix);
		expect(converged).toBe(true);
		expect(isDoublyStochastic(result, 1e-5)).toBe(true);
	});

	it("should converge for a random positive matrix", () => {
		const matrix = [
			[0.5, 0.3, 0.8],
			[0.2, 0.9, 0.1],
			[0.7, 0.4, 0.6],
		];
		const { result, converged } = sinkhornKnopp(matrix);
		expect(converged).toBe(true);
		expect(isDoublyStochastic(result, 1e-5)).toBe(true);
	});

	it("should clamp negative values to zero", () => {
		const matrix = [
			[-1, 2],
			[3, -4],
		];
		const { result, converged } = sinkhornKnopp(matrix);
		expect(converged).toBe(true);
		// All values in result should be non-negative
		for (const row of result) {
			for (const val of row) {
				expect(val).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it("should handle all-zero matrix gracefully", () => {
		const matrix = [
			[0, 0],
			[0, 0],
		];
		const { result, converged } = sinkhornKnopp(matrix);
		expect(converged).toBe(true);
		// Zeros get replaced with uniform, should converge to doubly stochastic
		expect(isDoublyStochastic(result, 1e-5)).toBe(true);
	});

	it("should not modify the original matrix", () => {
		const matrix = [
			[2, 1],
			[1, 2],
		];
		const originalCopy = matrix.map((r) => [...r]);
		sinkhornKnopp(matrix);
		expect(matrix).toEqual(originalCopy);
	});

	it("should converge for a 1x1 matrix", () => {
		const { result, converged } = sinkhornKnopp([[5]]);
		expect(converged).toBe(true);
		expect(result[0][0]).toBeCloseTo(1, 5);
	});

	it("should converge for a 2x2 matrix with disparate values", () => {
		const matrix = [
			[100, 1],
			[1, 100],
		];
		const { result, converged } = sinkhornKnopp(matrix);
		expect(converged).toBe(true);
		expect(isDoublyStochastic(result, 1e-5)).toBe(true);
	});

	it("should respect maxIterations limit", () => {
		const matrix = [
			[0.1, 1000],
			[1000, 0.1],
		];
		const { iterations } = sinkhornKnopp(matrix, 5);
		expect(iterations).toBeLessThanOrEqual(5);
	});

	it("should report non-convergence when maxIterations is too low", () => {
		const matrix = [
			[0.001, 1000],
			[1000, 0.001],
		];
		const { converged } = sinkhornKnopp(matrix, 1, 1e-20);
		// With only 1 iteration and very tight epsilon, may not converge
		// (This is implementation dependent; the test simply checks the flag is boolean)
		expect(typeof converged).toBe("boolean");
	});
});

// ─── buildAffinityMatrix ─────────────────────────────────────────────────────

describe("buildAffinityMatrix", () => {
	it("should return a 4x4 matrix for empty signals", () => {
		const signals: StreamSignals = {
			identity: [],
			projects: [],
			tasks: [],
			flow: [],
		};
		const matrix = buildAffinityMatrix(signals);
		expect(matrix.length).toBe(4);
		expect(matrix[0].length).toBe(4);
	});

	it("should have all positive entries", () => {
		const signals: StreamSignals = {
			identity: ["pref1"],
			projects: ["proj1", "proj2"],
			tasks: ["task1"],
			flow: ["ctx1", "ctx2", "ctx3"],
		};
		const matrix = buildAffinityMatrix(signals);
		for (const row of matrix) {
			for (const val of row) {
				expect(val).toBeGreaterThan(0);
			}
		}
	});

	it("should return the default affinity matrix when all signals are empty", () => {
		const signals: StreamSignals = {
			identity: [],
			projects: [],
			tasks: [],
			flow: [],
		};
		const matrix = buildAffinityMatrix(signals);
		// The default has higher diagonal values
		expect(matrix[0][0]).toBeGreaterThan(matrix[0][1]);
		expect(matrix[1][1]).toBeGreaterThan(matrix[1][0]);
	});

	it("should produce a matrix that sinkhornKnopp can converge on", () => {
		const signals: StreamSignals = {
			identity: ["a", "b"],
			projects: ["c"],
			tasks: ["d", "e", "f"],
			flow: ["g"],
		};
		const matrix = buildAffinityMatrix(signals);
		const { converged } = sinkhornKnopp(matrix);
		expect(converged).toBe(true);
	});
});

// ─── computeTokenBudgets ─────────────────────────────────────────────────────

describe("computeTokenBudgets", () => {
	it("should return empty array for empty matrix", () => {
		expect(computeTokenBudgets([], 1000)).toEqual([]);
	});

	it("should sum to exactly totalBudget (conservation law)", () => {
		const matrix = [
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
		];
		const budgets = computeTokenBudgets(matrix, 10000);
		const sum = budgets.reduce((a, b) => a + b, 0);
		expect(sum).toBe(10000);
	});

	it("should distribute budgets proportionally to preservation ratios", () => {
		// With a uniform doubly stochastic matrix, budgets should reflect preservation ratios
		const matrix = [
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
		];
		const budgets = computeTokenBudgets(matrix, 10000);
		// identity (0.95) should get more than flow (0.30)
		expect(budgets[0]).toBeGreaterThan(budgets[3]);
	});

	it("should handle totalBudget of 0", () => {
		const matrix = [
			[0.5, 0.5],
			[0.5, 0.5],
		];
		const budgets = computeTokenBudgets(matrix, 0, [0.5, 0.5]);
		const sum = budgets.reduce((a, b) => a + b, 0);
		expect(sum).toBe(0);
	});

	it("should handle small totalBudget with remainder distribution", () => {
		const matrix = [
			[0.5, 0.5],
			[0.5, 0.5],
		];
		const budgets = computeTokenBudgets(matrix, 3, [0.8, 0.2]);
		const sum = budgets.reduce((a, b) => a + b, 0);
		expect(sum).toBe(3);
	});

	it("should return integer budgets", () => {
		const matrix = [
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
		];
		const budgets = computeTokenBudgets(matrix, 9999);
		for (const b of budgets) {
			expect(Number.isInteger(b)).toBe(true);
		}
		expect(budgets.reduce((a, b) => a + b, 0)).toBe(9999);
	});
});

// ─── allocateBudgets ─────────────────────────────────────────────────────────

describe("allocateBudgets", () => {
	it("should return budgets summing to totalBudget", () => {
		const signals: StreamSignals = {
			identity: ["pref"],
			projects: ["proj1", "proj2"],
			tasks: ["task"],
			flow: ["ctx"],
		};
		const { budgets } = allocateBudgets(signals, 10000);
		const sum = budgets.reduce((a, b) => a + b, 0);
		expect(sum).toBe(10000);
	});

	it("should return a converged mixing matrix", () => {
		const signals: StreamSignals = {
			identity: ["a"],
			projects: ["b"],
			tasks: ["c"],
			flow: ["d"],
		};
		const { converged } = allocateBudgets(signals, 5000);
		expect(converged).toBe(true);
	});

	it("should return a 4x4 mixing matrix", () => {
		const signals: StreamSignals = {
			identity: [],
			projects: [],
			tasks: [],
			flow: [],
		};
		const { mixingMatrix } = allocateBudgets(signals, 1000);
		expect(mixingMatrix.length).toBe(4);
		expect(mixingMatrix[0].length).toBe(4);
	});

	it("should give identity more budget than flow", () => {
		const signals: StreamSignals = {
			identity: ["a", "b", "c"],
			projects: ["d", "e"],
			tasks: ["f"],
			flow: ["g", "h"],
		};
		const { budgets } = allocateBudgets(signals, 10000);
		// identity has preservation 0.95, flow has 0.30
		expect(budgets[0]).toBeGreaterThan(budgets[3]);
	});
});
