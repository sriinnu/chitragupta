/**
 * @chitragupta/anina — Information-Theoretic Context Compaction.
 *
 * CompactionMonitor hooks into the agent loop with tiered triggers
 * at 60%/75%/90% of context limit, applying progressively more aggressive
 * compaction strategies using TF-IDF, TextRank, MinHash, and Shannon surprisal.
 */

import type { AgentState, AgentMessage } from "./types.js";
import { estimateTotalTokens, collapseToolDetails } from "./context-compaction.js";

// Re-export all algorithms for backward compatibility
export {
	computeTfIdfScores,
	textRankMessages,
	minHashDedup,
	shannonSurprisal,
	informationalCompact,
	normalizeScores,
	deduplicateMessages,
	textRankPrune,
} from "./compaction-algorithms.js";

import {
	deduplicateMessages,
	textRankPrune,
	informationalCompact,
} from "./compaction-algorithms.js";

// ─── CompactionMonitor ───────────────────────────────────────────────────────

/** Compaction tier thresholds as fractions of context limit. */
export interface CompactionThresholds {
	/** Gentle tier: collapse tool details only. Default: 0.60. */
	gentle: number;
	/** Moderate tier: MinHash dedup + TextRank pruning. Default: 0.75. */
	moderate: number;
	/** Aggressive tier: full informational rewrite. Default: 0.90. */
	aggressive: number;
}

const DEFAULT_THRESHOLDS: CompactionThresholds = {
	gentle: 0.60,
	moderate: 0.75,
	aggressive: 0.90,
};

/**
 * Monitor that hooks into the agent loop to trigger auto-compaction
 * at progressive tiers as context usage grows.
 *
 * - Tier 1 (gentle, 60%): Collapse tool call arguments and results.
 * - Tier 2 (moderate, 75%): MinHash dedup + TextRank pruning.
 * - Tier 3 (aggressive, 90%): Full informational compaction.
 */
export class CompactionMonitor {
	private thresholds: CompactionThresholds;

	constructor(thresholds?: Partial<CompactionThresholds>) {
		this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
	}

	/** Set new compaction thresholds. */
	setThresholds(thresholds: Partial<CompactionThresholds>): void {
		this.thresholds = { ...this.thresholds, ...thresholds };
	}

	/** Check current context usage and apply compaction if needed. */
	checkAndCompact(
		state: AgentState,
		contextLimit: number,
	): { messages: AgentMessage[]; tier: "none" | "gentle" | "moderate" | "aggressive" } {
		const usage = estimateTotalTokens(state) / contextLimit;

		if (usage < this.thresholds.gentle) {
			return { messages: state.messages, tier: "none" };
		}

		if (usage < this.thresholds.moderate) {
			return { messages: collapseToolDetails(state.messages), tier: "gentle" };
		}

		if (usage < this.thresholds.aggressive) {
			const deduped = deduplicateMessages(state.messages);
			const targetTokens = Math.floor(contextLimit * 0.5);
			return { messages: textRankPrune(deduped, targetTokens), tier: "moderate" };
		}

		const targetTokens = Math.floor(contextLimit * 0.4);
		return { messages: informationalCompact(state.messages, targetTokens), tier: "aggressive" };
	}
}
