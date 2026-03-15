import crypto from "node:crypto";
import path from "node:path";
import { getAgentDb } from "./session-db.js";

/**
 * Canonical persisted summary for one bounded overnight/system research loop.
 *
 * This is intentionally loop-level, not experiment-attempt level. Individual
 * round/attempt records live in `research_experiments`; this table stores the
 * run-wide outcome used by Nidra and later refinement passes.
 */
export interface ResearchLoopSummaryInput {
	projectPath: string;
	loopKey?: string | null;
	sessionId?: string | null;
	parentSessionId?: string | null;
	sessionLineageKey?: string | null;
	sabhaId?: string | null;
	councilVerdict?: string | null;
	topic: string;
	hypothesis?: string | null;
	roundsRequested: number;
	roundsCompleted: number;
	stopReason: string;
	bestMetric?: number | null;
	bestRoundNumber?: number | null;
	noImprovementStreak?: number | null;
	totalDurationMs?: number | null;
	totalBudgetMs?: number | null;
	keptRounds?: number | null;
	revertedRounds?: number | null;
	plannerRouteClass?: string | null;
	plannerSelectedCapabilityId?: string | null;
	plannerSelectedModelId?: string | null;
	plannerSelectedProviderId?: string | null;
	executionRouteClass?: string | null;
	selectedCapabilityId?: string | null;
	selectedModelId?: string | null;
	selectedProviderId?: string | null;
	record: Record<string, unknown>;
}

