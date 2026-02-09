/**
 * @chitragupta/smriti — Adaptive GraphRAG Scoring with Thompson Sampling.
 *
 * Replaces the fixed-weight hybrid scoring (ALPHA=0.6, BETA=0.25, GAMMA=0.15)
 * with online-learned weights that adapt to user feedback over time.
 *
 * Three key innovations:
 *
 * 1. **Thompson Sampling for Weight Learning** — Each scoring dimension
 *    (cosine similarity, PageRank, BM25-lite) is modeled as a Beta(alpha, beta)
 *    distribution. On each query:
 *      - SAMPLE weights from the Beta posteriors
 *      - Normalize sampled weights to sum to 1
 *      - Score candidates using the sampled weights
 *    After user feedback (accept/reject a result):
 *      - Accept: alpha += 1  (reward the component)
 *      - Reject: beta += 1   (penalize the component)
 *    This naturally balances exploration (trying new weight combos) vs
 *    exploitation (using what has worked).
 *
 * 2. **Temporal Decay** — Old feedback decays exponentially with configurable
 *    half-life, so the scorer adapts to changing user preferences:
 *
 *        effective_alpha = 1 + SUM( feedback_i * exp(-lambda * (now - t_i)) )
 *
 *    where lambda = ln(2) / halfLife.
 *
 * 3. **Maximal Marginal Relevance (MMR) Diversity Re-ranking** — After scoring,
 *    applies MMR to reduce redundancy in top-K results:
 *
 *        MMR(d) = lambda * score(d) - (1 - lambda) * max_{d_j in S} sim(d, d_j)
 *
 *    where S is the already-selected set, achieving O(k*n) diversification.
 */

import { cosineSimilarity, textMatchScore, tokenize } from "./graphrag-scoring.js";

// ─── Beta Distribution Sampling ──────────────────────────────────────────────

/**
 * Sample from a Beta(alpha, beta) distribution using the Joehnk method.
 *
 * For alpha, beta >= 1, this uses the ratio of Gamma variates:
 *   X ~ Gamma(alpha, 1), Y ~ Gamma(beta, 1)
 *   X / (X + Y) ~ Beta(alpha, beta)
 *
 * Gamma variates with integer shape are generated as -ln(prod(U_i)),
 * exploiting the fact that a sum of exponentials is Gamma-distributed.
 * For non-integer shapes, we use Marsaglia & Tsang's method.
 *
 * @param alpha - First shape parameter (> 0).
 * @param beta - Second shape parameter (> 0).
 * @returns A sample in [0, 1].
 */
function sampleBeta(alpha: number, beta: number): number {
	const x = sampleGamma(alpha);
	const y = sampleGamma(beta);
	if (x + y === 0) return 0.5;
	return x / (x + y);
}

