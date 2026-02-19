/**
 * @chitragupta/smriti — Hybrid Weight Learner (Thompson Sampling).
 *
 * Learns the optimal blend of BM25, vector, graphrag, and pramana signal
 * contributions from user feedback using Thompson Sampling with Beta posteriors.
 *
 * Each signal has a Beta(alpha, beta) posterior; we sample weights, normalize,
 * and use them to re-weight the RRF contributions. On feedback, we update the
 * contributing signals' posteriors.
 *
 * Mathematical foundations:
 *   - Beta(a, b) = X / (X + Y) where X ~ Gamma(a), Y ~ Gamma(b)
 *   - Gamma sampling via Marsaglia-Tsang method (2000)
 *   - Gaussian samples via Box-Muller transform
 *   - Convergence: posterior mean alpha/(alpha+beta) converges to true utility
 */

import type { HybridSignal } from "./hybrid-search.js";

// ─── Beta Distribution Helpers (Box-Muller + Marsaglia-Tsang) ───────────────

/**
 * Box-Muller transform for standard normal samples.
 *
 * Generates z ~ N(0, 1) from two uniform [0, 1) variates:
 *   z = sqrt(-2 * ln(u1)) * cos(2 * pi * u2)
 *
 * @returns A sample from the standard normal distribution.
 */
function gaussianRandom(): number {
	const u1 = Math.random();
	const u2 = Math.random();
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Sample from Gamma(shape, 1) using the Marsaglia-Tsang method (2000).
 *
 * For shape >= 1:
 *   d = shape - 1/3, c = 1 / sqrt(9*d)
 *   Repeat: generate z ~ N(0,1), v = (1 + c*z)^3
 *     accept if z > -1/c and log(U) < 0.5*z^2 + d - d*v + d*log(v)
 *
 * For shape < 1: use the relation Gamma(a) = Gamma(a+1) * U^(1/a).
 *
 * @param shape - Shape parameter (> 0).
 * @returns A sample from Gamma(shape, 1).
 */
function sampleGamma(shape: number): number {
	if (shape < 1) {
		const g = sampleGamma(shape + 1);
		return g * Math.pow(Math.random(), 1 / shape);
	}

	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);

	for (;;) {
		let z: number;
		let v: number;

		do {
			z = gaussianRandom();
			v = 1 + c * z;
		} while (v <= 0);

		v = v * v * v;
		const u = Math.random();
		const zSq = z * z;

		if (u < 1 - 0.0331 * (zSq * zSq)) return d * v;
		if (Math.log(u) < 0.5 * zSq + d * (1 - v + Math.log(v))) return d * v;
	}
}

/**
 * Sample from a Beta(alpha, beta) distribution using Gamma variates.
 *
 * Beta(a, b) = X / (X + Y) where X ~ Gamma(a), Y ~ Gamma(b).
 * Uses Marsaglia-Tsang Gamma sampling for numerical stability.
 *
 * @param alpha - First shape parameter (> 0).
 * @param beta - Second shape parameter (> 0).
 * @returns A sample in [0, 1].
 */
function sampleBeta(alpha: number, beta: number): number {
	const x = sampleGamma(alpha);
	const y = sampleGamma(beta);
	if (x + y === 0) return 0.5; // Degenerate case — return midpoint
	return x / (x + y);
}

// ─── Signal Constants ───────────────────────────────────────────────────────

/** Signal indices for the 4 hybrid dimensions. */
const SIGNAL_INDEX: Record<HybridSignal, number> = {
	bm25: 0,
	vector: 1,
	graphrag: 2,
	pramana: 3,
};

/** Number of hybrid search signals tracked by the weight learner. */
const NUM_SIGNALS = 4;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Serialized state of the HybridWeightLearner for persistence. */
export interface HybridWeightLearnerState {
	alphas: number[];
	betas: number[];
	totalFeedback: number;
}

// ─── Hybrid Weight Learner (Thompson Sampling) ─────────────────────────────

/**
 * Learns the optimal blend of BM25, vector, graphrag, and pramana signals
 * using Thompson Sampling with Beta posteriors.
 *
 * Each signal has a Beta(alpha, beta) distribution representing our belief about
 * its usefulness. On each query, we SAMPLE weights from the posteriors
 * (exploration-exploitation trade-off). When the user selects a result
 * (positive feedback) or rejects one (negative), we update the posteriors
 * of the contributing signals.
 *
 * The learned weights are used as multiplicative modifiers on the RRF
 * contributions from each signal.
 *
 * Convergence: with uniform prior Beta(1,1), the posterior mean alpha/(alpha+beta)
 * converges to the true signal utility as feedback accumulates. Thompson
 * Sampling naturally concentrates sampling around high-utility signals
 * while maintaining exploration of under-sampled ones.
 */
