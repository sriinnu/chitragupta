import type { RpcRouter } from "./rpc-router.js";
import { normalizeParams, parseLimit } from "./services-helpers.js";
import {
	costTrajectory,
	detectLoopAnomalies,
	failureWarning,
	likelyFiles,
	predictFromState,
	upsertPattern,
	upsertPreference,
} from "./services-binding-analytics.js";
import {
	clamp,
	emitNotifications,
	getAgentDb,
	resolveClientId,
	targetClient,
	type BindingNotification,
} from "./services-binding-types.js";

const ERROR_WINDOW_MS = 5 * 60 * 1000;

export function registerBindingQueryMethods(router: RpcRouter): void {
	router.register("pattern.query", async (rawParams, context) => {
		const params = normalizeParams(rawParams);
		const db = getAgentDb();
		const limit = parseLimit(params.limit, 10, 100);
		const type = typeof params.type === "string" ? params.type : undefined;
		const minConfidence = Number.isFinite(Number(params.minConfidence)) ? Number(params.minConfidence) : 0;
		const clientId = resolveClientId(params, context);
		const rows = type
			? db.prepare(`
				SELECT id, type, pattern, confidence, occurrences, first_seen, last_seen
				FROM detected_patterns
				WHERE type = ? AND confidence >= ?
				ORDER BY confidence DESC, last_seen DESC
				LIMIT ?
			`).all(type, minConfidence, limit)
			: db.prepare(`
				SELECT id, type, pattern, confidence, occurrences, first_seen, last_seen
				FROM detected_patterns
				WHERE confidence >= ?
				ORDER BY confidence DESC, last_seen DESC
				LIMIT ?
			`).all(minConfidence, limit);
		return {
			patterns: (rows as Array<Record<string, unknown>>).map((row) => ({
				...row,
				pattern: typeof row.pattern === "string" ? JSON.parse(String(row.pattern)) : row.pattern,
			})),
			livePatterns: router.getPatternSummaries(limit, clientId),
			clientId: clientId ?? null,
		};
	}, "Query detected runtime patterns");

	router.register("predict.next", async (rawParams, context) => {
		const params = normalizeParams(rawParams);
		const db = getAgentDb();
		let currentTool = typeof params.currentTool === "string" ? params.currentTool : undefined;
		const currentFile = typeof params.currentFile === "string" ? params.currentFile : undefined;
		const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
		const clientId = resolveClientId(params, context);
		const limit = parseLimit(params.limit, 5, 20);
		if (!currentTool && sessionId) {
			const row = db.prepare(`
				SELECT tool FROM tool_usage
				WHERE session_id = ?
				ORDER BY timestamp DESC, id DESC
				LIMIT 1
			`).get(sessionId) as { tool?: string } | undefined;
			currentTool = row?.tool;
		}
		const predictions = predictFromState(db, currentTool, currentFile);
		const files = likelyFiles(db, currentFile);
		if (files.length > 0) predictions.push({ type: "likely_files", files });
		const warning = failureWarning(db, currentTool);
		if (warning) predictions.push(warning);
		return {
			predictions,
			clientId: clientId ?? null,
			liveSignals: router.getPatternSummaries(Math.min(limit, 5), clientId),
		};
	}, "Predict likely next actions/files/failure risk");

	router.register("client.identify", async (rawParams, context) => {
		const params = normalizeParams(rawParams);
		const clientId = resolveClientId(params, context);
		if (!clientId) throw new Error("No client context");
		const patch: Record<string, unknown> = {};
		if (typeof params.pid === "number") patch.pid = params.pid;
		if (typeof params.provider === "string") patch.provider = params.provider;
		if (typeof params.workspace === "string") patch.workspace = params.workspace;
		if (typeof params.agent === "string") patch.agent = params.agent;
		const snap = router.updateClientPreferences(clientId, patch);
		return { ok: true, clientId, preferences: snap.preferences };
	}, "Register client identity (PID, provider, workspace) on the socket connection");

	router.register("health.status", async () => {
		const db = getAgentDb();
		const now = Date.now();
		const row = db.prepare(`
			SELECT COUNT(*) AS total, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors
			FROM tool_usage
			WHERE timestamp >= ?
		`).get(now - ERROR_WINDOW_MS) as { total?: number; errors?: number } | undefined;
		const total = Number(row?.total ?? 0);
		const errors = Number(row?.errors ?? 0);
		const errorRate = total > 0 ? errors / total : 0;
		const anomalies: Array<Record<string, unknown>> = [];
		if (total >= 3 && errorRate >= 0.3) {
			anomalies.push({
				type: "error_spike",
				severity: errorRate >= 0.6 ? "critical" : "warning",
				details: { total, errors, errorRate },
				suggestion: "Inspect recent tool failures and consider a model/tool switch",
			});
		}
		anomalies.push(...detectLoopAnomalies(db, now));
		const trajectory = costTrajectory(db, now);
		if (trajectory.aboveNormal) {
			anomalies.push({
				type: "cost_trajectory",
				severity: "warning",
				details: trajectory,
				suggestion: "Review current session cost before continuing",
			});
		}
		const runtime = router.getRuntimeState();
		const memory = process.memoryUsage();
		const methods = router.listMethods().length;
		return {
			status: anomalies.length > 0 ? "attention" : "ok",
			errorRate,
			anomalies,
			costTrajectory: trajectory,
			memory,
			methods,
			daemon: {
				alive: true,
				pid: process.pid,
				uptime: Math.floor((now - runtime.startedAt) / 1000),
				memory,
				methods,
				serverPush: runtime.hasNotifier,
				connections: runtime.connectionCount,
			},
			clients: {
				connected: runtime.connectionCount,
				tracked: runtime.trackedClients.length,
				items: runtime.trackedClients,
			},
			live: {
				observations: runtime.observations.length,
				patterns: runtime.patterns,
			},
			timestamp: now,
		};
	}, "Current error/anomaly/cost health for the binding");

	router.register("heal.report", async (rawParams, context) => {
		const params = normalizeParams(rawParams);
		const anomalyType = String(params.anomalyType ?? "").trim();
		const actionTaken = String(params.actionTaken ?? "").trim();
		const outcome = String(params.outcome ?? "").trim().toLowerCase();
		const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
		const clientId = resolveClientId(params, context);
		if (!anomalyType || !actionTaken || !outcome) throw new Error("Missing anomalyType, actionTaken, or outcome");
		const db = getAgentDb();
		const now = Number.isFinite(Number(params.timestamp)) ? Math.trunc(Number(params.timestamp)) : Date.now();
		db.prepare(`
			INSERT INTO heal_outcomes (anomaly_type, action_taken, outcome, session_id, timestamp)
			VALUES (?, ?, ?, ?, ?)
		`).run(anomalyType, actionTaken, outcome, sessionId ?? null, now);
		const row = db.prepare(`
			SELECT
				COUNT(*) AS sample_count,
				SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success_count
			FROM heal_outcomes
			WHERE anomaly_type = ? AND action_taken = ?
		`).get(anomalyType, actionTaken) as { sample_count?: number; success_count?: number } | undefined;
		const sampleCount = Number(row?.sample_count ?? 0);
		const successRate = sampleCount > 0 ? Number(row?.success_count ?? 0) / sampleCount : 0;
		const notificationsSent = router.notify("heal_reported", {
			clientId: clientId ?? null,
			anomalyType,
			actionTaken,
			outcome,
			successRate,
			sampleCount,
		}, targetClient(clientId));
		return { recorded: true, clientId: clientId ?? null, sampleCount, successRate, notificationsSent };
	}, "Record outcome of a healing action");

	router.register("preference.update", async (rawParams, context) => {
		const params = normalizeParams(rawParams);
		const key = String(params.key ?? "").trim();
		const value = String(params.value ?? "").trim();
		if (!key || !value) throw new Error("Missing key or value");
		const confidence = clamp(Number(params.confidence ?? 0.7));
		const source = typeof params.source === "string" ? params.source : "preference.update";
		const now = Number.isFinite(Number(params.timestamp)) ? Math.trunc(Number(params.timestamp)) : Date.now();
		const clientId = resolveClientId(params, context);
		const db = getAgentDb();
		upsertPreference(db, key, value, confidence, 1, now);
		upsertPattern(db, "style_preference", { key, value }, confidence, 1, now);
		const preferences = clientId
			? router.updateClientPreferences(clientId, { [key]: value }).preferences
			: null;
		const notifications: BindingNotification[] = confidence >= 0.7
			? [{
				method: "preference_update",
				params: {
					clientId: clientId ?? null,
					key,
					value,
					confidence,
					source,
				},
			}]
			: [];
		return {
			stored: true,
			clientId: clientId ?? null,
			preferences,
			notificationsSent: emitNotifications(router, notifications, targetClient(clientId)),
		};
	}, "Store a learned preference and optionally push it to clients");
}
