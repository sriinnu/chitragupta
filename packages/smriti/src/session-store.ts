/**
 * @chitragupta/smriti — Session store (v2).
 *
 * Session files: ~/.chitragupta/projects/<hash>/sessions/YYYY/MM/session-YYYY-MM-DD.md
 * SQLite index:  ~/.chitragupta/agent.db (sessions + turns + turns_fts tables)
 *
 * Design:
 *   - .md files are the human-readable source of truth (append-only after creation)
 *   - SQLite is the index for fast queries (write-through on every mutation)
 *   - addTurn() appends to the .md file without rewriting it
 *   - listSessions() queries SQLite instead of scanning the filesystem
 *   - loadSession() reads from .md file (parse on demand)
 *
 * Migration: on first access, existing sessions are indexed into SQLite.
 */

import fs from "fs";
import { renameSync as nodeRenameSync } from "node:fs";
import path from "path";
import crypto from "crypto";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";
import type { Session, SessionMeta, SessionOpts, SessionTurn } from "./types.js";
import { parseSessionMarkdown } from "./markdown-parser.js";
import { writeSessionMarkdown, writeTurnMarkdown } from "./markdown-writer.js";
import { DatabaseManager } from "./db/database.js";
import { initAgentSchema } from "./db/schema.js";

/**
 * Atomic rename: uses node:fs (bypasses test mocks on bare "fs").
 * Falls back to direct write if renameSync fails.
 */
function atomicRename(tmpPath: string, targetPath: string): void {
	try {
		nodeRenameSync(tmpPath, targetPath);
	} catch {
		// Fallback: direct write (non-atomic but still correct)
		fs.writeFileSync(targetPath, fs.readFileSync(tmpPath, "utf-8"), "utf-8");
		try { fs.unlinkSync(tmpPath); } catch { /* ignore orphan tmp */ }
	}
}

// ─── L1 Session Cache (LRU) ─────────────────────────────────────────────────

/** Max sessions to cache in-process (hard cap). */
const SESSION_CACHE_MAX = 500;
/** Byte budget for the L1 cache (~25 MB). */
const SESSION_CACHE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Simple LRU cache backed by Map insertion order.
 * On access, delete + re-insert to move entry to tail (most recent).
 * Tracks rough byte usage and evicts when exceeding either count or byte budget.
 */
const sessionCache = new Map<string, Session>();
const sessionCacheSizes = new Map<string, number>();
let sessionCacheBytes = 0;

/** Rough byte estimate for a session (metadata overhead + turn content). */
function estimateSessionBytes(session: Session): number {
	let bytes = 200; // metadata overhead estimate
	for (const turn of session.turns) {
		bytes += Buffer.byteLength(turn.content, "utf-8") + 50; // per-turn overhead
	}
	return bytes;
}

function cacheKey(id: string, project: string): string {
	return `${id}:${project}`;
}

function cacheGet(id: string, project: string): Session | undefined {
	const key = cacheKey(id, project);
	const entry = sessionCache.get(key);
	if (!entry) return undefined;
	// Move to tail (most recent) — preserve size tracking
	const size = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCache.set(key, entry);
	sessionCacheSizes.set(key, size);
	return entry;
}

function cachePut(id: string, project: string, session: Session): void {
	const key = cacheKey(id, project);
	// Remove existing entry first (refresh position + update byte tracking)
	const existingSize = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCacheBytes -= existingSize;

	const newSize = estimateSessionBytes(session);

	// Evict oldest entries while over count or byte budget
	while (
		(sessionCache.size >= SESSION_CACHE_MAX || sessionCacheBytes + newSize > SESSION_CACHE_MAX_BYTES)
		&& sessionCache.size > 0
	) {
		const oldest = sessionCache.keys().next().value;
		if (oldest === undefined) break;
		const evictedSize = sessionCacheSizes.get(oldest) ?? 0;
		sessionCache.delete(oldest);
		sessionCacheSizes.delete(oldest);
		sessionCacheBytes -= evictedSize;
	}

	sessionCache.set(key, session);
	sessionCacheSizes.set(key, newSize);
	sessionCacheBytes += newSize;
}

function cacheInvalidate(id: string, project: string): void {
	const key = cacheKey(id, project);
	const size = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCacheBytes -= size;
}

