/**
 * @chitragupta/smriti -- CritiqueStore (persistent critique memory)
 *
 * Enables Takumi (AI gateway) and other agents to store and retrieve
 * task critique findings. Findings are persisted in SQLite via the shared
 * agent database and support BM25 text search, deduplication, auto-expiry,
 * and per-task cardinality limits.
 *
 * Storage: agent.db `critiques` table (created lazily on first use).
 *
 * @module critique-store
 */

import crypto from "crypto";
import type BetterSqlite3 from "better-sqlite3";
import { getAgentDb } from "./session-db.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Severity levels for critique findings, from informational to critical. */
export type CritiqueSeverity = "info" | "warning" | "error" | "critical";

/**
 * A single critique finding produced during task evaluation.
 * Each finding is uniquely identified and associated with a task hash.
 */
export interface CritiqueFinding {
	/** Auto-generated UUID (v4). */
	id: string;
	/** Hash of the task that was critiqued. */
	taskHash: string;
	/** Finding severity level. */
	severity: CritiqueSeverity;
	/** Domain category, e.g. "security", "performance", "correctness". */
	category: string;
	/** Human-readable finding description. */
	message: string;
	/** Optional file path relevant to the finding. */
	file?: string;
	/** Optional line number within the file. */
	line?: number;
	/** Arbitrary metadata attached by the producing agent. */
	metadata?: Record<string, unknown>;
	/** Epoch milliseconds when this finding was created. */
	createdAt: number;
	/** Session ID of the agent session that produced this finding. */
	sessionId?: string;
}

/** Configuration options for the CritiqueStore. */
export interface CritiqueStoreConfig {
	/** Maximum critiques retained per task hash. Default: 50. */
	maxPerTask?: number;
	/** Auto-expire findings older than N days. Default: 90. */
	retentionDays?: number;
	/** Suppress identical findings within N ms. Default: 60000 (1 min). */
	dedupeWindow?: number;
}

// ─── Hard Ceilings ──────────────────────────────────────────────────────────

const HARD_CEILINGS = {
	maxPerTask: 500,
	retentionDays: 365,
	dedupeWindow: 600_000, // 10 min max
} as const;

const DEFAULTS: Required<CritiqueStoreConfig> = {
	maxPerTask: 50,
	retentionDays: 90,
	dedupeWindow: 60_000,
};

// ─── Aggregate stats returned by getStats(). ────────────────────────────────

/** Aggregate statistics across all stored critique findings. */
export interface CritiqueStats {
	totalCritiques: number;
	uniqueTasks: number;
	bySeverity: Record<string, number>;
}

// ─── BM25 helpers (lightweight, inline) ─────────────────────────────────────

/** Tokenize text into lowercase terms, stripping punctuation. */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter(t => t.length > 1);
}

// ─── CritiqueStore ──────────────────────────────────────────────────────────

/**
 * Persistent critique memory service backed by SQLite.
 *
 * Provides storage, deduplication, BM25 search, auto-expiry, and stats
 * for task critique findings produced by Takumi and other agents.
 */
export class CritiqueStore {
	private readonly config: Required<CritiqueStoreConfig>;
	private schemaReady = false;

	constructor(config?: CritiqueStoreConfig) {
		this.config = {
			maxPerTask: Math.min(
				config?.maxPerTask ?? DEFAULTS.maxPerTask,
				HARD_CEILINGS.maxPerTask,
			),
			retentionDays: Math.min(
				config?.retentionDays ?? DEFAULTS.retentionDays,
				HARD_CEILINGS.retentionDays,
			),
			dedupeWindow: Math.min(
				config?.dedupeWindow ?? DEFAULTS.dedupeWindow,
				HARD_CEILINGS.dedupeWindow,
			),
		};
	}

	// ─── Schema Bootstrap ────────────────────────────────────────────────

