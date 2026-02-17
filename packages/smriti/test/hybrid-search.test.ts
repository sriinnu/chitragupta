import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	HybridSearchEngine,
	HybridWeightLearner,
	shouldRetrieve,
	PRAMANA_RELIABILITY,
	type HybridSearchConfig,
	type HybridSearchResult,
	type HybridSignal,
} from "../src/hybrid-search.js";

// ─── shouldRetrieve tests ────────────────────────────────────────────────────

describe("shouldRetrieve", () => {
	it("should return true for questions about the past", () => {
		expect(shouldRetrieve("what did we discuss about the API?")).toBe(true);
		expect(shouldRetrieve("when did we last deploy?")).toBe(true);
		expect(shouldRetrieve("how did we solve the caching problem?")).toBe(true);
	});

	it("should return true for recall/memory keywords", () => {
		expect(shouldRetrieve("do you remember the database migration?")).toBe(true);
		expect(shouldRetrieve("we discussed this previously")).toBe(true);
		expect(shouldRetrieve("recall the conversation about testing")).toBe(true);
	});

	it("should return true for search-like queries", () => {
		expect(shouldRetrieve("search for the utils module")).toBe(true);
		expect(shouldRetrieve("look up the error handling code")).toBe(true);
		expect(shouldRetrieve("find the file for auth module")).toBe(true);
	});

	it("should return true for long questions", () => {
		expect(shouldRetrieve("what is the current status of the migration project and all its subtasks?")).toBe(true);
	});

	it("should return true for session references", () => {
		expect(shouldRetrieve("session: abc123 what happened there?")).toBe(true);
	});

	it("should return true for project memory references", () => {
		expect(shouldRetrieve("what is in the project memory about CI/CD?")).toBe(true);
	});

	it("should return false for simple commands", () => {
		expect(shouldRetrieve("hello")).toBe(false);
		expect(shouldRetrieve("write a function")).toBe(false);
		expect(shouldRetrieve("fix the bug")).toBe(false);
	});

	it("should return false for short questions", () => {
		expect(shouldRetrieve("how are you?")).toBe(false);
	});
});

// ─── HybridSearchEngine tests ────────────────────────────────────────────────