/** Reset L1 session cache (for testing). */
export function _resetSessionCache(): void {
	sessionCache.clear();
	sessionCacheSizes.clear();
	sessionCacheBytes = 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashProject(project: string): string {
	return crypto.createHash("sha256").update(project).digest("hex").slice(0, 12);
}

/**
 * Generate a date-based session ID: session-YYYY-MM-DD-<projhash>[-N]
 *
 * Includes a project hash (8 chars) to ensure global uniqueness
 * across projects in the shared SQLite table.
 * Handles multiple sessions per day by appending a counter.
 */
function generateSessionId(project: string): { id: string; filePath: string } {
	const now = new Date();
	const yyyy = now.getFullYear().toString();
	const mm = (now.getMonth() + 1).toString().padStart(2, "0");
	const dd = now.getDate().toString().padStart(2, "0");
	const dateStr = `${yyyy}-${mm}-${dd}`;
	const projHash = hashProject(project).slice(0, 8);
	const baseId = `session-${dateStr}-${projHash}`;

	const projectDir = getProjectSessionDir(project);
	const yearMonthDir = path.join(projectDir, yyyy, mm);
	fs.mkdirSync(yearMonthDir, { recursive: true });

	// Check for existing sessions today
	const basePath = path.join(yearMonthDir, `${baseId}.md`);
	if (!fs.existsSync(basePath)) {
		return {
			id: baseId,
			filePath: path.join("sessions", hashProject(project), yyyy, mm, `${baseId}.md`),
		};
	}

	// Find next available counter
	let counter = 2;
	while (fs.existsSync(path.join(yearMonthDir, `${baseId}-${counter}.md`))) {
		counter++;
	}

	const id = `${baseId}-${counter}`;
	return {
		id,
		filePath: path.join("sessions", hashProject(project), yyyy, mm, `${id}.md`),
	};
}

function getSessionsRoot(): string {
	return path.join(getChitraguptaHome(), "sessions");
}

function getProjectSessionDir(project: string): string {
	return path.join(getSessionsRoot(), hashProject(project));
}

/**
 * Resolve the full filesystem path for a session file.
 * Supports both old-style (flat) and new-style (YYYY/MM/) layouts.
 */
function resolveSessionPath(id: string, project: string): string {
	const projectDir = getProjectSessionDir(project);

	// New-style: YYYY/MM/session-YYYY-MM-DD-<hash>[-N].md
	const dateMatch = id.match(/^session-(\d{4})-(\d{2})-\d{2}/);
	if (dateMatch) {
		const newPath = path.join(projectDir, dateMatch[1], dateMatch[2], `${id}.md`);
		if (fs.existsSync(newPath)) return newPath;
	}

	// Old-style: flat directory
	const oldPath = path.join(projectDir, `${id}.md`);
	if (fs.existsSync(oldPath)) return oldPath;

	// For new sessions, prefer new-style path
	if (dateMatch) {
		return path.join(projectDir, dateMatch[1], dateMatch[2], `${id}.md`);
	}

	return oldPath;
}

/**
 * Update only the `updated:` field in YAML frontmatter.
 *
 * Keeps addTurn append-only for turns while ensuring filesystem fallback ordering
 * remains correct when SQLite write-through is unavailable.
 */
function patchFrontmatterUpdated(content: string, updatedIso: string): string {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return content;

	const frontmatter = fmMatch[1];
	if (!/^updated:\s/m.test(frontmatter)) return content;

	const patchedFrontmatter = frontmatter.replace(
		/^updated:\s.*$/m,
		`updated: ${updatedIso}`,
	);
	if (patchedFrontmatter === frontmatter) return content;

	return `---\n${patchedFrontmatter}\n---${content.slice(fmMatch[0].length)}`;
}

// ─── SQLite helpers ─────────────────────────────────────────────────────────

/**
 * Get or initialize the agent database. Lazy — creates on first call.
 */
let _dbInitialized = false;
let _dbInitError: Error | null = null;
function getAgentDb() {
	const dbm = DatabaseManager.instance();
	if (!_dbInitialized) {
		try {
			initAgentSchema(dbm);
			_dbInitialized = true;
			_dbInitError = null;
		} catch (err) {
			_dbInitError = err instanceof Error ? err : new Error(String(err));
			process.stderr.write(`[chitragupta] agent DB schema init failed: ${_dbInitError.message}\n`);
			throw _dbInitError;
		}
	}
	return dbm.get("agent");
}

/** Reset db init flag (for testing). */
export function _resetDbInit(): void {
	_dbInitialized = false;
	_dbInitError = null;
}

/** Get the last DB initialization error (for diagnostics). */
export function _getDbStatus(): { initialized: boolean; error: string | null } {
	return {
		initialized: _dbInitialized,
		error: _dbInitError?.message ?? null,
	};
}

function sessionMetaToRow(meta: SessionMeta, filePath: string) {
	return {
		id: meta.id,
		project: meta.project,
		title: meta.title,
		created_at: new Date(meta.created).getTime(),
		updated_at: new Date(meta.updated).getTime(),
		turn_count: 0,
		model: meta.model,
		agent: meta.agent,
		cost: meta.totalCost,
		tokens: meta.totalTokens,
		tags: JSON.stringify(meta.tags),
		file_path: filePath,
		parent_id: meta.parent,
		branch: meta.branch,
		metadata: meta.metadata ? JSON.stringify(meta.metadata) : null,
	};
}

function rowToSessionMeta(row: Record<string, unknown>): SessionMeta {
	let tags: string[] = [];
	try { tags = JSON.parse((row.tags as string) ?? "[]"); } catch { /* corrupted JSON — use empty */ }

	let metadata: Record<string, unknown> | undefined;
	try { metadata = row.metadata ? JSON.parse(row.metadata as string) : undefined; } catch { /* corrupted */ }

	const provider = metadata?.provider as string | undefined;

	const createdAt = row.created_at as number | string | null;
	const updatedAt = row.updated_at as number | string | null;

	return {
		id: row.id as string,
		title: row.title as string,
		created: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
		updated: updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString(),
		agent: (row.agent as string) ?? "chitragupta",
		model: (row.model as string) ?? "unknown",
		provider,
		project: row.project as string,
		parent: (row.parent_id as string) ?? null,
		branch: (row.branch as string) ?? null,
		tags,
		totalCost: (row.cost as number) ?? 0,
		totalTokens: (row.tokens as number) ?? 0,
		metadata,
	};
}

function upsertSessionToDb(meta: SessionMeta, filePath: string): void {
	try {
		const db = getAgentDb();
		const row = sessionMetaToRow(meta, filePath);
		db.prepare(`
			INSERT INTO sessions (id, project, title, created_at, updated_at, turn_count, model, agent, cost, tokens, tags, file_path, parent_id, branch, metadata)
			VALUES (@id, @project, @title, @created_at, @updated_at, @turn_count, @model, @agent, @cost, @tokens, @tags, @file_path, @parent_id, @branch, @metadata)
			ON CONFLICT(id) DO UPDATE SET
				title = @title, updated_at = @updated_at, turn_count = @turn_count,
				model = @model, cost = @cost, tokens = @tokens, tags = @tags, metadata = @metadata
		`).run(row);
	} catch (err) {
		// SQLite write-through is best-effort — .md file is the source of truth
		process.stderr.write(`[chitragupta] session upsert failed for ${meta.id}: ${err instanceof Error ? err.message : err}\n`);
	}
}

function isRecoverableSessionConstraintError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const lower = err.message.toLowerCase();
	return lower.includes("foreign key constraint failed") || lower.includes("constraint failed");
}

