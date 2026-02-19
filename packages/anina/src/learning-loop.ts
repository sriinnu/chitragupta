/**
 * @chitragupta/anina — Learning Loop.
 *
 * Tracks tool usage, builds Markov transition probabilities, computes
 * performance scores, and provides tool recommendations based on
 * accumulated experience. Pattern analysis is in learning-loop-patterns.ts.
 *
 * @packageDocumentation
 */

import type { ToolResult } from "./types.js";
import {
	computePerformanceScore, computeTransitionMatrix, predictNextTool as predictNextToolFn,
	findCommonSequences, detectNamedPatterns, getFrequencyRanking,
	MIN_PATTERN_LENGTH,
} from "./learning-loop-patterns.js";

// Re-export pattern analysis for consumers
export {
	computePerformanceScore, computeTransitionMatrix,
	findCommonSequences, detectNamedPatterns, getFrequencyRanking, isSubsequence,
	KNOWN_PATTERNS, MIN_PATTERN_LENGTH, MAX_PATTERN_LENGTH,
} from "./learning-loop-patterns.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Statistics tracked per tool. */
export interface ToolUsageStats {
	name: string;
	totalCalls: number;
	successCount: number;
	failureCount: number;
	totalLatencyMs: number;
	avgLatencyMs: number;
	acceptedTurns: number;
	feedbackTurns: number;
	performanceScore: number;
	lastUsedAt: number;
}

/** A ranked tool suggestion with reasoning. */
export interface ToolRecommendation {
	tool: string;
	confidence: number;
	reason: string;
}

/** Learned patterns from tool usage. */
export interface LearnedPatterns {
	commonSequences: Array<{ sequence: string[]; count: number }>;
	transitionMatrix: Map<string, Map<string, number>>;
	frequencyRanking: Array<{ tool: string; count: number }>;
	namedPatterns: Array<{ name: string; tools: string[]; count: number }>;
}

/** Serializable state for persistence. */
export interface LearningLoopState {
	toolStats: Array<[string, ToolUsageStats]>;
	turnFeedback: Array<[string, boolean]>;
	toolSequences: string[][];
	transitionCounts: Array<[string, Array<[string, number]>]>;
	turnTools: Array<[string, string[]]>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SEQUENCES = 500;
const SEQUENCE_WINDOW = 20;

// ─── Learning Loop ──────────────────────────────────────────────────────────

/**
 * The brain's feedback system — learns from every interaction.
 *
 * Tracks tool usage, builds Markov transition probabilities, computes
 * performance scores, and provides tool recommendations.
 */
export class LearningLoop {
	private toolUsage: Map<string, ToolUsageStats> = new Map();
	private turnFeedback: Map<string, boolean> = new Map();
	private toolSequences: string[][] = [];
	private currentSequence: string[] = [];
	private transitionCounts: Map<string, Map<string, number>> = new Map();
	private turnTools: Map<string, string[]> = new Map();
	private callTimers: Map<string, number> = new Map();

	// ─── Recording ────────────────────────────────────────────────────

	/** Record a tool usage event. Updates stats, sequence, and Markov matrix. */
	recordToolUsage(toolName: string, _args: Record<string, unknown>, result: ToolResult): void {
		const now = Date.now();
		const startTime = this.callTimers.get(toolName) ?? now;
		const latency = now - startTime;
		this.callTimers.delete(toolName);

		let stats = this.toolUsage.get(toolName);
		if (!stats) {
			stats = {
				name: toolName, totalCalls: 0, successCount: 0, failureCount: 0,
				totalLatencyMs: 0, avgLatencyMs: 0, acceptedTurns: 0,
				feedbackTurns: 0, performanceScore: 0.5, lastUsedAt: now,
			};
			this.toolUsage.set(toolName, stats);
		}

		stats.totalCalls++;
		stats.lastUsedAt = now;
		stats.totalLatencyMs += latency;
		stats.avgLatencyMs = stats.totalLatencyMs / stats.totalCalls;
		if (result.isError) stats.failureCount++;
		else stats.successCount++;
		stats.performanceScore = computePerformanceScore(stats);

		// Markov transition from previous tool
		if (this.currentSequence.length > 0) {
			const prevTool = this.currentSequence[this.currentSequence.length - 1];
			this.recordTransition(prevTool, toolName);
		}

		this.currentSequence.push(toolName);
		if (this.currentSequence.length > SEQUENCE_WINDOW) this.currentSequence.shift();
	}

