/**
 * @chitragupta/smriti -- Session store (v2).
 * Composes: session-db.ts, session-store-cache.ts, session-queries.ts.
 * Lifecycle: create, save, load, delete, addTurn, migrate.
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
	getMaxTurnNumber as getMaxTurnNumberDb,
} from "./session-db.js";
import {
	cacheGet,
	cachePut,
	cacheInvalidate,
} from "./session-store-cache.js";

// Re-exports from sub-modules

export { _resetSessionCache } from "./session-store-cache.js";
export { _resetDbInit, _getDbStatus, getMaxTurnNumber } from "./session-db.js";
export {
	listSessions,
	listSessionsByDate,
	listSessionsByDateRange,
	listSessionDates,
	listSessionProjects,
	listTurnsWithTimestamps,
	findSessionByMetadata,
	updateSessionMeta,
	getTurnsSince,
	getSessionsModifiedSince,
} from "./session-queries.js";

/**
 * Atomic rename: uses node:fs (bypasses test mocks on bare "fs").
 * Falls back to direct write if renameSync fails.
 */
function atomicRename(tmpPath: string, targetPath: string): void {
	try {
		nodeRenameSync(tmpPath, targetPath);
	} catch (err: unknown) {
		// Fallback: direct write (non-atomic but still correct)
		if (!process.env.VITEST) {
			process.stderr.write(`[smriti:session-store] atomic rename failed, using direct write: ${err instanceof Error ? err.message : String(err)}\n`);
		}
		fs.writeFileSync(targetPath, fs.readFileSync(tmpPath, "utf-8"), "utf-8");
		try { fs.unlinkSync(tmpPath); } catch { /* intentional: orphan tmp cleanup is best-effort */ }
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
	} catch (err: unknown) {
		process.stderr.write(`[smriti:session-store] deleteSession SQLite cleanup failed for ${id}: ${err instanceof Error ? err.message : String(err)}\n`);
	}
}
/** Per-session write queue to prevent concurrent write races. */
const sessionWriteQueues=new Map();


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
				turn.turnNumber = getMaxTurnNumberDb(sessionId) + 1;
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
	}).catch((err: unknown) => {
		throw err;
	}).finally(() => {
		if (sessionWriteQueues.get(key) === next) {
			sessionWriteQueues.delete(key);
		}
	});
	sessionWriteQueues.set(key, next);
	return next;
}
export { migrateExistingSessions } from "./session-store-migration.js";