function seedSessionRowForTurn(sessionId: string, project: string, filePath: string): void {
	const db = getAgentDb();
	const now = Date.now();
	const normalizedFilePath = path.isAbsolute(filePath)
		? path.relative(getChitraguptaHome(), filePath)
		: filePath;
	db.prepare(`
		INSERT OR IGNORE INTO sessions (id, project, title, created_at, updated_at, turn_count, file_path)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`).run(
		sessionId,
		project,
		"Recovered Session",
		now,
		now,
		0,
		normalizedFilePath,
	);
}

function insertTurnToDb(
	sessionId: string,
	turn: SessionTurn,
	context?: { project: string; filePath: string },
): void {
	try {
		const db = getAgentDb();

		// Wrap turn insert + FTS5 index + session update in a transaction
		const writeTurn = db.transaction(() => {
			const now = Date.now();
			const result = db.prepare(`
				INSERT OR IGNORE INTO turns (session_id, turn_number, role, content, agent, model, tool_calls, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`).run(
				sessionId,
				turn.turnNumber,
				turn.role,
				turn.content,
				turn.agent ?? null,
				turn.model ?? null,
				turn.toolCalls ? JSON.stringify(turn.toolCalls) : null,
				now,
			);

				// Index into FTS5
				if (result.changes > 0) {
					db.prepare("INSERT OR IGNORE INTO turns_fts (rowid, content) VALUES (?, ?)").run(
						result.lastInsertRowid,
						turn.content,
					);
				}

			// Update session turn count + timestamp
				db.prepare(
					"UPDATE sessions SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?",
				).run(now, sessionId);
		});
		try {
			writeTurn();
			return;
		} catch (err) {
			// Self-heal: if SQLite session row is missing, recreate a minimal row and retry once.
			if (context && isRecoverableSessionConstraintError(err)) {
				seedSessionRowForTurn(sessionId, context.project, context.filePath);
				writeTurn();
				return;
			}
			throw err;
		}
	} catch (err) {
		// Best-effort write-through
		const code = typeof err === "object" && err !== null && "code" in err
			? String((err as { code?: unknown }).code)
			: "unknown";
		process.stderr.write(
			`[chitragupta] turn insert failed for session ${sessionId} (turn=${turn.turnNumber}, role=${turn.role}, code=${code}): ${err instanceof Error ? err.message : err}\n`,
		);
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a new session with date-based naming: session-YYYY-MM-DD.md
 *
 * Directory structure: ~/.chitragupta/sessions/<project-hash>/YYYY/MM/
 * Write-through: also inserts into agent.db sessions table.
 */
export function createSession(opts: SessionOpts): Session {
	const now = new Date().toISOString();
	const { id, filePath } = generateSessionId(opts.project);

	const meta: SessionMeta = {
		id,
		title: opts.title ?? "New Session",
		created: now,
		updated: now,
		agent: opts.agent ?? "chitragupta",
		model: opts.model ?? "unknown",
		provider: opts.provider,
		project: opts.project,
		parent: opts.parentSessionId ?? null,
		branch: opts.branch ?? null,
		tags: opts.tags ?? [],
		totalCost: 0,
		totalTokens: 0,
		metadata: opts.metadata,
	};

	if (opts.provider) {
		meta.metadata = { ...meta.metadata, provider: opts.provider };
	}

	const session: Session = { meta, turns: [] };

	// Write .md file
	saveSession(session);

	// Write-through to SQLite
	upsertSessionToDb(meta, filePath);

	return session;
}

/**
 * Save a session to disk as a Markdown file.
 * Used for initial creation and full rewrites (branching, migration).
 * For normal turn additions, use addTurn() instead.
 */
export function saveSession(session: Session): void {
	const filePath = resolveSessionPath(session.meta.id, session.meta.project);
	const dir = path.dirname(filePath);

	try {
		fs.mkdirSync(dir, { recursive: true });
		session.meta.updated = new Date().toISOString();
		const markdown = writeSessionMarkdown(session);
		// Atomic write: write to temp file then rename (rename is atomic on POSIX).
		// Prevents half-written files if the process crashes mid-write.
		const tmpPath = `${filePath}.tmp.${process.pid}`;
		fs.writeFileSync(tmpPath, markdown, "utf-8");
		atomicRename(tmpPath, filePath);
		// Write-through: update L1 cache
		cachePut(session.meta.id, session.meta.project, session);
	} catch (err) {
		throw new SessionError(
			`Failed to save session ${session.meta.id} at ${filePath}: ${(err as Error).message}`,
		);
	}
}

/**
 * Load a session from disk by ID and project.
 *
 * Uses an L1 in-process LRU cache (up to 500 entries, ~25 MB).
 * Cache hits return in <0.01ms; misses read from .md file and populate cache.
 */
export function loadSession(id: string, project: string): Session {
	// L1 cache check
	const cached = cacheGet(id, project);
	if (cached) return cached;

	const filePath = resolveSessionPath(id, project);

	if (!fs.existsSync(filePath)) {
		throw new SessionError(`Session not found: ${id} (project: ${project})`);
	}

	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const session = parseSessionMarkdown(content);
		cachePut(id, project, session);
		return session;
	} catch (err) {
		if (err instanceof SessionError) throw err;
		throw new SessionError(
			`Failed to load session ${id}: ${(err as Error).message}`,
		);
	}
}

/**
 * List sessions, optionally filtered by project.
 *
 * Queries SQLite for fast indexed lookups. Falls back to filesystem scan
 * if SQLite is empty (pre-migration state).
 */
export function listSessions(project?: string): SessionMeta[] {
	try {
		const db = getAgentDb();
		let rows: Array<Record<string, unknown>>;

		if (project) {
			rows = db.prepare(
				"SELECT * FROM sessions WHERE project = ? ORDER BY updated_at DESC",
			).all(project) as Array<Record<string, unknown>>;
		} else {
			rows = db.prepare(
				"SELECT * FROM sessions ORDER BY updated_at DESC",
			).all() as Array<Record<string, unknown>>;
		}

		if (rows.length > 0) {
			return rows.map(rowToSessionMeta);
		}
	} catch (err) {
		// SQLite unavailable — fall through to filesystem scan
		process.stderr.write(`[chitragupta] listSessions SQLite failed, falling back to filesystem: ${err instanceof Error ? err.message : err}\n`);
	}

	// Fallback: filesystem scan (for pre-migration or if SQLite fails)
	return listSessionsFromFilesystem(project);
}

/**
 * List sessions created on a specific date.
 * Uses SQLite index on created_at for fast lookup.
 *
 * @param date - Date string in YYYY-MM-DD format.
 * @param project - Optional project filter.
 */
export function listSessionsByDate(date: string, project?: string): SessionMeta[] {
	// Parse YYYY-MM-DD to start/end epoch ms
	const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!dateMatch) {
		throw new SessionError(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
	}

	const startOfDay = new Date(`${date}T00:00:00.000Z`).getTime();
	const endOfDay = startOfDay + 86_400_000; // +24h

	return listSessionsByDateRange(startOfDay, endOfDay, project);
}

/**
 * List sessions created within a date range (epoch ms).
 * Uses SQLite index on created_at for fast lookup.
 *
 * @param startMs - Start of range (inclusive), epoch ms.
 * @param endMs - End of range (exclusive), epoch ms.
 * @param project - Optional project filter.
 */
export function listSessionsByDateRange(startMs: number, endMs: number, project?: string): SessionMeta[] {
	try {
		const db = getAgentDb();
		let rows: Array<Record<string, unknown>>;

		if (project) {
			rows = db.prepare(
				"SELECT * FROM sessions WHERE project = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC",
			).all(project, startMs, endMs) as Array<Record<string, unknown>>;
		} else {
			rows = db.prepare(
				"SELECT * FROM sessions WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC",
			).all(startMs, endMs) as Array<Record<string, unknown>>;
		}

		if (rows.length > 0) {
			return rows.map(rowToSessionMeta);
		}
	} catch {
		// SQLite unavailable — fall through to filesystem scan
	}

	// Fallback: scan filesystem and filter by date
	const allSessions = listSessionsFromFilesystem(project);
	return allSessions.filter((s) => {
		const created = new Date(s.created).getTime();
		return created >= startMs && created < endMs;
	});
}

/**
 * List all unique dates that have sessions.
 * Returns dates in YYYY-MM-DD format, most recent first.
 *
 * @param project - Optional project filter.
 */
export function listSessionDates(project?: string): string[] {
	try {
		const db = getAgentDb();
		let rows: Array<Record<string, unknown>>;

		if (project) {
			rows = db.prepare(
				`SELECT DISTINCT date(created_at / 1000, 'unixepoch') as session_date
				 FROM sessions WHERE project = ?
				 ORDER BY session_date DESC`,
			).all(project) as Array<Record<string, unknown>>;
		} else {
			rows = db.prepare(
				`SELECT DISTINCT date(created_at / 1000, 'unixepoch') as session_date
				 FROM sessions
				 ORDER BY session_date DESC`,
			).all() as Array<Record<string, unknown>>;
		}

		return rows.map((r) => r.session_date as string).filter(Boolean);
	} catch {
		// SQLite unavailable — fall through to filesystem scan
		const allSessions = listSessionsFromFilesystem(project);
		const dates = new Set<string>();
		for (const s of allSessions) {
			dates.add(s.created.slice(0, 10));
		}
		return [...dates].sort().reverse();
	}
}

/**
 * List all unique projects that have sessions.
 */
export function listSessionProjects(): Array<{ project: string; sessionCount: number; lastActive: string }> {
	try {
		const db = getAgentDb();
		const rows = db.prepare(
			`SELECT project, COUNT(*) as count, MAX(updated_at) as last_active
			 FROM sessions
			 GROUP BY project
			 ORDER BY last_active DESC`,
		).all() as Array<Record<string, unknown>>;

		return rows.map((r) => ({
			project: r.project as string,
			sessionCount: r.count as number,
			lastActive: new Date(r.last_active as number).toISOString(),
		}));
	} catch {
		return [];
	}
}

/**
 * Legacy filesystem scan fallback.
 */
function listSessionsFromFilesystem(project?: string): SessionMeta[] {
	const sessionsRoot = getSessionsRoot();
	if (!fs.existsSync(sessionsRoot)) return [];

	const results: SessionMeta[] = [];

	if (project) {
		const projectDir = getProjectSessionDir(project);
		if (!fs.existsSync(projectDir)) return [];
		results.push(...scanDirRecursive(projectDir));
	} else {
		const projectDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true });
		for (const entry of projectDirs) {
			if (entry.isDirectory()) {
				results.push(...scanDirRecursive(path.join(sessionsRoot, entry.name)));
			}
		}
	}

	results.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
	return results;
}