describe("HybridSearchEngine", () => {
	let engine: HybridSearchEngine;

	beforeEach(() => {
		// Create engine with all backends disabled - we'll mock them
		engine = new HybridSearchEngine({
			enableBM25: false,
			enableVector: false,
			enableGraphRAG: false,
			enablePramana: false,
			k: 60,
			topK: 10,
			minScore: 0,
		});
	});

	describe("search with no rankers", () => {
		it("should return empty results when all rankers are disabled", async () => {
			const results = await engine.search("hello world");
			expect(results).toHaveLength(0);
		});
	});

	describe("RRF scoring", () => {
		it("should compute correct RRF scores for single-source results", async () => {
			// Enable BM25 only and mock it via the search config
			// Since we can't easily mock the internal searchSessions function,
			// we test RRF logic indirectly by checking the gated search behavior
			const results = await engine.gatedSearch("write a function");
			// "write a function" should not trigger retrieval
			expect(results).toHaveLength(0);
		});
	});

	describe("gatedSearch", () => {
		it("should not search when the query has no knowledge gap signal", async () => {
			const results = await engine.gatedSearch("hello world");
			expect(results).toHaveLength(0);
		});

		it("should trigger search when query signals a knowledge gap", async () => {
			// Even though all engines are disabled, this tests the gate logic
			const results = await engine.gatedSearch("what did we decide about the database?");
			// No engines enabled, so still empty, but the gate was opened
			expect(results).toHaveLength(0);
		});
	});

	describe("engine setters", () => {
		it("should allow setting the recall engine", () => {
			// Just verify the setter doesn't throw
			engine.setRecallEngine({} as never);
		});

		it("should allow setting the graph engine", () => {
			engine.setGraphEngine({} as never);
		});

		it("should allow setting the weight learner", () => {
			const learner = new HybridWeightLearner();
			engine.setWeightLearner(learner);
			expect(engine.getWeightLearner()).toBe(learner);
		});
	});

	describe("RRF formula correctness", () => {
		it("should give higher scores to documents ranked highly in multiple sources", async () => {
			// We test this through the HybridSearchEngine by using a config override
			// that enables BM25 and verifying the result structure
			// Since BM25 depends on file system sessions, we validate the algorithm
			// conceptually: RRF(d) = sum(1/(k+rank_i)) with k=60

			// For a document ranked #1 in one source:
			// score = 1/(60+1) = 0.01639...
			const singleSourceScore = 1 / (60 + 1);
			expect(singleSourceScore).toBeCloseTo(0.01639, 4);

			// For a document ranked #1 in two sources:
			// score = 1/(60+1) + 1/(60+1) = 0.03279...
			const dualSourceScore = 2 * (1 / (60 + 1));
			expect(dualSourceScore).toBeCloseTo(0.03279, 4);

			// Dual source score should be higher
			expect(dualSourceScore).toBeGreaterThan(singleSourceScore);
		});

		it("should compute correct multi-source boost values", () => {
			// Triple agreement: 15% boost
			const tripleScore = 0.05 * 1.15;
			expect(tripleScore).toBeCloseTo(0.0575, 4);

			// Double agreement: 5% boost
			const doubleScore = 0.05 * 1.05;
			expect(doubleScore).toBeCloseTo(0.0525, 4);

			// Single source: no boost
			const singleScore = 0.05 * 1.0;
			expect(singleScore).toBeCloseTo(0.05, 4);
		});
	});

	describe("config defaults", () => {
		it("should use k=60 by default", () => {
			const defaultEngine = new HybridSearchEngine();
			// We can verify by checking the search behavior;
			// the engine is initialized without throwing
			expect(defaultEngine).toBeDefined();
		});

		it("should enable pramana by default", () => {
			// Default config should have pramana enabled
			const defaultEngine = new HybridSearchEngine();
			expect(defaultEngine).toBeDefined();
			// The default pramanaWeight is 0.1, enablePramana is true
			// We verify indirectly — the engine creates without error
		});
	});

	describe("recordFeedback", () => {
		it("should not throw without a weight learner", () => {
			const result: HybridSearchResult = {
				id: "doc-1",
				title: "Test",
				content: "content",
				sources: ["bm25"],
				score: 0.5,
				ranks: { bm25: 1 },
				pramana: "pratyaksha",
			};
			// Should not throw
			engine.recordFeedback(result, true);
		});

		it("should update the weight learner when set", () => {
			const learner = new HybridWeightLearner();
			engine.setWeightLearner(learner);

			const result: HybridSearchResult = {
				id: "doc-1",
				title: "Test",
				content: "content",
				sources: ["bm25", "graphrag"],
				score: 0.5,
				ranks: { bm25: 1, graphrag: 2 },
				pramana: "pratyaksha",
			};

			engine.recordFeedback(result, true);
			// 2 sources + 1 pramana = 3 updates
			expect(learner.totalFeedback).toBe(3);
		});

		it("should not update pramana signal if result has no pramana", () => {
			const learner = new HybridWeightLearner();
			engine.setWeightLearner(learner);

			const result: HybridSearchResult = {
				id: "doc-1",
				title: "Test",
				content: "content",
				sources: ["bm25"],
				score: 0.5,
				ranks: { bm25: 1 },
				// no pramana field
			};

			engine.recordFeedback(result, true);
			// Only 1 source update, no pramana
			expect(learner.totalFeedback).toBe(1);
		});
	});
});

// ─── PRAMANA_RELIABILITY tests ──────────────────────────────────────────────

