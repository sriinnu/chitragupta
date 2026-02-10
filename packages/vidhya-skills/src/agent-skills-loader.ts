/**
 * @module agent-skills-loader
 * @description Discovers and loads Agent Skills from SKILL.md files following
 * the open standard format (YAML frontmatter + Markdown body).
 *
 * Scans a directory for `* /SKILL.md` (one level deep), parses the YAML
 * frontmatter (name, description, metadata, tags), and converts each into
 * a {@link SkillManifest} compatible with {@link SkillRegistry}.
 *
 * ## LSH Skill Fingerprinting (SimHash — Charikar 2002)
 *
 * Each loaded skill receives a 64-bit SimHash fingerprint computed from
 * TF-IDF weighted unigrams and bigrams of (description + tags). This enables:
 *
 * - **O(1) near-duplicate detection** via Hamming distance
 * - **Fast similarity search** without embedding models
 * - **Multi-signal relevance scoring** (SimHash + Jaccard + BM25)
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
 * Similarity: 1 - hammingDistance(a, b) / 64
 *
 * @packageDocumentation
 */

import fs from "fs";
import path from "path";
import type { SkillManifest } from "./types.js";

/** Result of loading agent skills from a directory. */
export interface AgentSkillLoadResult {
	/** Successfully loaded skill manifests. */
	skills: SkillManifest[];
	/** Paths that were skipped due to errors, with reasons. */
	skipped: Array<{ path: string; reason: string }>;
}

/** A loaded skill entry carrying its SimHash fingerprint. */
export interface AgentSkillEntry {
	/** The parsed skill manifest. */
	manifest: SkillManifest;
	/** 64-bit SimHash fingerprint (Charikar 2002). */
	simhash: bigint;
}

/** A skill scored against a query, sorted by relevance. */
export interface ScoredSkill {
	/** The skill entry. */
	entry: AgentSkillEntry;
	/** Combined relevance score in [0, 1]. */
	score: number;
	/** Individual signal breakdown. */
	signals: {
		/** SimHash cosine-like similarity (weight 0.4). */
		simhash: number;
		/** Jaccard similarity of bigram sets (weight 0.3). */
		jaccard: number;
		/** BM25 score normalized to [0, 1] (weight 0.3). */
		bm25: number;
	};
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 *
 * Handles folded scalars (`>`) and inline arrays (`[a, b, c]`) — the two
 * YAML features actually used in the Agent Skills format. No external deps.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = raw.split("\n");

	const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
		{ obj: result, indent: -1 },
	];

	let foldKey: string | null = null;
	let foldParent: Record<string, unknown> | null = null;
	let foldLines: string[] = [];
	let foldIndent = 0;

	const flushFold = () => {
		if (foldKey && foldParent) {
			foldParent[foldKey] = foldLines.join(" ").trim();
		}
		foldKey = null;
		foldParent = null;
		foldLines = [];
	};

	for (const line of lines) {
		const trimmed = line.trim();

		// Inside a folded scalar — collect continuation lines
		if (foldKey !== null) {
			const lineIndent = line.search(/\S/);
			if (trimmed === "" || (lineIndent >= 0 && lineIndent > foldIndent)) {
				if (trimmed !== "") foldLines.push(trimmed);
				continue;
			}
			// Back to normal indentation — flush the folded value
			flushFold();
		}

		if (trimmed === "" || trimmed.startsWith("#")) continue;

		const indent = line.search(/\S/);
		if (indent < 0) continue;

		const colonIdx = line.indexOf(":");
		if (colonIdx < 0) continue;

		const key = line.slice(indent, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();

		// Pop stack to correct parent
		while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
			stack.pop();
		}
		const parent = stack[stack.length - 1].obj;

		if (rawValue === ">" || rawValue === "|") {
			// Folded or literal scalar — collect following indented lines
			foldKey = key;
			foldParent = parent;
			foldLines = [];
			foldIndent = indent;
		} else if (rawValue === "" || rawValue === undefined) {
			// Nested object
			const nested: Record<string, unknown> = {};
			parent[key] = nested;
			stack.push({ obj: nested, indent });
		} else {
			parent[key] = parseValue(rawValue);
		}
	}

	flushFold();
	return result;
}

