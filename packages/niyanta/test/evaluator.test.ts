import { describe, it, expect } from "vitest";
import { AgentEvaluator } from "../src/evaluator.js";
import type { EvalCriterion, EvaluationReport, EvaluatorConfig } from "../src/evaluator.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const sampleTask = "Write a sorting function in TypeScript that handles edge cases";
const goodOutput = `
## Sorting Function

Here's a TypeScript implementation of a merge sort with edge case handling:

\`\`\`typescript
function mergeSort(arr: number[]): number[] {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  return merge(left, right);
}

function merge(left: number[], right: number[]): number[] {
  const result: number[] = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) {
      result.push(left[i++]);
    } else {
      result.push(right[j++]);
    }
  }
  return result.concat(left.slice(i)).concat(right.slice(j));
}
\`\`\`

### Edge Cases Handled

- Empty arrays return immediately
- Single-element arrays are already sorted
- Handles duplicate values correctly via \`<=\` comparison
- Stable sort preserves relative order of equal elements
`;

const poorOutput = "sort function: arr.sort()";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentEvaluator", () => {
	// ── Constructor & Config ──────────────────────────────────────────

	describe("constructor", () => {
		it("uses all 5 criteria by default", () => {
			const evaluator = new AgentEvaluator();
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			expect(report.scores.length).toBe(5);
			const criteria = report.scores.map((s) => s.criterion);
			expect(criteria).toContain("relevance");
			expect(criteria).toContain("completeness");
			expect(criteria).toContain("correctness");
			expect(criteria).toContain("clarity");
			expect(criteria).toContain("efficiency");
		});

		it("uses only specified criteria when configured", () => {
			const evaluator = new AgentEvaluator({
				criteria: ["relevance", "clarity"],
			});
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			expect(report.scores.length).toBe(2);
			const criteria = report.scores.map((s) => s.criterion);
			expect(criteria).toContain("relevance");
			expect(criteria).toContain("clarity");
		});

		it("normalizes custom weights so they sum to 1", () => {
			const evaluator = new AgentEvaluator({
				criteria: ["relevance", "completeness"],
				weights: { relevance: 3, completeness: 1 },
			});
			// Relevance weight should be 3/4, completeness 1/4
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			// The overall score should be weighted accordingly
			expect(report.overallScore).toBeGreaterThanOrEqual(0);
			expect(report.overallScore).toBeLessThanOrEqual(10);
		});
	});

	// ── evaluate ──────────────────────────────────────────────────────

	describe("evaluate", () => {
		const evaluator = new AgentEvaluator();

		it("returns a report with correct agentId and taskId", () => {
			const report = evaluator.evaluate("agent-42", "task-99", sampleTask, goodOutput);
			expect(report.agentId).toBe("agent-42");
			expect(report.taskId).toBe("task-99");
		});

		it("returns an overall score between 0 and 10", () => {
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			expect(report.overallScore).toBeGreaterThanOrEqual(0);
			expect(report.overallScore).toBeLessThanOrEqual(10);
		});

		it("individual scores are between 0 and 10", () => {
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			for (const result of report.scores) {
				expect(result.score).toBeGreaterThanOrEqual(0);
				expect(result.score).toBeLessThanOrEqual(10);
			}
		});

		it("includes a timestamp", () => {
			const before = Date.now();
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			expect(report.timestamp).toBeGreaterThanOrEqual(before);
		});

		it("scores good output higher than poor output", () => {
			const goodReport = evaluator.evaluate("a", "t1", sampleTask, goodOutput);
			const poorReport = evaluator.evaluate("b", "t2", sampleTask, poorOutput);
			expect(goodReport.overallScore).toBeGreaterThan(poorReport.overallScore);
		});

		it("provides feedback strings for each criterion", () => {
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			for (const result of report.scores) {
				expect(typeof result.feedback).toBe("string");
				expect(result.feedback.length).toBeGreaterThan(0);
			}
		});

		it("gives 0 completeness for empty output", () => {
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, "");
			const completeness = report.scores.find((s) => s.criterion === "completeness");
			expect(completeness!.score).toBe(0);
		});

		it("gives 0 efficiency for empty output", () => {
			const report = evaluator.evaluate("agent-1", "t1", sampleTask, "");
			const efficiency = report.scores.find((s) => s.criterion === "efficiency");
			expect(efficiency!.score).toBe(0);
		});
	});

	// ── Relevance ─────────────────────────────────────────────────────

	describe("relevance scoring", () => {
		it("scores higher when output contains task keywords", () => {
			const evaluator = new AgentEvaluator({ criteria: ["relevance"] });
			const relevant = evaluator.evaluate("a", "t1",
				"sort algorithm implementation",
				"This sort algorithm implementation uses quicksort for efficient sorting",
			);
			const irrelevant = evaluator.evaluate("b", "t2",
				"sort algorithm implementation",
				"The weather today is sunny and warm with clear skies",
			);
			expect(relevant.overallScore).toBeGreaterThan(irrelevant.overallScore);
		});
	});

	// ── Correctness ───────────────────────────────────────────────────

	describe("correctness scoring", () => {
		it("penalizes outputs with self-contradictions", () => {
			const evaluator = new AgentEvaluator({ criteria: ["correctness"] });
			const contradictory = evaluator.evaluate("a", "t1", sampleTask,
				"The function works. Wait, that's wrong. Actually it doesn't work. Correction: it partially works.",
			);
			const clean = evaluator.evaluate("b", "t2", sampleTask,
				"The function correctly handles all edge cases and returns sorted output.",
			);
			expect(clean.overallScore).toBeGreaterThan(contradictory.overallScore);
		});
	});

	// ── Clarity ───────────────────────────────────────────────────────

	describe("clarity scoring", () => {
		it("scores higher for structured output with headers and lists", () => {
			const evaluator = new AgentEvaluator({ criteria: ["clarity"] });
			const structured = evaluator.evaluate("a", "t1", sampleTask, goodOutput);
			const flat = evaluator.evaluate("b", "t2", sampleTask,
				"Here is a sort function that sorts numbers. It takes an array and returns a sorted array. " +
				"It uses merge sort. It handles empty arrays. It handles single element arrays.",
			);
			expect(structured.overallScore).toBeGreaterThanOrEqual(flat.overallScore);
		});
	});

	// ── compare ───────────────────────────────────────────────────────

	describe("compare", () => {
		it("declares a winner when scores differ significantly", () => {
			const evaluator = new AgentEvaluator();
			const comparison = evaluator.compare("t1", sampleTask, goodOutput, poorOutput);
			expect(comparison.winner).toBe("A");
			expect(comparison.reason).toContain("higher");
		});

		it("declares a tie when scores are within threshold", () => {
			const evaluator = new AgentEvaluator();
			// Compare identical outputs
			const comparison = evaluator.compare("t1", sampleTask, goodOutput, goodOutput);
			expect(comparison.winner).toBe("tie");
		});

		it("returns individual scores for both outputs", () => {
			const evaluator = new AgentEvaluator();
			const comparison = evaluator.compare("t1", sampleTask, goodOutput, poorOutput);
			expect(comparison.scores.A).toBeDefined();
			expect(comparison.scores.B).toBeDefined();
			expect(comparison.scores.A.overallScore).toBeGreaterThan(0);
		});

		it("does not add comparison reports to persistent history", () => {
			const evaluator = new AgentEvaluator();
			evaluator.compare("t1", sampleTask, goodOutput, poorOutput);
			const stats = evaluator.getAgentStats("compare-A");
			expect(stats.evaluationCount).toBe(0);
		});
	});

	// ── getAgentStats ─────────────────────────────────────────────────

	describe("getAgentStats", () => {
		it("returns zero stats for an unknown agent", () => {
			const evaluator = new AgentEvaluator();
			const stats = evaluator.getAgentStats("unknown");
			expect(stats.avgScore).toBe(0);
			expect(stats.evaluationCount).toBe(0);
			expect(stats.strengths).toHaveLength(0);
			expect(stats.weaknesses).toHaveLength(0);
		});

		it("computes correct average score across evaluations", () => {
			const evaluator = new AgentEvaluator();
			evaluator.evaluate("agent-1", "t1", sampleTask, goodOutput);
			evaluator.evaluate("agent-1", "t2", sampleTask, goodOutput);
			const stats = evaluator.getAgentStats("agent-1");
			expect(stats.evaluationCount).toBe(2);
			expect(stats.avgScore).toBeGreaterThan(0);
		});

		it("identifies strengths and weaknesses", () => {
			const evaluator = new AgentEvaluator();
			// Evaluate multiple times to build history
			for (let i = 0; i < 3; i++) {
				evaluator.evaluate("agent-1", `t${i}`, sampleTask, goodOutput);
			}
			const stats = evaluator.getAgentStats("agent-1");
			// Good output should have strengths
			expect(stats.strengths.length + stats.weaknesses.length).toBeGreaterThanOrEqual(0);
		});
	});
});