/**
 * Recursively scan a directory for .md session files.
 * Handles both flat (old-style) and YYYY/MM/ (new-style) layouts.
 */
function scanDirRecursive(dir: string): SessionMeta[] {
	const metas: SessionMeta[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				metas.push(...scanDirRecursive(fullPath));
			} else if (entry.name.endsWith(".md")) {
				try {
					const content = fs.readFileSync(fullPath, "utf-8");
					const session = parseSessionMarkdown(content);
					metas.push(session.meta);
				} catch {
					// Skip unparseable files
				}
			}
		}
	} catch {
		// Directory may have been removed
	}

	return metas;
}

/**
 * Delete a session file and remove from SQLite.
 */
export function deleteSession(id: string, project: string): void {
	const filePath = resolveSessionPath(id, project);

	if (!fs.existsSync(filePath)) {
		throw new SessionError(`Session not found: ${id} (project: ${project})`);
	}

	fs.unlinkSync(filePath);
	cacheInvalidate(id, project);

	// Clean up empty parent directories
	let dir = path.dirname(filePath);
	const sessionsRoot = getSessionsRoot();
	while (dir !== sessionsRoot && dir.length > sessionsRoot.length) {
		try {
			const remaining = fs.readdirSync(dir);
			if (remaining.length === 0) {
				fs.rmdirSync(dir);
				dir = path.dirname(dir);
			} else {
				break;
			}
		} catch {
			break;
		}
	}

	// Remove from SQLite
	try {
		const db = getAgentDb();
		// Delete turns + FTS entries first (cascade should handle this, but be explicit)
		const turns = db.prepare("SELECT id FROM turns WHERE session_id = ?").all(id) as Array<{ id: number }>;
		for (const t of turns) {
			db.prepare("DELETE FROM turns_fts WHERE rowid = ?").run(t.id);
		}
		db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
		db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
	} catch {
		// Best-effort cleanup
	}
}

