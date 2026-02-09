/**
 * @chitragupta/anina — Learning Loop.
 *
 * The brain's feedback system — learns from every interaction.
 * Like Dharana (concentration) in Patanjali's Yoga Sutras, the learning
 * loop maintains focused attention on what works and what doesn't,
 * distilling experience into actionable knowledge.
 *
 * ## Core Algorithms
 *
 * 1. **Tool Usage Tracking** — Records every tool call with timing, success
 *    rate, and user feedback. Builds a frequency map per tool.
 *
 * 2. **Markov Chain Tool Sequences** — Tracks transitions between tool calls
 *    and builds a first-order Markov transition matrix:
 *
 *        P(tool_j | tool_i) = count(i -> j) / SUM_k count(i -> k)
 *
 *    After sufficient data, predicts the next likely tool given the current
 *    tool history.
 *
 * 3. **Performance Scoring** — Each tool gets a running score:
 *
 *        score = successRate * 0.5 + speedScore * 0.3 + userSatisfaction * 0.2
 *
 *    where speedScore = clamp(1 - latency / maxExpectedLatency, 0, 1)
 *    and userSatisfaction = acceptedTurns / totalTurns for turns using that tool.
 *
 * @packageDocumentation
 */

import type { ToolResult } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Statistics tracked per tool. */
export interface ToolUsageStats {
	/** Tool name. */
	name: string;
	/** Total number of invocations. */
	totalCalls: number;
	/** Number of successful invocations. */
	successCount: number;
	/** Number of failed invocations. */
	failureCount: number;
	/** Cumulative latency in ms across all calls. */
	totalLatencyMs: number;
	/** Average latency in ms. */
	avgLatencyMs: number;
	/** Number of turns using this tool that received positive feedback. */
	acceptedTurns: number;
	/** Number of turns using this tool that received any feedback. */
	feedbackTurns: number;
	/** Computed performance score in [0, 1]. */
	performanceScore: number;
	/** Timestamp of last usage. */
	lastUsedAt: number;
}

/** A ranked tool suggestion with reasoning. */
export interface ToolRecommendation {
	/** Recommended tool name. */
	tool: string;
	/** Confidence score in [0, 1]. */
	confidence: number;
	/** Reason for recommendation. */
	reason: string;
}

/** Learned patterns from tool usage. */
export interface LearnedPatterns {
	/** Most common tool sequences (ordered by frequency). */
	commonSequences: Array<{ sequence: string[]; count: number }>;
	/** Markov transition matrix: from -> { to -> probability }. */
	transitionMatrix: Map<string, Map<string, number>>;
	/** Tool frequency ranking. */
	frequencyRanking: Array<{ tool: string; count: number }>;
	/** Named patterns detected (e.g., "refactoring", "debugging"). */
	namedPatterns: Array<{ name: string; tools: string[]; count: number }>;
}

/** Serializable state for persistence. */
export interface LearningLoopState {
	/** Per-tool statistics. */
	toolStats: Array<[string, ToolUsageStats]>;
	/** Turn feedback map. */
	turnFeedback: Array<[string, boolean]>;
	/** Recorded tool sequences from sessions. */
	toolSequences: string[][];
	/** Transition count matrix for Markov chain. */
	transitionCounts: Array<[string, Array<[string, number]>]>;
	/** Map of turn IDs to the tools used in that turn. */
	turnTools: Array<[string, string[]]>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum expected latency for speed scoring (ms). */
const MAX_EXPECTED_LATENCY_MS = 30_000;

/** Maximum number of sequences to retain. */
const MAX_SEQUENCES = 500;

/** Sliding window size for current session sequence. */
const SEQUENCE_WINDOW = 20;

/** Minimum sequence length to detect patterns. */
const MIN_PATTERN_LENGTH = 2;

/** Maximum pattern length to consider. */
const MAX_PATTERN_LENGTH = 5;

// ─── Known Workflow Patterns ────────────────────────────────────────────────

/** Named patterns: sequences that map to recognizable workflows. */
const KNOWN_PATTERNS: Array<{ name: string; signature: string[] }> = [
	{ name: "refactoring", signature: ["grep", "read", "edit"] },
	{ name: "debugging", signature: ["read", "bash", "read"] },
	{ name: "exploration", signature: ["find", "read"] },
	{ name: "search-and-replace", signature: ["grep", "edit"] },
	{ name: "file-creation", signature: ["read", "write"] },
	{ name: "testing", signature: ["bash", "read", "bash"] },
	{ name: "investigation", signature: ["grep", "read", "grep"] },
];

// ─── Learning Loop ──────────────────────────────────────────────────────────

/**
 * The brain's feedback system — learns from every interaction.
 *
 * Tracks tool usage, builds Markov transition probabilities, computes
 * performance scores, and provides tool recommendations based on
 * accumulated experience.
 */
export class LearningLoop {
	/** Per-tool usage statistics. */
	private toolUsage: Map<string, ToolUsageStats> = new Map();

