import crypto from "node:crypto";
import path from "node:path";
import { getAgentDb } from "./session-db.js";

/**
 * Durable checkpoint for an active bounded research loop.
 *
 * This is intentionally loop-phase state, not the final summary. Final
 * outcomes live in `research_loop_summaries`; this table exists so a timed-out
 * or restarted process can continue from the last safe phase instead of
 * reconstructing from experiments alone.
 */
export interface ResearchLoopCheckpointInput {
	projectPath: string;
	loopKey: string;
	sessionId?: string | null;
	parentSessionId?: string | null;
	sessionLineageKey?: string | null;
	sabhaId?: string | null;
	topic?: string | null;
	hypothesis?: string | null;
	status: "active" | "terminal";
	phase: string;
	currentRound?: number | null;
	nextRoundNumber?: number | null;
	totalRounds?: number | null;
	cancelRequestedAt?: number | null;
	cancelReason?: string | null;
	checkpoint: Record<string, unknown>;
}

export interface StoredResearchLoopCheckpoint extends ResearchLoopCheckpointInput {
	id: string;
	createdAt: number;
	updatedAt: number;
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProjectPath(projectPath: string): string {
	const trimmed = projectPath.trim();
	if (!trimmed) return "";
	return path.normalize(path.resolve(trimmed));
}

function buildResearchLoopCheckpointId(projectPath: string, loopKey: string): string {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify({ projectPath: normalizeProjectPath(projectPath), loopKey: loopKey.trim() }))
		.digest("hex")
		.slice(0, 24);
}

function parseStoredCheckpoint(row: Record<string, unknown>): StoredResearchLoopCheckpoint {
	let checkpoint: Record<string, unknown> = {};
	try {
		checkpoint = row.checkpoint_json ? JSON.parse(String(row.checkpoint_json)) as Record<string, unknown> : {};
	} catch {
		checkpoint = {};
	}
	return {
		id: String(row.id),
		projectPath: String(row.project),
		loopKey: String(row.loop_key),
		sessionId: normalizeOptionalString(row.session_id),
		parentSessionId: normalizeOptionalString(row.parent_session_id),
		sessionLineageKey: normalizeOptionalString(row.session_lineage_key),
		sabhaId: normalizeOptionalString(row.sabha_id),
		topic: normalizeOptionalString(row.topic),
		hypothesis: normalizeOptionalString(row.hypothesis),
		status: row.status === "terminal" ? "terminal" : "active",
		phase: typeof row.phase === "string" ? row.phase : "unknown",
		currentRound: normalizeOptionalNumber(row.current_round),
		nextRoundNumber: normalizeOptionalNumber(row.next_round_number),
		totalRounds: normalizeOptionalNumber(row.total_rounds),
		cancelRequestedAt: normalizeOptionalNumber(row.cancel_requested_at),
		cancelReason: normalizeOptionalString(row.cancel_reason),
		checkpoint,
		createdAt: Number(row.created_at ?? Date.now()),
		updatedAt: Number(row.updated_at ?? Date.now()),
	};
}

/**
 * Upsert the current active research-loop phase snapshot.
 *
 * A loop key is unique per project, so retries and restarts replace the same
 * row instead of emitting a new checkpoint every time.
 */
