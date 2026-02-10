/**
 * @chitragupta/smriti — Full-text search across sessions and memory.
 *
 * v2: Uses SQLite FTS5 for session search (O(log N) instead of O(N) disk scans).
 * Falls back to in-memory BM25 for memory files (small corpus, no SQLite index).
 *
 * FTS5 provides built-in BM25 ranking via the `rank` column.
 * Results are post-processed with a recency boost.
 */

import type { SessionMeta, MemoryResult, MemoryScope } from "./types.js";
import { listSessions, loadSession } from "./session-store.js";
import { getMemory, listMemoryScopes } from "./memory-store.js";
import { DatabaseManager } from "./db/database.js";
import { initAgentSchema } from "./db/schema.js";

// ─── SQLite FTS5 Search ─────────────────────────────────────────────────────

/**
 * Get the agent database, initializing schema if needed.
 */
let _dbInitialized = false;
function getAgentDb() {
	const dbm = DatabaseManager.instance();
	if (!_dbInitialized) {
		initAgentSchema(dbm);
		_dbInitialized = true;
	}
	return dbm.get("agent");
}

/** Reset db init flag (for testing). */
export function _resetSearchDbInit(): void {
	_dbInitialized = false;
}

/**
 * Sanitize a query string for FTS5 MATCH syntax.
 * Removes special FTS5 operators and wraps terms for prefix matching.
 */
