/**
 * @chitragupta/smriti — Samshodhana (सम्शोधन) — Hybrid Search Engine.
 *
 * Fuses four ranking signals via Reciprocal Rank Fusion (RRF):
 *   1. BM25 full-text search (search.ts)
 *   2. Vector similarity (recall.ts / RecallEngine)
 *   3. GraphRAG knowledge-graph search (graphrag.ts)
 *   4. Pramana epistemic reliability weight (pratyaksha > anumana > shabda > ...)
 *
 * RRF formula (Cormack et al.):
 *   score(d) = Σ 1 / (k + rank_i(d))
 *
 * where k is a smoothing constant (default 60) and rank_i(d) is the rank of
 * document d in the i-th ranking. RRF is parameter-free beyond k, doesn't
 * require score normalization, and handles missing documents gracefully.
 *
 * The 4th signal (Pramana) is an additive epistemic boost:
 *   finalScore = rrfScore + δ * pramanaReliability(d)
 *
 * Where δ is a configurable coefficient and pramanaReliability maps the 6
 * Nyaya epistemological categories to reliability weights:
 *   pratyaksha (1.0) > anumana (0.85) > shabda (0.75) > upamana (0.6) >
 *   arthapatti (0.5) > anupalabdhi (0.4)
 *
 * Thompson Sampling (HybridWeightLearner): learns the optimal blend of
 * BM25, vector, graphrag, and pramana signal contributions from user
 * feedback. Each signal has a Beta(α, β) posterior; we sample weights,
 * normalize, and use them to re-weight the RRF contributions. On feedback,
 * we update the contributing signals' posteriors.
 *
 * Self-RAG gate: the `shouldRetrieve()` heuristic determines whether retrieval
 * is needed at all, inspired by Self-RAG (Asai et al. 2023) — don't search
 * every turn, only when there's a knowledge gap.
 */

import type {
	SessionMeta,
	RecallResult,
	GraphNode,
	PramanaType,
} from "./types.js";
import { searchSessions } from "./search.js";
import { RecallEngine } from "./recall.js";
import { GraphRAGEngine } from "./graphrag.js";
import type { KalaChakra } from "./kala-chakra.js";

// ─── Pramana Reliability Map ────────────────────────────────────────────────

/**
 * Epistemic reliability weights for each Pramana category.
 *
 * Based on Nyaya epistemology (षड् प्रमाण):
 *   - Pratyaksha (direct perception): highest reliability — firsthand observation.
 *   - Anumana (inference): high — logical deduction from observed premises.
 *   - Shabda (testimony): moderate-high — documented knowledge from authorities.
 *   - Upamana (analogy): moderate — reasoning by structural similarity.
 *   - Arthapatti (postulation): lower — hypothesized to explain an anomaly.
 *   - Anupalabdhi (non-apprehension): lowest — knowledge from absence.
 */
export const PRAMANA_RELIABILITY: Readonly<Record<PramanaType, number>> = {
	pratyaksha: 1.0,
	anumana: 0.85,
	shabda: 0.75,
	upamana: 0.6,
	arthapatti: 0.5,
	anupalabdhi: 0.4,
};

// ─── Types ──────────────────────────────────────────────────────────────────

/** Signal names for the 4 ranking dimensions. */
export type HybridSignal = "bm25" | "vector" | "graphrag" | "pramana";

/** A unified search result from the hybrid engine. */
export interface HybridSearchResult {
	/** Unique document identifier (session ID, stream ID, or graph node ID). */
	id: string;
	/** Human-readable title. */
	title: string;
	/** The matched or most relevant text snippet. */
	content: string;
	/** Source ranking system that contributed this result. */
	sources: Array<"bm25" | "vector" | "graphrag">;
	/** RRF-fused score (higher is more relevant). */
	score: number;
	/** Individual rank in each system (undefined if not present in that ranking). */
	ranks: {
		bm25?: number;
		vector?: number;
		graphrag?: number;
	};
	/** The pramana type associated with this result (if resolved). */
	pramana?: PramanaType;
	/** Unix timestamp (ms) of the document, if known. Used by KalaChakra temporal boost. */
	timestamp?: number;
}

/** Configuration for the hybrid search engine. */
export interface HybridSearchConfig {
	/** RRF smoothing constant k. Default: 60. Higher = more uniform fusion. */
	k: number;
	/** Maximum results to return. Default: 10. */
	topK: number;
	/** Enable/disable individual rankers. */
	enableBM25: boolean;
	enableVector: boolean;
	enableGraphRAG: boolean;
	/** Pramana weight coefficient δ. Default: 0.1. Higher = more epistemic weight. */
	pramanaWeight: number;
	/** Enable pramana-weighted scoring. Default: true. */
	enablePramana: boolean;
	/** Project path for scoping BM25 session search. */
	project?: string;
	/** Minimum RRF score threshold. Default: 0. */
	minScore: number;
}

