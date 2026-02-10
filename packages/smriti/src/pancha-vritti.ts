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
 * Classification determines retrieval confidence weights -- pramana (verified facts)
 * scores highest, viparyaya (known errors) scores lowest but is never discarded,
 * because knowing what is false is itself valuable knowledge.
 *
 * Confidence weight formula for retrieval scoring:
 *   adjustedScore = baseScore * VRITTI_CONFIDENCE_WEIGHTS[vritti]
 *
 * @module
 */

// ─── FNV-1a ─────────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

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

// ─── Pattern Definitions ────────────────────────────────────────────────────

/**
 * Each vritti has a set of detection patterns: regex + weight.
 * Final confidence = sum(matched weights) clamped to [0, 1].
 * Patterns are checked in priority order; first match with highest aggregate wins.
 */

interface DetectionPattern {
	regex: RegExp;
	weight: number;
	label: string;
}

/** Pramana -- valid, grounded knowledge. Direct observation, verified facts. */
const PRAMANA_PATTERNS: DetectionPattern[] = [
	// Direct tool outputs (pratyaksha -- direct perception)
	{ regex: /^(?:file|directory|path)\s+(?:exists|found|created|written|read)/i, weight: 0.6, label: "file-operation-success" },
	{ regex: /(?:test|spec|check)\s+(?:pass|passed|passing|succeeded|success)/i, weight: 0.7, label: "test-pass" },
	{ regex: /(?:compiled?|built?)\s+(?:success|without\s+errors)/i, weight: 0.6, label: "compile-success" },
	{ regex: /\b(?:verified|confirmed|validated|proven)\b/i, weight: 0.5, label: "verified-fact" },
	// User authoritative statements
	{ regex: /\b(?:the\s+(?:answer|result|output)\s+is)\b/i, weight: 0.4, label: "definitive-statement" },
	{ regex: /\bis\s+located\s+(?:at|in)\b/i, weight: 0.4, label: "location-fact" },
	{ regex: /\bversion\s+\d+/i, weight: 0.4, label: "version-fact" },
	{ regex: /\b(?:returns?|outputs?|produces?|yields?)\s+/i, weight: 0.3, label: "output-observation" },
	// Shabda -- testimony/documentation
	{ regex: /(?:according\s+to|per\s+the|documentation\s+(?:says|states))/i, weight: 0.4, label: "documentation-reference" },
	{ regex: /\b(?:exit\s*code\s*(?:0|zero))\b/i, weight: 0.6, label: "exit-code-zero" },
	{ regex: /\b\d+\s+(?:tests?|specs?),?\s*0\s+(?:failures?|errors?)/i, weight: 0.7, label: "test-results-clean" },
];

