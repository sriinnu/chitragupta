/**
 * @chitragupta/vidhya-skills — Skill Evolution.
 *
 * Skills that EVOLVE — learning from usage to become better at matching.
 * Like the Vedic concept of "Tapas" (transformative heat), each usage
 * event applies heat to the skill, forging it into a better version of
 * itself through online gradient descent on the trait space.
 *
 * ## Core Algorithms
 *
 * 1. **Online Gradient Descent on Trait Vectors** — When a skill is used
 *    successfully in a context that doesn't match its current vector well,
 *    the vector is nudged toward the query vector:
 *
 *        v_new = L2_normalize((1 - lr) * v_old + lr * v_query)
 *
 *    This is stochastic gradient descent on the cosine similarity loss
 *    surface in R^128, minimizing the angular distance between the skill
 *    and the queries that actually invoke it.
 *
 * 2. **Skill Health Score** — A composite health metric:
 *
 *        health = useRate * 0.4 + successRate * 0.3 + freshness * 0.2 + diversity * 0.1
 *
 *    - useRate = uses / matches (conversion rate)
 *    - successRate = successful / total uses
 *    - freshness = 1 / (1 + daysSinceLastUse) (exponential decay)
 *    - diversity = uniqueContexts / totalUses
 *
 * 3. **Auto-Deprecation** — Skills with health < 0.1 after 50+ matches
 *    are flagged for review.
 *
 * 4. **Skill Fusion Suggestion** — When two skills are consistently used
 *    together (co-occurrence > 60%), suggest merging them.
 *
 * @packageDocumentation
 */

import { TRAIT_DIMENSIONS } from "./fingerprint.js";
import type { DreyfusLevel, AnandamayaMastery } from "./types-v2.js";
import { DREYFUS_THRESHOLDS, INITIAL_ANANDAMAYA } from "./types-v2.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Health report for a single skill. */
export interface SkillHealthReport {
	/** Skill name. */
	name: string;
	/** Number of times matched by a query. */
	matchCount: number;
	/** Number of times actually used after matching. */
	useCount: number;
	/** Number of times rejected after matching. */
	rejectCount: number;
	/** Number of successful uses. */
	successCount: number;
	/** Average match score across all matches. */
	avgMatchScore: number;
	/** Use rate: uses / matches. */
	useRate: number;
	/** Success rate: successes / uses. */
	successRate: number;
	/** Freshness score in [0, 1] based on exponential decay. */
	freshnessScore: number;
	/** Diversity score: unique contexts / total uses. */
	diversityScore: number;
	/** Composite health score in [0, 1]. */
	health: number;
	/** Timestamp of last usage. */
	lastUsedAt: number | null;
	/** Whether this skill is flagged for deprecation review. */
	flaggedForReview: boolean;
}

/** Serializable state for persistence. */
export interface SkillEvolutionState {
	/** Per-skill tracking data. */
	skills: Array<[string, SkillTrackingData]>;
	/** Co-occurrence matrix for fusion detection. */
	coOccurrences: Array<[string, Array<[string, number]>]>;
	/** Session co-use records. */
	sessionSkills: string[][];
}

