/**
 * @module fingerprint
 * @description Trait Vector Matching (TVM) — A 128-dimensional semantic
 * fingerprinting algorithm for skill discovery, requiring no LLM or external
 * embeddings. Pure algorithmic elegance.
 *
 * ## Inspiration: Shiksha (Vedic Phonetics)
 *
 * In the Vedic tradition, Shiksha is the science of phonetics — the first of
 * the six Vedangas (limbs of the Veda). The ancient phoneticians classified
 * every Sanskrit sound by precise articulatory features: place of articulation
 * (sthana), effort (prayatna), and resonance (anupradana). From these finite
 * features, all of spoken Sanskrit could be described.
 *
 * TVM follows the same principle: just as each phoneme has a unique
 * articulatory fingerprint, each skill has a unique semantic fingerprint
 * composed of 8 "articulatory features" (buckets), each contributing 16
 * dimensions to a 128-dimensional trait vector.
 *
 * ## Architecture: 8 Buckets x 16 Dimensions = 128 Total
 *
 * | Bucket | Dims    | Feature              | Analogy (Shiksha)          |
 * |--------|---------|----------------------|----------------------------|
 * | 0      | 0-15    | Name N-grams         | Varna (letter form)        |
 * | 1      | 16-31   | Description Tokens   | Artha (meaning)            |
 * | 2      | 32-47   | Parameter Types       | Vyakarana (grammar)        |
 * | 3      | 48-63   | Tag Hashes           | Jati (category)            |
 * | 4      | 64-79   | Capability Verbs     | Kriya (action)             |
 * | 5      | 80-95   | IO Schema Shape      | Rupa (form)                |
 * | 6      | 96-111  | Example Patterns     | Prayoga (usage)            |
 * | 7      | 112-127 | Metadata Signals     | Lakshana (characteristics) |
 *
 * ## Mathematical Formulation
 *
 * Given a skill manifest M, the trait vector T in R^128 is computed as:
 *
 *   T = L2_normalize(concat(B_0, B_1, ..., B_7))
 *
 * where each bucket B_i in R^16 is populated by hashing relevant features
 * into dimension indices via FNV-1a:
 *
 *   B_i[fnv1a(feature) mod 16] += weight(feature)
 *
 * The L2 normalization ensures ||T|| = 1, making cosine similarity
 * equivalent to the dot product:
 *
 *   sim(T_a, T_b) = T_a . T_b
 *
 * @packageDocumentation
 */

import {
	computeCapabilityVerbs,
	computeDescriptionTokens,
	computeExamplePatterns,
	computeIOSchemaShape,
	computeMetadataSignals,
	computeNameNgrams,
	computeParameterTypes,
	computeTagHashes,
} from "./buckets.js";
import type { SkillManifest, SkillQuery } from "./types.js";

/** Total number of dimensions in a trait vector. */
export const TRAIT_DIMENSIONS = 128;

/** Number of dimensions per bucket. */
export const BUCKET_SIZE = 16;

/** Number of buckets in the trait vector. */
const NUM_BUCKETS = 8;

// ─── FNV-1a Hash ────────────────────────────────────────────────────────────

/**
 * FNV-1a hash function — fast, well-distributed, and deterministic.
 *
 * Fowler-Noll-Vo hash variant 1a. Chosen for its excellent avalanche
 * properties and simplicity. Each input byte XORs into the hash state
 * before multiplication, ensuring single-bit changes in input propagate
 * across all output bits.
 *
 * Complexity: O(n) where n = str.length
 *
 * @param str - The string to hash.
 * @returns A 32-bit unsigned integer hash.
 */
