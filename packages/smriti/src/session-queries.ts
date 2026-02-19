/**
 * @chitragupta/smriti — Session query operations.
 *
 * Complex read-only query functions extracted from session-store.ts:
 *   - listSessions, listSessionsByDate, listSessionsByDateRange
 *   - listSessionDates, listSessionProjects
 *   - listTurnsWithTimestamps, findSessionByMetadata
 *   - updateSessionMeta
 *
 * All mutations (create, save, delete, addTurn) remain in session-store.ts.
 * DB helpers are imported from session-db.ts (no circular dependency).
 */

import fs from "fs";
import path from "path";

import { SessionError } from "@chitragupta/core";
import type { SessionMeta, SessionTurn } from "./types.js";
import { parseSessionMarkdown } from "./markdown-parser.js";
import {
	getAgentDb,
	rowToSessionMeta,
	getSessionsRoot,
	getProjectSessionDir,
} from "./session-db.js";

// Re-export getMaxTurnNumber from session-db so the public API stays on session-store.
export { getMaxTurnNumber } from "./session-db.js";

// ─── Filesystem Fallback ────────────────────────────────────────────────────

/**
 * Legacy filesystem scan fallback.
 * Used when SQLite is unavailable or returns no rows (pre-migration state).
 *
 * @param project - Optional project path to scan sessions for.
 * @returns Array of session metadata sorted by updated timestamp descending.
 */
export function listSessionsFromFilesystem(project?: string): SessionMeta[] {
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

// ─── Query API ──────────────────────────────────────────────────────────────

/**
 * List sessions, optionally filtered by project.
 *
 * Queries SQLite for fast indexed lookups. Falls back to filesystem scan
 * if SQLite is empty (pre-migration state).
 *
 * @param project - Optional project path to filter sessions.
 * @returns Array of {@link SessionMeta} sorted by most recently updated first.
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
 * @returns Array of {@link SessionMeta} for the given date.
 */
export function listSessionsByDate(date: string, project?: string): SessionMeta[] {
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
 * @returns Array of {@link SessionMeta} within the date range.
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
 * @returns Array of date strings in YYYY-MM-DD format.
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
 *
 * @returns Array of project info objects with session count and last activity.
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
 * List turns for a session with their SQLite timestamps.
 * Returns turn data + created_at for each turn from the database.
 * Falls back to loadSession() with synthetic timestamps if SQLite is unavailable.
 *
 * Note: Uses a lazy import of loadSession to avoid circular dependency
 * with session-store.ts at module load time.
 *
 * @param sessionId - The session ID to list turns for.
 * @param project - The project path the session belongs to.
 * @returns Array of turns with createdAt timestamps appended.
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
		// Lazy import to avoid circular dependency at module load time
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { loadSession } = require("./session-store.js") as typeof import("./session-store.js");
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
 * Find a session by metadata field (e.g. vaayuSessionId).
 * Scans the sessions table metadata JSON column.
 *
 * @param key - The metadata key to search (must be a safe identifier).
 * @param value - The value to match against.
 * @param project - Optional project path to narrow the search.
 * @returns The matching session metadata, or undefined if not found.
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

/**
 * Update session metadata fields in SQLite.
 * Only updates the fields provided — does not touch other columns.
 * Also bumps the updated_at timestamp.
 *
 * @param sessionId - The session to update.
 * @param updates - Partial metadata fields to update.
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