const DEFAULT_CONFIG: HybridSearchConfig = {
	k: 60,
	topK: 10,
	enableBM25: true,
	enableVector: true,
	enableGraphRAG: true,
	pramanaWeight: 0.1,
	enablePramana: true,
	minScore: 0,
};

// ─── Thompson Sampling: Beta Distribution Helpers ───────────────────────────

/**
 * Box-Muller transform for standard normal samples.
 * Returns z ~ N(0, 1).
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

// ─── Hybrid Weight Learner (Thompson Sampling) ─────────────────────────────

/** Signal indices for the 4 hybrid dimensions. */
const SIGNAL_INDEX: Record<HybridSignal, number> = {
	bm25: 0,
	vector: 1,
	graphrag: 2,
	pramana: 3,
};

const NUM_SIGNALS = 4;

/** Serialized state of the HybridWeightLearner. */
export interface HybridWeightLearnerState {
	alphas: number[];
	betas: number[];
	totalFeedback: number;
}

/**
 * Learns the optimal blend of BM25, vector, graphrag, and pramana signals
 * using Thompson Sampling with Beta posteriors.
 *
 * Each signal has a Beta(α, β) distribution representing our belief about
 * its usefulness. On each query, we SAMPLE weights from the posteriors
 * (exploration-exploitation trade-off). When the user selects a result
 * (positive feedback) or rejects one (negative), we update the posteriors
 * of the contributing signals.
 *
 * The learned weights are used as multiplicative modifiers on the RRF
 * contributions from each signal.
 *
 * Convergence: with uniform prior Beta(1,1), the posterior mean α/(α+β)
 * converges to the true signal utility as feedback accumulates. Thompson
 * Sampling naturally concentrates sampling around high-utility signals
 * while maintaining exploration of under-sampled ones.
 */
export class HybridWeightLearner {
	/** Success counts (α) for each of the 4 signals. */
	private _alphas: Float64Array;
	/** Failure counts (β) for each of the 4 signals. */
	private _betas: Float64Array;
	/** Total feedback events received. */
	private _totalFeedback: number;

	/**
	 * @param priorAlpha - Initial α for all signals. Default: 1 (uniform prior).
	 * @param priorBeta - Initial β for all signals. Default: 1 (uniform prior).
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
	 * Each signal's weight is sampled from Beta(α_i, β_i), then the 4
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
	 * Get the posterior mean for each signal: α / (α + β).
	 * Useful for diagnostics and logging.
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

// ─── Self-RAG Gate ──────────────────────────────────────────────────────────

/**
 * Heuristic to determine whether retrieval is necessary.
 *
 * Inspired by Self-RAG (Asai et al. 2023): the agent should only retrieve
 * when there's a genuine knowledge gap. We detect this via surface signals
 * in the query — questions, references to past work, specific lookups.
 *
 * @param query - The user's query or agent's internal retrieval trigger.
 * @returns true if retrieval is recommended.
 */
export function shouldRetrieve(query: string): boolean {
	const lower = query.toLowerCase().trim();

	// Direct knowledge-gap signals
	const gapPatterns = [
		/\bwhat did\b/,
		/\bwhen did\b/,
		/\bhow did\b/,
		/\bwhy did\b/,
		/\bdo you remember\b/,
		/\bpreviously\b/,
		/\blast time\b/,
		/\bearlier\b/,
		/\bbefore\b/,
		/\brecall\b/,
		/\bhistory\b/,
		/\bwe discussed\b/,
		/\bwe decided\b/,
		/\bwe agreed\b/,
		/\bwhat was\b/,
		/\bwhat is the status\b/,
		/\bfind\b.*\b(file|code|function|class|module)\b/,
		/\bsearch\b/,
		/\blook up\b/,
		/\bshow me\b.*\bfrom\b/,
	];

	for (const pattern of gapPatterns) {
		if (pattern.test(lower)) return true;
	}

	// Questions are retrieval candidates (but not simple how-to questions)
	if (lower.endsWith("?") && lower.length > 20) return true;

	// References to specific sessions, files, or past decisions
	if (/session[:\s]/i.test(lower)) return true;
	if (/\bproject\b.*\b(memory|context|knowledge)\b/i.test(lower)) return true;

	return false;
}

// ─── Hybrid Search Engine ───────────────────────────────────────────────────

export class HybridSearchEngine {
	private recallEngine: RecallEngine | null;
	private graphEngine: GraphRAGEngine | null;
	private config: HybridSearchConfig;
	private weightLearner: HybridWeightLearner | null;
	private kalaChakra: KalaChakra | null;

