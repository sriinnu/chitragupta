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
 *
 * SQLite helpers live in session-db.ts.
 * Query functions live in session-queries.ts.
 * Both are re-exported here so the module path stays stable.
 */

import fs from "fs";
import { renameSync as nodeRenameSync } from "node:fs";
import path from "path";
import { SessionError } from "@chitragupta/core";
import type { Session, SessionMeta, SessionOpts, SessionTurn } from "./types.js";
import { parseSessionMarkdown } from "./markdown-parser.js";
import { writeSessionMarkdown, writeTurnMarkdown } from "./markdown-writer.js";
import {
	hashProject,
	getSessionsRoot,
	getProjectSessionDir,
	getAgentDb,
	sessionMetaToRow,
	upsertSessionToDb,
	insertTurnToDb,
	getMaxTurnNumber as _getMaxTurnNumber,
} from "./session-db.js";

// ─── Re-exports (DB helpers) ────────────────────────────────────────────────
export {
	getAgentDb,
	rowToSessionMeta,
	getSessionsRoot,
	getProjectSessionDir,
	_resetDbInit,
	_getDbStatus,
	getMaxTurnNumber,
} from "./session-db.js";

// ─── Re-exports (Query functions) ───────────────────────────────────────────
export {
	listSessions,
	listSessionsByDate,
	listSessionsByDateRange,
	listSessionDates,
	listSessionProjects,
	listTurnsWithTimestamps,
	findSessionByMetadata,
	updateSessionMeta,
	listSessionsFromFilesystem,
} from "./session-queries.js";

// ─── Atomic Rename ──────────────────────────────────────────────────────────

/**
 * Atomic rename: uses node:fs (bypasses test mocks on bare "fs").
 * Falls back to direct write if renameSync fails.
 */
function atomicRename(tmpPath: string, targetPath: string): void {
	try {
		nodeRenameSync(tmpPath, targetPath);
	} catch {
		fs.writeFileSync(targetPath, fs.readFileSync(tmpPath, "utf-8"), "utf-8");
		try { fs.unlinkSync(tmpPath); } catch { /* ignore orphan tmp */ }
	}
}

// ─── L1 Session Cache (LRU) ─────────────────────────────────────────────────

const SESSION_CACHE_MAX = 500;
const SESSION_CACHE_MAX_BYTES = 25 * 1024 * 1024;

const sessionCache = new Map<string, Session>();
const sessionCacheSizes = new Map<string, number>();
let sessionCacheBytes = 0;

