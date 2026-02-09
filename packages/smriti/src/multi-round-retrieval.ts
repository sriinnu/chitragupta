/**
 * @chitragupta/smriti — Anveshana (अन्वेषण) — Multi-Round Retrieval Engine.
 *
 * In Vedic tradition, anveshana is the disciplined investigation that goes
 * beyond surface observation — asking deeper questions until truth is found.
 *
 * Complex queries like "What architecture decisions did we make about auth
 * that affected the API layer?" cannot be answered by a single retrieval pass.
 * Anveshana decomposes such queries into sub-queries, retrieves for each,
 * and fuses results with cross-query deduplication and weighted scoring.
 *
 * Pipeline:
 *   1. Analyze query complexity (word count, conjunctions, temporal markers)
 *   2. If simple, delegate directly to HybridSearchEngine (single round)
 *   3. If complex, decompose into weighted sub-queries via heuristics
 *   4. For each sub-query, run hybrid search
 *   5. Fuse results with weighted RRF + cross-query dedup
 *   6. Optionally run follow-up rounds based on result gaps
 *   7. Apply adaptive termination when improvement plateaus
 *
 * The decomposer is purely heuristic — no LLM calls. Fast and free.
 */

import type { HybridSearchEngine, HybridSearchResult } from "./hybrid-search.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A decomposed sub-query with its purpose. */
export interface SubQuery {
	/** The sub-query text. */
	query: string;
	/** Why this sub-query was generated. */
	intent: string;
	/** Weight of this sub-query in final scoring [0, 1]. */
	weight: number;
}

/** Result from a single retrieval round. */
export interface RoundResult {
	/** Which sub-query produced these results. */
	subQuery: SubQuery;
	/** Results from this round. */
	results: MultiRoundResult[];
	/** Round number (0-indexed). */
	round: number;
}

/** A unified result from multi-round retrieval. */
export interface MultiRoundResult {
	/** Document ID. */
	id: string;
	/** Title. */
	title: string;
	/** Content snippet. */
	content: string;
	/** Which sub-queries found this document. */
	foundBy: string[];
	/** Fused score across all rounds. */
	score: number;
	/** Individual round scores. */
	roundScores: { query: string; score: number }[];
}

/** Configuration for multi-round retrieval. */
export interface MultiRoundConfig {
	/** Maximum number of sub-queries to generate. Default: 4. */
	maxSubQueries: number;
	/** Maximum retrieval rounds. Default: 3. */
	maxRounds: number;
	/** Minimum score improvement to continue rounds. Default: 0.05. */
	improvementThreshold: number;
	/** Maximum total results. Default: 15. */
	maxResults: number;
	/** Weight boost for documents found by multiple sub-queries. Default: 1.3. */
	multiQueryBoost: number;
	/** Enable adaptive round termination. Default: true. */
	adaptiveTermination: boolean;
}