/** Parse a single YAML value (scalar, inline array, quoted string). */
function parseValue(raw: string): unknown {
	const t = raw.trim();
	if (t.startsWith("[") && t.endsWith("]")) {
		const inner = t.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((s) => parseValue(s.trim()));
	}
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1);
	}
	if (t === "true") return true;
	if (t === "false") return false;
	if (t === "null" || t === "~") return null;
	const num = Number(t);
	if (!isNaN(num) && t !== "") return num;
	return t;
}

/**
 * Extract YAML frontmatter (between `---` markers) from file content.
 * Returns null if no valid frontmatter is found.
 */
function extractFrontmatter(content: string): string | null {
	const first = content.indexOf("---");
	if (first < 0) return null;
	const second = content.indexOf("---", first + 3);
	if (second < 0) return null;
	return content.slice(first + 3, second);
}

/**
 * List scripts in a skill directory (relative paths under `scripts/`).
 */
function listScripts(skillDir: string): string[] {
	const scriptsDir = path.join(skillDir, "scripts");
	if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory()) {
		return [];
	}
	return fs.readdirSync(scriptsDir)
		.filter((f) => !f.startsWith("."))
		.map((f) => `scripts/${f}`);
}

/**
 * Convert parsed SKILL.md frontmatter into a SkillManifest.
 */
function toManifest(
	fm: Record<string, unknown>,
	skillDir: string,
	filePath: string,
): SkillManifest {
	const name = String(fm.name ?? path.basename(skillDir));
	const description = String(fm.description ?? "");
	const metadata = (fm.metadata ?? {}) as Record<string, unknown>;
	const version = String(metadata.version ?? fm.version ?? "1.0.0");
	const author = String(metadata.author ?? fm.author ?? "unknown");

	// Tags: from metadata.tags, falling back to extracting keywords from description
	let tags: string[] = [];
	const rawTags = metadata.tags ?? fm.tags;
	if (Array.isArray(rawTags)) {
		tags = rawTags.map(String);
	} else if (typeof rawTags === "string") {
		tags = rawTags.split(",").map((t) => t.trim()).filter(Boolean);
	}

	// If no tags, extract keywords from the description
	if (tags.length === 0 && description) {
		const stopWords = new Set([
			"a", "an", "the", "and", "or", "for", "to", "of", "in", "on",
			"is", "it", "that", "this", "with", "from", "as", "by", "at",
			"be", "are", "was", "were", "been", "not", "no", "do", "does",
			"when", "what", "which", "who", "how", "all", "each", "every",
			"invoke", "asks", "user", "about",
		]);
		tags = description
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2 && !stopWords.has(w))
			.slice(0, 8);
		// Deduplicate
		tags = [...new Set(tags)];
	}

	// Build capabilities from the skill name (verb/object heuristic)
	const parts = name.split("-");
	const verb = parts.length > 1 ? parts[parts.length - 1] : "execute";
	const object = parts.length > 1 ? parts.slice(0, -1).join("-") : name;
	const scripts = listScripts(skillDir);

	return {
		name,
		version,
		description,
		author,
		capabilities: [
			{
				verb,
				object,
				description,
			},
		],
		tags,
		source: { type: "manual", filePath },
		updatedAt: new Date().toISOString(),
		// Attach scripts as inputSchema metadata so callers can discover them
		...(scripts.length > 0
			? { inputSchema: { _scripts: scripts } as Record<string, unknown> }
			: {}),
	};
}

// ── LSH Fingerprinting (SimHash — Charikar 2002) ─────────────────────────────

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

/** Stop words excluded from feature extraction. */
const STOP_WORDS = new Set([
	"a", "an", "the", "and", "or", "for", "to", "of", "in", "on",
	"is", "it", "that", "this", "with", "from", "as", "by", "at",
	"be", "are", "was", "were", "been", "not", "no", "do", "does",
	"when", "what", "which", "who", "how", "all", "each", "every",
]);

