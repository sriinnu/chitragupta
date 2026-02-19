/**
 * @chitragupta/smriti -- Pancha Vritti (पंच वृत्ति -- Five Fluctuations of Mind)
 * Data Classification per Yoga Sutras 1.5-11.
 *
 * In Patanjali's Yoga Sutras, ALL mental activity (chitta vritti) falls into
 * exactly five categories -- no more, no fewer. This is the oldest known
 * exhaustive classification of knowledge types, predating Western epistemology
 * by over a millennium:
 *
 *   1. Pramana  (प्रमाण)  -- Valid knowledge: direct perception, inference, testimony
 *   2. Viparyaya (विपर्यय) -- Error/misconception: knowledge later proven false
 *   3. Vikalpa  (विकल्प)  -- Conceptual construction: hypotheticals, imagination
 *   4. Nidra    (निद्रा)  -- Absence: void, null, "nothing found" as first-class data
 *   5. Smriti   (स्मृति)  -- Recall: retrieved from memory, not freshly observed
 *
 * This module classifies every memory entry, tool result, and knowledge fragment
 * into one of these five vrittis using zero-cost pattern matching (no LLM calls).
 *
 * @module
 */

import {
	fnv1a,
	matchPatterns,
	PRATYAKSHA_TOOLS,
	SMRITI_TOOLS,
} from "./pancha-vritti-patterns.js";
import type { MatchResult } from "./pancha-vritti-patterns.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The five vrittis -- exhaustive classification of all mental modifications. */
export type VrittiType = "pramana" | "viparyaya" | "vikalpa" | "nidra" | "smriti";

/** All vritti types in sutra order (1.5-11). */
export const VRITTI_TYPES: readonly VrittiType[] = [
	"pramana", "viparyaya", "vikalpa", "nidra", "smriti",
] as const;

/** A single classification result. */
export interface VrittiClassification {
	/** FNV-1a ID derived from content hash + vritti type. */
	id: string;
	/** The classified vritti type. */
	type: VrittiType;
	/** Confidence in this classification [0, 1]. Higher = more certain. */
	confidence: number;
	/** Which patterns matched to produce this classification. */
	matchedPatterns: string[];
	/** The source content (truncated to 200 chars for storage). */
	contentSnippet: string;
	/** Optional tool name if classified from a tool result. */
	toolName?: string;
	/** Unix timestamp of classification. */
	classifiedAt: number;
	/** Reclassification history (appended on reclassify). */
	history: Array<{ from: VrittiType; to: VrittiType; reason: string; at: number }>;
}

/** Context provided to the classifier for better accuracy. */
export interface ClassificationContext {
	/** The role that produced this content: user statement vs. tool output vs. assistant reasoning. */
	source: "user" | "assistant" | "tool" | "memory";
	/** Optional tool name if source is "tool". */
	toolName?: string;
	/** Whether the tool call resulted in an error. */
	isError?: boolean;
	/** Whether this content was retrieved from memory/cache. */
	fromMemory?: boolean;
	/** Session ID for provenance tracking. */
	sessionId?: string;
}

/** Configuration for the PanchaVritti classifier. */
export interface VrittiConfig {
	/** Maximum classifications to retain in memory. Default: 5000. */
	maxClassifications: number;
	/** Minimum pattern match confidence to accept. Default: 0.4. */
	minConfidence: number;
	/** Content snippet max length for storage. Default: 200. */
	snippetMaxLength: number;
	/** Custom confidence weights override per vritti. */
	confidenceWeights: Record<VrittiType, number>;
}

/** Distribution statistics across all five vrittis. */
export interface VrittiStats {
	/** Total classifications performed. */
	total: number;
	/** Count per vritti type. */
	counts: Record<VrittiType, number>;
	/** Percentage per vritti type [0, 100]. */
	percentages: Record<VrittiType, number>;
	/** Average confidence per vritti type. */
	avgConfidence: Record<VrittiType, number>;
	/** Number of reclassifications performed. */
	reclassifications: number;
}

/** Serialized state for persistence. */
export interface VrittiSerializedState {
	classifications: VrittiClassification[];
	totalClassified: number;
	totalReclassified: number;
	exportedAt: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Default confidence weights for retrieval scoring. */
export const VRITTI_CONFIDENCE_WEIGHTS: Readonly<Record<VrittiType, number>> = {
	pramana: 1.0,
	smriti: 0.85,
	nidra: 0.7,
	vikalpa: 0.5,
	viparyaya: 0.3,
} as const;

const DEFAULT_CONFIG: VrittiConfig = {
	maxClassifications: 5000,
	minConfidence: 0.4,
	snippetMaxLength: 200,
	confidenceWeights: { ...VRITTI_CONFIDENCE_WEIGHTS },
};

const HARD_CEILINGS: Partial<VrittiConfig> = {
	maxClassifications: 50_000,
	snippetMaxLength: 1000,
};

// ─── PanchaVritti Class ─────────────────────────────────────────────────────

/**
 * Classifies all knowledge entries into exactly five vritti types per
 * Patanjali's Yoga Sutras (1.5-11).
 *
 * Zero LLM cost -- all classification is done via pattern matching on
 * content text, tool names, error flags, and contextual signals.
 *
 * @example
 * ```ts
 * const vritti = new PanchaVritti();
 * const c = vritti.classify("Test passed: 42 tests, 0 failures", {
 *   source: "tool", toolName: "bash",
 * });
 * // c.type === "pramana", c.confidence >= 0.7
 * ```
 */
export class PanchaVritti {
	private cfg: VrittiConfig;
	private classifications = new Map<string, VrittiClassification>();
	private totalClassified = 0;
	private totalReclassified = 0;

