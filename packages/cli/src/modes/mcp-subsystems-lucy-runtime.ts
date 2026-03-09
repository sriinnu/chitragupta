import { allowLocalRuntimeFallback } from "../runtime-daemon-proxies.js";
import type {
	FreshContextOptions,
	NatashaObserverLike,
	SharedRegressionSignal,
	TranscendenceEngineLike,
	TranscendencePrediction,
} from "./mcp-subsystems-lucy-types.js";
import { getAgentDbBestEffort } from "./mcp-subsystems-db.js";
import { buildLiveRegressionSignal } from "./mcp-subsystems-live-signal.js";

const SHARED_TRANSCENDENCE_REFRESH_MS = 5_000;
const SHARED_SIGNAL_WINDOW_MS = 15 * 60 * 1000;
const LIVE_SIGNAL_WINDOW_MS = 15 * 60 * 1000;

let _sharedTranscendenceRefreshAt = 0;
let _daemonScarlettBridgeInit: Promise<void> | undefined;
let _registeredEngine: TranscendenceEngineLike | undefined;
const _liveRegressionSignals = new Map<string, SharedRegressionSignal>();
const _liveHealedSignals = new Map<string, number>();

async function loadSharedRegressionSignals(limit = 12): Promise<SharedRegressionSignal[]> {
	const db = await getAgentDbBestEffort();
	if (!db || typeof db !== "object" || db === null || !("prepare" in db)) return [];

	try {
		const rows = (db as {
			prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>> };
		}).prepare(
			`SELECT topic, content, trace_type, metadata, created_at
			 FROM akasha_traces
			 WHERE agent_id = ?
			   AND created_at >= ?
			 ORDER BY created_at DESC
			 LIMIT ?`,
		).all("scarlett-internal", Date.now() - SHARED_SIGNAL_WINDOW_MS, limit * 4);

		const healedAtByTopic = new Map<string, number>();
		const warnings: SharedRegressionSignal[] = [];
		for (const row of rows) {
			let metadata: Record<string, unknown> = {};
			try {
				metadata = row.metadata ? JSON.parse(String(row.metadata)) as Record<string, unknown> : {};
			} catch {
				metadata = {};
			}
			const createdAt = Number(row.created_at ?? Date.now());
			const topic = String(row.topic ?? "scarlett");
			const traceType = String(row.trace_type ?? "");
			const cleared = metadata.cleared === true || metadata.outcome === "success";
			if (traceType === "correction" && cleared) {
				healedAtByTopic.set(topic, Math.max(healedAtByTopic.get(topic) ?? 0, createdAt));
				continue;
			}
			if (traceType !== "warning") continue;
			const severityValue = String(metadata.severity ?? "warning").toLowerCase();
			const severity = severityValue === "critical" ? "critical" : severityValue === "info" ? "info" : "warning";
			warnings.push({
				errorSignature: topic,
				description: String(row.content ?? ""),
				currentOccurrences: severity === "critical" ? 5 : severity === "warning" ? 3 : 1,
				previousOccurrences: 0,
				severity,
				lastSeenBefore: new Date(Math.max(0, createdAt - 60_000)).toISOString(),
				detectedAt: new Date(createdAt).toISOString(),
			});
		}
		return warnings
			.filter((signal) => (healedAtByTopic.get(signal.errorSignature) ?? 0) < (Date.parse(signal.detectedAt) || 0))
			.slice(0, limit);
	} catch {
		return [];
	}
}

function mergeRegressionSignals(persisted: SharedRegressionSignal[], now = Date.now()): SharedRegressionSignal[] {
	for (const [entity, healedAt] of [..._liveHealedSignals.entries()]) {
		if (now - healedAt > LIVE_SIGNAL_WINDOW_MS) _liveHealedSignals.delete(entity);
	}
	for (const [entity, signal] of [..._liveRegressionSignals.entries()]) {
		const detectedAt = Date.parse(signal.detectedAt) || now;
		if (now - detectedAt > LIVE_SIGNAL_WINDOW_MS) _liveRegressionSignals.delete(entity);
	}

	const merged = new Map<string, SharedRegressionSignal>();
	for (const signal of persisted) merged.set(signal.errorSignature, signal);
	for (const signal of _liveRegressionSignals.values()) merged.set(signal.errorSignature, signal);
	for (const [entity, healedAt] of _liveHealedSignals.entries()) {
		const signal = merged.get(entity);
		if (!signal) continue;
		const detectedAt = Date.parse(signal.detectedAt) || 0;
		if (healedAt >= detectedAt) merged.delete(entity);
	}
	return [...merged.values()];
}

export function registerLiveTranscendenceEngine(engine: TranscendenceEngineLike): void {
	_registeredEngine = engine;
}

export async function refreshTranscendenceFromSharedSignals(
	engine: TranscendenceEngineLike,
	options?: { force?: boolean; prefetch?: boolean },
): Promise<void> {
	const now = Date.now();
	if (!options?.force && !options?.prefetch && now - _sharedTranscendenceRefreshAt < SHARED_TRANSCENDENCE_REFRESH_MS) {
		return;
	}

	const regressions = mergeRegressionSignals(await loadSharedRegressionSignals(), now);
	if (regressions.length === 0) {
		if (typeof (engine as unknown as { reset?: () => void }).reset === "function" && _liveHealedSignals.size > 0) {
			(engine as unknown as { reset(): void }).reset();
		}
		_sharedTranscendenceRefreshAt = now;
		return;
	}

	try {
		if (typeof engine.ingestRegressions === "function") {
			engine.ingestRegressions(regressions);
		}
		if (options?.prefetch && typeof engine.prefetch === "function") {
			engine.prefetch();
		}
		_sharedTranscendenceRefreshAt = now;
	} catch {
		/* best-effort refresh */
	}
}

