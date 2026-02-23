/**
 * @module agent-skills-fingerprint
 * @description LSH Skill Fingerprinting via SimHash (Charikar 2002).
 *
 * Each skill receives a 64-bit SimHash fingerprint computed from TF-IDF
 * weighted unigrams and bigrams of (description + tags). This enables:
 *
 * - **O(1) near-duplicate detection** via Hamming distance
 * - **Fast similarity search** without embedding models
 *
 * ### Mathematical Formulation
 *
 * Given feature set F with TF-IDF weights w_f:
 *
 *   V = [0]^64
 *   for each f in F:
 *     h = FNV-1a_64(f)
 *     for i in 0..63:
 *       V[i] += w_f  if bit(h, i) = 1
 *       V[i] -= w_f  if bit(h, i) = 0
 *   SimHash = { bit i = 1 if V[i] > 0, else 0 }
 *
 * @packageDocumentation
 */

import type { SkillManifest } from "./types.js";

/** A loaded skill entry carrying its SimHash fingerprint. */
export interface AgentSkillEntry {
	/** The parsed skill manifest. */
	manifest: SkillManifest;
	/** 64-bit SimHash fingerprint (Charikar 2002). */
	simhash: bigint;
}

// ── FNV-1a 64-bit Constants ──────────────────────────────────────────────────

/** FNV-1a offset basis for 64-bit. */
const FNV64_OFFSET = 0xcbf29ce484222325n;
/** FNV-1a prime for 64-bit. */
const FNV64_PRIME = 0x100000001b3n;
/** 64-bit mask for BigInt arithmetic. */
const MASK64 = (1n << 64n) - 1n;

/**
 * FNV-1a hash producing a 64-bit fingerprint via BigInt.
 *
 * FNV-1a (Fowler-Noll-Vo variant 1a):
 *   hash = offset_basis
 *   for each byte b:
 *     hash = hash XOR b
 *     hash = hash * FNV_prime   (mod 2^64)
 *
 * @param str - Input string to hash.
 * @returns 64-bit hash as BigInt.
 */
export function fnv1a64(str: string): bigint {
	let h = FNV64_OFFSET;
	for (let i = 0; i < str.length; i++) {
		h ^= BigInt(str.charCodeAt(i));
		h = (h * FNV64_PRIME) & MASK64;
	}
	return h;
}

// ── Text Processing ──────────────────────────────────────────────────────────

/** Stop words excluded from feature extraction. */
const STOP_WORDS = new Set([
	"a", "an", "the", "and", "or", "for", "to", "of", "in", "on",
	"is", "it", "that", "this", "with", "from", "as", "by", "at",
	"be", "are", "was", "were", "been", "not", "no", "do", "does",
	"when", "what", "which", "who", "how", "all", "each", "every",
]);

/** Tokenize text into lowercase alphanumeric tokens, filtering stop words. */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Extract unigrams and bigrams from text as feature strings. */
export function extractFeatures(text: string, tags: string[]): string[] {
	const tokens = tokenize(text);
	const features: string[] = [];
	for (const t of tokens) features.push(t);
	for (let i = 0; i < tokens.length - 1; i++) {
		features.push(`${tokens[i]} ${tokens[i + 1]}`);
	}
	for (const tag of tags) {
		features.push(`tag:${tag.toLowerCase()}`);
	}
	return features;
}

// ── TF-IDF ───────────────────────────────────────────────────────────────────

/**
 * Compute TF-IDF weights for features across a corpus.
 *
 * TF(t, d) = count(t in d) / |d|
 * IDF(t) = ln(N / (1 + df(t)))     (smoothed)
 *
 * @param featureSets - Array of feature arrays (one per document).
 * @returns Per-document maps of feature -> TF-IDF weight.
 */
export function computeTfIdf(featureSets: string[][]): Map<string, number>[] {
	const N = featureSets.length;
	const df = new Map<string, number>();
	for (const features of featureSets) {
		const seen = new Set(features);
		for (const f of seen) {
			df.set(f, (df.get(f) ?? 0) + 1);
		}
	}
	return featureSets.map((features) => {
		const tf = new Map<string, number>();
		for (const f of features) {
			tf.set(f, (tf.get(f) ?? 0) + 1);
		}
		const weights = new Map<string, number>();
		const len = features.length || 1;
		for (const [term, count] of tf) {
			const tfVal = count / len;
			const idfVal = Math.log(N / (1 + (df.get(term) ?? 0)));
			weights.set(term, tfVal * idfVal);
		}
		return weights;
	});
}

// ── SimHash (Charikar 2002) ──────────────────────────────────────────────────

/**
 * Compute a 64-bit SimHash fingerprint.
 *
 * Algorithm:
 *   V = [0]^64
 *   for each feature f with weight w:
 *     h = FNV-1a_64(f)
 *     for i = 0..63:
 *       V[i] += w  if bit(h, i) = 1
 *       V[i] -= w  otherwise
 *   return { bit i = (V[i] > 0) ? 1 : 0 }
 *
 * @param features - Feature strings to hash.
 * @param weights - Map of feature -> TF-IDF weight. Unit weight if absent.
 * @returns 64-bit SimHash as BigInt.
 */
export function computeSimHash(
	features: string[],
	weights?: Map<string, number>,
): bigint {
	const V = new Float64Array(64);
	for (const f of features) {
		const h = fnv1a64(f);
		const w = weights?.get(f) ?? 1.0;
		for (let i = 0; i < 64; i++) {
			if ((h >> BigInt(i)) & 1n) {
				V[i] += w;
			} else {
				V[i] -= w;
			}
		}
	}
	let fingerprint = 0n;
	for (let i = 0; i < 64; i++) {
		if (V[i] > 0) {
			fingerprint |= 1n << BigInt(i);
		}
	}
	return fingerprint;
}

/**
 * Popcount (Hamming weight) of a 64-bit BigInt.
 * Uses the parallel bit-counting algorithm adapted for BigInt.
 */
function popcount64(x: bigint): number {
	x = x & MASK64;
	x = x - ((x >> 1n) & 0x5555555555555555n);
	x = (x & 0x3333333333333333n) + ((x >> 2n) & 0x3333333333333333n);
	x = (x + (x >> 4n)) & 0x0f0f0f0f0f0f0f0fn;
	x = (x * 0x0101010101010101n) & MASK64;
	return Number(x >> 56n);
}

/**
 * Compute similarity between two SimHash fingerprints via normalized
 * Hamming distance: similarity(a, b) = 1 - hammingDistance(a, b) / 64.
 *
 * @returns Normalized similarity in [0, 1] where 1 = identical.
 */
export function skillSimilarity(a: bigint, b: bigint): number {
	const hamming = popcount64(a ^ b);
	return 1 - hamming / 64;
}