	/** Turn-level feedback: turnId -> accepted/rejected. */
	private turnFeedback: Map<string, boolean> = new Map();

	/** All recorded tool sequences (one per session). */
	private toolSequences: string[][] = [];

	/** Current session's tool sequence (sliding window). */
	private currentSequence: string[] = [];

	/**
	 * Markov transition counts: from -> { to -> count }.
	 * The raw counts from which transition probabilities are derived.
	 */
	private transitionCounts: Map<string, Map<string, number>> = new Map();

	/** Map of turn IDs to the tool names used in that turn. */
	private turnTools: Map<string, string[]> = new Map();

	/** Tracks in-flight tool call start times. */
	private callTimers: Map<string, number> = new Map();

	// ─── Recording ────────────────────────────────────────────────────

	/**
	 * Record a tool usage event.
	 *
	 * Updates per-tool stats (call count, success/failure, latency),
	 * appends to the current session sequence, and updates the Markov
	 * transition matrix.
	 *
	 * @param toolName - Name of the tool that was called.
	 * @param _args - Arguments passed to the tool (used for future hashing).
	 * @param result - The structured tool result.
	 */
	recordToolUsage(
		toolName: string,
		_args: Record<string, unknown>,
		result: ToolResult,
	): void {
		const now = Date.now();
		const startTime = this.callTimers.get(toolName) ?? now;
		const latency = now - startTime;
		this.callTimers.delete(toolName);

		// Update or create stats
		let stats = this.toolUsage.get(toolName);
		if (!stats) {
			stats = {
				name: toolName,
				totalCalls: 0,
				successCount: 0,
				failureCount: 0,
				totalLatencyMs: 0,
				avgLatencyMs: 0,
				acceptedTurns: 0,
				feedbackTurns: 0,
				performanceScore: 0.5,
				lastUsedAt: now,
			};
			this.toolUsage.set(toolName, stats);
		}

		stats.totalCalls++;
		stats.lastUsedAt = now;
		stats.totalLatencyMs += latency;
		stats.avgLatencyMs = stats.totalLatencyMs / stats.totalCalls;

		if (result.isError) {
			stats.failureCount++;
		} else {
			stats.successCount++;
		}

		// Recompute performance score
		stats.performanceScore = this.computePerformanceScore(stats);

		// Update Markov transition from previous tool
		if (this.currentSequence.length > 0) {
			const prevTool = this.currentSequence[this.currentSequence.length - 1];
			this.recordTransition(prevTool, toolName);
		}

		// Append to current sequence (sliding window)
		this.currentSequence.push(toolName);
		if (this.currentSequence.length > SEQUENCE_WINDOW) {
			this.currentSequence.shift();
		}
	}

	/**
	 * Signal that a tool call is starting (for latency tracking).
	 *
	 * @param toolName - Name of the tool about to be called.
	 */
	markToolStart(toolName: string): void {
		this.callTimers.set(toolName, Date.now());
	}

	/**
	 * Record user feedback for a turn.
	 *
	 * Feedback propagates to all tools used in that turn, adjusting
	 * their userSatisfaction component.
	 *
	 * @param turnId - The unique turn identifier.
	 * @param accepted - Whether the user accepted the output.
	 */
	recordFeedback(turnId: string, accepted: boolean): void {
		this.turnFeedback.set(turnId, accepted);

		// Propagate to tools used in this turn
		const tools = this.turnTools.get(turnId);
		if (!tools) return;

		for (const toolName of tools) {
			const stats = this.toolUsage.get(toolName);
			if (!stats) continue;

			stats.feedbackTurns++;
			if (accepted) stats.acceptedTurns++;
			stats.performanceScore = this.computePerformanceScore(stats);
		}
	}

