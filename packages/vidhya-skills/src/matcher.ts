/**
 * @module matcher
 * @description Match skills to queries using trait vectors and semantic boosting.
 *
 * ## Matching Pipeline
 *
 * 1. Compute the query's trait vector via {@link computeQueryVector}
 * 2. Compute cosine similarity against all skill trait vectors (initial ranking)
 * 3. Apply tag boost: exact tag matches get a 1.5x multiplier
 * 4. Apply capability match: if query contains known verb patterns, boost skills
 *    with matching capability verbs
 * 5. Apply anti-pattern penalty: if query text matches any skill's antiPatterns,
 *    penalize that skill by 0.3
 * 6. Final score = weighted combination, clamped to [0, 1]
 *
 * ## Scoring Formula
 *
 *   score = clamp(
 *     w_t * traitSimilarity
 *     + w_tag * tagBoost
 *     + w_cap * capabilityMatch
 *     - w_anti * antiPatternPenalty,
 *     0, 1
 *   )
 *
 * where w_t = 0.6, w_tag = 0.15, w_cap = 0.15, w_anti = 0.3
 *
 * @packageDocumentation
 */

import { computeQueryVector, computeTraitVector } from "./fingerprint.js";
import type { SkillManifest, SkillMatch, SkillQuery } from "./types.js";
import type {
	VidyaTantraMatch, EnhancedSkillManifest,
	AshramamStage, PranamayaRequirements, AnandamayaMastery,
} from "./types-v2.js";
import { ASHRAMA_MATCH_WEIGHT, KULA_WEIGHTS } from "./types-v2.js";

// ─── Scoring Weights ────────────────────────────────────────────────────────

/** Weight for trait vector cosine similarity in final score. */
const W_TRAIT = 0.6;
/** Weight for tag boost in final score. */
const W_TAG = 0.15;
/** Weight for capability verb match in final score. */
const W_CAP = 0.15;
/** Penalty weight for anti-pattern matches. */
const W_ANTI = 0.3;
/** Multiplier applied to tag dimension matches. */
const TAG_BOOST_MULTIPLIER = 1.5;

// ─── Cosine Similarity ─────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two Float32Arrays.
 *
 * For L2-normalized vectors (as produced by TVM), this is equivalent to
 * the dot product:
 *
 *   cos(a, b) = sum(a_i * b_i) / (||a|| * ||b||) = sum(a_i * b_i)
 *
 * Optimized: single pass, no allocation, early-out not possible due to
 * negative dimensions (anti-patterns).
 *
 * Time complexity: O(d) where d = vector dimensionality.
 * Space complexity: O(1).
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
 * @returns A boost value in [0, 1].
 */
