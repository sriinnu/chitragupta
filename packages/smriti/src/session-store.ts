/**
 * @chitragupta/smriti -- Session store (v2).
 * Composes: session-db.ts, session-store-cache.ts, session-queries.ts.
 * Lifecycle: create, save, load, delete, addTurn, migrate.
 */
import fs from "fs";
import path from "path";
import { SessionError } from "@chitragupta/core";
import type { Session, SessionMeta, SessionOpts, SessionTurn } from "./types.js";
import { parseSessionMarkdown } from "./markdown-parser.js";
import { writeSessionMarkdown, writeTurnMarkdown } from "./markdown-writer.js";
import {
	getSessionsRoot,
	getAgentDb,
	getSessionMetaFromDb,
	upsertSessionToDb,
	insertTurnToDb,
	getMaxTurnNumber as getMaxTurnNumberDb,
	reconcileSessionToDb,
} from "./session-db.js";
import { cacheGet, cachePut, cacheInvalidate } from "./session-store-cache.js";
import {
	atomicRename,
	generateSessionId,
	localDateString,
	patchFrontmatterUpdated,
	readMetadataString,
	resolveMcpClientKey,
	resolveSessionLineageKey,
	resolveSessionPath,
	resolveSessionReusePolicy,
	sanitizeTurnForPersistence,
} from "./session-store-helpers.js";
import { updateSessionMeta as updateSessionMetaDb } from "./session-queries.js";

export { _resetSessionCache } from "./session-store-cache.js";
export { _resetDbInit, _getDbStatus, getMaxTurnNumber } from "./session-db.js";
export {
	listSessions,
	listSessionsByIds,
	listSessionsByDate,
	listSessionsByDateRange,
	listSessionDates,
	listSessionProjects,
	listTurnsWithTimestamps,
	findSessionByMetadata,
	getTurnsSince,
	getSessionsModifiedSince,
} from "./session-queries.js";

function mergeLegacySessionMetaFromDb(markdownMeta: SessionMeta, dbMeta?: SessionMeta): SessionMeta {
	if (!dbMeta) return markdownMeta;

	let metadata = markdownMeta.metadata;
	if (!metadata && dbMeta.metadata) {
		metadata = structuredClone(dbMeta.metadata);
	}

	const provider = markdownMeta.provider ?? dbMeta.provider;
	if (provider && metadata?.provider !== provider) {
		metadata = { ...(metadata ?? {}), provider };
	}

	return {
		...markdownMeta,
		provider,
		metadata,
	};
}

function turnsAreEquivalent(left: SessionTurn, right: SessionTurn): boolean {
	return left.turnNumber === right.turnNumber
		&& left.role === right.role
		&& left.content === right.content
		&& (left.agent ?? null) === (right.agent ?? null)
		&& (left.model ?? null) === (right.model ?? null)
		&& JSON.stringify(left.contentParts ?? null) === JSON.stringify(right.contentParts ?? null)
		&& JSON.stringify(left.toolCalls ?? null) === JSON.stringify(right.toolCalls ?? null);
}

function turnsAreEquivalentIgnoringTurnNumber(left: SessionTurn, right: SessionTurn): boolean {
	return left.role === right.role
		&& left.content === right.content
		&& (left.agent ?? null) === (right.agent ?? null)
		&& (left.model ?? null) === (right.model ?? null)
		&& JSON.stringify(left.contentParts ?? null) === JSON.stringify(right.contentParts ?? null)
		&& JSON.stringify(left.toolCalls ?? null) === JSON.stringify(right.toolCalls ?? null);
}

function findReusableLineageSession(
	project: string,
	lineageKey: string,
): Session | null {
	try {
		const db = getAgentDb();
		const todayPrefix = `session-${localDateString()}-`;
		const row = db.prepare(
			`SELECT id FROM sessions
			 WHERE project = ?
			   AND id LIKE ?
			   AND (
				    json_extract(metadata, '$.sessionLineageKey') = ?
				    OR json_extract(metadata, '$.clientKey') = ?
			   )
			 ORDER BY updated_at DESC
			 LIMIT 1`,
		).get(project, `${todayPrefix}%`, lineageKey, lineageKey) as { id?: unknown } | undefined;
		if (typeof row?.id !== "string" || row.id.length === 0) return null;
		return loadSession(row.id, project);
	} catch {
		return null;
	}
}