/** Per-session write queue to prevent concurrent write races. */
const sessionWriteQueues = new Map<string, Promise<void>>();

/**
 * Append a turn to an existing session.
 *
 * This is the hot path — optimized for speed:
 *   1. Append turn markdown to the .md file (no full rewrite)
 *   2. Write-through turn to SQLite turns table + FTS5 index
 *   3. Update session metadata in SQLite
 *
 * Calls are serialized per-session to prevent write races.
 */
export function addTurn(sessionId: string, project: string, turn: SessionTurn): Promise<void> {
	const key = `${sessionId}:${project}`;
	const prev = sessionWriteQueues.get(key) ?? Promise.resolve();
	const next = prev.then(() => {
		const filePath = resolveSessionPath(sessionId, project);

		if (!fs.existsSync(filePath)) {
			throw new SessionError(`Session not found: ${sessionId} (project: ${project})`);
		}

		const fileContent = fs.readFileSync(filePath, "utf-8");

		// Read current turn count from file to assign turn number.
		// Fall back to SQLite if markdown is corrupted (prevents permanently stuck sessions).
		if (!turn.turnNumber) {
			try {
				const session = parseSessionMarkdown(fileContent);
				turn.turnNumber = session.turns.length + 1;
			} catch {
				turn.turnNumber = getMaxTurnNumber(sessionId) + 1;
			}
		}

		// Keep markdown frontmatter updated for deterministic filesystem fallback ordering.
		const updatedIso = new Date().toISOString();
		const patchedContent = patchFrontmatterUpdated(fileContent, updatedIso);
		if (patchedContent !== fileContent) {
			fs.writeFileSync(filePath, patchedContent, "utf-8");
		}

		// Append turn to .md file (no full rewrite!)
		const turnMd = writeTurnMarkdown(turn);
		fs.appendFileSync(filePath, `\n${turnMd}\n`, "utf-8");

		// Invalidate L1 cache — file content changed
		cacheInvalidate(sessionId, project);

		// Write-through to SQLite (self-heals missing session rows in SQLite).
		insertTurnToDb(sessionId, turn, { project, filePath });
	}).catch((err) => {
		throw err;
	}).finally(() => {
		if (sessionWriteQueues.get(key) === next) {
			sessionWriteQueues.delete(key);
		}
	});
	sessionWriteQueues.set(key, next);
	return next;
}

