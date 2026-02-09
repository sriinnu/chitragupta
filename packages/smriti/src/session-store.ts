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
import path from "path";
import crypto from "crypto";
import { getChitraguptaHome, SessionError } from "@chitragupta/core";
import type { Session, SessionMeta, SessionOpts, SessionTurn } from "./types.js";
import { parseSessionMarkdown } from "./markdown-parser.js";
import { writeSessionMarkdown, writeTurnMarkdown } from "./markdown-writer.js";
import { DatabaseManager } from "./db/database.js";
import { initAgentSchema } from "./db/schema.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashProject(project: string): string {
	return crypto.createHash("sha256").update(project).digest("hex").slice(0, 12);
}

/**
 * Generate a date-based session ID: session-YYYY-MM-DD-<projhash>[-N]
 *
 * Includes a short project hash (4 chars) to ensure global uniqueness
 * across projects in the shared SQLite table.
 * Handles multiple sessions per day by appending a counter.
 */
function generateSessionId(project: string): { id: string; filePath: string } {
	const now = new Date();
	const yyyy = now.getFullYear().toString();
	const mm = (now.getMonth() + 1).toString().padStart(2, "0");
	const dd = now.getDate().toString().padStart(2, "0");
	const dateStr = `${yyyy}-${mm}-${dd}`;
	const projHash = hashProject(project).slice(0, 4);
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

// ─── SQLite helpers ─────────────────────────────────────────────────────────

/**
 * Get or initialize the agent database. Lazy — creates on first call.
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
export function _resetDbInit(): void {
	_dbInitialized = false;
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
	};
}

function rowToSessionMeta(row: Record<string, unknown>): SessionMeta {
	return {
		id: row.id as string,
		title: row.title as string,
		created: new Date(row.created_at as number).toISOString(),
		updated: new Date(row.updated_at as number).toISOString(),
		agent: (row.agent as string) ?? "chitragupta",
		model: (row.model as string) ?? "unknown",
		project: row.project as string,
		parent: (row.parent_id as string) ?? null,
		branch: (row.branch as string) ?? null,
		tags: JSON.parse((row.tags as string) ?? "[]"),
		totalCost: (row.cost as number) ?? 0,
		totalTokens: (row.tokens as number) ?? 0,
	};
}

function upsertSessionToDb(meta: SessionMeta, filePath: string): void {
	try {
		const db = getAgentDb();
		const row = sessionMetaToRow(meta, filePath);
		db.prepare(`
			INSERT INTO sessions (id, project, title, created_at, updated_at, turn_count, model, agent, cost, tokens, tags, file_path, parent_id, branch)
			VALUES (@id, @project, @title, @created_at, @updated_at, @turn_count, @model, @agent, @cost, @tokens, @tags, @file_path, @parent_id, @branch)
			ON CONFLICT(id) DO UPDATE SET
				title = @title, updated_at = @updated_at, turn_count = @turn_count,
				model = @model, cost = @cost, tokens = @tokens, tags = @tags
		`).run(row);
	} catch {
		// SQLite write-through is best-effort — .md file is the source of truth
	}
}

function insertTurnToDb(sessionId: string, turn: SessionTurn): void {
	try {
		const db = getAgentDb();
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
			db.prepare("INSERT INTO turns_fts (rowid, content) VALUES (?, ?)").run(
				result.lastInsertRowid,
				turn.content,
			);
		}

		// Update session turn count + timestamp
		db.prepare(
			"UPDATE sessions SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?",
		).run(now, sessionId);
	} catch {
		// Best-effort write-through
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
		project: opts.project,
		parent: opts.parentSessionId ?? null,
		branch: opts.branch ?? null,
		tags: opts.tags ?? [],
		totalCost: 0,
		totalTokens: 0,
	};

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
		fs.writeFileSync(filePath, markdown, "utf-8");
	} catch (err) {
		throw new SessionError(
			`Failed to save session ${session.meta.id} at ${filePath}: ${(err as Error).message}`,
		);
	}
}

/**
 * Load a session from disk by ID and project.
 */
export function loadSession(id: string, project: string): Session {
	const filePath = resolveSessionPath(id, project);

	if (!fs.existsSync(filePath)) {
		throw new SessionError(`Session not found: ${id} (project: ${project})`);
	}

	try {
		const content = fs.readFileSync(filePath, "utf-8");
		return parseSessionMarkdown(content);
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
	} catch {
		// SQLite unavailable — fall through to filesystem scan
	}

	// Fallback: filesystem scan (for pre-migration or if SQLite fails)
	return listSessionsFromFilesystem(project);
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

		// Read current turn count from file to assign turn number
		if (!turn.turnNumber) {
			const content = fs.readFileSync(filePath, "utf-8");
			const session = parseSessionMarkdown(content);
			turn.turnNumber = session.turns.length + 1;
		}

		// Append turn to .md file (no full rewrite!)
		const turnMd = writeTurnMarkdown(turn);
		fs.appendFileSync(filePath, `\n${turnMd}\n`, "utf-8");

		// Write-through to SQLite
		insertTurnToDb(sessionId, turn);
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
		INSERT OR IGNORE INTO sessions (id, project, title, created_at, updated_at, turn_count, model, agent, cost, tokens, tags, file_path, parent_id, branch)
		VALUES (@id, @project, @title, @created_at, @updated_at, @turn_count, @model, @agent, @cost, @tokens, @tags, @file_path, @parent_id, @branch)
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
