/**
 * Shared live Lucy/Scarlett state inside the daemon.
 *
 * Scarlett pushes live regression/heal signals here, and daemon read APIs
 * consume the same Transcendence instance for intuition context generation.
 */

import { DatabaseManager, TranscendenceEngine } from "@chitragupta/smriti";
import { normalizeProjectPath } from "./services-helpers.js";

export interface SharedRegressionSignal {
	errorSignature: string;
	description: string;
	currentOccurrences: number;
	previousOccurrences: number;
	severity: "info" | "warning" | "critical";
	lastSeenBefore: string;
	detectedAt: string;
	scope?: "global" | "project";
	project?: string;
}

export interface LivePrediction {
	entity: string;
	confidence: number;
	source: string;
}

export interface LiveHit {
	entity: string;
	content: string;
	source: string;
}

interface TranscendenceRef {
	ingestRegressions(alerts: SharedRegressionSignal[]): void;
	prefetch(): { predictions?: Array<{ entity?: string; confidence?: number; source?: string }> };
	fuzzyLookup(value: string): { entity?: string; content?: string; source?: string } | null;
	reset?(): void;
}

export interface LucyLiveScope {
	project?: string;
}

interface ScopeState {
	liveSignals: Map<string, SharedRegressionSignal>;
	healedAtByEntity: Map<string, number>;
	engine: TranscendenceRef | null;
}

const LIVE_SIGNAL_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_SCOPE_KEY = "global";
const PROJECT_SCOPED_ENGINE_CONFIG = {
	trendWeight: 0,
	temporalWeight: 0,
	continuationWeight: 0,
	behavioralWeight: 0,
};
const scopeStates = new Map<string, ScopeState>();

function normalizeScope(scope?: LucyLiveScope): { key: string; project?: string } {
	const project = normalizeProjectPath(scope?.project ?? "");
	if (!project) return { key: GLOBAL_SCOPE_KEY };
	return { key: `project:${project}`, project };
}

function signalScopeKey(signal: Pick<SharedRegressionSignal, "scope" | "project">): string {
	if (signal.scope === "project" && signal.project) {
		return normalizeScope({ project: signal.project }).key;
	}
	return GLOBAL_SCOPE_KEY;
}

function signalMergeKey(signal: Pick<SharedRegressionSignal, "errorSignature" | "scope" | "project">): string {
	return `${signalScopeKey(signal)}::${signal.errorSignature}`;
}

function getVisibleScopeKeys(scopeKey: string): string[] {
	return scopeKey === GLOBAL_SCOPE_KEY ? [GLOBAL_SCOPE_KEY] : [GLOBAL_SCOPE_KEY, scopeKey];
}

function ensureScopeState(scopeKey: string): ScopeState {
	let state = scopeStates.get(scopeKey);
	if (!state) {
		state = {
			liveSignals: new Map(),
			healedAtByEntity: new Map(),
			engine: null,
		};
		scopeStates.set(scopeKey, state);
	}
	return state;
}

function getEngine(scopeKey: string): TranscendenceRef {
	const state = ensureScopeState(scopeKey);
	if (!state.engine) {
		const db = DatabaseManager.instance().get("agent");
		state.engine = new TranscendenceEngine(
			db,
			scopeKey === GLOBAL_SCOPE_KEY ? undefined : PROJECT_SCOPED_ENGINE_CONFIG,
		) as unknown as TranscendenceRef;
	}
	return state.engine;
}

export function getLucyLiveEngine(scope?: LucyLiveScope): TranscendenceRef {
	return getEngine(normalizeScope(scope).key);
}

function pruneScopeState(state: ScopeState, now = Date.now()): void {
	for (const [entity, healedAt] of [...state.healedAtByEntity.entries()]) {
		if (now - healedAt > LIVE_SIGNAL_WINDOW_MS) state.healedAtByEntity.delete(entity);
	}
	for (const [entity, signal] of [...state.liveSignals.entries()]) {
		const detectedAt = Date.parse(signal.detectedAt) || now;
		if (now - detectedAt > LIVE_SIGNAL_WINDOW_MS) state.liveSignals.delete(entity);
	}
}

function choosePreferredSignal(
	current: SharedRegressionSignal | undefined,
	candidate: SharedRegressionSignal,
	scopeKey: string,
): SharedRegressionSignal {
	if (!current) return candidate;
	const currentScope = signalScopeKey(current);
	const candidateScope = signalScopeKey(candidate);
	const currentPriority = currentScope === scopeKey ? 2 : currentScope === GLOBAL_SCOPE_KEY ? 1 : 0;
	const candidatePriority = candidateScope === scopeKey ? 2 : candidateScope === GLOBAL_SCOPE_KEY ? 1 : 0;
	if (candidatePriority !== currentPriority) {
		return candidatePriority > currentPriority ? candidate : current;
	}
	const currentDetectedAt = Date.parse(current.detectedAt) || 0;
	const candidateDetectedAt = Date.parse(candidate.detectedAt) || 0;
	return candidateDetectedAt >= currentDetectedAt ? candidate : current;
}