async function applyLiveScarlettNotification(method: string, params: Record<string, unknown>): Promise<void> {
	if (method === "anomaly_alert") {
		const signal = buildLiveRegressionSignal(params);
		if (!signal) return;
		_liveHealedSignals.delete(signal.errorSignature);
		_liveRegressionSignals.set(signal.errorSignature, signal);
		_sharedTranscendenceRefreshAt = 0;
		if (_registeredEngine) {
			await refreshTranscendenceFromSharedSignals(_registeredEngine, { force: true, prefetch: true });
		}
		return;
	}

	if (method === "heal_reported") {
		const report = params;
		const entity = typeof report.entity === "string" && report.entity.trim()
			? report.entity.trim()
			: typeof report.actionTaken === "string" && report.actionTaken.trim()
				? report.actionTaken.trim()
				: typeof report.anomalyType === "string" && report.anomalyType.trim()
					? report.anomalyType.trim()
					: "";
		if (!entity || String(report.outcome ?? "").toLowerCase() !== "success") return;
		_liveRegressionSignals.delete(entity);
		_liveHealedSignals.set(entity, Date.now());
		_sharedTranscendenceRefreshAt = 0;
		if (_registeredEngine) {
			await refreshTranscendenceFromSharedSignals(_registeredEngine, { force: true, prefetch: true });
		}
	}
}

async function ensureDaemonScarlettBridge(): Promise<void> {
	if (_daemonScarlettBridgeInit) {
		await _daemonScarlettBridgeInit;
		return;
	}
	_daemonScarlettBridgeInit = (async () => {
		try {
			const { onDaemonNotification } = await import("./daemon-bridge.js");
			await Promise.all([
				onDaemonNotification("anomaly_alert", (params) => {
					void applyLiveScarlettNotification("anomaly_alert", (params ?? {}) as Record<string, unknown>);
				}),
				onDaemonNotification("heal_reported", (params) => {
					void applyLiveScarlettNotification("heal_reported", (params ?? {}) as Record<string, unknown>);
				}),
			]);
		} catch {
			// Best-effort: persisted shared signals still provide fallback context.
		}
	})();
	await _daemonScarlettBridgeInit;
}

export async function primeLucyScarlettRuntime(engine?: TranscendenceEngineLike): Promise<void> {
	if (engine) {
		registerLiveTranscendenceEngine(engine);
	}
	await ensureDaemonScarlettBridge();
	if (engine) {
		await refreshTranscendenceFromSharedSignals(engine, { force: true });
	}
}

function isFreshContextRequested(options?: FreshContextOptions): boolean {
	return options?.noCache === true || options?.fresh === true;
}

export async function lookupTranscendenceFuzzy(
	query: string,
	options: FreshContextOptions | undefined,
	getTranscendence: () => Promise<TranscendenceEngineLike>,
): Promise<TranscendencePrediction | null> {
	if (!query.trim() || isFreshContextRequested(options)) {
		return null;
	}

	try {
		const { getLucyLiveContextViaDaemon } = await import("./daemon-bridge.js");
		const live = await getLucyLiveContextViaDaemon(query, { limit: 5, project: options?.project });
		if (live.hit) {
			return live.hit;
		}
	} catch {
		if (!allowLocalRuntimeFallback()) return null;
	}

	try {
		const engine = await getTranscendence();
		await refreshTranscendenceFromSharedSignals(engine, { prefetch: true });
		const hit = engine.fuzzyLookup(query) as Partial<TranscendencePrediction> | null;
		if (!hit || typeof hit.content !== "string" || typeof hit.source !== "string") {
			return null;
		}
		return {
			entity: typeof hit.entity === "string" ? hit.entity : query,
			content: hit.content,
			source: hit.source,
		};
	} catch {
		return null;
	}
}

export async function runTranscendencePrefetch(
	getNatasha: () => Promise<NatashaObserverLike>,
	getTranscendence: () => Promise<TranscendenceEngineLike>,
): Promise<unknown> {
	try {
		const { getLucyLiveContextViaDaemon } = await import("./daemon-bridge.js");
		const live = await getLucyLiveContextViaDaemon(undefined, { limit: 5 });
		return {
			predictions: live.predictions,
			cachedCount: live.predictions.length,
			evictedCount: 0,
			cacheSize: live.predictions.length,
			durationMs: 0,
			cycleAt: new Date().toISOString(),
			mode: "daemon-shared",
		};
	} catch {
		if (!allowLocalRuntimeFallback()) {
			return null;
		}
		try {
			await ensureDaemonScarlettBridge();
			const natasha = await getNatasha();
			const transcendence = await getTranscendence();
			await refreshTranscendenceFromSharedSignals(transcendence, { force: true });
			transcendence.ingestTrends(natasha.detectTrends("day"));
			transcendence.ingestRegressions(natasha.detectRegressions("day"));
			return transcendence.prefetch();
		} catch {
			return null;
		}
	}
}
