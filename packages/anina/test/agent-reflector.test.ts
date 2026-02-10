import { describe, it, expect, beforeEach } from "vitest";
import { AgentReflector } from "../src/agent-reflector.js";
import type { ReflectionResult, PeerReview } from "../src/agent-reflector.js";

describe("AgentReflector", () => {
	let reflector: AgentReflector;

	beforeEach(() => {
		reflector = new AgentReflector();
	});

	// ─── reflect() — basic scoring ─────────────────────────────────

	describe("reflect()", () => {
		it("should return a baseline score of 5 for minimal output", () => {
			// Output is short (< 20 chars), so -2 penalty, but > 0 after clamp
			const result = reflector.reflect("agent1", "do something", "ok done");
			expect(result.score).toBeLessThan(5);
			expect(result.agentId).toBe("agent1");
		});

		it("should boost score for substantive output (> 100 chars)", () => {
			const longOutput = "x".repeat(150);
			const result = reflector.reflect("agent1", "describe something", longOutput);
			// baseline 5 + 1 for length > 100
			// relevance may penalize since the output is just "x"s
			expect(result.strengths).toContain("substantive response");
		});

		it("should boost further for thorough output (> 2000 chars)", () => {
			const veryLong = "word ".repeat(500); // ~2500 chars
			const result = reflector.reflect("agent1", "write a long essay about word", veryLong);
			expect(result.strengths).toContain("thorough coverage");
		});

		it("should penalize very brief output (< 20 chars)", () => {
			const result = reflector.reflect("agent1", "explain React", "no");
			expect(result.weaknesses).toContain("very brief");
			expect(result.improvements).toContain("provide more detail");
		});

		it("should detect code in output", () => {
			const output = "Here is the solution:\n```js\nconst x = 1;\n```";
			const result = reflector.reflect("agent1", "write code", output);
			expect(result.strengths).toContain("includes code");
		});

		it("should detect structured output (headings, lists)", () => {
			const output = "# Introduction\n\n- Point one\n- Point two\n\nSome more text here to be substantive.";
			const result = reflector.reflect("agent1", "write a report with introduction", output);
			expect(result.strengths).toContain("well-structured");
		});

		it("should detect uncertainty in output", () => {
			const output = "I'm not sure about this, but maybe it could work. Adding more text to avoid brevity penalty here.";
			const result = reflector.reflect("agent1", "analyze the code", output);
			expect(result.weaknesses).toContain("expressed uncertainty");
			expect(result.confidence).toBeLessThan(0.5);
		});

		it("should reward task-relevant output based on keyword overlap", () => {
			const task = "implement binary search algorithm";
			const output = "Here is a binary search algorithm implementation that efficiently searches through a sorted array.";
			const result = reflector.reflect("agent1", task, output);
			expect(result.strengths).toContain("task-relevant");
		});

		it("should penalize off-topic output", () => {
			const task = "implement binary search algorithm";
			const output = "The weather today is sunny and warm, perfect for a picnic by the lake.";
			const result = reflector.reflect("agent1", task, output);
			expect(result.weaknesses).toContain("may be off-topic");
		});

		it("should clamp score between 0 and 10", () => {
			// Very brief + off-topic = heavy penalty
			const result = reflector.reflect("agent1", "complex quantum physics task", "x");
			expect(result.score).toBeGreaterThanOrEqual(0);
			expect(result.score).toBeLessThanOrEqual(10);
		});

		it("should clamp confidence between 0 and 1", () => {
			const result = reflector.reflect("agent1", "task", "I'm not sure maybe possibly unclear");
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});

		it("should store reflection in history", () => {
			reflector.reflect("agent1", "task", "some output that is long enough to be useful");
			const history = reflector.getHistory("agent1");
			expect(history).toHaveLength(1);
		});

		it("should enforce maxHistory ring buffer", () => {
			const small = new AgentReflector({ maxHistory: 3 });

			small.reflect("agent1", "t1", "output one that is adequately long enough");
			small.reflect("agent1", "t2", "output two that is also quite long enough");
			small.reflect("agent1", "t3", "output three some more text for length padding");
			small.reflect("agent1", "t4", "output four this one pushes out the first entry");

			const history = small.getHistory("agent1");
			expect(history).toHaveLength(3);
		});
	});

	// ─── submitPeerReview() ─────────────────────────────────────

	describe("submitPeerReview()", () => {
		it("should store a peer review for the target agent", () => {
			const review: PeerReview = {
				reviewerId: "reviewer-1",
				targetId: "target-1",
				score: 8,
				feedback: "Great work on the implementation",
				approved: true,
				timestamp: Date.now(),
			};

			reflector.submitPeerReview(review);
			const reviews = reflector.getPeerReviews("target-1");
			expect(reviews).toHaveLength(1);
			expect(reviews[0].reviewerId).toBe("reviewer-1");
			expect(reviews[0].score).toBe(8);
		});

		it("should accumulate multiple reviews for the same target", () => {
			const makeReview = (reviewerId: string, score: number): PeerReview => ({
				reviewerId,
				targetId: "target-1",
				score,
				feedback: "feedback",
				approved: score >= 6,
				timestamp: Date.now(),
			});

			reflector.submitPeerReview(makeReview("r1", 7));
			reflector.submitPeerReview(makeReview("r2", 9));
			reflector.submitPeerReview(makeReview("r3", 5));

			expect(reflector.getPeerReviews("target-1")).toHaveLength(3);
		});

		it("should enforce maxHistory on peer reviews", () => {
			const small = new AgentReflector({ maxHistory: 2 });

			for (let i = 0; i < 4; i++) {
				small.submitPeerReview({
					reviewerId: `r${i}`,
					targetId: "t1",
					score: i + 1,
					feedback: "fb",
					approved: true,
					timestamp: Date.now(),
				});
			}

			expect(small.getPeerReviews("t1")).toHaveLength(2);
		});
	});

	// ─── needsRevision() ────────────────────────────────────────

	describe("needsRevision()", () => {
		it("should return true when confidence is below threshold (default 0.7)", () => {
			const result: ReflectionResult = {
				agentId: "a1",
				score: 5,
				confidence: 0.5,
				strengths: [],
				weaknesses: [],
				improvements: [],
				timestamp: Date.now(),
			};

			expect(reflector.needsRevision(result)).toBe(true);
		});

		it("should return false when confidence meets the threshold", () => {
			const result: ReflectionResult = {
				agentId: "a1",
				score: 8,
				confidence: 0.8,
				strengths: [],
				weaknesses: [],
				improvements: [],
				timestamp: Date.now(),
			};

			expect(reflector.needsRevision(result)).toBe(false);
		});

		it("should respect custom confidence threshold", () => {
			const strict = new AgentReflector({ confidenceThreshold: 0.9 });

			const result: ReflectionResult = {
				agentId: "a1",
				score: 8,
				confidence: 0.85,
				strengths: [],
				weaknesses: [],
				improvements: [],
				timestamp: Date.now(),
			};

			expect(strict.needsRevision(result)).toBe(true);
		});
	});

	// ─── getAverageScore() ──────────────────────────────────────

	describe("getAverageScore()", () => {
		it("should return 0 when no history exists", () => {
			expect(reflector.getAverageScore("unknown")).toBe(0);
		});

		it("should compute the average across all reflections", () => {
			// Generate outputs that give predictable-ish scores
			reflector.reflect("agent1", "task", "x".repeat(150)); // substantive
			reflector.reflect("agent1", "task", "y".repeat(150)); // substantive

			const avg = reflector.getAverageScore("agent1");
			expect(avg).toBeGreaterThan(0);
		});
	});

	// ─── getAverageConfidence() ─────────────────────────────────

	describe("getAverageConfidence()", () => {
		it("should return 0.5 when no history exists", () => {
			expect(reflector.getAverageConfidence("unknown")).toBe(0.5);
		});

		it("should compute average confidence from history", () => {
			reflector.reflect("agent1", "task", "x".repeat(150));
			const avg = reflector.getAverageConfidence("agent1");
			expect(avg).toBeGreaterThanOrEqual(0);
			expect(avg).toBeLessThanOrEqual(1);
		});
	});

	// ─── getTrendingWeaknesses() ────────────────────────────────

	describe("getTrendingWeaknesses()", () => {
		it("should return empty array when no history exists", () => {
			expect(reflector.getTrendingWeaknesses("unknown")).toEqual([]);
		});

		it("should return the most frequent weaknesses sorted by count", () => {
			// Very brief outputs will get "very brief" weakness
			reflector.reflect("agent1", "complex task about quantum", "x");
			reflector.reflect("agent1", "complex task about quantum", "y");
			reflector.reflect("agent1", "complex task about quantum", "z");

			const trending = reflector.getTrendingWeaknesses("agent1");
			expect(trending.length).toBeGreaterThan(0);

			// "very brief" should be the most common weakness
			expect(trending[0].weakness).toBe("very brief");
			expect(trending[0].count).toBe(3);
		});

		it("should respect the topN limit", () => {
			// Create varied weaknesses
			reflector.reflect("agent1", "complex quantum physics", "no");
			reflector.reflect("agent1", "complex quantum physics", "maybe x");

			const trending = reflector.getTrendingWeaknesses("agent1", 1);
			expect(trending.length).toBeLessThanOrEqual(1);
		});

		it("should aggregate across multiple reflections", () => {
			// Off-topic outputs
			reflector.reflect("agent1", "binary search", "weather is nice and warm today, perfect for a walk");
			reflector.reflect("agent1", "binary search", "the movie was great and entertaining, loved it all");

			const trending = reflector.getTrendingWeaknesses("agent1");
			const weaknessNames = trending.map((t) => t.weakness);
			expect(weaknessNames).toContain("may be off-topic");
		});
	});

	// ─── getHistory / getPeerReviews for unknown agents ─────────

	describe("edge cases", () => {
		it("should return empty history for unknown agent", () => {
			expect(reflector.getHistory("nonexistent")).toEqual([]);
		});

		it("should return empty peer reviews for unknown agent", () => {
			expect(reflector.getPeerReviews("nonexistent")).toEqual([]);
		});
	});
});
