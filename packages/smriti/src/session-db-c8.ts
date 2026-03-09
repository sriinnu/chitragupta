import { getAgentDb } from "./session-db.js";
import type {
	DetectedPatternInput,
	DetectedPatternRow,
	EditPatternObservation,
	ErrorResolutionObservation,
	HealOutcome,
	HealReportInput,
	NextStatePrediction,
	ObservationBatchResult,
	ObservationEvent,
	PatternQueryOptions,
	PreferenceObservation,
	PredictNextOptions,
	ToolUsageObservation,
	UserCorrectionObservation,
} from "./session-db-c8-types.js";
export type {
	DetectedPatternInput,
	DetectedPatternRow,
	EditPatternObservation,
	ErrorResolutionObservation,
	HealOutcome,
	HealReportInput,
	NextStatePrediction,
	ObservationBatchResult,
	ObservationEvent,
	PatternQueryOptions,
	PreferenceObservation,
	PredictNextOptions,
	ToolUsageObservation,
	UserCorrectionObservation,
} from "./session-db-c8-types.js";

function normalizeTimestamp(ts: unknown): number {
	if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
		return Math.trunc(ts);
	}
	return Date.now();
}

function clampConfidence(value: unknown, fallback = 0.5): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function normalizeFrequency(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 1;
	return Math.max(1, Math.trunc(value));
}

function normalizeState(tool: string, currentFile?: string): string {
	const file = typeof currentFile === "string" && currentFile.trim() ? currentFile.trim() : "-";
	return `${tool}:${file}`;
}

function parseState(state: string): { tool: string; file: string | null } {
	const idx = state.indexOf(":");
	if (idx === -1) return { tool: state, file: null };
	const tool = state.slice(0, idx);
	const file = state.slice(idx + 1);
	return { tool, file: file === "-" ? null : file };
}

/**
 * Persist a batch of observation events and update Markov transitions from tool usage events.
 * Invalid event shapes are skipped (best-effort ingestion for external clients).
 */
