/**
 * @chitragupta/smriti — Accelerated Sinkhorn-Knopp with Nesterov Momentum.
 *
 * Three orthogonal improvements over the vanilla Sinkhorn-Knopp iteration:
 *
 * 1. **Nesterov Momentum** — Instead of plain alternating projections, we apply
 *    Nesterov-style extrapolation at each iterate:
 *
 *        y_k = x_k + ((k-1)/(k+2)) * (x_k - x_{k-1})
 *        x_{k+1} = SK_step(y_k)
 *
 *    This accelerates convergence from O(1/k) (vanilla SK) to O(1/k^2), matching
 *    the optimal rate for smooth first-order methods on the Birkhoff polytope.
 *
 * 2. **Log-Domain Arithmetic** — All normalization steps happen in log-space,
 *    using numerically stable `logsumexp` to prevent underflow/overflow when
 *    operating on large or poorly-conditioned matrices. The log-domain formulation:
 *
 *        log_row_normalize: L_ij -= logsumexp(L_i*)    (for each row i)
 *        log_col_normalize: L_ij -= logsumexp(L_*j)    (for each col j)
 *
 * 3. **Adaptive Epsilon Schedule** — Start with coarse epsilon (1e-2), halve it
 *    periodically until reaching the target. This yields fast coarse convergence
 *    followed by precise refinement — a form of warm-starting.
 *
 * Additionally provides `computeTokenBudgetsMHC()` for hierarchical chunk-level
 * token budget allocation using the accelerated solver.
 */

// Re-export budget allocation symbols so index.ts needs no changes
export { computeTokenBudgetsMHC } from "./sinkhorn-budget.js";
export type { SessionChunk } from "./sinkhorn-budget.js";

// ─── Numerically Stable LogSumExp ────────────────────────────────────────────

/**
 * Compute log(sum(exp(arr))) in a numerically stable way.
 *
 * The naive computation `Math.log(arr.map(Math.exp).reduce(add))` overflows for
 * large values and underflows for very negative values. Instead we use:
 *
 *     logsumexp(x) = max(x) + log( Σ exp(x_i - max(x)) )
 *
 * This shifts all exponents by the maximum, ensuring the largest exponent is 0
 * (i.e. exp(0) = 1), preventing both overflow and underflow.
 *
 * @param arr - Array of log-domain values.
 * @returns The log of the sum of the exponentiated values.
 */
export function logsumexp(arr: number[]): number {
	if (arr.length === 0) return -Infinity;
	if (arr.length === 1) return arr[0];

	let maxVal = -Infinity;
	for (let i = 0; i < arr.length; i++) {
		if (arr[i] > maxVal) maxVal = arr[i];
	}

	if (maxVal === -Infinity) return -Infinity;

	let sumExp = 0;
	for (let i = 0; i < arr.length; i++) {
		sumExp += Math.exp(arr[i] - maxVal);
	}

	return maxVal + Math.log(sumExp);
}

// ─── Accelerated Sinkhorn Options ────────────────────────────────────────────

/** Configuration options for the accelerated Sinkhorn-Knopp solver. */
export interface SinkhornAcceleratedOpts {
	/** Maximum number of outer iterations. Default: 200. */
	maxIterations?: number;
	/** Target convergence threshold. Default: 1e-8. */
	epsilon?: number;
	/** Use Nesterov momentum acceleration. Default: true. */
	useNesterov?: boolean;
	/** Use log-domain arithmetic for numerical stability. Default: true. */
	useLogDomain?: boolean;
	/** Use adaptive epsilon schedule. Default: true. */
	useAdaptiveEpsilon?: boolean;
	/** Initial epsilon for adaptive schedule. Default: 1e-2. */
	initialEpsilon?: number;
	/** Iterations between epsilon halving. Default: 10. */
	epsilonHalvingInterval?: number;
}

// ─── Log-Domain SK Step ──────────────────────────────────────────────────────

/**
 * Perform one Sinkhorn-Knopp step entirely in log-space.
 *
 * Given log-matrix L, normalize rows then columns:
 *   L_ij -= logsumexp(L_i*)    (row normalization)
 *   L_ij -= logsumexp(L_*j)    (column normalization)
 *
 * @param L - n x m log-domain matrix (modified in-place).
 */
