import type { AgentDb, BindingNotification } from "./services-binding-types.js";
import { buildState, clamp, parseJsonArray, parseState } from "./services-binding-types.js";

const ERROR_WINDOW_MS = 5 * 60 * 1000;
const RECENT_DAY_MS = 24 * 60 * 60 * 1000;

export function upsertPattern(
	db: AgentDb,
	type: string,
	patternPayload: Record<string, unknown>,
	confidence: number,
	occurrences: number,
	now: number,
): void {
	const pattern = JSON.stringify(patternPayload);
	db.prepare(`
		INSERT INTO detected_patterns (type, pattern, confidence, occurrences, first_seen, last_seen)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(type, pattern) DO UPDATE SET
			confidence = excluded.confidence,
			occurrences = excluded.occurrences,
			last_seen = excluded.last_seen
	`).run(type, pattern, confidence, occurrences, now, now);
}

export function upsertPreference(
	db: AgentDb,
	key: string,
	value: string,
	confidence: number,
	frequency: number,
	now: number,
): void {
	db.prepare(`
		INSERT INTO preferences (key, value, confidence, frequency, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			confidence = excluded.confidence,
			frequency = preferences.frequency + excluded.frequency,
			updated_at = excluded.updated_at
	`).run(key, value, confidence, frequency, now);
}

function getLastState(db: AgentDb, sessionId: string): string | null {
	const row = db.prepare(`
		SELECT tool
		FROM tool_usage
		WHERE session_id = ?
		ORDER BY timestamp DESC, id DESC
		LIMIT 1
	`).get(sessionId) as { tool?: string } | undefined;
	return row?.tool ? buildState(row.tool) : null;
}

function updateTransition(db: AgentDb, fromState: string, toState: string): number {
	db.prepare(`
		INSERT INTO markov_transitions (from_state, to_state, count)
		VALUES (?, ?, 1)
		ON CONFLICT(from_state, to_state) DO UPDATE SET
			count = markov_transitions.count + 1
	`).run(fromState, toState);
	const row = db.prepare(`
		SELECT count FROM markov_transitions
		WHERE from_state = ? AND to_state = ?
	`).get(fromState, toState) as { count: number } | undefined;
	return row?.count ?? 1;
}

export function detectErrorHotspot(db: AgentDb, tool: string, now: number): BindingNotification | null {
	const row = db.prepare(`
		SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors
		FROM tool_usage
		WHERE tool = ? AND timestamp >= ?
	`).get(tool, now - ERROR_WINDOW_MS) as { total?: number; errors?: number } | undefined;
	const total = Number(row?.total ?? 0);
	const errors = Number(row?.errors ?? 0);
	if (total < 3 || errors === 0) return null;
	const errorRate = errors / total;
	if (errorRate < 0.3) return null;
	const severity = errorRate >= 0.6 ? "critical" : "warning";
	const pattern = { tool, errorRate, errors, total, severity };
	upsertPattern(db, "error_hotspot", pattern, clamp(errorRate), total, now);
	return {
		method: "anomaly_alert",
		params: {
			type: "error_spike",
			severity,
			details: pattern,
			suggestion: `Investigate repeated ${tool} failures before continuing`,
		},
	};
}

export function predictFromState(db: AgentDb, currentTool?: string, currentFile?: string): Array<Record<string, unknown>> {
	if (!currentTool) return [];
	const states = [buildState(currentTool, currentFile), buildState(currentTool)];
	const rows = db.prepare(`
		SELECT from_state, to_state, count
		FROM markov_transitions
		WHERE from_state IN (?, ?)
		ORDER BY count DESC
		LIMIT 5
	`).all(states[0], states[1]) as Array<{ from_state: string; to_state: string; count: number }>;
	if (rows.length === 0) return [];
	const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
	return rows.map((row) => {
		const next = parseState(row.to_state);
		return {
			type: "next_action",
			action: next.tool,
			file: next.file,
			confidence: clamp(row.count / total),
			reasoning: `Observed ${row.count} transition(s) from ${row.from_state}`,
		};
	});
}

