import { describe, it, expect } from "vitest";
import {
	AdaptiveScorer,
	mmrRerank,
} from "../src/graphrag-adaptive-scoring.js";
import type {
	ScoredCandidate,
	AdaptiveScorerState,
} from "../src/graphrag-adaptive-scoring.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCandidates(): Omit<ScoredCandidate, "finalScore">[] {
	return [
		{ id: "node-memory-types", cosineScore: 0.9, pagerankScore: 0.3, textScore: 0.2 },
		{ id: "node-session-store", cosineScore: 0.4, pagerankScore: 0.8, textScore: 0.3 },
		{ id: "node-graphrag-engine", cosineScore: 0.3, pagerankScore: 0.2, textScore: 0.9 },
		{ id: "node-config-loader", cosineScore: 0.5, pagerankScore: 0.5, textScore: 0.5 },
		{ id: "node-event-bus", cosineScore: 0.1, pagerankScore: 0.6, textScore: 0.1 },
	];
}

// ─── Initial weights (fixed fallback) ───────────────────────────────────────

describe("AdaptiveScorer — initial weights", () => {
	it("uses fixed fallback weights before sufficient feedback", () => {
		const scorer = new AdaptiveScorer();
		const weights = scorer.getWeights();

		// Initial Beta posteriors: cosine(2,1), pagerank(1.5,1), text(1.2,1)
		// E[Beta(a,b)] = a/(a+b)
		// cosine = 2/3 ≈ 0.667, pagerank = 1.5/2.5 = 0.6, text = 1.2/2.2 ≈ 0.545
		// These get normalized. But scoring still uses FIXED_WEIGHTS until 10 feedback.
		expect(weights.cosine + weights.pagerank + weights.textmatch).toBeCloseTo(1.0, 5);
	});

	it("scores candidates using fixed weights (cosine=0.6, pagerank=0.25, text=0.15)", () => {
		const scorer = new AdaptiveScorer();
		const scored = scorer.score("q1", makeCandidates());

		// With fixed weights, the cosine-dominant candidate should rank highest
		// node-memory-types: 0.6*0.9 + 0.25*0.3 + 0.15*0.2 = 0.54 + 0.075 + 0.03 = 0.645
		// node-config-loader: 0.6*0.5 + 0.25*0.5 + 0.15*0.5 = 0.3 + 0.125 + 0.075 = 0.5
		expect(scored[0].id).toBe("node-memory-types");
		expect(scored[0].finalScore).toBeCloseTo(0.645, 2);
		// All scores should be sorted descending
		for (let i = 1; i < scored.length; i++) {
			expect(scored[i].finalScore).toBeLessThanOrEqual(scored[i - 1].finalScore);
		}
	});
});

// ─── Thompson Sampling weight adaptation ────────────────────────────────────

describe("AdaptiveScorer — Thompson Sampling", () => {
	it("weights shift toward successful signals after feedback", () => {
		const scorer = new AdaptiveScorer(1000 * 60 * 60 * 24 * 365); // 1 year half-life
		const candidates = makeCandidates();

		// Give 15 rounds of feedback all accepting the cosine-dominant result
		for (let i = 0; i < 15; i++) {
			const qid = `feedback-round-${i}`;
			scorer.score(qid, candidates);
			scorer.recordFeedback(qid, true); // always accept
		}

		const weights = scorer.getWeights();
		// After accepting cosine-dominant results, cosine weight should be highest
		expect(weights.cosine).toBeGreaterThan(weights.pagerank);
		expect(weights.cosine).toBeGreaterThan(weights.textmatch);
	});

	it("rejecting results penalizes the dominant component", () => {
		const scorer = new AdaptiveScorer(1000 * 60 * 60 * 24 * 365);
		const candidates = makeCandidates();

		// Reject cosine-dominant results repeatedly
		for (let i = 0; i < 15; i++) {
			const qid = `reject-round-${i}`;
			scorer.score(qid, candidates);
			scorer.recordFeedback(qid, false); // reject
		}

		const weights = scorer.getWeights();
		// After rejecting cosine-dominant results, cosine weight should decrease
		// relative to its initial advantage
		// The initial cosine alpha is 2, beta is 1 — after rejection it should be lower
		const initialCosineWeight = (2 / 3) / ((2 / 3) + (1.5 / 2.5) + (1.2 / 2.2));
		expect(weights.cosine).toBeLessThan(initialCosineWeight);
	});
});

// ─── Temporal decay ─────────────────────────────────────────────────────────

describe("AdaptiveScorer — temporal decay", () => {
	it("recent feedback has more influence than old feedback", () => {
		// Use a very short half-life (1 ms) to simulate old feedback
		const scorer = new AdaptiveScorer(1); // 1 ms half-life
		const candidates = makeCandidates();

		// Add old feedback (by the time we check, it will have decayed)
		for (let i = 0; i < 12; i++) {
			const qid = `old-${i}`;
			scorer.score(qid, candidates);
			scorer.recordFeedback(qid, true);
		}

		// After temporal decay with 1ms half-life, the feedback should be heavily decayed
		// The weights should be closer to priors (1,1,1) than to strongly cosine-biased
		const weights = scorer.getWeights();
		// With extreme decay, all weights converge toward equal (1/(1+1) = 0.5 each, normalized)
		const maxDiff = Math.abs(weights.cosine - weights.pagerank);
		expect(maxDiff).toBeLessThan(0.4);
	});
});

// ─── MMR diversity re-ranking ───────────────────────────────────────────────

