/**
 * Yoga (योग) — Skill Composition System
 *
 * Discovers and manages skill compositions from usage patterns.
 * Three composition types:
 * - Karma (कर्म): Sequential execution
 * - Shakti (शक्ति): Parallel execution
 * - Tantra (तन्त्र): Conditional branching
 *
 * Uses co-occurrence analysis and mutual information to auto-discover
 * frequently paired skills.
 */

import type { YogaComposition, YogaType, VidyaTantraConfig } from "./types-v2.js";
import { DEFAULT_VIDYA_TANTRA_CONFIG } from "./types-v2.js";
import { fnv1a } from "./fingerprint.js";

/**
 * Helper: Creates canonical pair key (lexicographic order)
 */
function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Helper: Generates composition ID from name and skills
 */
function generateCompositionId(name: string, skills: string[]): string {
	const content = `${name}|${skills.join("|")}`;
	return `yoga-${fnv1a(content).toString(16)}`;
}

/**
 * YogaEngine — Manages skill compositions
 *
 * Discovers compositions from co-occurrence data and mutual information,
 * stores and retrieves them, tracks execution statistics.
 */
export class YogaEngine {
	private readonly compositions: Map<string, YogaComposition> = new Map();
	private readonly pairCounts: Map<string, number> = new Map();
	private readonly skillCounts: Map<string, number> = new Map();
	private totalSessions = 0;

	private readonly maxCompositions: number;
	private readonly coOccurrenceThreshold: number;
	private readonly mutualInfoThreshold: number;

	constructor(
		config?: Partial<
			Pick<VidyaTantraConfig, "maxCompositions" | "coOccurrenceThreshold" | "mutualInfoThreshold">
		>
	) {
		const defaults = DEFAULT_VIDYA_TANTRA_CONFIG;
		this.maxCompositions = config?.maxCompositions ?? defaults.maxCompositions;
		this.coOccurrenceThreshold = config?.coOccurrenceThreshold ?? defaults.coOccurrenceThreshold;
		this.mutualInfoThreshold = config?.mutualInfoThreshold ?? defaults.mutualInfoThreshold;
	}

	/**
	 * Records a session's skill usage and checks for auto-discoveries
	 */
	recordSession(skillsUsed: string[]): void {
		if (skillsUsed.length === 0) return;

		const unique = [...new Set(skillsUsed)];

		for (const skill of unique) {
			this.skillCounts.set(skill, (this.skillCounts.get(skill) ?? 0) + 1);
		}

		for (let i = 0; i < unique.length; i++) {
			for (let j = i + 1; j < unique.length; j++) {
				const key = pairKey(unique[i], unique[j]);
				this.pairCounts.set(key, (this.pairCounts.get(key) ?? 0) + 1);
			}
		}

		this.totalSessions++;

		this.checkAutoDiscovery(unique);
	}

	/**
	 * Computes co-occurrence rate for a skill pair
	 */
	computeCoOccurrence(skillA: string, skillB: string): number {
		const countA = this.skillCounts.get(skillA) ?? 0;
		const countB = this.skillCounts.get(skillB) ?? 0;
		const pairCount = this.pairCounts.get(pairKey(skillA, skillB)) ?? 0;

		if (countA === 0 || countB === 0) return 0;

		const minCount = Math.min(countA, countB);
		return pairCount / minCount;
	}

	/**
	 * Computes normalized pointwise mutual information (NPMI) for a skill pair
	 */
	computeMutualInformation(skillA: string, skillB: string): number {
		if (this.totalSessions === 0) return 0;

		const countA = this.skillCounts.get(skillA) ?? 0;
		const countB = this.skillCounts.get(skillB) ?? 0;
		const pairCount = this.pairCounts.get(pairKey(skillA, skillB)) ?? 0;

		if (countA === 0 || countB === 0 || pairCount === 0) return 0;

		const pA = countA / this.totalSessions;
		const pB = countB / this.totalSessions;
		const pAB = pairCount / this.totalSessions;

		const pmi = Math.log2(pAB / (pA * pB));
		const npmi = pmi / -Math.log2(pAB);

		return Math.max(-1, Math.min(1, npmi));
	}

