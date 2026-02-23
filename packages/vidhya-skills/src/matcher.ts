/**
 * @module matcher
 * @description Match skills to queries using trait vectors and semantic boosting.
 *
 * ## V1 Pipeline ({@link matchSkills})
 *   Trait vector similarity + tag/capability boosts + anti-pattern penalties.
 *
 * ## V2 Pipeline ({@link matchSkillsV2})
 *   Three-phase: algorithmic pre-filter → contextual re-rank → model disambiguation.
 *
 * Scoring primitives live in `matcher-scoring.ts`.
 *
 * @packageDocumentation
 */

import { computeQueryVector, computeTraitVector } from "./fingerprint.js";
import type { SkillManifest, SkillMatch, SkillQuery } from "./types.js";
import type {
	VidyaTantraMatch, EnhancedSkillManifest,
	AshramamStage, AnandamayaMastery,
} from "./types-v2.js";
import { ASHRAMA_MATCH_WEIGHT, KULA_WEIGHTS } from "./types-v2.js";
import {
	cosineSimilarityF32 as _cosineSimilarityF32,
	computeTagBoost,
	computeCapabilityMatch,
	computeAntiPatternPenalty,
	sampleBeta,
	W_TRAIT,
	W_TAG,
	W_CAP,
	W_ANTI,
} from "./matcher-scoring.js";

// Re-export for backward compatibility
export { cosineSimilarityF32 } from "./matcher-scoring.js";

// ─── V1: Main Matcher ───────────────────────────────────────────────────────

/**
 * Match skills against a query using Trait Vector Matching with boosting.
 *
 * Computes trait vector similarity, applies tag/capability boosts and
 * anti-pattern penalties, then returns ranked results.
 *
 * @param query - The skill query containing text, optional tags, and filters.
 * @param skills - All registered skill manifests to search through.
 * @returns Ranked matches sorted by descending score.
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
		if (query.sourceType && skill.source.type !== query.sourceType) {
			continue;
		}

		if (query.tags && query.tags.length > 0) {
			const skillTagSet = new Set(skill.tags.map((t) => t.toLowerCase()));
			const allTagsPresent = query.tags.every((t) =>
				skillTagSet.has(t.toLowerCase()),
			);
			if (!allTagsPresent) continue;
		}

		const skillVector = skill.traitVector
			? new Float32Array(skill.traitVector)
			: computeTraitVector(skill);

		const traitSimilarity = _cosineSimilarityF32(queryVector, skillVector);
		const tagBoost = computeTagBoost(query.tags, skill.tags, query.text);
		const capabilityMatch = computeCapabilityMatch(query.text, skill);
		const antiPatternPenalty = computeAntiPatternPenalty(query.text, skill.antiPatterns);

		const rawScore =
			W_TRAIT * traitSimilarity +
			W_TAG * tagBoost +
			W_CAP * capabilityMatch -
			W_ANTI * antiPatternPenalty;

		const score = Math.max(0, Math.min(1, rawScore));

		matches.push({
			skill,
			score,
			breakdown: { traitSimilarity, tagBoost, capabilityMatch, antiPatternPenalty },
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

// ─── V2: Three-Phase Pipeline ───────────────────────────────────────────────

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

/** Phase 1 intermediate candidate. */
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

/** Phase 2 intermediate candidate with contextual boosts. */
interface Phase2Candidate extends Phase1Candidate {
	adjustedScore: number;
	chetanaBoost: number;
	frustrationBoost: number;
	goalBoost: number;
	preferenceBoost: number;
	explorationBonus: number;
}

