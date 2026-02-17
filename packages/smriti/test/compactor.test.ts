import { describe, it, expect, vi } from "vitest";
import {
	buildAffinityMatrix,
	sinkhornKnopp,
	computeTokenBudgets,
} from "../src/sinkhorn-knopp.js";
import type { StreamSignals } from "../src/types.js";

/**
 * The SessionCompactor relies heavily on file system operations and Ollama.
 * We test the core math (affinity matrix, Sinkhorn-Knopp, budgets) directly
 * since those are the computational heart of compaction.
 */

describe("buildAffinityMatrix", () => {
	it("should produce a 4x4 matrix from stream signals", () => {
		const signals: StreamSignals = {
			identity: ["preference-1", "preference-2"],
			projects: ["project context"],
			tasks: ["task-1", "task-2", "task-3"],
			flow: ["active thread"],
		};

		const matrix = buildAffinityMatrix(signals);
		expect(matrix).toHaveLength(4);
		for (const row of matrix) {
			expect(row).toHaveLength(4);
		}
	});

	it("should produce higher diagonal values for streams with more signals", () => {
		const signals: StreamSignals = {
			identity: ["a", "b", "c", "d", "e"], // Lots of identity signals
			projects: [],
			tasks: ["one"],
			flow: [],
		};

		const matrix = buildAffinityMatrix(signals);
		// Identity (index 0) diagonal should be higher than projects (index 1)
		expect(matrix[0][0]).toBeGreaterThan(matrix[1][1]);
	});

	it("should handle empty signals gracefully", () => {
		const signals: StreamSignals = {
			identity: [],
			projects: [],
			tasks: [],
			flow: [],
		};

		const matrix = buildAffinityMatrix(signals);
		expect(matrix).toHaveLength(4);
		// Should not throw; all diagonal values should be the same
	});
});

describe("sinkhornKnopp", () => {
	it("should produce a doubly stochastic matrix (rows and cols sum to ~1)", () => {
		const input = [
			[3, 1, 1, 1],
			[1, 2, 1, 1],
			[1, 1, 4, 1],
			[1, 1, 1, 2],
		];

		const { result, converged } = sinkhornKnopp(input);

		// Check each row sums to approximately 1
		for (let i = 0; i < result.length; i++) {
			const rowSum = result[i].reduce((a, b) => a + b, 0);
			expect(rowSum).toBeCloseTo(1.0, 1);
		}

		// Check each column sums to approximately 1
		for (let j = 0; j < result[0].length; j++) {
			let colSum = 0;
			for (let i = 0; i < result.length; i++) {
				colSum += result[i][j];
			}
			expect(colSum).toBeCloseTo(1.0, 1);
		}
	});

	it("should handle a uniform matrix (already doubly stochastic)", () => {
		const input = [
			[1, 1, 1, 1],
			[1, 1, 1, 1],
			[1, 1, 1, 1],
			[1, 1, 1, 1],
		];

		const { result } = sinkhornKnopp(input);

		// Should be 0.25 everywhere
		for (let i = 0; i < 4; i++) {
			for (let j = 0; j < 4; j++) {
				expect(result[i][j]).toBeCloseTo(0.25, 1);
			}
		}
	});

	it("should handle a diagonal matrix", () => {
		const input = [
			[5, 0.01, 0.01, 0.01],
			[0.01, 3, 0.01, 0.01],
			[0.01, 0.01, 4, 0.01],
			[0.01, 0.01, 0.01, 2],
		];

		const { result } = sinkhornKnopp(input);

		// Should still produce a doubly stochastic matrix
		for (let i = 0; i < result.length; i++) {
			const rowSum = result[i].reduce((a, b) => a + b, 0);
			expect(rowSum).toBeCloseTo(1.0, 1);
		}
	});
});

describe("computeTokenBudgets", () => {
	it("should distribute budget proportional to mixing matrix diagonal", () => {
		const mixingMatrix = [
			[0.4, 0.2, 0.2, 0.2],
			[0.2, 0.3, 0.2, 0.3],
			[0.2, 0.2, 0.4, 0.2],
			[0.2, 0.3, 0.2, 0.3],
		];

		const totalBudget = 10_000;
		const budgets = computeTokenBudgets(mixingMatrix, totalBudget);

		expect(budgets).toHaveLength(4);
		// Sum should equal total budget
		const sum = budgets.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(totalBudget, -1); // Within rounding
	});

	it("should give no stream a zero budget", () => {
		const mixingMatrix = [
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
			[0.25, 0.25, 0.25, 0.25],
		];

		const budgets = computeTokenBudgets(mixingMatrix, 8000);
		for (const b of budgets) {
			expect(b).toBeGreaterThan(0);
		}
	});

	it("should allocate more to streams with higher self-affinity", () => {
		const mixingMatrix = [
			[0.7, 0.1, 0.1, 0.1],
			[0.1, 0.1, 0.1, 0.7],
			[0.1, 0.1, 0.7, 0.1],
			[0.1, 0.7, 0.1, 0.1],
		];

		const budgets = computeTokenBudgets(mixingMatrix, 10_000);
		// Stream 0 has highest self-affinity (0.7), should get the most
		expect(budgets[0]).toBeGreaterThan(budgets[1]);
	});
});
