/**
 * Pariksha — Agent output evaluation framework.
 *
 * Sanskrit: Pariksha (परीक्षा) = examination, evaluation.
 *
 * Provides heuristic-based (no LLM calls) evaluation of agent outputs across
 * five criteria: relevance, completeness, correctness, clarity, and efficiency.
 * Designed for fast, cost-free quality assessment during orchestration.
 */

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
	/** The criterion that was evaluated. */
	criterion: EvalCriterion;
	/** Score from 0 (worst) to 10 (best). */
	score: number;
	/** Human-readable feedback explaining the score. */
	feedback: string;
}

/** Complete evaluation report for an agent's output. */
export interface EvaluationReport {
	/** ID of the agent that produced the output. */
	agentId: string;
	/** ID of the task that was evaluated. */
	taskId: string;
	/** Individual criterion scores. */
	scores: EvalResult[];
	/** Weighted overall score (0-10). */
	overallScore: number;
	/** Timestamp of evaluation in epoch milliseconds. */
	timestamp: number;
}

/** Configuration for the evaluator. */
export interface EvaluatorConfig {
	/** Which criteria to evaluate. Default: all five. */
	criteria?: EvalCriterion[];
	/**
	 * Weight for each criterion. Values are normalized so they sum to 1.
	 * Default: equal weight for all active criteria.
	 */
	weights?: Partial<Record<EvalCriterion, number>>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_CRITERIA: EvalCriterion[] = [
	"relevance",
	"completeness",
	"correctness",
	"clarity",
	"efficiency",
];

// ─── Agent Evaluator ─────────────────────────────────────────────────────────

/**
 * AgentEvaluator — heuristic-based evaluation of agent outputs.
 *
 * Uses NLP-lite heuristics to score outputs without any LLM calls, making
 * it suitable for real-time evaluation during orchestration.
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

		// Normalize weights
		const rawWeights = config?.weights ?? {};
		const weightMap = new Map<EvalCriterion, number>();
		let totalWeight = 0;

		for (const criterion of this.criteria) {
			const w = rawWeights[criterion] ?? 1;
			weightMap.set(criterion, w);
			totalWeight += w;
		}

		// Normalize so weights sum to 1
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
	 * @returns A complete evaluation report.
	 */
	evaluate(agentId: string, taskId: string, task: string, output: string): EvaluationReport {
		const scores: EvalResult[] = [];

		for (const criterion of this.criteria) {
			scores.push(this.evaluateCriterion(criterion, task, output));
		}

		// Compute weighted overall score
		let overallScore = 0;
		for (const result of scores) {
			const weight = this.weights.get(result.criterion) ?? 0;
			overallScore += result.score * weight;
		}

		// Clamp to [0, 10]
		overallScore = Math.max(0, Math.min(10, overallScore));

		const report: EvaluationReport = {
			agentId,
			taskId,
			scores,
			overallScore,
			timestamp: Date.now(),
		};

		this.history.push(report);
		return report;
	}