/** Suggestion to merge two skills that are always used together. */
export interface FusionSuggestion {
	/** First skill name. */
	skillA: string;
	/** Second skill name. */
	skillB: string;
	/** Co-occurrence rate in [0, 1]. */
	coOccurrenceRate: number;
	/** Reason for the suggestion. */
	reason: string;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

/** Internal per-skill tracking data. */
interface SkillTrackingData {
	name: string;
	matchCount: number;
	useCount: number;
	rejectCount: number;
	successCount: number;
	totalMatchScore: number;
	contexts: Set<string>;
	lastUsedAt: number | null;
	/** Evolved trait vector (number[] for serialization). */
	evolvedVector: number[] | null;
	/** Thompson Sampling: Beta distribution alpha (successes + 1). */
	thompsonAlpha: number;
	/** Thompson Sampling: Beta distribution beta (failures + 1). */
	thompsonBeta: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Learning rate for trait vector evolution. */
const DEFAULT_LEARNING_RATE = 0.05;

/** Minimum health before flagging for deprecation review. */
const DEPRECATION_HEALTH_THRESHOLD = 0.1;

/** Minimum matches before a skill can be flagged for deprecation. */
const DEPRECATION_MIN_MATCHES = 50;

/** Co-occurrence threshold for fusion suggestions. */
const FUSION_CO_OCCURRENCE_THRESHOLD = 0.6;

/** Minimum co-occurrences before suggesting fusion. */
const FUSION_MIN_CO_OCCURRENCES = 10;

/** Maximum number of session records to retain for co-occurrence analysis. */
const MAX_SESSION_RECORDS = 200;

/** Milliseconds in one day (for freshness decay). */
const MS_PER_DAY = 86_400_000;

// ─── Skill Evolution ────────────────────────────────────────────────────────

/**
 * Skills that evolve — learning from usage to become better at matching.
 *
 * Tracks match/use/reject events per skill, evolves trait vectors via
 * online gradient descent, computes health scores, and detects fusion
 * opportunities.
 */
export class SkillEvolution {
	/** Per-skill tracking data. */
	private skills: Map<string, SkillTrackingData> = new Map();

	/** Co-occurrence counts: skillA -> { skillB -> count }. */
	private coOccurrences: Map<string, Map<string, number>> = new Map();

	/** Skills used in each session (for co-occurrence tracking). */
	private sessionSkills: string[][] = [];

	/** Current session's used skills. */
	private currentSessionSkills: Set<string> = new Set();

	/** Learning rate for vector evolution. */
	private learningRate: number;

	constructor(learningRate: number = DEFAULT_LEARNING_RATE) {
		this.learningRate = learningRate;
	}

	// ─── Recording ────────────────────────────────────────────────────

	/**
	 * Record that a skill was matched by a query.
	 *
	 * @param skillName - Name of the matched skill.
	 * @param _query - The query text that triggered the match.
	 * @param score - The match score in [0, 1].
	 */
	recordMatch(skillName: string, _query: string, score: number): void {
		const data = this.ensureSkillData(skillName);
		data.matchCount++;
		data.totalMatchScore += score;
	}

	/**
	 * Record that a matched skill was actually used.
	 *
	 * @param skillName - Name of the used skill.
	 * @param success - Whether the usage was successful.
	 * @param context - Optional context identifier for diversity tracking.
	 */
	recordUsage(skillName: string, success: boolean, context?: string): void {
		const data = this.ensureSkillData(skillName);
		data.useCount++;
		data.lastUsedAt = Date.now();

		if (success) {
			data.successCount++;
			data.thompsonAlpha++;
		} else {
			data.thompsonBeta++;
		}

		if (context) {
			data.contexts.add(context);
		}

		// Track for co-occurrence
		this.currentSessionSkills.add(skillName);
	}

	/**
	 * Record that a matched skill was rejected (matched but not used).
	 *
	 * @param skillName - Name of the rejected skill.
	 */
	recordReject(skillName: string): void {
		const data = this.ensureSkillData(skillName);
		data.rejectCount++;
	}

	/**
	 * Flush the current session and compute co-occurrences.
	 * Call this when a session ends.
	 */
	flushSession(): void {
		const skills = [...this.currentSessionSkills];
		if (skills.length >= 2) {
			this.sessionSkills.push(skills);
			if (this.sessionSkills.length > MAX_SESSION_RECORDS) {
				this.sessionSkills.shift();
			}
			this.updateCoOccurrences(skills);
		}
		this.currentSessionSkills.clear();
	}

	// ─── Trait Vector Evolution ────────────────────────────────────────

