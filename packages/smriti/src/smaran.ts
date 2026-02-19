/**
 * @chitragupta/smriti — Smaran (स्मरण — Active Remembering)
 *
 * Explicit memory store for user preferences, facts, decisions, and instructions.
 * Each memory is a structured entry stored as an individual .md file with YAML frontmatter.
 *
 * Storage: ~/.chitragupta/smaran/
 *
 * Persistence, serialization, and text processing helpers are in
 * smaran-store.ts for file size compliance.
 *
 * @module smaran
 */

import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import {
	fnv1a,
	extractTags,
	loadSmaranEntries,
	saveSmaranEntry,
	deleteSmaranFile,
	findSimilarEntry,
	scoreBM25Recall,
} from "./smaran-store.js";

// Re-export smaran-store symbols so index.ts needs no changes
export {
	fnv1a,
	tokenize,
	extractTags,
	loadSmaranEntries,
	saveSmaranEntry,
	deleteSmaranFile,
	toSmaranMarkdown,
	fromSmaranMarkdown,
	findSimilarEntry,
	scoreBM25Recall,
	parseSimpleYaml,
	parseTags,
} from "./smaran-store.js";
export type { ScoredEntry } from "./smaran-store.js";

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

	/** Save a new explicit memory. Returns the created entry. */
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

		// Check for duplicates — if content is very similar, update instead
		const existing = findSimilarEntry(content, this.entries.values());
		if (existing) {
			existing.confidence = Math.min(1, existing.confidence + 0.1);
			existing.updatedAt = new Date().toISOString();
			if (opts?.tags) {
				existing.tags = [...new Set([...existing.tags, ...opts.tags])];
			}
			saveSmaranEntry(this.storagePath, existing);
			return existing;
		}

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
		saveSmaranEntry(this.storagePath, entry);
		return entry;
	}

	/** Delete a memory by ID. Returns true if deleted. */
	forget(id: string): boolean {
		this.ensureLoaded();
		if (!this.entries.has(id)) return false;
		this.entries.delete(id);
		deleteSmaranFile(this.storagePath, id);
		return true;
	}

	/** Forget memories matching a content substring. Returns count deleted. */
	forgetByContent(query: string): number {
		this.ensureLoaded();
		const lower = query.toLowerCase();
		const toDelete: string[] = [];
		for (const [id, entry] of this.entries) {
			if (entry.content.toLowerCase().includes(lower)) toDelete.push(id);
		}
		for (const id of toDelete) {
			this.entries.delete(id);
			deleteSmaranFile(this.storagePath, id);
		}
		return toDelete.length;
	}

	/** Update an existing memory entry. */
	update(
		id: string,
		updates: Partial<Pick<SmaranEntry, "content" | "category" | "tags" | "confidence">>,
	): SmaranEntry | null {
		this.ensureLoaded();
		const entry = this.entries.get(id);
		if (!entry) return null;

		if (updates.content !== undefined) entry.content = updates.content;
		if (updates.category !== undefined) entry.category = updates.category;
		if (updates.tags !== undefined) entry.tags = updates.tags;
		if (updates.confidence !== undefined) entry.confidence = updates.confidence;
		entry.updatedAt = new Date().toISOString();

		saveSmaranEntry(this.storagePath, entry);
		return entry;
	}

	/** Get a single entry by ID. */
	get(id: string): SmaranEntry | null {
		this.ensureLoaded();
		return this.entries.get(id) ?? null;
	}

	// ─── Query ────────────────────────────────────────────────────────────

	/** Recall memories relevant to a query using BM25-like scoring. */
	recall(query: string, limit?: number): SmaranEntry[] {
		this.ensureLoaded();
		if (this.entries.size === 0) return [];
		const maxResults = limit ?? this.config.recallLimit;
		const scored = scoreBM25Recall(this.entries.values(), query, this.config.recallThreshold);
		return scored.slice(0, maxResults).map(s => s.entry);
	}

	/** List all entries matching a category. */
	listByCategory(category: SmaranCategory): SmaranEntry[] {
		this.ensureLoaded();
		const results: SmaranEntry[] = [];
		for (const entry of this.entries.values()) {
			if (entry.category === category) results.push(entry);
		}
		return results.sort((a, b) => b.confidence - a.confidence);
	}

	/** List all entries. */
	listAll(): SmaranEntry[] {
		this.ensureLoaded();
		return [...this.entries.values()].sort(
			(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);
	}

	/** Get total count of stored memories. */
	get size(): number {
		this.ensureLoaded();
		return this.entries.size;
	}

	// ─── Context Building ─────────────────────────────────────────────────

	/**
	 * Build a formatted context section for system prompt injection.
	 * If a query is provided, returns relevant memories scored by BM25.
	 * Otherwise returns all memories grouped by category.
	 */
	buildContextSection(query?: string, maxTokens = 2000): string {
		this.ensureLoaded();
		if (this.entries.size === 0) return "";

		const entries = query
			? this.recall(query, 15)
			: this.listAll().slice(0, 20);

		if (entries.length === 0) return "";

		const sections: string[] = ["## User Memory (Smaran)", ""];
		const grouped = new Map<SmaranCategory, SmaranEntry[]>();
		for (const entry of entries) {
			const list = grouped.get(entry.category) ?? [];
			list.push(entry);
			grouped.set(entry.category, list);
		}

		const labels: Record<SmaranCategory, string> = {
			preference: "Preferences",
			fact: "Known Facts",
			decision: "Decisions",
			instruction: "Standing Instructions",
			context: "Context",
		};

		let totalLen = 0;
		for (const [category, catEntries] of grouped) {
			if (totalLen >= maxTokens) break;
			sections.push(`### ${labels[category]}`);
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

	/** Apply temporal decay to all entries with configured half-lives. */
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

		if (modified) {
			for (const entry of this.entries.values()) {
				saveSmaranEntry(this.storagePath, entry);
			}
		}
	}

	/** Remove entries below a confidence threshold. */
	prune(threshold?: number): SmaranEntry[] {
		this.ensureLoaded();
		const thresh = threshold ?? 0.05;
		const removed: SmaranEntry[] = [];
		for (const [id, entry] of this.entries) {
			if (entry.confidence < thresh) {
				removed.push(entry);
				this.entries.delete(id);
				deleteSmaranFile(this.storagePath, id);
			}
		}
		return removed;
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private ensureLoaded(): void {
		if (this.loaded) return;
		this.entries = loadSmaranEntries(this.storagePath);
		this.loaded = true;
	}

	/** Remove the N lowest-confidence entries. */
	private pruneLowest(count: number): void {
		const sorted = [...this.entries.values()].sort((a, b) => a.confidence - b.confidence);
		for (let i = 0; i < count && i < sorted.length; i++) {
			this.entries.delete(sorted[i].id);
			deleteSmaranFile(this.storagePath, sorted[i].id);
		}
	}
}
