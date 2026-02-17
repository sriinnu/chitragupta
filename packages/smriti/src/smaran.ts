/**
 * @chitragupta/smriti — Smaran (स्मरण — Active Remembering)
 *
 * Explicit memory store for user preferences, facts, decisions, and instructions.
 * Each memory is a structured entry stored as an individual .md file with YAML frontmatter.
 *
 * Storage: ~/.chitragupta/smaran/
 *
 * Flow:
 *   User: "remember that I like pizza"
 *     → detectMemoryIntent() returns { action: 'remember', content: 'I like pizza', category: 'preference' }
 *     → smaranStore.remember('I like pizza', 'preference')
 *     → writes ~/.chitragupta/smaran/smr-<hash>.md
 *
 *   Agent loop: before each turn
 *     → smaranStore.recall(userMessage) returns relevant memories
 *     → injected into system prompt as "## User Memory" section
 *
 *   User: "forget that I like pizza"
 *     → smaranStore.forget(id) removes the .md file
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SmaranCategory =
	| "preference"
	| "fact"
	| "decision"
	| "instruction"
	| "context";

export interface SmaranEntry {
	/** Unique ID: smr-<8-char FNV hash> */
	id: string;
	/** The memory content in natural language */
	content: string;
	/** Category for filtering and display */
	category: SmaranCategory;
	/** How this memory was created */
	source: "explicit" | "inferred";
	/** Confidence score [0, 1] — 1.0 for explicit, lower for inferred */
	confidence: number;
	/** Searchable tags */
	tags: string[];
	/** ISO timestamp of creation */
	createdAt: string;
	/** ISO timestamp of last update */
	updatedAt: string;
	/** Session ID where this memory originated */
	sessionId?: string;
	/** Decay half-life in days (0 = never decays) */
	decayHalfLifeDays: number;
}

export interface SmaranConfig {
	/** Storage directory. Default: ~/.chitragupta/smaran/ */
	storagePath?: string;
	/** Maximum number of entries. Default: 1000 */
	maxEntries: number;
	/** Default decay half-life in days for inferred memories. Default: 90 */
	defaultDecayDays: number;
	/** Minimum confidence threshold for recall results. Default: 0.1 */
	recallThreshold: number;
	/** Maximum results for recall. Default: 10 */
	recallLimit: number;
}

const DEFAULT_CONFIG: SmaranConfig = {
	maxEntries: 1000,
	defaultDecayDays: 90,
	recallThreshold: 0.1,
	recallLimit: 10,
};

const SMARAN_HARD_CEILINGS = {
	maxEntries: 10_000,
	recallLimit: 50,
} as const;

// ─── SmaranStore ────────────────────────────────────────────────────────────

export class SmaranStore {
	private readonly config: SmaranConfig;
	private readonly storagePath: string;
	private entries: Map<string, SmaranEntry> = new Map();
	private loaded = false;