	/**
	 * Evolve a skill's trait vector toward the query vector that led to its usage.
	 *
	 * Implements online stochastic gradient descent on the cosine similarity
	 * loss surface:
	 *
	 *     v_new = L2_normalize((1 - lr) * v_old + lr * v_query)
	 *
	 * This nudges the skill's position in the 128-dimensional trait space
	 * toward the queries that actually invoke it, making future matches
	 * more accurate.
	 *
	 * @param skillName - Name of the skill to evolve.
	 * @param queryVector - The query vector (Float32Array of length 128).
	 */
	evolveTraitVector(skillName: string, queryVector: Float32Array): void {
		const data = this.ensureSkillData(skillName);

		if (!data.evolvedVector) {
			// Initialize from the query vector (first usage defines the space)
			data.evolvedVector = Array.from(queryVector);
			return;
		}

		const lr = this.learningRate;
		const oldVec = data.evolvedVector;
		const newVec = new Array<number>(TRAIT_DIMENSIONS);

		// Online gradient descent: v_new = (1 - lr) * v_old + lr * v_query
		for (let i = 0; i < TRAIT_DIMENSIONS; i++) {
			newVec[i] = (1 - lr) * oldVec[i] + lr * queryVector[i];
		}

		// L2 normalize the result
		let sumSq = 0;
		for (let i = 0; i < TRAIT_DIMENSIONS; i++) {
			sumSq += newVec[i] * newVec[i];
		}
		if (sumSq > 0) {
			const invNorm = 1.0 / Math.sqrt(sumSq);
			for (let i = 0; i < TRAIT_DIMENSIONS; i++) {
				newVec[i] *= invNorm;
			}
		}

		data.evolvedVector = newVec;
	}

	/**
	 * Get the evolved trait vector for a skill.
	 *
	 * @param skillName - Name of the skill.
	 * @returns The evolved Float32Array vector, or null if no evolution has occurred.
	 */
	getEvolvedVector(skillName: string): Float32Array | null {
		const data = this.skills.get(skillName);
		if (!data?.evolvedVector) return null;
		return new Float32Array(data.evolvedVector);
	}

	// ─── Health Scoring ───────────────────────────────────────────────

	/**
	 * Compute the health score for a skill.
	 *
	 *     health = useRate * 0.4 + successRate * 0.3 + freshness * 0.2 + diversity * 0.1
	 *
	 * - useRate = uses / matches (0 if no matches)
	 * - successRate = successCount / useCount (0.5 if no uses)
	 * - freshness = 1 / (1 + daysSinceLastUse) — exponential decay
	 * - diversity = uniqueContexts / totalUses (0 if no uses)
	 *
	 * @param skillName - Name of the skill.
	 * @returns Complete health report.
	 */
	getSkillHealth(skillName: string): SkillHealthReport {
		const data = this.skills.get(skillName);
		if (!data) {
			return this.emptyHealthReport(skillName);
		}

		const useRate = data.matchCount > 0
			? data.useCount / data.matchCount
			: 0;

		const successRate = data.useCount > 0
			? data.successCount / data.useCount
			: 0.5; // Neutral when no uses

		const freshnessScore = this.computeFreshness(data.lastUsedAt);

		const diversityScore = data.useCount > 0
			? Math.min(data.contexts.size / data.useCount, 1.0)
			: 0;

		const health =
			useRate * 0.4 +
			successRate * 0.3 +
			freshnessScore * 0.2 +
			diversityScore * 0.1;

		const flaggedForReview =
			health < DEPRECATION_HEALTH_THRESHOLD &&
			data.matchCount >= DEPRECATION_MIN_MATCHES;

		return {
			name: skillName,
			matchCount: data.matchCount,
			useCount: data.useCount,
			rejectCount: data.rejectCount,
			successCount: data.successCount,
			avgMatchScore: data.matchCount > 0
				? data.totalMatchScore / data.matchCount
				: 0,
			useRate,
			successRate,
			freshnessScore,
			diversityScore,
			health,
			lastUsedAt: data.lastUsedAt,
			flaggedForReview,
		};
	}