export function upsertResearchLoopCheckpoint(
	input: ResearchLoopCheckpointInput,
): StoredResearchLoopCheckpoint {
	const projectPath = normalizeProjectPath(input.projectPath);
	const loopKey = input.loopKey.trim();
	if (!projectPath || !loopKey) {
		throw new Error("Research loop checkpoint requires projectPath and loopKey");
	}
	const id = buildResearchLoopCheckpointId(projectPath, loopKey);
	const now = Date.now();
	const db = getAgentDb();
	db.prepare(`
		INSERT INTO research_loop_checkpoints (
			id,
			project,
			loop_key,
			session_id,
			parent_session_id,
			session_lineage_key,
			sabha_id,
			topic,
			hypothesis,
			status,
			phase,
			current_round,
			next_round_number,
			total_rounds,
			cancel_requested_at,
			cancel_reason,
			checkpoint_json,
			created_at,
			updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
		)
		ON CONFLICT(id) DO UPDATE SET
			session_id = excluded.session_id,
			parent_session_id = excluded.parent_session_id,
			session_lineage_key = excluded.session_lineage_key,
			sabha_id = excluded.sabha_id,
			topic = excluded.topic,
			hypothesis = excluded.hypothesis,
			status = excluded.status,
			phase = excluded.phase,
			current_round = excluded.current_round,
			next_round_number = excluded.next_round_number,
			total_rounds = excluded.total_rounds,
			cancel_requested_at = excluded.cancel_requested_at,
			cancel_reason = excluded.cancel_reason,
			checkpoint_json = excluded.checkpoint_json,
			updated_at = excluded.updated_at
	`).run(
		id,
		projectPath,
		loopKey,
		normalizeOptionalString(input.sessionId),
		normalizeOptionalString(input.parentSessionId),
		normalizeOptionalString(input.sessionLineageKey),
		normalizeOptionalString(input.sabhaId),
		normalizeOptionalString(input.topic),
		normalizeOptionalString(input.hypothesis),
		input.status,
		input.phase,
		normalizeOptionalNumber(input.currentRound),
		normalizeOptionalNumber(input.nextRoundNumber),
		normalizeOptionalNumber(input.totalRounds),
		normalizeOptionalNumber(input.cancelRequestedAt),
		normalizeOptionalString(input.cancelReason),
		JSON.stringify(input.checkpoint),
		now,
		now,
	);
	const row = db.prepare("SELECT * FROM research_loop_checkpoints WHERE id = ?").get(id) as Record<string, unknown> | undefined;
	if (!row) throw new Error(`Research loop checkpoint ${id} was not persisted`);
	return parseStoredCheckpoint(row);
}

/** Load the most recent checkpoint for a logical research loop. */
export function getResearchLoopCheckpoint(
	projectPath: string,
	loopKey: string,
): StoredResearchLoopCheckpoint | null {
	const normalizedProject = normalizeProjectPath(projectPath);
	const normalizedLoopKey = loopKey.trim();
	if (!normalizedProject || !normalizedLoopKey) return null;
	const db = getAgentDb();
	const row = db.prepare(
		"SELECT * FROM research_loop_checkpoints WHERE project = ? AND loop_key = ?",
	).get(normalizedProject, normalizedLoopKey) as Record<string, unknown> | undefined;
	return row ? parseStoredCheckpoint(row) : null;
}

/** List recent research-loop checkpoints so operators can discover resumable work. */
export function listResearchLoopCheckpoints(
	options: { projectPath?: string | null; limit?: number } = {},
): StoredResearchLoopCheckpoint[] {
	const db = getAgentDb();
	const normalizedProject = options.projectPath ? normalizeProjectPath(options.projectPath) : "";
	const limit = typeof options.limit === "number" && Number.isFinite(options.limit)
		? Math.max(1, Math.min(200, Math.trunc(options.limit)))
		: 20;
	const rows = normalizedProject
		? db.prepare(
			`SELECT * FROM research_loop_checkpoints
			 WHERE project = ?
			 ORDER BY updated_at DESC
			 LIMIT ?`,
		).all(normalizedProject, limit)
		: db.prepare(
			`SELECT * FROM research_loop_checkpoints
			 ORDER BY updated_at DESC
			 LIMIT ?`,
		).all(limit);
	return (rows as Record<string, unknown>[]).map(parseStoredCheckpoint);
}

/** Remove the checkpoint once a loop has fully completed or been discarded. */
export function clearResearchLoopCheckpoint(projectPath: string, loopKey: string): boolean {
	const normalizedProject = normalizeProjectPath(projectPath);
	const normalizedLoopKey = loopKey.trim();
	if (!normalizedProject || !normalizedLoopKey) return false;
	const db = getAgentDb();
	const result = db.prepare(
		"DELETE FROM research_loop_checkpoints WHERE project = ? AND loop_key = ?",
	).run(normalizedProject, normalizedLoopKey);
	return result.changes > 0;
}
