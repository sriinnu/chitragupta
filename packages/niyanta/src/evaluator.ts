/**
 * Pariksha — Agent output evaluation framework.
 *
 * Sanskrit: Pariksha (परीक्षा) = examination, evaluation.
 *
 * Provides heuristic-based (no LLM calls) evaluation of agent outputs across
 * five criteria: relevance, completeness, correctness, clarity, and efficiency.
 */

import {
	evalRelevance,
	evalCompleteness,
	evalCorrectness,
	evalClarity,
	evalEfficiency,
} from "./evaluator-metrics.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Evaluation criteria supported by the framework. */
export type EvalCriterion =
	| "relevance"
	| "completeness"
	| "correctness"
	| "clarity"
	| "efficiency";

/** Result of evaluating a single criterion. */
export interface EvalResult {
	criterion: EvalCriterion;
	/** Score from 0 (worst) to 10 (best). */
	score: number;
	/** Human-readable feedback explaining the score. */
	feedback: string;
}

/** Complete evaluation report for an agent's output. */
export interface EvaluationReport {
	agentId: string;
	taskId: string;
	scores: EvalResult[];
	/** Weighted overall score (0-10). */
	overallScore: number;
	timestamp: number;
}

/** Configuration for the evaluator. */
export interface EvaluatorConfig {
	/** Which criteria to evaluate. Default: all five. */
	criteria?: EvalCriterion[];
	/** Weight for each criterion. Normalized to sum to 1. */
	weights?: Partial<Record<EvalCriterion, number>>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_CRITERIA: EvalCriterion[] = [
	"relevance", "completeness", "correctness", "clarity", "efficiency",
];

// ─── Agent Evaluator ─────────────────────────────────────────────────────────

/**
 * Heuristic-based evaluation of agent outputs. Uses NLP-lite heuristics
 * to score outputs without any LLM calls.
 *
 * @example
 * ```ts
 * const evaluator = new AgentEvaluator();
 * const report = evaluator.evaluate("agent-1", "task-42", "Write a sort function", output);
 * console.log(report.overallScore); // 0-10
 * ```
 */
export class AgentEvaluator {
	private readonly criteria: EvalCriterion[];
	private readonly weights: Map<EvalCriterion, number>;
	private readonly history: EvaluationReport[] = [];

	constructor(config?: EvaluatorConfig) {
		this.criteria = config?.criteria ?? [...ALL_CRITERIA];

		const rawWeights = config?.weights ?? {};
		const weightMap = new Map<EvalCriterion, number>();
		let totalWeight = 0;

		for (const criterion of this.criteria) {
			const w = rawWeights[criterion] ?? 1;
			weightMap.set(criterion, w);
			totalWeight += w;
		}

		if (totalWeight > 0) {
			for (const [criterion, w] of weightMap) {
				weightMap.set(criterion, w / totalWeight);
			}
		}

		this.weights = weightMap;
	}

	/**
	 * Evaluate an agent's output against a task description.
	 *
	 * @param agentId - The agent that produced the output.
	 * @param taskId - The task being evaluated.
	 * @param task - The task description / prompt.
	 * @param output - The agent's output text.
	 */
	evaluate(agentId: string, taskId: string, task: string, output: string): EvaluationReport {
		const scores: EvalResult[] = [];

		for (const criterion of this.criteria) {
			scores.push(this.evaluateCriterion(criterion, task, output));
		}

		let overallScore = 0;
		for (const result of scores) {
			const weight = this.weights.get(result.criterion) ?? 0;
			overallScore += result.score * weight;
		}
		overallScore = Math.max(0, Math.min(10, overallScore));

		const report: EvaluationReport = { agentId, taskId, scores, overallScore, timestamp: Date.now() };
		this.history.push(report);
		return report;
	}

	/** Compare two outputs for the same task. */
	compare(
		taskId: string, task: string, outputA: string, outputB: string,
	): { winner: "A" | "B" | "tie"; reason: string; scores: { A: EvaluationReport; B: EvaluationReport } } {
		const scoreA = this.evaluate("compare-A", taskId, task, outputA);
		const scoreB = this.evaluate("compare-B", taskId, task, outputB);

		this.history.pop();
		this.history.pop();

		const diff = scoreA.overallScore - scoreB.overallScore;
		const threshold = 0.5;

		let winner: "A" | "B" | "tie";
		let reason: string;

		if (Math.abs(diff) < threshold) {
			winner = "tie";
			reason = `Scores are within ${threshold} points (A: ${scoreA.overallScore.toFixed(1)}, B: ${scoreB.overallScore.toFixed(1)})`;
		} else if (diff > 0) {
			winner = "A";
			const advantages = this.findAdvantages(scoreA, scoreB);
			reason = `A scores higher by ${diff.toFixed(1)} points. Advantages: ${advantages.join(", ")}`;
		} else {
			winner = "B";
			const advantages = this.findAdvantages(scoreB, scoreA);
			reason = `B scores higher by ${Math.abs(diff).toFixed(1)} points. Advantages: ${advantages.join(", ")}`;
		}

		return { winner, reason, scores: { A: scoreA, B: scoreB } };
	}

	/** Get aggregate statistics for a specific agent. */
	getAgentStats(agentId: string): {
		avgScore: number; evaluationCount: number; strengths: string[]; weaknesses: string[];
	} {
		const agentReports = this.history.filter((r) => r.agentId === agentId);
		if (agentReports.length === 0) {
			return { avgScore: 0, evaluationCount: 0, strengths: [], weaknesses: [] };
		}

		const avgScore = agentReports.reduce((sum, r) => sum + r.overallScore, 0) / agentReports.length;

		const criterionTotals = new Map<EvalCriterion, { sum: number; count: number }>();
		for (const report of agentReports) {
			for (const result of report.scores) {
				const entry = criterionTotals.get(result.criterion) ?? { sum: 0, count: 0 };
				entry.sum += result.score;
				entry.count++;
				criterionTotals.set(result.criterion, entry);
			}
		}

		const criterionAvgs: Array<{ criterion: EvalCriterion; avg: number }> = [];
		for (const [criterion, { sum, count }] of criterionTotals) {
			criterionAvgs.push({ criterion, avg: sum / count });
		}
		criterionAvgs.sort((a, b) => b.avg - a.avg);

		const strengths = criterionAvgs.filter((c) => c.avg >= 7.0).map((c) => `${c.criterion} (${c.avg.toFixed(1)})`);
		const weaknesses = criterionAvgs.filter((c) => c.avg < 4.0).map((c) => `${c.criterion} (${c.avg.toFixed(1)})`);

		return { avgScore: Math.round(avgScore * 10) / 10, evaluationCount: agentReports.length, strengths, weaknesses };
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private evaluateCriterion(criterion: EvalCriterion, task: string, output: string): EvalResult {
		switch (criterion) {
			case "relevance": return evalRelevance(task, output);
			case "completeness": return evalCompleteness(task, output);
			case "correctness": return evalCorrectness(task, output);
			case "clarity": return evalClarity(output);
			case "efficiency": return evalEfficiency(task, output);
		}
	}

	private findAdvantages(winner: EvaluationReport, loser: EvaluationReport): string[] {
		const advantages: string[] = [];
		for (const winScore of winner.scores) {
			const loseScore = loser.scores.find((s) => s.criterion === winScore.criterion);
			if (loseScore && winScore.score > loseScore.score) {
				advantages.push(`${winScore.criterion} (+${(winScore.score - loseScore.score).toFixed(1)})`);
			}
		}
		return advantages.length > 0 ? advantages : ["marginal overall improvement"];
	}
}
