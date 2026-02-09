/**
 * @module buckets
 * @description Bucket computation functions for the TVM fingerprinting algorithm.
 *
 * Each function computes one of the 8 feature buckets that compose the
 * 128-dimensional trait vector. The buckets capture different "articulatory
 * features" of a skill, following the Shiksha (Vedic phonetics) analogy.
 *
 * @packageDocumentation
 */

import type { SkillManifest } from "./types.js";

/** Number of dimensions per bucket. */
const BUCKET_SIZE = 16;

/** Common English stop words to filter from text tokenization. */
const STOP_WORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "do", "does", "did", "will", "would", "shall",
	"should", "may", "might", "must", "can", "could", "and", "but", "or",
	"nor", "not", "so", "yet", "for", "at", "by", "from", "in", "into",
	"of", "on", "to", "with", "as", "if", "that", "this", "it", "its",
	"up", "out", "no", "than", "too", "very", "just", "about", "also",
]);

/** Known verb synonym groups for capability verb clustering. */
const VERB_SYNONYMS: Record<string, string[]> = {
	read: ["read", "fetch", "get", "load", "retrieve", "open"],
	write: ["write", "save", "store", "put", "create", "output"],
	analyze: ["analyze", "inspect", "examine", "check", "evaluate", "audit"],
	search: ["search", "find", "query", "lookup", "locate", "discover"],
	transform: ["transform", "convert", "parse", "format", "map", "translate"],
	delete: ["delete", "remove", "clear", "purge", "clean"],
	execute: ["execute", "run", "invoke", "call", "trigger", "launch"],
	list: ["list", "enumerate", "scan", "browse", "index"],
};

// ─── Shared Helpers ─────────────────────────────────────────────────────────

/**
 * FNV-1a hash — imported inline to avoid circular dependency.
 * Same implementation as in fingerprint.ts.
 */
function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Map a hash to a dimension index within a bucket. */
function dim(hash: number): number {
	return hash % BUCKET_SIZE;
}

// ─── Bucket 0: Name N-grams ────────────────────────────────────────────────

/**
 * Bucket 0 (dims 0-15): Character 3-grams of the skill name.
 * Skills with similar naming patterns ("read-*", "*-analyzer") cluster together.
 */
export function computeNameNgrams(name: string): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);
	const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
	for (let i = 0; i <= norm.length - 3; i++) {
		b[dim(fnv1a(norm.slice(i, i + 3)))] += 1.0;
	}
	b[dim(fnv1a(norm))] += 0.5;
	return b;
}

// ─── Bucket 1: Description Tokens ──────────────────────────────────────────

/**
 * Bucket 1 (dims 16-31): TF-weighted token hashing of the description.
 * Weight(token) = freq / (1 + log2(rank)), rarer tokens rank higher.
 */
export function computeDescriptionTokens(description: string): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);
	const tokens = description
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1 && !STOP_WORDS.has(t));

	const tf = new Map<string, number>();
	for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

	const entries = [...tf.entries()].sort((a, c) => a[1] - c[1]);
	for (let rank = 0; rank < entries.length; rank++) {
		const [token, freq] = entries[rank];
		b[dim(fnv1a(token))] += freq / (1 + Math.log2(rank + 1));
	}
	return b;
}

// ─── Bucket 2: Parameter Types ─────────────────────────────────────────────

/**
 * Bucket 2 (dims 32-47): Hash of parameter names + types.
 * Skills with similar input shapes cluster together.
 */
export function computeParameterTypes(manifest: SkillManifest): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);
	for (const cap of manifest.capabilities) {
		if (!cap.parameters) continue;
		for (const [pName, p] of Object.entries(cap.parameters)) {
			b[dim(fnv1a(`${pName}:${p.type}`))] += 1.0;
			b[dim(fnv1a(p.type))] += 0.3;
			if (p.required) b[dim(fnv1a(`required:${pName}`))] += 0.5;
		}
	}
	if (manifest.inputSchema) {
		const str = JSON.stringify(manifest.inputSchema);
		for (const m of str.match(/"type"\s*:\s*"(\w+)"/g) ?? []) {
			b[dim(fnv1a(m))] += 0.5;
		}
	}
	return b;
}

// ─── Bucket 3: Tag Hashes ──────────────────────────────────────────────────

/**
 * Bucket 3 (dims 48-63): Consistent tag hashing.
 * Each tag activates one primary dimension (strongly) and one secondary
 * dimension (weakly) for collision resistance.
 */
export function computeTagHashes(tags: string[]): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);
	for (const tag of tags) {
		const n = tag.toLowerCase().trim();
		b[dim(fnv1a(n))] += 2.0;
		b[dim(fnv1a(n + ":secondary"))] += 0.5;
	}
	return b;
}

// ─── Bucket 4: Capability Verbs ────────────────────────────────────────────

