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

import { createRequire } from "module";

import { SessionError } from "@chitragupta/core";
import type { SessionMeta, SessionTurn } from "./types.js";
import {
	getAgentDb,
	hasAgentTable,
	rowToSessionMeta,
} from "./session-db.js";
export { listSessionsFromFilesystem } from "./session-queries-filesystem.js";
import { listSessionsFromFilesystem } from "./session-queries-filesystem.js";

const esmRequire = createRequire(import.meta.url);

// Re-export getMaxTurnNumber from session-db so the public API stays on session-store.
export { getMaxTurnNumber } from "./session-db.js";

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
 * Resolve a specific set of session IDs without scanning unrelated sessions.
 *
 * Uses SQLite for indexed lookups and falls back to the filesystem listing
 * when SQLite is unavailable.
 *
 * @param sessionIds - Session IDs to resolve.
 * @returns Matching session metadata sorted by most recently updated first.
 */
export function listSessionsByIds(sessionIds: readonly string[]): SessionMeta[] {
	if (sessionIds.length === 0) return [];

	try {
		const db = getAgentDb();
		const placeholders = sessionIds.map(() => "?").join(",");
		const rows = db.prepare(
			`SELECT * FROM sessions WHERE id IN (${placeholders}) ORDER BY updated_at DESC`,
		).all(...sessionIds) as Array<Record<string, unknown>>;
		return rows.map(rowToSessionMeta);
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] listSessionsByIds SQLite failed: ${err instanceof Error ? err.message : String(err)}\n`);
		const wanted = new Set(sessionIds);
		return listSessionsFromFilesystem().filter((meta) => wanted.has(meta.id));
	}
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
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] listSessionsByDateRange SQLite failed: ${err instanceof Error ? err.message : String(err)}\n`);
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
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] listSessionDates SQLite failed: ${err instanceof Error ? err.message : String(err)}\n`);
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
		if (!hasAgentTable("sessions")) {
			// Some semantic-only tests and bootstrap paths intentionally run before
			// session tables exist. I treat that as an empty project set instead of
			// noisy stderr because there is nothing actionable to recover yet.
			return [];
		}
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
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] listSessionProjects SQLite failed: ${err instanceof Error ? err.message : String(err)}\n`);
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
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] listTurnsWithTimestamps SQLite failed: ${err instanceof Error ? err.message : String(err)}\n`);
	}

	// Fallback: load from markdown and synthesize timestamps
	try {
		// Lazy require to avoid circular dependency at module load time.
		// Use createRequire so this works in ESM builds too.
		const { loadSession } = esmRequire("./session-store.js") as typeof import("./session-store.js");
		const session = loadSession(sessionId, project);
		const baseTime = new Date(session.meta.created).getTime();
		return session.turns.map((turn, i) => ({
			...turn,
			createdAt: baseTime + i * 1000, // 1-second spacing
		}));
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] listTurnsWithTimestamps markdown fallback failed: ${err instanceof Error ? err.message : String(err)}\n`);
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
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] findSessionByMetadata failed: ${err instanceof Error ? err.message : String(err)}\n`);
		return undefined;
	}
}

// ─── Incremental Query API ───────────────────────────────────────────────────

/**
 * Get turns added after a given turn number for a session.
 * Used by `handover_since` to provide incremental deltas.
 *
 * @param sessionId - The session to query.
 * @param sinceTurnNumber - Only return turns with turnNumber > this value.
 * @returns Array of turns added since the given turn number.
 */
export function getTurnsSince(sessionId: string, sinceTurnNumber: number): SessionTurn[] {
	try {
		const db = getAgentDb();
		const rows = db
			.prepare(
				"SELECT turn_number, role, content, agent, model, tool_calls FROM turns WHERE session_id = ? AND turn_number > ? ORDER BY turn_number ASC",
			)
			.all(sessionId, sinceTurnNumber) as Array<Record<string, unknown>>;

		return rows.map((row) => ({
			turnNumber: row.turn_number as number,
			role: row.role as "user" | "assistant",
			content: row.content as string,
			agent: (row.agent as string) ?? undefined,
			model: (row.model as string) ?? undefined,
			toolCalls: row.tool_calls ? JSON.parse(row.tool_calls as string) : undefined,
		}));
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] getTurnsSince SQLite failed: ${err instanceof Error ? err.message : String(err)}\n`);
		return [];
	}
}

/**
 * Get sessions created or updated after a timestamp.
 * Used by `memory_changes_since` to detect new/modified sessions.
 *
 * @param project - The project path to filter sessions.
 * @param sinceMs - Epoch ms threshold (exclusive).
 * @returns Array of session metadata for new/updated sessions.
 */
export function getSessionsModifiedSince(project: string, sinceMs: number): SessionMeta[] {
	try {
		const db = getAgentDb();
		const rows = db
			.prepare(
				"SELECT * FROM sessions WHERE project = ? AND updated_at > ? ORDER BY updated_at ASC",
			)
			.all(project, sinceMs) as Array<Record<string, unknown>>;

		return rows.map(rowToSessionMeta);
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] getSessionsModifiedSince SQLite failed: ${err instanceof Error ? err.message : String(err)}\n`);
		return [];
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
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-queries] updateSessionMeta failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}\n`);
	}
}