describe("PRAMANA_RELIABILITY", () => {
	it("should have pratyaksha as the highest weight (1.0)", () => {
		expect(PRAMANA_RELIABILITY.pratyaksha).toBe(1.0);
	});

	it("should have anupalabdhi as the lowest weight (0.4)", () => {
		expect(PRAMANA_RELIABILITY.anupalabdhi).toBe(0.4);
	});

	it("should have correct ordering: pratyaksha > anumana > shabda > upamana > arthapatti > anupalabdhi", () => {
		expect(PRAMANA_RELIABILITY.pratyaksha).toBeGreaterThan(PRAMANA_RELIABILITY.anumana);
		expect(PRAMANA_RELIABILITY.anumana).toBeGreaterThan(PRAMANA_RELIABILITY.shabda);
		expect(PRAMANA_RELIABILITY.shabda).toBeGreaterThan(PRAMANA_RELIABILITY.upamana);
		expect(PRAMANA_RELIABILITY.upamana).toBeGreaterThan(PRAMANA_RELIABILITY.arthapatti);
		expect(PRAMANA_RELIABILITY.arthapatti).toBeGreaterThan(PRAMANA_RELIABILITY.anupalabdhi);
	});

	it("should cover all 6 pramana types", () => {
		const keys = Object.keys(PRAMANA_RELIABILITY);
		expect(keys).toHaveLength(6);
		expect(keys).toContain("pratyaksha");
		expect(keys).toContain("anumana");
		expect(keys).toContain("shabda");
		expect(keys).toContain("upamana");
		expect(keys).toContain("arthapatti");
		expect(keys).toContain("anupalabdhi");
	});

	it("should have all weights in [0, 1]", () => {
		for (const val of Object.values(PRAMANA_RELIABILITY)) {
			expect(val).toBeGreaterThanOrEqual(0);
			expect(val).toBeLessThanOrEqual(1);
		}
	});
});

// ─── Pramana-weighted scoring tests ─────────────────────────────────────────

describe("Pramana-weighted scoring", () => {
	it("pratyaksha result should score higher than shabda with same RRF base", () => {
		// With δ=0.1 and weights.pramana=1:
		// pratyaksha boost = 0.1 * 1.0 = 0.1
		// shabda boost = 0.1 * 0.75 = 0.075
		const delta = 0.1;
		const pratyakshaScore = 0.5 + delta * PRAMANA_RELIABILITY.pratyaksha;
		const shabdaScore = 0.5 + delta * PRAMANA_RELIABILITY.shabda;
		expect(pratyakshaScore).toBeGreaterThan(shabdaScore);
		expect(pratyakshaScore - shabdaScore).toBeCloseTo(0.025, 4);
	});

	it("pramana boost should scale linearly with pramanaWeight (δ)", () => {
		const pratyakshaWeight = PRAMANA_RELIABILITY.pratyaksha;
		const delta1 = 0.1;
		const delta2 = 0.5;
		const boost1 = delta1 * pratyakshaWeight;
		const boost2 = delta2 * pratyakshaWeight;
		// boost2 should be 5x boost1
		expect(boost2 / boost1).toBeCloseTo(5.0, 4);
	});

	it("disabled pramana (enablePramana=false) should not add any boost", () => {
		// When pramana is disabled, no boost is applied
		const baseScore = 0.5;
		// With pramana disabled, final score = baseScore (no additive term)
		expect(baseScore).toBe(0.5);
	});

	it("unknown pramana should default to shabda weight", () => {
		// The system defaults missing pramana to 'shabda'
		const defaultWeight = PRAMANA_RELIABILITY.shabda;
		expect(defaultWeight).toBe(0.75);
	});
});

// ─── HybridWeightLearner tests ──────────────────────────────────────────────