describe("mmrRerank", () => {
	it("returns empty array for empty input", () => {
		expect(mmrRerank([], 0.7, 5)).toEqual([]);
	});

	it("returns single element for single candidate", () => {
		const candidates: ScoredCandidate[] = [
			{ id: "only", cosineScore: 0.8, pagerankScore: 0.5, textScore: 0.3, finalScore: 0.7 },
		];
		const result = mmrRerank(candidates, 0.7, 5);
		expect(result.length).toBe(1);
		expect(result[0].id).toBe("only");
	});

	it("re-ranked results are more diverse than original ordering", () => {
		// Create candidates with similar score vectors (low diversity in original ranking)
		const candidates: ScoredCandidate[] = [
			{ id: "a", cosineScore: 0.9, pagerankScore: 0.1, textScore: 0.1, finalScore: 0.56, embedding: [1, 0, 0] },
			{ id: "b", cosineScore: 0.88, pagerankScore: 0.12, textScore: 0.1, finalScore: 0.55, embedding: [0.99, 0.01, 0] },
			{ id: "c", cosineScore: 0.3, pagerankScore: 0.7, textScore: 0.8, finalScore: 0.53, embedding: [0, 1, 0] },
			{ id: "d", cosineScore: 0.85, pagerankScore: 0.15, textScore: 0.1, finalScore: 0.54, embedding: [0.98, 0.02, 0] },
		];

		// Pure diversity (lambda = 0.3) should push dissimilar candidates up
		const diverseResults = mmrRerank(candidates, 0.3, 4);

		// 'a' should still be first (highest score, no penalty)
		expect(diverseResults[0].id).toBe("a");

		// 'c' should be promoted over 'b' or 'd' due to diversity
		// because 'c' has a very different embedding from 'a'
		const cIndex = diverseResults.findIndex((r) => r.id === "c");
		expect(cIndex).toBeLessThan(3); // should appear in top 3 due to diversity
	});

	it("lambda=1.0 gives pure relevance ranking (same as original)", () => {
		const candidates: ScoredCandidate[] = [
			{ id: "high", cosineScore: 0.9, pagerankScore: 0.9, textScore: 0.9, finalScore: 0.9 },
			{ id: "mid", cosineScore: 0.5, pagerankScore: 0.5, textScore: 0.5, finalScore: 0.5 },
			{ id: "low", cosineScore: 0.1, pagerankScore: 0.1, textScore: 0.1, finalScore: 0.1 },
		];
		const result = mmrRerank(candidates, 1.0, 3);
		expect(result[0].id).toBe("high");
		expect(result[1].id).toBe("mid");
		expect(result[2].id).toBe("low");
	});

	it("respects topK limit", () => {
		const candidates: ScoredCandidate[] = Array.from({ length: 20 }, (_, i) => ({
			id: `candidate-${i}`,
			cosineScore: Math.random(),
			pagerankScore: Math.random(),
			textScore: Math.random(),
			finalScore: Math.random(),
		}));
		const result = mmrRerank(candidates, 0.7, 5);
		expect(result.length).toBe(5);
	});
});

// ─── Serialize / deserialize round-trip ─────────────────────────────────────

describe("AdaptiveScorer — serialization", () => {
	it("state survives serialize/deserialize round-trip", () => {
		const scorer = new AdaptiveScorer(7 * 24 * 60 * 60 * 1000);
		const candidates = makeCandidates();

		// Add some feedback to build state
		for (let i = 0; i < 5; i++) {
			const qid = `serial-${i}`;
			scorer.score(qid, candidates);
			scorer.recordFeedback(qid, i % 2 === 0); // alternate accept/reject
		}

		const serialized = scorer.serialize();
		const restored = new AdaptiveScorer();
		restored.deserialize(serialized);

		const restoredState = restored.serialize();
		expect(restoredState.cosineAlpha).toBeCloseTo(serialized.cosineAlpha, 10);
		expect(restoredState.cosineBeta).toBeCloseTo(serialized.cosineBeta, 10);
		expect(restoredState.pagerankAlpha).toBeCloseTo(serialized.pagerankAlpha, 10);
		expect(restoredState.pagerankBeta).toBeCloseTo(serialized.pagerankBeta, 10);
		expect(restoredState.textAlpha).toBeCloseTo(serialized.textAlpha, 10);
		expect(restoredState.textBeta).toBeCloseTo(serialized.textBeta, 10);
		expect(restoredState.totalFeedback).toBe(serialized.totalFeedback);
		expect(restoredState.feedbackHistory.length).toBe(serialized.feedbackHistory.length);
	});
});

// ─── Score range ────────────────────────────────────────────────────────────

describe("AdaptiveScorer — score range", () => {
	it("all final scores are in [0, 1] given component scores in [0, 1]", () => {
		const scorer = new AdaptiveScorer();
		const candidates: Omit<ScoredCandidate, "finalScore">[] = [
			{ id: "zero", cosineScore: 0, pagerankScore: 0, textScore: 0 },
			{ id: "one", cosineScore: 1, pagerankScore: 1, textScore: 1 },
			{ id: "mixed", cosineScore: 0.3, pagerankScore: 0.7, textScore: 0.5 },
		];
		const scored = scorer.score("range-check", candidates);
		for (const s of scored) {
			expect(s.finalScore).toBeGreaterThanOrEqual(0);
			expect(s.finalScore).toBeLessThanOrEqual(1);
		}
	});
});