export function likelyFiles(db: AgentDb, currentFile?: string): Array<{ file: string; confidence: number }> {
	if (!currentFile) return [];
	const rows = db.prepare(`
		SELECT files, co_edited
		FROM edit_patterns
		ORDER BY timestamp DESC
		LIMIT 50
	`).all() as Array<{ files?: string; co_edited?: string }>;
	const counts = new Map<string, number>();
	for (const row of rows) {
		const files = parseJsonArray(row.files);
		if (!files.includes(currentFile)) continue;
		for (const candidate of [...parseJsonArray(row.co_edited), ...files]) {
			if (!candidate || candidate === currentFile) continue;
			counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
		}
	}
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0) || 1;
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([file, count]) => ({ file, confidence: clamp(count / total) }));
}

export function failureWarning(db: AgentDb, currentTool?: string, now = Date.now()): Record<string, unknown> | null {
	if (!currentTool) return null;
	const row = db.prepare(`
		SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors
		FROM tool_usage
		WHERE tool = ? AND timestamp >= ?
	`).get(currentTool, now - RECENT_DAY_MS) as { total?: number; errors?: number } | undefined;
	const total = Number(row?.total ?? 0);
	const errors = Number(row?.errors ?? 0);
	if (total < 3 || errors === 0) return null;
	const risk = errors / total;
	if (risk < 0.3) return null;
	return {
		type: "failure_warning",
		tool: currentTool,
		risk,
		pastFailures: errors,
		suggestion: `Recent failure rate for ${currentTool} is ${(risk * 100).toFixed(0)}%`,
	};
}

export function detectLoopAnomalies(db: AgentDb, now: number): Array<Record<string, unknown>> {
	const rows = db.prepare(`
		SELECT session_id, tool, COALESCE(args_hash, '') AS args_hash, COUNT(*) AS count
		FROM tool_usage
		WHERE timestamp >= ?
		GROUP BY session_id, tool, COALESCE(args_hash, '')
		HAVING COUNT(*) >= 3
		ORDER BY count DESC
		LIMIT 5
	`).all(now - ERROR_WINDOW_MS) as Array<{ session_id: string; tool: string; args_hash: string; count: number }>;
	return rows.map((row) => ({
		type: "loop_detected",
		severity: row.count >= 5 ? "critical" : "warning",
		details: {
			sessionId: row.session_id,
			tool: row.tool,
			argsHash: row.args_hash || undefined,
			count: row.count,
		},
		suggestion: "Abort or re-plan before repeating the same action again",
	}));
}

export function costTrajectory(db: AgentDb, now: number): Record<string, unknown> {
	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);
	const startMs = startOfToday.getTime();
	const currentCostRow = db.prepare(`
		SELECT COALESCE(SUM(cost), 0) AS total
		FROM sessions
		WHERE updated_at >= ?
	`).get(startMs) as { total?: number } | undefined;
	const recentRows = db.prepare(`
		SELECT DATE(updated_at / 1000, 'unixepoch') AS day, COALESCE(SUM(cost), 0) AS total
		FROM sessions
		WHERE updated_at >= ?
		  AND updated_at < ?
		GROUP BY DATE(updated_at / 1000, 'unixepoch')
	`).all(startMs - (7 * RECENT_DAY_MS), startMs) as Array<{ total?: number }>;
	const currentCost = Number(currentCostRow?.total ?? 0);
	const dailyAvg = recentRows.length > 0
		? recentRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0) / recentRows.length
		: 0;
	return {
		currentCost,
		dailyAvg,
		projectedCost: currentCost,
		aboveNormal: dailyAvg > 0 ? currentCost > dailyAvg * 2 : false,
	};
}

export function updateSessionTransition(
	db: AgentDb,
	lastStateBySession: Map<string, string | null>,
	sessionId: string,
	currentState: string,
): { previousState: string | null; count: number | null } {
	const previousState = lastStateBySession.get(sessionId) ?? getLastState(db, sessionId);
	lastStateBySession.set(sessionId, currentState);
	if (!previousState || previousState === currentState) {
		return { previousState, count: null };
	}
	return { previousState, count: updateTransition(db, previousState, currentState) };
}