export class HybridWeightLearner {
	/** Success counts (alpha) for each of the 4 signals. */
	private _alphas: Float64Array;
	/** Failure counts (beta) for each of the 4 signals. */
	private _betas: Float64Array;
	/** Total feedback events received. */
	private _totalFeedback: number;

	/**
	 * Create a new weight learner with the given prior.
	 *
	 * @param priorAlpha - Initial alpha for all signals. Default: 1 (uniform prior).
	 * @param priorBeta - Initial beta for all signals. Default: 1 (uniform prior).
	 */
	constructor(priorAlpha = 1, priorBeta = 1) {
		this._alphas = new Float64Array(NUM_SIGNALS);
		this._betas = new Float64Array(NUM_SIGNALS);
		this._totalFeedback = 0;
		for (let i = 0; i < NUM_SIGNALS; i++) {
			this._alphas[i] = priorAlpha;
			this._betas[i] = priorBeta;
		}
	}

	/**
	 * Sample a weight vector from the Beta posteriors.
	 *
	 * Each signal's weight is sampled from Beta(alpha_i, beta_i), then the 4
	 * weights are normalized to sum to 1 (Dirichlet-like normalization).
	 *
	 * @returns Normalized weight vector { bm25, vector, graphrag, pramana }.
	 */
	sample(): { bm25: number; vector: number; graphrag: number; pramana: number } {
		const raw = new Float64Array(NUM_SIGNALS);
		let sum = 0;

		for (let i = 0; i < NUM_SIGNALS; i++) {
			raw[i] = sampleBeta(this._alphas[i], this._betas[i]);
			sum += raw[i];
		}

		// Normalize to sum = 1 (numerical guard: if all near-zero, return uniform)
		if (sum < 1e-12) {
			return { bm25: 0.25, vector: 0.25, graphrag: 0.25, pramana: 0.25 };
		}

		return {
			bm25: raw[0] / sum,
			vector: raw[1] / sum,
			graphrag: raw[2] / sum,
			pramana: raw[3] / sum,
		};
	}

	/**
	 * Update a signal's posterior after observing feedback.
	 *
	 * @param signal - Which signal to update.
	 * @param success - true = positive feedback (user found result useful),
	 *                  false = negative feedback (result was irrelevant).
	 */
	update(signal: HybridSignal, success: boolean): void {
		const idx = SIGNAL_INDEX[signal];
		if (success) {
			this._alphas[idx] += 1;
		} else {
			this._betas[idx] += 1;
		}
		this._totalFeedback += 1;
	}

	/**
	 * Get the posterior mean for each signal: alpha / (alpha + beta).
	 * Useful for diagnostics and logging.
	 *
	 * @returns Posterior mean for each of the 4 signals.
	 */
	means(): { bm25: number; vector: number; graphrag: number; pramana: number } {
		const m = (i: number) => this._alphas[i] / (this._alphas[i] + this._betas[i]);
		return { bm25: m(0), vector: m(1), graphrag: m(2), pramana: m(3) };
	}

	/** Total number of feedback events recorded. */
	get totalFeedback(): number {
		return this._totalFeedback;
	}

	/**
	 * Serialize the learner state for persistence.
	 *
	 * @returns A plain object suitable for JSON serialization.
	 */
	serialize(): HybridWeightLearnerState {
		return {
			alphas: Array.from(this._alphas),
			betas: Array.from(this._betas),
			totalFeedback: this._totalFeedback,
		};
	}

	/**
	 * Restore the learner state from a serialized object.
	 *
	 * Silently ignores invalid data to avoid corrupting the current state.
	 *
	 * @param data - Previously serialized state from `serialize()`.
	 */
	restore(data: HybridWeightLearnerState): void {
		if (
			!data ||
			!Array.isArray(data.alphas) ||
			!Array.isArray(data.betas) ||
			data.alphas.length !== NUM_SIGNALS ||
			data.betas.length !== NUM_SIGNALS
		) {
			return; // Silently ignore invalid data — keep current state
		}

		for (let i = 0; i < NUM_SIGNALS; i++) {
			this._alphas[i] = data.alphas[i];
			this._betas[i] = data.betas[i];
		}
		this._totalFeedback = data.totalFeedback ?? 0;
	}
}