	/**
	 * Associate a turn ID with the tools used during that turn.
	 *
	 * @param turnId - The unique turn identifier.
	 * @param toolNames - Tools used during this turn.
	 */
	registerTurnTools(turnId: string, toolNames: string[]): void {
		this.turnTools.set(turnId, toolNames);
	}

	/**
	 * Flush the current session sequence and start a new one.
	 * Call this when a session ends or context is reset.
	 */
	flushSession(): void {
		if (this.currentSequence.length >= MIN_PATTERN_LENGTH) {
			this.toolSequences.push([...this.currentSequence]);
			if (this.toolSequences.length > MAX_SEQUENCES) {
				this.toolSequences.shift();
			}
		}
		this.currentSequence = [];
	}

	// ─── Recommendations ──────────────────────────────────────────────

	/**
	 * Get recommended tools based on current context.
	 *
	 * Combines Markov prediction (what tool typically follows the last one)
	 * with frequency analysis (what tools are most used overall) and
	 * performance scoring (what tools work best).
	 *
	 * @param _currentContext - Current conversation context (reserved for future use).
	 * @param availableTools - List of available tool names to filter results.
	 * @returns Ranked tool recommendations.
	 */
	getToolRecommendations(
		_currentContext: string,
		availableTools: string[],
	): ToolRecommendation[] {
		const available = new Set(availableTools);
		const recommendations: Map<string, { confidence: number; reason: string }> = new Map();

		// Factor 1: Markov prediction from recent history
		if (this.currentSequence.length > 0) {
			const predictions = this.predictNextTool(this.currentSequence);
			for (const pred of predictions) {
				if (!available.has(pred.tool)) continue;
				const existing = recommendations.get(pred.tool);
				const markovScore = pred.probability * 0.5;
				if (!existing || existing.confidence < markovScore) {
					recommendations.set(pred.tool, {
						confidence: markovScore,
						reason: `Predicted from sequence (P=${pred.probability.toFixed(2)})`,
					});
				}
			}
		}

		// Factor 2: Performance-weighted frequency
		for (const [name, stats] of this.toolUsage) {
			if (!available.has(name)) continue;
			const freqScore = Math.min(stats.totalCalls / 100, 1.0) * 0.3;
			const perfScore = stats.performanceScore * 0.2;
			const combined = freqScore + perfScore;

			const existing = recommendations.get(name);
			if (existing) {
				existing.confidence = Math.min(existing.confidence + combined, 1.0);
				existing.reason += ` + freq/perf boost`;
			} else {
				recommendations.set(name, {
					confidence: combined,
					reason: `Frequency + performance (score=${stats.performanceScore.toFixed(2)})`,
				});
			}
		}

		return [...recommendations.entries()]
			.map(([tool, { confidence, reason }]) => ({ tool, confidence, reason }))
			.sort((a, b) => b.confidence - a.confidence)
			.slice(0, 5);
	}

	/**
	 * Predict the next likely tool using Markov chain transition probabilities.
	 *
	 * Uses first-order Markov: P(next | history) = P(next | last_tool).
	 * If no transitions are recorded for the last tool, falls back to
	 * the global frequency distribution.
	 *
	 * @param history - Recent tool call history (uses last element).
	 * @returns Predicted tools with probabilities, sorted descending.
	 */
	predictNextTool(history: string[]): Array<{ tool: string; probability: number }> {
		if (history.length === 0) return [];

		const lastTool = history[history.length - 1];
		const transitions = this.transitionCounts.get(lastTool);

		if (!transitions || transitions.size === 0) {
			// Fallback: global frequency distribution
			return this.globalFrequencyDistribution();
		}

		// Compute transition probabilities: P(j | i) = count(i->j) / sum_k(count(i->k))
		let totalCount = 0;
		for (const count of transitions.values()) {
			totalCount += count;
		}

		if (totalCount === 0) return [];

		const predictions: Array<{ tool: string; probability: number }> = [];
		for (const [tool, count] of transitions) {
			predictions.push({
				tool,
				probability: count / totalCount,
			});
		}

		return predictions.sort((a, b) => b.probability - a.probability);
	}