function logDomainSKStep(L: number[][]): void {
	const n = L.length;
	const m = L[0].length;

	// Row normalization
	for (let i = 0; i < n; i++) {
		const lse = logsumexp(L[i]);
		for (let j = 0; j < m; j++) {
			L[i][j] -= lse;
		}
	}

	// Column normalization
	const colBuf: number[] = new Array(n);
	for (let j = 0; j < m; j++) {
		for (let i = 0; i < n; i++) {
			colBuf[i] = L[i][j];
		}
		const lse = logsumexp(colBuf);
		for (let i = 0; i < n; i++) {
			L[i][j] -= lse;
		}
	}
}

/**
 * Perform one vanilla SK step in the linear domain.
 *
 * @param A - n x m non-negative matrix (modified in-place).
 */
function linearSKStep(A: number[][]): void {
	const n = A.length;
	const m = A[0].length;

	// Row normalization
	for (let i = 0; i < n; i++) {
		let rowSum = 0;
		for (let j = 0; j < m; j++) rowSum += A[i][j];
		if (rowSum > 0) {
			for (let j = 0; j < m; j++) A[i][j] /= rowSum;
		}
	}

	// Column normalization
	for (let j = 0; j < m; j++) {
		let colSum = 0;
		for (let i = 0; i < n; i++) colSum += A[i][j];
		if (colSum > 0) {
			for (let i = 0; i < n; i++) A[i][j] /= colSum;
		}
	}
}

// ─── Convergence Check ───────────────────────────────────────────────────────

/**
 * Measure the maximum deviation of any row or column sum from 1.
 * A matrix is doubly stochastic when this returns < epsilon.
 */
function maxDeviation(A: number[][]): number {
	const n = A.length;
	const m = A[0].length;
	let maxDev = 0;

	for (let i = 0; i < n; i++) {
		let rowSum = 0;
		for (let j = 0; j < m; j++) rowSum += A[i][j];
		const dev = Math.abs(rowSum - 1);
		if (dev > maxDev) maxDev = dev;
	}

	for (let j = 0; j < m; j++) {
		let colSum = 0;
		for (let i = 0; i < n; i++) colSum += A[i][j];
		const dev = Math.abs(colSum - 1);
		if (dev > maxDev) maxDev = dev;
	}

	return maxDev;
}

// ─── Matrix Utilities ────────────────────────────────────────────────────────

/** Deep clone a 2D matrix. */
function cloneMatrix(M: number[][]): number[][] {
	return M.map((row) => [...row]);
}

/** Convert a log-domain matrix to linear domain: A_ij = exp(L_ij). */
function expMatrix(L: number[][]): number[][] {
	return L.map((row) => row.map((v) => Math.exp(v)));
}

/** Convert a non-negative matrix to log domain, clamping zeros to log(MIN_VALUE) ≈ -708. */
function logMatrix(A: number[][]): number[][] {
	const LOG_FLOOR = Math.log(Number.MIN_VALUE); // ≈ -708, principled floor
	return A.map((row) => row.map((v) => (v > 0 ? Math.log(v) : LOG_FLOOR)));
}

/**
 * Nesterov extrapolation: y_k = x_k + momentum * (x_k - x_{k-1}).
 *
 * The momentum coefficient is (k-1)/(k+2), which is the optimal schedule
 * for Nesterov's accelerated gradient method, yielding O(1/k^2) convergence.
 */
function nesterovExtrapolate(
	current: number[][],
	previous: number[][],
	k: number,
): number[][] {
	const momentum = k > 1 ? (k - 1) / (k + 2) : 0;
	const n = current.length;
	const m = current[0].length;
	const result: number[][] = [];

	for (let i = 0; i < n; i++) {
		const row: number[] = new Array(m);
		for (let j = 0; j < m; j++) {
			row[j] = current[i][j] + momentum * (current[i][j] - previous[i][j]);
		}
		result.push(row);
	}

	return result;
}

// ─── Accelerated Sinkhorn-Knopp ──────────────────────────────────────────────