/** Statistics from the last search invocation. */
interface SearchStats {
	totalRounds: number;
	subQueriesGenerated: number;
	resultsBefore: number;
	resultsAfter: number;
	improvementPerRound: number[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: MultiRoundConfig = {
	maxSubQueries: 4,
	maxRounds: 3,
	improvementThreshold: 0.05,
	maxResults: 15,
	multiQueryBoost: 1.3,
	adaptiveTermination: true,
};

/** Words that signal compound/relative clause structures. */
const CONJUNCTIONS = /\b(and|or|but|that|which|who|where|when|while|although)\b/i;

/** Temporal markers for time-scoped queries. */
const TEMPORAL = /\b(when|before|after|last\s+(?:time|week|month|year|day)|yesterday|recently|earlier|previously|ago|since|until)\b/i;

/** Comparative structures. */
const COMPARATIVE = /\b(vs\.?|versus|compared?\s+to|difference\s+between|between\s+\w+\s+and)\b/i;

/** Causal structures. */
const CAUSAL = /\b(why|because|caused?\s*(?:by)?|led\s+to|resulted?\s+in|reason\s+for|due\s+to)\b/i;

/** Minimum word count for complexity consideration. */
const COMPLEXITY_WORD_THRESHOLD = 8;

/** Positional weight decay for sub-queries: w(i) = max(0.4, 1.0 - 0.2 * i). */
const positionalWeight = (index: number): number =>
	Math.max(0.4, 1.0 - 0.2 * index);

/** Specificity bonus: longer sub-queries get higher weight. */
const specificityBonus = (query: string): number => {
	const words = query.trim().split(/\s+/).length;
	if (words >= 5) return 0.1;
	if (words >= 3) return 0.05;
	return 0;
};

// ─── AnveshanaEngine ────────────────────────────────────────────────────────

/**
 * Anveshana -- Multi-Round Retrieval Engine.
 *
 * Decomposes complex queries into sub-queries, retrieves for each via
 * HybridSearchEngine, and fuses results with weighted RRF and cross-query
 * deduplication. Uses purely heuristic decomposition (no LLM calls).
 *
 * @example
 * ```ts
 * import { AnveshanaEngine } from "@chitragupta/smriti";
 *
 * const engine = new AnveshanaEngine(hybridSearch, { maxRounds: 3 });
 * const results = await engine.search(
 *   "What architecture decisions affected auth and the API layer?"
 * );
 * for (const r of results) {
 *   console.log(r.title, r.score, r.foundBy);
 * }
 * ```
 */
export class AnveshanaEngine {
	private hybridSearch: HybridSearchEngine;
	private config: MultiRoundConfig;
	private lastStats: SearchStats | null = null;

	/**
	 * Create a new AnveshanaEngine.
	 *
	 * @param hybridSearch - The underlying HybridSearchEngine for single-round retrieval.
	 * @param config - Optional partial configuration; unset fields use defaults.
	 */
	constructor(
		hybridSearch: HybridSearchEngine,
		config?: Partial<MultiRoundConfig>,
	) {
		this.hybridSearch = hybridSearch;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Perform multi-round retrieval on a complex query.
	 *
	 * Pipeline:
	 * 1. Analyze query complexity
	 * 2. If simple, delegate directly to hybrid search (single round)
	 * 3. If complex, decompose into sub-queries
	 * 4. For each sub-query, run hybrid search
	 * 5. Fuse results with weighted RRF + cross-query dedup
	 * 6. Optionally run follow-up rounds based on result gaps
	 *
	 * @param query - The user's search query.
	 * @returns Fused and ranked results, capped at maxResults.
	 */
	async search(query: string): Promise<MultiRoundResult[]> {
		// Simple queries bypass decomposition entirely.
		if (!this.isComplexQuery(query)) {
			const hybridResults = await this.hybridSearch.search(query);
			const results = hybridResults.map((r: HybridSearchResult) => ({
				id: r.id,
				title: r.title,
				content: r.content,
				foundBy: [query],
				score: r.score,
				roundScores: [{ query, score: r.score }],
			}));
			this.lastStats = {
				totalRounds: 1,
				subQueriesGenerated: 0,
				resultsBefore: hybridResults.length,
				resultsAfter: results.length,
				improvementPerRound: [],
			};
			return results.slice(0, this.config.maxResults);
		}

		// ─── Complex query: decompose and iterate ─────────────────────────

		const subQueries = this.decompose(query);
		const allRounds: RoundResult[] = [];
		const improvementPerRound: number[] = [];
		let previousTopScore = 0;

		// Round 1: run all initial sub-queries
		const round0Results = await this.executeRound(subQueries, 0);
		allRounds.push(...round0Results);

		let currentFused = this.fuseResults(allRounds);
		previousTopScore = currentFused.length > 0 ? currentFused[0].score : 0;

		// Subsequent rounds: generate follow-up sub-queries from gaps.
		let allPreviousSubQueries = [...subQueries];

		for (let round = 1; round < this.config.maxRounds; round++) {
			const followUps = this.generateFollowUp(
				query,
				currentFused,
				allPreviousSubQueries,
			);

			if (followUps.length === 0) break;

			const roundResults = await this.executeRound(followUps, round);
			allRounds.push(...roundResults);
			allPreviousSubQueries = [...allPreviousSubQueries, ...followUps];

			const newFused = this.fuseResults(allRounds);
			const newTopScore = newFused.length > 0 ? newFused[0].score : 0;
			const improvement = newTopScore - previousTopScore;
			improvementPerRound.push(improvement);

			// Adaptive termination: stop if no meaningful improvement.
			if (this.config.adaptiveTermination) {
				const newDocIds = new Set(newFused.map((r) => r.id));
				const oldDocIds = new Set(currentFused.map((r) => r.id));
				const hasNewDocs = [...newDocIds].some((id) => !oldDocIds.has(id));

				if (!hasNewDocs && improvement < this.config.improvementThreshold) {
					currentFused = newFused;
					break;
				}
			}

			currentFused = newFused;
			previousTopScore = newTopScore;
		}

		const finalResults = currentFused.slice(0, this.config.maxResults);

		// Collect total raw results before fusion for stats.
		const totalRawResults = allRounds.reduce(
			(sum, r) => sum + r.results.length,
			0,
		);

		this.lastStats = {
			totalRounds: allRounds.length > 0
				? Math.max(...allRounds.map((r) => r.round)) + 1
				: 1,
			subQueriesGenerated: allPreviousSubQueries.length,
			resultsBefore: totalRawResults,
			resultsAfter: finalResults.length,
			improvementPerRound,
		};

		return finalResults;
	}

	/**
	 * Decompose a complex query into sub-queries.
	 *
	 * Uses purely heuristic decomposition (no LLM):
	 *   - Splits on conjunctions ("and", "or", "that", "which")
	 *   - Detects comparative structures ("vs", "compared to")
	 *   - Detects causal structures ("why", "because", "led to")
	 *   - Extracts multi-entity lists ("auth, sessions, and tokens")
	 *   - Always includes the original query with weight 1.0
	 *
	 * @param query - The user's search query.
	 * @returns Array of weighted sub-queries.
	 */
	decompose(query: string): SubQuery[] {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const subQueries: SubQuery[] = [];

		// The original query always participates with maximum weight.
		subQueries.push({
			query: trimmed,
			intent: "original query",
			weight: 1.0,
		});

		// If the query is too simple for meaningful decomposition, return as-is.
		if (!this.isComplexQuery(trimmed)) return subQueries;

		// ─── Comparative decomposition ────────────────────────────────────
		const comparativeMatch = trimmed.match(
			/^(.+?)\s+(?:vs\.?|versus|compared?\s+to)\s+(.+)$/i,
		);
		if (comparativeMatch) {
			const [, left, right] = comparativeMatch;
			subQueries.push(
				{
					query: left.trim(),
					intent: "comparative left side",
					weight: positionalWeight(subQueries.length),
				},
				{
					query: right.trim(),
					intent: "comparative right side",
					weight: positionalWeight(subQueries.length + 1),
				},
			);
			return this.clampSubQueries(subQueries);
		}

		// ─── "difference between X and Y" decomposition ──────────────────
		const diffBetween = trimmed.match(
			/difference\s+between\s+(.+?)\s+and\s+(.+)/i,
		);
		if (diffBetween) {
			const [, left, right] = diffBetween;
			subQueries.push(
				{
					query: left.trim(),
					intent: "comparison entity A",
					weight: positionalWeight(subQueries.length),
				},
				{
					query: right.trim(),
					intent: "comparison entity B",
					weight: positionalWeight(subQueries.length + 1),
				},
			);
			return this.clampSubQueries(subQueries);
		}

		// ─── Causal decomposition ─────────────────────────────────────────
		if (CAUSAL.test(trimmed)) {
			const causalParts = trimmed.split(CAUSAL).filter((s) => s.trim());
			for (const part of causalParts) {
				const cleaned = part.trim();
				if (cleaned.length >= 3 && cleaned !== trimmed) {
					subQueries.push({
						query: cleaned,
						intent: "causal component",
						weight: positionalWeight(subQueries.length),
					});
				}
			}
			if (subQueries.length > 1) {
				return this.clampSubQueries(subQueries);
			}
		}

		// ─── Multi-entity list decomposition ─────────────────────────────
		// "auth, sessions, and tokens" → three sub-queries
		const listMatch = trimmed.match(
			/^(.*?)(\b\w+(?:\s+\w+)?)(?:,\s*(\b\w+(?:\s+\w+)?))+(?:,?\s*and\s+(\b\w+(?:\s+\w+)?))\b(.*)$/i,
		);
		if (listMatch) {
			// Use a simpler extraction: find comma-separated items with optional trailing "and"
			const entityParts = this.extractListEntities(trimmed);
			if (entityParts.length >= 2) {
				for (const entity of entityParts) {
					subQueries.push({
						query: entity.trim(),
						intent: "list entity",
						weight: positionalWeight(subQueries.length),
					});
				}
				return this.clampSubQueries(subQueries);
			}
		}

		// ─── Conjunction splitting ─────────────────────────────────────────
		if (CONJUNCTIONS.test(trimmed)) {
			const parts = trimmed
				.split(CONJUNCTIONS)
				.map((s) => s.trim())
				.filter((s) => s.length >= 3);

			for (const part of parts) {
				// Skip if the part is just a conjunction itself.
				if (/^(and|or|but|that|which|who|where|when|while|although)$/i.test(part)) {
					continue;
				}
				if (part !== trimmed) {
					subQueries.push({
						query: part,
						intent: "conjunction component",
						weight: positionalWeight(subQueries.length),
					});
				}
			}
		}

		return this.clampSubQueries(subQueries);
	}

	/**
	 * Determine if a query is complex enough to warrant decomposition.
	 *
	 * Returns true when:
	 * - Query has > 8 words
	 * - Query contains conjunctions (and, or, that, which)
	 * - Query contains temporal markers (when, before, after, last time)
	 * - Query contains comparison words (vs, compared to)
	 * - Query contains multiple quoted terms
	 * - Query contains multiple named entities (capitalized words)
	 *
	 * @param query - The query to evaluate.
	 * @returns True if the query warrants multi-round decomposition.
	 */
	isComplexQuery(query: string): boolean {
		const trimmed = query.trim();
		const words = trimmed.split(/\s+/);

		// Word count threshold
		if (words.length > COMPLEXITY_WORD_THRESHOLD) return true;

		// Conjunction presence
		if (CONJUNCTIONS.test(trimmed)) return true;

		// Temporal markers
		if (TEMPORAL.test(trimmed)) return true;

		// Comparative structures
		if (COMPARATIVE.test(trimmed)) return true;

		// Multiple quoted terms: "term1" ... "term2"
		const quotedTerms = trimmed.match(/["'][^"']+["']/g);
		if (quotedTerms && quotedTerms.length >= 2) return true;

		// Multiple named entities (capitalized words not at sentence start)
		const capitalizedWords = words
			.slice(1) // skip first word (sentence-initial capitals don't count)
			.filter((w) => /^[A-Z][a-z]/.test(w));
		if (capitalizedWords.length >= 2) return true;

		return false;
	}

	/**
	 * Generate follow-up sub-queries based on gaps in current results.
	 *
	 * Examines what concepts from the original query are not well-represented
	 * in the current results and generates targeted sub-queries for those gaps.
	 *
	 * @param originalQuery - The user's original search query.
	 * @param currentResults - Results accumulated so far.
	 * @param previousSubQueries - Sub-queries already executed.
	 * @returns New sub-queries targeting unrepresented concepts.
	 */
	generateFollowUp(
		originalQuery: string,
		currentResults: MultiRoundResult[],
		previousSubQueries: SubQuery[],
	): SubQuery[] {
		const followUps: SubQuery[] = [];

		// Extract key terms from the original query.
		const queryTerms = this.extractKeyTerms(originalQuery);
		const previousQueryTexts = new Set(
			previousSubQueries.map((sq) => sq.query.toLowerCase()),
		);

		// Build a content bag from current results for gap detection.
		const contentBag = currentResults
			.map((r) => `${r.title} ${r.content}`)
			.join(" ")
			.toLowerCase();

		// Find terms not well-represented in current results.
		for (const term of queryTerms) {
			const lowerTerm = term.toLowerCase();

			// Skip if already queried.
			if (previousQueryTexts.has(lowerTerm)) continue;

			// Skip if the term appears in the result content.
			if (contentBag.includes(lowerTerm)) continue;

			// This term is a gap — generate a targeted sub-query.
			followUps.push({
				query: term,
				intent: `follow-up for missing concept: ${term}`,
				weight: 0.6, // Follow-ups have lower weight than initial decomposition.
			});
		}

		// Limit follow-up sub-queries.
		return followUps.slice(0, Math.max(1, this.config.maxSubQueries - previousSubQueries.length));
	}

	/**
	 * Fuse results from multiple rounds with weighted scoring.
	 *
	 * Algorithm:
	 * 1. Collect all results across all rounds.
	 * 2. Group by document ID (deduplication).
	 * 3. For each document, compute: SUM(roundScore * subQuery.weight).
	 * 4. Apply multi-query boost: if found by N sub-queries, score *= boost^(N-1).
	 * 5. Sort by fused score descending.
	 * 6. Truncate to maxResults.
	 *
	 * @param rounds - Results from all retrieval rounds.
	 * @returns Deduplicated and scored results, sorted by fused score descending.
	 */
	fuseResults(rounds: RoundResult[]): MultiRoundResult[] {
		const docMap = new Map<string, {
			id: string;
			title: string;
			content: string;
			foundBy: Set<string>;
			weightedScore: number;
			roundScores: { query: string; score: number }[];
		}>();

		for (const round of rounds) {
			const weight = round.subQuery.weight;

			for (const result of round.results) {
				const existing = docMap.get(result.id);

				if (existing) {
					existing.weightedScore += result.score * weight;
					existing.foundBy.add(round.subQuery.query);
					existing.roundScores.push(
						...result.roundScores.map((rs) => ({
							query: rs.query,
							score: rs.score * weight,
						})),
					);
					// Prefer longer content.
					if (result.content.length > existing.content.length) {
						existing.content = result.content;
					}
				} else {
					docMap.set(result.id, {
						id: result.id,
						title: result.title,
						content: result.content,
						foundBy: new Set([round.subQuery.query]),
						weightedScore: result.score * weight,
						roundScores: result.roundScores.map((rs) => ({
							query: rs.query,
							score: rs.score * weight,
						})),
					});
				}
			}
		}

		// Apply multi-query boost and convert to output format.
		const results: MultiRoundResult[] = [];

		for (const doc of docMap.values()) {
			const queryCount = doc.foundBy.size;
			const boost = queryCount > 1
				? Math.pow(this.config.multiQueryBoost, queryCount - 1)
				: 1.0;

			results.push({
				id: doc.id,
				title: doc.title,
				content: doc.content,
				foundBy: [...doc.foundBy],
				score: doc.weightedScore * boost,
				roundScores: doc.roundScores,
			});
		}

		// Sort descending by fused score.
		results.sort((a, b) => b.score - a.score);

		return results.slice(0, this.config.maxResults);
	}

	/**
	 * Get statistics from the last search invocation.
	 *
	 * @returns Stats object or null if no search has been run yet.
	 */
	getLastSearchStats(): SearchStats | null {
		return this.lastStats;
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	/**
	 * Execute a retrieval round: run hybrid search for each sub-query in parallel.
	 */
	private async executeRound(
		subQueries: SubQuery[],
		round: number,
	): Promise<RoundResult[]> {
		const roundResults: RoundResult[] = [];

		const tasks = subQueries.map(async (sq) => {
			const hybridResults = await this.hybridSearch.search(sq.query);
			const multiResults: MultiRoundResult[] = hybridResults.map(
				(r: HybridSearchResult) => ({
					id: r.id,
					title: r.title,
					content: r.content,
					foundBy: [sq.query],
					score: r.score,
					roundScores: [{ query: sq.query, score: r.score }],
				}),
			);

			roundResults.push({
				subQuery: sq,
				results: multiResults,
				round,
			});
		});

		await Promise.all(tasks);
		return roundResults;
	}

	/**
	 * Clamp sub-queries to the configured maximum, preserving the original
	 * query (always first) and highest-weighted decompositions.
	 */
	private clampSubQueries(subQueries: SubQuery[]): SubQuery[] {
		if (subQueries.length <= this.config.maxSubQueries) return subQueries;

		// Always keep the original query (index 0).
		const original = subQueries[0];
		const rest = subQueries
			.slice(1)
			.sort((a, b) => b.weight - a.weight)
			.slice(0, this.config.maxSubQueries - 1);

		return [original, ...rest];
	}

	/**
	 * Extract key terms from a query for gap analysis.
	 *
	 * Filters out stop words and short words, keeping meaningful terms
	 * that represent concepts the user is asking about.
	 */
	private extractKeyTerms(query: string): string[] {
		const stopWords = new Set([
			"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
			"have", "has", "had", "do", "does", "did", "will", "would", "could",
			"should", "may", "might", "shall", "can", "need", "must",
			"in", "on", "at", "to", "for", "of", "with", "by", "from", "about",
			"into", "through", "during", "before", "after", "above", "below",
			"between", "under", "again", "further", "then", "once",
			"and", "or", "but", "nor", "not", "so", "yet", "both", "either",
			"neither", "each", "every", "all", "any", "few", "more", "most",
			"other", "some", "such", "no", "only", "same", "than", "too", "very",
			"what", "which", "who", "whom", "this", "that", "these", "those",
			"how", "when", "where", "why",
			"we", "us", "our", "i", "me", "my", "you", "your", "he", "she",
			"it", "its", "they", "them", "their",
		]);

		return query
			.split(/[\s,;]+/)
			.map((w) => w.replace(/[^\w-]/g, ""))
			.filter((w) => w.length >= 3 && !stopWords.has(w.toLowerCase()));
	}

	/**
	 * Extract comma-separated list entities from a query.
	 *
	 * Handles patterns like:
	 *   "authentication, authorization, and session management"
	 *   "REST, GraphQL, or gRPC"
	 */
	private extractListEntities(query: string): string[] {
		// Look for "X, Y, and/or Z" patterns.
		const listPattern = /([^,]+(?:,\s*[^,]+)*,?\s*(?:and|or)\s+[^,]+)/i;
		const match = query.match(listPattern);

		if (!match) return [];

		const listPortion = match[1];
		// Split on commas and "and"/"or".
		const entities = listPortion
			.split(/,\s*|\s+(?:and|or)\s+/i)
			.map((s) => s.trim())
			.filter((s) => s.length >= 2);

		return entities.length >= 2 ? entities : [];
	}
}
