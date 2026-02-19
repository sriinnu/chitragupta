/**
 * @chitragupta/smriti — Samshodhana (सम्शोधन) — Hybrid Search Engine.
 *
 * Fuses BM25, vector, GraphRAG, and Pramana signals via Reciprocal Rank Fusion:
 *   score(d) = Σ w_i / (k + rank_i(d))
 *
 * Thompson Sampling (HybridWeightLearner, in hybrid-search-learner.ts) learns
 * optimal signal weights from feedback. Self-RAG gate (`shouldRetrieve()`)
 * determines whether retrieval is needed at all.
 */

import type { SessionMeta, RecallResult, GraphNode, PramanaType } from "./types.js";
import { searchSessions } from "./search.js";
import { RecallEngine } from "./recall.js";
import { GraphRAGEngine } from "./graphrag.js";
import type { KalaChakra } from "./kala-chakra.js";
import { HybridWeightLearner } from "./hybrid-search-learner.js";

// Re-export learner class and state type so consumers keep importing from this file
export { HybridWeightLearner } from "./hybrid-search-learner.js";
export type { HybridWeightLearnerState } from "./hybrid-search-learner.js";

// ─── Pramana Reliability Map ────────────────────────────────────────────────

/** Epistemic reliability weights for each Pramana category (Nyaya epistemology). */
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
	/** RRF smoothing constant k (default 60). Higher = more uniform fusion. */
	k: number;
	/** Maximum results to return (default 10). */
	topK: number;
	enableBM25: boolean;
	enableVector: boolean;
	enableGraphRAG: boolean;
	/** Pramana weight coefficient delta (default 0.1). */
	pramanaWeight: number;
	/** Enable pramana-weighted scoring (default true). */
	enablePramana: boolean;
	/** Project path for scoping BM25 session search. */
	project?: string;
	/** Minimum RRF score threshold (default 0). */
	minScore: number;
}

const DEFAULT_CONFIG: HybridSearchConfig = {
	k: 60, topK: 10,
	enableBM25: true, enableVector: true, enableGraphRAG: true,
	pramanaWeight: 0.1, enablePramana: true, minScore: 0,
};

// ─── Self-RAG Gate ──────────────────────────────────────────────────────────

/**
 * Self-RAG gate: determines whether retrieval is needed (Asai et al. 2023).
 * Checks for knowledge-gap signals in the query (questions, references, lookups).
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

/**
 * Hybrid search engine that fuses BM25, vector, GraphRAG, and Pramana
 * signals via Reciprocal Rank Fusion (RRF) with optional Thompson Sampling
 * weight learning and KalaChakra temporal boosting.
 */
export class HybridSearchEngine {
	private recallEngine: RecallEngine | null;
	private graphEngine: GraphRAGEngine | null;
	private config: HybridSearchConfig;
	private weightLearner: HybridWeightLearner | null;
	private kalaChakra: KalaChakra | null;

	/** Create a new hybrid search engine with optional engines and learner. */
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

	/** Set or replace the RecallEngine instance. */
	setRecallEngine(engine: RecallEngine): void { this.recallEngine = engine; }

	/** Set or replace the GraphRAGEngine instance. */
	setGraphEngine(engine: GraphRAGEngine): void { this.graphEngine = engine; }

	/** Set or replace the HybridWeightLearner instance. */
	setWeightLearner(learner: HybridWeightLearner): void { this.weightLearner = learner; }

	/** Get the current HybridWeightLearner, or null if not set. */
	getWeightLearner(): HybridWeightLearner | null { return this.weightLearner; }

	/** Set or replace the KalaChakra temporal awareness engine. */
	setKalaChakra(kala: KalaChakra): void { this.kalaChakra = kala; }

	/** Get the current KalaChakra instance, or null if not set. */
	getKalaChakra(): KalaChakra | null { return this.kalaChakra; }

	/**
	 * Record feedback for a search result. Updates Thompson Sampling posteriors
	 * for each contributing signal (and pramana if present).
	 */
	recordFeedback(result: HybridSearchResult, success: boolean): void {
		if (!this.weightLearner) return;
		for (const source of result.sources) {
			this.weightLearner.update(source, success);
		}
		if (result.pramana) {
			this.weightLearner.update("pramana", success);
		}
	}

	/**
	 * Perform hybrid search across all enabled rankers, fusing via weighted RRF.
	 * When a HybridWeightLearner is set, weights are Thompson-sampled; otherwise uniform.
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
				const rrfContribution = ranking.weight / (cfg.k + rank);

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
		for (const entry of fusedScores.values()) {
			if (entry.sources.size >= 3) {
				entry.score *= 1.15; // Triple agreement: 15% boost
			} else if (entry.sources.size >= 2) {
				entry.score *= 1.05; // Double agreement: 5% boost
			}
		}

		// ─── Pramana epistemic boost ────────────────────────────────────
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

	/** Self-RAG gated search -- only retrieves if the query signals a knowledge gap. */
	async gatedSearch(
		query: string,
		configOverride?: Partial<HybridSearchConfig>,
	): Promise<HybridSearchResult[]> {
		if (!shouldRetrieve(query)) return [];
		return this.search(query, configOverride);
	}
}
