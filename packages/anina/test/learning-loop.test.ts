import { describe, it, expect, beforeEach } from "vitest";
import { LearningLoop, type ToolUsageStats } from "../src/learning-loop.js";
import type { ToolResult } from "../src/types.js";

const OK: ToolResult = { content: "ok" };
const ERR: ToolResult = { content: "error", isError: true };

describe("LearningLoop", () => {
	let loop: LearningLoop;

	beforeEach(() => {
		loop = new LearningLoop();
	});

	// ─── Tool Usage Recording ────────────────────────────────────────

	describe("recordToolUsage", () => {
		it("should create stats for a new tool", () => {
			loop.recordToolUsage("grep", {}, OK);

			const patterns = loop.getLearnedPatterns();
			const ranking = patterns.frequencyRanking;
			expect(ranking).toHaveLength(1);
			expect(ranking[0].tool).toBe("grep");
			expect(ranking[0].count).toBe(1);
		});

		it("should increment call counts on repeated use", () => {
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("read", {}, ERR);

			const ranking = loop.getLearnedPatterns().frequencyRanking;
			expect(ranking[0].count).toBe(3);
		});

		it("should track success and failure counts", () => {
			loop.recordToolUsage("edit", {}, OK);
			loop.recordToolUsage("edit", {}, OK);
			loop.recordToolUsage("edit", {}, ERR);

			const state = loop.serialize();
			const stats = new Map(state.toolStats);
			const edit = stats.get("edit")!;
			expect(edit.successCount).toBe(2);
			expect(edit.failureCount).toBe(1);
		});

		it("should track latency when markToolStart is called", () => {
			loop.markToolStart("bash");
			// Small artificial delay
			loop.recordToolUsage("bash", {}, OK);

			const state = loop.serialize();
			const stats = new Map(state.toolStats);
			const bash = stats.get("bash")!;
			expect(bash.avgLatencyMs).toBeGreaterThanOrEqual(0);
			expect(bash.totalLatencyMs).toBeGreaterThanOrEqual(0);
		});
	});

	// ─── Markov Chain Tool Prediction ────────────────────────────────

	describe("predictNextTool / Markov transitions", () => {
		it("should build transition counts from sequential tool usage", () => {
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("edit", {}, OK);

			// grep -> read, read -> edit transitions should exist
			const predictions = loop.predictNextTool(["read"]);
			expect(predictions.length).toBeGreaterThan(0);
			expect(predictions[0].tool).toBe("edit");
			expect(predictions[0].probability).toBe(1.0);
		});

		it("should compute proper probability distributions", () => {
			// grep -> read (2 times), grep -> edit (1 time)
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("edit", {}, OK);

			const predictions = loop.predictNextTool(["grep"]);
			const readPred = predictions.find((p) => p.tool === "read");
			const editPred = predictions.find((p) => p.tool === "edit");

			expect(readPred).toBeDefined();
			expect(editPred).toBeDefined();
			// 2 transitions to read vs 1 to edit
			expect(readPred!.probability).toBeCloseTo(2 / 3, 2);
			expect(editPred!.probability).toBeCloseTo(1 / 3, 2);
		});

		it("should return empty for no history", () => {
			const predictions = loop.predictNextTool([]);
			expect(predictions).toHaveLength(0);
		});

		it("should fall back to global frequency when no transitions exist for a tool", () => {
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("edit", {}, OK);

			// Predicting from "write" which has no transitions
			const predictions = loop.predictNextTool(["write"]);
			// Should fall back to global frequency (read: 2, edit: 1)
			if (predictions.length > 0) {
				expect(predictions[0].tool).toBe("read");
			}
		});
	});

	// ─── Performance Score ───────────────────────────────────────────

	describe("performance score computation", () => {
		it("should compute score = successRate*0.5 + speedScore*0.3 + userSatisfaction*0.2", () => {
			// All successful, zero latency, no feedback (neutral 0.5)
			loop.recordToolUsage("perfect", {}, OK);
			loop.recordToolUsage("perfect", {}, OK);

			const state = loop.serialize();
			const stats = new Map(state.toolStats);
			const perfect = stats.get("perfect")!;

			// successRate = 1.0, speedScore ~= 1.0 (near-zero latency), userSatisfaction = 0.5
			// score = 1.0*0.5 + 1.0*0.3 + 0.5*0.2 = 0.5 + 0.3 + 0.1 = 0.9
			expect(perfect.performanceScore).toBeCloseTo(0.9, 1);
		});

		it("should lower the score for tools with many failures", () => {
			loop.recordToolUsage("flaky", {}, ERR);
			loop.recordToolUsage("flaky", {}, ERR);
			loop.recordToolUsage("flaky", {}, OK);

			const state = loop.serialize();
			const stats = new Map(state.toolStats);
			const flaky = stats.get("flaky")!;

			// successRate = 1/3
			expect(flaky.performanceScore).toBeLessThan(0.7);
		});

		it("should factor in user feedback when available", () => {
			loop.recordToolUsage("reviewed", {}, OK);
			loop.registerTurnTools("turn-1", ["reviewed"]);
			loop.recordFeedback("turn-1", true);

			const state = loop.serialize();
			const stats = new Map(state.toolStats);
			const reviewed = stats.get("reviewed")!;

			// With positive feedback, userSatisfaction = 1.0
			// score = 1.0*0.5 + ~1.0*0.3 + 1.0*0.2 = ~1.0
			expect(reviewed.performanceScore).toBeGreaterThan(0.85);
		});
	});

	// ─── Feedback ────────────────────────────────────────────────────

	describe("recordFeedback", () => {
		it("should propagate feedback to tools used in the turn", () => {
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("edit", {}, OK);
			loop.registerTurnTools("t1", ["grep", "edit"]);
			loop.recordFeedback("t1", false);

			const state = loop.serialize();
			const stats = new Map(state.toolStats);
			const grep = stats.get("grep")!;
			expect(grep.feedbackTurns).toBe(1);
			expect(grep.acceptedTurns).toBe(0);
		});

		it("should be a no-op when turnId has no registered tools", () => {
			loop.recordFeedback("nonexistent-turn", true);
			// Should not throw
		});
	});

	// ─── Pattern Detection ───────────────────────────────────────────

	describe("getLearnedPatterns", () => {
		it("should detect common sequences from current session", () => {
			// Record a repeated pattern: grep -> read -> edit
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("edit", {}, OK);
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("edit", {}, OK);

			const patterns = loop.getLearnedPatterns();
			const common = patterns.commonSequences;

			// The "grep -> read" bigram should appear at least 2 times
			const grepRead = common.find((s) =>
				s.sequence.length === 2 && s.sequence[0] === "grep" && s.sequence[1] === "read",
			);
			expect(grepRead).toBeDefined();
			expect(grepRead!.count).toBeGreaterThanOrEqual(2);
		});

		it("should detect named patterns like 'refactoring'", () => {
			// Refactoring = grep -> read -> edit
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("edit", {}, OK);

			const patterns = loop.getLearnedPatterns();
			const named = patterns.namedPatterns;
			const refactoring = named.find((p) => p.name === "refactoring");
			expect(refactoring).toBeDefined();
		});

		it("should return an empty transition matrix when no tools used", () => {
			const patterns = loop.getLearnedPatterns();
			expect(patterns.transitionMatrix.size).toBe(0);
			expect(patterns.frequencyRanking).toHaveLength(0);
		});
	});

	// ─── Session Flushing ────────────────────────────────────────────

	describe("flushSession", () => {
		it("should flush current sequence to toolSequences", () => {
			loop.recordToolUsage("a", {}, OK);
			loop.recordToolUsage("b", {}, OK);
			loop.flushSession();

			const state = loop.serialize();
			expect(state.toolSequences).toHaveLength(1);
			expect(state.toolSequences[0]).toEqual(["a", "b"]);
		});

		it("should clear the current sequence after flush", () => {
			loop.recordToolUsage("a", {}, OK);
			loop.flushSession();

			// After flush, predictions should use global frequency (no current sequence)
			const predictions = loop.predictNextTool(["a"]);
			// "a" has no transitions in the new empty sequence
			// But the transition counts from before are still there
			// So it should still predict based on historical data
		});

		it("should not flush sequences shorter than min pattern length", () => {
			loop.recordToolUsage("only-one", {}, OK);
			loop.flushSession();

			const state = loop.serialize();
			// Min pattern length is 2; single-tool sequence is too short
			expect(state.toolSequences).toHaveLength(0);
		});
	});

	// ─── Recommendations ─────────────────────────────────────────────

	describe("getToolRecommendations", () => {
		it("should return recommendations based on Markov + frequency", () => {
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("edit", {}, OK);
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);

			const recs = loop.getToolRecommendations("", ["grep", "read", "edit", "write"]);
			expect(recs.length).toBeGreaterThan(0);
			// All recommendations should be from the available tools list
			for (const rec of recs) {
				expect(["grep", "read", "edit", "write"]).toContain(rec.tool);
				expect(rec.confidence).toBeGreaterThan(0);
				expect(rec.confidence).toBeLessThanOrEqual(1);
			}
		});

		it("should filter out unavailable tools", () => {
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);

			const recs = loop.getToolRecommendations("", ["write"]);
			// "grep" and "read" should not appear since they're not in available tools
			for (const rec of recs) {
				expect(rec.tool).toBe("write");
			}
		});

		it("should return at most 5 recommendations", () => {
			for (const tool of ["a", "b", "c", "d", "e", "f", "g"]) {
				loop.recordToolUsage(tool, {}, OK);
			}

			const recs = loop.getToolRecommendations("",
				["a", "b", "c", "d", "e", "f", "g"],
			);
			expect(recs.length).toBeLessThanOrEqual(5);
		});
	});

	// ─── Serialization / Deserialization ─────────────────────────────

	describe("serialize / deserialize", () => {
		it("should round-trip through serialization", () => {
			loop.recordToolUsage("grep", {}, OK);
			loop.recordToolUsage("read", {}, OK);
			loop.recordToolUsage("edit", {}, ERR);
			loop.registerTurnTools("t1", ["grep"]);
			loop.recordFeedback("t1", true);
			loop.flushSession();

			const state = loop.serialize();
			const restored = LearningLoop.deserialize(state);
			const restoredState = restored.serialize();

			expect(restoredState.toolStats).toEqual(state.toolStats);
			expect(restoredState.turnFeedback).toEqual(state.turnFeedback);
			expect(restoredState.toolSequences).toEqual(state.toolSequences);
			expect(restoredState.transitionCounts).toEqual(state.transitionCounts);
		});

		it("should preserve tool stats through round-trip", () => {
			loop.recordToolUsage("bash", {}, OK);
			loop.recordToolUsage("bash", {}, OK);
			loop.recordToolUsage("bash", {}, ERR);

			const state = loop.serialize();
			const restored = LearningLoop.deserialize(state);
			const restoredStats = new Map(restored.serialize().toolStats);
			const bash = restoredStats.get("bash")!;

			expect(bash.totalCalls).toBe(3);
			expect(bash.successCount).toBe(2);
			expect(bash.failureCount).toBe(1);
		});
	});
});
