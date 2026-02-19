/**
 * @chitragupta/smriti — Pancha Vritti Pattern Definitions & Matching Engine
 *
 * Detection patterns for the five vritti types (Yoga Sutras 1.5-11),
 * the pattern matching engine, and tool classification helpers.
 * Split from pancha-vritti.ts for file size compliance.
 *
 * @module pancha-vritti-patterns
 */

import type { VrittiType } from "./pancha-vritti.js";

// ─── FNV-1a ─────────────────────────────────────────────────────────────────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a hash for deterministic ID generation. */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Pattern Types ──────────────────────────────────────────────────────────

/** A single detection pattern with regex, weight, and label. */
interface DetectionPattern {
	regex: RegExp;
	weight: number;
	label: string;
}

/** Result of matching patterns against content for a single vritti type. */
export interface MatchResult {
	type: VrittiType;
	confidence: number;
	matched: string[];
}

// ─── Pattern Definitions ────────────────────────────────────────────────────

/** Pramana -- valid, grounded knowledge. Direct observation, verified facts. */
const PRAMANA_PATTERNS: DetectionPattern[] = [
	{ regex: /^(?:file|directory|path)\s+(?:exists|found|created|written|read)/i, weight: 0.6, label: "file-operation-success" },
	{ regex: /(?:test|spec|check)\s+(?:pass|passed|passing|succeeded|success)/i, weight: 0.7, label: "test-pass" },
	{ regex: /(?:compiled?|built?)\s+(?:success|without\s+errors)/i, weight: 0.6, label: "compile-success" },
	{ regex: /\b(?:verified|confirmed|validated|proven)\b/i, weight: 0.5, label: "verified-fact" },
	{ regex: /\b(?:the\s+(?:answer|result|output)\s+is)\b/i, weight: 0.4, label: "definitive-statement" },
	{ regex: /\bis\s+located\s+(?:at|in)\b/i, weight: 0.4, label: "location-fact" },
	{ regex: /\bversion\s+\d+/i, weight: 0.4, label: "version-fact" },
	{ regex: /\b(?:returns?|outputs?|produces?|yields?)\s+/i, weight: 0.3, label: "output-observation" },
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

/** All vritti types in sutra order (1.5-11). */
const VRITTI_TYPES_ORDERED: readonly VrittiType[] = [
	"pramana", "viparyaya", "vikalpa", "nidra", "smriti",
] as const;

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
export function matchPatterns(content: string): MatchResult[] {
	const results: MatchResult[] = [];

	for (const type of VRITTI_TYPES_ORDERED) {
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
export const PRATYAKSHA_TOOLS = new Set([
	"read", "bash", "grep", "glob", "ls", "find", "cat", "head", "tail",
	"file_read", "file_search", "execute_command", "run_terminal_cmd",
]);

/** Tools whose output is from memory/recall. */
export const SMRITI_TOOLS = new Set([
	"memory_search", "session_list", "session_show", "recall",
	"search_memory", "get_memory", "chitragupta_memory_search",
]);
