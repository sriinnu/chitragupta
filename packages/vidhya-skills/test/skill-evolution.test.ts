import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SkillEvolution } from "../src/skill-evolution.js";
import type {
	SkillHealthReport,
	SkillEvolutionState,
	FusionSuggestion,
} from "../src/skill-evolution.js";
import { TRAIT_DIMENSIONS } from "../src/fingerprint.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryVector(fill: number = 1.0): Float32Array {
	const v = new Float32Array(TRAIT_DIMENSIONS);
	v.fill(fill);
	return v;
}

function l2Norm(v: Float32Array): number {
	let sumSq = 0;
	for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
	return Math.sqrt(sumSq);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SkillEvolution", () => {
	let evo: SkillEvolution;

	beforeEach(() => {
		evo = new SkillEvolution();
	});

	// ── Recording ──────────────────────────────────────────────────────

	describe("recordMatch", () => {
		it("increments match count", () => {
			evo.recordMatch("skill-a", "query text", 0.8);
			evo.recordMatch("skill-a", "another query", 0.6);
			const health = evo.getSkillHealth("skill-a");
			expect(health.matchCount).toBe(2);
		});

		it("accumulates total match score for average calculation", () => {
			evo.recordMatch("skill-a", "q1", 0.8);
			evo.recordMatch("skill-a", "q2", 0.6);
			const health = evo.getSkillHealth("skill-a");
			expect(health.avgMatchScore).toBeCloseTo(0.7, 5);
		});
	});

	describe("recordUsage", () => {
		it("increments use count", () => {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-a", false);
			const health = evo.getSkillHealth("skill-a");
			expect(health.useCount).toBe(2);
		});

		it("increments success count on successful usage", () => {
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-a", true);
			evo.recordUsage("skill-a", false);
			const health = evo.getSkillHealth("skill-a");
			expect(health.successCount).toBe(2);
		});

		it("tracks unique contexts for diversity scoring", () => {
			evo.recordUsage("skill-a", true, "context-1");
			evo.recordUsage("skill-a", true, "context-2");
			evo.recordUsage("skill-a", true, "context-1"); // duplicate
			const health = evo.getSkillHealth("skill-a");
			// 2 unique contexts / 3 uses = 0.666...
			expect(health.diversityScore).toBeCloseTo(2 / 3, 2);
		});

		it("updates lastUsedAt timestamp", () => {
			const before = Date.now();
			evo.recordUsage("skill-a", true);
			const health = evo.getSkillHealth("skill-a");
			expect(health.lastUsedAt).not.toBeNull();
			expect(health.lastUsedAt!).toBeGreaterThanOrEqual(before);
		});
	});

	describe("recordReject", () => {
		it("increments reject count", () => {
			evo.recordReject("skill-a");
			evo.recordReject("skill-a");
			const health = evo.getSkillHealth("skill-a");
			expect(health.rejectCount).toBe(2);
		});
	});

	// ── Health Scoring ─────────────────────────────────────────────────

	describe("getSkillHealth", () => {
		it("returns an empty health report for an unknown skill", () => {
			const health = evo.getSkillHealth("unknown");
			expect(health.name).toBe("unknown");
			expect(health.matchCount).toBe(0);
			expect(health.useCount).toBe(0);
			expect(health.health).toBe(0);
			expect(health.flaggedForReview).toBe(false);
		});

		it("computes correct health formula", () => {
			// Set up: 10 matches, 5 uses, 4 successes, 3 unique contexts, recent
			for (let i = 0; i < 10; i++) evo.recordMatch("skill-a", "q", 0.7);
			for (let i = 0; i < 5; i++) {
				const success = i < 4;
				const context = `ctx-${i % 3}`;
				evo.recordUsage("skill-a", success, context);
			}

			const health = evo.getSkillHealth("skill-a");

			// useRate = 5/10 = 0.5
			expect(health.useRate).toBeCloseTo(0.5, 2);
			// successRate = 4/5 = 0.8
			expect(health.successRate).toBeCloseTo(0.8, 2);
			// freshnessScore should be close to 1.0 (just used)
			expect(health.freshnessScore).toBeGreaterThan(0.9);
			// diversityScore = 3 unique / 5 uses = 0.6
			expect(health.diversityScore).toBeCloseTo(0.6, 2);

			// health = 0.5*0.4 + 0.8*0.3 + ~1.0*0.2 + 0.6*0.1
			// = 0.2 + 0.24 + ~0.2 + 0.06 = ~0.7
			expect(health.health).toBeGreaterThan(0.6);
			expect(health.health).toBeLessThan(0.8);
		});

		it("returns successRate of 0.5 when no uses", () => {
			evo.recordMatch("skill-a", "q", 0.5);
			const health = evo.getSkillHealth("skill-a");
			expect(health.successRate).toBe(0.5);
		});

		it("returns freshnessScore of 0 when never used", () => {
			evo.recordMatch("skill-a", "q", 0.5);
			const health = evo.getSkillHealth("skill-a");
			expect(health.freshnessScore).toBe(0);
		});
	});

	// ── Deprecation ────────────────────────────────────────────────────

	describe("getDeprecationCandidates", () => {
		it("returns empty for healthy skills", () => {
			for (let i = 0; i < 60; i++) evo.recordMatch("skill-a", "q", 0.8);
			for (let i = 0; i < 30; i++) evo.recordUsage("skill-a", true, `ctx-${i}`);
			expect(evo.getDeprecationCandidates()).toHaveLength(0);
		});

		it("flags skills with health < 0.1 and 50+ matches", () => {
			// To get health < 0.1, we need:
			// useRate ~0, successRate = 0, freshness ~0, diversity = 0
			// Use fake timers: record a single failed use long ago (30 days)
			const now = Date.now();
			const thirtyDaysAgo = now - 30 * 86_400_000;
			vi.useFakeTimers();
			vi.setSystemTime(thirtyDaysAgo);

			// Record many matches and one failed use 30 days ago
			for (let i = 0; i < 55; i++) evo.recordMatch("bad-skill", "q", 0.1);
			evo.recordUsage("bad-skill", false); // 1 use, 0 success, 30 days ago

			// Restore to "now" so freshness decays
			vi.setSystemTime(now);

			// useRate = 1/55 ~ 0.018, successRate = 0/1 = 0,
			// freshness = 1/(1+30) ~ 0.032, diversity = 0/1 = 0
			// health = 0.018*0.4 + 0*0.3 + 0.032*0.2 + 0*0.1 = 0.007 + 0 + 0.006 + 0 = 0.013
			const candidates = evo.getDeprecationCandidates();
			expect(candidates.length).toBe(1);
			expect(candidates[0].name).toBe("bad-skill");
			expect(candidates[0].flaggedForReview).toBe(true);
			expect(candidates[0].health).toBeLessThan(0.1);

			vi.useRealTimers();
		});

		it("does not flag skills with < 50 matches even if health is 0", () => {
			for (let i = 0; i < 10; i++) evo.recordMatch("new-skill", "q", 0.1);
			const candidates = evo.getDeprecationCandidates();
			expect(candidates).toHaveLength(0);
		});
	});

	// ── Trait Vector Evolution ──────────────────────────────────────────

	describe("evolveTraitVector", () => {
		it("initializes evolved vector from the first query vector", () => {
			const qv = makeQueryVector(2.0);
			evo.evolveTraitVector("skill-a", qv);
			const evolved = evo.getEvolvedVector("skill-a");
			expect(evolved).not.toBeNull();
			expect(evolved!.length).toBe(TRAIT_DIMENSIONS);
		});

		it("returns null for a skill that has never evolved", () => {
			expect(evo.getEvolvedVector("no-skill")).toBeNull();
		});

		it("nudges the vector toward the query vector on subsequent calls", () => {
			const initial = new Float32Array(TRAIT_DIMENSIONS);
			initial[0] = 10.0; // strong signal in dim 0
			evo.evolveTraitVector("skill-a", initial);

			// Now evolve toward a vector with strong signal in dim 1
			const nudge = new Float32Array(TRAIT_DIMENSIONS);
			nudge[1] = 10.0;
			evo.evolveTraitVector("skill-a", nudge);

			const evolved = evo.getEvolvedVector("skill-a")!;
			// After evolution, dim 1 should have gained some signal
			expect(evolved[1]).toBeGreaterThan(0);
			// And dim 0 should still have signal (reduced by (1-lr))
			expect(evolved[0]).toBeGreaterThan(0);
		});

		it("produces L2-normalized output after evolution", () => {
			const qv1 = makeQueryVector(1.0);
			evo.evolveTraitVector("skill-a", qv1);
			const qv2 = makeQueryVector(3.0);
			evo.evolveTraitVector("skill-a", qv2);

			const evolved = evo.getEvolvedVector("skill-a")!;
			const norm = l2Norm(evolved);
			expect(Math.abs(norm - 1.0)).toBeLessThan(1e-4);
		});
	});

	// ── Fusion Suggestions ─────────────────────────────────────────────

	describe("suggestFusions / flushSession", () => {
		it("returns empty when no sessions are flushed", () => {
			expect(evo.suggestFusions()).toHaveLength(0);
		});

		it("does not suggest fusion below the co-occurrence threshold", () => {
			// Use two skills together in 5 sessions (below FUSION_MIN_CO_OCCURRENCES=10)
			for (let i = 0; i < 5; i++) {
				evo.recordUsage("skill-a", true);
				evo.recordUsage("skill-b", true);
				evo.flushSession();
			}
			expect(evo.suggestFusions()).toHaveLength(0);
		});

		it("suggests fusion when co-occurrence rate exceeds threshold", () => {
			// Use two skills together in 15 sessions
			for (let i = 0; i < 15; i++) {
				evo.recordUsage("skill-a", true);
				evo.recordUsage("skill-b", true);
				evo.flushSession();
			}
			const suggestions = evo.suggestFusions();
			expect(suggestions.length).toBe(1);
			const suggestion = suggestions[0];
			expect([suggestion.skillA, suggestion.skillB].sort()).toEqual(["skill-a", "skill-b"]);
			expect(suggestion.coOccurrenceRate).toBeGreaterThanOrEqual(0.6);
		});

		it("clears current session skills after flush", () => {
			evo.recordUsage("skill-a", true);
			evo.flushSession();
			// After flush, recording only skill-b and flushing should not co-occur with skill-a
			evo.recordUsage("skill-b", true);
			evo.recordUsage("skill-c", true);
			evo.flushSession();
			// No fusion between a and b since they were in different sessions
		});

		it("ignores sessions with fewer than 2 skills", () => {
			evo.recordUsage("skill-a", true);
			evo.flushSession(); // only 1 skill, should be ignored
			expect(evo.suggestFusions()).toHaveLength(0);
		});
	});

	// ── Evolution Report ───────────────────────────────────────────────

	describe("getEvolutionReport", () => {
		it("returns reports sorted by health ascending (worst first)", () => {
			// Skill with no uses (low health)
			for (let i = 0; i < 5; i++) evo.recordMatch("poor", "q", 0.3);

			// Skill with good usage
			for (let i = 0; i < 5; i++) evo.recordMatch("healthy", "q", 0.8);
			for (let i = 0; i < 4; i++) evo.recordUsage("healthy", true, `ctx-${i}`);

			const report = evo.getEvolutionReport();
			expect(report.length).toBe(2);
			expect(report[0].name).toBe("poor"); // lowest health first
			expect(report[0].health).toBeLessThan(report[1].health);
		});
	});

	// ── Serialization ──────────────────────────────────────────────────

	describe("serialize / deserialize", () => {
		it("round-trips evolution state", () => {
			evo.recordMatch("skill-a", "q1", 0.8);
			evo.recordUsage("skill-a", true, "ctx-1");
			evo.recordUsage("skill-b", true);
			evo.recordUsage("skill-a", true);
			evo.flushSession();

			const state = evo.serialize();
			const restored = SkillEvolution.deserialize(state);

			const healthA = restored.getSkillHealth("skill-a");
			expect(healthA.matchCount).toBe(1);
			expect(healthA.useCount).toBe(2);
			expect(healthA.successCount).toBe(2);
		});

		it("preserves context set through serialization", () => {
			evo.recordUsage("skill-a", true, "ctx-1");
			evo.recordUsage("skill-a", true, "ctx-2");

			const state = evo.serialize();
			const restored = SkillEvolution.deserialize(state);

			const health = restored.getSkillHealth("skill-a");
			// 2 unique contexts / 2 uses = 1.0
			expect(health.diversityScore).toBeCloseTo(1.0, 2);
		});
	});
});
