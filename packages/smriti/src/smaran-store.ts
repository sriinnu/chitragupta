/**
 * @chitragupta/smriti -- Smaran Persistence & Text Processing
 *
 * Utility functions for SmaranStore: FNV hashing, tokenization, tag extraction,
 * YAML parsing, markdown serialization, file I/O, BM25 scoring, and similarity.
 * Extracted from smaran.ts to keep each module under 450 LOC.
 *
 * @module smaran-store
 */

import fs from "fs";
import path from "path";
import type { SmaranCategory, SmaranEntry } from "./smaran.js";

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * FNV-1a hash (32-bit).
 * Used to generate deterministic short IDs for memory entries.
 *
 * @param str - Input string to hash
 * @returns 32-bit unsigned integer hash
 */
export function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash;
}

// ─── Text Processing ─────────────────────────────────────────────────────────

/**
 * Tokenize text into lowercase terms, stripping punctuation.
 * Tokens shorter than 2 characters are discarded.
 *
 * @param text - Raw text to tokenize
 * @returns Array of lowercase word tokens
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter(t => t.length > 1);
}

/**
 * Extract tags from content using keyword heuristics.
 * Matches common category patterns (food, music, work, travel, etc.)
 * and returns matching tag strings.
 *
 * @param content - Natural language content to scan for tags
 * @returns Array of matched tag strings
 */
export function extractTags(content: string): string[] {
	const tags: string[] = [];
	const lower = content.toLowerCase();

	const tagPatterns: Array<[RegExp, string]> = [
		[/\bfood\b|\beat\b|\brestaurant\b|\bcuisine\b|\bpizza\b|\bcook\b/, "food"],
		[/\bmusic\b|\bsong\b|\bplaylist\b|\bartist\b|\balbum\b/, "music"],
		[/\bwork\b|\bjob\b|\bproject\b|\bcode\b|\bprogramm/, "work"],
		[/\btravel\b|\bflight\b|\bhotel\b|\btrip\b/, "travel"],
		[/\bhealth\b|\bexercise\b|\bfitness\b|\bdiet\b|\bmedic/, "health"],
		[/\bfinance\b|\bmoney\b|\bbudget\b|\bsaving\b|\binvest/, "finance"],
		[/\bbook\b|\bread\b|\bauthor\b|\bnovel\b/, "books"],
		[/\blanguage\b|\blearn\b|\bstudy\b/, "learning"],
		[/\blocation\b|\bcity\b|\bcountry\b|\baddress\b|\blive\b/, "location"],
		[/\bschedule\b|\bcalendar\b|\bmeeting\b|\bappointment\b/, "schedule"],
	];

	for (const [pattern, tag] of tagPatterns) {
		if (pattern.test(lower)) tags.push(tag);
	}

	return tags;
}

// ─── YAML Parsing ────────────────────────────────────────────────────────────

/**
 * Parse simple YAML key-value pairs (no nested objects).
 * Handles inline arrays, null/boolean/numeric scalars.
 *
 * @param yaml - Raw YAML string (without --- delimiters)
 * @returns Parsed key-value record
 */
export function parseSimpleYaml(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const line of yaml.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;
		const key = trimmed.slice(0, colonIdx).trim();
		const rawValue = trimmed.slice(colonIdx + 1).trim();

		// Inline array: [a, b, c]
		if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
			const inner = rawValue.slice(1, -1);
			result[key] = inner.trim() === "" ? [] : inner.split(",").map(s => s.trim());
			continue;
		}

		if (rawValue === "null" || rawValue === "~") result[key] = null;
		else if (rawValue === "true") result[key] = true;
		else if (rawValue === "false") result[key] = false;
		else {
			const num = Number(rawValue);
			result[key] = !Number.isNaN(num) && rawValue !== "" ? num : rawValue;
		}
	}
	return result;
}

/**
 * Parse tags from YAML value (handles both arrays and strings).
 *
 * @param value - Raw YAML value (array or comma-separated string)
 * @returns Array of tag strings
 */
export function parseTags(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string") return value.split(",").map(s => s.trim()).filter(Boolean);
	return [];
}

// ─── Markdown Serialization ──────────────────────────────────────────────────

/**
 * Serialize a SmaranEntry to markdown with YAML frontmatter.
 *
 * @param entry - The memory entry to serialize
 * @returns Markdown string with YAML frontmatter and body
 */
export function toSmaranMarkdown(entry: SmaranEntry): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`id: ${entry.id}`);
	lines.push(`category: ${entry.category}`);
	lines.push(`source: ${entry.source}`);
	lines.push(`confidence: ${entry.confidence}`);
	lines.push(entry.tags.length > 0
		? `tags: [${entry.tags.join(", ")}]`
		: "tags: []");
	lines.push(`created: ${entry.createdAt}`);
	lines.push(`updated: ${entry.updatedAt}`);
	if (entry.sessionId) lines.push(`session: ${entry.sessionId}`);
	lines.push(`decayHalfLifeDays: ${entry.decayHalfLifeDays}`);
	lines.push("---");
	lines.push("");
	lines.push(entry.content);
	lines.push("");
	return lines.join("\n");
}

/**
 * Parse a SmaranEntry from markdown with YAML frontmatter.
 *
 * @param content - Raw markdown string with YAML frontmatter
 * @returns Parsed SmaranEntry, or null if malformed
 */
