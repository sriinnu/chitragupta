/**
 * @chitragupta/smriti — Consolidation Scoring & Merge Logic
 *
 * This module contains the hashing, text similarity, and rule merge logic
 * that was extracted from ConsolidationEngine. It provides deterministic
 * rule ID generation (FNV-1a), bigram-based text similarity scoring, and
 * the merge algorithm that reconciles candidate rules with existing rules
 * (reinforcing, creating, or weakening).
 */

import type { Session } from "./types.js";
import type {
	RuleCategory,
	KnowledgeRule,
	DetectedPattern,
} from "./consolidation.js";

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

/** FNV-1a offset basis for 32-bit. */
const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a prime for 32-bit. */
const FNV_PRIME = 0x01000193;

/**
 * Compute a 32-bit FNV-1a hash of the input string, returned as a
 * zero-padded hex string.
 *
 * @param input - The string to hash.
 * @returns An 8-character hex string.
 */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	// Convert to unsigned 32-bit then to hex
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Generate a deterministic rule ID from category and normalized rule text.
 * The same rule always produces the same ID.
 *
 * @param category - The rule category.
 * @param ruleText - The rule text (will be normalized).
 * @returns A deterministic rule ID string.
 */
export function generateRuleId(category: RuleCategory, ruleText: string): string {
	const normalized = ruleText.toLowerCase().trim().replace(/\s+/g, " ");
	return `rule-${category}-${fnv1a(category + ":" + normalized)}`;
}

// ─── Text Similarity ────────────────────────────────────────────────────────

/**
 * Compute bigram-based Dice coefficient similarity between two strings.
 * Returns a value in [0, 1] where 1 means identical bigram sets.
 *
 * This is a lightweight alternative to cosine similarity that works well
 * for short natural-language rule descriptions without needing embeddings.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Similarity score in [0, 1].
 */
export function textSimilarity(a: string, b: string): number {
	const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
	const na = normalize(a);
	const nb = normalize(b);

	if (na === nb) return 1.0;
	if (na.length < 2 || nb.length < 2) return 0.0;

	const bigrams = (s: string): Map<string, number> => {
		const map = new Map<string, number>();
		for (let i = 0; i < s.length - 1; i++) {
			const bg = s.substring(i, i + 2);
			map.set(bg, (map.get(bg) ?? 0) + 1);
		}
		return map;
	};

	const bga = bigrams(na);
	const bgb = bigrams(nb);

	let intersection = 0;
	for (const [bg, count] of bga) {
		intersection += Math.min(count, bgb.get(bg) ?? 0);
	}

	const totalA = na.length - 1;
	const totalB = nb.length - 1;

	return (2 * intersection) / (totalA + totalB);
}

// ─── Merge Logic ────────────────────────────────────────────────────────────

/** Minimum text similarity score to consider two rules as matching. */
const SIMILARITY_THRESHOLD = 0.8;

/**
 * Merge candidate rules with an existing rules map.
 *
 * For each candidate:
 * - If it matches an existing rule (text similarity >= 0.8), reinforce it.
 * - If no match is found, add it as a new rule.
 *
 * Also checks for contradiction: if new patterns contradict existing rules,
 * the existing rules are weakened.
 *
 * @param candidates - New candidate rules from pattern detection.
 * @param allPatterns - All detected patterns (for contradiction checking).
 * @param rules - The existing rules map (mutated in place).
 * @returns Object with new, reinforced, and weakened rule arrays.
 */