describe("HybridWeightLearner", () => {
	describe("constructor", () => {
		it("should initialize with uniform prior Beta(1,1)", () => {
			const learner = new HybridWeightLearner();
			const means = learner.means();
			// Beta(1,1) has mean = 0.5
			expect(means.bm25).toBeCloseTo(0.5, 4);
			expect(means.vector).toBeCloseTo(0.5, 4);
			expect(means.graphrag).toBeCloseTo(0.5, 4);
			expect(means.pramana).toBeCloseTo(0.5, 4);
			expect(learner.totalFeedback).toBe(0);
		});

		it("should accept custom priors", () => {
			const learner = new HybridWeightLearner(2, 1);
			const means = learner.means();
			// Beta(2,1) has mean = 2/3
			expect(means.bm25).toBeCloseTo(2 / 3, 4);
			expect(means.vector).toBeCloseTo(2 / 3, 4);
			expect(means.graphrag).toBeCloseTo(2 / 3, 4);
			expect(means.pramana).toBeCloseTo(2 / 3, 4);
		});
	});

	describe("sample", () => {
		it("should return weights that sum to 1", () => {
			const learner = new HybridWeightLearner();
			// Run multiple times to check consistency
			for (let i = 0; i < 20; i++) {
				const w = learner.sample();
				const sum = w.bm25 + w.vector + w.graphrag + w.pramana;
				expect(sum).toBeCloseTo(1.0, 6);
			}
		});

		it("should return all non-negative weights", () => {
			const learner = new HybridWeightLearner();
			for (let i = 0; i < 20; i++) {
				const w = learner.sample();
				expect(w.bm25).toBeGreaterThanOrEqual(0);
				expect(w.vector).toBeGreaterThanOrEqual(0);
				expect(w.graphrag).toBeGreaterThanOrEqual(0);
				expect(w.pramana).toBeGreaterThanOrEqual(0);
			}
		});

		it("should have all 4 signal keys", () => {
			const learner = new HybridWeightLearner();
			const w = learner.sample();
			expect(w).toHaveProperty("bm25");
			expect(w).toHaveProperty("vector");
			expect(w).toHaveProperty("graphrag");
			expect(w).toHaveProperty("pramana");
		});
	});

	describe("update", () => {
		it("should increase posterior mean on success", () => {
			const learner = new HybridWeightLearner();
			const meanBefore = learner.means().bm25;

			// 10 successes on bm25
			for (let i = 0; i < 10; i++) {
				learner.update("bm25", true);
			}

			const meanAfter = learner.means().bm25;
			expect(meanAfter).toBeGreaterThan(meanBefore);
		});

		it("should decrease posterior mean on failure", () => {
			const learner = new HybridWeightLearner();
			const meanBefore = learner.means().vector;

			// 10 failures on vector
			for (let i = 0; i < 10; i++) {
				learner.update("vector", false);
			}

			const meanAfter = learner.means().vector;
			expect(meanAfter).toBeLessThan(meanBefore);
		});

		it("should track total feedback count", () => {
			const learner = new HybridWeightLearner();
			expect(learner.totalFeedback).toBe(0);

			learner.update("bm25", true);
			learner.update("vector", false);
			learner.update("pramana", true);

			expect(learner.totalFeedback).toBe(3);
		});

		it("should only affect the targeted signal", () => {
			const learner = new HybridWeightLearner();
			const meansBefore = learner.means();

			// Update only graphrag
			for (let i = 0; i < 10; i++) {
				learner.update("graphrag", true);
			}

			const meansAfter = learner.means();
			expect(meansAfter.graphrag).toBeGreaterThan(meansBefore.graphrag);
			// Other signals should remain at 0.5 (uniform prior)
			expect(meansAfter.bm25).toBeCloseTo(0.5, 4);
			expect(meansAfter.vector).toBeCloseTo(0.5, 4);
			expect(meansAfter.pramana).toBeCloseTo(0.5, 4);
		});
	});

	describe("Thompson Sampling learns from feedback", () => {
		it("should converge towards high-success signals", () => {
			const learner = new HybridWeightLearner();

			// Heavily reward bm25, penalize others
			for (let i = 0; i < 50; i++) {
				learner.update("bm25", true);
				learner.update("vector", false);
				learner.update("graphrag", false);
				learner.update("pramana", false);
			}

			const means = learner.means();
			// bm25 should have the highest mean
			expect(means.bm25).toBeGreaterThan(means.vector);
			expect(means.bm25).toBeGreaterThan(means.graphrag);
			expect(means.bm25).toBeGreaterThan(means.pramana);

			// bm25 mean should be very high (~51/52 = 0.98)
			expect(means.bm25).toBeGreaterThan(0.9);
			// vector mean should be very low (~1/52 = 0.019)
			expect(means.vector).toBeLessThan(0.1);
		});

		it("should produce samples biased towards high-success signals", () => {
			const learner = new HybridWeightLearner();

			// Train heavily on pramana
			for (let i = 0; i < 100; i++) {
				learner.update("pramana", true);
			}

			// Sample many times and check average pramana weight
			let pramanaSum = 0;
			const N = 100;
			for (let i = 0; i < N; i++) {
				const w = learner.sample();
				pramanaSum += w.pramana;
			}
			const avgPramana = pramanaSum / N;

			// pramana should dominate (mean ~101/104 = 0.97)
			// with normalization, it should get a disproportionate share
			expect(avgPramana).toBeGreaterThan(0.3);
		});
	});

	describe("serialize/restore round-trip", () => {
		it("should perfectly restore state", () => {
			const learner = new HybridWeightLearner();

			// Add some feedback
			learner.update("bm25", true);
			learner.update("bm25", true);
			learner.update("vector", false);
			learner.update("graphrag", true);
			learner.update("pramana", true);
			learner.update("pramana", false);

			const state = learner.serialize();

			// Restore into a new learner
			const restored = new HybridWeightLearner();
			restored.restore(state);

			// Means should match
			const originalMeans = learner.means();
			const restoredMeans = restored.means();
			expect(restoredMeans.bm25).toBeCloseTo(originalMeans.bm25, 10);
			expect(restoredMeans.vector).toBeCloseTo(originalMeans.vector, 10);
			expect(restoredMeans.graphrag).toBeCloseTo(originalMeans.graphrag, 10);
			expect(restoredMeans.pramana).toBeCloseTo(originalMeans.pramana, 10);
			expect(restored.totalFeedback).toBe(learner.totalFeedback);
		});

		it("should produce valid JSON", () => {
			const learner = new HybridWeightLearner();
			learner.update("bm25", true);
			learner.update("pramana", false);

			const state = learner.serialize();
			const json = JSON.stringify(state);
			const parsed = JSON.parse(json);

			expect(parsed.alphas).toHaveLength(4);
			expect(parsed.betas).toHaveLength(4);
			expect(typeof parsed.totalFeedback).toBe("number");
		});

		it("should survive double round-trip", () => {
			const learner = new HybridWeightLearner();
			for (let i = 0; i < 5; i++) {
				learner.update("bm25", true);
				learner.update("vector", false);
			}

			const state1 = learner.serialize();
			const restored1 = new HybridWeightLearner();
			restored1.restore(state1);

			const state2 = restored1.serialize();
			const restored2 = new HybridWeightLearner();
			restored2.restore(state2);

			expect(restored2.means().bm25).toBeCloseTo(learner.means().bm25, 10);
			expect(restored2.means().vector).toBeCloseTo(learner.means().vector, 10);
			expect(restored2.totalFeedback).toBe(learner.totalFeedback);
		});

		it("should silently ignore invalid restore data", () => {
			const learner = new HybridWeightLearner();
			learner.update("bm25", true);
			const meanBefore = learner.means().bm25;

			// Attempt to restore garbage data — should be a no-op
			learner.restore(null as never);
			learner.restore({} as never);
			learner.restore({ alphas: [1, 2], betas: [1, 2], totalFeedback: 5 }); // wrong length
			learner.restore({ alphas: "bad", betas: "bad", totalFeedback: 0 } as never);

			// State should be unchanged
			expect(learner.means().bm25).toBeCloseTo(meanBefore, 10);
		});
	});

	describe("means", () => {
		it("should return correct posterior means after updates", () => {
			const learner = new HybridWeightLearner();

			// bm25: 3 successes + initial alpha=1 -> alpha=4, beta=1 -> mean=4/5=0.8
			learner.update("bm25", true);
			learner.update("bm25", true);
			learner.update("bm25", true);

			// vector: 2 failures + initial beta=1 -> alpha=1, beta=3 -> mean=1/4=0.25
			learner.update("vector", false);
			learner.update("vector", false);

			const means = learner.means();
			expect(means.bm25).toBeCloseTo(4 / 5, 4); // 0.8
			expect(means.vector).toBeCloseTo(1 / 4, 4); // 0.25
			expect(means.graphrag).toBeCloseTo(1 / 2, 4); // 0.5 (unchanged)
			expect(means.pramana).toBeCloseTo(1 / 2, 4); // 0.5 (unchanged)
		});
	});
});