	/**
	 * Compare two outputs for the same task.
	 *
	 * @param taskId - The task ID for tracking.
	 * @param task - The task description.
	 * @param outputA - First agent's output.
	 * @param outputB - Second agent's output.
	 * @returns Comparison result with winner, reason, and individual scores.
	 */
	compare(
		taskId: string,
		task: string,
		outputA: string,
		outputB: string,
	): {
		winner: "A" | "B" | "tie";
		reason: string;
		scores: { A: EvaluationReport; B: EvaluationReport };
	} {
		const scoreA = this.evaluate("compare-A", taskId, task, outputA);
		const scoreB = this.evaluate("compare-B", taskId, task, outputB);

		// Remove comparison reports from persistent history
		this.history.pop();
		this.history.pop();

		const diff = scoreA.overallScore - scoreB.overallScore;
		const threshold = 0.5; // Minimum difference to declare a winner

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

	/**
	 * Get aggregate statistics for a specific agent across all evaluations.
	 *
	 * @param agentId - The agent to get stats for.
	 * @returns Aggregate scores, evaluation count, strengths, and weaknesses.
	 */
	getAgentStats(agentId: string): {
		avgScore: number;
		evaluationCount: number;
		strengths: string[];
		weaknesses: string[];
	} {
		const agentReports = this.history.filter((r) => r.agentId === agentId);

		if (agentReports.length === 0) {
			return { avgScore: 0, evaluationCount: 0, strengths: [], weaknesses: [] };
		}

		const avgScore = agentReports.reduce((sum, r) => sum + r.overallScore, 0) / agentReports.length;

		// Compute average per-criterion scores
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

		// Sort by average score
		criterionAvgs.sort((a, b) => b.avg - a.avg);

		const strengthThreshold = 7.0;
		const weaknessThreshold = 4.0;

		const strengths = criterionAvgs
			.filter((c) => c.avg >= strengthThreshold)
			.map((c) => `${c.criterion} (${c.avg.toFixed(1)})`);

		const weaknesses = criterionAvgs
			.filter((c) => c.avg < weaknessThreshold)
			.map((c) => `${c.criterion} (${c.avg.toFixed(1)})`);

		return {
			avgScore: Math.round(avgScore * 10) / 10,
			evaluationCount: agentReports.length,
			strengths,
			weaknesses,
		};
	}

	// ─── Internal: Criterion Evaluators ──────────────────────────────────────

	private evaluateCriterion(criterion: EvalCriterion, task: string, output: string): EvalResult {
		switch (criterion) {
			case "relevance":
				return this.evalRelevance(task, output);
			case "completeness":
				return this.evalCompleteness(task, output);
			case "correctness":
				return this.evalCorrectness(task, output);
			case "clarity":
				return this.evalClarity(output);
			case "efficiency":
				return this.evalEfficiency(task, output);
		}
	}

	/**
	 * Relevance: keyword overlap between task and output.
	 * Measures how many significant task keywords appear in the output.
	 */
	private evalRelevance(task: string, output: string): EvalResult {
		const taskWords = extractSignificantWords(task);
		const outputLower = output.toLowerCase();

		if (taskWords.length === 0) {
			return { criterion: "relevance", score: 5, feedback: "Task has no significant keywords to match against" };
		}

		let matches = 0;
		for (const word of taskWords) {
			if (outputLower.includes(word)) {
				matches++;
			}
		}

		const ratio = matches / taskWords.length;
		const score = Math.min(10, Math.round(ratio * 10 * 1.2)); // Slight boost, capped at 10

		let feedback: string;
		if (score >= 8) {
			feedback = `Highly relevant: ${matches}/${taskWords.length} task keywords present`;
		} else if (score >= 5) {
			feedback = `Moderately relevant: ${matches}/${taskWords.length} task keywords present`;
		} else {
			feedback = `Low relevance: only ${matches}/${taskWords.length} task keywords found in output`;
		}

		return { criterion: "relevance", score, feedback };
	}

	/**
	 * Completeness: output length relative to task complexity.
	 * Uses word count heuristics — more complex tasks need longer responses.
	 */
	private evalCompleteness(task: string, output: string): EvalResult {
		const taskWords = task.split(/\s+/).filter(Boolean).length;
		const outputWords = output.split(/\s+/).filter(Boolean).length;

		// Estimate expected output length based on task complexity
		// Simple heuristic: expect at least 2x the task word count for simple tasks,
		// scaling up for more complex ones
		const complexityMultiplier = Math.min(10, Math.max(2, taskWords / 5));
		const expectedMinWords = taskWords * complexityMultiplier;

		if (outputWords === 0) {
			return { criterion: "completeness", score: 0, feedback: "Output is empty" };
		}

		// Score based on ratio to expected minimum
		const ratio = outputWords / Math.max(1, expectedMinWords);
		let score: number;

		if (ratio >= 1.0) {
			score = Math.min(10, 7 + Math.min(3, (ratio - 1) * 2));
		} else if (ratio >= 0.5) {
			score = 4 + (ratio - 0.5) * 6;
		} else {
			score = ratio * 8;
		}

		score = Math.max(0, Math.min(10, Math.round(score)));

		// Check for structural completeness indicators
		const hasCodeBlocks = /```[\s\S]*?```/.test(output);
		const hasLists = /^[\s]*[-*]\s/m.test(output) || /^\s*\d+\.\s/m.test(output);
		const hasExplanation = outputWords > 20;

		const indicators: string[] = [];
		if (hasCodeBlocks) indicators.push("code blocks");
		if (hasLists) indicators.push("structured lists");
		if (hasExplanation) indicators.push("explanatory text");

		const feedback = indicators.length > 0
			? `${outputWords} words with ${indicators.join(", ")}. Coverage: ${Math.round(ratio * 100)}%`
			: `${outputWords} words. Coverage: ${Math.round(ratio * 100)}% of expected`;

		return { criterion: "completeness", score, feedback };
	}

	/**
	 * Correctness: presence of well-formed code, absence of contradictions.
	 * Checks code block validity and internal consistency.
	 */
	private evalCorrectness(_task: string, output: string): EvalResult {
		let score = 6; // Start with neutral-positive baseline
		const observations: string[] = [];

		// Check code blocks for basic validity
		const codeBlocks = output.match(/```(\w*)\n([\s\S]*?)```/g) ?? [];
		if (codeBlocks.length > 0) {
			let validBlocks = 0;
			for (const block of codeBlocks) {
				const content = block.replace(/```\w*\n/, "").replace(/```$/, "");
				if (isCodeLikelyValid(content)) {
					validBlocks++;
				}
			}
			const codeRatio = validBlocks / codeBlocks.length;
			if (codeRatio >= 0.8) {
				score += 2;
				observations.push(`${validBlocks}/${codeBlocks.length} code blocks appear valid`);
			} else if (codeRatio >= 0.5) {
				score += 1;
				observations.push(`${validBlocks}/${codeBlocks.length} code blocks appear valid`);
			} else {
				score -= 1;
				observations.push(`Only ${validBlocks}/${codeBlocks.length} code blocks appear valid`);
			}
		}

		// Check for contradiction indicators
		const contradictionPatterns = [
			/\bhowever\b.*\bactually\b/i,
			/\bwait\b.*\bthat's wrong\b/i,
			/\bno\b.*\bI meant\b/i,
			/\bcorrection\b/i,
		];
		let contradictions = 0;
		for (const pattern of contradictionPatterns) {
			if (pattern.test(output)) contradictions++;
		}

		if (contradictions > 0) {
			score -= contradictions;
			observations.push(`${contradictions} potential self-contradiction(s) detected`);
		}

		// Check for confidence indicators
		const confidencePatterns = [
			/\bI'm not sure\b/i,
			/\bI think\b.*\bmaybe\b/i,
			/\bprobably\b/i,
			/\bmight be wrong\b/i,
		];
		let hedges = 0;
		for (const pattern of confidencePatterns) {
			if (pattern.test(output)) hedges++;
		}

		if (hedges > 2) {
			score -= 1;
			observations.push("Multiple uncertainty hedges detected");
		}

		score = Math.max(0, Math.min(10, score));

		const feedback = observations.length > 0
			? observations.join(". ")
			: "No significant correctness signals detected";

		return { criterion: "correctness", score, feedback };
	}

	/**
	 * Clarity: structure detection (headers, lists, code blocks) and
	 * sentence variety (not overly repetitive).
	 */
	private evalClarity(output: string): EvalResult {
		let score = 5; // Neutral baseline
		const observations: string[] = [];

		// Structure indicators
		const hasHeaders = /^#{1,6}\s/m.test(output);
		const hasBulletLists = /^[\s]*[-*]\s/m.test(output);
		const hasNumberedLists = /^\s*\d+\.\s/m.test(output);
		const hasCodeBlocks = /```/.test(output);
		const hasParagraphs = output.split(/\n\n+/).filter((p) => p.trim().length > 0).length;

		let structureScore = 0;
		if (hasHeaders) { structureScore++; observations.push("has headers"); }
		if (hasBulletLists || hasNumberedLists) { structureScore++; observations.push("has lists"); }
		if (hasCodeBlocks) { structureScore++; observations.push("has code blocks"); }
		if (hasParagraphs >= 2) { structureScore++; observations.push(`${hasParagraphs} sections`); }

		score += Math.min(3, structureScore);

		// Sentence variety — check that sentences don't all start the same way
		const sentences = output
			.split(/[.!?]+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 10);

		if (sentences.length >= 3) {
			const starters = sentences.map((s) => s.split(/\s+/)[0]?.toLowerCase() ?? "");
			const uniqueStarters = new Set(starters);
			const variety = uniqueStarters.size / starters.length;

			if (variety >= 0.6) {
				score += 1;
				observations.push("good sentence variety");
			} else if (variety < 0.3) {
				score -= 1;
				observations.push("repetitive sentence starters");
			}
		}

		// Readability — penalize very long unbroken paragraphs
		const paragraphs = output.split(/\n\n+/).filter((p) => p.trim().length > 0);
		const longParagraphs = paragraphs.filter((p) => p.split(/\s+/).length > 150);
		if (longParagraphs.length > 0) {
			score -= 1;
			observations.push(`${longParagraphs.length} overly long paragraph(s)`);
		}

		score = Math.max(0, Math.min(10, score));

		return {
			criterion: "clarity",
			score,
			feedback: observations.length > 0
				? `Structure: ${observations.join(", ")}`
				: "Minimal structural elements",
		};
	}

	/**
	 * Efficiency: output conciseness.
	 * Penalizes extreme verbosity and extreme brevity relative to task.
	 */
	private evalEfficiency(task: string, output: string): EvalResult {
		const taskWords = task.split(/\s+/).filter(Boolean).length;
		const outputWords = output.split(/\s+/).filter(Boolean).length;

		if (outputWords === 0) {
			return { criterion: "efficiency", score: 0, feedback: "Output is empty" };
		}

		// Ideal output/task ratio zone: 3x-20x task length
		const ratio = outputWords / Math.max(1, taskWords);
		let score: number;
		let feedback: string;

		if (ratio < 1) {
			score = 3;
			feedback = `Very brief: ${outputWords} words for a ${taskWords}-word task`;
		} else if (ratio < 3) {
			score = 6;
			feedback = `Concise: ${ratio.toFixed(1)}x task length`;
		} else if (ratio <= 20) {
			// Sweet spot — peak around 5-10x
			const normalizedRatio = (ratio - 3) / 17; // 0..1 within the sweet spot
			const bellCurve = 1 - Math.pow(2 * normalizedRatio - 0.4, 2);
			score = 7 + Math.round(bellCurve * 3);
			feedback = `Good balance: ${ratio.toFixed(1)}x task length (${outputWords} words)`;
		} else if (ratio <= 50) {
			score = 5;
			feedback = `Somewhat verbose: ${ratio.toFixed(1)}x task length (${outputWords} words)`;
		} else {
			score = Math.max(1, 5 - Math.floor((ratio - 50) / 20));
			feedback = `Excessively verbose: ${ratio.toFixed(1)}x task length (${outputWords} words)`;
		}

		// Check for redundancy — repeated phrases
		const phrases = extractPhrases(output, 3);
		const uniquePhrases = new Set(phrases);
		if (phrases.length >= 5) {
			const redundancy = 1 - uniquePhrases.size / phrases.length;
			if (redundancy > 0.3) {
				score = Math.max(0, score - 2);
				feedback += `. High redundancy: ${Math.round(redundancy * 100)}% repeated phrases`;
			}
		}

		score = Math.max(0, Math.min(10, score));

		return { criterion: "efficiency", score, feedback };
	}

	// ─── Internal: Comparison Helpers ─────────────────────────────────────────

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

// ─── Utility Functions ───────────────────────────────────────────────────────

/** Common English stop words to exclude from keyword matching. */
const STOP_WORDS = new Set([
	"a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "be",
	"been", "being", "have", "has", "had", "do", "does", "did", "will",
	"would", "could", "should", "may", "might", "shall", "can", "need",
	"to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
	"into", "about", "between", "through", "during", "before", "after",
	"above", "below", "this", "that", "these", "those", "it", "its",
	"i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
	"them", "their", "what", "which", "who", "when", "where", "how",
	"all", "each", "every", "both", "few", "more", "most", "other",
	"some", "such", "no", "not", "only", "same", "so", "than", "too",
	"very", "just", "because", "if", "then", "else", "while", "also",
	"write", "create", "make", "please", "using",
]);

/**
 * Extract significant words from text, excluding stop words and short tokens.
 */
function extractSignificantWords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Check if a code block looks structurally valid.
 * Checks for balanced braces/brackets/parens and non-trivial content.
 */
function isCodeLikelyValid(code: string): boolean {
	const trimmed = code.trim();
	if (trimmed.length < 3) return false;

	// Check bracket balance
	let braces = 0, brackets = 0, parens = 0;
	for (const char of trimmed) {
		switch (char) {
			case "{": braces++; break;
			case "}": braces--; break;
			case "[": brackets++; break;
			case "]": brackets--; break;
			case "(": parens++; break;
			case ")": parens--; break;
		}
		// Early exit on negative balance (closing before opening)
		if (braces < 0 || brackets < 0 || parens < 0) return false;
	}

	// Allow slight imbalance (code snippets often omit closing braces)
	return Math.abs(braces) <= 1 && Math.abs(brackets) <= 1 && Math.abs(parens) <= 1;
}

/**
 * Extract n-word phrases from text for redundancy detection.
 */
function extractPhrases(text: string, n: number): string[] {
	const words = text.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length < n) return [];

	const phrases: string[] = [];
	for (let i = 0; i <= words.length - n; i++) {
		phrases.push(words.slice(i, i + n).join(" "));
	}
	return phrases;
}