export function mergeWithExisting(
	candidates: KnowledgeRule[],
	allPatterns: DetectedPattern[],
	rules: Map<string, KnowledgeRule>,
): {
	newRules: KnowledgeRule[];
	reinforcedRules: KnowledgeRule[];
	weakenedRules: KnowledgeRule[];
} {
	const newRules: KnowledgeRule[] = [];
	const reinforcedRules: KnowledgeRule[] = [];
	const weakenedRules: KnowledgeRule[] = [];

	for (const candidate of candidates) {
		let bestMatch: KnowledgeRule | null = null;
		let bestSimilarity = 0;

		for (const existing of rules.values()) {
			const sim = textSimilarity(candidate.rule, existing.rule);
			if (sim > bestSimilarity) {
				bestSimilarity = sim;
				bestMatch = existing;
			}
		}

		if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
			// Reinforce existing rule
			bestMatch.observationCount += candidate.observationCount;
			bestMatch.confidence = Math.min(
				1.0,
				bestMatch.confidence + 0.1 * candidate.observationCount,
			);
			bestMatch.lastReinforcedAt = candidate.lastReinforcedAt;
			// Merge source sessions
			const sessionSet = new Set([
				...bestMatch.sourceSessionIds,
				...candidate.sourceSessionIds,
			]);
			bestMatch.sourceSessionIds = [...sessionSet];
			// Merge tags
			const tagSet = new Set([...bestMatch.tags, ...candidate.tags]);
			bestMatch.tags = [...tagSet];
			reinforcedRules.push({ ...bestMatch });
		} else {
			// New rule — add it
			rules.set(candidate.id, candidate);
			newRules.push({ ...candidate });
		}
	}

	// Check for contradictions: correction patterns may weaken existing rules
	for (const pattern of allPatterns) {
		if (pattern.type === "correction") {
			for (const existing of rules.values()) {
				// If a correction mentions content similar to an existing rule's text,
				// and the correction seems to contradict it, weaken the rule
				const correctionText = pattern.description.toLowerCase();
				const ruleText = existing.rule.toLowerCase();

				// Simple heuristic: if the correction contains "not" + words from the rule
				if (correctionText.includes("not") || correctionText.includes("wrong")) {
					const ruleWords = ruleText.split(/\s+/).filter((w) => w.length > 3);
					const matchingWords = ruleWords.filter((w) => correctionText.includes(w));
					if (matchingWords.length >= 2 && !reinforcedRules.some((r) => r.id === existing.id)) {
						existing.confidence = Math.max(0, existing.confidence - 0.15);
						weakenedRules.push({ ...existing });
					}
				}
			}
		}
	}

	return { newRules, reinforcedRules, weakenedRules };
}

/**
 * Convert a detected pattern into a candidate KnowledgeRule.
 *
 * @param pattern - The detected pattern.
 * @param sessions - Sessions that were analyzed (for extracting IDs).
 * @param timestamp - Current timestamp.
 * @returns A KnowledgeRule candidate.
 */
export function patternToRule(
	pattern: DetectedPattern,
	sessions: Session[],
	timestamp: string,
): KnowledgeRule {
	const categoryMap: Record<DetectedPattern["type"], RuleCategory> = {
		"tool-sequence": "workflow",
		"preference": "preference",
		"decision": "decision",
		"correction": "correction",
		"convention": "convention",
	};

	const category = categoryMap[pattern.type];
	const id = generateRuleId(category, pattern.description);

	// Extract session IDs from evidence
	const sessionIds = sessions
		.filter((s) =>
			pattern.evidence.some((e) => e.includes(s.meta.title)),
		)
		.map((s) => s.meta.id);

	return {
		id,
		rule: pattern.description,
		derivation: `Detected from ${pattern.frequency} session(s): ${pattern.evidence.slice(0, 3).join("; ")}`,
		category,
		observationCount: pattern.frequency,
		confidence: pattern.confidence,
		sourceSessionIds: sessionIds,
		createdAt: timestamp,
		lastReinforcedAt: timestamp,
		tags: [pattern.type, category],
	};
}

/**
 * Enforce the maximum rules limit by removing lowest-confidence rules.
 *
 * @param rules - The rules map to enforce limits on (mutated in place).
 * @param maxRules - The maximum number of rules to retain.
 */
export function enforceMaxRules(
	rules: Map<string, KnowledgeRule>,
	maxRules: number,
): void {
	if (rules.size <= maxRules) return;

	const sorted = [...rules.entries()]
		.sort(([, a], [, b]) => b.confidence - a.confidence);

	const toKeep = new Set(
		sorted.slice(0, maxRules).map(([id]) => id),
	);

	for (const id of rules.keys()) {
		if (!toKeep.has(id)) {
			rules.delete(id);
		}
	}
}
