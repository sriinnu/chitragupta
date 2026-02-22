/**
 * Skill Evolution Analysis - Thompson Sampling, Dreyfus, MI.
 * @packageDocumentation
 */

import { TRAIT_DIMENSIONS } from "./fingerprint.js";
import type { DreyfusLevel, AnandamayaMastery } from "./types-v2.js";
import { DREYFUS_THRESHOLDS, INITIAL_ANANDAMAYA } from "./types-v2.js";
import type { SkillTrackingData, SkillHealthReport } from "./skill-evolution-types.js";

/** Milliseconds in one day. */
const MS_PER_DAY = 86_400_000;

// ─── Thompson Sampling & Dreyfus Model ──────────────────────────────

/**
 * Sample from the Thompson (Beta) distribution for a skill.
 * Returns a sample in [0, 1] — higher = more likely to be good.
 * New skills with no data return samples near 0.5 (uniform prior).
 *
 * Implementation:
 * - Beta(alpha, beta) = Gamma(alpha) / (Gamma(alpha) + Gamma(beta))
 * - For integer shapes < 100: Gamma(n, 1) = -sum(ln(U_i)) for i=1..n
 * - For shapes >= 100: use normal approximation
 *
 * @param skillName - Name of the skill.
 * @returns A sample in [0, 1].
 */
export function sampleThompson(skills: Map<string, SkillTrackingData>, skillName: string): number {
	const data = skills.get(skillName);
	if (!data) {
		// No data yet — return uniform prior sample
		return Math.random();
	}

	const alpha = data.thompsonAlpha;
	const beta = data.thompsonBeta;

	// Sample X ~ Gamma(alpha, 1)
	const X = sampleGamma(alpha);
	// Sample Y ~ Gamma(beta, 1)
	const Y = sampleGamma(beta);

	// Return Beta sample: X / (X + Y)
	return X / (X + Y);
}

/**
 * Get the Dreyfus mastery level for a skill.
 *
 * Progression based on invocations × success rate:
 * - expert: >= 100 uses AND success >= 0.85
 * - proficient: >= 50 uses AND success >= 0.7
 * - competent: >= 20 uses AND success >= 0.5
 * - advanced-beginner: >= 5 uses AND success >= 0.3
 * - novice: < 5 uses OR success < 0.3
 *
 * @param skillName - Name of the skill.
 * @returns The Dreyfus mastery level.
 */
export function getDreyfusLevel(skills: Map<string, SkillTrackingData>, skillName: string): DreyfusLevel {
	const data = skills.get(skillName);
	if (!data || data.useCount === 0) {
		return "novice";
	}

	const successRate = data.successCount / data.useCount;

	// Iterate thresholds from highest to lowest
	for (const threshold of DREYFUS_THRESHOLDS) {
		if (
			data.useCount >= threshold.minUses &&
			successRate >= threshold.minSuccessRate
		) {
			return threshold.level;
		}
	}

	return "novice";
}

/**
 * Convert internal tracking data to AnandamayaMastery.
 *
 * @param skillName - Name of the skill.
 * @returns The mastery data in Anandamaya format.
 */
export function toAnandamayaMastery(skills: Map<string, SkillTrackingData>, skillName: string): AnandamayaMastery {
	const data = skills.get(skillName);
	if (!data) {
		return INITIAL_ANANDAMAYA;
	}

	const failureCount = data.useCount - data.successCount;
	const successRate = data.useCount > 0
		? data.successCount / data.useCount
		: 0;

	return {
		totalInvocations: data.useCount,
		successCount: data.successCount,
		failureCount,
		successRate,
		avgLatencyMs: 0, // Not tracked in current implementation
		dreyfusLevel: getDreyfusLevel(skills, skillName),
		lastInvokedAt: data.lastUsedAt ? new Date(data.lastUsedAt).toISOString() : null,
		firstInvokedAt: null, // Not tracked in current implementation
		thompsonAlpha: data.thompsonAlpha,
		thompsonBeta: data.thompsonBeta,
	};
}

/**
 * Compute pointwise mutual information between two skills.
 * Uses NPMI (normalized) to get values in [-1, 1].
 *
 * PMI(A, B) = log2(P(A,B) / (P(A) * P(B)))
 * NPMI(A, B) = PMI(A, B) / -log2(P(A,B))
 *
 * Higher NPMI = stronger relationship.
 * NPMI = 1: perfect co-occurrence
 * NPMI = 0: independent
 * NPMI = -1: never co-occur
 *
 * @param skillA - First skill name.
 * @param skillB - Second skill name.
 * @returns NPMI in [-1, 1], or 0 if insufficient data.
 */
export function computeMutualInformation(sessionSkills: string[][], skillA: string, skillB: string): number {
	const totalSessions = sessionSkills.length;
	if (totalSessions === 0) return 0;

	// Count sessions where each skill appears
	let countA = 0;
	let countB = 0;
	let countAB = 0;

	for (const session of sessionSkills) {
		const hasA = session.includes(skillA);
		const hasB = session.includes(skillB);
		if (hasA) countA++;
		if (hasB) countB++;
		if (hasA && hasB) countAB++;
	}

	if (countA === 0 || countB === 0 || countAB === 0) return 0;

	// Compute probabilities
	const pA = countA / totalSessions;
	const pB = countB / totalSessions;
	const pAB = countAB / totalSessions;

	// PMI = log2(P(A,B) / (P(A) * P(B)))
	const pmi = Math.log2(pAB / (pA * pB));

	// NPMI = PMI / -log2(P(A,B))
	const npmi = pmi / -Math.log2(pAB);

	return npmi;
}