	/**
	 * Get a full evolution report across all tracked skills.
	 *
	 * @returns Array of health reports sorted by health score ascending
	 *   (worst first, so issues bubble to the top).
	 */
	getEvolutionReport(): SkillHealthReport[] {
		const reports: SkillHealthReport[] = [];
		for (const name of this.skills.keys()) {
			reports.push(this.getSkillHealth(name));
		}
		return reports.sort((a, b) => a.health - b.health);
	}

	/**
	 * Get skills that are candidates for deprecation.
	 *
	 * A skill is a deprecation candidate when:
	 * - health < 0.1
	 * - matchCount >= 50
	 *
	 * @returns Skills needing review, sorted by health ascending.
	 */
	getDeprecationCandidates(): SkillHealthReport[] {
		return this.getEvolutionReport().filter((r) => r.flaggedForReview);
	}

	// ─── Fusion Suggestions ───────────────────────────────────────────

	/**
	 * Suggest pairs of skills that should be merged.
	 *
	 * Two skills are fusion candidates when their co-occurrence rate exceeds
	 * the fusion threshold (default 60%). Co-occurrence rate is:
	 *
	 *     rate(A, B) = coOccurrences(A, B) / min(uses(A), uses(B))
	 *
	 * @returns Pairs of skills that are frequently used together.
	 */
	suggestFusions(): FusionSuggestion[] {
		const suggestions: FusionSuggestion[] = [];
		const processed = new Set<string>();

		for (const [skillA, neighbors] of this.coOccurrences) {
			for (const [skillB, count] of neighbors) {
				// Avoid duplicates (A,B) and (B,A)
				const pairKey = [skillA, skillB].sort().join("|");
				if (processed.has(pairKey)) continue;
				processed.add(pairKey);

				if (count < FUSION_MIN_CO_OCCURRENCES) continue;

				const dataA = this.skills.get(skillA);
				const dataB = this.skills.get(skillB);
				if (!dataA || !dataB) continue;

				const minUses = Math.min(dataA.useCount, dataB.useCount);
				if (minUses === 0) continue;

				const coOccurrenceRate = count / minUses;

				if (coOccurrenceRate >= FUSION_CO_OCCURRENCE_THRESHOLD) {
					suggestions.push({
						skillA,
						skillB,
						coOccurrenceRate,
						reason: `Co-used ${count} times (${(coOccurrenceRate * 100).toFixed(0)}% co-occurrence rate)`,
					});
				}
			}
		}

		return suggestions.sort((a, b) => b.coOccurrenceRate - a.coOccurrenceRate);
	}

	// ─── Serialization ────────────────────────────────────────────────

	/**
	 * Serialize the evolution state for persistence.
	 *
	 * @returns A JSON-serializable state object.
	 */
	serialize(): SkillEvolutionState {
		const skills: Array<[string, SkillTrackingData]> = [];
		for (const [name, data] of this.skills) {
			// Convert Set to serializable form
			skills.push([name, {
				...data,
				contexts: new Set(data.contexts),
			}]);
		}

		const coOccurrences: Array<[string, Array<[string, number]>]> = [];
		for (const [from, tos] of this.coOccurrences) {
			coOccurrences.push([from, [...tos.entries()]]);
		}

		return {
			skills: skills.map(([name, data]) => [name, {
				...data,
				// Serialize Set as string[] for JSON (deserialized back to Set)
				contexts: [...data.contexts] as any,
				// Ensure Thompson params are included
				thompsonAlpha: data.thompsonAlpha,
				thompsonBeta: data.thompsonBeta,
			}]),
			coOccurrences,
			sessionSkills: this.sessionSkills,
		};
	}