	/**
	 * Checks for auto-discoverable compositions in recent skills
	 */
	checkAutoDiscovery(recentSkills: string[]): YogaComposition[] {
		const discovered: YogaComposition[] = [];

		for (let i = 0; i < recentSkills.length; i++) {
			for (let j = i + 1; j < recentSkills.length; j++) {
				const skillA = recentSkills[i];
				const skillB = recentSkills[j];

				const existingId = generateCompositionId(`${skillA}+${skillB}`, [skillA, skillB]);
				if (this.compositions.has(existingId)) continue;

				const coOccurrence = this.computeCoOccurrence(skillA, skillB);
				const mutualInfo = this.computeMutualInformation(skillA, skillB);

				if (
					coOccurrence >= this.coOccurrenceThreshold &&
					mutualInfo >= this.mutualInfoThreshold
				) {
					const comp = this.addComposition({
						name: `${skillA}+${skillB}`,
						skills: [skillA, skillB],
						type: "karma",
						coOccurrenceRate: coOccurrence,
						mutualInformation: mutualInfo,
						origin: "auto-discovered",
						discoveredAt: new Date().toISOString(),
						executionCount: 0,
						successRate: 0,
					});
					discovered.push(comp);
				}
			}
		}

		return discovered;
	}

	/**
	 * Adds a composition to the registry
	 */
	addComposition(comp: Omit<YogaComposition, "id">): YogaComposition {
		const id = generateCompositionId(comp.name, comp.skills);
		const composition: YogaComposition = { ...comp, id };

		if (this.compositions.size >= this.maxCompositions) {
			this.evictOldest();
		}

		this.compositions.set(id, composition);
		return composition;
	}

	/**
	 * Evicts the oldest composition (by discoveredAt)
	 */
	private evictOldest(): void {
		let oldestId: string | null = null;
		let oldestTime = "";

		for (const [id, comp] of this.compositions) {
			if (oldestTime === "" || comp.discoveredAt < oldestTime) {
				oldestTime = comp.discoveredAt;
				oldestId = id;
			}
		}

		if (oldestId) {
			this.compositions.delete(oldestId);
		}
	}

	/**
	 * Removes a composition from the registry
	 */
	removeComposition(id: string): boolean {
		return this.compositions.delete(id);
	}

	/**
	 * Retrieves a composition by ID
	 */
	getComposition(id: string): YogaComposition | null {
		return this.compositions.get(id) ?? null;
	}

	/**
	 * Finds all compositions that include a given skill
	 */
	findCompositions(skillName: string): YogaComposition[] {
		const results: YogaComposition[] = [];
		for (const comp of this.compositions.values()) {
			if (comp.skills.includes(skillName)) {
				results.push(comp);
			}
		}
		return results;
	}

	/**
	 * Returns all compositions sorted by execution count
	 */
	getAll(): YogaComposition[] {
		return [...this.compositions.values()].sort((a, b) => b.executionCount - a.executionCount);
	}

	/**
	 * Records an execution result for a composition
	 */
	recordExecution(id: string, success: boolean): void {
		const comp = this.compositions.get(id);
		if (!comp) return;

		const newCount = comp.executionCount + 1;
		const newRate =
			(comp.successRate * comp.executionCount + (success ? 1 : 0)) / newCount;
		this.compositions.set(id, { ...comp, executionCount: newCount, successRate: newRate });
	}