/**
 * Vidya-Tantra three-phase matching pipeline.
 *
 * Phase 1: Algorithmic pre-filtering (< 1ms, zero tokens)
 *   - Ashrama gate + Pranamaya check + TVM matching with kula/trust weights
 *
 * Phase 2: Contextual re-ranking (< 1ms, zero tokens)
 *   - Chetana focus, frustration, goal alignment, preference rules,
 *     Thompson Sampling exploration bonus
 *
 * Phase 3: Model-driven selection (only when top-2 within 0.05)
 *   - Sets resolvedInPhase = 3; caller handles LLM disambiguation
 *
 * @param query - The skill query containing text, optional tags, and filters.
 * @param skills - All registered enhanced skill manifests.
 * @param context - Optional Chetana/Samskaara/Anandamaya context.
 * @returns Ranked matches with phase resolution metadata.
 */
export function matchSkillsV2(
	query: SkillQuery,
	skills: EnhancedSkillManifest[],
	context?: MatchContext,
): VidyaTantraMatch[] {
	const queryVector = computeQueryVector(query);
	const threshold = query.threshold ?? 0.1;

	// ─── Phase 1: Algorithmic Pre-Filtering ─────────────────────────────────
	const phase1 = phase1Filter(skills, query, queryVector, threshold, context);
	phase1.sort((a, b) => b.score - a.score);
	const top10 = phase1.slice(0, 10);
	if (top10.length === 0) return [];

	// ─── Phase 2: Contextual Re-Ranking ─────────────────────────────────────
	const phase2 = top10.map((c) => phase2Rerank(c, context));
	phase2.sort((a, b) => b.adjustedScore - a.adjustedScore);
	const top5 = phase2.slice(0, 5);

	// ─── Phase 3: Model-Driven Disambiguation ───────────────────────────────
	let resolvedInPhase = 2;
	if (top5.length >= 2) {
		const scoreDiff = top5[0].adjustedScore - top5[1].adjustedScore;
		if (scoreDiff <= 0.05) resolvedInPhase = 3;
	}

	return top5.map((c, i) => buildMatch(c, i, resolvedInPhase, context));
}

// ─── Phase Helpers ──────────────────────────────────────────────────────────

/** Phase 1: Gate, filter, and score candidates. */
function phase1Filter(
	skills: EnhancedSkillManifest[],
	query: SkillQuery,
	queryVector: Float32Array,
	threshold: number,
	context?: MatchContext,
): Phase1Candidate[] {
	const candidates: Phase1Candidate[] = [];

	for (const manifest of skills) {
		// Gate 1: Ashrama stage check
		if (context?.ashramamStages) {
			const stage = context.ashramamStages.get(manifest.name);
			if (!stage || ASHRAMA_MATCH_WEIGHT[stage] === 0) continue;
		}

		// Gate 2: Pranamaya requirements check
		if (context?.requirementsSatisfied) {
			const satisfied = context.requirementsSatisfied.get(manifest.name);
			if (satisfied === false) continue;
		}

		if (query.sourceType && manifest.source.type !== query.sourceType) continue;

		if (query.tags && query.tags.length > 0) {
			const skillTagSet = new Set(manifest.tags.map((t) => t.toLowerCase()));
			const allTagsPresent = query.tags.every((t) => skillTagSet.has(t.toLowerCase()));
			if (!allTagsPresent) continue;
		}

		const skillVector = manifest.traitVector
			? new Float32Array(manifest.traitVector)
			: computeTraitVector(manifest);

		const traitSimilarity = _cosineSimilarityF32(queryVector, skillVector);
		const tagBoost = computeTagBoost(query.tags, manifest.tags, query.text);
		const capabilityMatch = computeCapabilityMatch(query.text, manifest);
		const antiPatternPenalty = computeAntiPatternPenalty(query.text, manifest.antiPatterns);

		let score =
			W_TRAIT * traitSimilarity +
			W_TAG * tagBoost +
			W_CAP * capabilityMatch -
			W_ANTI * antiPatternPenalty;
		score = Math.max(0, Math.min(1, score));

		// Apply kula, trust, and ashrama weights
		score *= KULA_WEIGHTS[manifest.kula ?? "bahya"];
		score *= context?.trustScores?.get(manifest.name) ?? 0.5;

		if (context?.ashramamStages) {
			const stage = context.ashramamStages.get(manifest.name);
			if (stage) score *= ASHRAMA_MATCH_WEIGHT[stage];
		}

		if (score >= threshold) {
			candidates.push({
				manifest, score,
				breakdown: { traitSimilarity, tagBoost, capabilityMatch, antiPatternPenalty },
			});
		}
	}

	return candidates;
}