/**
 * Create a new session with date-based naming: session-YYYY-MM-DD.md
 *
 * Directory structure: ~/.chitragupta/sessions/<project-hash>/YYYY/MM/
 * Write-through: also inserts into agent.db sessions table.
 */
export function createSession(opts: SessionOpts): Session {
	const clientKey = resolveMcpClientKey(opts);
	const lineageKey = resolveSessionLineageKey(opts, clientKey);
	const reusePolicy = resolveSessionReusePolicy(opts, lineageKey);
	const agent = opts.agent ?? "chitragupta";
	if (reusePolicy === "same_day" && lineageKey) {
		const existing = findReusableLineageSession(opts.project, lineageKey);
		if (existing) return existing;
	}

	const now = new Date().toISOString();
	const { id, filePath } = generateSessionId(opts.project);
	const metadata = { ...(opts.metadata ?? {}) };
	if (clientKey) metadata.clientKey = clientKey;
	if (lineageKey) metadata.sessionLineageKey = lineageKey;
	if (metadata.sessionReusePolicy === undefined) metadata.sessionReusePolicy = reusePolicy;
	if (typeof opts.consumer === "string" && opts.consumer.trim() && metadata.consumer === undefined) {
		metadata.consumer = opts.consumer.trim();
	}
	if (typeof opts.surface === "string" && opts.surface.trim() && metadata.surface === undefined) {
		metadata.surface = opts.surface.trim();
	}
	if (typeof opts.channel === "string" && opts.channel.trim() && metadata.channel === undefined) {
		metadata.channel = opts.channel.trim();
	}
	if (typeof opts.actorId === "string" && opts.actorId.trim() && metadata.actorId === undefined) {
		metadata.actorId = opts.actorId.trim();
	}

	const meta: SessionMeta = {
		id,
		title: opts.title ?? "New Session",
		created: now,
		updated: now,
		agent,
		model: opts.model ?? "unknown",
		provider: opts.provider,
		project: opts.project,
		parent: opts.parentSessionId ?? null,
		branch: opts.branch ?? null,
		tags: opts.tags ?? [],
		totalCost: 0,
		totalTokens: 0,
		metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
	};

	if (opts.provider) {
		meta.metadata = { ...meta.metadata, provider: opts.provider };
	}

	const session: Session = { meta, turns: [] };

	// Write .md file
	saveSession(session);

	// Write-through to SQLite
	upsertSessionToDb(meta, filePath, 0);

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
		const mergedMeta = mergeLegacySessionMetaFromDb(
			session.meta,
			getSessionMetaFromDb(session.meta.id),
		);
		session.meta = {
			...mergedMeta,
			updated: new Date().toISOString(),
		};
		const markdown = writeSessionMarkdown(session);
		// Atomic write: write to temp file then rename (rename is atomic on POSIX).
		// Prevents half-written files if the process crashes mid-write.
		const tmpPath = `${filePath}.tmp.${process.pid}`;
		fs.writeFileSync(tmpPath, markdown, "utf-8");
		atomicRename(tmpPath, filePath);
		// Write-through: update L1 cache
		cachePut(session.meta.id, session.meta.project, session);
		// Keep SQLite metadata aligned with the markdown source of truth.
		upsertSessionToDb(session.meta, filePath, session.turns.length);
	} catch (err) {
		throw new SessionError(
			`Failed to save session ${session.meta.id} at ${filePath}: ${(err as Error).message}`,
		);
	}
}

