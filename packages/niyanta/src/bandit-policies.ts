/**
 * Bandit policies — linear algebra and sampling primitives for the
 * multi-armed bandit strategy selector.
 *
 * Contains:
 * - LinUCB helpers: Cholesky solve, quadratic form, rank-1 update
 * - Beta distribution sampling via Gamma ratio (Marsaglia & Tsang)
 * - Feature vector construction from BanditContext
 */

import type { BanditContext } from "./strategy-bandit.js";

// ─── LinUCB Constants ───────────────────────────────────────────────────────

/** Feature dimension for LinUCB (5 context features + 1 bias). */
export const D = 6;

// ─── Linear Algebra ─────────────────────────────────────────────────────────

/** Create identity matrix of size d, flattened row-major. */
export function identityFlat(d: number): number[] {
	const m = new Array(d * d).fill(0);
	for (let i = 0; i < d; i++) m[i * d + i] = 1;
	return m;
}

/**
 * Solve A * x = b via Cholesky decomposition (A = L * L^T).
 *
 * A must be symmetric positive-definite, stored as a flattened d x d array.
 * Complexity: O(d^3) decompose + O(d^2) solve. Trivial for d = 6.
 */
export function choleskySolve(A: number[], b: number[], d: number): number[] {
	const L = new Array(d * d).fill(0);

	for (let i = 0; i < d; i++) {
		for (let j = 0; j <= i; j++) {
			let sum = 0;
			for (let k = 0; k < j; k++) sum += L[i * d + k] * L[j * d + k];
			if (i === j) {
				L[i * d + j] = Math.sqrt(Math.max(A[i * d + i] - sum, 1e-10));
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
 * Avoids explicit matrix inversion for better numerical stability.
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

/** Convert BanditContext to feature vector with bias term. */
export function contextToFeatures(ctx?: BanditContext): number[] {
	if (!ctx) return [1, 0.5, 0.5, 0.5, 0.5, 0.5];
	return [1, ctx.taskComplexity, ctx.agentCount, ctx.memoryPressure, ctx.avgLatency, ctx.errorRate];
}

// ─── Beta Distribution Sampling ─────────────────────────────────────────────

/** Sample Beta(alpha, beta) via Gamma ratio (Marsaglia & Tsang). */
export function sampleBeta(alpha: number, beta: number): number {
	const x = sampleGamma(alpha);
	const y = sampleGamma(beta);
	return (x + y === 0) ? 0.5 : x / (x + y);
}

/** Sample from Gamma(shape, 1) using Marsaglia & Tsang's method. */
function sampleGamma(shape: number): number {
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

/** Box-Muller transform: generate standard normal sample. */
function boxMuller(): number {
	return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
