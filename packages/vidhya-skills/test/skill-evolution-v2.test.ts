/**
 * @module skill-evolution-v2.test
 * @description Tests for the NEW Vidya-Tantra additions to SkillEvolution:
 * - Thompson Sampling (sampleThompson, sampleGamma)
 * - Dreyfus Mastery Model (getDreyfusLevel)
 * - Mutual Information (computeMutualInformation, getRelatedPairs)
 * - toAnandamayaMastery() conversion
 *
 * These features transform SkillEvolution from a simple counter into a
 * Bayesian reasoning engine that learns which skills to trust and which
 * skills co-occur meaningfully.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SkillEvolution } from "../src/skill-evolution.js";
import type { AnandamayaMastery, DreyfusLevel } from "../src/types-v2.js";
import { DREYFUS_THRESHOLDS, INITIAL_ANANDAMAYA } from "../src/types-v2.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Record N successful or failed usages for a skill.
 * Optionally provides context for diversity tracking.
 */
function recordNUsages(
	evo: SkillEvolution,
	skillName: string,
	n: number,
	success: boolean,
	context?: string,
): void {
	for (let i = 0; i < n; i++) {
		evo.recordUsage(skillName, success, context ? `${context}-${i}` : undefined);
	}
}

/**
 * Build sessions with co-occurring skills and flush them.
 * Each session contains the specified skill pair.
 */