	// ─── Pattern Analysis ─────────────────────────────────────────────

	/**
	 * Get all learned patterns from accumulated usage data.
	 *
	 * @returns Comprehensive pattern report.
	 */
	getLearnedPatterns(): LearnedPatterns {
		return {
			commonSequences: this.findCommonSequences(),
			transitionMatrix: this.computeTransitionMatrix(),
			frequencyRanking: this.getFrequencyRanking(),
			namedPatterns: this.detectNamedPatterns(),
		};
	}

	// ─── Serialization ────────────────────────────────────────────────

	/**
	 * Serialize the learning loop state for persistence.
	 *
	 * @returns A JSON-serializable state object.
	 */
	serialize(): LearningLoopState {
		const transitionCounts: Array<[string, Array<[string, number]>]> = [];
		for (const [from, tos] of this.transitionCounts) {
			transitionCounts.push([from, [...tos.entries()]]);
		}

		return {
			toolStats: [...this.toolUsage.entries()],
			turnFeedback: [...this.turnFeedback.entries()],
			toolSequences: this.toolSequences,
			transitionCounts,
			turnTools: [...this.turnTools.entries()],
		};
	}

	/**
	 * Reconstruct a LearningLoop from serialized state.
	 *
	 * @param state - Previously serialized state.
	 * @returns A reconstituted LearningLoop instance.
	 */
	static deserialize(state: LearningLoopState): LearningLoop {
		const loop = new LearningLoop();

		loop.toolUsage = new Map(state.toolStats);
		loop.turnFeedback = new Map(state.turnFeedback);
		loop.toolSequences = state.toolSequences;
		loop.turnTools = new Map(state.turnTools);

		loop.transitionCounts = new Map();
		for (const [from, tos] of state.transitionCounts) {
			loop.transitionCounts.set(from, new Map(tos));
		}

		return loop;
	}

	// ─── Private: Scoring ─────────────────────────────────────────────

	/**
	 * Compute the composite performance score for a tool.
	 *
	 *     score = successRate * 0.5 + speedScore * 0.3 + userSatisfaction * 0.2
	 *
	 * - successRate = successCount / totalCalls
	 * - speedScore = clamp(1 - avgLatency / MAX_EXPECTED_LATENCY, 0, 1)
	 * - userSatisfaction = acceptedTurns / feedbackTurns (or 0.5 if no feedback)
	 */
	private computePerformanceScore(stats: ToolUsageStats): number {
		const successRate = stats.totalCalls > 0
			? stats.successCount / stats.totalCalls
			: 0.5;

		const speedScore = Math.max(
			0,
			Math.min(1, 1 - stats.avgLatencyMs / MAX_EXPECTED_LATENCY_MS),
		);

		const userSatisfaction = stats.feedbackTurns > 0
			? stats.acceptedTurns / stats.feedbackTurns
			: 0.5; // Neutral when no feedback

		return successRate * 0.5 + speedScore * 0.3 + userSatisfaction * 0.2;
	}

	// ─── Private: Markov Chain ────────────────────────────────────────

	/**
	 * Record a transition from one tool to another in the Markov chain.
	 */
	private recordTransition(from: string, to: string): void {
		let transitions = this.transitionCounts.get(from);
		if (!transitions) {
			transitions = new Map();
			this.transitionCounts.set(from, transitions);
		}
		transitions.set(to, (transitions.get(to) ?? 0) + 1);
	}

	/**
	 * Compute the full Markov transition probability matrix.
	 *
	 *     P(j | i) = count(i -> j) / SUM_k count(i -> k)
	 *
	 * @returns Map of from -> { to -> probability }.
	 */
	private computeTransitionMatrix(): Map<string, Map<string, number>> {
		const matrix = new Map<string, Map<string, number>>();

		for (const [from, transitions] of this.transitionCounts) {
			let totalCount = 0;
			for (const count of transitions.values()) {
				totalCount += count;
			}
			if (totalCount === 0) continue;

			const probabilities = new Map<string, number>();
			for (const [to, count] of transitions) {
				probabilities.set(to, count / totalCount);
			}
			matrix.set(from, probabilities);
		}

		return matrix;
	}