function mergeSignals(
	persistedSignals: SharedRegressionSignal[],
	scope: LucyLiveScope | undefined,
	now = Date.now(),
): SharedRegressionSignal[] {
	const { key } = normalizeScope(scope);
	const visibleScopeKeys = getVisibleScopeKeys(key);
	const mergedByScope = new Map<string, SharedRegressionSignal>();
	for (const signal of persistedSignals) {
		mergedByScope.set(signalMergeKey(signal), signal);
	}
	for (const scopeKey of visibleScopeKeys) {
		const state = scopeStates.get(scopeKey);
		if (!state) continue;
		pruneScopeState(state, now);
		for (const signal of state.liveSignals.values()) {
			mergedByScope.set(signalMergeKey(signal), signal);
		}
	}

	for (const scopeKey of visibleScopeKeys) {
		const state = scopeStates.get(scopeKey);
		if (!state) continue;
		for (const [entity, healedAt] of state.healedAtByEntity.entries()) {
			const signal = mergedByScope.get(`${scopeKey}::${entity}`);
			if (!signal) continue;
			const detectedAt = Date.parse(signal.detectedAt) || 0;
			if (healedAt >= detectedAt) mergedByScope.delete(`${scopeKey}::${entity}`);
		}
	}

	const collapsed = new Map<string, SharedRegressionSignal>();
	for (const signal of mergedByScope.values()) {
		const existing = collapsed.get(signal.errorSignature);
		collapsed.set(signal.errorSignature, choosePreferredSignal(existing, signal, key));
	}
	return [...collapsed.values()];
}

function syncEngine(
	persistedSignals: SharedRegressionSignal[],
	scope: LucyLiveScope | undefined,
): SharedRegressionSignal[] {
	const merged = mergeSignals(persistedSignals, scope);
	const engine = getEngine(normalizeScope(scope).key);
	if (merged.length === 0) {
		engine.reset?.();
		return [];
	}
	engine.ingestRegressions(merged);
	return merged;
}

export function recordLiveRegressionSignal(signal: SharedRegressionSignal, scope?: LucyLiveScope): void {
	const normalizedScope = normalizeScope(scope ?? (signal.scope === "project" ? { project: signal.project } : undefined));
	const state = ensureScopeState(normalizedScope.key);
	const scopedSignal: SharedRegressionSignal = normalizedScope.project
		? { ...signal, scope: "project", project: normalizedScope.project }
		: { ...signal, scope: "global", project: undefined };
	state.healedAtByEntity.delete(scopedSignal.errorSignature);
	state.liveSignals.set(scopedSignal.errorSignature, scopedSignal);
}

export function clearLiveRegressionEntity(entity: string, scope?: LucyLiveScope): void {
	const normalizedScope = normalizeScope(scope);
	const state = ensureScopeState(normalizedScope.key);
	state.liveSignals.delete(entity);
	state.healedAtByEntity.set(entity, Date.now());
}

export function computeLucyLiveContext(
	query: string | undefined,
	limit: number,
	persistedSignals: SharedRegressionSignal[],
	scope?: LucyLiveScope,
): {
	predictions: LivePrediction[];
	hit: LiveHit | null;
	liveSignals: SharedRegressionSignal[];
} {
	const mergedSignals = syncEngine(persistedSignals, scope);
	const engine = getEngine(normalizeScope(scope).key);
	const prefetched = engine.prefetch();
	const predictions = Array.isArray(prefetched.predictions)
		? prefetched.predictions
				.filter((prediction): prediction is { entity: string; confidence: number; source: string } =>
					typeof prediction?.entity === "string" &&
					typeof prediction?.confidence === "number" &&
					prediction.confidence > 0 &&
					typeof prediction?.source === "string",
				)
				.slice(0, limit)
		: [];
	const hit = query ? engine.fuzzyLookup(query) : null;

	return {
		predictions,
		hit: hit && typeof hit.content === "string" && typeof hit.source === "string"
			? {
				entity: typeof hit.entity === "string" ? hit.entity : query ?? "",
				content: hit.content,
				source: hit.source,
			}
			: null,
		liveSignals: mergedSignals,
	};
}
