/**
 * Samskara (संस्कार) — Usage Impression Bridge
 *
 * Connects SkillEvolution, Samskaara Consolidation (smriti), and Chetana Self-Model (anina)
 * by collecting usage impressions and maintaining mastery state per skill.
 *
 * Decoupled design: uses callbacks/events to avoid cross-package dependencies.
 */

import type {
	SamskaraImpression,
	AnandamayaMastery,
	DreyfusLevel,
} from "./types-v2.js";
import { INITIAL_ANANDAMAYA, DREYFUS_THRESHOLDS } from "./types-v2.js";

const MAX_IMPRESSIONS_DEFAULT = 100;
const MAX_IMPRESSIONS_CEILING = 500;
const OVERRIDE_THRESHOLD = 3;
const EMA_ALPHA = 0.2;
const WILSON_Z = 1.96; // 95% confidence

export interface SamskaraConfig {
	maxImpressionsPerSkill?: number;
	onMasteryChange?: (skillName: string, mastery: AnandamayaMastery) => void;
	onPreferenceDetected?: (preferred: string, over: string, confidence: number) => void;
}

export interface SerializedSamskaraState {
	mastery: Array<[string, AnandamayaMastery]>;
	overrides: Array<[string, Array<[string, number]>]>;
	coOccurrences: Array<[string, Array<[string, number]>]>;
}

export class SamskaraSkillBridge {
	private readonly maxImpressionsPerSkill: number;
	private readonly onMasteryChange?: (skillName: string, mastery: AnandamayaMastery) => void;
	private readonly onPreferenceDetected?: (preferred: string, over: string, confidence: number) => void;

	private readonly impressions: Map<string, SamskaraImpression[]>;
	private readonly mastery: Map<string, AnandamayaMastery>;
	private readonly overrideCounts: Map<string, Map<string, number>>;
	private readonly coOccurrences: Map<string, Map<string, number>>;
	private readonly sessionSkills: Map<string, Set<string>>;

	constructor(config?: SamskaraConfig) {
		this.maxImpressionsPerSkill = Math.min(
			config?.maxImpressionsPerSkill ?? MAX_IMPRESSIONS_DEFAULT,
			MAX_IMPRESSIONS_CEILING
		);
		this.onMasteryChange = config?.onMasteryChange;
		this.onPreferenceDetected = config?.onPreferenceDetected;

		this.impressions = new Map();
		this.mastery = new Map();
		this.overrideCounts = new Map();
		this.coOccurrences = new Map();
		this.sessionSkills = new Map();
	}

	recordImpression(impression: SamskaraImpression): void {
		const { skillName, sessionId } = impression;

		// Add to impression buffer (FIFO)
		let buffer = this.impressions.get(skillName);
		if (!buffer) {
			buffer = [];
			this.impressions.set(skillName, buffer);
		}
		buffer.push(impression);
		if (buffer.length > this.maxImpressionsPerSkill) {
			buffer.shift();
		}

		// Update mastery
		this.updateMastery(skillName, impression.success, impression.latencyMs ?? 0);

		// Track overrides
		if (impression.wasOverridden && impression.preferredSkill) {
			const preferredMap = this.overrideCounts.get(impression.preferredSkill) ?? new Map();
			const count = (preferredMap.get(skillName) ?? 0) + 1;
			preferredMap.set(skillName, count);
			this.overrideCounts.set(impression.preferredSkill, preferredMap);

			// Check for preference detection
			if (count === OVERRIDE_THRESHOLD && this.onPreferenceDetected) {
				const confidence = this.computeOverrideConfidence(impression.preferredSkill, skillName);
				this.onPreferenceDetected(impression.preferredSkill, skillName, confidence);
			}
		}

		// Track session co-occurrence
		if (sessionId) {
			let skills = this.sessionSkills.get(sessionId);
			if (!skills) {
				skills = new Set();
				this.sessionSkills.set(sessionId, skills);
			}
			skills.add(skillName);
		}
	}

