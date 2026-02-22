/**
 * @chitragupta/vidhya-skills -- Skill Evolution.
 *
 * Skills that evolve through usage via online gradient descent on trait
 * vectors, Thompson sampling, and composite health scoring.
 *
 * @packageDocumentation
 */

import { TRAIT_DIMENSIONS } from "./fingerprint.js";
import type { DreyfusLevel, AnandamayaMastery } from "./types-v2.js";
import { DREYFUS_THRESHOLDS, INITIAL_ANANDAMAYA } from "./types-v2.js";

export type { SkillHealthReport, SkillEvolutionState, FusionSuggestion } from "./skill-evolution-types.js";
import type { SkillHealthReport, SkillEvolutionState, FusionSuggestion, SkillTrackingData, SerializedSkillTrackingData } from "./skill-evolution-types.js";
import {
	DEFAULT_LEARNING_RATE,
	DEPRECATION_HEALTH_THRESHOLD,
	DEPRECATION_MIN_MATCHES,
	FUSION_CO_OCCURRENCE_THRESHOLD,
	FUSION_MIN_CO_OCCURRENCES,
	MAX_SESSION_RECORDS,
	MS_PER_DAY,
} from "./skill-evolution-types.js";

import {
	sampleThompson as doSampleThompson,
	getDreyfusLevel as doGetDreyfusLevel,
	toAnandamayaMastery as doToAnandamayaMastery,
	computeMutualInformation as doComputeMI,
	getRelatedPairs as doGetRelatedPairs,
	ensureSkillData,
	computeFreshness,
	updateCoOccurrences,
	emptyHealthReport,
} from "./skill-evolution-analysis.js";

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
	 * Evolve a skill's trait vector via online SGD: v_new = L2_normalize((1 - lr) * v_old + lr * v_query).
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
	 * Compute composite health: useRate*0.4 + successRate*0.3 + freshness*0.2 + diversity*0.1.
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
	 * Suggest skill pairs for merging based on co-occurrence rate (>= 60% threshold).
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
				// Serialize Set as string[] for JSON (deserialized back to Set on restore)
				contexts: [...data.contexts],
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
				// Deserialize string[] back to Set<string>
				contexts: new Set(data.contexts),
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

	// ─── Thompson Sampling & Dreyfus (delegated) ─────────────────────

	/** Sample from the Thompson (Beta) distribution for a skill. */
	sampleThompson(skillName: string): number { return doSampleThompson(this.skills, skillName); }

	/** Get the Dreyfus mastery level for a skill. */
	getDreyfusLevel(skillName: string): DreyfusLevel { return doGetDreyfusLevel(this.skills, skillName); }

	/** Convert internal tracking data to AnandamayaMastery. */
	toAnandamayaMastery(skillName: string): AnandamayaMastery { return doToAnandamayaMastery(this.skills, skillName); }

	/** Compute pointwise mutual information between two skills. */
	computeMutualInformation(skillA: string, skillB: string): number { return doComputeMI(this.sessionSkills, skillA, skillB); }

	/** Get all skill pairs with MI above threshold. */
	getRelatedPairs(threshold: number = 0.3): Array<{ skillA: string; skillB: string; npmi: number }> {
		return doGetRelatedPairs(this.coOccurrences, this.sessionSkills, threshold);
	}

	// ─── Private Helpers (delegated) ─────────────────────────────────

	private ensureSkillData(name: string): SkillTrackingData { return ensureSkillData(this.skills, name); }
	private computeFreshness(lastUsedAt: number | null): number { return computeFreshness(lastUsedAt); }
	private updateCoOccurrences(skills: string[]): void { updateCoOccurrences(this.coOccurrences, skills); }
	private emptyHealthReport(name: string): SkillHealthReport { return emptyHealthReport(name); }
}
