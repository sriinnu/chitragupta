/**
 * @module matcher-scoring
 * @description Scoring primitives for the skill matching pipeline.
 *
 * Provides cosine similarity, tag boosting, capability verb matching,
 * anti-pattern penalties, and Thompson Sampling (Beta distribution).
 * Used by both V1 and V2 matchers in `matcher.ts`.
 *
 * @packageDocumentation
 */

import type { SkillManifest } from "./types.js";

// ─── Scoring Weights ────────────────────────────────────────────────────────

/** Weight for trait vector cosine similarity in final score. */
export const W_TRAIT = 0.6;
/** Weight for tag boost in final score. */
export const W_TAG = 0.15;
/** Weight for capability verb match in final score. */
export const W_CAP = 0.15;
/** Penalty weight for anti-pattern matches. */
export const W_ANTI = 0.3;
/** Multiplier applied to tag dimension matches. */
const TAG_BOOST_MULTIPLIER = 1.5;

// ─── Cosine Similarity ─────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two Float32Arrays.
 *
 * For L2-normalized vectors (as produced by TVM), this is equivalent to
 * the dot product: cos(a, b) = sum(a_i * b_i) / (||a|| * ||b||).
 *
 * Time: O(d), Space: O(1).
 *
 * @param a - First vector (Float32Array of length d).
 * @param b - Second vector (Float32Array of length d).
 * @returns Cosine similarity in [-1, 1].
 */
export function cosineSimilarityF32(a: Float32Array, b: Float32Array): number {
	const len = Math.min(a.length, b.length);
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < len; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

// ─── Tag Boost ──────────────────────────────────────────────────────────────

/**
 * Compute a tag boost score based on exact tag overlap.
 *
 * For each query tag that appears in the skill's tags, the boost increases.
 * The score is normalized by the number of query tags.
 *
 * @param queryTags - Tags from the query (if any).
 * @param skillTags - Tags from the skill manifest.
 * @param queryText - Natural language query text.
 * @returns A boost value in [0, 1].
 */
export function computeTagBoost(
	queryTags: string[] | undefined,
	skillTags: string[],
	queryText?: string,
): number {
	const skillTagSet = new Set(skillTags.map((t) => t.toLowerCase()));
	if (skillTagSet.size === 0) return 0;

	// Explicit tags — exact overlap
	if (queryTags && queryTags.length > 0) {
		let matches = 0;
		for (const tag of queryTags) {
			if (skillTagSet.has(tag.toLowerCase())) {
				matches++;
			}
		}
		return (matches / queryTags.length) * TAG_BOOST_MULTIPLIER;
	}

	// No explicit tags — extract keywords from query text
	if (queryText) {
		const queryWords = new Set(
			queryText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
		);
		let matches = 0;
		for (const tag of skillTagSet) {
			if (queryWords.has(tag)) matches++;
			for (const word of queryWords) {
				if (word !== tag && (word.includes(tag) || tag.includes(word)) && word.length > 3) {
					matches += 0.5;
					break;
				}
			}
		}
		return matches > 0
			? Math.min(1, (matches / skillTagSet.size) * TAG_BOOST_MULTIPLIER)
			: 0;
	}

	return 0;
}

// ─── Capability Match ───────────────────────────────────────────────────────

/**
 * Known action verbs and their synonym groups.
 * Used to detect verb intent in query text and match against capability verbs.
 */
const VERB_GROUPS: Record<string, Set<string>> = {
	read: new Set(["read", "fetch", "get", "load", "retrieve", "open", "view", "show"]),
	write: new Set(["write", "save", "store", "put", "create", "output", "generate"]),
	analyze: new Set(["analyze", "inspect", "examine", "check", "evaluate", "audit", "review"]),
	search: new Set(["search", "find", "query", "lookup", "locate", "discover"]),
	transform: new Set(["transform", "convert", "parse", "format", "map", "translate"]),
	delete: new Set(["delete", "remove", "clear", "purge", "clean"]),
	execute: new Set(["execute", "run", "invoke", "call", "trigger", "launch"]),
	list: new Set(["list", "enumerate", "scan", "browse", "index"]),
};

/** Reverse lookup: verb -> group name. */
const verbToGroup = new Map<string, string>();
for (const [group, verbs] of Object.entries(VERB_GROUPS)) {
	for (const v of verbs) {
		verbToGroup.set(v, group);
	}
}

/**
 * Compute a capability match score based on verb overlap between query
 * text and skill capabilities.
 *
 * @param queryText - Natural language query text.
 * @param skill - The skill manifest to check.
 * @returns A match score in [0, 1].
 */
export function computeCapabilityMatch(
	queryText: string,
	skill: SkillManifest,
): number {
	const queryWords = new Set(queryText.toLowerCase().split(/\s+/));
	const queryGroups = new Set<string>();
	for (const word of queryWords) {
		const group = verbToGroup.get(word);
		if (group) queryGroups.add(group);
	}

	if (queryGroups.size === 0) return 0;

	let matches = 0;
	for (const cap of skill.capabilities) {
		const capVerb = cap.verb.toLowerCase();
		const capGroup = verbToGroup.get(capVerb);
		if (capGroup && queryGroups.has(capGroup)) {
			matches++;
		} else if (queryGroups.has(capVerb)) {
			matches++;
		}
	}

	return Math.min(matches / queryGroups.size, 1.0);
}

// ─── Anti-Pattern Penalty ───────────────────────────────────────────────────

/**
 * Compute an anti-pattern penalty for a skill given a query.
 *
 * If the query text contains tokens that match a skill's anti-patterns,
 * the penalty increases, discouraging the match.
 *
 * @param queryText - Natural language query text.
 * @param antiPatterns - The skill's anti-patterns (if any).
 * @returns A penalty value in [0, 1].
 */
export function computeAntiPatternPenalty(
	queryText: string,
	antiPatterns: string[] | undefined,
): number {
	if (!antiPatterns || antiPatterns.length === 0) return 0;

	const queryTokens = new Set(
		queryText
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 2),
	);

	let penaltyHits = 0;
	for (const pattern of antiPatterns) {
		const patternTokens = pattern
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 2);

		const matchCount = patternTokens.filter((t) => queryTokens.has(t)).length;
		if (matchCount > 0) {
			penaltyHits += matchCount / patternTokens.length;
		}
	}

	return Math.min(penaltyHits / antiPatterns.length, 1.0);
}

// ─── Thompson Sampling ──────────────────────────────────────────────────────

/**
 * Sample from Beta(alpha, beta) using sum-of-exponentials for Gamma.
 *
 * For small n (< 100): Gamma(n, 1) = -ln(prod U_i)
 * For large n: Normal approximation Gamma(α, 1) ~ N(α, √α)
 * Beta(α, β) = Gamma(α) / (Gamma(α) + Gamma(β))
 *
 * @param alpha - First shape parameter (α).
 * @param beta - Second shape parameter (β).
 * @returns Sample from Beta(alpha, beta) in [0, 1].
 */
export function sampleBeta(alpha: number, beta: number): number {
	const sampleGamma = (shape: number): number => {
		if (shape < 100) {
			let sum = 0;
			for (let i = 0; i < shape; i++) {
				sum -= Math.log(Math.random());
			}
			return sum;
		} else {
			const mean = shape;
			const stdDev = Math.sqrt(shape);
			const u1 = Math.random();
			const u2 = Math.random();
			const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
			return mean + stdDev * z;
		}
	};

	const x = sampleGamma(alpha);
	const y = sampleGamma(beta);
	return x / (x + y);
}