	constructor(
		config?: Partial<HybridSearchConfig>,
		recallEngine?: RecallEngine,
		graphEngine?: GraphRAGEngine,
		weightLearner?: HybridWeightLearner,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.recallEngine = recallEngine ?? null;
		this.graphEngine = graphEngine ?? null;
		this.weightLearner = weightLearner ?? null;
		this.kalaChakra = null;
	}

	/**
	 * Set or replace the RecallEngine instance.
	 */
	setRecallEngine(engine: RecallEngine): void {
		this.recallEngine = engine;
	}

	/**
	 * Set or replace the GraphRAGEngine instance.
	 */
	setGraphEngine(engine: GraphRAGEngine): void {
		this.graphEngine = engine;
	}

	/**
	 * Set or replace the HybridWeightLearner instance.
	 */
	setWeightLearner(learner: HybridWeightLearner): void {
		this.weightLearner = learner;
	}

	/**
	 * Get the current HybridWeightLearner, or null if not set.
	 */
	getWeightLearner(): HybridWeightLearner | null {
		return this.weightLearner;
	}

	/**
	 * Set or replace the KalaChakra temporal awareness engine.
	 * When set, search results with timestamps receive a temporal boost.
	 */
	setKalaChakra(kala: KalaChakra): void {
		this.kalaChakra = kala;
	}

	/**
	 * Get the current KalaChakra instance, or null if not set.
	 */
	getKalaChakra(): KalaChakra | null {
		return this.kalaChakra;
	}

	/**
	 * Record feedback for a search result.
	 *
	 * Updates the Thompson Sampling weight learner based on which signals
	 * contributed to the result the user selected (success) or rejected (failure).
	 *
	 * @param result - The search result receiving feedback.
	 * @param success - true = user found it useful, false = irrelevant.
	 */
	recordFeedback(result: HybridSearchResult, success: boolean): void {
		if (!this.weightLearner) return;

		// Update each contributing signal
		for (const source of result.sources) {
			this.weightLearner.update(source, success);
		}

		// If pramana was a contributing factor (result has a pramana type),
		// update the pramana signal too
		if (result.pramana) {
			this.weightLearner.update("pramana", success);
		}
	}

