/**
 * @chitragupta/smriti — Vidhi Matching & NLU
 *
 * Provides trigger-phrase extraction (verb-object NLU), text tokenization,
 * and Thompson Sampling utilities used by the VidhiEngine for query matching
 * and exploration-exploitation ranking.
 *
 * Extracted from vidhi-engine.ts to keep modules under 450 LOC.
 */

import type { Vidhi } from "./types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Action verbs for trigger-phrase extraction. */
export const ACTION_VERBS = new Set([
	"add", "create", "make", "build", "write", "generate", "setup", "configure",
	"run", "execute", "start", "launch", "deploy", "test", "check", "verify",
	"fix", "debug", "patch", "repair", "resolve", "update", "upgrade", "modify",
	"change", "edit", "refactor", "rename", "move", "delete", "remove", "drop",
	"install", "uninstall", "import", "export", "migrate", "convert", "transform",
	"search", "find", "list", "show", "get", "fetch", "read", "open", "view",
	"commit", "push", "pull", "merge", "rebase", "branch", "tag", "release",
	"lint", "format", "clean", "reset", "init", "scaffold", "bootstrap",
]);

/** Stopwords for tokenization (filtered out during matching). */
const STOPWORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "do", "does", "did", "will", "would", "shall",
	"should", "may", "might", "must", "can", "could", "to", "of", "in",
	"for", "on", "with", "at", "by", "from", "as", "into", "through",
	"during", "before", "after", "above", "below", "between", "out",
	"off", "over", "under", "again", "further", "then", "once", "here",
	"there", "when", "where", "why", "how", "all", "each", "every",
	"both", "few", "more", "most", "other", "some", "such", "no", "nor",
	"not", "only", "own", "same", "so", "than", "too", "very", "just",
	"about", "up", "it", "its", "i", "me", "my", "we", "our", "you",
	"your", "he", "she", "they", "them", "this", "that", "these", "those",
	"and", "but", "or", "if", "while", "because", "until", "also",
	"please", "need", "want", "like",
]);

// ─── N-gram Instance (shared with extraction) ──────────────────────────────

/** A single n-gram instance with its tool calls and source session. */
export interface NgramInstance {
	sessionId: string;
	toolCalls: Array<{
		name: string;
		input: string;
		result: string;
		isError?: boolean;
	}>;
	precedingUserMessage: string;
}

// ─── Tokenization ───────────────────────────────────────────────────────────

/**
 * Tokenize a string into a set of lowercase words, filtering stopwords.
 *
 * Used by both trigger extraction and query matching to normalize text
 * for Jaccard similarity comparison.
 *
 * @param text - Raw text to tokenize.
 * @returns Deduplicated set of significant words.
 */
export function tokenize(text: string): Set<string> {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOPWORDS.has(w));

	return new Set(words);
}

// ─── Verb-Object NLU ────────────────────────────────────────────────────────

/**
 * Extract verb-object phrases from a user message.
 *
 * Simple NLU: split into words, find sequences starting with an action verb.
 * Returns bigrams and trigrams: "add endpoint", "run test suite", etc.
 *
 * @param message - Raw user message.
 * @returns Array of verb-object bigram and trigram phrases.
 */
export function extractVerbObjectPhrases(message: string): string[] {
	const words = message
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1);

	const phrases: string[] = [];

	for (let i = 0; i < words.length; i++) {
		if (!ACTION_VERBS.has(words[i])) continue;

		// Bigram: verb + object
		if (i + 1 < words.length) {
			phrases.push(`${words[i]} ${words[i + 1]}`);
		}

		// Trigram: verb + adj/prep + object
		if (i + 2 < words.length) {
			phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
		}
	}

	return phrases;
}

// ─── Trigger Extraction ─────────────────────────────────────────────────────

/**
 * Extract trigger phrases from the user messages preceding tool sequences.
 *
 * Strategy:
 *   - Tokenize each user message.
 *   - Find verb-object bigrams and trigrams where the first token is an action verb.
 *   - Deduplicate and return the top phrases ordered by frequency.
 *
 * @param instances - N-gram instances containing preceding user messages.
 * @returns Top 10 trigger phrases by frequency.
 */
