/**
 * @chitragupta/smriti -- Anveshana -- Multi-Round Retrieval Engine.
 *
 * In Vedic tradition, anveshana is the disciplined investigation that goes
 * beyond surface observation -- asking deeper questions until truth is found.
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
 * The decomposer is purely heuristic -- no LLM calls. Fast and free.
 *
 * Query decomposition, complexity detection, and follow-up generation live
 * in ./query-decomposition.ts (extracted to keep each file under 450 LOC).
 */

import type { HybridSearchEngine, HybridSearchResult } from "./hybrid-search.js";
import {
	isComplexQuery,
	decomposeQuery,
	generateFollowUpQueries,
} from "./query-decomposition.js";

// Re-export decomposition utilities so downstream consumers can still
// import everything from this module (preserves backward compatibility).
export {
	isComplexQuery,
	decomposeQuery,
	generateFollowUpQueries,
	clampSubQueries,
	extractKeyTerms,
	extractListEntities,
	positionalWeight,
	specificityBonus,
	CONJUNCTIONS,
	TEMPORAL,
	COMPARATIVE,
	CAUSAL,
	COMPLEXITY_WORD_THRESHOLD,
} from "./query-decomposition.js";

// ---- Types -------------------------------------------------------------------

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

// ---- Constants ---------------------------------------------------------------
const DEFAULT_CONFIG: MultiRoundConfig = {
	maxSubQueries: 4,
	maxRounds: 3,
	improvementThreshold: 0.05,
	maxResults: 15,
	multiQueryBoost: 1.3,
	adaptiveTermination: true,
};

// ---- AnveshanaEngine ---------------------------------------------------------

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
		if (!isComplexQuery(query)) {
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

		// -- Complex query: decompose and iterate
		const subQueries = this.decompose(query);
		const allRounds: RoundResult[] = [];
		const improvementPerRound: number[] = [];
		let previousTopScore = 0;

		// Round 1: run all initial sub-queries.
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
	 * Delegates to the standalone `decomposeQuery` function from
	 * query-decomposition.ts.
	 *
	 * @param query - The user's search query.
	 * @returns Array of weighted sub-queries.
	 */
	decompose(query: string): SubQuery[] {
		return decomposeQuery(query, this.config.maxSubQueries);
	}

	/**
	 * Determine if a query is complex enough to warrant decomposition.
	 *
	 * Delegates to the standalone `isComplexQuery` function from
	 * query-decomposition.ts.
	 *
	 * @param query - The query to evaluate.
	 * @returns True if the query warrants multi-round decomposition.
	 */
	isComplexQuery(query: string): boolean {
		return isComplexQuery(query);
	}

	/**
	 * Generate follow-up sub-queries based on gaps in current results.
	 *
	 * Delegates to the standalone `generateFollowUpQueries` function from
	 * query-decomposition.ts.
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
		return generateFollowUpQueries(
			originalQuery,
			currentResults,
			previousSubQueries,
			this.config.maxSubQueries,
		);
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

	// ---- Private helpers ------------------------------------------------------

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
}