/**
 * Bucket 4 (dims 64-79): Verb hashing with synonym group clustering.
 * Similar actions (read/fetch, write/save) activate shared group dimensions.
 */
export function computeCapabilityVerbs(manifest: SkillManifest): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);
	const verbToGroup = new Map<string, string>();
	for (const [group, verbs] of Object.entries(VERB_SYNONYMS)) {
		for (const v of verbs) verbToGroup.set(v, group);
	}
	for (const cap of manifest.capabilities) {
		const verb = cap.verb.toLowerCase();
		b[dim(fnv1a(verb))] += 2.0;
		const group = verbToGroup.get(verb);
		if (group) b[dim(fnv1a(`group:${group}`))] += 1.0;
		b[dim(fnv1a(`${verb}:${cap.object.toLowerCase()}`))] += 1.5;
	}
	return b;
}

// ─── Bucket 5: IO Schema Shape ─────────────────────────────────────────────

/**
 * Bucket 5 (dims 80-95): Structural fingerprint of input/output schemas.
 * Encodes types, nesting depth, and field count.
 */
export function computeIOSchemaShape(manifest: SkillManifest): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);

	function fp(schema: Record<string, unknown>, depth: number, prefix: string): void {
		const type = schema.type as string | undefined;
		if (type) b[dim(fnv1a(`${prefix}:type:${type}`))] += 1.0 / (1 + depth);
		const props = schema.properties as Record<string, unknown> | undefined;
		if (props) {
			b[dim(fnv1a(`${prefix}:fields:${Object.keys(props).length}`))] += 0.5;
			for (const [k, v] of Object.entries(props)) {
				if (v && typeof v === "object") fp(v as Record<string, unknown>, depth + 1, `${prefix}.${k}`);
			}
		}
		const items = schema.items as Record<string, unknown> | undefined;
		if (items && typeof items === "object") fp(items, depth + 1, `${prefix}[]`);
	}

	if (manifest.inputSchema) fp(manifest.inputSchema, 0, "in");
	if (manifest.outputSchema) fp(manifest.outputSchema, 0, "out");
	if (manifest.inputSchema) b[0] += 0.5;
	if (manifest.outputSchema) b[1] += 0.5;
	return b;
}

// ─── Bucket 6: Example Patterns ────────────────────────────────────────────

/**
 * Bucket 6 (dims 96-111): Hash of example descriptions and input patterns.
 * Skills used for similar tasks cluster together.
 */
export function computeExamplePatterns(examples: SkillManifest["examples"]): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);
	if (!examples || examples.length === 0) return b;
	for (const ex of examples) {
		const tokens = ex.description
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((t) => t.length > 2 && !STOP_WORDS.has(t));
		for (const t of tokens) b[dim(fnv1a(t))] += 0.5;
		for (const k of Object.keys(ex.input)) {
			b[dim(fnv1a(`exkey:${k}`))] += 1.0;
			b[dim(fnv1a(`extype:${k}:${typeof ex.input[k]}`))] += 0.3;
		}
	}
	b[dim(fnv1a("example-count"))] += Math.min(examples.length / 5, 1.0);
	return b;
}

// ─── Bucket 7: Metadata Signals ────────────────────────────────────────────

/**
 * Bucket 7 (dims 112-127): Source type, anti-patterns (NEGATIVE dims!),
 * version stability, and author signals.
 *
 * Anti-patterns produce negative activations — a repulsive force in the
 * vector space that steers queries away from bad matches.
 */
export function computeMetadataSignals(manifest: SkillManifest): Float32Array {
	const b = new Float32Array(BUCKET_SIZE);

	b[dim(fnv1a(`source:${manifest.source.type}`))] += 1.5;
	switch (manifest.source.type) {
		case "tool":
			b[dim(fnv1a(`tool:${manifest.source.toolName}`))] += 1.0;
			break;
		case "mcp-server":
			b[dim(fnv1a(`mcp:${manifest.source.serverName}`))] += 1.0;
			break;
		case "plugin":
			b[dim(fnv1a(`plugin:${manifest.source.pluginName}`))] += 1.0;
			break;
		case "manual":
			b[dim(fnv1a("manual"))] += 1.0;
			break;
	}

	const major = parseInt(manifest.version.split(".")[0], 10);
	if (!isNaN(major) && major >= 1) b[dim(fnv1a("stable"))] += 0.5;

	if (manifest.antiPatterns) {
		for (const pattern of manifest.antiPatterns) {
			const tokens = pattern
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, " ")
				.split(/\s+/)
				.filter((t) => t.length > 2 && !STOP_WORDS.has(t));
			for (const t of tokens) b[dim(fnv1a(`anti:${t}`))] -= 0.8;
		}
	}

	if (manifest.author) b[dim(fnv1a(`author:${manifest.author}`))] += 0.3;
	return b;
}