export function extractTriggers(instances: NgramInstance[]): string[] {
	const phraseCounts = new Map<string, number>();

	for (const instance of instances) {
		const msg = instance.precedingUserMessage;
		if (!msg || msg.trim().length === 0) continue;

		const phrases = extractVerbObjectPhrases(msg);
		for (const phrase of phrases) {
			phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
		}
	}

	// Sort by frequency, take top 10
	const sorted = [...phraseCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([phrase]) => phrase);

	return sorted;
}

// ─── Thompson Sampling ──────────────────────────────────────────────────────

/**
 * Standard normal sample via Box-Muller transform.
 *
 * @returns A sample from the standard normal distribution N(0, 1).
 */
function standardNormal(): number {
	const u1 = Math.random();
	const u2 = Math.random();
	return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Sample from a Gamma(shape, 1) distribution using the Marsaglia-Tsang method.
 *
 * For shape >= 1: use the fast squeeze method.
 * For shape < 1: use the relation Gamma(a) = Gamma(a+1) * U^(1/a).
 *
 * @param shape - Shape parameter (must be > 0).
 * @returns A sample from Gamma(shape, 1).
 */
function sampleGamma(shape: number): number {
	if (shape < 1) {
		// Gamma(a) = Gamma(a+1) * U^(1/a)
		const u = Math.random();
		return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
	}

	// Marsaglia-Tsang method for shape >= 1
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);

	for (;;) {
		let x: number;
		let v: number;

		do {
			x = standardNormal();
			v = 1 + c * x;
		} while (v <= 0);

		v = v * v * v;
		const u = Math.random();

		if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
		if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
	}
}

/**
 * Sample from a Beta(alpha, beta) distribution using the gamma method.
 *
 * Beta(a, b) = X / (X + Y) where X ~ Gamma(a), Y ~ Gamma(b).
 *
 * This is a simple rejection-free method that works well for small alpha, beta
 * values typical in Thompson Sampling.
 *
 * @param alpha - First shape parameter (successes + 1).
 * @param beta - Second shape parameter (failures + 1).
 * @returns A sample from Beta(alpha, beta) in [0, 1].
 */
export function sampleBeta(alpha: number, beta: number): number {
	const x = sampleGamma(alpha);
	const y = sampleGamma(beta);
	const sum = x + y;
	if (sum < 1e-300 || !isFinite(sum)) return 0.5; // Degenerate case
	return x / sum;
}

// ─── Query Matching ─────────────────────────────────────────────────────────

/**
 * Match a user query to the best Vidhi using trigger phrases.
 *
 * Scoring:
 *   1. Extract verb-object tokens from the query.
 *   2. Compare against each Vidhi's trigger phrases via Jaccard similarity.
 *   3. Break ties with Thompson Sampling (sample from Beta distribution).
 *
 * @param vidhis - Candidate Vidhis to match against.
 * @param query - User query string.
 * @returns The best-matching Vidhi, or null if no match exceeds threshold.
 */
export function matchVidhi(vidhis: Vidhi[], query: string): Vidhi | null {
	if (vidhis.length === 0) return null;

	const queryTokens = tokenize(query);
	if (queryTokens.size === 0) return null;

	let bestVidhi: Vidhi | null = null;
	let bestScore = 0;

	for (const vidhi of vidhis) {
		// Jaccard similarity between query tokens and trigger tokens
		const triggerTokens = new Set<string>();
		for (const trigger of vidhi.triggers) {
			for (const tok of tokenize(trigger)) {
				triggerTokens.add(tok);
			}
		}

		if (triggerTokens.size === 0) continue;

		const intersection = new Set([...queryTokens].filter((t) => triggerTokens.has(t)));
		const union = new Set([...queryTokens, ...triggerTokens]);
		const jaccard = intersection.size / union.size;

		if (jaccard < 0.15) continue; // Below relevance threshold

		// Thompson Sampling: sample from Beta(alpha, beta)
		const alpha = vidhi.successCount + 1;
		const beta = vidhi.failureCount + 1;
		const thompsonSample = sampleBeta(alpha, beta);

		// Combined score: 70% trigger match + 30% Thompson sample
		const score = 0.7 * jaccard + 0.3 * thompsonSample;

		if (score > bestScore) {
			bestScore = score;
			bestVidhi = vidhi;
		}
	}

	return bestVidhi;
}