export function recordObservationBatch(events: ObservationEvent[]): ObservationBatchResult {
	if (!Array.isArray(events) || events.length === 0) {
		return { accepted: 0 };
	}

	const db = getAgentDb();
	const insertToolUsage = db.prepare(`
		INSERT INTO tool_usage (session_id, tool, args_hash, duration_ms, success, timestamp)
		VALUES (?, ?, ?, ?, ?, ?)
	`);
	const selectLatestToolForSession = db.prepare(`
		SELECT tool FROM tool_usage
		WHERE session_id = ?
		ORDER BY timestamp DESC, id DESC
		LIMIT 1
	`);
	const upsertMarkovTransition = db.prepare(`
		INSERT INTO markov_transitions (from_state, to_state, count)
		VALUES (?, ?, ?)
		ON CONFLICT(from_state, to_state)
		DO UPDATE SET count = markov_transitions.count + excluded.count
	`);
	const insertErrorResolution = db.prepare(`
		INSERT INTO error_resolutions (session_id, tool, error_msg, resolution, timestamp)
		VALUES (?, ?, ?, ?, ?)
	`);
	const insertEditPattern = db.prepare(`
		INSERT INTO edit_patterns (session_id, files, edit_type, co_edited, timestamp)
		VALUES (?, ?, ?, ?, ?)
	`);
	const insertUserCorrection = db.prepare(`
		INSERT INTO user_corrections (session_id, original_hash, corrected_hash, context, timestamp)
		VALUES (?, ?, ?, ?, ?)
	`);
	const upsertPreferenceStmt = db.prepare(`
		INSERT INTO preferences (key, value, confidence, frequency, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			confidence = excluded.confidence,
			frequency = preferences.frequency + excluded.frequency,
			updated_at = excluded.updated_at
	`);

	const apply = db.transaction((batch: ObservationEvent[]) => {
		let accepted = 0;
		const lastStateBySession = new Map<string, string>();

		for (const event of batch) {
			switch (event.type) {
				case "tool_usage": {
					const sessionId = typeof event.sessionId === "string" ? event.sessionId.trim() : "";
					const tool = typeof event.tool === "string" ? event.tool.trim() : "";
					if (!sessionId || !tool) break;

					const previousState = lastStateBySession.get(sessionId)
						?? (() => {
							const latest = selectLatestToolForSession.get(sessionId) as { tool: string } | undefined;
							return latest?.tool ? normalizeState(latest.tool) : undefined;
						})();

					const durationMs = typeof event.durationMs === "number" && Number.isFinite(event.durationMs) && event.durationMs >= 0
						? Math.trunc(event.durationMs)
						: null;
					const success = typeof event.success === "boolean" ? (event.success ? 1 : 0) : null;
					const argsHash = typeof event.argsHash === "string" ? event.argsHash : null;
					const timestamp = normalizeTimestamp(event.timestamp);
					insertToolUsage.run(sessionId, tool, argsHash, durationMs, success, timestamp);

					const currentState = normalizeState(tool, event.currentFile);
					if (previousState && previousState !== currentState) {
						upsertMarkovTransition.run(previousState, currentState, 1);
					}
					lastStateBySession.set(sessionId, currentState);
					accepted += 1;
					break;
				}
				case "error_resolution": {
					const sessionId = typeof event.sessionId === "string" ? event.sessionId.trim() : "";
					const tool = typeof event.tool === "string" ? event.tool.trim() : "";
					if (!sessionId || !tool) break;
					insertErrorResolution.run(
						sessionId,
						tool,
						typeof event.errorMsg === "string" ? event.errorMsg : null,
						typeof event.resolution === "string" ? event.resolution : null,
						normalizeTimestamp(event.timestamp),
					);
					accepted += 1;
					break;
				}
				case "edit_pattern": {
					const sessionId = typeof event.sessionId === "string" ? event.sessionId.trim() : "";
					if (!sessionId || !Array.isArray(event.files) || event.files.length === 0) break;
					const files = event.files.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
					const coEdited = Array.isArray(event.coEdited)
						? event.coEdited.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
						: [];
					if (files.length === 0) break;
					insertEditPattern.run(
						sessionId,
						JSON.stringify(files),
						typeof event.editType === "string" ? event.editType : null,
						JSON.stringify(coEdited),
						normalizeTimestamp(event.timestamp),
					);
					accepted += 1;
					break;
				}
				case "user_correction": {
					const sessionId = typeof event.sessionId === "string" ? event.sessionId.trim() : "";
					if (!sessionId) break;
					insertUserCorrection.run(
						sessionId,
						typeof event.originalHash === "string" ? event.originalHash : null,
						typeof event.correctedHash === "string" ? event.correctedHash : null,
						typeof event.context === "string" ? event.context : null,
						normalizeTimestamp(event.timestamp),
					);
					accepted += 1;
					break;
				}
				case "preference": {
					const key = typeof event.key === "string" ? event.key.trim() : "";
					const value = typeof event.value === "string" ? event.value : "";
					if (!key || !value) break;
					upsertPreferenceStmt.run(
						key,
						value,
						clampConfidence(event.confidence),
						normalizeFrequency(event.frequency),
						normalizeTimestamp(event.timestamp),
					);
					accepted += 1;
					break;
				}
				default:
					break;
			}
		}

		return accepted;
	});

	return { accepted: apply(events) };
}

/**
 * Upsert a detected pattern row keyed by (type, pattern JSON).
 */
export function upsertDetectedPattern(input: DetectedPatternInput): { recorded: boolean } {
	const type = typeof input.type === "string" ? input.type.trim() : "";
	if (!type) return { recorded: false };

	const db = getAgentDb();
	const patternJson = JSON.stringify(input.pattern ?? null);
	const confidence = clampConfidence(input.confidence);
	const occurrences = normalizeFrequency(input.occurrences);
	const ts = normalizeTimestamp(input.timestamp);

	db.prepare(`
		INSERT INTO detected_patterns (type, pattern, confidence, occurrences, first_seen, last_seen)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(type, pattern) DO UPDATE SET
			confidence = excluded.confidence,
			occurrences = detected_patterns.occurrences + excluded.occurrences,
			last_seen = excluded.last_seen,
			first_seen = COALESCE(detected_patterns.first_seen, excluded.first_seen)
	`).run(type, patternJson, confidence, occurrences, ts, ts);

	return { recorded: true };
}

/**
 * Query detected patterns with optional type/confidence filters.
 */
export function queryDetectedPatterns(options: PatternQueryOptions = {}): DetectedPatternRow[] {
	const db = getAgentDb();
	const clauses: string[] = [];
	const args: Array<string | number> = [];

	if (typeof options.type === "string" && options.type.trim()) {
		clauses.push("type = ?");
		args.push(options.type.trim());
	}
	if (typeof options.minConfidence === "number" && Number.isFinite(options.minConfidence)) {
		clauses.push("confidence >= ?");
		args.push(options.minConfidence);
	}

	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = (() => {
		if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
			return Math.min(100, Math.trunc(options.limit));
		}
		return 10;
	})();

	const rows = db.prepare(`
		SELECT id, type, pattern, confidence, occurrences, first_seen, last_seen
		FROM detected_patterns
		${where}
		ORDER BY confidence DESC, occurrences DESC, last_seen DESC
		LIMIT ?
	`).all(...args, limit) as Array<{
		id: number;
		type: string;
		pattern: string;
		confidence: number;
		occurrences: number;
		first_seen: number | null;
		last_seen: number | null;
	}>;

	return rows.map((row) => {
		let parsedPattern: unknown = row.pattern;
		try {
			parsedPattern = JSON.parse(row.pattern);
		} catch {
			// Keep raw pattern text when JSON parsing fails.
		}
		return {
			id: row.id,
			type: row.type,
			pattern: parsedPattern,
			confidence: row.confidence,
			occurrences: row.occurrences,
			firstSeen: row.first_seen,
			lastSeen: row.last_seen,
		};
	});
}