export function sanitizeFts5Query(query: string): string {
	// Remove FTS5 special chars: ^, *, ", (, ), :, {, }, -, NOT, AND, OR, NEAR
	const cleaned = query
		.replace(/[*^"(){}:]/g, "")
		.replace(/\b(NOT|AND|OR|NEAR)\b/gi, "")
		.trim();

	if (!cleaned) return "";

	// Split into terms and join with implicit AND (space = AND in FTS5)
	const terms = cleaned
		.split(/\s+/)
		.filter((t) => t.length >= 2)
		.map((t) => `"${t}"`) // Quote each term for exact matching
		.join(" ");

	return terms;
}

// ─── Recency Boost ──────────────────────────────────────────────────────────

/**
 * Compute a recency boost factor for a Unix epoch ms timestamp.
 * Returns a multiplier >= 1.0:
 *   - Within the last hour:  up to 1.5x
 *   - Within the last 24h:   up to 1.3x
 *   - Within the last week:  up to 1.1x
 *   - Older:                 1.0x (no boost)
 */
function recencyBoost(epochMs: number): number {
	const ageMs = Date.now() - epochMs;
	const ageHours = ageMs / (1000 * 60 * 60);

	if (ageHours < 1) return 1.5 - 0.2 * (ageHours / 1);
	if (ageHours < 24) return 1.3 - 0.2 * ((ageHours - 1) / 23);
	if (ageHours < 168) return 1.1 - 0.1 * ((ageHours - 24) / 144);
	return 1.0;
}

/**
 * Recency boost from an ISO date string (for memory search backward compat).
 */
function recencyBoostIso(isoDate: string): number {
	return recencyBoost(new Date(isoDate).getTime());
}

// ─── BM25 (in-memory, for memory search only) ──────────────────────────────

const STOP_WORDS = new Set([
	"a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
	"of", "with", "by", "from", "is", "it", "its", "this", "that", "was",
	"are", "be", "been", "being", "have", "has", "had", "do", "does", "did",
	"will", "would", "could", "should", "may", "might", "shall", "can",
	"not", "no", "nor", "so", "if", "then", "than", "too", "very",
	"just", "about", "above", "after", "again", "all", "also", "am",
	"any", "as", "because", "before", "between", "both", "each",
	"few", "get", "got", "he", "her", "here", "him", "his", "how",
	"i", "into", "me", "more", "most", "my", "now", "only", "other",
	"our", "out", "over", "own", "s", "same", "she", "some", "still",
	"such", "t", "their", "them", "there", "these", "they", "those",
	"through", "under", "up", "us", "we", "what", "when", "where",
	"which", "while", "who", "whom", "why", "you", "your",
]);

const BM25_K1 = 1.2;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

interface BM25Document<T> {
	payload: T;
	tf: Map<string, number>;
	length: number;
}

class BM25Corpus<T> {
	private documents: BM25Document<T>[] = [];
	private df: Map<string, number> = new Map();
	private avgDl: number = 0;

	addDocument(payload: T, text: string): void {
		const tokens = tokenize(text);
		const tf = new Map<string, number>();
		for (const token of tokens) {
			tf.set(token, (tf.get(token) ?? 0) + 1);
		}
		this.documents.push({ payload, tf, length: tokens.length });
		for (const term of tf.keys()) {
			this.df.set(term, (this.df.get(term) ?? 0) + 1);
		}
	}

	finalize(): void {
		if (this.documents.length === 0) { this.avgDl = 0; return; }
		const totalLength = this.documents.reduce((sum, doc) => sum + doc.length, 0);
		this.avgDl = totalLength / this.documents.length;
	}

	private idf(term: string): number {
		const N = this.documents.length;
		const df = this.df.get(term) ?? 0;
		return Math.log((N - df + 0.5) / (df + 0.5) + 1);
	}

	private scoreDocument(doc: BM25Document<T>, queryTerms: string[]): number {
		let score = 0;
		for (const term of queryTerms) {
			const tf = doc.tf.get(term) ?? 0;
			if (tf === 0) continue;
			const idf = this.idf(term);
			const numerator = tf * (BM25_K1 + 1);
			const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / this.avgDl));
			score += idf * (numerator / denominator);
		}
		return score;
	}

	query(queryText: string): { payload: T; score: number }[] {
		const queryTerms = tokenize(queryText);
		if (queryTerms.length === 0) return [];
		const results: { payload: T; score: number }[] = [];
		for (const doc of this.documents) {
			const score = this.scoreDocument(doc, queryTerms);
			if (score > 0) results.push({ payload: doc.payload, score });
		}
		results.sort((a, b) => b.score - a.score);
		return results;
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Result row from FTS5 session search. */
interface FtsSessionResult {
	session_id: string;
	turn_number: number;
	content: string;
	rank: number;
	// Joined from sessions table:
	title: string;
	project: string;
	created_at: number;
	updated_at: number;
	agent: string;
	model: string;
	cost: number;
	tokens: number;
	tags: string;
	parent_id: string | null;
	branch: string | null;
}

/**
 * Search sessions using FTS5 full-text search with BM25 ranking.
 *
 * Uses SQLite FTS5 `MATCH` with built-in BM25 ranking. Results are
 * deduplicated by session and boosted by recency.
 *
 * Falls back to in-memory BM25 if SQLite is unavailable.
 *
 * @param query - The search query string.
 * @param project - Optional project path to filter sessions.
 * @returns An array of {@link SessionMeta} sorted by relevance.
 */
export function searchSessions(query: string, project?: string): SessionMeta[] {
	if (!query || query.trim().length === 0) return [];

	// Try FTS5 search first
	try {
		return searchSessionsFts5(query, project);
	} catch {
		// Fall back to in-memory BM25
		return searchSessionsBm25(query, project);
	}
}

/**
 * FTS5-powered session search.
 *
 * Query flow:
 *   1. FTS5 MATCH on turns_fts with BM25 ranking
 *   2. JOIN with sessions table to get metadata
 *   3. Deduplicate by session_id (take best-scoring turn per session)
 *   4. Apply recency boost
 *   5. Return sorted by final score
 */
function searchSessionsFts5(query: string, project?: string): SessionMeta[] {
	const ftsQuery = sanitizeFts5Query(query);
	if (!ftsQuery) return [];

	const db = getAgentDb();

	const sql = project
		? `SELECT t.session_id, t.turn_number, t.content, f.rank,
				s.title, s.project, s.created_at, s.updated_at,
				s.agent, s.model, s.cost, s.tokens, s.tags, s.parent_id, s.branch
			FROM turns_fts f
			JOIN turns t ON t.id = f.rowid
			JOIN sessions s ON s.id = t.session_id
			WHERE turns_fts MATCH ? AND s.project = ?
			ORDER BY f.rank
			LIMIT 200`
		: `SELECT t.session_id, t.turn_number, t.content, f.rank,
				s.title, s.project, s.created_at, s.updated_at,
				s.agent, s.model, s.cost, s.tokens, s.tags, s.parent_id, s.branch
			FROM turns_fts f
			JOIN turns t ON t.id = f.rowid
			JOIN sessions s ON s.id = t.session_id
			WHERE turns_fts MATCH ?
			ORDER BY f.rank
			LIMIT 200`;

	const rows = (project
		? db.prepare(sql).all(ftsQuery, project)
		: db.prepare(sql).all(ftsQuery)
	) as FtsSessionResult[];

	// Deduplicate by session: keep the best-scoring turn per session
	const sessionBest = new Map<string, { row: FtsSessionResult; score: number }>();

	for (const row of rows) {
		// FTS5 rank is negative (lower = better match), so negate for scoring
		const bm25Score = -row.rank;
		const boost = recencyBoost(row.updated_at);
		const finalScore = bm25Score * boost;

		const existing = sessionBest.get(row.session_id);
		if (!existing || finalScore > existing.score) {
			sessionBest.set(row.session_id, { row, score: finalScore });
		}
	}

	// Sort by final score descending
	const sorted = [...sessionBest.values()].sort((a, b) => b.score - a.score);

	// Convert to SessionMeta
	return sorted.map(({ row }) => ({
		id: row.session_id,
		title: row.title,
		created: new Date(row.created_at).toISOString(),
		updated: new Date(row.updated_at).toISOString(),
		agent: row.agent ?? "chitragupta",
		model: row.model ?? "unknown",
		project: row.project,
		parent: row.parent_id ?? null,
		branch: row.branch ?? null,
		tags: JSON.parse(row.tags ?? "[]"),
		totalCost: row.cost ?? 0,
		totalTokens: row.tokens ?? 0,
	}));
}

/**
 * Fallback: in-memory BM25 search (used when SQLite is unavailable).
 * This is the original v1 implementation — loads all sessions from disk.
 */
function searchSessionsBm25(query: string, project?: string): SessionMeta[] {
	const allMetas = listSessions(project);
	const corpus = new BM25Corpus<SessionMeta>();

	for (const meta of allMetas) {
		const parts: string[] = [];
		parts.push(meta.title, meta.title, meta.title);
		const tagsText = meta.tags.join(" ");
		parts.push(tagsText, tagsText);
		parts.push(meta.agent);

		try {
			const session = loadSession(meta.id, meta.project);
			for (const turn of session.turns) {
				parts.push(turn.content);
				if (turn.toolCalls) {
					for (const tc of turn.toolCalls) {
						parts.push(tc.name, tc.input, tc.result);
					}
				}
			}
		} catch {
			// Index based on meta only
		}

		corpus.addDocument(meta, parts.join(" "));
	}

	corpus.finalize();
	const results = corpus.query(query);

	const boosted = results.map((r) => ({
		meta: r.payload,
		score: r.score * recencyBoostIso(r.payload.updated),
	}));

	boosted.sort((a, b) => b.score - a.score);
	return boosted.map((s) => s.meta);
}

/**
 * Search all memory files across all scopes, returning results sorted by relevance.
 *
 * Uses in-memory BM25 (memory files are a small corpus, no SQLite index needed).
 */
export function searchMemory(query: string): MemoryResult[] {
	if (!query || query.trim().length === 0) return [];

	const scopes = listMemoryScopes();

	interface ScopeEntry {
		scope: MemoryScope;
		content: string;
	}

	const corpus = new BM25Corpus<ScopeEntry>();

	for (const scope of scopes) {
		try {
			const content = getMemory(scope);
			if (!content) continue;
			corpus.addDocument({ scope, content }, content);
		} catch {
			// Skip unreadable scopes
		}
	}

	corpus.finalize();
	const results = corpus.query(query);

	if (results.length === 0) return [];

	const maxScore = results[0].score;

	return results.map((r) => ({
		scope: r.payload.scope,
		content: r.payload.content,
		relevance: maxScore > 0 ? r.score / maxScore : 0,
	}));
}