/**
 * List turns for a session with their SQLite timestamps.
 * Returns turn data + created_at for each turn from the database.
 * Falls back to loadSession() with synthetic timestamps if SQLite is unavailable.
 */
export function listTurnsWithTimestamps(
	sessionId: string,
	project: string,
): Array<SessionTurn & { createdAt: number }> {
	try {
		const db = getAgentDb();
		const rows = db
			.prepare(
				"SELECT turn_number, role, content, agent, model, tool_calls, created_at FROM turns WHERE session_id = ? ORDER BY turn_number ASC",
			)
			.all(sessionId) as Array<Record<string, unknown>>;

		if (rows.length > 0) {
			return rows.map((row) => ({
				turnNumber: row.turn_number as number,
				role: row.role as "user" | "assistant",
				content: row.content as string,
				agent: (row.agent as string) ?? undefined,
				model: (row.model as string) ?? undefined,
				toolCalls: row.tool_calls ? JSON.parse(row.tool_calls as string) : undefined,
				createdAt: row.created_at as number,
			}));
		}
	} catch {
		// SQLite unavailable — fall through
	}

	// Fallback: load from markdown and synthesize timestamps
	try {
		const session = loadSession(sessionId, project);
		const baseTime = new Date(session.meta.created).getTime();
		return session.turns.map((turn, i) => ({
			...turn,
			createdAt: baseTime + i * 1000, // 1-second spacing
		}));
	} catch {
		return [];
	}
}