/**
 * Tokenize text into lowercase alphanumeric tokens, filtering stop words.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Extract unigrams and bigrams from text as feature strings.
 */
function extractFeatures(text: string, tags: string[]): string[] {
	const tokens = tokenize(text);
	const features: string[] = [];
	// Unigrams
	for (const t of tokens) features.push(t);
	// Bigrams
	for (let i = 0; i < tokens.length - 1; i++) {
		features.push(`${tokens[i]} ${tokens[i + 1]}`);
	}
	// Tags as features (prefixed to avoid collision with description terms)
	for (const tag of tags) {
		features.push(`tag:${tag.toLowerCase()}`);
	}
	return features;
}

/**
 * Compute TF-IDF weights for features across a corpus.
 *
 * TF(t, d) = count(t in d) / |d|
 * IDF(t) = ln(N / (1 + df(t)))     (smoothed)
 * TF-IDF(t, d) = TF(t, d) * IDF(t)
 *
 * @param featureSets - Array of feature arrays (one per document).
 * @returns Per-document maps of feature -> TF-IDF weight.
 */
function computeTfIdf(featureSets: string[][]): Map<string, number>[] {
	const N = featureSets.length;
	// Document frequency
	const df = new Map<string, number>();
	for (const features of featureSets) {
		const seen = new Set(features);
		for (const f of seen) {
			df.set(f, (df.get(f) ?? 0) + 1);
		}
	}
	// TF-IDF per document
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

/**
 * Compute a 64-bit SimHash fingerprint (Charikar 2002).
 *
 * Given a set of features with weights, produces a locality-sensitive
 * hash where similar inputs yield fingerprints with small Hamming distance.
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
 * @param weights - Map of feature -> TF-IDF weight. Features not in
 *   the map receive unit weight.
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
 *
 * Uses the parallel bit-counting algorithm:
 *   x = x - ((x >> 1) & 0x5555...)
 *   x = (x & 0x3333...) + ((x >> 2) & 0x3333...)
 *   ...
 * Adapted for BigInt.
 */
function popcount64(x: bigint): number {
	// Ensure non-negative
	x = x & MASK64;
	x = x - ((x >> 1n) & 0x5555555555555555n);
	x = (x & 0x3333333333333333n) + ((x >> 2n) & 0x3333333333333333n);
	x = (x + (x >> 4n)) & 0x0f0f0f0f0f0f0f0fn;
	x = (x * 0x0101010101010101n) & MASK64;
	return Number(x >> 56n);
}

/**
 * Compute similarity between two SimHash fingerprints via normalized
 * Hamming distance.
 *
 *   similarity(a, b) = 1 - hammingDistance(a, b) / 64
 *
 * Where hammingDistance = popcount(a XOR b).
 *
 * Returns a value in [0, 1] where 1 = identical fingerprints.
 *
 * @param a - First 64-bit SimHash fingerprint.
 * @param b - Second 64-bit SimHash fingerprint.
 * @returns Normalized similarity score in [0, 1].
 */
export function skillSimilarity(a: bigint, b: bigint): number {
	const hamming = popcount64(a ^ b);
	return 1 - hamming / 64;
}

// ── Relevance Scoring (BM25 + Jaccard + SimHash) ─────────────────────────────

/**
 * Extract bigram set from text for Jaccard computation.
 */
function bigramSet(text: string): Set<string> {
	const tokens = tokenize(text);
	const s = new Set<string>();
	for (let i = 0; i < tokens.length - 1; i++) {
		s.add(`${tokens[i]} ${tokens[i + 1]}`);
	}
	return s;
}

/**
 * Jaccard similarity of two sets: |A ∩ B| / |A ∪ B|.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	const smaller = a.size <= b.size ? a : b;
	const larger = a.size <= b.size ? b : a;
	for (const x of smaller) {
		if (larger.has(x)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/**
 * BM25 score of a query against a document.
 *
 * BM25(q, d) = sum_{t in q} IDF(t) * (tf(t,d) * (k1+1)) / (tf(t,d) + k1 * (1 - b + b * |d|/avgdl))
 *
 * IDF(t) = ln((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
 *
 * @param queryTokens - Tokenized query terms.
 * @param docTokens - Tokenized document terms.
 * @param avgdl - Average document length across corpus.
 * @param N - Total number of documents.
 * @param df - Document frequency map.
 * @param k1 - Term saturation parameter (default 1.2).
 * @param b - Length normalization parameter (default 0.75).
 */
function bm25(
	queryTokens: string[],
	docTokens: string[],
	avgdl: number,
	N: number,
	df: Map<string, number>,
	k1 = 1.2,
	b = 0.75,
): number {
	const docLen = docTokens.length;
	// Term frequency in document
	const tf = new Map<string, number>();
	for (const t of docTokens) {
		tf.set(t, (tf.get(t) ?? 0) + 1);
	}
	let score = 0;
	for (const t of queryTokens) {
		const dtf = tf.get(t) ?? 0;
		if (dtf === 0) continue;
		const docFreq = df.get(t) ?? 0;
		const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
		const num = dtf * (k1 + 1);
		const denom = dtf + k1 * (1 - b + b * docLen / avgdl);
		score += idf * (num / denom);
	}
	return score;
}

/**
 * Score and rank skills against a natural language query using three
 * complementary signals:
 *
 * | Signal   | Weight | Property                           |
 * |----------|--------|------------------------------------|
 * | SimHash  | 0.4    | Locality-sensitive global shape    |
 * | Jaccard  | 0.3    | Exact bigram overlap               |
 * | BM25     | 0.3    | Term importance with length norm   |
 *
 * Final score = 0.4 * simhash + 0.3 * jaccard + 0.3 * bm25_normalized
 *
 * BM25 is normalized to [0, 1] by dividing by the max BM25 score in the
 * result set (or 1 if all scores are 0).
 *
 * @param query - Natural language query string.
 * @param skills - Array of AgentSkillEntry objects (with precomputed simhash).
 * @returns Skills sorted by descending relevance score.
 */
export function scoreSkillRelevance(
	query: string,
	skills: AgentSkillEntry[],
): ScoredSkill[] {
	if (skills.length === 0) return [];

	// Query features + SimHash
	const queryFeatures = extractFeatures(query, []);
	const queryHash = computeSimHash(queryFeatures);
	const queryBigrams = bigramSet(query);
	const queryTokens = tokenize(query);

	// Build corpus stats for BM25
	const corpusTokens: string[][] = skills.map((s) =>
		tokenize(s.manifest.description),
	);
	const N = skills.length;
	const avgdl = corpusTokens.reduce((s, d) => s + d.length, 0) / N;
	const df = new Map<string, number>();
	for (const doc of corpusTokens) {
		const seen = new Set(doc);
		for (const t of seen) {
			df.set(t, (df.get(t) ?? 0) + 1);
		}
	}

	// Compute raw scores
	const raw: Array<{
		entry: AgentSkillEntry;
		simSig: number;
		jaccSig: number;
		bm25Raw: number;
	}> = [];

	for (let i = 0; i < skills.length; i++) {
		const entry = skills[i];
		const simSig = skillSimilarity(queryHash, entry.simhash);
		const skillBigrams = bigramSet(entry.manifest.description);
		const jaccSig = jaccard(queryBigrams, skillBigrams);
		const bm25Raw = bm25(queryTokens, corpusTokens[i], avgdl, N, df);
		raw.push({ entry, simSig, jaccSig, bm25Raw });
	}

	// Normalize BM25 to [0, 1]
	const maxBm25 = Math.max(...raw.map((r) => r.bm25Raw), 1e-10);

	const scored: ScoredSkill[] = raw.map((r) => {
		const bm25Norm = r.bm25Raw / maxBm25;
		const score = 0.4 * r.simSig + 0.3 * r.jaccSig + 0.3 * bm25Norm;
		return {
			entry: r.entry,
			score,
			signals: {
				simhash: r.simSig,
				jaccard: r.jaccSig,
				bm25: bm25Norm,
			},
		};
	});

	scored.sort((a, b) => b.score - a.score);
	return scored;
}

/**
 * Scan a directory for SKILL.md files and load them as SkillManifest objects.
 *
 * Expects the directory layout:
 * ```
 * skillsDir/
 *   skill-name/
 *     SKILL.md          ← required
 *     scripts/           ← optional
 *     references/        ← optional
 *     assets/            ← optional
 * ```
 *
 * @param skillsDir - Absolute path to the skills directory to scan.
 * @returns Loaded skills and any skipped entries.
 */
/** Near-duplicate similarity threshold. Skills above this are deduplicated. */
const DEDUP_THRESHOLD = 0.85;

export function loadAgentSkills(skillsDir: string): AgentSkillLoadResult {
	const result: AgentSkillLoadResult = { skills: [], skipped: [] };

	if (!fs.existsSync(skillsDir)) {
		return result;
	}

	let entries: string[];
	try {
		entries = fs.readdirSync(skillsDir);
	} catch {
		return result;
	}

	// Phase 1: Parse all manifests
	const parsed: Array<{ manifest: SkillManifest; path: string }> = [];

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;

		const entryPath = path.join(skillsDir, entry);
		try {
			if (!fs.statSync(entryPath).isDirectory()) continue;
		} catch {
			continue;
		}

		const skillMdPath = path.join(entryPath, "SKILL.md");
		if (!fs.existsSync(skillMdPath)) {
			result.skipped.push({ path: entryPath, reason: "no SKILL.md found" });
			continue;
		}

		try {
			const content = fs.readFileSync(skillMdPath, "utf8");
			const fmRaw = extractFrontmatter(content);
			if (!fmRaw) {
				result.skipped.push({ path: skillMdPath, reason: "no YAML frontmatter" });
				continue;
			}

			const fm = parseFrontmatter(fmRaw);
			if (!fm.name) {
				result.skipped.push({ path: skillMdPath, reason: "frontmatter missing 'name'" });
				continue;
			}

			const manifest = toManifest(fm, entryPath, skillMdPath);
			parsed.push({ manifest, path: skillMdPath });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			result.skipped.push({ path: skillMdPath, reason: msg });
		}
	}

	// Phase 2: Compute TF-IDF weighted SimHash for each skill
	const featureSets = parsed.map((p) =>
		extractFeatures(p.manifest.description, p.manifest.tags),
	);
	const tfidfWeights = computeTfIdf(featureSets);

	const withHash: Array<{ manifest: SkillManifest; simhash: bigint; path: string }> =
		parsed.map((p, i) => ({
			manifest: p.manifest,
			simhash: computeSimHash(featureSets[i], tfidfWeights[i]),
			path: p.path,
		}));

	// Phase 3: Deduplicate via SimHash Hamming distance
	const accepted: boolean[] = new Array(withHash.length).fill(true);

	for (let i = 0; i < withHash.length; i++) {
		if (!accepted[i]) continue;
		for (let j = i + 1; j < withHash.length; j++) {
			if (!accepted[j]) continue;
			const sim = skillSimilarity(withHash[i].simhash, withHash[j].simhash);
			if (sim > DEDUP_THRESHOLD) {
				// Keep the skill with the longer (more detailed) description
				const keepI = withHash[i].manifest.description.length >=
					withHash[j].manifest.description.length;
				const victim = keepI ? j : i;
				const keeper = keepI ? i : j;
				accepted[victim] = false;
				result.skipped.push({
					path: withHash[victim].path,
					reason: `near-duplicate of "${withHash[keeper].manifest.name}" `
						+ `(SimHash similarity=${sim.toFixed(3)})`,
				});
				if (!keepI) break; // i was removed, stop comparing from it
			}
		}
	}

	for (let i = 0; i < withHash.length; i++) {
		if (accepted[i]) {
			result.skills.push(withHash[i].manifest);
		}
	}

	return result;
}