	/**
	 * Compute a global frequency distribution over all tools.
	 * Fallback for Markov prediction when no transitions exist.
	 */
	private globalFrequencyDistribution(): Array<{ tool: string; probability: number }> {
		let totalCalls = 0;
		for (const stats of this.toolUsage.values()) {
			totalCalls += stats.totalCalls;
		}
		if (totalCalls === 0) return [];

		return [...this.toolUsage.entries()]
			.map(([tool, stats]) => ({
				tool,
				probability: stats.totalCalls / totalCalls,
			}))
			.sort((a, b) => b.probability - a.probability);
	}

	// ─── Private: Sequence Analysis ───────────────────────────────────

	/**
	 * Find the most common tool sub-sequences across all sessions.
	 *
	 * Extracts all n-grams of length [MIN_PATTERN_LENGTH, MAX_PATTERN_LENGTH]
	 * from each recorded sequence and counts occurrences.
	 */
	private findCommonSequences(): Array<{ sequence: string[]; count: number }> {
		const ngramCounts = new Map<string, { sequence: string[]; count: number }>();

		const allSequences = [...this.toolSequences];
		if (this.currentSequence.length >= MIN_PATTERN_LENGTH) {
			allSequences.push(this.currentSequence);
		}

		for (const seq of allSequences) {
			for (let len = MIN_PATTERN_LENGTH; len <= MAX_PATTERN_LENGTH; len++) {
				for (let i = 0; i <= seq.length - len; i++) {
					const ngram = seq.slice(i, i + len);
					const key = ngram.join(" -> ");
					const existing = ngramCounts.get(key);
					if (existing) {
						existing.count++;
					} else {
						ngramCounts.set(key, { sequence: ngram, count: 1 });
					}
				}
			}
		}

		return [...ngramCounts.values()]
			.filter((entry) => entry.count >= 2)
			.sort((a, b) => b.count - a.count)
			.slice(0, 20);
	}

	/**
	 * Detect named workflow patterns in the recorded sequences.
	 *
	 * Matches recorded sequences against known workflow signatures using
	 * subsequence matching (the pattern tools must appear in order, but
	 * not necessarily contiguously).
	 */
	private detectNamedPatterns(): Array<{ name: string; tools: string[]; count: number }> {
		const patternCounts = new Map<string, number>();

		const allSequences = [...this.toolSequences];
		if (this.currentSequence.length >= MIN_PATTERN_LENGTH) {
			allSequences.push(this.currentSequence);
		}

		for (const seq of allSequences) {
			for (const pattern of KNOWN_PATTERNS) {
				if (this.isSubsequence(pattern.signature, seq)) {
					patternCounts.set(
						pattern.name,
						(patternCounts.get(pattern.name) ?? 0) + 1,
					);
				}
			}
		}

		return KNOWN_PATTERNS
			.filter((p) => (patternCounts.get(p.name) ?? 0) > 0)
			.map((p) => ({
				name: p.name,
				tools: p.signature,
				count: patternCounts.get(p.name) ?? 0,
			}))
			.sort((a, b) => b.count - a.count);
	}

	/**
	 * Check if `pattern` is a subsequence of `sequence`.
	 * Tools in `pattern` must appear in order within `sequence`,
	 * but gaps are allowed. Uses a normalized prefix match: the tool name
	 * in the sequence only needs to contain the pattern tool name.
	 */
	private isSubsequence(pattern: string[], sequence: string[]): boolean {
		let pi = 0;
		for (let si = 0; si < sequence.length && pi < pattern.length; si++) {
			if (sequence[si].toLowerCase().includes(pattern[pi].toLowerCase())) {
				pi++;
			}
		}
		return pi === pattern.length;
	}

	/** Get tools ranked by usage frequency. */
	private getFrequencyRanking(): Array<{ tool: string; count: number }> {
		return [...this.toolUsage.entries()]
			.map(([tool, stats]) => ({ tool, count: stats.totalCalls }))
			.sort((a, b) => b.count - a.count);
	}
}
