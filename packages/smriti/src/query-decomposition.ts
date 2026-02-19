/**
 * @chitragupta/smriti -- Query Decomposition & Follow-Up Generation.
 *
 * Heuristic query analysis for the Anveshana multi-round retrieval engine.
 * Decomposes complex natural-language queries into weighted sub-queries
 * using purely syntactic heuristics (no LLM calls). Also provides gap-based
 * follow-up generation and complexity detection.
 *
 * Extracted from multi-round-retrieval.ts to keep each module under 450 LOC.
 */

import type { SubQuery, MultiRoundResult } from "./multi-round-retrieval.js";

// ---- Constants ---------------------------------------------------------------

/** Words that signal compound/relative clause structures. */
export const CONJUNCTIONS =
	/\b(and|or|but|that|which|who|where|when|while|although)\b/i;

/** Temporal markers for time-scoped queries. */
export const TEMPORAL =
	/\b(when|before|after|last\s+(?:time|week|month|year|day)|yesterday|recently|earlier|previously|ago|since|until)\b/i;

/** Comparative structures. */
export const COMPARATIVE =
	/\b(vs\.?|versus|compared?\s+to|difference\s+between|between\s+\w+\s+and)\b/i;

/** Causal structures. */
export const CAUSAL =
	/\b(why|because|caused?\s*(?:by)?|led\s+to|resulted?\s+in|reason\s+for|due\s+to)\b/i;

/** Minimum word count for complexity consideration. */
export const COMPLEXITY_WORD_THRESHOLD = 8;

// ---- Scoring helpers ---------------------------------------------------------

/**
 * Positional weight decay for sub-queries: w(i) = max(0.4, 1.0 - 0.2 * i).
 *
 * Earlier sub-queries receive higher weight in the final fusion step.
 *
 * @param index - Zero-based position of the sub-query.
 * @returns Weight in the range [0.4, 1.0].
 */
export const positionalWeight = (index: number): number =>
	Math.max(0.4, 1.0 - 0.2 * index);

/**
 * Specificity bonus: longer sub-queries receive a small weight bump.
 *
 * @param query - The sub-query text.
 * @returns Bonus value (0, 0.05, or 0.1).
 */
export const specificityBonus = (query: string): number => {
	const words = query.trim().split(/\s+/).length;
	if (words >= 5) return 0.1;
	if (words >= 3) return 0.05;
	return 0;
};

// ---- Complexity detection ----------------------------------------------------

/**
 * Determine if a query is complex enough to warrant decomposition.
 *
 * Returns true when:
 * - Query has more than 8 words
 * - Query contains conjunctions (and, or, that, which)
 * - Query contains temporal markers (when, before, after, last time)
 * - Query contains comparison words (vs, compared to)
 * - Query contains multiple quoted terms
 * - Query contains multiple named entities (capitalized words)
 *
 * @param query - The query to evaluate.
 * @returns True if the query warrants multi-round decomposition.
 */
export function isComplexQuery(query: string): boolean {
	const trimmed = query.trim();
	const words = trimmed.split(/\s+/);

	if (words.length > COMPLEXITY_WORD_THRESHOLD) return true;
	if (CONJUNCTIONS.test(trimmed)) return true;
	if (TEMPORAL.test(trimmed)) return true;
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

// ---- Sub-query clamping ------------------------------------------------------

/**
 * Clamp sub-queries to a maximum count, preserving the original query
 * (always first) and highest-weighted decompositions.
 *
 * @param subQueries - Full list of generated sub-queries.
 * @param maxSubQueries - Maximum allowed sub-queries.
 * @returns Clamped list with at most `maxSubQueries` entries.
 */
export function clampSubQueries(
	subQueries: SubQuery[],
	maxSubQueries: number,
): SubQuery[] {
	if (subQueries.length <= maxSubQueries) return subQueries;

	// Always keep the original query (index 0).
	const original = subQueries[0];
	const rest = subQueries
		.slice(1)
		.sort((a, b) => b.weight - a.weight)
		.slice(0, maxSubQueries - 1);

	return [original, ...rest];
}

// ---- List entity extraction --------------------------------------------------

/**
 * Extract comma-separated list entities from a query.
 *
 * Handles patterns like:
 *   "authentication, authorization, and session management"
 *   "REST, GraphQL, or gRPC"
 *
 * @param query - The raw query text.
 * @returns Array of extracted entity strings, or empty if no list pattern found.
 */
export function extractListEntities(query: string): string[] {
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

// ---- Key term extraction -----------------------------------------------------

/**
 * Extract key terms from a query for gap analysis.
 *
 * Filters out stop words and short words, keeping meaningful terms
 * that represent concepts the user is asking about.
 *
 * @param query - The raw query text.
 * @returns Array of meaningful key terms.
 */
export function extractKeyTerms(query: string): string[] {
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

// ---- Query decomposition -----------------------------------------------------

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
 * @param maxSubQueries - Maximum number of sub-queries to return.
 * @returns Array of weighted sub-queries.
 */
export function decomposeQuery(
	query: string,
	maxSubQueries: number,
): SubQuery[] {
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
	if (!isComplexQuery(trimmed)) return subQueries;

	// -- Comparative decomposition
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
		return clampSubQueries(subQueries, maxSubQueries);
	}

	// -- "difference between X and Y" decomposition
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
		return clampSubQueries(subQueries, maxSubQueries);
	}

	// -- Causal decomposition
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
			return clampSubQueries(subQueries, maxSubQueries);
		}
	}

	// -- Multi-entity list decomposition
	// "auth, sessions, and tokens" -> three sub-queries
	const listMatch = trimmed.match(
		/^(.*?)(\b\w+(?:\s+\w+)?)(?:,\s*(\b\w+(?:\s+\w+)?))+(?:,?\s*and\s+(\b\w+(?:\s+\w+)?))\b(.*)$/i,
	);
	if (listMatch) {
		const entityParts = extractListEntities(trimmed);
		if (entityParts.length >= 2) {
			for (const entity of entityParts) {
				subQueries.push({
					query: entity.trim(),
					intent: "list entity",
					weight: positionalWeight(subQueries.length),
				});
			}
			return clampSubQueries(subQueries, maxSubQueries);
		}
	}

	// -- Conjunction splitting
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

	return clampSubQueries(subQueries, maxSubQueries);
}

// ---- Follow-up generation ----------------------------------------------------

/**
 * Generate follow-up sub-queries based on gaps in current results.
 *
 * Examines what concepts from the original query are not well-represented
 * in the current results and generates targeted sub-queries for those gaps.
 *
 * @param originalQuery - The user's original search query.
 * @param currentResults - Results accumulated so far.
 * @param previousSubQueries - Sub-queries already executed.
 * @param maxSubQueries - Maximum configured sub-queries.
 * @returns New sub-queries targeting unrepresented concepts.
 */
export function generateFollowUpQueries(
	originalQuery: string,
	currentResults: MultiRoundResult[],
	previousSubQueries: SubQuery[],
	maxSubQueries: number,
): SubQuery[] {
	const followUps: SubQuery[] = [];

	// Extract key terms from the original query.
	const queryTerms = extractKeyTerms(originalQuery);
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

		// This term is a gap -- generate a targeted sub-query.
		followUps.push({
			query: term,
			intent: `follow-up for missing concept: ${term}`,
			weight: 0.6, // Follow-ups have lower weight than initial decomposition.
		});
	}

	// Limit follow-up sub-queries.
	return followUps.slice(
		0,
		Math.max(1, maxSubQueries - previousSubQueries.length),
	);
}