export function fnv1a(str: string): number {
	let hash = 0x811c9dc5; // FNV offset basis (32-bit)
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		// FNV prime: 16777619 = 0x01000193
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// ─── L2 Normalization ───────────────────────────────────────────────────────

/**
 * L2-normalize a vector in-place so that ||v|| = 1.
 *
 * After normalization, cosine similarity between two normalized vectors
 * is equivalent to their dot product:
 *
 *   cos(a, b) = (a . b) / (||a|| * ||b||) = a . b  when ||a|| = ||b|| = 1
 *
 * Handles the zero-vector case by returning it unchanged (all zeros).
 *
 * @param v - The vector to normalize (modified in-place).
 * @returns The same Float32Array, now L2-normalized.
 */
function l2Normalize(v: Float32Array): Float32Array {
	let sumSq = 0;
	for (let i = 0; i < v.length; i++) {
		sumSq += v[i] * v[i];
	}
	if (sumSq === 0) return v;
	const invNorm = 1.0 / Math.sqrt(sumSq);
	for (let i = 0; i < v.length; i++) {
		v[i] *= invNorm;
	}
	return v;
}

/**
 * Copy a bucket's values into the correct offset within the full vector.
 */
function copyBucket(vector: Float32Array, bucketIndex: number, bucket: Float32Array): void {
	const offset = bucketIndex * BUCKET_SIZE;
	for (let d = 0; d < BUCKET_SIZE; d++) {
		vector[offset + d] = bucket[d];
	}
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Compute the 128-dimensional trait vector for a skill manifest.
 *
 * The vector is the L2-normalized concatenation of 8 feature buckets,
 * each capturing a different semantic facet of the skill.
 *
 * Time complexity: O(n) where n is the total size of all manifest fields.
 * Space complexity: O(128) = O(1) for the output vector.
 *
 * @param manifest - The skill manifest to fingerprint.
 * @returns A 128-dimensional Float32Array with ||v|| = 1.
 *
 * @example
 * ```ts
 * const vector = computeTraitVector(mySkill);
 * console.log(vector.length); // 128
 * console.log(Math.abs(dot(vector, vector) - 1.0) < 1e-6); // true (unit length)
 * ```
 */
export function computeTraitVector(manifest: SkillManifest): Float32Array {
	const vector = new Float32Array(TRAIT_DIMENSIONS);

	const buckets: Float32Array[] = [
		computeNameNgrams(manifest.name),
		computeDescriptionTokens([manifest.description, manifest.body].filter(Boolean).join(" ")),
		computeParameterTypes(manifest),
		computeTagHashes(manifest.tags),
		computeCapabilityVerbs(manifest),
		computeIOSchemaShape(manifest),
		computeExamplePatterns(manifest.examples),
		computeMetadataSignals(manifest),
	];

	for (let b = 0; b < NUM_BUCKETS; b++) {
		const offset = b * BUCKET_SIZE;
		for (let d = 0; d < BUCKET_SIZE; d++) {
			vector[offset + d] = buckets[b][d];
		}
	}

	return l2Normalize(vector);
}

/**
 * Compute a trait vector from a skill query.
 *
 * The query vector is built from a subset of buckets (those derivable from
 * query fields), with the remaining buckets left at zero. This allows
 * partial matching — a query that specifies only text and tags will match
 * on those dimensions while ignoring schema-level details.
 *
 * @param query - The skill query to vectorize.
 * @returns A 128-dimensional Float32Array with ||v|| = 1.
 */
export function computeQueryVector(query: SkillQuery): Float32Array {
	const vector = new Float32Array(TRAIT_DIMENSIONS);

	// Bucket 0: Extract name-like patterns from query text
	const namePatterns = extractNamePatterns(query.text);
	const nameBucket = new Float32Array(BUCKET_SIZE);
	for (const pattern of namePatterns) {
		const normalized = pattern.toLowerCase().replace(/[^a-z0-9]/g, "-");
		for (let i = 0; i <= normalized.length - 3; i++) {
			const trigram = normalized.slice(i, i + 3);
			nameBucket[fnv1a(trigram) % BUCKET_SIZE] += 1.0;
		}
	}
	copyBucket(vector, 0, nameBucket);

	// Bucket 1: Description tokens from query text
	const descBucket = computeDescriptionTokens(query.text);
	copyBucket(vector, 1, descBucket);

	// Bucket 3: Tags if provided
	if (query.tags && query.tags.length > 0) {
		const tagBucket = computeTagHashes(query.tags);
		copyBucket(vector, 3, tagBucket);
	}

	// Bucket 4: Extract verbs from query text
	const verbBucket = extractQueryVerbs(query.text);
	copyBucket(vector, 4, verbBucket);

	// Bucket 7: Source type filter if provided
	if (query.sourceType) {
		const metaBucket = new Float32Array(BUCKET_SIZE);
		metaBucket[fnv1a(`source:${query.sourceType}`) % BUCKET_SIZE] += 1.5;
		copyBucket(vector, 7, metaBucket);
	}

	return l2Normalize(vector);
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Extract name-like patterns from natural language query text.
 * Looks for hyphenated words, camelCase, and snake_case identifiers.
 */
function extractNamePatterns(text: string): string[] {
	const patterns: string[] = [];
	const hyphenated = text.match(/[a-z]+-[a-z]+(-[a-z]+)*/gi);
	if (hyphenated) patterns.push(...hyphenated);
	const camel = text.match(/[a-z]+[A-Z][a-zA-Z]*/g);
	if (camel) patterns.push(...camel);
	const snake = text.match(/[a-z]+_[a-z]+(_[a-z]+)*/gi);
	if (snake) patterns.push(...snake);
	return patterns;
}

/** Known verb synonym groups for query verb extraction. */
const QUERY_VERB_SYNONYMS: Record<string, string[]> = {
	read: ["read", "fetch", "get", "load", "retrieve", "open", "view", "show"],
	write: ["write", "save", "store", "put", "create", "output", "generate"],
	analyze: ["analyze", "inspect", "examine", "check", "evaluate", "audit", "review"],
	search: ["search", "find", "query", "lookup", "locate", "discover"],
	transform: ["transform", "convert", "parse", "format", "map", "translate"],
	delete: ["delete", "remove", "clear", "purge", "clean"],
	execute: ["execute", "run", "invoke", "call", "trigger", "launch"],
	list: ["list", "enumerate", "scan", "browse", "index"],
};

/** Reverse lookup: verb word -> group name. */
const queryVerbToGroup = new Map<string, string>();
for (const [group, verbs] of Object.entries(QUERY_VERB_SYNONYMS)) {
	for (const v of verbs) {
		queryVerbToGroup.set(v, group);
	}
}

/**
 * Extract verb signals from query text and hash them into a bucket.
 * Recognizes common action verbs and their synonyms.
 */
function extractQueryVerbs(text: string): Float32Array {
	const bucket = new Float32Array(BUCKET_SIZE);
	const words = text.toLowerCase().split(/\s+/);

	for (const word of words) {
		const group = queryVerbToGroup.get(word);
		if (group) {
			bucket[fnv1a(word) % BUCKET_SIZE] += 2.0;
			bucket[fnv1a(`group:${group}`) % BUCKET_SIZE] += 1.0;
		}
	}

	return bucket;
}
