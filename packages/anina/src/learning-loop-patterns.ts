/**
 * @chitragupta/anina — Learning Loop pattern analysis.
 *
 * Standalone functions for Markov chain analysis, performance scoring,
 * n-gram sequence mining, named workflow detection, and frequency ranking.
 * Extracted from LearningLoop class for modularity.
 */

import type { ToolUsageStats } from "./learning-loop.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum expected latency for speed scoring (ms). */
export const MAX_EXPECTED_LATENCY_MS = 30_000;

/** Minimum sequence length to detect patterns. */
export const MIN_PATTERN_LENGTH = 2;

/** Maximum pattern length to consider. */
export const MAX_PATTERN_LENGTH = 5;

/** Named patterns: sequences that map to recognizable workflows. */
export const KNOWN_PATTERNS: ReadonlyArray<{ name: string; signature: string[] }> = [
	{ name: "refactoring", signature: ["grep", "read", "edit"] },
	{ name: "debugging", signature: ["read", "bash", "read"] },
	{ name: "exploration", signature: ["find", "read"] },
	{ name: "search-and-replace", signature: ["grep", "edit"] },
	{ name: "file-creation", signature: ["read", "write"] },
	{ name: "testing", signature: ["bash", "read", "bash"] },
	{ name: "investigation", signature: ["grep", "read", "grep"] },
];

// ─── Performance Scoring ────────────────────────────────────────────────────

/**
 * Compute composite performance score for a tool.
 *   score = successRate * 0.5 + speedScore * 0.3 + userSatisfaction * 0.2
 */
export function computePerformanceScore(stats: ToolUsageStats): number {
	const successRate = stats.totalCalls > 0 ? stats.successCount / stats.totalCalls : 0.5;
	const speedScore = Math.max(0, Math.min(1, 1 - stats.avgLatencyMs / MAX_EXPECTED_LATENCY_MS));
	const userSatisfaction = stats.feedbackTurns > 0 ? stats.acceptedTurns / stats.feedbackTurns : 0.5;
	return successRate * 0.5 + speedScore * 0.3 + userSatisfaction * 0.2;
}

// ─── Markov Chain Analysis ──────────────────────────────────────────────────

/**
 * Compute the full Markov transition probability matrix.
 *   P(j | i) = count(i -> j) / SUM_k count(i -> k)
 */
export function computeTransitionMatrix(
	transitionCounts: Map<string, Map<string, number>>,
): Map<string, Map<string, number>> {
	const matrix = new Map<string, Map<string, number>>();
	for (const [from, transitions] of transitionCounts) {
		let totalCount = 0;
		for (const count of transitions.values()) totalCount += count;
		if (totalCount === 0) continue;
		const probabilities = new Map<string, number>();
		for (const [to, count] of transitions) probabilities.set(to, count / totalCount);
		matrix.set(from, probabilities);
	}
	return matrix;
}

/** Compute a global frequency distribution over all tools. */
export function globalFrequencyDistribution(
	toolUsage: Map<string, ToolUsageStats>,
): Array<{ tool: string; probability: number }> {
	let totalCalls = 0;
	for (const stats of toolUsage.values()) totalCalls += stats.totalCalls;
	if (totalCalls === 0) return [];
	return [...toolUsage.entries()]
		.map(([tool, stats]) => ({ tool, probability: stats.totalCalls / totalCalls }))
		.sort((a, b) => b.probability - a.probability);
}

/**
 * Predict the next likely tool using first-order Markov transition probabilities.
 * Falls back to global frequency distribution when no transitions exist.
 */
export function predictNextTool(
	history: string[],
	transitionCounts: Map<string, Map<string, number>>,
	toolUsage: Map<string, ToolUsageStats>,
): Array<{ tool: string; probability: number }> {
	if (history.length === 0) return [];
	const lastTool = history[history.length - 1];
	const transitions = transitionCounts.get(lastTool);
	if (!transitions || transitions.size === 0) return globalFrequencyDistribution(toolUsage);

	let totalCount = 0;
	for (const count of transitions.values()) totalCount += count;
	if (totalCount === 0) return [];

	const predictions: Array<{ tool: string; probability: number }> = [];
	for (const [tool, count] of transitions) predictions.push({ tool, probability: count / totalCount });
	return predictions.sort((a, b) => b.probability - a.probability);
}

// ─── Sequence Analysis ──────────────────────────────────────────────────────

/**
 * Find the most common tool sub-sequences across all sessions.
 * Extracts n-grams of length [MIN_PATTERN_LENGTH, MAX_PATTERN_LENGTH].
 */
export function findCommonSequences(
	toolSequences: string[][],
	currentSequence: string[],
): Array<{ sequence: string[]; count: number }> {
	const ngramCounts = new Map<string, { sequence: string[]; count: number }>();
	const allSequences = [...toolSequences];
	if (currentSequence.length >= MIN_PATTERN_LENGTH) allSequences.push(currentSequence);

	for (const seq of allSequences) {
		for (let len = MIN_PATTERN_LENGTH; len <= MAX_PATTERN_LENGTH; len++) {
			for (let i = 0; i <= seq.length - len; i++) {
				const ngram = seq.slice(i, i + len);
				const key = ngram.join(" -> ");
				const existing = ngramCounts.get(key);
				if (existing) existing.count++;
				else ngramCounts.set(key, { sequence: ngram, count: 1 });
			}
		}
	}

	return [...ngramCounts.values()]
		.filter((entry) => entry.count >= 2)
		.sort((a, b) => b.count - a.count)
		.slice(0, 20);
}

/** Check if `pattern` is a subsequence of `sequence` (case-insensitive contains match). */
export function isSubsequence(pattern: string[], sequence: string[]): boolean {
	let pi = 0;
	for (let si = 0; si < sequence.length && pi < pattern.length; si++) {
		if (sequence[si].toLowerCase().includes(pattern[pi].toLowerCase())) pi++;
	}
	return pi === pattern.length;
}

/** Detect named workflow patterns in the recorded sequences. */
export function detectNamedPatterns(
	toolSequences: string[][],
	currentSequence: string[],
): Array<{ name: string; tools: string[]; count: number }> {
	const patternCounts = new Map<string, number>();
	const allSequences = [...toolSequences];
	if (currentSequence.length >= MIN_PATTERN_LENGTH) allSequences.push(currentSequence);

	for (const seq of allSequences) {
		for (const pattern of KNOWN_PATTERNS) {
			if (isSubsequence(pattern.signature, seq)) {
				patternCounts.set(pattern.name, (patternCounts.get(pattern.name) ?? 0) + 1);
			}
		}
	}

	return KNOWN_PATTERNS
		.filter((p) => (patternCounts.get(p.name) ?? 0) > 0)
		.map((p) => ({ name: p.name, tools: p.signature, count: patternCounts.get(p.name) ?? 0 }))
		.sort((a, b) => b.count - a.count);
}

/** Get tools ranked by usage frequency. */
export function getFrequencyRanking(
	toolUsage: Map<string, ToolUsageStats>,
): Array<{ tool: string; count: number }> {
	return [...toolUsage.entries()]
		.map(([tool, stats]) => ({ tool, count: stats.totalCalls }))
		.sort((a, b) => b.count - a.count);
}