	updateMastery(skillName: string, success: boolean, latencyMs: number): AnandamayaMastery {
		const current = this.mastery.get(skillName) ?? { ...INITIAL_ANANDAMAYA };
		const nowIso = new Date().toISOString();

		const totalInvocations = current.totalInvocations + 1;
		const successCount = success ? current.successCount + 1 : current.successCount;
		const failureCount = success ? current.failureCount : current.failureCount + 1;
		const thompsonAlpha = success ? current.thompsonAlpha + 1 : current.thompsonAlpha;
		const thompsonBeta = success ? current.thompsonBeta : current.thompsonBeta + 1;
		const successRate = successCount / totalInvocations;

		// EMA for latency
		const avgLatencyMs = current.avgLatencyMs === 0
			? latencyMs
			: EMA_ALPHA * latencyMs + (1 - EMA_ALPHA) * current.avgLatencyMs;

		const updated: AnandamayaMastery = {
			...current,
			totalInvocations,
			successCount,
			failureCount,
			thompsonAlpha,
			thompsonBeta,
			successRate,
			avgLatencyMs,
			dreyfusLevel: computeDreyfusLevel(totalInvocations, successRate),
			lastInvokedAt: nowIso,
			firstInvokedAt: current.firstInvokedAt === null ? nowIso : current.firstInvokedAt,
		};

		this.mastery.set(skillName, updated);

		if (this.onMasteryChange) {
			this.onMasteryChange(skillName, updated);
		}

		return updated;
	}

	getMastery(skillName: string): AnandamayaMastery {
		return this.mastery.get(skillName) ?? { ...INITIAL_ANANDAMAYA };
	}

	getAllMastery(): Map<string, AnandamayaMastery> {
		return new Map(this.mastery);
	}

	sampleThompson(skillName: string): number {
		const m = this.getMastery(skillName);
		const { thompsonAlpha: alpha, thompsonBeta: beta } = m;

		// For small alpha+beta, use sum-of-exponentials for exact Gamma
		// For large, use normal approximation
		if (alpha + beta < 100) {
			const x = this.gammaInteger(alpha);
			const y = this.gammaInteger(beta);
			return x / (x + y);
		} else {
			// Normal approximation: Beta(a,b) ≈ N(μ, σ²)
			// μ = a/(a+b), σ² = ab/((a+b)²(a+b+1))
			const sum = alpha + beta;
			const mean = alpha / sum;
			const variance = (alpha * beta) / (sum * sum * (sum + 1));
			const stddev = Math.sqrt(variance);
			const z = this.randomNormal();
			const sample = mean + z * stddev;
			return Math.max(0, Math.min(1, sample)); // Clamp to [0,1]
		}
	}

	private gammaInteger(shape: number): number {
		// Gamma(n, 1) = sum of n exponential(1) variates
		// Exponential(1) = -ln(U)
		let sum = 0;
		for (let i = 0; i < shape; i++) {
			sum -= Math.log(Math.random());
		}
		return sum;
	}

	private randomNormal(): number {
		// Box-Muller transform
		const u1 = Math.random();
		const u2 = Math.random();
		return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	}

	private computeOverrideConfidence(preferred: string, over: string): number {
		const preferredMap = this.overrideCounts.get(preferred);
		if (!preferredMap) return 0;

		const overrideCount = preferredMap.get(over) ?? 0;
		const preferredMastery = this.getMastery(preferred);
		const overMastery = this.getMastery(over);

		// Total comparisons = times both skills were available
		// Approximate as min(totalInvocations) since we don't track exact co-availability
		const totalComparisons = Math.min(preferredMastery.totalInvocations, overMastery.totalInvocations);

		if (totalComparisons === 0) return 0;

		const p = overrideCount / totalComparisons;
		const n = totalComparisons;

		// Wilson score lower bound
		const z = WILSON_Z;
		const z2 = z * z;
		const denominator = 1 + z2 / n;
		const centerAdjusted = p + z2 / (2 * n);
		const adjustedStddev = Math.sqrt((p * (1 - p) / n) + (z2 / (4 * n * n)));
		const lower = (centerAdjusted - z * adjustedStddev) / denominator;

		return Math.max(0, lower);
	}

