/**
 * Turiya Math — LinUCB linear algebra, sampling, and budget/preference scoring.
 *
 * Pure math functions used by TuriyaRouter. Extracted for readability
 * and to keep each module under 450 LOC.
 *
 * Includes:
 * - Cholesky decomposition and solve for LinUCB
 * - Thompson Sampling via Beta/Gamma distributions
 * - Budget-adjusted scoring (PILOT paper: Lagrangian penalty)
 * - Preference-conditioned scoring (LLM Bandit paper)
 *
 * @module turiya-math
 */

// ─── LinUCB Linear Algebra ──────────────────────────────────────────────────

/** Create identity matrix of size d, flattened row-major. */
export function identityFlat(d: number): number[] {
	const m = new Array(d * d).fill(0);
	for (let i = 0; i < d; i++) m[i * d + i] = 1;
	return m;
}

/**
 * Cholesky decomposition solve: A * x = b, where A is d x d SPD.
 *
 * A = L * L^T, then forward-solve L * y = b, then back-solve L^T * x = y.
 * O(d^3) for decomposition, O(d^2) for solve. For d=8 this is ~500 ops.
 */
export function choleskySolve(A: number[], b: number[], d: number): number[] {
	const L = new Array(d * d).fill(0);

	for (let i = 0; i < d; i++) {
		for (let j = 0; j <= i; j++) {
			let sum = 0;
			for (let k = 0; k < j; k++) {
				sum += L[i * d + k] * L[j * d + k];
			}
			if (i === j) {
				const diagVal = A[i * d + i] - sum;
				L[i * d + j] = Math.sqrt(Math.max(diagVal, 1e-10));
			} else {
				L[i * d + j] = (A[i * d + j] - sum) / L[j * d + j];
			}
		}
	}

	// Forward solve: L * y = b
	const y = new Array(d).fill(0);
	for (let i = 0; i < d; i++) {
		let sum = 0;
		for (let j = 0; j < i; j++) sum += L[i * d + j] * y[j];
		y[i] = (b[i] - sum) / L[i * d + i];
	}

	// Backward solve: L^T * x = y
	const x = new Array(d).fill(0);
	for (let i = d - 1; i >= 0; i--) {
		let sum = 0;
		for (let j = i + 1; j < d; j++) sum += L[j * d + i] * x[j];
		x[i] = (y[i] - sum) / L[i * d + i];
	}

	return x;
}

/**
 * Compute x^T * A^{-1} * x via Cholesky: solve A * z = x, then dot(x, z).
 * Avoids explicit inversion — more numerically stable.
 */
export function quadFormInverse(A: number[], x: number[], d: number): number {
	const z = choleskySolve(A, x, d);
	let dot = 0;
	for (let i = 0; i < d; i++) dot += x[i] * z[i];
	return dot;
}

/** Rank-1 update: A += x * x^T (outer product, in-place on flattened matrix). */
export function rankOneUpdate(A: number[], x: number[], d: number): void {
	for (let i = 0; i < d; i++) {
		for (let j = 0; j < d; j++) {
			A[i * d + j] += x[i] * x[j];
		}
	}
}

// ─── Beta Distribution Sampling (Thompson Sampling) ─────────────────────────

/** Sample Beta(alpha, beta) via Gamma ratio (Marsaglia & Tsang). */
export function sampleBeta(alpha: number, beta: number): number {
	const x = sampleGamma(alpha);
	const y = sampleGamma(beta);
	return (x + y === 0) ? 0.5 : x / (x + y);
}

/** Sample from Gamma(shape) using Marsaglia & Tsang's method. */
export function sampleGamma(shape: number): number {
	if (shape < 1) return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	for (;;) {
		let z: number, v: number;
		do { z = boxMuller(); v = 1 + c * z; } while (v <= 0);
		v = v * v * v;
		const u = Math.random();
		if (u < 1 - 0.0331 * (z * z * z * z)) return d * v;
		if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
	}
}

/** Standard normal sample via Box-Muller transform. */
export function boxMuller(): number {
	return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

// ─── Budget-Aware Scoring (PILOT Paper) ─────────────────────────────────────

/**
 * PILOT: Lagrangian budget penalty applied to UCB score.
 * As budget depletes, lambda grows and penalizes expensive arms more.
 *
 * @param ucbScore - Raw LinUCB upper confidence bound score.
 * @param armCost - Estimated cost of this arm/tier in USD.
 * @param lambda - Current Lagrangian multiplier (grows with budget pressure).
 * @returns Adjusted score that accounts for budget constraint.
 */
export function budgetAdjustedScore(
	ucbScore: number,
	armCost: number,
	lambda: number,
): number {
	return ucbScore - lambda * armCost;
}

/**
 * Update lambda using subgradient ascent (PILOT paper).
 * lambda_{t+1} = max(0, lambda_t + eta * (c_t - B/T))
 *
 * @param currentLambda - Current Lagrangian multiplier.
 * @param armCost - Cost of the arm just played.
 * @param budgetPerStep - Budget allocated per step (dailyBudget / expectedRequests).
 * @param learningRate - Step size for subgradient update. Default: 0.01.
 * @returns Updated lambda (non-negative).
 */
export function updateBudgetLambda(
	currentLambda: number,
	armCost: number,
	budgetPerStep: number,
	learningRate = 0.01,
): number {
	return Math.max(0, currentLambda + learningRate * (armCost - budgetPerStep));
}

// ─── Preference-Conditioned Scoring (LLM Bandit Paper) ──────────────────────

/**
 * Blend reward and cost scores based on user preference dial.
 * From LLM Bandit: interpolate between quality-maximizing and cost-minimizing.
 *
 * @param rewardScore - LinUCB expected reward + exploration bonus.
 * @param costScore - Normalized cost score (1 = cheapest, 0 = most expensive).
 * @param costWeight - User preference: 0 = maximize quality, 1 = minimize cost.
 * @returns Blended score reflecting user's cost/quality preference.
 */
export function preferenceBlendedScore(
	rewardScore: number,
	costScore: number,
	costWeight: number,
): number {
	return (1 - costWeight) * rewardScore + costWeight * costScore;
}