function estimateSessionBytes(session: Session): number {
	let bytes = 200;
	for (const turn of session.turns) {
		bytes += Buffer.byteLength(turn.content, "utf-8") + 50;
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
	const size = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCache.set(key, entry);
	sessionCacheSizes.set(key, size);
	return entry;
}

function cachePut(id: string, project: string, session: Session): void {
	const key = cacheKey(id, project);
	const existingSize = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCacheBytes -= existingSize;
	const newSize = estimateSessionBytes(session);
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

// ─── Path Helpers ───────────────────────────────────────────────────────────

/**
 * Generate a date-based session ID: session-YYYY-MM-DD-<projhash>[-N]
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

	const basePath = path.join(yearMonthDir, `${baseId}.md`);
	if (!fs.existsSync(basePath)) {
		return {
			id: baseId,
			filePath: path.join("sessions", hashProject(project), yyyy, mm, `${baseId}.md`),
		};
	}

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

/** Resolve the full filesystem path for a session file. */
function resolveSessionPath(id: string, project: string): string {
	const projectDir = getProjectSessionDir(project);
	const dateMatch = id.match(/^session-(\d{4})-(\d{2})-\d{2}/);
	if (dateMatch) {
		const newPath = path.join(projectDir, dateMatch[1], dateMatch[2], `${id}.md`);
		if (fs.existsSync(newPath)) return newPath;
	}
	const oldPath = path.join(projectDir, `${id}.md`);
	if (fs.existsSync(oldPath)) return oldPath;
	if (dateMatch) {
		return path.join(projectDir, dateMatch[1], dateMatch[2], `${id}.md`);
	}
	return oldPath;
}

/** Patch only the `updated:` field in YAML frontmatter. */
function patchFrontmatterUpdated(content: string, updatedIso: string): string {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) return content;
	const frontmatter = fmMatch[1];
	if (!/^updated:\s/m.test(frontmatter)) return content;
	const patchedFrontmatter = frontmatter.replace(/^updated:\s.*$/m, `updated: ${updatedIso}`);
	if (patchedFrontmatter === frontmatter) return content;
	return `---\n${patchedFrontmatter}\n---${content.slice(fmMatch[0].length)}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a new session with date-based naming: session-YYYY-MM-DD.md
 *
 * @param opts - Session creation options.
 * @returns The newly created {@link Session}.
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
	saveSession(session);
	upsertSessionToDb(meta, filePath);
	return session;
}

/**
 * Save a session to disk as a Markdown file.
 *
 * @param session - The session to persist.
 */
export function saveSession(session: Session): void {
	const filePath = resolveSessionPath(session.meta.id, session.meta.project);
	const dir = path.dirname(filePath);
	try {
		fs.mkdirSync(dir, { recursive: true });
		session.meta.updated = new Date().toISOString();
		const markdown = writeSessionMarkdown(session);
		const tmpPath = `${filePath}.tmp.${process.pid}`;
		fs.writeFileSync(tmpPath, markdown, "utf-8");
		atomicRename(tmpPath, filePath);
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
 * @param id - The session ID to load.
 * @param project - The project path the session belongs to.
 * @returns The loaded {@link Session}.
 * @throws {SessionError} If the session file does not exist or cannot be parsed.
 */
export function loadSession(id: string, project: string): Session {
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
		throw new SessionError(`Failed to load session ${id}: ${(err as Error).message}`);
	}
}

/**
 * Delete a session file and remove from SQLite.
 *
 * @param id - The session ID to delete.
 * @param project - The project path the session belongs to.
 * @throws {SessionError} If the session file does not exist.
 */
export function deleteSession(id: string, project: string): void {
	const filePath = resolveSessionPath(id, project);
	if (!fs.existsSync(filePath)) {
		throw new SessionError(`Session not found: ${id} (project: ${project})`);
	}
	fs.unlinkSync(filePath);
	cacheInvalidate(id, project);
	let dir = path.dirname(filePath);
	const sessionsRoot = getSessionsRoot();
	while (dir !== sessionsRoot && dir.length > sessionsRoot.length) {
		try {
			const remaining = fs.readdirSync(dir);
			if (remaining.length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
			else { break; }
		} catch { break; }
	}
	try {
		const db = getAgentDb();
		const turns = db.prepare("SELECT id FROM turns WHERE session_id = ?").all(id) as Array<{ id: number }>;
		for (const t of turns) { db.prepare("DELETE FROM turns_fts WHERE rowid = ?").run(t.id); }
		db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
		db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
	} catch { /* Best-effort cleanup */ }
}

/** Per-session write queue to prevent concurrent write races. */
const sessionWriteQueues = new Map<string, Promise<void>>();

/**
 * Append a turn to an existing session (hot path).
 *
 * @param sessionId - The session to append the turn to.
 * @param project - The project path the session belongs to.
 * @param turn - The turn data to append.
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
		if (!turn.turnNumber) {
			try {
				const session = parseSessionMarkdown(fileContent);
				turn.turnNumber = session.turns.length + 1;
			} catch { turn.turnNumber = _getMaxTurnNumber(sessionId) + 1; }
		}
		const updatedIso = new Date().toISOString();
		const patchedContent = patchFrontmatterUpdated(fileContent, updatedIso);
		if (patchedContent !== fileContent) { fs.writeFileSync(filePath, patchedContent, "utf-8"); }
		const turnMd = writeTurnMarkdown(turn);
		fs.appendFileSync(filePath, `\n${turnMd}\n`, "utf-8");
		cacheInvalidate(sessionId, project);
		insertTurnToDb(sessionId, turn);
	}).catch((err) => { throw err; }).finally(() => {
		if (sessionWriteQueues.get(key) === next) { sessionWriteQueues.delete(key); }
	});
	sessionWriteQueues.set(key, next);
	return next;
}

// ─── Migration ──────────────────────────────────────────────────────────────

/**
 * Migrate existing sessions into SQLite index.
 *
 * @param project - Optional project path to migrate. Migrates all if omitted.
 * @returns Counts of migrated and skipped sessions.
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
	const insertFts = db.prepare("INSERT INTO turns_fts (rowid, content) VALUES (?, ?)");
	const migrateFile = (mdPath: string, relativePath: string) => {
		try {
			const content = fs.readFileSync(mdPath, "utf-8");
			const session = parseSessionMarkdown(content);
			if (db.prepare("SELECT id FROM sessions WHERE id = ?").get(session.meta.id)) { skipped++; return; }
			const row = sessionMetaToRow(session.meta, relativePath);
			row.turn_count = session.turns.length;
			insertSession.run(row);
			for (const turn of session.turns) {
				const result = insertTurn.run(
					session.meta.id, turn.turnNumber, turn.role, turn.content,
					turn.agent ?? null, turn.model ?? null,
					turn.toolCalls ? JSON.stringify(turn.toolCalls) : null,
					new Date(session.meta.created).getTime(),
				);
				if (result.changes > 0) { insertFts.run(result.lastInsertRowid, turn.content); }
			}
			migrated++;
		} catch { skipped++; }
	};
	const runMigration = db.transaction(() => {
		for (const dir of dirs) {
			if (!fs.existsSync(dir)) continue;
			walkMdFiles(dir, sessionsRoot, migrateFile);
		}
	});
	runMigration();
	return { migrated, skipped };
}

/** Walk directory recursively, calling callback for each .md file. */
function walkMdFiles(
	dir: string, sessionsRoot: string,
	callback: (fullPath: string, relativePath: string) => void,
): void {
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) { walkMdFiles(fullPath, sessionsRoot, callback); }
			else if (entry.name.endsWith(".md")) {
				callback(fullPath, path.relative(path.dirname(sessionsRoot), fullPath));
			}
		}
	} catch { /* Skip inaccessible directories */ }
}
