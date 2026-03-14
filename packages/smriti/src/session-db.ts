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
import type { Session, SessionMeta, SessionTurn } from "./types.js";
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
export function sessionMetaToRow(meta: SessionMeta, filePath: string, turnCount = 0) {
	const metadata = meta.metadata ? { ...meta.metadata } : undefined;
	if (meta.provider && metadata?.provider !== meta.provider) {
		if (metadata) metadata.provider = meta.provider;
	}
	const metadataPayload = meta.provider && !metadata
		? { provider: meta.provider }
		: metadata;
	return {
		id: meta.id,
		project: meta.project,
		title: meta.title,
		created_at: new Date(meta.created).getTime(),
		updated_at: new Date(meta.updated).getTime(),
		turn_count: turnCount,
		model: meta.model,
		agent: meta.agent,
		cost: meta.totalCost,
		tokens: meta.totalTokens,
		tags: JSON.stringify(meta.tags),
		file_path: filePath,
		parent_id: meta.parent,
		branch: meta.branch,
		metadata: metadataPayload ? JSON.stringify(metadataPayload) : null,
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

export function getSessionMetaFromDb(sessionId: string): SessionMeta | undefined {
	try {
		const db = getAgentDb();
		const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Record<string, unknown> | undefined;
		return row ? rowToSessionMeta(row) : undefined;
	} catch (err) {
		process.stderr.write(`[chitragupta] session metadata lookup failed for ${sessionId}: ${err instanceof Error ? err.message : err}\n`);
		return undefined;
	}
}

/**
 * Check whether a table exists in the agent database.
 *
 * I use this in read-side fallback paths so callers can degrade quietly when
 * tests or bootstrap phases have not initialized the full session schema yet.
 *
 * @param tableName - SQLite table name to probe.
 * @returns True when the named table exists.
 */
export function hasAgentTable(tableName: string): boolean {
	try {
		const db = getAgentDb();
		const row = db.prepare(
			"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
		).get(tableName) as Record<string, unknown> | undefined;
		return Boolean(row);
	} catch {
		return false;
	}
}

// ─── Write-Through Helpers ──────────────────────────────────────────────────

/**
 * Upsert session metadata into the SQLite sessions table.
 * Best-effort: swallows errors since .md files are the source of truth.
 *
 * @param meta - The session metadata to upsert.
 * @param filePath - The relative file path for storage.
 */
export function upsertSessionToDb(meta: SessionMeta, filePath: string, turnCount = 0): void {
	try {
		const db = getAgentDb();
		const normalizedFilePath = path.isAbsolute(filePath)
			? path.relative(getChitraguptaHome(), filePath)
			: filePath;
		let writeMeta = meta;
		if (!meta.metadata || !meta.provider) {
			const existingMeta = getSessionMetaFromDb(meta.id);
			if (existingMeta) {
				let mergedMetadata = meta.metadata
					? structuredClone(meta.metadata)
					: structuredClone(existingMeta.metadata);
				const provider = meta.provider ?? existingMeta.provider;
				if (provider && mergedMetadata?.provider !== provider) {
					mergedMetadata = { ...(mergedMetadata ?? {}), provider };
				}
				writeMeta = {
					...meta,
					provider,
					metadata: mergedMetadata,
				};
			}
		}
		const row = sessionMetaToRow(writeMeta, normalizedFilePath, turnCount);
		db.prepare(`
				INSERT INTO sessions (id, project, title, created_at, updated_at, turn_count, model, agent, cost, tokens, tags, file_path, parent_id, branch, metadata)
				VALUES (@id, @project, @title, @created_at, @updated_at, @turn_count, @model, @agent, @cost, @tokens, @tags, @file_path, @parent_id, @branch, @metadata)
				ON CONFLICT(id) DO UPDATE SET
				title = @title, updated_at = @updated_at, turn_count = @turn_count,
				model = @model, agent = @agent, cost = @cost, tokens = @tokens, tags = @tags,
				file_path = @file_path, parent_id = @parent_id, branch = @branch, metadata = @metadata
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
/**
 * Check if an error is a recoverable session constraint error.
 * Used for self-healing when a turn references a missing session row.
 *
 * @param err - The error to check.
 * @returns True if the error is a recoverable constraint violation.
 */
function isRecoverableSessionConstraintError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const lower = err.message.toLowerCase();
	return lower.includes("foreign key constraint failed") || lower.includes("constraint failed");
}

/**
 * Seed a minimal session row for turn insertion self-healing.
 * Creates a placeholder session when the session row is missing from SQLite
 * but the .md file exists on disk.
 *
 * @param sessionId - The session ID to create a row for.
 * @param project - The project path.
 * @param filePath - The session file path (absolute or relative).
 */
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

/** Context for self-healing turn inserts. */
export interface TurnInsertContext {
	project: string;
	filePath: string;
}

export type TurnInsertStatus = "inserted" | "duplicate" | "error";

/**
 * Insert a turn into the SQLite turns table + FTS5 index.
 * Also bumps the session turn_count and updated_at.
 * Best-effort: swallows errors since .md files are the source of truth.
 *
 * When context is provided, self-heals missing session rows by creating
 * a minimal placeholder before retrying the turn insert.
 *
 * @param sessionId - The session this turn belongs to.
 * @param turn - The turn data to insert.
 * @param context - Optional project/filePath for self-healing missing sessions.
 */
export function insertTurnToDb(
	sessionId: string,
	turn: SessionTurn,
	context?: TurnInsertContext,
): TurnInsertStatus {
	try {
		const db = getAgentDb();
		const now = Date.now();
		let insertStatus: TurnInsertStatus = "duplicate";

		// Wrap turn insert + FTS5 index + session update in a transaction
		const writeTurn = db.transaction(() => {
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
				insertStatus = "inserted";
				db.prepare("INSERT OR IGNORE INTO turns_fts (rowid, content) VALUES (?, ?)").run(
					result.lastInsertRowid,
					turn.content,
				);
				db.prepare(
					"UPDATE sessions SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?",
				).run(now, sessionId);
			}
		});
		try {
			writeTurn();
			return insertStatus;
		} catch (err) {
			// Self-heal: if SQLite session row is missing, recreate a minimal row and retry once.
			if (context && isRecoverableSessionConstraintError(err)) {
				seedSessionRowForTurn(sessionId, context.project, context.filePath);
				insertStatus = "duplicate";
				writeTurn();
				return insertStatus;
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
		return "error";
	}
}

/**
 * Rebuild SQLite session metadata, turns, and FTS rows from markdown state.
 * Used when write-through drifts from the markdown source of truth.
 */
export function reconcileSessionToDb(session: Session, filePath: string): boolean {
	try {
		const db = getAgentDb();
		const now = Date.now();
		const existingRows = db
			.prepare("SELECT id, turn_number, created_at FROM turns WHERE session_id = ? ORDER BY turn_number ASC")
			.all(session.meta.id) as Array<{ id: number; turn_number: number; created_at: number }>;
		const createdAtByTurn = new Map(existingRows.map((row) => [row.turn_number, row.created_at]));

		db.transaction(() => {
			upsertSessionToDb(session.meta, filePath, session.turns.length);

			for (const row of existingRows) {
				db.prepare("DELETE FROM turns_fts WHERE rowid = ?").run(row.id);
			}
			db.prepare("DELETE FROM turns WHERE session_id = ?").run(session.meta.id);

			for (const turn of session.turns) {
				const result = db.prepare(`
					INSERT INTO turns (session_id, turn_number, role, content, agent, model, tool_calls, created_at)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`).run(
					session.meta.id,
					turn.turnNumber,
					turn.role,
					turn.content,
					turn.agent ?? null,
					turn.model ?? null,
					turn.toolCalls ? JSON.stringify(turn.toolCalls) : null,
					createdAtByTurn.get(turn.turnNumber) ?? now,
				);

				db.prepare("INSERT OR IGNORE INTO turns_fts (rowid, content) VALUES (?, ?)").run(
					result.lastInsertRowid,
					turn.content,
				);
			}

			db.prepare("UPDATE sessions SET turn_count = ?, updated_at = ? WHERE id = ?").run(
				session.turns.length,
				new Date(session.meta.updated).getTime(),
				session.meta.id,
			);
		})();

		return true;
	} catch (err) {
		process.stderr.write(
			`[chitragupta] session reconcile failed for ${session.meta.id}: ${err instanceof Error ? err.message : err}\n`,
		);
		return false;
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

// ─── Takumi C8 Observation / Pattern / Prediction / Heal Helpers ───────────

// C8 observation/pattern/prediction/heal helpers live in session-db-c8.ts.