	getPreferences(): Array<{ preferred: string; over: string; count: number; confidence: number }> {
		const result: Array<{ preferred: string; over: string; count: number; confidence: number }> = [];

		for (const [preferred, overMap] of this.overrideCounts) {
			for (const [over, count] of overMap) {
				if (count >= OVERRIDE_THRESHOLD) {
					const confidence = this.computeOverrideConfidence(preferred, over);
					result.push({ preferred, over, count, confidence });
				}
			}
		}

		return result.sort((a, b) => b.confidence - a.confidence);
	}

	getCoOccurrences(skillName: string): Array<{ skill: string; count: number; rate: number }> {
		const coMap = this.coOccurrences.get(skillName);
		if (!coMap) return [];

		// Total sessions where skillName appeared
		let totalSessions = 0;
		for (const skills of this.sessionSkills.values()) {
			if (skills.has(skillName)) {
				totalSessions++;
			}
		}

		// Also count flushed sessions (approximate by impressions)
		const buffer = this.impressions.get(skillName);
		if (buffer) {
			const uniqueSessions = new Set(buffer.map(i => i.sessionId).filter(Boolean));
			totalSessions += uniqueSessions.size;
		}

		if (totalSessions === 0) return [];

		const result: Array<{ skill: string; count: number; rate: number }> = [];
		for (const [skill, count] of coMap) {
			const rate = count / totalSessions;
			result.push({ skill, count, rate });
		}

		return result.sort((a, b) => b.rate - a.rate);
	}

	flushSession(sessionId: string): void {
		const skills = this.sessionSkills.get(sessionId);
		if (!skills) return;

		const skillArray = Array.from(skills);

		// Update co-occurrence counts for all pairs
		for (let i = 0; i < skillArray.length; i++) {
			for (let j = i + 1; j < skillArray.length; j++) {
				const a = skillArray[i];
				const b = skillArray[j];

				// Increment A → B
				let mapA = this.coOccurrences.get(a);
				if (!mapA) {
					mapA = new Map();
					this.coOccurrences.set(a, mapA);
				}
				mapA.set(b, (mapA.get(b) ?? 0) + 1);

				// Increment B → A
				let mapB = this.coOccurrences.get(b);
				if (!mapB) {
					mapB = new Map();
					this.coOccurrences.set(b, mapB);
				}
				mapB.set(a, (mapB.get(a) ?? 0) + 1);
			}
		}

		this.sessionSkills.delete(sessionId);
	}

	serialize(): SerializedSamskaraState {
		const masteryArray: Array<[string, AnandamayaMastery]> = Array.from(this.mastery.entries());

		const overridesArray: Array<[string, Array<[string, number]>]> = Array.from(this.overrideCounts.entries()).map(
			([preferred, map]) => [preferred, Array.from(map.entries())]
		);

		const coOccurrencesArray: Array<[string, Array<[string, number]>]> = Array.from(this.coOccurrences.entries()).map(
			([skill, map]) => [skill, Array.from(map.entries())]
		);

		return {
			mastery: masteryArray,
			overrides: overridesArray,
			coOccurrences: coOccurrencesArray,
		};
	}

	deserialize(state: SerializedSamskaraState): void {
		this.mastery.clear();
		this.overrideCounts.clear();
		this.coOccurrences.clear();

		for (const [skill, mastery] of state.mastery) {
			this.mastery.set(skill, mastery);
		}

		for (const [preferred, overArray] of state.overrides) {
			const map = new Map(overArray);
			this.overrideCounts.set(preferred, map);
		}

		for (const [skill, coArray] of state.coOccurrences) {
			const map = new Map(coArray);
			this.coOccurrences.set(skill, map);
		}
	}
}

export function computeDreyfusLevel(uses: number, successRate: number): DreyfusLevel {
	// DREYFUS_THRESHOLDS is ordered highest-to-lowest; find the first match
	for (const threshold of DREYFUS_THRESHOLDS) {
		if (uses >= threshold.minUses && successRate >= threshold.minSuccessRate) {
			return threshold.level;
		}
	}

	return "novice";
}