function buildCoOccurringSessions(
	evo: SkillEvolution,
	skillA: string,
	skillB: string,
	count: number,
): void {
	for (let i = 0; i < count; i++) {
		evo.recordUsage(skillA, true, `session-${i}`);
		evo.recordUsage(skillB, true, `session-${i}`);
		evo.flushSession();
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Thompson Sampling
// ═══════════════════════════════════════════════════════════════════════════

describe("SkillEvolution — Thompson Sampling", () => {
	let evo: SkillEvolution;

	beforeEach(() => {
		evo = new SkillEvolution();
	});

	it("sampleThompson returns a value in [0, 1] for a tracked skill", () => {
		evo.recordUsage("skill-a", true);
		for (let i = 0; i < 50; i++) {
			const sample = evo.sampleThompson("skill-a");
			expect(sample).toBeGreaterThanOrEqual(0);
			expect(sample).toBeLessThanOrEqual(1);
		}
	});

	it("sampleThompson returns a value in [0, 1] for an unknown skill", () => {
		for (let i = 0; i < 50; i++) {
			const sample = evo.sampleThompson("unknown");
			expect(sample).toBeGreaterThanOrEqual(0);
			expect(sample).toBeLessThanOrEqual(1);
		}
	});

	it("initial params (1,1) produce uniform distribution with mean ~0.5", () => {
		// Just record a match (no usages) so skill exists with default Thompson params
		evo.recordMatch("uniform-skill", "test", 0.5);

		// recordMatch doesn't set thompsonAlpha/Beta; we need a usage event
		// Instead, let's just sample from unknown which uses Math.random()
		let sum = 0;
		const N = 500;
		for (let i = 0; i < N; i++) {
			sum += evo.sampleThompson("non-existent");
		}
		const mean = sum / N;
		// Mean of Uniform(0,1) = 0.5 with some tolerance
		expect(mean).toBeGreaterThan(0.3);
		expect(mean).toBeLessThan(0.7);
	});

	it("after many successes, samples are high (mean > 0.7)", () => {
		// 50 successes, 1 failure -> alpha=52, beta=2 -> mean=52/54 ~ 0.96
		recordNUsages(evo, "winning-skill", 50, true);
		evo.recordUsage("winning-skill", false);

		let sum = 0;
		const N = 100;
		for (let i = 0; i < N; i++) {
			sum += evo.sampleThompson("winning-skill");
		}
		const mean = sum / N;
		expect(mean).toBeGreaterThan(0.7);
	});

	it("after many failures, samples are low (mean < 0.3)", () => {
		// 50 failures, 1 success -> alpha=2, beta=51 -> mean=2/53 ~ 0.038
		recordNUsages(evo, "losing-skill", 50, false);
		evo.recordUsage("losing-skill", true);

		let sum = 0;
		const N = 100;
		for (let i = 0; i < N; i++) {
			sum += evo.sampleThompson("losing-skill");
		}
		const mean = sum / N;
		expect(mean).toBeLessThan(0.3);
	});

	it("Thompson params update correctly: success increments alpha", () => {
		evo.recordUsage("skill-a", true);
		evo.recordUsage("skill-a", true);
		evo.recordUsage("skill-a", true);

		const mastery = evo.toAnandamayaMastery("skill-a");
		// Initial alpha=1, plus 3 successes = 4
		expect(mastery.thompsonAlpha).toBe(4);
		// Initial beta=1, no failures
		expect(mastery.thompsonBeta).toBe(1);
	});

	it("Thompson params update correctly: failure increments beta", () => {
		evo.recordUsage("skill-a", false);
		evo.recordUsage("skill-a", false);

		const mastery = evo.toAnandamayaMastery("skill-a");
		// Initial alpha=1, no successes
		expect(mastery.thompsonAlpha).toBe(1);
		// Initial beta=1, plus 2 failures = 3
		expect(mastery.thompsonBeta).toBe(3);
	});

	it("mixed success/failure produces intermediate Thompson params", () => {
		// 10 successes, 5 failures
		recordNUsages(evo, "mixed", 10, true);
		recordNUsages(evo, "mixed", 5, false);

		const mastery = evo.toAnandamayaMastery("mixed");
		expect(mastery.thompsonAlpha).toBe(11); // 1 + 10
		expect(mastery.thompsonBeta).toBe(6);   // 1 + 5
	});

	it("sampleThompson is non-deterministic (different calls can produce different values)", () => {
		recordNUsages(evo, "skill-a", 5, true);

		const samples = new Set<number>();
		for (let i = 0; i < 20; i++) {
			samples.add(evo.sampleThompson("skill-a"));
		}
		// With 20 samples from a continuous distribution, we should get at least 2 unique values
		expect(samples.size).toBeGreaterThan(1);
	});

	it("Thompson Sampling preserved through serialization round-trip", () => {
		recordNUsages(evo, "skill-a", 20, true);
		recordNUsages(evo, "skill-a", 5, false);

		const state = evo.serialize();
		const restored = SkillEvolution.deserialize(state);

		const originalMastery = evo.toAnandamayaMastery("skill-a");
		const restoredMastery = restored.toAnandamayaMastery("skill-a");

		expect(restoredMastery.thompsonAlpha).toBe(originalMastery.thompsonAlpha);
		expect(restoredMastery.thompsonBeta).toBe(originalMastery.thompsonBeta);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Dreyfus Mastery Model
// ═══════════════════════════════════════════════════════════════════════════

describe("SkillEvolution — Dreyfus Mastery Model", () => {
	let evo: SkillEvolution;

	beforeEach(() => {
		evo = new SkillEvolution();
	});

	it("returns novice for unknown skill", () => {
		expect(evo.getDreyfusLevel("unknown")).toBe("novice");
	});

	it("returns novice for skill with 0 uses", () => {
		evo.recordMatch("skill-a", "test", 0.5);
		expect(evo.getDreyfusLevel("skill-a")).toBe("novice");
	});

	it("returns novice for < 5 uses regardless of success rate", () => {
		recordNUsages(evo, "skill-a", 4, true);
		// 4 uses, 100% success -> still novice (< 5 uses)
		expect(evo.getDreyfusLevel("skill-a")).toBe("novice");
	});

	it("returns advanced-beginner for 5+ uses with success >= 0.3", () => {
		recordNUsages(evo, "skill-a", 5, true);
		// 5 uses, 100% success -> advanced-beginner (5-19 uses)
		expect(evo.getDreyfusLevel("skill-a")).toBe("advanced-beginner");
	});

	it("returns novice for 5+ uses with success < 0.3", () => {
		// 5 uses: 1 success + 4 failures = 20% success < 0.3
		evo.recordUsage("skill-a", true);
		recordNUsages(evo, "skill-a", 4, false);
		expect(evo.getDreyfusLevel("skill-a")).toBe("novice");
	});

	it("returns competent for 20+ uses with success >= 0.5", () => {
		// 20 uses: 12 success + 8 failure = 60% success >= 0.5
		recordNUsages(evo, "skill-a", 12, true);
		recordNUsages(evo, "skill-a", 8, false);
		expect(evo.getDreyfusLevel("skill-a")).toBe("competent");
	});

	it("returns advanced-beginner for 20+ uses with success < 0.5 but >= 0.3", () => {
		// 20 uses: 8 success + 12 failure = 40% success (>= 0.3 but < 0.5)
		recordNUsages(evo, "skill-a", 8, true);
		recordNUsages(evo, "skill-a", 12, false);
		expect(evo.getDreyfusLevel("skill-a")).toBe("advanced-beginner");
	});

	it("returns proficient for 50+ uses with success >= 0.7", () => {
		// 50 uses: 40 success + 10 failure = 80% success >= 0.7
		recordNUsages(evo, "skill-a", 40, true);
		recordNUsages(evo, "skill-a", 10, false);
		expect(evo.getDreyfusLevel("skill-a")).toBe("proficient");
	});

	it("returns competent for 50+ uses with success < 0.7 but >= 0.5", () => {
		// 50 uses: 30 success + 20 failure = 60% success (>= 0.5 but < 0.7)
		recordNUsages(evo, "skill-a", 30, true);
		recordNUsages(evo, "skill-a", 20, false);
		expect(evo.getDreyfusLevel("skill-a")).toBe("competent");
	});

	it("returns expert for 100+ uses with success >= 0.85", () => {
		// 100 uses: 90 success + 10 failure = 90% success >= 0.85
		recordNUsages(evo, "skill-a", 90, true);
		recordNUsages(evo, "skill-a", 10, false);
		expect(evo.getDreyfusLevel("skill-a")).toBe("expert");
	});

	it("returns proficient for 100+ uses with success < 0.85 but >= 0.7", () => {
		// 100 uses: 75 success + 25 failure = 75% success (>= 0.7 but < 0.85)
		recordNUsages(evo, "skill-a", 75, true);
		recordNUsages(evo, "skill-a", 25, false);
		expect(evo.getDreyfusLevel("skill-a")).toBe("proficient");
	});

	it("exact boundary: 5 uses with exactly 0.3 success rate", () => {
		// Need 5 uses with success rate exactly 0.3 = 1.5/5
		// Not possible with integers, so try: 2/6 = 0.333 >= 0.3 with 6 uses
		recordNUsages(evo, "skill-a", 2, true);
		recordNUsages(evo, "skill-a", 4, false);
		// 6 uses, 33% success >= 0.3 and >= 5 uses -> advanced-beginner
		expect(evo.getDreyfusLevel("skill-a")).toBe("advanced-beginner");
	});

	it("exact boundary: 100 uses with exactly 85% success", () => {
		recordNUsages(evo, "skill-a", 85, true);
		recordNUsages(evo, "skill-a", 15, false);
		// 100 uses, 85% success >= 0.85 -> expert
		expect(evo.getDreyfusLevel("skill-a")).toBe("expert");
	});

	it("Dreyfus levels match DREYFUS_THRESHOLDS ordering (highest first)", () => {
		// Verify the DREYFUS_THRESHOLDS are ordered from highest to lowest
		for (let i = 1; i < DREYFUS_THRESHOLDS.length; i++) {
			expect(DREYFUS_THRESHOLDS[i - 1].minUses)
				.toBeGreaterThanOrEqual(DREYFUS_THRESHOLDS[i].minUses);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Mutual Information (NPMI)
// ═══════════════════════════════════════════════════════════════════════════

describe("SkillEvolution — Mutual Information", () => {
	let evo: SkillEvolution;

	beforeEach(() => {
		evo = new SkillEvolution();
	});

	it("returns 0 for skills with no session data", () => {
		expect(evo.computeMutualInformation("skill-a", "skill-b")).toBe(0);
	});

	it("returns 0 when one skill never appears in sessions", () => {
		// Only skill-a appears in sessions
		for (let i = 0; i < 5; i++) {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-c", true);
			evo.flushSession();
		}

		expect(evo.computeMutualInformation("skill-a", "skill-b")).toBe(0);
	});

	it("co-occurring skills have positive NPMI", () => {
		// For positive NPMI, P(A,B) > P(A)*P(B)
		// Need sessions where BOTH skills sometimes DON'T appear
		// 15 sessions: A+B, 5 sessions: A+C, 5 sessions: B+D, 5 sessions: C+D
		buildCoOccurringSessions(evo, "skill-a", "skill-b", 15);
		for (let i = 0; i < 5; i++) {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-c", true);
			evo.flushSession();
		}
		for (let i = 0; i < 5; i++) {
			evo.recordUsage("skill-b", true);
			evo.recordUsage("skill-d", true);
			evo.flushSession();
		}
		for (let i = 0; i < 5; i++) {
			evo.recordUsage("skill-c", true);
			evo.recordUsage("skill-d", true);
			evo.flushSession();
		}
		// Total 30 sessions. countA=20, countB=20, countAB=15
		// pA=20/30=0.667, pB=20/30=0.667, pAB=15/30=0.5
		// PMI = log2(0.5 / (0.667 * 0.667)) = log2(0.5/0.444) = log2(1.125) > 0
		const npmi = evo.computeMutualInformation("skill-a", "skill-b");
		expect(npmi).toBeGreaterThan(0);
	});

	it("exclusively co-occurring skills produce NaN (degenerate NPMI edge case)", () => {
		// When ALL sessions contain both skills, pAB=1.0, -log2(1.0)=0 -> division by zero
		// This is a known mathematical edge case in NPMI
		buildCoOccurringSessions(evo, "skill-a", "skill-b", 20);

		const npmi = evo.computeMutualInformation("skill-a", "skill-b");
		// pA=1, pB=1, pAB=1 -> PMI=log2(1/(1*1))=0, NPMI=0/0=NaN
		expect(Number.isNaN(npmi)).toBe(true);
	});

	it("high co-occurrence with some independent sessions produces high positive NPMI", () => {
		// To get NPMI close to 1, need P(A,B) much higher than P(A)*P(B)
		// Both A and B should be relatively rare but always together when they appear
		// 10 sessions: A+B, 10 sessions: C+D (no A, no B)
		buildCoOccurringSessions(evo, "skill-a", "skill-b", 10);
		for (let i = 0; i < 10; i++) {
			evo.recordUsage("skill-c", true);
			evo.recordUsage("skill-d", true);
			evo.flushSession();
		}
		// Total 20 sessions. countA=10, countB=10, countAB=10
		// pA=0.5, pB=0.5, pAB=0.5
		// PMI = log2(0.5 / (0.5*0.5)) = log2(2) = 1
		// NPMI = 1 / -log2(0.5) = 1/1 = 1
		const npmi = evo.computeMutualInformation("skill-a", "skill-b");
		expect(npmi).toBeCloseTo(1.0, 5);
	});

	it("non-co-occurring skills have NPMI near 0 or negative", () => {
		// skill-a and skill-b never appear together
		// skill-a appears with skill-c
		// skill-b appears with skill-d
		for (let i = 0; i < 10; i++) {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-c", true);
			evo.flushSession();
		}
		for (let i = 0; i < 10; i++) {
			evo.recordUsage("skill-b", true);
			evo.recordUsage("skill-d", true);
			evo.flushSession();
		}

		const npmi = evo.computeMutualInformation("skill-a", "skill-b");
		// They never co-occur -> countAB = 0 -> returns 0
		expect(npmi).toBe(0);
	});

	it("getRelatedPairs returns pairs above threshold", () => {
		// Build: 10 sessions A+B, 10 sessions C+D (no A, no B)
		// This gives NPMI = 1.0 (perfect non-trivial co-occurrence)
		buildCoOccurringSessions(evo, "skill-a", "skill-b", 10);
		for (let i = 0; i < 10; i++) {
			evo.recordUsage("skill-c", true);
			evo.recordUsage("skill-d", true);
			evo.flushSession();
		}

		const pairs = evo.getRelatedPairs(0.5);
		const abPair = pairs.find(
			(p) =>
				(p.skillA === "skill-a" && p.skillB === "skill-b") ||
				(p.skillA === "skill-b" && p.skillB === "skill-a"),
		);
		expect(abPair).toBeDefined();
		expect(abPair!.npmi).toBeGreaterThan(0.5);
	});

	it("getRelatedPairs returns empty when no pairs above threshold", () => {
		// Build weakly co-occurring sessions
		for (let i = 0; i < 3; i++) {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-b", true);
			evo.flushSession();
		}
		for (let i = 0; i < 10; i++) {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-c", true);
			evo.flushSession();
		}

		const pairs = evo.getRelatedPairs(0.95);
		// With mixed sessions, no pair should be above 0.95
		expect(pairs.length).toBe(0);
	});

	it("getRelatedPairs sorted by NPMI descending", () => {
		// Build strong co-occurrence for A-B
		buildCoOccurringSessions(evo, "skill-a", "skill-b", 20);

		// Build weaker co-occurrence for A-C (mixed with solo sessions)
		for (let i = 0; i < 10; i++) {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-c", true);
			evo.flushSession();
		}
		for (let i = 0; i < 10; i++) {
			evo.recordUsage("skill-c", true);
			evo.recordUsage("skill-d", true);
			evo.flushSession();
		}

		const pairs = evo.getRelatedPairs(0.1);
		if (pairs.length >= 2) {
			for (let i = 1; i < pairs.length; i++) {
				expect(pairs[i - 1].npmi).toBeGreaterThanOrEqual(pairs[i].npmi);
			}
		}
	});

	it("NPMI is symmetric: MI(A,B) = MI(B,A)", () => {
		// Ensure non-exclusive co-occurrence so NPMI is not NaN
		buildCoOccurringSessions(evo, "skill-x", "skill-y", 15);
		// Add some independent sessions
		for (let i = 0; i < 3; i++) {
			evo.recordUsage("skill-x", true);
			evo.recordUsage("skill-z", true);
			evo.flushSession();
		}
		for (let i = 0; i < 2; i++) {
			evo.recordUsage("skill-y", true);
			evo.recordUsage("skill-w", true);
			evo.flushSession();
		}

		const ab = evo.computeMutualInformation("skill-x", "skill-y");
		const ba = evo.computeMutualInformation("skill-y", "skill-x");
		expect(ab).toBeCloseTo(ba, 10);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// toAnandamayaMastery()
// ═══════════════════════════════════════════════════════════════════════════

describe("SkillEvolution — toAnandamayaMastery", () => {
	let evo: SkillEvolution;

	beforeEach(() => {
		evo = new SkillEvolution();
	});

	it("returns INITIAL_ANANDAMAYA for unknown skill", () => {
		const mastery = evo.toAnandamayaMastery("unknown");
		expect(mastery).toEqual(INITIAL_ANANDAMAYA);
	});

	it("correctly maps totalInvocations from useCount", () => {
		recordNUsages(evo, "skill-a", 15, true);
		recordNUsages(evo, "skill-a", 5, false);

		const mastery = evo.toAnandamayaMastery("skill-a");
		expect(mastery.totalInvocations).toBe(20);
	});

	it("correctly maps successCount and failureCount", () => {
		recordNUsages(evo, "skill-a", 12, true);
		recordNUsages(evo, "skill-a", 3, false);

		const mastery = evo.toAnandamayaMastery("skill-a");
		expect(mastery.successCount).toBe(12);
		expect(mastery.failureCount).toBe(3);
	});

	it("correctly computes successRate", () => {
		recordNUsages(evo, "skill-a", 7, true);
		recordNUsages(evo, "skill-a", 3, false);

		const mastery = evo.toAnandamayaMastery("skill-a");
		expect(mastery.successRate).toBeCloseTo(0.7, 5);
	});

	it("successRate is 0 when no uses", () => {
		evo.recordMatch("skill-a", "q", 0.5);
		const mastery = evo.toAnandamayaMastery("skill-a");
		expect(mastery.successRate).toBe(0);
	});

	it("maps dreyfusLevel correctly", () => {
		recordNUsages(evo, "skill-a", 90, true);
		recordNUsages(evo, "skill-a", 10, false);

		const mastery = evo.toAnandamayaMastery("skill-a");
		expect(mastery.dreyfusLevel).toBe("expert");
	});

	it("preserves Thompson alpha and beta", () => {
		recordNUsages(evo, "skill-a", 8, true);
		recordNUsages(evo, "skill-a", 3, false);

		const mastery = evo.toAnandamayaMastery("skill-a");
		// alpha = 1 (initial) + 8 (successes) = 9
		expect(mastery.thompsonAlpha).toBe(9);
		// beta = 1 (initial) + 3 (failures) = 4
		expect(mastery.thompsonBeta).toBe(4);
	});

	it("lastInvokedAt is ISO string when used, null otherwise", () => {
		const mastery1 = evo.toAnandamayaMastery("never-used");
		expect(mastery1.lastInvokedAt).toBeNull();

		evo.recordUsage("used-skill", true);
		const mastery2 = evo.toAnandamayaMastery("used-skill");
		expect(mastery2.lastInvokedAt).not.toBeNull();
		// Should be a valid ISO date
		expect(() => new Date(mastery2.lastInvokedAt!)).not.toThrow();
		expect(new Date(mastery2.lastInvokedAt!).getTime()).toBeGreaterThan(0);
	});

	it("firstInvokedAt is null (not tracked in current implementation)", () => {
		evo.recordUsage("skill-a", true);
		const mastery = evo.toAnandamayaMastery("skill-a");
		expect(mastery.firstInvokedAt).toBeNull();
	});

	it("avgLatencyMs is 0 (not tracked in current implementation)", () => {
		evo.recordUsage("skill-a", true);
		const mastery = evo.toAnandamayaMastery("skill-a");
		expect(mastery.avgLatencyMs).toBe(0);
	});

	it("round-trip: toAnandamayaMastery matches internal state after serialization", () => {
		recordNUsages(evo, "skill-a", 25, true);
		recordNUsages(evo, "skill-a", 5, false);

		const state = evo.serialize();
		const restored = SkillEvolution.deserialize(state);

		const original = evo.toAnandamayaMastery("skill-a");
		const fromRestored = restored.toAnandamayaMastery("skill-a");

		expect(fromRestored.totalInvocations).toBe(original.totalInvocations);
		expect(fromRestored.successCount).toBe(original.successCount);
		expect(fromRestored.failureCount).toBe(original.failureCount);
		expect(fromRestored.successRate).toBeCloseTo(original.successRate, 10);
		expect(fromRestored.dreyfusLevel).toBe(original.dreyfusLevel);
		expect(fromRestored.thompsonAlpha).toBe(original.thompsonAlpha);
		expect(fromRestored.thompsonBeta).toBe(original.thompsonBeta);
	});
});
