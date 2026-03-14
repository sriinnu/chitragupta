import crypto from "node:crypto";
import path from "node:path";
import { getAgentDb } from "./session-db.js";

/** Terminal lifecycle outcomes for a persisted agent task. */
export type AgentTaskCheckpointStatus = "active" | "completed" | "aborted" | "error";

/**
 * Persisted snapshot for a single logical agent task.
 *
 * The task key is stable across retries/resume attempts. A task can represent
 * an interactive agent, a serve-mode worker, or a delegated sub-agent branch.
 */
export interface AgentTaskCheckpointInput {
	projectPath: string;
	taskKey: string;
	taskType?: string | null;
	agentId?: string | null;
	sessionId?: string | null;
	parentTaskKey?: string | null;
	sessionLineageKey?: string | null;
	status: AgentTaskCheckpointStatus;
	phase: string;
	checkpoint: Record<string, unknown>;
}

/** Durable row returned after checkpoint persistence. */
export interface StoredAgentTaskCheckpoint extends AgentTaskCheckpointInput {
	id: string;
	createdAt: number;
	updatedAt: number;
}

/** Query options for listing recent durable task checkpoints. */
export interface ListAgentTaskCheckpointsOptions {
	projectPath?: string;
	status?: AgentTaskCheckpointStatus;
	taskType?: string;
	sessionId?: string;
	limit?: number;
}

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProjectPath(projectPath: string): string {
	const trimmed = projectPath.trim();
	if (!trimmed) return "";
	return path.normalize(path.resolve(trimmed));
}

function buildTaskCheckpointId(projectPath: string, taskKey: string): string {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify({ projectPath: normalizeProjectPath(projectPath), taskKey: taskKey.trim() }))
		.digest("hex")
		.slice(0, 24);
}

function parseStoredCheckpoint(row: Record<string, unknown>): StoredAgentTaskCheckpoint {
	let checkpoint: Record<string, unknown> = {};
	try {
		checkpoint = row.checkpoint_json
			? JSON.parse(String(row.checkpoint_json)) as Record<string, unknown>
			: {};
	} catch {
		checkpoint = {};
	}

	return {
		id: String(row.id),
		projectPath: String(row.project),
		taskKey: String(row.task_key),
		taskType: normalizeOptionalString(row.task_type),
		agentId: normalizeOptionalString(row.agent_id),
		sessionId: normalizeOptionalString(row.session_id),
		parentTaskKey: normalizeOptionalString(row.parent_task_key),
		sessionLineageKey: normalizeOptionalString(row.session_lineage_key),
		status:
			row.status === "completed" || row.status === "aborted" || row.status === "error"
				? row.status
				: "active",
		phase: typeof row.phase === "string" ? row.phase : "unknown",
		checkpoint,
		createdAt: Number(row.created_at ?? Date.now()),
		updatedAt: Number(row.updated_at ?? Date.now()),
	};
}

/**
 * Upsert the latest state for a logical agent task.
 *
 * One row per `{projectPath, taskKey}` keeps timeout/retry pickup simple and
 * avoids a second orchestrator state machine.
 */
