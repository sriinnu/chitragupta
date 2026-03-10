import crypto from "node:crypto";
import path from "node:path";
import { getAgentDb } from "./session-db.js";

export interface ResearchExperimentRecordInput {
	projectPath: string;
	experimentKey?: string | null;
	budgetMs?: number | null;
	topic: string;
	metricName: string;
	objective: string;
	decision: string;
	sessionId?: string | null;
	parentSessionId?: string | null;
	sessionLineageKey?: string | null;
	sabhaId?: string | null;
	councilVerdict?: string | null;
	routeClass?: string | null;
	executionRouteClass?: string | null;
	selectedCapabilityId?: string | null;
	selectedModelId?: string | null;
	selectedProviderId?: string | null;
	baselineMetric?: number | null;
	observedMetric?: number | null;
	delta?: number | null;
	packedContext?: string | null;
	packedRuntime?: string | null;
	packedSource?: string | null;
	record: Record<string, unknown>;
}

export interface StoredResearchExperiment extends ResearchExperimentRecordInput {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface ListResearchExperimentsOptions {
	projectPath?: string;
	sessionId?: string;
	decision?: string;
	limit?: number;
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

function normalizeRecordForExperimentKey(record: Record<string, unknown>): Record<string, unknown> {
	const normalized: Record<string, unknown> = {};
	const passthroughKeys = [
		"experimentKey",
		"hypothesis",
		"command",
		"commandArgs",
		"cwd",
		"targetFiles",
		"immutableFiles",
		"metricName",
		"objective",
		"sessionId",
		"sabhaId",
		"budgetMs",
	];
	for (const key of passthroughKeys) {
		if (record[key] !== undefined) normalized[key] = record[key];
	}
	return normalized;
}

function buildResearchExperimentId(input: ResearchExperimentRecordInput): string {
	const normalizedProjectPath = normalizeProjectPath(input.projectPath);
	const experimentKey =
		typeof input.experimentKey === "string" && input.experimentKey.trim()
			? input.experimentKey.trim()
			: typeof input.record.experimentKey === "string" && input.record.experimentKey.trim()
				? input.record.experimentKey.trim()
			: JSON.stringify({
				projectPath: normalizedProjectPath,
				topic: input.topic,
				metricName: input.metricName,
				objective: input.objective,
				sessionId: input.sessionId ?? null,
				parentSessionId: input.parentSessionId ?? null,
				sessionLineageKey: input.sessionLineageKey ?? null,
				routeClass: input.routeClass ?? null,
				executionRouteClass: input.executionRouteClass ?? null,
				selectedCapabilityId: input.selectedCapabilityId ?? null,
				record: normalizeRecordForExperimentKey(input.record),
			});
	return crypto
		.createHash("sha256")
		.update(experimentKey)
		.digest("hex")
		.slice(0, 24);
}

function parseStoredRow(row: Record<string, unknown>): StoredResearchExperiment {
	let record: Record<string, unknown> = {};
	try {
		record = row.record_json ? JSON.parse(String(row.record_json)) as Record<string, unknown> : {};
	} catch {
		record = {};
	}
	return {
		id: String(row.id),
		projectPath: String(row.project),
		experimentKey: normalizeOptionalString(row.experiment_key),
		budgetMs: normalizeOptionalNumber(row.budget_ms),
		topic: String(row.topic),
		metricName: String(row.metric_name),
		objective: String(row.objective),
		decision: String(row.decision),
		sessionId: normalizeOptionalString(row.session_id),
		parentSessionId: normalizeOptionalString(row.parent_session_id),
		sessionLineageKey: normalizeOptionalString(row.session_lineage_key),
		sabhaId: normalizeOptionalString(row.sabha_id),
		councilVerdict: normalizeOptionalString(row.council_verdict),
		routeClass: normalizeOptionalString(row.route_class),
		executionRouteClass: normalizeOptionalString(row.execution_route_class),
		selectedCapabilityId: normalizeOptionalString(row.selected_capability_id),
		selectedModelId: normalizeOptionalString(row.selected_model_id),
		selectedProviderId: normalizeOptionalString(row.selected_provider_id),
		baselineMetric: normalizeOptionalNumber(row.baseline_metric),
		observedMetric: normalizeOptionalNumber(row.observed_metric),
		delta: normalizeOptionalNumber(row.delta),
		packedContext: normalizeOptionalString(row.packed_context),
		packedRuntime: normalizeOptionalString(row.packed_runtime),
		packedSource: normalizeOptionalString(row.packed_source),
		record,
		createdAt: Number(row.created_at ?? Date.now()),
		updatedAt: Number(row.updated_at ?? Date.now()),
	};
}

export function upsertResearchExperiment(input: ResearchExperimentRecordInput): StoredResearchExperiment {
	const db = getAgentDb();
	const projectPath = normalizeProjectPath(input.projectPath);
	const id = buildResearchExperimentId(input);
	const now = Date.now();
	db.prepare(`
		INSERT INTO research_experiments (
			id,
			project,
			experiment_key,
			budget_ms,
			session_id,
			parent_session_id,
			session_lineage_key,
			topic,
			metric_name,
			objective,
			baseline_metric,
			observed_metric,
			delta,
			decision,
			sabha_id,
			council_verdict,
			route_class,
			execution_route_class,
			selected_capability_id,
			selected_model_id,
			selected_provider_id,
			packed_context,
			packed_runtime,
			packed_source,
			record_json,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			experiment_key = excluded.experiment_key,
			budget_ms = excluded.budget_ms,
			baseline_metric = excluded.baseline_metric,
			observed_metric = excluded.observed_metric,
			delta = excluded.delta,
			decision = excluded.decision,
			sabha_id = excluded.sabha_id,
			council_verdict = excluded.council_verdict,
			route_class = excluded.route_class,
			execution_route_class = excluded.execution_route_class,
			selected_capability_id = excluded.selected_capability_id,
			selected_model_id = excluded.selected_model_id,
			selected_provider_id = excluded.selected_provider_id,
			packed_context = excluded.packed_context,
			packed_runtime = excluded.packed_runtime,
			packed_source = excluded.packed_source,
			record_json = excluded.record_json,
			updated_at = excluded.updated_at
	`).run(
		id,
		projectPath,
		normalizeOptionalString(input.experimentKey) ?? normalizeOptionalString(input.record.experimentKey) ?? null,
		input.budgetMs ?? null,
		input.sessionId ?? null,
		input.parentSessionId ?? null,
		input.sessionLineageKey ?? null,
		input.topic,
		input.metricName,
		input.objective,
		input.baselineMetric ?? null,
		input.observedMetric ?? null,
		input.delta ?? null,
		input.decision,
		input.sabhaId ?? null,
		input.councilVerdict ?? null,
		input.routeClass ?? null,
		input.executionRouteClass ?? null,
		input.selectedCapabilityId ?? null,
		input.selectedModelId ?? null,
		input.selectedProviderId ?? null,
		input.packedContext ?? null,
		input.packedRuntime ?? null,
		input.packedSource ?? null,
		JSON.stringify(input.record),
		now,
		now,
	);

	const row = db
		.prepare("SELECT * FROM research_experiments WHERE id = ?")
		.get(id) as Record<string, unknown> | undefined;
	if (!row) {
		throw new Error(`Research experiment ${id} was not persisted`);
	}
		return parseStoredRow(row);
}

export function listResearchExperiments(
	options: ListResearchExperimentsOptions = {},
): StoredResearchExperiment[] {
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
	if (options.decision) {
		conditions.push("decision = ?");
		values.push(options.decision);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
		? Math.max(1, Math.trunc(options.limit))
		: 20;
	const rows = db.prepare(
		`SELECT * FROM research_experiments ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ?`,
	).all(...values, limit) as Array<Record<string, unknown>>;

	return rows.map(parseStoredRow);
}