export function fromSmaranMarkdown(content: string): SmaranEntry | null {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return null;

	const yaml = fmMatch[1];
	const body = content.slice(fmMatch[0].length).trim();
	const meta = parseSimpleYaml(yaml);

	const id = String(meta.id ?? "");
	if (!id || !body) return null;

	return {
		id,
		content: body,
		category: (meta.category as SmaranCategory) ?? "fact",
		source: (meta.source as "explicit" | "inferred") ?? "explicit",
		confidence: Number(meta.confidence ?? 1),
		tags: parseTags(meta.tags),
		createdAt: String(meta.created ?? new Date().toISOString()),
		updatedAt: String(meta.updated ?? new Date().toISOString()),
		sessionId: meta.session ? String(meta.session) : undefined,
		decayHalfLifeDays: Number(meta.decayHalfLifeDays ?? 0),
	};
}

// ─── File I/O ────────────────────────────────────────────────────────────────

/**
 * Load all .md entries from a storage directory.
 *
 * @param storagePath - Directory containing SmaranEntry .md files
 * @returns Map of entry ID to SmaranEntry
 */
export function loadSmaranEntries(storagePath: string): Map<string, SmaranEntry> {
	const entries = new Map<string, SmaranEntry>();
	if (!fs.existsSync(storagePath)) return entries;

	const files = fs.readdirSync(storagePath).filter(f => f.endsWith(".md"));
	for (const file of files) {
		try {
			const content = fs.readFileSync(path.join(storagePath, file), "utf-8");
			const entry = fromSmaranMarkdown(content);
			if (entry) entries.set(entry.id, entry);
		} catch {
			// Skip malformed files
		}
	}
	return entries;
}

/**
 * Save a single entry to disk as a markdown file.
 *
 * @param storagePath - Target directory for the .md file
 * @param entry - The SmaranEntry to persist
 */
export function saveSmaranEntry(storagePath: string, entry: SmaranEntry): void {
	fs.mkdirSync(storagePath, { recursive: true });
	const filePath = path.join(storagePath, `${entry.id}.md`);
	fs.writeFileSync(filePath, toSmaranMarkdown(entry), { encoding: "utf-8", mode: 0o600 });
}

/**
 * Delete a single entry file from disk.
 *
 * @param storagePath - Directory containing the .md file
 * @param id - Entry ID (used as filename without extension)
 */
export function deleteSmaranFile(storagePath: string, id: string): void {
	const filePath = path.join(storagePath, `${id}.md`);
	try {
		if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
	} catch {
		// Best-effort deletion
	}
}

// ─── Similarity Detection ────────────────────────────────────────────────────

/**
 * Find an entry with >80% term overlap to the given content.
 *
 * @param content - Query content to compare against
 * @param entries - Iterable of existing SmaranEntry records
 * @returns Matching entry or null if none exceed 80% similarity
 */
export function findSimilarEntry(
	content: string,
	entries: Iterable<SmaranEntry>,
): SmaranEntry | null {
	const queryTerms = new Set(tokenize(content));
	if (queryTerms.size === 0) return null;

	for (const entry of entries) {
		const entryTerms = new Set(tokenize(entry.content));
		let overlap = 0;
		for (const term of queryTerms) {
			if (entryTerms.has(term)) overlap++;
		}
		const similarity = overlap / Math.max(queryTerms.size, entryTerms.size);
		if (similarity > 0.8) return entry;
	}
	return null;
}

// ─── BM25 Scoring ────────────────────────────────────────────────────────────

/** BM25-scored recall result pairing an entry with its relevance score. */
export interface ScoredEntry {
	/** The matched memory entry */
	entry: SmaranEntry;
	/** BM25 relevance score (higher = more relevant) */
	score: number;
}

/**
 * Score entries against a query using BM25 with confidence and decay boosts.
 * Returns scored entries above the threshold, sorted descending by relevance.
 *
 * @param entries - Iterable of SmaranEntry records to score
 * @param query - User query string
 * @param threshold - Minimum score to include in results
 * @returns Array of ScoredEntry sorted by descending score
 */
export function scoreBM25Recall(
	entries: Iterable<SmaranEntry>,
	query: string,
	threshold: number,
): ScoredEntry[] {
	const queryTerms = tokenize(query);
	if (queryTerms.length === 0) return [];

	// Build document frequency map
	const allEntries: SmaranEntry[] = [];
	const df = new Map<string, number>();
	for (const entry of entries) {
		allEntries.push(entry);
		const terms = new Set(tokenize(entry.content + " " + entry.tags.join(" ")));
		for (const term of terms) {
			df.set(term, (df.get(term) ?? 0) + 1);
		}
	}

	const N = allEntries.length;
	const queryLower = query.toLowerCase();
	const k1 = 1.5;
	const b = 0.75;
	const avgLen = 20;
	const scored: ScoredEntry[] = [];

	for (const entry of allEntries) {
		const docText = (entry.content + " " + entry.tags.join(" ")).toLowerCase();
		const docTerms = tokenize(docText);

		let bm25 = 0;
		for (const qt of queryTerms) {
			const termFreq = docTerms.filter(t => t === qt).length;
			if (termFreq === 0) continue;
			const docFreq = df.get(qt) ?? 0;
			const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
			const tf = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * docTerms.length / avgLen));
			bm25 += idf * tf;
		}

		// Boost for exact substring match
		if (docText.includes(queryLower)) bm25 *= 1.5;

		// Boost for high confidence
		bm25 *= (0.5 + 0.5 * entry.confidence);

		// Temporal decay
		if (entry.decayHalfLifeDays > 0) {
			const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
			const ageDays = ageMs / (1000 * 60 * 60 * 24);
			bm25 *= Math.exp(-Math.LN2 * ageDays / entry.decayHalfLifeDays);
		}

		if (bm25 >= threshold) scored.push({ entry, score: bm25 });
	}

	scored.sort((a, b) => b.score - a.score);
	return scored;
}
