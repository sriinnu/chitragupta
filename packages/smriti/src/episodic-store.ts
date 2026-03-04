/**
 * @chitragupta/smriti — EpisodicMemoryStore
 *
 * Durable episodic developer memory that tags memories with error signatures,
 * tool names, file paths, and auto-recalls them when similar errors recur.
 *
 * Example: "Has the user hit Vitest ESM mismatch before?"
 * → "Yes, Feb 28, fixed with module: NodeNext"
 *
 * Storage: agent.db `episodes` table (created lazily on first use).
 * Uses better-sqlite3 via the shared DatabaseManager / getAgentDb() pattern.
 *
 * @module episodic-store
 */

import crypto from "crypto";
import type BetterSqlite3 from "better-sqlite3";
import { getAgentDb } from "./session-db.js";
import type { Episode, EpisodeInput, EpisodicQuery } from "./episodic-types.js";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Hard ceiling for description/solution fields to prevent DB bloat. */
const MAX_TEXT_LENGTH = 10_000;

/** Default result limit for queries. */
const DEFAULT_LIMIT = 10;

/** BM25 tuning constants. */
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const BM25_AVG_DOC_LEN = 30;

// ─── Error Signature Normalization Patterns ────────────────────────────────

/** Patterns to strip from error messages for normalization. */
const NORMALIZATION_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
	// Timestamps (ISO, epoch) — must come BEFORE line:col stripping
	{ pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?/g, replacement: "<TIME>" },
	{ pattern: /\b\d{10,13}\b/g, replacement: "<EPOCH>" },
	// File paths (Unix and Windows)
	{ pattern: /(?:\/[\w./-]+|[A-Z]:\\[\w.\\-]+)/g, replacement: "<PATH>" },
	// Line:column references
	{ pattern: /:\d+:\d+/g, replacement: "" },
	// Line numbers (standalone "line 42", "L42", etc.)
	{ pattern: /\bline\s+\d+/gi, replacement: "" },
	{ pattern: /\bL\d+\b/g, replacement: "" },
	// UUIDs
	{ pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, replacement: "<UUID>" },
	// Hex hashes (8+ chars)
	{ pattern: /\b[0-9a-f]{8,64}\b/gi, replacement: "<HASH>" },
	// Collapse whitespace
	{ pattern: /\s+/g, replacement: " " },
];

// ─── Tokenization ──────────────────────────────────────────────────────────

/** Tokenize text into lowercase terms for BM25 search. */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 1);
}

// ─── EpisodicMemoryStore ───────────────────────────────────────────────────

/**
 * Durable episodic developer memory backed by SQLite.
 *
 * Records developer experiences (errors, fixes, discoveries) tagged with
 * error signatures, tool names, and file paths. Supports recall by any
 * combination of these dimensions plus full-text BM25 search.
 *
 * The recall count tracks how often each episode is retrieved, surfacing
 * frequently-needed knowledge.
 */
export class EpisodicMemoryStore {
	private schemaReady = false;

	// ─── Schema Bootstrap ────────────────────────────────────────────────