	/** Ensure the critiques table and indices exist. */
	private ensureSchema(): BetterSqlite3.Database {
		const db = getAgentDb();
		if (!this.schemaReady) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS critiques (
					id TEXT PRIMARY KEY,
					task_hash TEXT NOT NULL,
					severity TEXT NOT NULL,
					category TEXT NOT NULL,
					message TEXT NOT NULL,
					file TEXT,
					line INTEGER,
					metadata TEXT,
					session_id TEXT,
					created_at INTEGER NOT NULL
				);
				CREATE INDEX IF NOT EXISTS idx_critiques_task ON critiques(task_hash);
				CREATE INDEX IF NOT EXISTS idx_critiques_created ON critiques(created_at);
			`);
			this.schemaReady = true;
		}
		return db;
	}

	// ─── Core Operations ─────────────────────────────────────────────────

	/**
	 * Store a critique finding with deduplication.
	 *
	 * Before inserting, checks whether an identical (taskHash + category + message)
	 * finding exists within the configured dedupeWindow. If so, the insert is
	 * suppressed and the existing finding is returned.
	 *
	 * When the per-task limit is reached, the oldest findings are pruned.
	 *
	 * @param taskHash - Hash of the task being critiqued.
	 * @param finding - The finding to store (id and createdAt are auto-generated).
	 * @returns The stored (or existing duplicate) CritiqueFinding.
	 */
	storeCritique(
		taskHash: string,
		finding: Omit<CritiqueFinding, "id" | "createdAt" | "taskHash">,
	): CritiqueFinding {
		const db = this.ensureSchema();
		const now = Date.now();

		// Dedupe: check for identical finding within window
		const cutoff = now - this.config.dedupeWindow;
		const existing = db.prepare(`
			SELECT id, task_hash, severity, category, message, file, line, metadata, session_id, created_at
			FROM critiques
			WHERE task_hash = ? AND category = ? AND message = ? AND created_at > ?
			ORDER BY created_at DESC LIMIT 1
		`).get(taskHash, finding.category, finding.message, cutoff) as Record<string, unknown> | undefined;

		if (existing) {
			return this.rowToFinding(existing);
		}

		const id = crypto.randomUUID();
		const metaJson = finding.metadata ? JSON.stringify(finding.metadata) : null;

		db.prepare(`
			INSERT INTO critiques (id, task_hash, severity, category, message, file, line, metadata, session_id, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(id, taskHash, finding.severity, finding.category, finding.message,
			finding.file ?? null, finding.line ?? null, metaJson, finding.sessionId ?? null, now);

		// Enforce per-task cardinality limit
		this.enforceTaskLimit(db, taskHash);

		return {
			id,
			taskHash,
			severity: finding.severity,
			category: finding.category,
			message: finding.message,
			file: finding.file,
			line: finding.line,
			metadata: finding.metadata,
			sessionId: finding.sessionId,
			createdAt: now,
		};
	}

	/**
	 * Retrieve critique findings for a specific task hash.
	 *
	 * Results are ordered by creation time descending (most recent first).
	 *
	 * @param taskHash - The task hash to query.
	 * @param k - Maximum number of results. Default: 10.
	 * @returns Array of CritiqueFinding ordered by recency.
	 */
	retrieveCritiques(taskHash: string, k = 10): CritiqueFinding[] {
		const db = this.ensureSchema();
		const rows = db.prepare(`
			SELECT id, task_hash, severity, category, message, file, line, metadata, session_id, created_at
			FROM critiques
			WHERE task_hash = ?
			ORDER BY created_at DESC
			LIMIT ?
		`).all(taskHash, k) as Array<Record<string, unknown>>;

		return rows.map(r => this.rowToFinding(r));
	}

	/**
	 * BM25 text search across all critique findings.
	 *
	 * Searches the concatenation of category + message + file for each finding.
	 *
	 * @param query - Free-text search query.
	 * @param limit - Maximum results. Default: 10.
	 * @returns Array of CritiqueFinding sorted by BM25 relevance.
	 */
	searchCritiques(query: string, limit = 10): CritiqueFinding[] {
		const db = this.ensureSchema();
		const queryTerms = tokenize(query);
		if (queryTerms.length === 0) return [];

		const rows = db.prepare(`
			SELECT id, task_hash, severity, category, message, file, line, metadata, session_id, created_at
			FROM critiques
		`).all() as Array<Record<string, unknown>>;

		if (rows.length === 0) return [];

		// Build document frequency map
		const df = new Map<string, number>();
		const docs: Array<{ finding: CritiqueFinding; terms: string[] }> = [];

		for (const row of rows) {
			const finding = this.rowToFinding(row);
			const text = `${finding.category} ${finding.message} ${finding.file ?? ""}`;
			const terms = tokenize(text);
			docs.push({ finding, terms });

			const uniqueTerms = new Set(terms);
			for (const t of uniqueTerms) {
				df.set(t, (df.get(t) ?? 0) + 1);
			}
		}

		const N = docs.length;
		const k1 = 1.5;
		const b = 0.75;
		const avgLen = 15;
		const queryLower = query.toLowerCase();

		const scored: Array<{ finding: CritiqueFinding; score: number }> = [];

		for (const doc of docs) {
			let bm25 = 0;
			for (const qt of queryTerms) {
				const termFreq = doc.terms.filter(t => t === qt).length;
				if (termFreq === 0) continue;
				const docFreq = df.get(qt) ?? 0;
				const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
				const tf = (termFreq * (k1 + 1)) /
					(termFreq + k1 * (1 - b + b * doc.terms.length / avgLen));
				bm25 += idf * tf;
			}

			// Boost for exact substring match
			const docText = `${doc.finding.category} ${doc.finding.message}`.toLowerCase();
			if (docText.includes(queryLower)) bm25 *= 1.5;

			if (bm25 > 0) scored.push({ finding: doc.finding, score: bm25 });
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit).map(s => s.finding);
	}

	/**
	 * Get aggregate statistics across all stored critique findings.
	 *
	 * @returns Total count, unique task count, and breakdown by severity.
	 */
	getStats(): CritiqueStats {
		const db = this.ensureSchema();

		const total = db.prepare("SELECT COUNT(*) as cnt FROM critiques").get() as { cnt: number };
		const tasks = db.prepare("SELECT COUNT(DISTINCT task_hash) as cnt FROM critiques").get() as { cnt: number };

		const severityRows = db.prepare(
			"SELECT severity, COUNT(*) as cnt FROM critiques GROUP BY severity",
		).all() as Array<{ severity: string; cnt: number }>;

		const bySeverity: Record<string, number> = {};
		for (const row of severityRows) {
			bySeverity[row.severity] = row.cnt;
		}

		return {
			totalCritiques: total.cnt,
			uniqueTasks: tasks.cnt,
			bySeverity,
		};
	}

	/**
	 * Remove findings older than the configured retentionDays.
	 *
	 * @returns Number of expired findings removed.
	 */
	purgeExpired(): number {
		const db = this.ensureSchema();
		const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;

		const result = db.prepare("DELETE FROM critiques WHERE created_at < ?").run(cutoff);
		return result.changes;
	}

	/**
	 * Clear all findings, or only findings for a specific task hash.
	 *
	 * @param taskHash - If provided, only clear findings for this task. Otherwise clear all.
	 */
	clear(taskHash?: string): void {
		const db = this.ensureSchema();
		if (taskHash) {
			db.prepare("DELETE FROM critiques WHERE task_hash = ?").run(taskHash);
		} else {
			db.prepare("DELETE FROM critiques").run();
		}
	}

	// ─── Internal Helpers ────────────────────────────────────────────────

	/**
	 * Enforce the maxPerTask cardinality limit by pruning the oldest entries.
	 *
	 * @param db - The database connection.
	 * @param taskHash - The task hash to enforce the limit for.
	 */
	private enforceTaskLimit(db: BetterSqlite3.Database, taskHash: string): void {
		const count = db.prepare(
			"SELECT COUNT(*) as cnt FROM critiques WHERE task_hash = ?",
		).get(taskHash) as { cnt: number };

		if (count.cnt > this.config.maxPerTask) {
			const excess = count.cnt - this.config.maxPerTask;
			db.prepare(`
				DELETE FROM critiques WHERE id IN (
					SELECT id FROM critiques WHERE task_hash = ? ORDER BY created_at ASC LIMIT ?
				)
			`).run(taskHash, excess);
		}
	}

	/**
	 * Convert a raw SQLite row into a typed CritiqueFinding.
	 *
	 * @param row - A record from the critiques table.
	 * @returns A fully typed CritiqueFinding.
	 */
	private rowToFinding(row: Record<string, unknown>): CritiqueFinding {
		let metadata: Record<string, unknown> | undefined;
		try {
			metadata = row.metadata ? JSON.parse(row.metadata as string) : undefined;
		} catch {
			metadata = undefined;
		}

		return {
			id: row.id as string,
			taskHash: row.task_hash as string,
			severity: row.severity as CritiqueSeverity,
			category: row.category as string,
			message: row.message as string,
			file: (row.file as string) ?? undefined,
			line: (row.line as number) ?? undefined,
			metadata,
			sessionId: (row.session_id as string) ?? undefined,
			createdAt: row.created_at as number,
		};
	}
}