/**
 * Update session metadata fields in SQLite.
 * Only updates the fields provided — does not touch other columns.
 * Also bumps the updated_at timestamp.
 */
export function updateSessionMeta(
	sessionId: string,
	updates: Partial<Pick<SessionMeta, "title" | "model" | "metadata" | "tags">>,
): void {
	try {
		const db = getAgentDb();
		const sets: string[] = [];
		const params: Record<string, unknown> = { id: sessionId };

		if (updates.title !== undefined) {
			sets.push("title = @title");
			params.title = updates.title;
		}
		if (updates.model !== undefined) {
			sets.push("model = @model");
			params.model = updates.model;
		}
		if (updates.metadata !== undefined) {
			sets.push("metadata = @metadata");
			params.metadata = JSON.stringify(updates.metadata);
		}
		if (updates.tags !== undefined) {
			sets.push("tags = @tags");
			params.tags = JSON.stringify(updates.tags);
		}

		if (sets.length === 0) return;
		sets.push("updated_at = @updated_at");
		params.updated_at = Date.now();

		db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = @id`).run(params);
	} catch {
		// Best-effort
	}
}

/**
 * Get the maximum turn number for a session from SQLite.
 * Returns 0 if no turns exist or SQLite is unavailable.
 */
export function getMaxTurnNumber(sessionId: string): number {
	try {
		const db = getAgentDb();
		const row = db
			.prepare("SELECT MAX(turn_number) as max_turn FROM turns WHERE session_id = ?")
			.get(sessionId) as Record<string, unknown> | undefined;
		return (row?.max_turn as number) ?? 0;
	} catch {
		return 0;
	}
}

/**
 * Find a session by metadata field (e.g. vaayuSessionId).
 * Scans the sessions table metadata JSON column.
 */
export function findSessionByMetadata(
	key: string,
	value: string,
	project?: string,
): SessionMeta | undefined {
	// Validate key to prevent JSON path injection — only allow safe identifiers
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
		return undefined;
	}
	try {
		const db = getAgentDb();
		const sql = project
			? "SELECT * FROM sessions WHERE project = ? AND json_extract(metadata, ?) = ? LIMIT 1"
			: "SELECT * FROM sessions WHERE json_extract(metadata, ?) = ? LIMIT 1";
		const params = project
			? [project, `$.${key}`, value]
			: [`$.${key}`, value];
		const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
		return row ? rowToSessionMeta(row) : undefined;
	} catch {
		return undefined;
	}
}

// ─── Migration ──────────────────────────────────────────────────────────────

/**
 * Migrate existing sessions into SQLite index.
 * Safe to call multiple times — skips already-indexed sessions.
 *
 * Call this on startup or first access to ensure SQLite has all sessions.
 */
export function migrateExistingSessions(project?: string): { migrated: number; skipped: number } {
	const db = getAgentDb();
	const sessionsRoot = getSessionsRoot();
	if (!fs.existsSync(sessionsRoot)) return { migrated: 0, skipped: 0 };

	let migrated = 0;
	let skipped = 0;

	const dirs = project
		? [getProjectSessionDir(project)]
		: fs.readdirSync(sessionsRoot, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => path.join(sessionsRoot, e.name));

	const insertSession = db.prepare(`
		INSERT OR IGNORE INTO sessions (id, project, title, created_at, updated_at, turn_count, model, agent, cost, tokens, tags, file_path, parent_id, branch, metadata)
		VALUES (@id, @project, @title, @created_at, @updated_at, @turn_count, @model, @agent, @cost, @tokens, @tags, @file_path, @parent_id, @branch, @metadata)
	`);

	const insertTurn = db.prepare(`
		INSERT OR IGNORE INTO turns (session_id, turn_number, role, content, agent, model, tool_calls, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const insertFts = db.prepare(
		"INSERT INTO turns_fts (rowid, content) VALUES (?, ?)",
	);

	const migrateFile = (mdPath: string, relativePath: string) => {
		try {
			const content = fs.readFileSync(mdPath, "utf-8");
			const session = parseSessionMarkdown(content);

			// Check if already indexed
			const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(session.meta.id);
			if (existing) {
				skipped++;
				return;
			}

			const row = sessionMetaToRow(session.meta, relativePath);
			row.turn_count = session.turns.length;
			insertSession.run(row);

			for (const turn of session.turns) {
				const result = insertTurn.run(
					session.meta.id,
					turn.turnNumber,
					turn.role,
					turn.content,
					turn.agent ?? null,
					turn.model ?? null,
					turn.toolCalls ? JSON.stringify(turn.toolCalls) : null,
					new Date(session.meta.created).getTime(),
				);
				if (result.changes > 0) {
					insertFts.run(result.lastInsertRowid, turn.content);
				}
			}

			migrated++;
		} catch {
			// Skip unparseable files
			skipped++;
		}
	};

	// Wrap in transaction for speed
	const runMigration = db.transaction(() => {
		for (const dir of dirs) {
			if (!fs.existsSync(dir)) continue;
			walkMdFiles(dir, sessionsRoot, migrateFile);
		}
	});

	runMigration();

	return { migrated, skipped };
}

/**
 * Walk directory recursively, calling callback for each .md file.
 */
function walkMdFiles(
	dir: string,
	sessionsRoot: string,
	callback: (fullPath: string, relativePath: string) => void,
): void {
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walkMdFiles(fullPath, sessionsRoot, callback);
			} else if (entry.name.endsWith(".md")) {
				const relativePath = path.relative(path.dirname(sessionsRoot), fullPath);
				callback(fullPath, relativePath);
			}
		}
	} catch {
		// Skip inaccessible directories
	}
}