	constructor(config?: Partial<VrittiConfig>) {
		const merged: VrittiConfig = {
			...DEFAULT_CONFIG,
			...config,
			confidenceWeights: {
				...DEFAULT_CONFIG.confidenceWeights,
				...config?.confidenceWeights,
			},
		};

		// Clamp to hard ceilings
		if (typeof HARD_CEILINGS.maxClassifications === "number") {
			merged.maxClassifications = Math.min(
				merged.maxClassifications,
				HARD_CEILINGS.maxClassifications,
			);
		}
		if (typeof HARD_CEILINGS.snippetMaxLength === "number") {
			merged.snippetMaxLength = Math.min(
				merged.snippetMaxLength,
				HARD_CEILINGS.snippetMaxLength,
			);
		}

		this.cfg = merged;
	}

	// ── Core Classification ───────────────────────────────────────────────

	/**
	 * Classify a text content into one of the five vritti types.
	 *
	 * Uses pattern matching against content text combined with contextual
	 * signals (source role, tool name, error flag, memory flag) to determine
	 * the most likely vritti. Zero LLM cost.
	 */
	classify(content: string, context: ClassificationContext): VrittiClassification {
		const now = Date.now();
		const snippet = content.slice(0, this.cfg.snippetMaxLength);

		// Step 1: Context-based pre-classification (strong signals)
		let preType: VrittiType | null = null;
		let preConfidence = 0;
		const prePatterns: string[] = [];

		if (context.fromMemory || context.source === "memory") {
			preType = "smriti";
			preConfidence = 0.7;
			prePatterns.push("context:from-memory");
		}
		if (context.isError) {
			preType = "viparyaya";
			preConfidence = 0.6;
			prePatterns.push("context:error-flag");
		}
		if (content.trim().length === 0) {
			const id = fnv1a("nidra:" + now.toString());
			const classification: VrittiClassification = {
				id, type: "nidra", confidence: 0.9,
				matchedPatterns: ["context:empty-content"],
				contentSnippet: "", toolName: context.toolName,
				classifiedAt: now, history: [],
			};
			this.store(classification);
			return classification;
		}

		// Step 2: Pattern-based classification
		const matches = matchPatterns(content);

		// Step 3: Tool-based boost
		if (context.source === "tool" && context.toolName) {
			this.applyToolBoost(matches, context);
		}

		// Re-sort after boosts
		matches.sort((a, b) => b.confidence - a.confidence);

		// Step 4: Resolve winner
		const { type: winnerType, confidence: winnerConfidence, patterns: winnerPatterns } =
			this.resolveWinner(matches, preType, preConfidence, prePatterns, context);

		const allPatterns = [...winnerPatterns];
		if (winnerConfidence < this.cfg.minConfidence) {
			allPatterns.push("low-confidence");
		}

		const id = fnv1a(winnerType + ":" + content.slice(0, 100) + ":" + now.toString());
		const classification: VrittiClassification = {
			id, type: winnerType, confidence: winnerConfidence,
			matchedPatterns: allPatterns, contentSnippet: snippet,
			toolName: context.toolName, classifiedAt: now, history: [],
		};

		this.store(classification);
		return classification;
	}

	/**
	 * Classify a tool execution result.
	 * Convenience wrapper that handles stringification of non-string results.
	 */
	classifyToolResult(toolName: string, result: unknown, isError: boolean): VrittiClassification {
		const content = typeof result === "string"
			? result
			: result === null || result === undefined
				? ""
				: JSON.stringify(result);

		return this.classify(content, { source: "tool", toolName, isError });
	}

	// ── Reclassification ──────────────────────────────────────────────────

	/**
	 * Reclassify a previously classified entry when new evidence emerges.
	 * The original classification is preserved in the history array.
	 */
	reclassify(id: string, newType: VrittiType, reason: string): void {
		const existing = this.classifications.get(id);
		if (!existing) throw new Error(`Classification not found: ${id}`);
		const oldType = existing.type;
		if (oldType === newType) return;
		existing.history.push({ from: oldType, to: newType, reason, at: Date.now() });
		existing.type = newType;
		this.totalReclassified++;
	}

	// ── Retrieval & Queries ──────────────────────────────────────────────

	/** Get the confidence weight for a vritti type, used in retrieval scoring. */
	getConfidenceWeight(type: VrittiType): number {
		return this.cfg.confidenceWeights[type];
	}

	/** Get the classification for a given ID. */
	getClassification(id: string): VrittiClassification | undefined {
		return this.classifications.get(id);
	}