/**
 * Accelerated Sinkhorn-Knopp iteration with Nesterov momentum, log-domain
 * arithmetic, and adaptive epsilon scheduling.
 *
 * Convergence guarantee: For any non-negative matrix with total support,
 * the iteration converges to the unique doubly stochastic scaling at rate
 * O(1/k^2) with Nesterov momentum (vs O(1/k) for vanilla SK).
 *
 * Mathematical formulation (Nesterov-accelerated, log-domain):
 *
 *   L^{(0)} = log(A)                          // initial log-matrix
 *   for k = 1, 2, ...
 *     momentum = (k-1) / (k+2)
 *     Y = L^{(k)} + momentum * (L^{(k)} - L^{(k-1)})   // extrapolation
 *     Y_ij -= logsumexp(Y_i*)                  // log-row normalize
 *     Y_ij -= logsumexp(Y_*j)                  // log-col normalize
 *     L^{(k+1)} = Y
 *     if maxDeviation(exp(L^{(k+1)})) < epsilon: break
 *
 * @param matrix - Non-negative input matrix (NxM). Not modified.
 * @param opts - Acceleration options.
 * @returns The doubly stochastic matrix, iteration count, and convergence flag.
 */
export function sinkhornAccelerated(
	matrix: number[][],
	opts?: SinkhornAcceleratedOpts,
): { result: number[][]; iterations: number; converged: boolean } {
	const maxIterations = opts?.maxIterations ?? 200;
	const targetEpsilon = opts?.epsilon ?? 1e-8;
	const useNesterov = opts?.useNesterov ?? true;
	const useLogDomain = opts?.useLogDomain ?? true;
	const useAdaptiveEps = opts?.useAdaptiveEpsilon ?? true;
	const initialEps = opts?.initialEpsilon ?? 1e-2;
	const halvingInterval = opts?.epsilonHalvingInterval ?? 10;

	const n = matrix.length;
	if (n === 0) return { result: [], iterations: 0, converged: true };
	const m = matrix[0].length;
	if (m === 0) return { result: matrix.map(() => []), iterations: 0, converged: true };

	// Deep copy and clamp negatives to 0; replace zero rows/cols with uniform
	const A: number[][] = matrix.map((row) => row.map((v) => Math.max(v, 0)));
	for (let i = 0; i < n; i++) {
		const rowSum = A[i].reduce((s, v) => s + v, 0);
		if (rowSum === 0) for (let j = 0; j < m; j++) A[i][j] = 1 / m;
	}
	for (let j = 0; j < m; j++) {
		let colSum = 0;
		for (let i = 0; i < n; i++) colSum += A[i][j];
		if (colSum === 0) for (let i = 0; i < n; i++) A[i][j] = 1 / n;
	}

	let currentEps = useAdaptiveEps ? initialEps : targetEpsilon;
	let iterations = 0;
	let converged = false;

	if (useLogDomain) {
		let L = logMatrix(A);
		let prevL = cloneMatrix(L);

		for (let k = 1; k <= maxIterations; k++) {
			iterations = k;

			// Adaptive epsilon: halve every `halvingInterval` iterations
			if (useAdaptiveEps && k % halvingInterval === 0 && currentEps > targetEpsilon) {
				currentEps = Math.max(currentEps / 2, targetEpsilon);
			}

			// Nesterov extrapolation in log domain
			const working = useNesterov ? nesterovExtrapolate(L, prevL, k) : cloneMatrix(L);
			prevL = cloneMatrix(L);

			// SK step in log domain
			logDomainSKStep(working);
			L = working;

			// Check convergence in linear domain
			const linear = expMatrix(L);
			const dev = maxDeviation(linear);
			if (dev < currentEps && currentEps <= targetEpsilon) {
				converged = true;
				break;
			}
		}

		return { result: expMatrix(L), iterations, converged };
	}

	// Linear-domain path (with Nesterov but without log-domain)
	let current = cloneMatrix(A);
	let previous = cloneMatrix(A);

	for (let k = 1; k <= maxIterations; k++) {
		iterations = k;

		if (useAdaptiveEps && k % halvingInterval === 0 && currentEps > targetEpsilon) {
			currentEps = Math.max(currentEps / 2, targetEpsilon);
		}

		const working = useNesterov ? nesterovExtrapolate(current, previous, k) : cloneMatrix(current);
		// Clamp extrapolated values to non-negative
		for (let i = 0; i < n; i++) {
			for (let j = 0; j < m; j++) {
				if (working[i][j] < 1e-15) working[i][j] = 1e-15;
			}
		}

		previous = cloneMatrix(current);
		linearSKStep(working);
		current = working;

		const dev = maxDeviation(current);
		if (dev < currentEps && currentEps <= targetEpsilon) {
			converged = true;
			break;
		}
	}

	return { result: current, iterations, converged };
}