/**
 * Increment a Markov transition counter.
 */
export function recordMarkovTransition(fromState: string, toState: string, count = 1): boolean {
	const from = fromState.trim();
	const to = toState.trim();
	if (!from || !to) return false;
	const delta = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 1;
	const db = getAgentDb();
	db.prepare(`
		INSERT INTO markov_transitions (from_state, to_state, count)
		VALUES (?, ?, ?)
		ON CONFLICT(from_state, to_state)
		DO UPDATE SET count = markov_transitions.count + excluded.count
	`).run(from, to, delta);
	return true;
}

/**
 * Predict likely next tool/file states from the Markov transition table.
 */
export function predictNextStates(options: PredictNextOptions): NextStatePrediction[] {
	const db = getAgentDb();
	let currentTool = typeof options.currentTool === "string" ? options.currentTool.trim() : "";
	const currentFile = typeof options.currentFile === "string" ? options.currentFile.trim() : undefined;

	if (!currentTool && typeof options.sessionId === "string" && options.sessionId.trim()) {
		const latest = db.prepare(`
			SELECT tool FROM tool_usage
			WHERE session_id = ?
			ORDER BY timestamp DESC, id DESC
			LIMIT 1
		`).get(options.sessionId.trim()) as { tool: string } | undefined;
		currentTool = latest?.tool ?? "";
	}

	if (!currentTool) return [];

	const fromState = normalizeState(currentTool, currentFile);
	const limit = typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
		? Math.min(20, Math.trunc(options.limit))
		: 5;

	const rows = db.prepare(`
		SELECT to_state, count
		FROM markov_transitions
		WHERE from_state = ?
		ORDER BY count DESC
		LIMIT ?
	`).all(fromState, limit) as Array<{ to_state: string; count: number }>;

	const total = rows.reduce((sum, row) => sum + row.count, 0);
	if (total <= 0) return [];

	return rows.map((row) => {
		const parsed = parseState(row.to_state);
		const confidence = row.count / total;
		const target = parsed.file ? `${parsed.tool} @ ${parsed.file}` : parsed.tool;
		return {
			action: target,
			confidence,
			reasoning: `Transition seen ${row.count} time${row.count === 1 ? "" : "s"} from ${fromState}`,
			count: row.count,
		};
	});
}

/**
 * Store a healing outcome report from anomaly handling.
 */
export function recordHealOutcome(input: HealReportInput): boolean {
	const anomalyType = typeof input.anomalyType === "string" ? input.anomalyType.trim() : "";
	const actionTaken = typeof input.actionTaken === "string" ? input.actionTaken.trim() : "";
	const outcome = input.outcome;
	if (!anomalyType || !actionTaken || (outcome !== "success" && outcome !== "partial" && outcome !== "failed")) {
		return false;
	}

	const sessionId = typeof input.sessionId === "string" && input.sessionId.trim()
		? input.sessionId.trim()
		: null;
	getAgentDb().prepare(`
		INSERT INTO heal_outcomes (anomaly_type, action_taken, outcome, session_id, timestamp)
		VALUES (?, ?, ?, ?, ?)
	`).run(anomalyType, actionTaken, outcome, sessionId, normalizeTimestamp(input.timestamp));
	return true;
}

/**
 * Upsert a preference row from explicit preference.update RPC calls.
 */
export function upsertPreference(
	key: string,
	value: string,
	options?: { confidence?: number; frequency?: number; timestamp?: number },
): boolean {
	const normalizedKey = key.trim();
	if (!normalizedKey || !value) return false;

	getAgentDb().prepare(`
		INSERT INTO preferences (key, value, confidence, frequency, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			confidence = excluded.confidence,
			frequency = preferences.frequency + excluded.frequency,
			updated_at = excluded.updated_at
	`).run(
		normalizedKey,
		value,
		clampConfidence(options?.confidence),
		normalizeFrequency(options?.frequency),
		normalizeTimestamp(options?.timestamp),
	);

	return true;
}