	/** Signal that a tool call is starting (for latency tracking). */
	markToolStart(toolName: string): void {
		this.callTimers.set(toolName, Date.now());
	}

	/** Record user feedback for a turn. Propagates to all tools used in that turn. */
	recordFeedback(turnId: string, accepted: boolean): void {
		this.turnFeedback.set(turnId, accepted);
		const tools = this.turnTools.get(turnId);
		if (!tools) return;
		for (const toolName of tools) {
			const stats = this.toolUsage.get(toolName);
			if (!stats) continue;
			stats.feedbackTurns++;
			if (accepted) stats.acceptedTurns++;
			stats.performanceScore = computePerformanceScore(stats);
		}
	}

	/** Associate a turn ID with the tools used during that turn. */
	registerTurnTools(turnId: string, toolNames: string[]): void {
		this.turnTools.set(turnId, toolNames);
	}

	/** Flush the current session sequence and start a new one. */
	flushSession(): void {
		if (this.currentSequence.length >= MIN_PATTERN_LENGTH) {
			this.toolSequences.push([...this.currentSequence]);
			if (this.toolSequences.length > MAX_SEQUENCES) this.toolSequences.shift();
		}
		this.currentSequence = [];
	}

	// ─── Recommendations ──────────────────────────────────────────────

	/** Get recommended tools combining Markov prediction + frequency/performance. */
	getToolRecommendations(_currentContext: string, availableTools: string[]): ToolRecommendation[] {
		const available = new Set(availableTools);
		const recommendations: Map<string, { confidence: number; reason: string }> = new Map();

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

		for (const [name, stats] of this.toolUsage) {
			if (!available.has(name)) continue;
			const combined = Math.min(stats.totalCalls / 100, 1.0) * 0.3 + stats.performanceScore * 0.2;
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

	/** Predict the next likely tool using Markov chain. */
	predictNextTool(history: string[]): Array<{ tool: string; probability: number }> {
		return predictNextToolFn(history, this.transitionCounts, this.toolUsage);
	}

	// ─── Pattern Analysis ─────────────────────────────────────────────

	/** Get all learned patterns from accumulated usage data. */
	getLearnedPatterns(): LearnedPatterns {
		return {
			commonSequences: findCommonSequences(this.toolSequences, this.currentSequence),
			transitionMatrix: computeTransitionMatrix(this.transitionCounts),
			frequencyRanking: getFrequencyRanking(this.toolUsage),
			namedPatterns: detectNamedPatterns(this.toolSequences, this.currentSequence),
		};
	}

	// ─── Serialization ────────────────────────────────────────────────

	/** Serialize for persistence. */
	serialize(): LearningLoopState {
		const transitionCounts: Array<[string, Array<[string, number]>]> = [];
		for (const [from, tos] of this.transitionCounts) transitionCounts.push([from, [...tos.entries()]]);
		return {
			toolStats: [...this.toolUsage.entries()],
			turnFeedback: [...this.turnFeedback.entries()],
			toolSequences: this.toolSequences,
			transitionCounts,
			turnTools: [...this.turnTools.entries()],
		};
	}

	/** Reconstruct from serialized state. */
	static deserialize(state: LearningLoopState): LearningLoop {
		const loop = new LearningLoop();
		loop.toolUsage = new Map(state.toolStats);
		loop.turnFeedback = new Map(state.turnFeedback);
		loop.toolSequences = state.toolSequences;
		loop.turnTools = new Map(state.turnTools);
		loop.transitionCounts = new Map();
		for (const [from, tos] of state.transitionCounts) loop.transitionCounts.set(from, new Map(tos));
		return loop;
	}

	// ─── Private ──────────────────────────────────────────────────────

	private recordTransition(from: string, to: string): void {
		let transitions = this.transitionCounts.get(from);
		if (!transitions) { transitions = new Map(); this.transitionCounts.set(from, transitions); }
		transitions.set(to, (transitions.get(to) ?? 0) + 1);
	}
}