	/**
	 * Reconstruct a SkillEvolution from serialized state.
	 *
	 * @param state - Previously serialized state.
	 * @returns A reconstituted SkillEvolution instance.
	 */
	static deserialize(state: SkillEvolutionState): SkillEvolution {
		const evo = new SkillEvolution();

		evo.skills = new Map();
		for (const [name, data] of state.skills) {
			evo.skills.set(name, {
				...data,
				// Deserialize array back to Set
				contexts: new Set(
					Array.isArray(data.contexts)
						? (data.contexts as unknown as string[])
						: data.contexts,
				),
				// Backward compatibility: default Thompson params if not present
				thompsonAlpha: data.thompsonAlpha ?? 1,
				thompsonBeta: data.thompsonBeta ?? 1,
			});
		}

		evo.coOccurrences = new Map();
		for (const [from, tos] of state.coOccurrences) {
			evo.coOccurrences.set(from, new Map(tos));
		}

		evo.sessionSkills = state.sessionSkills;
		return evo;
	}

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
	sampleThompson(skillName: string): number {
		const data = this.skills.get(skillName);
		if (!data) {
			// No data yet — return uniform prior sample
			return Math.random();
		}

		const alpha = data.thompsonAlpha;
		const beta = data.thompsonBeta;

		// Sample X ~ Gamma(alpha, 1)
		const X = this.sampleGamma(alpha);
		// Sample Y ~ Gamma(beta, 1)
		const Y = this.sampleGamma(beta);

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
	getDreyfusLevel(skillName: string): DreyfusLevel {
		const data = this.skills.get(skillName);
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
	toAnandamayaMastery(skillName: string): AnandamayaMastery {
		const data = this.skills.get(skillName);
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
			dreyfusLevel: this.getDreyfusLevel(skillName),
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
	computeMutualInformation(skillA: string, skillB: string): number {
		const totalSessions = this.sessionSkills.length;
		if (totalSessions === 0) return 0;

		// Count sessions where each skill appears
		let countA = 0;
		let countB = 0;
		let countAB = 0;

		for (const session of this.sessionSkills) {
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
	getRelatedPairs(threshold: number = 0.3): Array<{ skillA: string; skillB: string; npmi: number }> {
		const pairs: Array<{ skillA: string; skillB: string; npmi: number }> = [];
		const processed = new Set<string>();

		for (const [skillA, neighbors] of this.coOccurrences) {
			for (const [skillB] of neighbors) {
				// Avoid duplicates (A,B) and (B,A)
				const pairKey = [skillA, skillB].sort().join("|");
				if (processed.has(pairKey)) continue;
				processed.add(pairKey);

				const npmi = this.computeMutualInformation(skillA, skillB);
				if (npmi >= threshold) {
					pairs.push({ skillA, skillB, npmi });
				}
			}
		}

		return pairs.sort((a, b) => b.npmi - a.npmi);
	}

	// ─── Private Helpers ──────────────────────────────────────────────

	/** Ensure tracking data exists for a skill. */
	private ensureSkillData(name: string): SkillTrackingData {
		let data = this.skills.get(name);
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
			this.skills.set(name, data);
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
	private computeFreshness(lastUsedAt: number | null): number {
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
	private updateCoOccurrences(skills: string[]): void {
		for (let i = 0; i < skills.length; i++) {
			for (let j = i + 1; j < skills.length; j++) {
				this.incrementCoOccurrence(skills[i], skills[j]);
				this.incrementCoOccurrence(skills[j], skills[i]);
			}
		}
	}

	/** Increment the co-occurrence count for a directed pair. */
	private incrementCoOccurrence(from: string, to: string): void {
		let neighbors = this.coOccurrences.get(from);
		if (!neighbors) {
			neighbors = new Map();
			this.coOccurrences.set(from, neighbors);
		}
		neighbors.set(to, (neighbors.get(to) ?? 0) + 1);
	}

	/** Generate an empty health report for an unknown skill. */
	private emptyHealthReport(name: string): SkillHealthReport {
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
	private sampleGamma(shape: number): number {
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
}