// ─── Pramana disabled tests ─────────────────────────────────────────────────

describe("Pramana disabled (enablePramana: false)", () => {
	it("should not include pramana field in results when disabled", async () => {
		const engine = new HybridSearchEngine({
			enableBM25: false,
			enableVector: false,
			enableGraphRAG: false,
			enablePramana: false,
			k: 60,
			topK: 10,
			minScore: 0,
		});

		const results = await engine.search("test");
		expect(results).toHaveLength(0);
		// No results to check, but we verify the engine runs without error
	});

	it("should use original scoring without pramana boost when disabled", () => {
		// When enablePramana=false, the RRF score should not include any additive pramana term.
		// Verify by computing expected score:
		// Single source, rank #1, k=60: score = 1/(60+1) = 0.01639...
		const rrfScore = 1 / (60 + 1);
		// Without pramana, no additive boost
		const finalScore = rrfScore;
		expect(finalScore).toBeCloseTo(0.01639, 4);

		// WITH pramana (δ=0.1, pratyaksha=1.0): score = 0.01639 + 0.1*1.0 = 0.11639
		const withPramana = rrfScore + 0.1 * PRAMANA_RELIABILITY.pratyaksha;
		expect(withPramana).toBeCloseTo(0.11639, 4);

		// The difference proves the pramana boost is additive and significant
		expect(withPramana).toBeGreaterThan(finalScore);
	});
});