/**
 * Get all skill pairs with mutual information above a threshold.
 *
 * @param threshold - Minimum NPMI value (default 0.3).
 * @returns Skill pairs sorted by NPMI descending.
 */
export function getRelatedPairs(coOccurrences: Map<string, Map<string, number>>, sessionSkills: string[][], threshold: number = 0.3): Array<{ skillA: string; skillB: string; npmi: number }> {
	const pairs: Array<{ skillA: string; skillB: string; npmi: number }> = [];
	const processed = new Set<string>();

	for (const [skillA, neighbors] of coOccurrences) {
		for (const [skillB] of neighbors) {
			// Avoid duplicates (A,B) and (B,A)
			const pairKey = [skillA, skillB].sort().join("|");
			if (processed.has(pairKey)) continue;
			processed.add(pairKey);

			const npmi = computeMutualInformation(sessionSkills, skillA, skillB);
			if (npmi >= threshold) {
				pairs.push({ skillA, skillB, npmi });
			}
		}
	}

	return pairs.sort((a, b) => b.npmi - a.npmi);
}

// ─── Private Helpers ──────────────────────────────────────────────

/** Ensure tracking data exists for a skill. */
export function ensureSkillData(skills: Map<string, SkillTrackingData>, name: string): SkillTrackingData {
	let data = skills.get(name);
	if (!data) {
		data = {
			name,
			matchCount: 0,
			useCount: 0,
			rejectCount: 0,
			successCount: 0,
			totalMatchScore: 0,
			contexts: new Set(),
			lastUsedAt: null,
			evolvedVector: null,
			thompsonAlpha: 1,
			thompsonBeta: 1,
		};
		skills.set(name, data);
	}
	return data;
}

/**
 * Compute freshness score using exponential decay.
 *
 *     freshness = 1 / (1 + daysSinceLastUse)
 *
 * This produces a smooth decay:
 * - Just used: 1.0
 * - 1 day ago: 0.5
 * - 7 days ago: 0.125
 * - 30 days ago: ~0.032
 * - Never used: 0.0
 */
export function computeFreshness(lastUsedAt: number | null): number {
	if (lastUsedAt === null) return 0;
	const daysSinceUse = (Date.now() - lastUsedAt) / MS_PER_DAY;
	return 1 / (1 + daysSinceUse);
}

/**
 * Update co-occurrence counts for all skill pairs in a session.
 *
 * For each pair (A, B) where A !== B, increments the co-occurrence
 * count in both directions. This builds the symmetric co-occurrence
 * matrix used for fusion suggestions.
 */
export function updateCoOccurrences(coOccurrences: Map<string, Map<string, number>>, skills: string[]): void {
	for (let i = 0; i < skills.length; i++) {
		for (let j = i + 1; j < skills.length; j++) {
			incrementCoOccurrence(coOccurrences, skills[i], skills[j]);
			incrementCoOccurrence(coOccurrences, skills[j], skills[i]);
		}
	}
}

/** Increment the co-occurrence count for a directed pair. */
export function incrementCoOccurrence(coOccurrences: Map<string, Map<string, number>>, from: string, to: string): void {
	let neighbors = coOccurrences.get(from);
	if (!neighbors) {
		neighbors = new Map();
		coOccurrences.set(from, neighbors);
	}
	neighbors.set(to, (neighbors.get(to) ?? 0) + 1);
}

/** Generate an empty health report for an unknown skill. */
export function emptyHealthReport(name: string): SkillHealthReport {
	return {
		name,
		matchCount: 0,
		useCount: 0,
		rejectCount: 0,
		successCount: 0,
		avgMatchScore: 0,
		useRate: 0,
		successRate: 0.5,
		freshnessScore: 0,
		diversityScore: 0,
		health: 0,
		lastUsedAt: null,
		flaggedForReview: false,
	};
}

/**
 * Sample from Gamma(shape, scale=1) distribution.
 *
 * For integer shapes < 100: Use sum of exponential variates
 *   Gamma(n, 1) = -sum(ln(U_i)) for i=1..n
 *
 * For shapes >= 100: Use normal approximation
 *   mean = shape, variance = shape
 *
 * @param shape - The shape parameter (alpha or beta).
 * @returns A sample from Gamma(shape, 1).
 */
export function sampleGamma(shape: number): number {
	if (shape < 100) {
		// Sum of exponentials: -ln(U_i) ~ Exp(1), sum ~ Gamma(n, 1)
		let sum = 0;
		for (let i = 0; i < shape; i++) {
			sum -= Math.log(Math.random());
		}
		return sum;
	} else {
		// Normal approximation: Gamma(shape, 1) ≈ N(shape, shape)
		// Box-Muller transform for normal sample
		const u1 = Math.random();
		const u2 = Math.random();
		const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
		// Z ~ N(0, 1), so shape + sqrt(shape) * Z ~ N(shape, shape)
		const sample = shape + Math.sqrt(shape) * z;
		// Clamp to positive values
		return Math.max(0.001, sample);
	}
}