/**
 * Sample from Gamma(shape, 1) using Marsaglia & Tsang's method (2000).
 *
 * For shape >= 1:
 *   d = shape - 1/3, c = 1 / sqrt(9*d)
 *   Repeat: generate z ~ N(0,1), v = (1 + c*z)^3
 *     accept if z > -1/c and log(U) < 0.5*z^2 + d - d*v + d*log(v)
 *
 * For shape < 1: use shape+1 then scale by U^(1/shape).
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

/** Box-Muller transform for standard normal samples. */
function gaussianRandom(): number {
	const u1 = Math.random();
	const u2 = Math.random();
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Feedback Record ─────────────────────────────────────────────────────────

/** A single piece of user feedback with timestamp. */
interface FeedbackRecord {
	/** Unix timestamp (ms) when feedback was received. */
	timestamp: number;
	/** Whether the result was accepted (true) or rejected (false). */
	accepted: boolean;
	/** Which scoring component was dominant for this result. */
	dominant: "cosine" | "pagerank" | "textmatch";
}

// ─── Scored Candidate ────────────────────────────────────────────────────────

/** A candidate with its component scores and final weighted score. */
export interface ScoredCandidate {
	/** Unique ID of the candidate. */
	id: string;
	/** Cosine similarity score [0, 1]. */
	cosineScore: number;
	/** PageRank score [0, 1] (normalized). */
	pagerankScore: number;
	/** BM25-lite text match score [0, 1]. */
	textScore: number;
	/** Final weighted score. */
	finalScore: number;
	/** The embedding vector, if available (for MMR diversity). */
	embedding?: number[];
}

// ─── Serializable State ──────────────────────────────────────────────────────

/** Serializable state for persistence. */
export interface AdaptiveScorerState {
	cosineAlpha: number;
	cosineBeta: number;
	pagerankAlpha: number;
	pagerankBeta: number;
	textAlpha: number;
	textBeta: number;
	feedbackHistory: FeedbackRecord[];
	halfLifeMs: number;
	totalFeedback: number;
}

// ─── Adaptive Scorer ─────────────────────────────────────────────────────────

/** Default half-life: 7 days. */
const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimum total feedback before switching from fixed to adaptive weights. */
const MIN_ADAPTIVE_FEEDBACK = 10;

/** Fixed fallback weights (from the original graphrag-scoring.ts). */
const FIXED_WEIGHTS = { cosine: 0.6, pagerank: 0.25, textmatch: 0.15 };

/**
 * Online-learning scorer that adapts its scoring weights over time using
 * Thompson Sampling with temporal decay.
 *
 * Usage:
 *   1. Call `score(query, candidates)` to get ranked results
 *   2. When the user accepts/rejects a result, call `recordFeedback(queryId, accepted)`
 *   3. Weights automatically converge to the user's preferred balance
 */
export class AdaptiveScorer {
	private cosineAlpha = 2;
	private cosineBeta = 1;
	private pagerankAlpha = 1.5;
	private pagerankBeta = 1;
	private textAlpha = 1.2;
	private textBeta = 1;
	private feedbackHistory: FeedbackRecord[] = [];
	private halfLifeMs: number;
	private totalFeedback = 0;

	/** Map from queryId to the dominant component of the top result. */
	private queryDominants = new Map<string, "cosine" | "pagerank" | "textmatch">();

	constructor(halfLifeMs: number = DEFAULT_HALF_LIFE_MS) {
		this.halfLifeMs = halfLifeMs;
	}

	/**
	 * Score candidates using Thompson-sampled weights.
	 *
	 * If total feedback < MIN_ADAPTIVE_FEEDBACK, uses fixed fallback weights
	 * for stability. Otherwise, samples from the learned Beta posteriors.
	 *
	 * @param queryId - Unique ID for this query (used to attribute feedback).
	 * @param candidates - Array of candidates with component scores.
	 * @returns Candidates sorted by final score (descending).
	 */
	score(
		queryId: string,
		candidates: Omit<ScoredCandidate, "finalScore">[],
	): ScoredCandidate[] {
		const weights = this.totalFeedback >= MIN_ADAPTIVE_FEEDBACK
			? this.sampleWeights()
			: { ...FIXED_WEIGHTS };

		const scored: ScoredCandidate[] = candidates.map((c) => ({
			...c,
			finalScore:
				weights.cosine * c.cosineScore +
				weights.pagerank * c.pagerankScore +
				weights.textmatch * c.textScore,
		}));

		scored.sort((a, b) => b.finalScore - a.finalScore);

		// Record which component was dominant for the top result (for feedback)
		if (scored.length > 0) {
			const top = scored[0];
			const components = [
				{ name: "cosine" as const, val: top.cosineScore },
				{ name: "pagerank" as const, val: top.pagerankScore },
				{ name: "textmatch" as const, val: top.textScore },
			];
			components.sort((a, b) => b.val - a.val);
			this.queryDominants.set(queryId, components[0].name);
		}

		return scored;
	}

	/**
	 * Record user feedback for a previous query.
	 *
	 * Updates the Beta posteriors with temporally-decayed feedback. The dominant
	 * scoring component of the top result gets the credit or blame.
	 *
	 * @param queryId - ID of the query being evaluated.
	 * @param accepted - Whether the user accepted the top result.
	 */
	recordFeedback(queryId: string, accepted: boolean): void {
		const dominant = this.queryDominants.get(queryId);
		if (!dominant) return;

		const record: FeedbackRecord = {
			timestamp: Date.now(),
			accepted,
			dominant,
		};

		this.feedbackHistory.push(record);
		this.totalFeedback++;
		this.queryDominants.delete(queryId);

		// Recompute effective alphas/betas with temporal decay
		this.recomputePosteriors();
	}

	/**
	 * Get the current effective weights (expected values of Beta distributions).
	 *
	 * E[Beta(a, b)] = a / (a + b)
	 *
	 * @returns Normalized weights summing to 1.
	 */
	getWeights(): { cosine: number; pagerank: number; textmatch: number } {
		const rawCosine = this.cosineAlpha / (this.cosineAlpha + this.cosineBeta);
		const rawPagerank = this.pagerankAlpha / (this.pagerankAlpha + this.pagerankBeta);
		const rawText = this.textAlpha / (this.textAlpha + this.textBeta);
		const total = rawCosine + rawPagerank + rawText;

		return {
			cosine: rawCosine / total,
			pagerank: rawPagerank / total,
			textmatch: rawText / total,
		};
	}

	/** Serialize scorer state for persistence. */
	serialize(): AdaptiveScorerState {
		return {
			cosineAlpha: this.cosineAlpha,
			cosineBeta: this.cosineBeta,
			pagerankAlpha: this.pagerankAlpha,
			pagerankBeta: this.pagerankBeta,
			textAlpha: this.textAlpha,
			textBeta: this.textBeta,
			feedbackHistory: [...this.feedbackHistory],
			halfLifeMs: this.halfLifeMs,
			totalFeedback: this.totalFeedback,
		};
	}

	/** Restore scorer state from serialized data. */
	deserialize(state: AdaptiveScorerState): void {
		this.cosineAlpha = state.cosineAlpha;
		this.cosineBeta = state.cosineBeta;
		this.pagerankAlpha = state.pagerankAlpha;
		this.pagerankBeta = state.pagerankBeta;
		this.textAlpha = state.textAlpha;
		this.textBeta = state.textBeta;
		this.feedbackHistory = [...state.feedbackHistory];
		this.halfLifeMs = state.halfLifeMs;
		this.totalFeedback = state.totalFeedback;
	}

	// ─── Private ──────────────────────────────────────────────────────

	/**
	 * Sample weights from the current Beta posteriors and normalize.
	 */
	private sampleWeights(): { cosine: number; pagerank: number; textmatch: number } {
		const rawCosine = sampleBeta(this.cosineAlpha, this.cosineBeta);
		const rawPagerank = sampleBeta(this.pagerankAlpha, this.pagerankBeta);
		const rawText = sampleBeta(this.textAlpha, this.textBeta);
		const total = rawCosine + rawPagerank + rawText;

		if (total === 0) return { ...FIXED_WEIGHTS };

		return {
			cosine: rawCosine / total,
			pagerank: rawPagerank / total,
			textmatch: rawText / total,
		};
	}

	/**
	 * Recompute the Beta posteriors using all feedback with temporal decay.
	 *
	 * Effective parameter for each component:
	 *
	 *   alpha_eff = 1 + SUM_accepted( exp(-lambda * (now - t_i)) )
	 *   beta_eff  = 1 + SUM_rejected( exp(-lambda * (now - t_i)) )
	 *
	 * where lambda = ln(2) / halfLife (so decay = 0.5 at t = halfLife).
	 */
	private recomputePosteriors(): void {
		const now = Date.now();
		const lambda = Math.LN2 / this.halfLifeMs;

		// Reset to priors
		const params = {
			cosine: { alpha: 1, beta: 1 },
			pagerank: { alpha: 1, beta: 1 },
			textmatch: { alpha: 1, beta: 1 },
		};

		for (const record of this.feedbackHistory) {
			const age = now - record.timestamp;
			const decay = Math.exp(-lambda * age);
			const component = params[record.dominant];

			if (record.accepted) {
				component.alpha += decay;
			} else {
				component.beta += decay;
			}
		}

		this.cosineAlpha = params.cosine.alpha;
		this.cosineBeta = params.cosine.beta;
		this.pagerankAlpha = params.pagerank.alpha;
		this.pagerankBeta = params.pagerank.beta;
		this.textAlpha = params.textmatch.alpha;
		this.textBeta = params.textmatch.beta;
	}
}

// ─── MMR Diversity Re-ranking ────────────────────────────────────────────────

/**
 * Apply Maximal Marginal Relevance (MMR) re-ranking for diversity.
 *
 * MMR (Carbonell & Goldstein, 1998) selects documents by balancing relevance
 * against redundancy:
 *
 *   MMR(d) = lambda * score(d) - (1 - lambda) * max_{d_j in S} sim(d, d_j)
 *
 * At each step, the unselected document with highest MMR is added to the
 * selected set S. This greedy procedure is O(k * n) and produces results
 * that are both relevant AND diverse.
 *
 * When embeddings are available, uses cosine similarity for inter-document
 * similarity. Falls back to Jaccard similarity on tokenized text.
 *
 * @param scored - Candidates with scores (from AdaptiveScorer.score()).
 * @param lambda - Trade-off: 1.0 = pure relevance, 0.0 = pure diversity. Default 0.7.
 * @param topK - Number of results to return. Default 10.
 * @returns Re-ranked top-K candidates.
 */
export function mmrRerank(
	scored: ScoredCandidate[],
	lambda: number = 0.7,
	topK: number = 10,
): ScoredCandidate[] {
	if (scored.length <= 1 || topK <= 0) return scored.slice(0, topK);

	const k = Math.min(topK, scored.length);
	const selected: ScoredCandidate[] = [];
	const remaining = [...scored];

	// Select the highest-scored document first (no diversity penalty)
	remaining.sort((a, b) => b.finalScore - a.finalScore);
	selected.push(remaining.shift()!);

	while (selected.length < k && remaining.length > 0) {
		let bestIdx = 0;
		let bestMMR = -Infinity;

		for (let i = 0; i < remaining.length; i++) {
			const candidate = remaining[i];

			// Find maximum similarity to any already-selected document
			let maxSim = 0;
			for (const sel of selected) {
				const sim = computeSimilarity(candidate, sel);
				if (sim > maxSim) maxSim = sim;
			}

			const mmr = lambda * candidate.finalScore - (1 - lambda) * maxSim;
			if (mmr > bestMMR) {
				bestMMR = mmr;
				bestIdx = i;
			}
		}

		selected.push(remaining.splice(bestIdx, 1)[0]);
	}

	return selected;
}

/**
 * Compute similarity between two scored candidates.
 * Prefers embedding cosine similarity; falls back to score-vector distance.
 */
function computeSimilarity(a: ScoredCandidate, b: ScoredCandidate): number {
	// Use embeddings if both have them
	if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
		return Math.max(0, cosineSimilarity(a.embedding, b.embedding));
	}

	// Fallback: similarity based on the 3D score vector
	const vecA = [a.cosineScore, a.pagerankScore, a.textScore];
	const vecB = [b.cosineScore, b.pagerankScore, b.textScore];
	return Math.max(0, cosineSimilarity(vecA, vecB));
}