/** Viparyaya -- error, misconception, contradicted knowledge. */
const VIPARYAYA_PATTERNS: DetectionPattern[] = [
	{ regex: /\b(?:actually),?\s/i, weight: 0.4, label: "correction-actually" },
	{ regex: /\b(?:that'?s\s+(?:wrong|incorrect|not\s+right|a\s+mistake))\b/i, weight: 0.7, label: "explicit-wrong" },
	{ regex: /\b(?:no,?\s+(?:that|it|this)\s+(?:is|was|should)\s+(?:not|wrong))/i, weight: 0.6, label: "negation-correction" },
	{ regex: /\b(?:incorrect|erroneous|mistaken|false|hallucin)/i, weight: 0.6, label: "error-keyword" },
	{ regex: /(?:test|spec|check)\s+(?:fail|failed|failing|failure)/i, weight: 0.6, label: "test-failure" },
	{ regex: /\b(?:error|exception|crash|panic|segfault|ENOENT|EPERM|EACCES)\b/i, weight: 0.5, label: "error-signal" },
	{ regex: /\b(?:bug|regression|broke|broken|breaking)\b/i, weight: 0.4, label: "bug-signal" },
	{ regex: /\b(?:contradiction|contradicts?|contradicted)\b/i, weight: 0.6, label: "contradiction" },
	{ regex: /\b(?:deprecated|obsolete|removed|no\s+longer\s+(?:valid|works?|supported))\b/i, weight: 0.5, label: "deprecated" },
	{ regex: /\bexit\s*code\s*[1-9]\d*\b/i, weight: 0.5, label: "nonzero-exit" },
	{ regex: /\b(?:should\s+(?:have\s+been|be)\s+(?:instead|rather))\b/i, weight: 0.5, label: "should-have-been" },
];

/** Vikalpa -- conceptual construction, hypothetical, ungrounded reasoning. */
const VIKALPA_PATTERNS: DetectionPattern[] = [
	{ regex: /\b(?:maybe|perhaps|possibly|probably)\b/i, weight: 0.5, label: "uncertainty-hedge" },
	{ regex: /\b(?:might|could|would)\s+(?:be|have|work|cause)\b/i, weight: 0.5, label: "speculative-modal" },
	{ regex: /\b(?:what\s+if|suppose|hypothetic|in\s+theory)\b/i, weight: 0.6, label: "hypothetical" },
	{ regex: /\b(?:i\s+think|i\s+believe|i\s+suspect|i\s+guess)\b/i, weight: 0.4, label: "subjective-belief" },
	{ regex: /\b(?:assuming|presumably|likely|unlikely)\b/i, weight: 0.4, label: "assumption" },
	{ regex: /\b(?:one\s+approach|another\s+option|alternatively|or\s+we\s+could)\b/i, weight: 0.4, label: "alternative-exploration" },
	{ regex: /\b(?:let'?s\s+try|worth\s+(?:trying|exploring|considering))\b/i, weight: 0.3, label: "exploratory" },
	{ regex: /\b(?:should\s+(?:probably|ideally|theoretically))\b/i, weight: 0.4, label: "qualified-should" },
	{ regex: /\b(?:seems?\s+(?:like|to\s+be)|appears?\s+(?:to|that))\b/i, weight: 0.3, label: "appearance-hedge" },
	{ regex: /\b(?:not\s+sure|uncertain|unclear)\b/i, weight: 0.5, label: "explicit-uncertainty" },
];

/** Nidra -- absence, void, null results. "Nothing found" as first-class knowledge. */
const NIDRA_PATTERNS: DetectionPattern[] = [
	{ regex: /\b(?:not?\s+found|no\s+(?:results?|matches?|entries|records?|files?|data))\b/i, weight: 0.6, label: "not-found" },
	{ regex: /\b(?:empty|blank|void|null|nil|undefined|none|nothing)\b/i, weight: 0.5, label: "empty-value" },
	{ regex: /\b(?:does\s+not\s+exist|doesn'?t\s+exist|no\s+such)\b/i, weight: 0.7, label: "nonexistence" },
	{ regex: /\b(?:0\s+results?|zero\s+(?:results?|matches?|hits?))\b/i, weight: 0.6, label: "zero-results" },
	{ regex: /\b404\b/i, weight: 0.6, label: "http-404" },
	{ regex: /\b(?:missing|absent|unavailable|not\s+available)\b/i, weight: 0.5, label: "missing" },
	{ regex: /\b(?:no\s+output|silent|timed?\s+out\s+with\s+no)\b/i, weight: 0.5, label: "no-output" },
	{ regex: /\[\s*\]/i, weight: 0.6, label: "empty-array" },
	{ regex: /\{\s*\}/i, weight: 0.5, label: "empty-object" },
	{ regex: /^$/i, weight: 0.8, label: "empty-string" },
];

/** Smriti -- recall from memory/cache, not freshly observed. */
const SMRITI_PATTERNS: DetectionPattern[] = [
	{ regex: /\b(?:as\s+mentioned|as\s+noted|as\s+discussed|as\s+(?:we\s+)?(?:said|stated))\b/i, weight: 0.6, label: "back-reference" },
	{ regex: /\b(?:from\s+(?:earlier|before|previous|last\s+(?:session|time|conversation)))\b/i, weight: 0.6, label: "temporal-reference" },
	{ regex: /\b(?:recall(?:ing)?|remember(?:ing)?|recollect)\b/i, weight: 0.5, label: "recall-verb" },
	{ regex: /\b(?:previously|earlier\s+(?:we|you|I)|in\s+(?:a|the)\s+previous)\b/i, weight: 0.5, label: "previous-reference" },
	{ regex: /\b(?:cached|from\s+(?:cache|memory|history))\b/i, weight: 0.6, label: "cache-source" },
	{ regex: /\b(?:already\s+(?:know|knew|established|discussed|covered))\b/i, weight: 0.5, label: "already-known" },
	{ regex: /\b(?:you\s+(?:told|mentioned|said)\s+(?:me|that|before))\b/i, weight: 0.5, label: "user-told" },
	{ regex: /\b(?:retrieved|looked\s+up|found\s+in\s+(?:memory|notes|records))\b/i, weight: 0.5, label: "retrieved" },
];

// ─── Pattern Matching Engine ────────────────────────────────────────────────

interface MatchResult {
	type: VrittiType;
	confidence: number;
	matched: string[];
}

const PATTERN_MAP: Record<VrittiType, DetectionPattern[]> = {
	pramana: PRAMANA_PATTERNS,
	viparyaya: VIPARYAYA_PATTERNS,
	vikalpa: VIKALPA_PATTERNS,
	nidra: NIDRA_PATTERNS,
	smriti: SMRITI_PATTERNS,
};

/**
 * Run all pattern sets against content, returning a scored result per vritti.
 * The vritti with the highest aggregate score wins.
 */
function matchPatterns(content: string): MatchResult[] {
	const results: MatchResult[] = [];

	for (const type of VRITTI_TYPES) {
		const patterns = PATTERN_MAP[type];
		let totalWeight = 0;
		const matched: string[] = [];

		for (const p of patterns) {
			if (p.regex.test(content)) {
				totalWeight += p.weight;
				matched.push(p.label);
			}
		}

		if (matched.length > 0) {
			results.push({
				type,
				confidence: Math.min(1, totalWeight),
				matched,
			});
		}
	}

	// Sort by confidence descending
	results.sort((a, b) => b.confidence - a.confidence);
	return results;
}

// ─── Tool Classification Helpers ────────────────────────────────────────────

/** Tools whose successful output is direct observation (pratyaksha). */
const PRATYAKSHA_TOOLS = new Set([
	"read", "bash", "grep", "glob", "ls", "find", "cat", "head", "tail",
	"file_read", "file_search", "execute_command", "run_terminal_cmd",
]);

/** Tools whose output is from memory/recall. */
const SMRITI_TOOLS = new Set([
	"memory_search", "session_list", "session_show", "recall",
	"search_memory", "get_memory", "chitragupta_memory_search",
]);

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
	 *
	 * @param content - The text to classify.
	 * @param context - Contextual information for classification.
	 * @returns A VrittiClassification with type, confidence, and matched patterns.
	 */
	classify(content: string, context: ClassificationContext): VrittiClassification {
		const now = Date.now();
		const snippet = content.slice(0, this.cfg.snippetMaxLength);

		// Step 1: Context-based pre-classification (strong signals)
		let preType: VrittiType | null = null;
		let preConfidence = 0;
		const prePatterns: string[] = [];

		// Memory source => smriti
		if (context.fromMemory || context.source === "memory") {
			preType = "smriti";
			preConfidence = 0.7;
			prePatterns.push("context:from-memory");
		}

		// Error flag => viparyaya
		if (context.isError) {
			preType = "viparyaya";
			preConfidence = 0.6;
			prePatterns.push("context:error-flag");
		}

		// Empty content => nidra
		if (content.trim().length === 0) {
			const id = fnv1a("nidra:" + now.toString());
			const classification: VrittiClassification = {
				id,
				type: "nidra",
				confidence: 0.9,
				matchedPatterns: ["context:empty-content"],
				contentSnippet: "",
				toolName: context.toolName,
				classifiedAt: now,
				history: [],
			};
			this.store(classification);
			return classification;
		}

		// Step 2: Pattern-based classification
		const matches = matchPatterns(content);

		// Step 3: Tool-based boost
		if (context.source === "tool" && context.toolName) {
			if (PRATYAKSHA_TOOLS.has(context.toolName) && !context.isError) {
				// Boost pramana for direct-observation tools
				const pramanaMatch = matches.find((m) => m.type === "pramana");
				if (pramanaMatch) {
					pramanaMatch.confidence = Math.min(1, pramanaMatch.confidence + 0.2);
					pramanaMatch.matched.push("tool:pratyaksha-source");
				} else {
					// Tool output from observation tool is pramana by default
					matches.push({
						type: "pramana",
						confidence: 0.5,
						matched: ["tool:pratyaksha-source"],
					});
				}
			}
			if (SMRITI_TOOLS.has(context.toolName)) {
				const smritiMatch = matches.find((m) => m.type === "smriti");
				if (smritiMatch) {
					smritiMatch.confidence = Math.min(1, smritiMatch.confidence + 0.3);
					smritiMatch.matched.push("tool:memory-source");
				} else {
					matches.push({
						type: "smriti",
						confidence: 0.7,
						matched: ["tool:memory-source"],
					});
				}
			}
		}

		// Re-sort after boosts
		matches.sort((a, b) => b.confidence - a.confidence);

		// Step 4: Resolve winner
		let winnerType: VrittiType;
		let winnerConfidence: number;
		let winnerPatterns: string[];

		if (matches.length > 0) {
			const top = matches[0];
			if (preType && preConfidence > top.confidence) {
				winnerType = preType;
				winnerConfidence = preConfidence;
				winnerPatterns = prePatterns;
			} else {
				winnerType = top.type;
				winnerConfidence = top.confidence;
				winnerPatterns = top.matched;
			}
		} else if (preType) {
			winnerType = preType;
			winnerConfidence = preConfidence;
			winnerPatterns = prePatterns;
		} else {
			// Default: user statements with no strong signal are pramana
			// (direct perception of user intent), assistant statements are vikalpa
			// (reasoning/construction)
			if (context.source === "user") {
				winnerType = "pramana";
				winnerConfidence = 0.3;
				winnerPatterns = ["default:user-statement"];
			} else {
				winnerType = "vikalpa";
				winnerConfidence = 0.3;
				winnerPatterns = ["default:assistant-reasoning"];
			}
		}

		// Apply minimum confidence filter -- still classify, but note low confidence
		if (winnerConfidence < this.cfg.minConfidence) {
			winnerPatterns.push("low-confidence");
		}

		const id = fnv1a(winnerType + ":" + content.slice(0, 100) + ":" + now.toString());
		const classification: VrittiClassification = {
			id,
			type: winnerType,
			confidence: winnerConfidence,
			matchedPatterns: winnerPatterns,
			contentSnippet: snippet,
			toolName: context.toolName,
			classifiedAt: now,
			history: [],
		};

		this.store(classification);
		return classification;
	}

	/**
	 * Classify a tool execution result.
	 *
	 * Convenience method that wraps classify() with tool-specific context,
	 * handling the common case of classifying tool outputs.
	 *
	 * @param toolName - The tool that produced the result.
	 * @param result - The tool result (stringified if not a string).
	 * @param isError - Whether the tool call was an error.
	 * @returns A VrittiClassification.
	 */
	classifyToolResult(toolName: string, result: unknown, isError: boolean): VrittiClassification {
		const content = typeof result === "string"
			? result
			: result === null || result === undefined
				? ""
				: JSON.stringify(result);

		return this.classify(content, {
			source: "tool",
			toolName,
			isError,
		});
	}

	// ── Reclassification ──────────────────────────────────────────────────

	/**
	 * Reclassify a previously classified entry when new evidence emerges.
	 *
	 * For example, when a "pramana" (fact) is later contradicted, it should
	 * be reclassified as "viparyaya" (error). The original classification
	 * is preserved in the history array for audit trail.
	 *
	 * @param id - The classification ID to reclassify.
	 * @param newType - The new vritti type.
	 * @param reason - Why this reclassification is happening.
	 * @throws Error if the classification ID is not found.
	 */
	reclassify(id: string, newType: VrittiType, reason: string): void {
		const existing = this.classifications.get(id);
		if (!existing) {
			throw new Error(`Classification not found: ${id}`);
		}

		const oldType = existing.type;
		if (oldType === newType) return; // No-op if same type

		existing.history.push({
			from: oldType,
			to: newType,
			reason,
			at: Date.now(),
		});
		existing.type = newType;
		this.totalReclassified++;
	}

	// ── Retrieval Scoring ─────────────────────────────────────────────────

	/**
	 * Get the confidence weight for a vritti type, used in retrieval scoring.
	 *
	 * Higher weights mean the knowledge is more trustworthy for retrieval:
	 *   pramana=1.0, smriti=0.85, nidra=0.7, vikalpa=0.5, viparyaya=0.3
	 *
	 * @param type - The vritti type.
	 * @returns The confidence weight [0, 1].
	 */
	getConfidenceWeight(type: VrittiType): number {
		return this.cfg.confidenceWeights[type];
	}

	/**
	 * Get the classification for a given ID, or undefined if not found.
	 */
	getClassification(id: string): VrittiClassification | undefined {
		return this.classifications.get(id);
	}

	/**
	 * Get all classifications of a specific vritti type.
	 */
	getByType(type: VrittiType): VrittiClassification[] {
		const result: VrittiClassification[] = [];
		for (const c of this.classifications.values()) {
			if (c.type === type) result.push(c);
		}
		return result;
	}

	// ── Statistics ─────────────────────────────────────────────────────────

	/**
	 * Get distribution statistics across all five vritti types.
	 *
	 * Returns counts, percentages, and average confidence per type.
	 */
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
			avgConfidence[type] = counts[type] > 0
				? confidenceSums[type] / counts[type]
				: 0;
		}

		return {
			total,
			counts,
			percentages,
			avgConfidence,
			reclassifications: this.totalReclassified,
		};
	}

	// ── Persistence ───────────────────────────────────────────────────────

	/**
	 * Serialize the full state for persistence (JSON-safe).
	 */
	serialize(): VrittiSerializedState {
		return {
			classifications: [...this.classifications.values()],
			totalClassified: this.totalClassified,
			totalReclassified: this.totalReclassified,
			exportedAt: Date.now(),
		};
	}

	/**
	 * Restore state from a serialized snapshot.
	 * Clears current state before restoring.
	 */
	deserialize(state: VrittiSerializedState): void {
		this.classifications.clear();
		for (const c of state.classifications) {
			this.classifications.set(c.id, c);
		}
		this.totalClassified = state.totalClassified;
		this.totalReclassified = state.totalReclassified;
	}

	/**
	 * Clear all classifications and reset counters.
	 */
	clear(): void {
		this.classifications.clear();
		this.totalClassified = 0;
		this.totalReclassified = 0;
	}

	// ── Internal ──────────────────────────────────────────────────────────

	/** Store a classification, enforcing maxClassifications by evicting oldest. */
	private store(c: VrittiClassification): void {
		this.classifications.set(c.id, c);
		this.totalClassified++;

		// Evict oldest when over limit
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
