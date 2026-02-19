/**
 * @chitragupta/anina/chetana — Sankalpa internal computations.
 *
 * FNV-1a hashing, keyword extraction, word overlap, intent pattern
 * matching, priority escalation, and capacity enforcement. All pure
 * or side-effect-free functions operating on passed-in data structures.
 */

import type { ChetanaConfig, Intention, IntentionPriority } from "./types.js";
import { SYSTEM_MAX_EVIDENCE, SYSTEM_MAX_INTENTIONS } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** FNV-1a 32-bit offset basis. */
export const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
export const FNV_PRIME = 0x01000193;

/** Minimum word overlap ratio for deduplication. */
export const DEDUP_THRESHOLD = 0.5;

/** Mention count threshold for normal -> high escalation. */
export const ESCALATION_HIGH = 3;

/** Mention count threshold for high -> critical escalation. */
export const ESCALATION_CRITICAL = 5;

/** Minimum matching keywords to advance progress from a tool result. */
export const KEYWORD_MATCH_THRESHOLD = 2;

/** Progress increment per matching tool result. */
export const PROGRESS_INCREMENT = 0.1;

/**
 * Intent signal patterns (case-insensitive).
 * Each prefix signals a user intention; text after the match becomes the goal.
 */
export const INTENT_PATTERNS: readonly string[] = [
	"i want to ",
	"let's ",
	"let us ",
	"goal is ",
	"we need to ",
	"fix the ",
	"add a ",
	"add an ",
	"implement ",
	"create a ",
	"build a ",
	"write a ",
	"remove ",
	"delete ",
	"update ",
	"change ",
	"make ",
	"refactor ",
];

/** Sentence boundary characters for goal extraction. */
export const SENTENCE_BOUNDARIES = new Set([".", "!", "?", ","]);

/** Stop words filtered out during keyword extraction. */
const STOP_WORDS = new Set([
	"the", "a", "an", "is", "are", "was", "were", "be", "been",
	"being", "have", "has", "had", "do", "does", "did", "will",
	"would", "could", "should", "may", "might", "shall", "can",
	"to", "of", "in", "for", "on", "with", "at", "by", "from",
	"and", "or", "but", "not", "this", "that", "it", "its",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash. Produces a deterministic hex string ID from text. */
export function fnv1a(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash.toString(16);
}

/** Extract keywords from a goal string, filtering stop words and short tokens. */
export function extractKeywords(goal: string): Set<string> {
	const words = goal.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const keywords = new Set<string>();
	for (const word of words) {
		if (word.length >= 3 && !STOP_WORDS.has(word)) keywords.add(word);
	}
	return keywords;
}

/** Compute word overlap ratio between two strings (fraction of smaller set in larger). */
export function wordOverlap(a: string, b: string): number {
	const wordsA = extractKeywords(a);
	const wordsB = extractKeywords(b);
	if (wordsA.size === 0 || wordsB.size === 0) return 0;
	const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
	let overlap = 0;
	for (const word of smaller) { if (larger.has(word)) overlap++; }
	return overlap / smaller.size;
}

// ─── Pattern Matching ───────────────────────────────────────────────────────

/** Extract text from a starting index until the next sentence boundary. */
export function extractUntilBoundary(text: string, start: number): string {
	let end = start;
	while (end < text.length && !SENTENCE_BOUNDARIES.has(text[end])) end++;
	return text.slice(start, end).trim();
}

/** Scan message text for intent signal patterns and extract raw goal strings. */
export function matchPatterns(message: string): string[] {
	const lower = message.toLowerCase();
	const goals: string[] = [];
	for (const pattern of INTENT_PATTERNS) {
		let searchFrom = 0;
		while (searchFrom < lower.length) {
			const idx = lower.indexOf(pattern, searchFrom);
			if (idx === -1) break;
			const start = idx + pattern.length;
			const goalText = extractUntilBoundary(message, start);
			if (goalText.length > 0) goals.push(goalText);
			searchFrom = start;
		}
	}
	return goals;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

/** Find an existing active/paused intention similar to the given goal. */
export function findSimilar(
	goal: string,
	intentions: Map<string, Intention>,
): Intention | null {
	for (const intention of intentions.values()) {
		if (intention.status !== "active" && intention.status !== "paused") continue;
		if (wordOverlap(goal, intention.goal) >= DEDUP_THRESHOLD) return intention;
	}
	return null;
}

// ─── Priority Escalation ────────────────────────────────────────────────────

/**
 * Escalate an intention's priority based on mention count.
 * Returns the previous priority if changed (for event emission), or null.
 */
export function escalatePriority(intention: Intention): IntentionPriority | null {
	const prev = intention.priority;
	if (intention.mentionCount >= ESCALATION_CRITICAL && intention.priority === "high") {
		intention.priority = "critical";
	} else if (intention.mentionCount >= ESCALATION_HIGH && intention.priority === "normal") {
		intention.priority = "high";
	}
	if (intention.status === "paused") {
		intention.status = "active";
		intention.staleTurns = 0;
	}
	return intention.priority !== prev ? prev : null;
}

// ─── Capacity Enforcement ───────────────────────────────────────────────────

/** Enforce the maximum intentions cap by evicting the lowest-value intention. */
export function enforceCapacity(
	intentions: Map<string, Intention>,
	config: ChetanaConfig,
): void {
	const maxIntentions = Math.min(config.maxIntentions, SYSTEM_MAX_INTENTIONS);
	if (intentions.size < maxIntentions) return;

	const priorityRank: Record<IntentionPriority, number> = { low: 0, normal: 1, high: 2, critical: 3 };
	const statusRank: Record<string, number> = { abandoned: 0, paused: 1, achieved: 2, active: 3 };

	let victim: Intention | null = null;
	let victimScore = Infinity;
	for (const intention of intentions.values()) {
		const score = statusRank[intention.status] * 100 +
			priorityRank[intention.priority] * 10 +
			(1 - intention.createdAt / Date.now()) * 1;
		if (score < victimScore) { victimScore = score; victim = intention; }
	}
	if (victim) intentions.delete(victim.id);
}

/** Maximum evidence entries per intention (clamped to system ceiling). */
export function maxEvidence(config: ChetanaConfig): number {
	return Math.min(config.maxEvidencePerIntention, SYSTEM_MAX_EVIDENCE);
}