	constructor(config?: Partial<SmaranConfig>) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			maxEntries: Math.min(
				config?.maxEntries ?? DEFAULT_CONFIG.maxEntries,
				SMARAN_HARD_CEILINGS.maxEntries,
			),
			recallLimit: Math.min(
				config?.recallLimit ?? DEFAULT_CONFIG.recallLimit,
				SMARAN_HARD_CEILINGS.recallLimit,
			),
		};
		this.storagePath = this.config.storagePath ?? path.join(getChitraguptaHome(), "smaran");
	}

	// ─── Core CRUD ────────────────────────────────────────────────────────

	/**
	 * Save a new explicit memory.
	 * Returns the created entry.
	 */
	remember(
		content: string,
		category: SmaranCategory,
		opts?: {
			tags?: string[];
			sessionId?: string;
			source?: "explicit" | "inferred";
			confidence?: number;
			decayHalfLifeDays?: number;
		},
	): SmaranEntry {
		this.ensureLoaded();

		// Check for duplicates — if content is very similar to an existing entry, update instead
		const existing = this.findSimilar(content);
		if (existing) {
			existing.confidence = Math.min(1, existing.confidence + 0.1);
			existing.updatedAt = new Date().toISOString();
			if (opts?.tags) {
				const tagSet = new Set([...existing.tags, ...opts.tags]);
				existing.tags = [...tagSet];
			}
			this.saveEntry(existing);
			return existing;
		}

		// Enforce max entries
		if (this.entries.size >= this.config.maxEntries) {
			this.pruneLowest(1);
		}

		const source = opts?.source ?? "explicit";
		const now = new Date().toISOString();
		const id = `smr-${fnv1a(content + now).toString(16).slice(0, 8)}`;

		const entry: SmaranEntry = {
			id,
			content: content.trim(),
			category,
			source,
			confidence: opts?.confidence ?? (source === "explicit" ? 1.0 : 0.6),
			tags: opts?.tags ?? extractTags(content),
			createdAt: now,
			updatedAt: now,
			sessionId: opts?.sessionId,
			decayHalfLifeDays: opts?.decayHalfLifeDays ??
				(source === "explicit" ? 0 : this.config.defaultDecayDays),
		};

		this.entries.set(id, entry);
		this.saveEntry(entry);
		return entry;
	}

	/**
	 * Delete a memory by ID.
	 * Returns true if deleted, false if not found.
	 */
	forget(id: string): boolean {
		this.ensureLoaded();
		const entry = this.entries.get(id);
		if (!entry) return false;

		this.entries.delete(id);
		this.deleteFile(id);
		return true;
	}

	/**
	 * Forget memories matching a content substring.
	 * Returns number of entries deleted.
	 */
	forgetByContent(query: string): number {
		this.ensureLoaded();
		const lower = query.toLowerCase();
		const toDelete: string[] = [];

		for (const [id, entry] of this.entries) {
			if (entry.content.toLowerCase().includes(lower)) {
				toDelete.push(id);
			}
		}

		for (const id of toDelete) {
			this.entries.delete(id);
			this.deleteFile(id);
		}
		return toDelete.length;
	}

	/**
	 * Update an existing memory entry.
	 */
	update(id: string, updates: Partial<Pick<SmaranEntry, "content" | "category" | "tags" | "confidence">>): SmaranEntry | null {
		this.ensureLoaded();
		const entry = this.entries.get(id);
		if (!entry) return null;

		if (updates.content !== undefined) entry.content = updates.content;
		if (updates.category !== undefined) entry.category = updates.category;
		if (updates.tags !== undefined) entry.tags = updates.tags;
		if (updates.confidence !== undefined) entry.confidence = updates.confidence;
		entry.updatedAt = new Date().toISOString();

		this.saveEntry(entry);
		return entry;
	}

	/**
	 * Get a single entry by ID.
	 */
	get(id: string): SmaranEntry | null {
		this.ensureLoaded();
		return this.entries.get(id) ?? null;
	}

	// ─── Query ────────────────────────────────────────────────────────────

	/**
	 * Recall memories relevant to a query using BM25-like scoring.
	 * Returns sorted by relevance, filtered by threshold.
	 */
	recall(query: string, limit?: number): SmaranEntry[] {
		this.ensureLoaded();
		if (this.entries.size === 0) return [];

		const maxResults = limit ?? this.config.recallLimit;
		const queryTerms = tokenize(query);
		if (queryTerms.length === 0) return [];

		// Build document frequency map
		const df = new Map<string, number>();
		for (const entry of this.entries.values()) {
			const terms = new Set(tokenize(entry.content + " " + entry.tags.join(" ")));
			for (const term of terms) {
				df.set(term, (df.get(term) ?? 0) + 1);
			}
		}

		const N = this.entries.size;
		const scored: Array<{ entry: SmaranEntry; score: number }> = [];

		for (const entry of this.entries.values()) {
			const docText = (entry.content + " " + entry.tags.join(" ")).toLowerCase();
			const docTerms = tokenize(docText);
			const docLen = docTerms.length;
			const avgLen = 20; // Reasonable estimate for short memory entries
			const k1 = 1.5;
			const b = 0.75;

			let bm25 = 0;
			for (const qt of queryTerms) {
				const termFreq = docTerms.filter(t => t === qt).length;
				if (termFreq === 0) continue;
				const docFreq = df.get(qt) ?? 0;
				const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
				const tf = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * docLen / avgLen));
				bm25 += idf * tf;
			}

			// Boost for exact substring match
			const queryLower = query.toLowerCase();
			if (docText.includes(queryLower)) {
				bm25 *= 1.5;
			}

			// Boost for high confidence
			bm25 *= (0.5 + 0.5 * entry.confidence);

			// Temporal decay for entries with decay configured
			if (entry.decayHalfLifeDays > 0) {
				const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
				const ageDays = ageMs / (1000 * 60 * 60 * 24);
				const decay = Math.exp(-Math.LN2 * ageDays / entry.decayHalfLifeDays);
				bm25 *= decay;
			}

			if (bm25 >= this.config.recallThreshold) {
				scored.push({ entry, score: bm25 });
			}
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, maxResults).map(s => s.entry);
	}

	/**
	 * List all entries matching a category.
	 */
	listByCategory(category: SmaranCategory): SmaranEntry[] {
		this.ensureLoaded();
		const results: SmaranEntry[] = [];
		for (const entry of this.entries.values()) {
			if (entry.category === category) results.push(entry);
		}
		return results.sort((a, b) => b.confidence - a.confidence);
	}

	/**
	 * List all entries.
	 */
	listAll(): SmaranEntry[] {
		this.ensureLoaded();
		return [...this.entries.values()].sort(
			(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);
	}

	/**
	 * Get total count of stored memories.
	 */
	get size(): number {
		this.ensureLoaded();
		return this.entries.size;
	}

	// ─── Context Building ─────────────────────────────────────────────────

	/**
	 * Build a formatted context section for system prompt injection.
	 *
	 * If a query is provided, returns relevant memories scored by BM25.
	 * Otherwise returns all memories grouped by category.
	 *
	 * @param query - Optional query to filter by relevance
	 * @param maxTokens - Approximate max characters (default: 2000)
	 * @returns Formatted markdown section, or empty string if no memories
	 */
	buildContextSection(query?: string, maxTokens = 2000): string {
		this.ensureLoaded();
		if (this.entries.size === 0) return "";

		const entries = query
			? this.recall(query, 15)
			: this.listAll().slice(0, 20);

		if (entries.length === 0) return "";

		const sections: string[] = [];
		sections.push("## User Memory (Smaran)");
		sections.push("");

		// Group by category
		const grouped = new Map<SmaranCategory, SmaranEntry[]>();
		for (const entry of entries) {
			const list = grouped.get(entry.category) ?? [];
			list.push(entry);
			grouped.set(entry.category, list);
		}

		const categoryLabels: Record<SmaranCategory, string> = {
			preference: "Preferences",
			fact: "Known Facts",
			decision: "Decisions",
			instruction: "Standing Instructions",
			context: "Context",
		};

		let totalLen = 0;
		for (const [category, catEntries] of grouped) {
			if (totalLen >= maxTokens) break;
			sections.push(`### ${categoryLabels[category]}`);
			for (const entry of catEntries) {
				if (totalLen >= maxTokens) break;
				const conf = entry.source === "explicit" ? "" : ` (confidence: ${entry.confidence.toFixed(1)})`;
				const line = `- ${entry.content}${conf}`;
				sections.push(line);
				totalLen += line.length;
			}
			sections.push("");
		}

		return sections.join("\n");
	}

	// ─── Maintenance ──────────────────────────────────────────────────────

	/**
	 * Apply temporal decay to all entries with configured half-lives.
	 * Call periodically (e.g., on session start).
	 */
	decayConfidence(): void {
		this.ensureLoaded();
		const now = Date.now();
		let modified = false;

		for (const entry of this.entries.values()) {
			if (entry.decayHalfLifeDays <= 0) continue;

			const ageMs = now - new Date(entry.updatedAt).getTime();
			const ageDays = ageMs / (1000 * 60 * 60 * 24);
			const decay = Math.exp(-Math.LN2 * ageDays / entry.decayHalfLifeDays);
			const newConf = entry.confidence * decay;

			if (Math.abs(newConf - entry.confidence) > 0.01) {
				entry.confidence = Math.max(0, newConf);
				modified = true;
			}
		}

		if (modified) this.saveAll();
	}

	/**
	 * Remove entries below a confidence threshold.
	 * Returns removed entries.
	 */
	prune(threshold?: number): SmaranEntry[] {
		this.ensureLoaded();
		const thresh = threshold ?? 0.05;
		const removed: SmaranEntry[] = [];

		for (const [id, entry] of this.entries) {
			if (entry.confidence < thresh) {
				removed.push(entry);
				this.entries.delete(id);
				this.deleteFile(id);
			}
		}

		return removed;
	}

	// ─── Persistence ──────────────────────────────────────────────────────

	private ensureLoaded(): void {
		if (this.loaded) return;
		this.loadAll();
		this.loaded = true;
	}

	private loadAll(): void {
		if (!fs.existsSync(this.storagePath)) return;

		const files = fs.readdirSync(this.storagePath).filter(f => f.endsWith(".md"));
		for (const file of files) {
			try {
				const content = fs.readFileSync(path.join(this.storagePath, file), "utf-8");
				const entry = this.fromMarkdown(content);
				if (entry) {
					this.entries.set(entry.id, entry);
				}
			} catch {
				// Skip malformed files
			}
		}
	}

	private saveAll(): void {
		for (const entry of this.entries.values()) {
			this.saveEntry(entry);
		}
	}

	private saveEntry(entry: SmaranEntry): void {
		fs.mkdirSync(this.storagePath, { recursive: true });
		const filePath = path.join(this.storagePath, `${entry.id}.md`);
		const content = this.toMarkdown(entry);
		fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
	}

	private deleteFile(id: string): void {
		const filePath = path.join(this.storagePath, `${id}.md`);
		try {
			if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
		} catch {
			// Best-effort deletion
		}
	}

	// ─── Markdown Serialization ───────────────────────────────────────────

	private toMarkdown(entry: SmaranEntry): string {
		const lines: string[] = [];
		lines.push("---");
		lines.push(`id: ${entry.id}`);
		lines.push(`category: ${entry.category}`);
		lines.push(`source: ${entry.source}`);
		lines.push(`confidence: ${entry.confidence}`);
		if (entry.tags.length > 0) {
			lines.push(`tags: [${entry.tags.join(", ")}]`);
		} else {
			lines.push("tags: []");
		}
		lines.push(`created: ${entry.createdAt}`);
		lines.push(`updated: ${entry.updatedAt}`);
		if (entry.sessionId) {
			lines.push(`session: ${entry.sessionId}`);
		}
		lines.push(`decayHalfLifeDays: ${entry.decayHalfLifeDays}`);
		lines.push("---");
		lines.push("");
		lines.push(entry.content);
		lines.push("");
		return lines.join("\n");
	}

	private fromMarkdown(content: string): SmaranEntry | null {
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

	// ─── Internal Helpers ─────────────────────────────────────────────────

	/**
	 * Find an existing entry with similar content (>80% term overlap).
	 */
	private findSimilar(content: string): SmaranEntry | null {
		const queryTerms = new Set(tokenize(content));
		if (queryTerms.size === 0) return null;

		for (const entry of this.entries.values()) {
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

	/**
	 * Remove the N lowest-confidence entries.
	 */
	private pruneLowest(count: number): void {
		const sorted = [...this.entries.values()].sort((a, b) => a.confidence - b.confidence);
		for (let i = 0; i < count && i < sorted.length; i++) {
			this.entries.delete(sorted[i].id);
			this.deleteFile(sorted[i].id);
		}
	}
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/** FNV-1a hash (32-bit). */
function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash;
}

/** Tokenize text into lowercase terms, stripping punctuation. */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter(t => t.length > 1);
}

/** Extract tags from content using keyword heuristics. */
function extractTags(content: string): string[] {
	const tags: string[] = [];
	const lower = content.toLowerCase();

	// Common category keywords
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

/** Parse simple YAML key-value pairs. */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
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

		// Scalar
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

/** Parse tags from YAML value (handles both arrays and strings). */
function parseTags(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string") return value.split(",").map(s => s.trim()).filter(Boolean);
	return [];
}
