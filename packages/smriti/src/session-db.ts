/**
 * @chitragupta/smriti — Session SQLite helpers.
 *
 * Low-level database access layer for the session store:
 *   - getAgentDb() — lazy initialization of the agent SQLite database
 *   - Row conversion helpers (sessionMetaToRow, rowToSessionMeta)
 *   - Write-through helpers (upsertSessionToDb, insertTurnToDb)
 *   - Pure query helpers (getMaxTurnNumber)
 *   - Path helpers (getSessionsRoot, getProjectSessionDir, hashProject)
 *   - Test helpers (_resetDbInit, _getDbStatus)
 *
 * Shared by session-store.ts (mutations) and session-queries.ts (queries).
 * Has no dependencies on either — avoids circular imports.
 */

import path from "path";
import crypto from "crypto";
import type BetterSqlite3 from "better-sqlite3";
import { getChitraguptaHome } from "@chitragupta/core";
import type { SessionMeta, SessionTurn } from "./types.js";
import { DatabaseManager } from "./db/database.js";
import { initAgentSchema } from "./db/schema.js";

// ─── Path Helpers ───────────────────────────────────────────────────────────

/**
 * Hash a project path to a short directory name.
 *
 * @param project - The project path to hash.
 * @returns 12-char hex hash of the project path.
 */
export function hashProject(project: string): string {
	return crypto.createHash("sha256").update(project).digest("hex").slice(0, 12);
}

/**
 * Get the root directory for all session files.
 *
 * @returns Absolute path to ~/.chitragupta/sessions
 */
export function getSessionsRoot(): string {
	return path.join(getChitraguptaHome(), "sessions");
}

/**
 * Get the project-specific session directory.
 *
 * @param project - The project path to hash.
 * @returns Absolute path to ~/.chitragupta/sessions/<project-hash>
 */
export function getProjectSessionDir(project: string): string {
	return path.join(getSessionsRoot(), hashProject(project));
}

// ─── SQLite Initialization ──────────────────────────────────────────────────

let _dbInitialized = false;
let _dbInitError: Error | null = null;

/**
 * Get or initialize the agent database. Lazy — creates on first call.
 * Used by session-store.ts, session-queries.ts, and search.ts.
 *
 * @returns The `agent` SQLite database instance.
 * @throws If schema initialization fails.
 */
export function getAgentDb(): BetterSqlite3.Database {
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

// ─── Row Conversion ─────────────────────────────────────────────────────────

/**
 * Convert a SessionMeta + file path into a SQLite row object.
 *
 * @param meta - The session metadata to convert.
 * @param filePath - The relative file path for storage.
 * @returns An object suitable for SQLite INSERT/UPDATE.
 */
export function sessionMetaToRow(meta: SessionMeta, filePath: string) {
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

/**
 * Convert a SQLite row to a SessionMeta object.
 *
 * @param row - A raw database row from the sessions table.
 * @returns A typed {@link SessionMeta} object.
 */
export function rowToSessionMeta(row: Record<string, unknown>): SessionMeta {
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

// ─── Write-Through Helpers ──────────────────────────────────────────────────

/**
 * Upsert session metadata into the SQLite sessions table.
 * Best-effort: swallows errors since .md files are the source of truth.
 *
 * @param meta - The session metadata to upsert.
 * @param filePath - The relative file path for storage.
 */
export function upsertSessionToDb(meta: SessionMeta, filePath: string): void {
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

/**
 * Insert a turn into the SQLite turns table + FTS5 index.
 * Also bumps the session turn_count and updated_at.
 * Best-effort: swallows errors since .md files are the source of truth.
 *
 * @param sessionId - The session this turn belongs to.
 * @param turn - The turn data to insert.
 */
export function insertTurnToDb(sessionId: string, turn: SessionTurn): void {
	try {
		const db = getAgentDb();
		const now = Date.now();

		// Wrap turn insert + FTS5 index + session update in a transaction
		const doInsert = db.transaction(() => {
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
		});
		doInsert();
	} catch (err) {
		// Best-effort write-through
		process.stderr.write(`[chitragupta] turn insert failed for session ${sessionId}: ${err instanceof Error ? err.message : err}\n`);
	}
}

// ─── Pure Query Helpers ─────────────────────────────────────────────────────

/**
 * Get the maximum turn number for a session from SQLite.
 * Returns 0 if no turns exist or SQLite is unavailable.
 *
 * @param sessionId - The session ID to query.
 * @returns The highest turn number, or 0 if none found.
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