function computeTagBoost(
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

	// No explicit tags — extract keywords from query text and match against skill tags
	if (queryText) {
		const queryWords = new Set(
			queryText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2),
		);
		let matches = 0;
		for (const tag of skillTagSet) {
			if (queryWords.has(tag)) matches++;
			// Also check if any query word contains the tag or vice versa
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

/**
 * Build a reverse lookup: verb -> group name.
 */
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
 * If the query text contains verbs that match (directly or via synonyms)
 * the skill's capability verbs, the score increases.
 *
 * @param queryText - Natural language query text.
 * @param skill - The skill manifest to check.
 * @returns A match score in [0, 1].
 */
function computeCapabilityMatch(
	queryText: string,
	skill: SkillManifest,
): number {
	const queryWords = new Set(queryText.toLowerCase().split(/\s+/));

	// Extract verb groups from query
	const queryGroups = new Set<string>();
	for (const word of queryWords) {
		const group = verbToGroup.get(word);
		if (group) queryGroups.add(group);
	}

	if (queryGroups.size === 0) return 0;

	// Check skill capabilities for matching verb groups
	let matches = 0;
	for (const cap of skill.capabilities) {
		const capVerb = cap.verb.toLowerCase();
		const capGroup = verbToGroup.get(capVerb);
		if (capGroup && queryGroups.has(capGroup)) {
			matches++;
		} else if (queryGroups.has(capVerb)) {
			// Direct match on verb even if not in a known group
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
function computeAntiPatternPenalty(
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

		// Check if any significant pattern token appears in the query
		const matchCount = patternTokens.filter((t) => queryTokens.has(t)).length;
		if (matchCount > 0) {
			penaltyHits += matchCount / patternTokens.length;
		}
	}

	return Math.min(penaltyHits / antiPatterns.length, 1.0);
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Match skills against a query using Trait Vector Matching with boosting.
 *
 * This is the primary matching function. It computes trait vector similarity,
 * applies tag/capability boosts and anti-pattern penalties, then returns
 * ranked results.
 *
 * @param query - The skill query containing text, optional tags, and filters.
 * @param skills - All registered skill manifests to search through.
 * @returns Ranked matches sorted by descending score.
 *
 * @example
 * ```ts
 * const matches = matchSkills(
 *   { text: "read a typescript file", tags: ["filesystem"] },
 *   allSkills
 * );
 * console.log(matches[0].skill.name); // "file-reader"
 * console.log(matches[0].score);       // 0.87
 * ```
 */
export function matchSkills(
	query: SkillQuery,
	skills: SkillManifest[],
): SkillMatch[] {
	const queryVector = computeQueryVector(query);
	const topK = query.topK ?? 5;
	const threshold = query.threshold ?? 0.1;

	const matches: SkillMatch[] = [];

	for (const skill of skills) {
		// Filter by source type if specified
		if (query.sourceType && skill.source.type !== query.sourceType) {
			continue;
		}

		// Filter by required tags (ALL must be present)
		if (query.tags && query.tags.length > 0) {
			const skillTagSet = new Set(skill.tags.map((t) => t.toLowerCase()));
			const allTagsPresent = query.tags.every((t) =>
				skillTagSet.has(t.toLowerCase()),
			);
			if (!allTagsPresent) continue;
		}

		// Ensure skill has a trait vector
		const skillVector = skill.traitVector
			? new Float32Array(skill.traitVector)
			: computeTraitVector(skill);

		// Component scores
		const traitSimilarity = cosineSimilarityF32(queryVector, skillVector);
		const tagBoost = computeTagBoost(query.tags, skill.tags, query.text);
		const capabilityMatch = computeCapabilityMatch(query.text, skill);
		const antiPatternPenalty = computeAntiPatternPenalty(
			query.text,
			skill.antiPatterns,
		);

		// Final weighted score
		const rawScore =
			W_TRAIT * traitSimilarity +
			W_TAG * tagBoost +
			W_CAP * capabilityMatch -
			W_ANTI * antiPatternPenalty;

		const score = Math.max(0, Math.min(1, rawScore));

		matches.push({
			skill,
			score,
			breakdown: {
				traitSimilarity,
				tagBoost,
				capabilityMatch,
				antiPatternPenalty,
			},
		});
	}

	return rankAndFilter(matches, topK, threshold);
}

/**
 * Rank matches by score (descending) and filter by threshold and topK.
 *
 * @param matches - Unranked match results.
 * @param topK - Maximum number of results to return.
 * @param threshold - Minimum score threshold in [0, 1].
 * @returns Filtered and sorted matches.
 */
export function rankAndFilter(
	matches: SkillMatch[],
	topK: number,
	threshold: number,
): SkillMatch[] {
	return matches
		.filter((m) => m.score >= threshold)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}

// ─── Vidya-Tantra V2: Three-Phase Matching Pipeline ────────────────────────

/**
 * Context for Vidya-Tantra three-phase matching.
 * Provides Chetana, Samskaara, and Anandamaya data for re-ranking.
 */
export interface MatchContext {
	/** Per-skill ashrama stages. */
	ashramamStages?: Map<string, AshramamStage>;
	/** Per-skill trust scores [0, 1]. */
	trustScores?: Map<string, number>;
	/** Per-skill mastery data for Thompson Sampling. */
	mastery?: Map<string, AnandamayaMastery>;
	/** Per-skill pranamaya check results (satisfied or not). */
	requirementsSatisfied?: Map<string, boolean>;
	/** Chetana context — attention concepts with weights. */
	focusConcepts?: Map<string, number>;
	/** Chetana context — frustration level [0, 1]. */
	frustration?: number;
	/** Chetana context — active goal keywords. */
	activeGoalKeywords?: string[];
	/** Samskaara preference rules: "prefer X over Y". */
	preferenceRules?: Array<{ preferred: string; over: string; confidence: number }>;
}

/**
 * Sample from Beta(alpha, beta) using sum-of-exponentials for Gamma distributions.
 *
 * For small n (< 100), use sum of exponentials:
 *   Gamma(n, 1) = -ln(Π_{i=1}^n U_i) where U_i ~ Uniform(0, 1)
 *
 * For large n, use normal approximation:
 *   Gamma(α, 1) ~ N(α, α)
 *
 * Beta(α, β) = Gamma(α, 1) / (Gamma(α, 1) + Gamma(β, 1))
 *
 * @param alpha - First shape parameter (α).
 * @param beta - Second shape parameter (β).
 * @returns Sample from Beta(alpha, beta) in [0, 1].
 */
function sampleBeta(alpha: number, beta: number): number {
	const sampleGamma = (shape: number): number => {
		if (shape < 100) {
			// Sum-of-exponentials method
			let sum = 0;
			for (let i = 0; i < shape; i++) {
				sum -= Math.log(Math.random());
			}
			return sum;
		} else {
			// Normal approximation: Gamma(α, 1) ~ N(α, α)
			const mean = shape;
			const stdDev = Math.sqrt(shape);
			// Box-Muller transform for standard normal
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

/**
 * Vidya-Tantra three-phase matching pipeline.
 *
 * Phase 1: Algorithmic pre-filtering (< 1ms, zero tokens)
 *   - Ashrama gate: exclude skills in non-matching stages
 *   - Pranamaya check: exclude skills with unsatisfied requirements
 *   - TVM matching with kula/trust/ashrama weights
 *   - Take top 10 candidates
 *
 * Phase 2: Contextual re-ranking (< 1ms, zero tokens)
 *   - Chetana focus boost: align with attention concepts
 *   - Frustration adjustment: boost high-success-rate skills
 *   - Goal alignment: boost skills matching active goals
 *   - Samskaara preferences: apply preference rules
 *   - Thompson Sampling: exploration bonus from mastery data
 *   - Take top 5
 *
 * Phase 3: Model-driven selection (only when ambiguous)
 *   - If top-2 scores within 0.05, set resolvedInPhase = 3
 *   - Caller handles LLM disambiguation
 *
 * @param query - The skill query containing text, optional tags, and filters.
 * @param skills - All registered enhanced skill manifests to search through.
 * @param context - Optional Chetana/Samskaara/Anandamaya context for re-ranking.
 * @returns Ranked matches with phase resolution metadata.
 *
 * @example
 * ```ts
 * const matches = matchSkillsV2(
 *   { text: "read a typescript file", tags: ["filesystem"] },
 *   enhancedSkills,
 *   {
 *     ashramamStages: new Map([["file-reader", "kriya"]]),
 *     trustScores: new Map([["file-reader", 0.9]]),
 *     focusConcepts: new Map([["filesystem", 0.8]]),
 *   }
 * );
 * console.log(matches[0].skillName);      // "file-reader"
 * console.log(matches[0].score);          // 0.92
 * console.log(matches[0].resolvedInPhase); // 2
 * ```
 */
export function matchSkillsV2(
	query: SkillQuery,
	skills: EnhancedSkillManifest[],
	context?: MatchContext,
): VidyaTantraMatch[] {
	const queryVector = computeQueryVector(query);
	const threshold = query.threshold ?? 0.1;

	// ─── Phase 1: Algorithmic Pre-Filtering ─────────────────────────────────

	interface Phase1Candidate {
		manifest: EnhancedSkillManifest;
		score: number;
		breakdown: {
			traitSimilarity: number;
			tagBoost: number;
			capabilityMatch: number;
			antiPatternPenalty: number;
		};
	}

	const phase1Candidates: Phase1Candidate[] = [];

	for (const manifest of skills) {
		// Gate 1: Ashrama stage check
		if (context?.ashramamStages) {
			const stage = context.ashramamStages.get(manifest.name);
			if (!stage || ASHRAMA_MATCH_WEIGHT[stage] === 0) {
				continue; // Exclude skills in non-matching stages
			}
		}

		// Gate 2: Pranamaya requirements check
		if (context?.requirementsSatisfied) {
			const satisfied = context.requirementsSatisfied.get(manifest.name);
			if (satisfied === false) {
				continue; // Exclude skills with unsatisfied requirements
			}
		}

		// Filter by source type if specified
		if (query.sourceType && manifest.source.type !== query.sourceType) {
			continue;
		}

		// Filter by required tags (ALL must be present)
		if (query.tags && query.tags.length > 0) {
			const skillTagSet = new Set(manifest.tags.map((t) => t.toLowerCase()));
			const allTagsPresent = query.tags.every((t) =>
				skillTagSet.has(t.toLowerCase()),
			);
			if (!allTagsPresent) continue;
		}

		// Ensure skill has a trait vector
		const skillVector = manifest.traitVector
			? new Float32Array(manifest.traitVector)
			: computeTraitVector(manifest);

		// Component scores
		const traitSimilarity = cosineSimilarityF32(queryVector, skillVector);
		const tagBoost = computeTagBoost(query.tags, manifest.tags, query.text);
		const capabilityMatch = computeCapabilityMatch(query.text, manifest);
		const antiPatternPenalty = computeAntiPatternPenalty(
			query.text,
			manifest.antiPatterns,
		);

		// Base weighted score
		let score =
			W_TRAIT * traitSimilarity +
			W_TAG * tagBoost +
			W_CAP * capabilityMatch -
			W_ANTI * antiPatternPenalty;

		score = Math.max(0, Math.min(1, score));

		// Apply kula weight
		const kulaWeight = KULA_WEIGHTS[manifest.kula ?? "bahya"];
		score *= kulaWeight;

		// Apply trust multiplier
		const trustScore = context?.trustScores?.get(manifest.name) ?? 0.5;
		score *= trustScore;

		// Apply ashrama penalty
		if (context?.ashramamStages) {
			const stage = context.ashramamStages.get(manifest.name);
			if (stage) {
				score *= ASHRAMA_MATCH_WEIGHT[stage];
			}
		}

		if (score >= threshold) {
			phase1Candidates.push({
				manifest,
				score,
				breakdown: {
					traitSimilarity,
					tagBoost,
					capabilityMatch,
					antiPatternPenalty,
				},
			});
		}
	}

	// Take top 10 for phase 2
	phase1Candidates.sort((a, b) => b.score - a.score);
	const top10 = phase1Candidates.slice(0, 10);

	if (top10.length === 0) {
		return [];
	}

	// ─── Phase 2: Contextual Re-Ranking ─────────────────────────────────────

	interface Phase2Candidate extends Phase1Candidate {
		adjustedScore: number;
		chetanaBoost: number;
		frustrationBoost: number;
		goalBoost: number;
		preferenceBoost: number;
		explorationBonus: number;
	}

	const phase2Candidates: Phase2Candidate[] = top10.map((candidate) => {
		let adjustedScore = candidate.score;
		let chetanaBoost = 0;
		let frustrationBoost = 0;
		let goalBoost = 0;
		let preferenceBoost = 0;
		let explorationBonus = 0;

		// Boost 1: Chetana focus concepts
		if (context?.focusConcepts && context.focusConcepts.size > 0) {
			const skillTokens = new Set([
				...candidate.manifest.tags.map((t) => t.toLowerCase()),
				...candidate.manifest.description.toLowerCase().split(/\s+/),
			]);

			for (const [concept, weight] of context.focusConcepts) {
				const conceptLower = concept.toLowerCase();
				if (skillTokens.has(conceptLower)) {
					chetanaBoost += weight * 0.1; // Max 0.1 per concept
				}
			}
		}

		// Boost 2: Frustration adjustment
		if (context?.frustration !== undefined && context.frustration > 0.5) {
			const mastery = context.mastery?.get(candidate.manifest.name);
			if (mastery && mastery.successRate > 0.7) {
				frustrationBoost = 0.15 * (context.frustration - 0.5) * 2; // Scale [0.5, 1] -> [0, 0.15]
			}
		}

		// Boost 3: Goal alignment
		if (context?.activeGoalKeywords && context.activeGoalKeywords.length > 0) {
			const skillTokens = new Set([
				...candidate.manifest.tags.map((t) => t.toLowerCase()),
				...candidate.manifest.capabilities.map((c) => c.verb.toLowerCase()),
			]);

			for (const keyword of context.activeGoalKeywords) {
				const keywordLower = keyword.toLowerCase();
				if (skillTokens.has(keywordLower)) {
					goalBoost += 0.1; // Max 0.1 per keyword
				}
			}
		}

		// Boost 4: Samskaara preferences
		if (context?.preferenceRules && context.preferenceRules.length > 0) {
			for (const rule of context.preferenceRules) {
				if (rule.preferred === candidate.manifest.name) {
					preferenceBoost += 0.1 * rule.confidence;
				} else if (rule.over === candidate.manifest.name) {
					preferenceBoost -= 0.1 * rule.confidence;
				}
			}
		}

		// Boost 5: Thompson Sampling exploration
		if (context?.mastery) {
			const mastery = context.mastery.get(candidate.manifest.name);
			if (mastery) {
				// Use pre-computed Thompson Sampling parameters
				const sample = sampleBeta(mastery.thompsonAlpha, mastery.thompsonBeta);
				explorationBonus = sample * 0.1; // Max 0.1 exploration bonus
			}
		}

		adjustedScore += chetanaBoost + frustrationBoost + goalBoost + preferenceBoost + explorationBonus;
		adjustedScore = Math.max(0, Math.min(1, adjustedScore));

		return {
			...candidate,
			adjustedScore,
			chetanaBoost,
			frustrationBoost,
			goalBoost,
			preferenceBoost,
			explorationBonus,
		};
	});

	// Take top 5
	phase2Candidates.sort((a, b) => b.adjustedScore - a.adjustedScore);
	const top5 = phase2Candidates.slice(0, 5);

	// ─── Phase 3: Model-Driven Disambiguation ───────────────────────────────

	let resolvedInPhase = 2;
	if (top5.length >= 2) {
		const scoreDiff = top5[0].adjustedScore - top5[1].adjustedScore;
		if (scoreDiff <= 0.05) {
			resolvedInPhase = 3; // Ambiguous, caller should use LLM
		}
	}

	// ─── Build Final Matches ────────────────────────────────────────────────

	return top5.map((candidate, index) => {
		const stage = context?.ashramamStages?.get(candidate.manifest.name) ?? "grihastha";
		const trustScore = context?.trustScores?.get(candidate.manifest.name) ?? 0.5;
		const kulaWeight = KULA_WEIGHTS[candidate.manifest.kula ?? "bahya"];
		const ashramamWeight = ASHRAMA_MATCH_WEIGHT[stage];
		const requirementsMet = context?.requirementsSatisfied?.get(candidate.manifest.name) ?? true;

		return {
			skill: candidate.manifest,
			score: candidate.adjustedScore,
			resolvedInPhase: (index === 0 ? resolvedInPhase : 2) as 1 | 2 | 3,
			breakdown: {
				traitSimilarity: candidate.breakdown.traitSimilarity,
				tagBoost: candidate.breakdown.tagBoost,
				capabilityMatch: candidate.breakdown.capabilityMatch,
				antiPatternPenalty: candidate.breakdown.antiPatternPenalty,
				kulaPriority: kulaWeight,
				trustMultiplier: trustScore,
				ashramamWeight: ashramamWeight,
				thompsonSample: candidate.explorationBonus / 0.1, // Normalize back to [0, 1]
				chetanaBoost: candidate.chetanaBoost + candidate.frustrationBoost + candidate.goalBoost + candidate.preferenceBoost,
				requirementsMet: requirementsMet,
			},
		};
	});
}