	/** Get all classifications of a specific vritti type. */
	getByType(type: VrittiType): VrittiClassification[] {
		const result: VrittiClassification[] = [];
		for (const c of this.classifications.values()) {
			if (c.type === type) result.push(c);
		}
		return result;
	}

	// ── Statistics ─────────────────────────────────────────────────────────

	/** Get distribution statistics across all five vritti types. */
	getStats(): VrittiStats {
		const counts: Record<VrittiType, number> = {
			pramana: 0, viparyaya: 0, vikalpa: 0, nidra: 0, smriti: 0,
		};
		const confidenceSums: Record<VrittiType, number> = {
			pramana: 0, viparyaya: 0, vikalpa: 0, nidra: 0, smriti: 0,
		};
		for (const c of this.classifications.values()) {
			counts[c.type]++;
			confidenceSums[c.type] += c.confidence;
		}
		const total = this.classifications.size;
		const percentages: Record<VrittiType, number> = {
			pramana: 0, viparyaya: 0, vikalpa: 0, nidra: 0, smriti: 0,
		};
		const avgConfidence: Record<VrittiType, number> = {
			pramana: 0, viparyaya: 0, vikalpa: 0, nidra: 0, smriti: 0,
		};
		for (const type of VRITTI_TYPES) {
			percentages[type] = total > 0 ? (counts[type] / total) * 100 : 0;
			avgConfidence[type] = counts[type] > 0 ? confidenceSums[type] / counts[type] : 0;
		}
		return { total, counts, percentages, avgConfidence, reclassifications: this.totalReclassified };
	}

	// ── Persistence ───────────────────────────────────────────────────────

	/** Serialize the full state for persistence (JSON-safe). */
	serialize(): VrittiSerializedState {
		return {
			classifications: [...this.classifications.values()],
			totalClassified: this.totalClassified,
			totalReclassified: this.totalReclassified,
			exportedAt: Date.now(),
		};
	}

	/** Restore state from a serialized snapshot. */
	deserialize(state: VrittiSerializedState): void {
		this.classifications.clear();
		for (const c of state.classifications) this.classifications.set(c.id, c);
		this.totalClassified = state.totalClassified;
		this.totalReclassified = state.totalReclassified;
	}

	/** Clear all classifications and reset counters. */
	clear(): void {
		this.classifications.clear();
		this.totalClassified = 0;
		this.totalReclassified = 0;
	}

	// ── Internal ──────────────────────────────────────────────────────────

	/** Apply tool-based confidence boosts to pattern match results. */
	private applyToolBoost(matches: MatchResult[], context: ClassificationContext): void {
		if (PRATYAKSHA_TOOLS.has(context.toolName!) && !context.isError) {
			const pramanaMatch = matches.find((m) => m.type === "pramana");
			if (pramanaMatch) {
				pramanaMatch.confidence = Math.min(1, pramanaMatch.confidence + 0.2);
				pramanaMatch.matched.push("tool:pratyaksha-source");
			} else {
				matches.push({ type: "pramana", confidence: 0.5, matched: ["tool:pratyaksha-source"] });
			}
		}
		if (SMRITI_TOOLS.has(context.toolName!)) {
			const smritiMatch = matches.find((m) => m.type === "smriti");
			if (smritiMatch) {
				smritiMatch.confidence = Math.min(1, smritiMatch.confidence + 0.3);
				smritiMatch.matched.push("tool:memory-source");
			} else {
				matches.push({ type: "smriti", confidence: 0.7, matched: ["tool:memory-source"] });
			}
		}
	}

	/** Resolve the winning vritti type from matches and pre-classification. */
	private resolveWinner(
		matches: MatchResult[],
		preType: VrittiType | null,
		preConfidence: number,
		prePatterns: string[],
		context: ClassificationContext,
	): { type: VrittiType; confidence: number; patterns: string[] } {
		if (matches.length > 0) {
			const top = matches[0];
			if (preType && preConfidence > top.confidence) {
				return { type: preType, confidence: preConfidence, patterns: prePatterns };
			}
			return { type: top.type, confidence: top.confidence, patterns: top.matched };
		}
		if (preType) {
			return { type: preType, confidence: preConfidence, patterns: prePatterns };
		}
		// Default: user → pramana, assistant → vikalpa
		if (context.source === "user") {
			return { type: "pramana", confidence: 0.3, patterns: ["default:user-statement"] };
		}
		return { type: "vikalpa", confidence: 0.3, patterns: ["default:assistant-reasoning"] };
	}

	/** Store a classification, enforcing maxClassifications by evicting oldest. */
	private store(c: VrittiClassification): void {
		this.classifications.set(c.id, c);
		this.totalClassified++;
		if (this.classifications.size > this.cfg.maxClassifications) {
			let oldestId: string | null = null;
			let oldestAt = Infinity;
			for (const [id, entry] of this.classifications) {
				if (entry.classifiedAt < oldestAt) {
					oldestAt = entry.classifiedAt;
					oldestId = id;
				}
			}
			if (oldestId) this.classifications.delete(oldestId);
		}
	}
}