export function updateSessionMeta(
	sessionId: string,
	updates: Partial<Pick<SessionMeta, "title" | "model" | "metadata" | "tags">>,
): void {
	updateSessionMetaDb(sessionId, updates);

	const dbMeta = getSessionMetaFromDb(sessionId);
	if (!dbMeta) return;

	const filePath = resolveSessionPath(sessionId, dbMeta.project);
	if (!fs.existsSync(filePath)) return;

	try {
		const session = parseSessionMarkdown(fs.readFileSync(filePath, "utf-8"));
		let metadata = updates.metadata !== undefined
			? structuredClone(updates.metadata)
			: session.meta.metadata;
		const provider = session.meta.provider
			?? dbMeta.provider
			?? (typeof metadata?.provider === "string" ? metadata.provider : undefined);
		if (provider && metadata?.provider !== provider) {
			metadata = { ...(metadata ?? {}), provider };
		}
		session.meta = {
			...session.meta,
			title: updates.title ?? session.meta.title,
			model: updates.model ?? session.meta.model,
			tags: updates.tags ?? session.meta.tags,
			provider,
			metadata,
		};
		saveSession(session);
	} catch (err: unknown) {
		process.stderr.write(
			`[smriti:session-store] updateSessionMeta markdown sync failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}\n`,
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
		session.meta = mergeLegacySessionMetaFromDb(
			session.meta,
			getSessionMetaFromDb(session.meta.id),
		);
		reconcileSessionToDb(session, filePath);
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
	const prev = sessionWriteQueues.get(key)?.catch(() => undefined) ?? Promise.resolve();
	const next = prev.then(() => {
		const filePath = resolveSessionPath(sessionId, project);
		const sanitizedTurn = sanitizeTurnForPersistence(turn);

		if (!fs.existsSync(filePath)) {
			throw new SessionError(`Session not found: ${sessionId} (project: ${project})`);
		}

		const fileContent = fs.readFileSync(filePath, "utf-8");

		// Read current turn count from file to assign turn number.
		// Fall back to SQLite if markdown is corrupted (prevents permanently stuck sessions).
		let parsedSession: Session | undefined;
		if (!sanitizedTurn.turnNumber) {
			try {
				parsedSession = parseSessionMarkdown(fileContent);
				const lastTurn = parsedSession.turns.at(-1);
				if (lastTurn && turnsAreEquivalentIgnoringTurnNumber(lastTurn, sanitizedTurn)) {
					reconcileSessionToDb(parsedSession, filePath);
					return;
				}
				sanitizedTurn.turnNumber = parsedSession.turns.length + 1;
			} catch {
				sanitizedTurn.turnNumber = getMaxTurnNumberDb(sessionId) + 1;
			}
		} else {
			try {
				parsedSession = parseSessionMarkdown(fileContent);
			} catch {
				parsedSession = undefined;
			}
		}

		if (parsedSession) {
			const existingTurn = parsedSession.turns.find(
				(existing) => existing.turnNumber === sanitizedTurn.turnNumber,
			);
			if (existingTurn) {
				if (turnsAreEquivalent(existingTurn, sanitizedTurn)) {
					reconcileSessionToDb(parsedSession, filePath);
					return;
				}
				throw new SessionError(
					`Turn ${sanitizedTurn.turnNumber} already exists for session ${sessionId} with different content.`,
				);
			}
		}

		// Keep markdown frontmatter updated for deterministic filesystem fallback ordering.
		const updatedIso = new Date().toISOString();
		const patchedContent = patchFrontmatterUpdated(fileContent, updatedIso);
		if (patchedContent !== fileContent) {
			fs.writeFileSync(filePath, patchedContent, "utf-8");
		}

		// Append turn to .md file (no full rewrite!)
		const turnMd = writeTurnMarkdown(sanitizedTurn);
		fs.appendFileSync(filePath, `\n${turnMd}\n`, "utf-8");

		// Invalidate L1 cache — file content changed
		cacheInvalidate(sessionId, project);

		// Write-through to SQLite (self-heals missing session rows in SQLite).
		const insertStatus = insertTurnToDb(sessionId, sanitizedTurn, { project, filePath });
		if (insertStatus !== "inserted") {
			const reconciledSession = parseSessionMarkdown(fs.readFileSync(filePath, "utf-8"));
			reconcileSessionToDb(reconciledSession, filePath);
		}
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
