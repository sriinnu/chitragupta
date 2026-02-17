/**
 * @chitragupta/smriti — Sinkhorn-Knopp Algorithm for Doubly Stochastic Matrices.
 *
 * Implements the Sinkhorn-Knopp iteration to normalize a non-negative matrix
 * into a doubly stochastic matrix (all rows and columns sum to 1).
 *
 * From the mHC paper (arxiv:2512.24880):
 * The Sinkhorn-Knopp iteration produces a matrix in the Birkhoff Polytope
 * (the set of all doubly stochastic matrices), ensuring a conservation law:
 * total information budget is preserved across streams.
 *
 * Used for memory compaction: the mixing matrix determines how signals
 * from a session are distributed across the 4 memory streams.
 *
 * IMPORTANT: Sinkhorn-Knopp is for compaction only. Not for topic detection,
 * not for storage routing.
 */

import type { StreamSignals } from "./types.js";
import { STREAM_ORDER, PRESERVATION_RATIOS } from "./streams.js";

// ─── Sinkhorn-Knopp Core ────────────────────────────────────────────────────

/**
 * Normalize a non-negative matrix into a doubly stochastic matrix
 * using the Sinkhorn-Knopp iterative algorithm.
 *
 * Algorithm:
 *   1. Start with a non-negative matrix A.
 *   2. Alternately normalize rows (each row sums to 1)
 *      and columns (each column sums to 1).
 *   3. Repeat until convergence (max absolute row/column sum deviation < epsilon)
 *      or maxIterations is reached.
 *
 * A doubly stochastic matrix has all rows and columns summing to 1.
 * This lives in the Birkhoff Polytope — the convex hull of permutation matrices.
 *
 * @param matrix - Non-negative input matrix (NxN). Modified in-place via deep copy.
 * @param maxIterations - Maximum iteration count. Default: 100.
 * @param epsilon - Convergence threshold. Default: 1e-6.
 * @returns The doubly stochastic matrix, iteration count, and convergence flag.
 */
export function sinkhornKnopp(
	matrix: number[][],
	maxIterations: number = 100,
	epsilon: number = 1e-6,
): { result: number[][]; iterations: number; converged: boolean } {
	const n = matrix.length;
	if (n === 0) {
		return { result: [], iterations: 0, converged: true };
	}

	const m = matrix[0].length;
	if (m === 0) {
		return { result: matrix.map(() => []), iterations: 0, converged: true };
	}

	// Deep copy the input matrix to avoid mutation
	const A: number[][] = matrix.map((row) => [...row]);

	// Ensure all entries are non-negative. Clamp negatives to 0.
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < m; j++) {
			if (A[i][j] < 0) A[i][j] = 0;
		}
	}

	// Handle degenerate cases: if any row or column is all zeros,
	// replace with uniform values to avoid division by zero.
	for (let i = 0; i < n; i++) {
		const rowSum = A[i].reduce((s, v) => s + v, 0);
		if (rowSum === 0) {
			for (let j = 0; j < m; j++) {
				A[i][j] = 1 / m;
			}
		}
	}
	for (let j = 0; j < m; j++) {
		let colSum = 0;
		for (let i = 0; i < n; i++) {
			colSum += A[i][j];
		}
		if (colSum === 0) {
			for (let i = 0; i < n; i++) {
				A[i][j] = 1 / n;
			}
		}
	}

	let iterations = 0;
	let converged = false;

	for (let iter = 0; iter < maxIterations; iter++) {
		iterations = iter + 1;

		// Step 1: Normalize rows — each row sums to 1
		for (let i = 0; i < n; i++) {
			const rowSum = A[i].reduce((s, v) => s + v, 0);
			if (rowSum > 0) {
				for (let j = 0; j < m; j++) {
					A[i][j] /= rowSum;
				}
			}
		}

		// Step 2: Normalize columns — each column sums to 1
		for (let j = 0; j < m; j++) {
			let colSum = 0;
			for (let i = 0; i < n; i++) {
				colSum += A[i][j];
			}
			if (colSum > 0) {
				for (let i = 0; i < n; i++) {
					A[i][j] /= colSum;
				}
			}
		}

		// Check convergence: max deviation of any row or column sum from 1
		let maxDeviation = 0;

		for (let i = 0; i < n; i++) {
			const rowSum = A[i].reduce((s, v) => s + v, 0);
			const dev = Math.abs(rowSum - 1);
			if (dev > maxDeviation) maxDeviation = dev;
		}

		for (let j = 0; j < m; j++) {
			let colSum = 0;
			for (let i = 0; i < n; i++) {
				colSum += A[i][j];
			}
			const dev = Math.abs(colSum - 1);
			if (dev > maxDeviation) maxDeviation = dev;
		}

		if (maxDeviation < epsilon) {
			converged = true;
			break;
		}
	}

	return { result: A, iterations, converged };
}

// ─── Affinity Matrix Construction ────────────────────────────────────────────

/**
 * Build a raw affinity matrix from session signals.
 *
 * The affinity matrix is a 4x4 matrix where entry [i][j] represents the
 * affinity between signal source i and stream target j. The diagonal
 * represents direct mapping (identity signals -> identity stream), while
 * off-diagonal entries represent cross-stream relationships.
 *
 * The raw matrix is then passed to sinkhornKnopp() to produce the
 * doubly stochastic mixing matrix.
 *
 * @param signals - Signal counts extracted from a session.
 * @returns A 4x4 non-negative affinity matrix.
 */