	/**
	 * Perform hybrid search across all enabled rankers.
	 *
	 * Each ranker produces its own ranking. Results are fused via RRF:
	 *   score(d) = Σ w_i / (k + rank_i(d))
	 *
	 * When a HybridWeightLearner is set, w_i are Thompson-sampled weights.
	 * Otherwise, all weights are 1.0 (standard RRF).
	 *
	 * When pramana is enabled, each result receives an additive epistemic boost:
	 *   finalScore += δ * pramanaReliability(d)
	 *
	 * @param query - The search query.
	 * @param configOverride - Optional per-query config overrides.
	 * @returns Fused results sorted by score descending.
	 */
	async search(
		query: string,
		configOverride?: Partial<HybridSearchConfig>,
	): Promise<HybridSearchResult[]> {
		const cfg = { ...this.config, ...configOverride };

		// Sample weights from Thompson posteriors (or use uniform)
		const weights = this.weightLearner
			? this.weightLearner.sample()
			: { bm25: 1, vector: 1, graphrag: 1, pramana: 1 };

		// Collect rankings from each enabled source
		const rankings: Array<{
			source: "bm25" | "vector" | "graphrag";
			weight: number;
			results: Array<{ id: string; title: string; content: string }>;
		}> = [];

		// Run all enabled rankers in parallel
		const tasks: Promise<void>[] = [];

		if (cfg.enableBM25) {
			tasks.push(
				(async () => {
					const bm25Results = searchSessions(query, cfg.project);
					rankings.push({
						source: "bm25",
						weight: weights.bm25,
						results: bm25Results.map((meta: SessionMeta) => ({
							id: meta.id,
							title: meta.title,
							content: `${meta.title} [${meta.tags.join(", ")}] agent:${meta.agent}`,
						})),
					});
				})(),
			);
		}

		if (cfg.enableVector && this.recallEngine) {
			tasks.push(
				(async () => {
					try {
						const vectorResults = await this.recallEngine!.recall(query, {
							topK: cfg.topK * 2, // Over-fetch for fusion
						});
						rankings.push({
							source: "vector",
							weight: weights.vector,
							results: vectorResults.map((r: RecallResult) => ({
								id: r.sessionId,
								title: r.title,
								content: r.matchedContent || r.summary,
							})),
						});
					} catch {
						// Vector search unavailable — continue without it
					}
				})(),
			);
		}

		if (cfg.enableGraphRAG && this.graphEngine) {
			tasks.push(
				(async () => {
					try {
						const graphResults = await this.graphEngine!.search(query, undefined, cfg.topK * 2);
						rankings.push({
							source: "graphrag",
							weight: weights.graphrag,
							results: graphResults.map((node: GraphNode) => ({
								id: node.id,
								title: node.label,
								content: node.content,
							})),
						});
					} catch {
						// GraphRAG unavailable — continue without it
					}
				})(),
			);
		}

		await Promise.all(tasks);

		if (rankings.length === 0) return [];

		// ─── Reciprocal Rank Fusion ──────────────────────────────────────

		const fusedScores = new Map<string, {
			id: string;
			title: string;
			content: string;
			score: number;
			sources: Set<"bm25" | "vector" | "graphrag">;
			ranks: Record<string, number>;
			timestamp?: number;
		}>();

		for (const ranking of rankings) {
			for (let rank = 0; rank < ranking.results.length; rank++) {
				const doc = ranking.results[rank];
				// Weighted RRF: w_i / (k + rank)
				const rrfContribution = ranking.weight / (cfg.k + rank); // rank is 0-indexed; standard RRF: 1/(k + rank_1based) = 1/(k + rank_0based) since k absorbs the offset

				const existing = fusedScores.get(doc.id);
				if (existing) {
					existing.score += rrfContribution;
					existing.sources.add(ranking.source);
					existing.ranks[ranking.source] = rank + 1;
					// Prefer longer content from any source
					if (doc.content.length > existing.content.length) {
						existing.content = doc.content;
					}
				} else {
					const sources = new Set<"bm25" | "vector" | "graphrag">();
					sources.add(ranking.source);
					fusedScores.set(doc.id, {
						id: doc.id,
						title: doc.title,
						content: doc.content,
						score: rrfContribution,
						sources,
						ranks: { [ranking.source]: rank + 1 },
					});
				}
			}
		}

		// ─── Multi-source boost ──────────────────────────────────────────
		// Documents found by multiple rankers get a small bonus,
		// rewarding agreement across heterogeneous signals.
		for (const entry of fusedScores.values()) {
			if (entry.sources.size >= 3) {
				entry.score *= 1.15; // Triple agreement: 15% boost
			} else if (entry.sources.size >= 2) {
				entry.score *= 1.05; // Double agreement: 5% boost
			}
		}

		// ─── Pramana epistemic boost ────────────────────────────────────
		// Look up the pramana type for each document and add an additive
		// reliability bonus weighted by δ (pramanaWeight).

		const pramanaMap = new Map<string, PramanaType>();

		if (cfg.enablePramana && this.graphEngine) {
			const docIds = [...fusedScores.keys()];
			const batchPramana = this.graphEngine.lookupPramanaBatch(docIds);
			for (const [id, ptype] of batchPramana) {
				pramanaMap.set(id, ptype);
			}

			const delta = cfg.pramanaWeight * weights.pramana;

			for (const entry of fusedScores.values()) {
				const ptype = pramanaMap.get(entry.id) ?? "shabda";
				const reliability = PRAMANA_RELIABILITY[ptype];
				entry.score += delta * reliability;
			}
		}

		// ─── Kala Chakra temporal boost ──────────────────────────────────
		// When a KalaChakra engine is set and a document has a timestamp,
		// apply temporal relevance boosting:
		//   score = kalaChakra.boostScore(score, timestamp)
		if (this.kalaChakra) {
			for (const entry of fusedScores.values()) {
				if (entry.timestamp !== undefined) {
					entry.score = this.kalaChakra.boostScore(entry.score, entry.timestamp);
				}
			}
		}

		// ─── Sort and filter ─────────────────────────────────────────────

		const sorted = [...fusedScores.values()]
			.filter((r) => r.score >= cfg.minScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, cfg.topK);

		return sorted.map((r) => ({
			id: r.id,
			title: r.title,
			content: r.content,
			sources: [...r.sources],
			score: r.score,
			ranks: {
				bm25: r.ranks.bm25,
				vector: r.ranks.vector,
				graphrag: r.ranks.graphrag,
			},
			pramana: pramanaMap.get(r.id),
			timestamp: r.timestamp,
		}));
	}

	/**
	 * Self-RAG gated search — only retrieves if the query signals a knowledge gap.
	 *
	 * @param query - The query to evaluate and optionally search.
	 * @returns Results if retrieval was triggered, empty array otherwise.
	 */
	async gatedSearch(
		query: string,
		configOverride?: Partial<HybridSearchConfig>,
	): Promise<HybridSearchResult[]> {
		if (!shouldRetrieve(query)) return [];
		return this.search(query, configOverride);
	}
}