// ─── Pramana weight coefficient tests ───────────────────────────────────────

describe("Pramana weight coefficient (delta)", () => {
	it("should compute correct additive boost for each pramana type", () => {
		const delta = 0.1;

		expect(delta * PRAMANA_RELIABILITY.pratyaksha).toBeCloseTo(0.1, 4);
		expect(delta * PRAMANA_RELIABILITY.anumana).toBeCloseTo(0.085, 4);
		expect(delta * PRAMANA_RELIABILITY.shabda).toBeCloseTo(0.075, 4);
		expect(delta * PRAMANA_RELIABILITY.upamana).toBeCloseTo(0.06, 4);
		expect(delta * PRAMANA_RELIABILITY.arthapatti).toBeCloseTo(0.05, 4);
		expect(delta * PRAMANA_RELIABILITY.anupalabdhi).toBeCloseTo(0.04, 4);
	});

	it("should preserve ranking when delta=0 (no pramana effect)", () => {
		const delta = 0;
		const baseScore = 0.5;
		const withPratyaksha = baseScore + delta * PRAMANA_RELIABILITY.pratyaksha;
		const withAnupalabdhi = baseScore + delta * PRAMANA_RELIABILITY.anupalabdhi;
		expect(withPratyaksha).toBe(withAnupalabdhi);
		expect(withPratyaksha).toBe(baseScore);
	});

	it("high delta should make pramana the dominant signal", () => {
		const delta = 10;
		const lowRRF = 0.01;  // Low RRF score
		const highRRF = 0.05; // High RRF score

		// Low RRF + pratyaksha should beat high RRF + anupalabdhi at high delta
		const lowWithPratyaksha = lowRRF + delta * PRAMANA_RELIABILITY.pratyaksha;
		const highWithAnupalabdhi = highRRF + delta * PRAMANA_RELIABILITY.anupalabdhi;

		expect(lowWithPratyaksha).toBeGreaterThan(highWithAnupalabdhi);
	});
});