export function buildAffinityMatrix(signals: StreamSignals): number[][] {
	const counts = [
		signals.identity.length,
		signals.projects.length,
		signals.tasks.length,
		signals.flow.length,
	];

	// Total signal count. If zero, return uniform matrix.
	const total = counts.reduce((a, b) => a + b, 0);
	if (total === 0) {
		// Uniform affinity: equal distribution
		return [
			[1, 0.1, 0.1, 0.1],
			[0.1, 1, 0.2, 0.1],
			[0.1, 0.2, 1, 0.1],
			[0.1, 0.1, 0.1, 1],
		];
	}

	// Build the affinity matrix.
	// Diagonal: signal count for each stream (self-affinity).
	// Off-diagonal: cross-affinities based on semantic proximity.
	//
	// Cross-affinity rules:
	//   - identity <-> projects: identity decisions often relate to project preferences (0.15)
	//   - identity <-> tasks: identity preferences might spawn tasks (0.05)
	//   - identity <-> flow: identity rarely crosses to flow (0.02)
	//   - projects <-> tasks: projects generate tasks heavily (0.30)
	//   - projects <-> flow: current project context is ephemeral (0.10)
	//   - tasks <-> flow: tasks in progress are part of flow (0.15)

	const crossAffinities = [
		//            identity  projects  tasks     flow
		/* identity */ [1.0,    0.15,     0.05,     0.02],
		/* projects */ [0.15,   1.0,      0.30,     0.10],
		/* tasks    */ [0.05,   0.30,     1.0,      0.15],
		/* flow     */ [0.02,   0.10,     0.15,     1.0 ],
	];

	const matrix: number[][] = [];

	for (let i = 0; i < 4; i++) {
		const row: number[] = [];
		for (let j = 0; j < 4; j++) {
			// Scale cross-affinity by the signal count of the source
			// and add a small base from the target count to prevent zeros
			const signalWeight = counts[i] > 0 ? counts[i] / total : 0.01;
			const targetWeight = counts[j] > 0 ? counts[j] / total : 0.01;
			const affinity = crossAffinities[i][j] * signalWeight + 0.1 * targetWeight;
			row.push(Math.max(affinity, 0.001)); // Floor to prevent zeros
		}
		matrix.push(row);
	}

	return matrix;
}

// ─── Token Budget Computation ────────────────────────────────────────────────

/**
 * Use the doubly stochastic mixing matrix to allocate tokens per stream.
 *
 * The mixing matrix columns represent how the total budget should be
 * distributed. We weight each column by the preservation ratio and
 * normalize to sum to totalBudget.
 *
 * Conservation law: sum of all budgets = totalBudget (exactly).
 *
 * @param mixingMatrix - The doubly stochastic matrix from sinkhornKnopp().
 * @param totalBudget - Total token budget to allocate.
 * @param preservationRatios - Preservation ratio per stream. Defaults to PRESERVATION_RATIOS.
 * @returns Array of token budgets [identity, projects, tasks, flow].
 */
export function computeTokenBudgets(
	mixingMatrix: number[][],
	totalBudget: number,
	preservationRatios: number[] = PRESERVATION_RATIOS,
): number[] {
	const n = mixingMatrix.length;
	if (n === 0) return [];

	// Compute the column sums of the mixing matrix, weighted by preservation.
	// This gives us the "importance" of each stream after compaction.
	const weights: number[] = [];

	for (let j = 0; j < n; j++) {
		let colSum = 0;
		for (let i = 0; i < n; i++) {
			colSum += mixingMatrix[i][j];
		}
		// Weight by preservation ratio
		const pRatio = j < preservationRatios.length ? preservationRatios[j] : 0.5;
		weights.push(colSum * pRatio);
	}

	// Normalize weights to sum to 1
	const totalWeight = weights.reduce((a, b) => a + b, 0);
	if (totalWeight === 0) {
		// Fallback: equal distribution
		const equal = Math.floor(totalBudget / n);
		const budgets = new Array(n).fill(equal);
		budgets[0] += totalBudget - equal * n;
		return budgets;
	}

	const normalized = weights.map((w) => w / totalWeight);

	// Allocate tokens
	const budgets = normalized.map((w) => Math.floor(w * totalBudget));

	// Distribute remainder to preserve conservation law
	const allocated = budgets.reduce((a, b) => a + b, 0);
	let remainder = totalBudget - allocated;

	// Give remainder to streams in order of preservation (highest first)
	const sortedIndices = preservationRatios
		.map((r, i) => ({ ratio: r, index: i }))
		.sort((a, b) => b.ratio - a.ratio)
		.map((x) => x.index);

	for (const idx of sortedIndices) {
		if (remainder <= 0) break;
		budgets[idx] += 1;
		remainder -= 1;
	}

	return budgets;
}

/**
 * Convenience: build affinity matrix from signals, run Sinkhorn-Knopp,
 * and compute token budgets in one call.
 *
 * @param signals - Session signals
 * @param totalBudget - Total token budget
 * @returns Token budgets and the mixing matrix
 */
export function allocateBudgets(
	signals: StreamSignals,
	totalBudget: number,
): { budgets: number[]; mixingMatrix: number[][]; converged: boolean } {
	const affinity = buildAffinityMatrix(signals);
	const { result: mixingMatrix, converged } = sinkhornKnopp(affinity);
	const budgets = computeTokenBudgets(mixingMatrix, totalBudget);
	return { budgets, mixingMatrix, converged };
}