	/**
	 * Suggests compositions based on currently active skills
	 */
	suggestCompositions(activeSkills: string[], topK = 3): YogaComposition[] {
		const candidates: Array<{ comp: YogaComposition; score: number }> = [];

		for (const comp of this.compositions.values()) {
			const hasOverlap = comp.skills.some((s) => activeSkills.includes(s));
			if (!hasOverlap) continue;

			const pairs = [];
			for (let i = 0; i < comp.skills.length; i++) {
				for (let j = i + 1; j < comp.skills.length; j++) {
					pairs.push({ a: comp.skills[i], b: comp.skills[j] });
				}
			}

			let avgCoOccurrence = 0;
			let avgMutualInfo = 0;
			if (pairs.length > 0) {
				avgCoOccurrence =
					pairs.reduce((sum, { a, b }) => sum + this.computeCoOccurrence(a, b), 0) / pairs.length;
				avgMutualInfo =
					pairs.reduce((sum, { a, b }) => sum + this.computeMutualInformation(a, b), 0) /
					pairs.length;
			}

			const score =
				0.4 * avgCoOccurrence + 0.3 * avgMutualInfo + 0.3 * comp.successRate;

			candidates.push({ comp, score });
		}

		return candidates
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((c) => c.comp);
	}

	/**
	 * Discovers compositions from historical session data
	 */
	discoverFromPatterns(sessionHistory: string[][]): YogaComposition[] {
		for (const session of sessionHistory) {
			const unique = [...new Set(session)];

			for (const skill of unique) {
				this.skillCounts.set(skill, (this.skillCounts.get(skill) ?? 0) + 1);
			}

			for (let i = 0; i < unique.length; i++) {
				for (let j = i + 1; j < unique.length; j++) {
					const key = pairKey(unique[i], unique[j]);
					this.pairCounts.set(key, (this.pairCounts.get(key) ?? 0) + 1);
				}
			}

			this.totalSessions++;
		}

		const discovered: YogaComposition[] = [];
		const processedPairs = new Set<string>();

		for (const [key, _count] of this.pairCounts) {
			if (processedPairs.has(key)) continue;
			processedPairs.add(key);

			const [skillA, skillB] = key.split("|");
			const existingId = generateCompositionId(`${skillA}+${skillB}`, [skillA, skillB]);
			if (this.compositions.has(existingId)) continue;

			const coOccurrence = this.computeCoOccurrence(skillA, skillB);
			const mutualInfo = this.computeMutualInformation(skillA, skillB);

			if (
				coOccurrence >= this.coOccurrenceThreshold &&
				mutualInfo >= this.mutualInfoThreshold
			) {
				const comp = this.addComposition({
					name: `${skillA}+${skillB}`,
					skills: [skillA, skillB],
					type: "karma",
					coOccurrenceRate: coOccurrence,
					mutualInformation: mutualInfo,
					origin: "auto-discovered",
					discoveredAt: new Date().toISOString(),
					executionCount: 0,
					successRate: 0,
				});
				discovered.push(comp);
			}
		}

		return discovered;
	}

	/**
	 * Serializes engine state for persistence
	 */
	serialize(): {
		compositions: YogaComposition[];
		pairCounts: Array<[string, number]>;
		skillCounts: Array<[string, number]>;
		totalSessions: number;
	} {
		return {
			compositions: [...this.compositions.values()],
			pairCounts: [...this.pairCounts.entries()],
			skillCounts: [...this.skillCounts.entries()],
			totalSessions: this.totalSessions,
		};
	}

	/**
	 * Deserializes engine state from persistence
	 */
	deserialize(state: ReturnType<YogaEngine["serialize"]>): void {
		this.compositions.clear();
		this.pairCounts.clear();
		this.skillCounts.clear();

		for (const comp of state.compositions) {
			this.compositions.set(comp.id, comp);
		}

		for (const [key, count] of state.pairCounts) {
			this.pairCounts.set(key, count);
		}

		for (const [skill, count] of state.skillCounts) {
			this.skillCounts.set(skill, count);
		}

		this.totalSessions = state.totalSessions;
	}
}