export interface StoredResearchLoopSummary extends ResearchLoopSummaryInput {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface ListResearchLoopSummariesOptions {
	projectPath?: string;
	sessionId?: string;
	loopKey?: string;
	updatedAfter?: number;
	updatedBefore?: number;
	limit?: number;
	offset?: number;
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

/**
 * Build a stable identity for a loop summary.
 *
 * A supplied `loopKey` wins. Otherwise I derive a deterministic id from the
 * canonical project/topic/session lineage so repeated upserts target the same
 * logical loop.
 */
function buildResearchLoopSummaryId(input: ResearchLoopSummaryInput): string {
	const loopKey =
		typeof input.loopKey === "string" && input.loopKey.trim()
			? input.loopKey.trim()
			: JSON.stringify({
				projectPath: normalizeProjectPath(input.projectPath),
				topic: input.topic,
				hypothesis: input.hypothesis ?? null,
				sessionId: input.sessionId ?? null,
				parentSessionId: input.parentSessionId ?? null,
				sessionLineageKey: input.sessionLineageKey ?? null,
				sabhaId: input.sabhaId ?? null,
			});
	return crypto.createHash("sha256").update(loopKey).digest("hex").slice(0, 24);
}

/** Parse a stored DB row into the public summary shape. */
function parseStoredRow(row: Record<string, unknown>): StoredResearchLoopSummary {
	let record: Record<string, unknown> = {};
	try {
		record = row.summary_json ? JSON.parse(String(row.summary_json)) as Record<string, unknown> : {};
	} catch {
		record = {};
	}
	return {
		id: String(row.id),
		projectPath: String(row.project),
		loopKey: normalizeOptionalString(row.loop_key),
		sessionId: normalizeOptionalString(row.session_id),
		parentSessionId: normalizeOptionalString(row.parent_session_id),
		sessionLineageKey: normalizeOptionalString(row.session_lineage_key),
		sabhaId: normalizeOptionalString(row.sabha_id),
		councilVerdict: normalizeOptionalString(row.council_verdict),
		topic: String(row.topic),
		hypothesis: normalizeOptionalString(row.hypothesis),
		roundsRequested: Number(row.rounds_requested ?? 0),
		roundsCompleted: Number(row.rounds_completed ?? 0),
		stopReason: String(row.stop_reason ?? "unknown"),
		bestMetric: normalizeOptionalNumber(row.best_metric),
		bestRoundNumber: normalizeOptionalNumber(row.best_round_number),
		noImprovementStreak: normalizeOptionalNumber(row.no_improvement_streak),
		totalDurationMs: normalizeOptionalNumber(row.total_duration_ms),
		totalBudgetMs: normalizeOptionalNumber(row.total_budget_ms),
		keptRounds: normalizeOptionalNumber(row.kept_rounds),
		revertedRounds: normalizeOptionalNumber(row.reverted_rounds),
		plannerRouteClass: normalizeOptionalString(row.planner_route_class),
		plannerSelectedCapabilityId: normalizeOptionalString(row.planner_selected_capability_id),
		plannerSelectedModelId: normalizeOptionalString(row.planner_selected_model_id),
		plannerSelectedProviderId: normalizeOptionalString(row.planner_selected_provider_id),
		executionRouteClass: normalizeOptionalString(row.execution_route_class),
		selectedCapabilityId: normalizeOptionalString(row.selected_capability_id),
		selectedModelId: normalizeOptionalString(row.selected_model_id),
		selectedProviderId: normalizeOptionalString(row.selected_provider_id),
		record,
		createdAt: Number(row.created_at ?? Date.now()),
		updatedAt: Number(row.updated_at ?? Date.now()),
	};
}

/** Insert or update the canonical research-loop summary row. */
export function upsertResearchLoopSummary(input: ResearchLoopSummaryInput): StoredResearchLoopSummary {
	const db = getAgentDb();
	const projectPath = normalizeProjectPath(input.projectPath);
	const id = buildResearchLoopSummaryId(input);
	const now = Date.now();
	db.prepare(`
		INSERT INTO research_loop_summaries (
			id,
			project,
			loop_key,
			session_id,
			parent_session_id,
			session_lineage_key,
			sabha_id,
			council_verdict,
			topic,
			hypothesis,
			rounds_requested,
			rounds_completed,
			stop_reason,
			best_metric,
			best_round_number,
			no_improvement_streak,
			total_duration_ms,
			total_budget_ms,
			kept_rounds,
			reverted_rounds,
			planner_route_class,
			planner_selected_capability_id,
			planner_selected_model_id,
			planner_selected_provider_id,
			execution_route_class,
			selected_capability_id,
			selected_model_id,
			selected_provider_id,
			summary_json,
			created_at,
			updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
		)
		ON CONFLICT(id) DO UPDATE SET
			loop_key = excluded.loop_key,
			session_id = excluded.session_id,
			parent_session_id = excluded.parent_session_id,
			session_lineage_key = excluded.session_lineage_key,
			sabha_id = excluded.sabha_id,
			council_verdict = excluded.council_verdict,
			topic = excluded.topic,
			hypothesis = excluded.hypothesis,
			rounds_requested = excluded.rounds_requested,
			rounds_completed = excluded.rounds_completed,
			stop_reason = excluded.stop_reason,
			best_metric = excluded.best_metric,
			best_round_number = excluded.best_round_number,
			no_improvement_streak = excluded.no_improvement_streak,
			total_duration_ms = excluded.total_duration_ms,
			total_budget_ms = excluded.total_budget_ms,
			kept_rounds = excluded.kept_rounds,
			reverted_rounds = excluded.reverted_rounds,
			planner_route_class = excluded.planner_route_class,
			planner_selected_capability_id = excluded.planner_selected_capability_id,
			planner_selected_model_id = excluded.planner_selected_model_id,
			planner_selected_provider_id = excluded.planner_selected_provider_id,
			execution_route_class = excluded.execution_route_class,
			selected_capability_id = excluded.selected_capability_id,
			selected_model_id = excluded.selected_model_id,
			selected_provider_id = excluded.selected_provider_id,
			summary_json = excluded.summary_json,
			updated_at = excluded.updated_at
	`).run(
		id,
		projectPath,
		normalizeOptionalString(input.loopKey),
		normalizeOptionalString(input.sessionId),
		normalizeOptionalString(input.parentSessionId),
		normalizeOptionalString(input.sessionLineageKey),
		normalizeOptionalString(input.sabhaId),
		normalizeOptionalString(input.councilVerdict),
		input.topic,
		normalizeOptionalString(input.hypothesis),
		input.roundsRequested,
		input.roundsCompleted,
		input.stopReason,
		normalizeOptionalNumber(input.bestMetric),
		normalizeOptionalNumber(input.bestRoundNumber),
		normalizeOptionalNumber(input.noImprovementStreak),
		normalizeOptionalNumber(input.totalDurationMs),
		normalizeOptionalNumber(input.totalBudgetMs),
		normalizeOptionalNumber(input.keptRounds),
		normalizeOptionalNumber(input.revertedRounds),
		normalizeOptionalString(input.plannerRouteClass),
		normalizeOptionalString(input.plannerSelectedCapabilityId),
		normalizeOptionalString(input.plannerSelectedModelId),
		normalizeOptionalString(input.plannerSelectedProviderId),
		normalizeOptionalString(input.executionRouteClass),
		normalizeOptionalString(input.selectedCapabilityId),
		normalizeOptionalString(input.selectedModelId),
		normalizeOptionalString(input.selectedProviderId),
		JSON.stringify(input.record),
		now,
		now,
	);
	const row = db.prepare("SELECT * FROM research_loop_summaries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
	if (!row) throw new Error(`Research loop summary ${id} was not persisted`);
	return parseStoredRow(row);
}

/** List persisted research-loop summaries with lightweight filtering. */
export function listResearchLoopSummaries(
	options: ListResearchLoopSummariesOptions = {},
): StoredResearchLoopSummary[] {
	const db = getAgentDb();
	const conditions: string[] = [];
	const values: Array<string | number> = [];
	if (options.projectPath) {
		conditions.push("project = ?");
		values.push(normalizeProjectPath(options.projectPath));
	}
	if (options.sessionId) {
		conditions.push("session_id = ?");
		values.push(options.sessionId);
	}
	if (options.loopKey) {
		conditions.push("loop_key = ?");
		values.push(options.loopKey);
	}
	if (typeof options.updatedAfter === "number") {
		conditions.push("updated_at >= ?");
		values.push(options.updatedAfter);
	}
	if (typeof options.updatedBefore === "number") {
		conditions.push("updated_at < ?");
		values.push(options.updatedBefore);
	}
	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = Math.max(1, Math.min(options.limit ?? 20, 500));
	const offset = typeof options.offset === "number" && Number.isFinite(options.offset) && options.offset > 0
		? Math.trunc(options.offset)
		: 0;
	const rows = db.prepare(
		`SELECT * FROM research_loop_summaries ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?`,
	).all(...values, limit, offset) as Array<Record<string, unknown>>;
	return rows.map(parseStoredRow);
}