export function upsertAgentTaskCheckpoint(
	input: AgentTaskCheckpointInput,
): StoredAgentTaskCheckpoint {
	const projectPath = normalizeProjectPath(input.projectPath);
	const taskKey = input.taskKey.trim();
	if (!projectPath || !taskKey) {
		throw new Error("Agent task checkpoint requires projectPath and taskKey");
	}

	const id = buildTaskCheckpointId(projectPath, taskKey);
	const now = Date.now();
	const db = getAgentDb();
	db.prepare(`
		INSERT INTO agent_task_checkpoints (
			id,
			project,
			task_key,
			task_type,
			agent_id,
			session_id,
			parent_task_key,
			session_lineage_key,
			status,
			phase,
			checkpoint_json,
			created_at,
			updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
		)
		ON CONFLICT(id) DO UPDATE SET
			task_type = excluded.task_type,
			agent_id = excluded.agent_id,
			session_id = excluded.session_id,
			parent_task_key = excluded.parent_task_key,
			session_lineage_key = excluded.session_lineage_key,
			status = excluded.status,
			phase = excluded.phase,
			checkpoint_json = excluded.checkpoint_json,
			updated_at = excluded.updated_at
	`).run(
		id,
		projectPath,
		taskKey,
		normalizeOptionalString(input.taskType),
		normalizeOptionalString(input.agentId),
		normalizeOptionalString(input.sessionId),
		normalizeOptionalString(input.parentTaskKey),
		normalizeOptionalString(input.sessionLineageKey),
		input.status,
		input.phase,
		JSON.stringify(input.checkpoint),
		now,
		now,
	);

	const row = db.prepare("SELECT * FROM agent_task_checkpoints WHERE id = ?").get(id) as
		| Record<string, unknown>
		| undefined;
	if (!row) throw new Error(`Agent task checkpoint ${id} was not persisted`);
	return parseStoredCheckpoint(row);
}

/** Load the current checkpoint for a logical task key. */
export function getAgentTaskCheckpoint(
	projectPath: string,
	taskKey: string,
): StoredAgentTaskCheckpoint | null {
	const normalizedProject = normalizeProjectPath(projectPath);
	const normalizedTaskKey = taskKey.trim();
	if (!normalizedProject || !normalizedTaskKey) return null;
	const row = getAgentDb().prepare(
		"SELECT * FROM agent_task_checkpoints WHERE project = ? AND task_key = ?",
	).get(normalizedProject, normalizedTaskKey) as Record<string, unknown> | undefined;
	return row ? parseStoredCheckpoint(row) : null;
}

/**
 * List recent durable task checkpoints for operator inspection and timeout pickup.
 *
 * This is intentionally recent-first and bounded. The checkpoint payload already
 * contains a small recent-event trail, so callers can see where work stopped
 * without replaying the whole task transcript.
 */
export function listAgentTaskCheckpoints(
	options: ListAgentTaskCheckpointsOptions = {},
): StoredAgentTaskCheckpoint[] {
	const clauses: string[] = [];
	const params: unknown[] = [];
	const projectPath =
		typeof options.projectPath === "string" ? normalizeProjectPath(options.projectPath) : "";
	if (projectPath) {
		clauses.push("project = ?");
		params.push(projectPath);
	}
	if (options.status) {
		clauses.push("status = ?");
		params.push(options.status);
	}
	const taskType = normalizeOptionalString(options.taskType);
	if (taskType) {
		clauses.push("task_type = ?");
		params.push(taskType);
	}
	const sessionId = normalizeOptionalString(options.sessionId);
	if (sessionId) {
		clauses.push("session_id = ?");
		params.push(sessionId);
	}
	const limit =
		typeof options.limit === "number" && Number.isFinite(options.limit)
			? Math.max(1, Math.min(200, Math.trunc(options.limit)))
			: 25;
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	const rows = getAgentDb()
		.prepare(
			`SELECT * FROM agent_task_checkpoints ${where} ORDER BY updated_at DESC LIMIT ${limit}`,
		)
		.all(...params) as Record<string, unknown>[];
	return rows.map(parseStoredCheckpoint);
}

/** Remove a stored task checkpoint after explicit cleanup. */
export function clearAgentTaskCheckpoint(projectPath: string, taskKey: string): boolean {
	const normalizedProject = normalizeProjectPath(projectPath);
	const normalizedTaskKey = taskKey.trim();
	if (!normalizedProject || !normalizedTaskKey) return false;
	const result = getAgentDb().prepare(
		"DELETE FROM agent_task_checkpoints WHERE project = ? AND task_key = ?",
	).run(normalizedProject, normalizedTaskKey);
	return result.changes > 0;
}