/** Phase 2: Apply contextual boosts. */
function phase2Rerank(candidate: Phase1Candidate, context?: MatchContext): Phase2Candidate {
	let chetanaBoost = 0;
	let frustrationBoost = 0;
	let goalBoost = 0;
	let preferenceBoost = 0;
	let explorationBonus = 0;

	// Chetana focus concepts
	if (context?.focusConcepts && context.focusConcepts.size > 0) {
		const skillTokens = new Set([
			...candidate.manifest.tags.map((t) => t.toLowerCase()),
			...candidate.manifest.description.toLowerCase().split(/\s+/),
		]);
		for (const [concept, weight] of context.focusConcepts) {
			if (skillTokens.has(concept.toLowerCase())) chetanaBoost += weight * 0.1;
		}
	}

	// Frustration adjustment
	if (context?.frustration !== undefined && context.frustration > 0.5) {
		const mastery = context.mastery?.get(candidate.manifest.name);
		if (mastery && mastery.successRate > 0.7) {
			frustrationBoost = 0.15 * (context.frustration - 0.5) * 2;
		}
	}

	// Goal alignment
	if (context?.activeGoalKeywords && context.activeGoalKeywords.length > 0) {
		const skillTokens = new Set([
			...candidate.manifest.tags.map((t) => t.toLowerCase()),
			...candidate.manifest.capabilities.map((c) => c.verb.toLowerCase()),
		]);
		for (const keyword of context.activeGoalKeywords) {
			if (skillTokens.has(keyword.toLowerCase())) goalBoost += 0.1;
		}
	}

	// Samskaara preferences
	if (context?.preferenceRules) {
		for (const rule of context.preferenceRules) {
			if (rule.preferred === candidate.manifest.name) {
				preferenceBoost += 0.1 * rule.confidence;
			} else if (rule.over === candidate.manifest.name) {
				preferenceBoost -= 0.1 * rule.confidence;
			}
		}
	}

	// Thompson Sampling exploration
	if (context?.mastery) {
		const mastery = context.mastery.get(candidate.manifest.name);
		if (mastery) {
			explorationBonus = sampleBeta(mastery.thompsonAlpha, mastery.thompsonBeta) * 0.1;
		}
	}

	const adjustedScore = Math.max(0, Math.min(1,
		candidate.score + chetanaBoost + frustrationBoost + goalBoost + preferenceBoost + explorationBonus,
	));

	return {
		...candidate,
		adjustedScore, chetanaBoost, frustrationBoost, goalBoost, preferenceBoost, explorationBonus,
	};
}

/** Build the final VidyaTantraMatch from a phase-2 candidate. */
function buildMatch(
	candidate: Phase2Candidate,
	index: number,
	resolvedInPhase: number,
	context?: MatchContext,
): VidyaTantraMatch {
	const stage = context?.ashramamStages?.get(candidate.manifest.name) ?? "grihastha";
	const trustScore = context?.trustScores?.get(candidate.manifest.name) ?? 0.5;
	const kulaWeight = KULA_WEIGHTS[candidate.manifest.kula ?? "bahya"];
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
			ashramamWeight: ASHRAMA_MATCH_WEIGHT[stage],
			thompsonSample: candidate.explorationBonus / 0.1,
			chetanaBoost: candidate.chetanaBoost + candidate.frustrationBoost + candidate.goalBoost + candidate.preferenceBoost,
			requirementsMet,
		},
	};
}