	/** Ensure the episodes table and indices exist. Idempotent. */
	private ensureSchema(): BetterSqlite3.Database {
		const db = getAgentDb();
		if (!this.schemaReady) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS episodes (
					id TEXT PRIMARY KEY,
					created_at TEXT NOT NULL,
					project TEXT NOT NULL,
					error_signature TEXT,
					tool_name TEXT,
					file_path TEXT,
					description TEXT NOT NULL,
					solution TEXT,
					tags TEXT NOT NULL DEFAULT '[]',
					recall_count INTEGER NOT NULL DEFAULT 0,
					last_recalled TEXT
				);
				CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project);
				CREATE INDEX IF NOT EXISTS idx_episodes_error_sig ON episodes(error_signature);
				CREATE INDEX IF NOT EXISTS idx_episodes_tool ON episodes(tool_name);
				CREATE INDEX IF NOT EXISTS idx_episodes_file ON episodes(file_path);
				CREATE INDEX IF NOT EXISTS idx_episodes_recall ON episodes(recall_count DESC);
			`);
			this.schemaReady = true;
		}
		return db;
	}

	// ─── Record ──────────────────────────────────────────────────────────

	/**
	 * Store a new episodic memory.
	 *
	 * @param episode - The episode to record.
	 * @returns The UUID of the newly created episode.
	 */
	record(episode: EpisodeInput): string {
		const db = this.ensureSchema();
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const description = truncateText(episode.description);
		const solution = episode.solution ? truncateText(episode.solution) : null;
		const tags = JSON.stringify(episode.tags ?? []);

		db.prepare(`
			INSERT INTO episodes (id, created_at, project, error_signature, tool_name, file_path, description, solution, tags, recall_count, last_recalled)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
		`).run(
			id,
			now,
			episode.project,
			episode.errorSignature ?? null,
			episode.toolName ?? null,
			episode.filePath ?? null,
			description,
			solution,
			tags,
		);

		return id;
	}

	// ─── Recall Methods ──────────────────────────────────────────────────

	/**
	 * Find episodes matching a multi-dimensional query.
	 * All provided fields are AND-ed together.
	 *
	 * @param query - The query parameters.
	 * @returns Matching episodes sorted by recall count descending, then recency.
	 */
	recall(query: EpisodicQuery): Episode[] {
		const db = this.ensureSchema();
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (query.project) {
			conditions.push("project = ?");
			params.push(query.project);
		}
		if (query.errorSignature) {
			conditions.push("error_signature = ?");
			params.push(query.errorSignature);
		}
		if (query.toolName) {
			conditions.push("tool_name = ?");
			params.push(query.toolName);
		}
		if (query.filePath) {
			conditions.push("file_path = ?");
			params.push(query.filePath);
		}

		const limit = Math.min(100, Math.max(1, query.limit ?? DEFAULT_LIMIT));

		// If text search is requested, we need to do post-filtering BM25
		if (query.text) {
			return this.searchWithFilters(db, query.text, conditions, params, limit);
		}

		if (conditions.length === 0) {
			// No filters — return most recent
			const rows = db.prepare(
				`SELECT * FROM episodes ORDER BY recall_count DESC, created_at DESC LIMIT ?`,
			).all(limit) as Array<Record<string, unknown>>;
			return rows.map(rowToEpisode);
		}

		const where = conditions.join(" AND ");
		const rows = db.prepare(
			`SELECT * FROM episodes WHERE ${where} ORDER BY recall_count DESC, created_at DESC LIMIT ?`,
		).all(...params, limit) as Array<Record<string, unknown>>;

		return rows.map(rowToEpisode);
	}

	/**
	 * Find episodes matching an error signature.
	 *
	 * @param errorSignature - The normalized error pattern to match.
	 * @returns Matching episodes sorted by recall count descending.
	 */
	recallByError(errorSignature: string): Episode[] {
		const db = this.ensureSchema();
		const rows = db.prepare(
			`SELECT * FROM episodes WHERE error_signature = ? ORDER BY recall_count DESC, created_at DESC LIMIT ?`,
		).all(errorSignature, DEFAULT_LIMIT) as Array<Record<string, unknown>>;
		return rows.map(rowToEpisode);
	}

	/**
	 * Find episodes related to a specific file path.
	 *
	 * @param filePath - The file path to search for.
	 * @param limit - Maximum results. Default: 10.
	 * @returns Matching episodes sorted by recency.
	 */
	recallByFile(filePath: string, limit?: number): Episode[] {
		const db = this.ensureSchema();
		const cap = Math.min(100, Math.max(1, limit ?? DEFAULT_LIMIT));
		const rows = db.prepare(
			`SELECT * FROM episodes WHERE file_path = ? ORDER BY created_at DESC LIMIT ?`,
		).all(filePath, cap) as Array<Record<string, unknown>>;
		return rows.map(rowToEpisode);
	}

	/**
	 * Find episodes involving a specific tool.
	 *
	 * @param toolName - The tool name to search for.
	 * @param limit - Maximum results. Default: 10.
	 * @returns Matching episodes sorted by recency.
	 */
	recallByTool(toolName: string, limit?: number): Episode[] {
		const db = this.ensureSchema();
		const cap = Math.min(100, Math.max(1, limit ?? DEFAULT_LIMIT));
		const rows = db.prepare(
			`SELECT * FROM episodes WHERE tool_name = ? ORDER BY created_at DESC LIMIT ?`,
		).all(toolName, cap) as Array<Record<string, unknown>>;
		return rows.map(rowToEpisode);
	}

	/**
	 * Full-text BM25 search across description and solution fields.
	 *
	 * @param text - The search query.
	 * @param limit - Maximum results. Default: 10.
	 * @returns Matching episodes ranked by BM25 relevance.
	 */
	search(text: string, limit?: number): Episode[] {
		const db = this.ensureSchema();
		const cap = Math.min(100, Math.max(1, limit ?? DEFAULT_LIMIT));
		return this.searchWithFilters(db, text, [], [], cap);
	}

	// ─── Recall Tracking ─────────────────────────────────────────────────

	/**
	 * Increment the recall counter for an episode.
	 *
	 * @param id - The episode ID to bump.
	 */
	bumpRecallCount(id: string): void {
		const db = this.ensureSchema();
		const now = new Date().toISOString();
		db.prepare(
			`UPDATE episodes SET recall_count = recall_count + 1, last_recalled = ? WHERE id = ?`,
		).run(now, id);
	}

	/**
	 * Get the most frequently recalled episodes — the "hot" knowledge.
	 *
	 * @param limit - Maximum results. Default: 10.
	 * @returns Episodes sorted by recall count descending.
	 */
	getFrequentErrors(limit?: number): Episode[] {
		const db = this.ensureSchema();
		const cap = Math.min(100, Math.max(1, limit ?? DEFAULT_LIMIT));
		const rows = db.prepare(
			`SELECT * FROM episodes WHERE recall_count > 0 ORDER BY recall_count DESC, created_at DESC LIMIT ?`,
		).all(cap) as Array<Record<string, unknown>>;
		return rows.map(rowToEpisode);
	}

	// ─── Error Signature Normalization ────────────────────────────────────

	/**
	 * Normalize an error string into a stable signature by stripping
	 * volatile parts (file paths, line numbers, timestamps, hashes).
	 *
	 * The goal is to produce the same signature for the same class of error
	 * regardless of which file/line it occurred on.
	 *
	 * @param error - The raw error string.
	 * @returns A normalized error signature.
	 */
	static normalizeErrorSignature(error: string): string {
		let normalized = error;
		for (const { pattern, replacement } of NORMALIZATION_PATTERNS) {
			normalized = normalized.replace(pattern, replacement);
		}
		return normalized.trim().slice(0, 200);
	}

	// ─── Internal: BM25 Search with Optional SQL Filters ─────────────────

	/**
	 * Perform BM25 text search with optional pre-filters on SQL columns.
	 * Fetches candidates from SQL (with WHERE conditions), then ranks by BM25.
	 */
	private searchWithFilters(
		db: BetterSqlite3.Database,
		text: string,
		conditions: string[],
		params: unknown[],
		limit: number,
	): Episode[] {
		const queryTerms = tokenize(text);
		if (queryTerms.length === 0) return [];

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const rows = db.prepare(
			`SELECT * FROM episodes ${where}`,
		).all(...params) as Array<Record<string, unknown>>;

		if (rows.length === 0) return [];

		// Build document frequency map
		const df = new Map<string, number>();
		const docs: Array<{ episode: Episode; terms: string[] }> = [];

		for (const row of rows) {
			const episode = rowToEpisode(row);
			const docText = `${episode.description} ${episode.solution ?? ""}`;
			const terms = tokenize(docText);
			docs.push({ episode, terms });

			const unique = new Set(terms);
			for (const t of unique) {
				df.set(t, (df.get(t) ?? 0) + 1);
			}
		}

		const N = docs.length;
		const queryLower = text.toLowerCase();
		const scored: Array<{ episode: Episode; score: number }> = [];

		for (const doc of docs) {
			let bm25 = 0;
			for (const qt of queryTerms) {
				const termFreq = doc.terms.filter((t) => t === qt).length;
				if (termFreq === 0) continue;
				const docFreq = df.get(qt) ?? 0;
				const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
				const tf =
					(termFreq * (BM25_K1 + 1)) /
					(termFreq + BM25_K1 * (1 - BM25_B + BM25_B * doc.terms.length / BM25_AVG_DOC_LEN));
				bm25 += idf * tf;
			}

			// Boost for exact substring match in description
			const descLower = doc.episode.description.toLowerCase();
			if (descLower.includes(queryLower)) bm25 *= 1.5;

			if (bm25 > 0) scored.push({ episode: doc.episode, score: bm25 });
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit).map((s) => s.episode);
	}
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Convert a raw SQLite row into a typed Episode. */
function rowToEpisode(row: Record<string, unknown>): Episode {
	let tags: string[] = [];
	try {
		const raw = row.tags as string;
		if (raw) tags = JSON.parse(raw) as string[];
	} catch {
		tags = [];
	}

	return {
		id: row.id as string,
		createdAt: row.created_at as string,
		project: row.project as string,
		errorSignature: (row.error_signature as string) ?? null,
		toolName: (row.tool_name as string) ?? null,
		filePath: (row.file_path as string) ?? null,
		description: row.description as string,
		solution: (row.solution as string) ?? null,
		tags,
		recallCount: (row.recall_count as number) ?? 0,
		lastRecalled: (row.last_recalled as string) ?? null,
	};
}

/** Truncate text to MAX_TEXT_LENGTH to prevent DB bloat. */
function truncateText(text: string): string {
	return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
}
