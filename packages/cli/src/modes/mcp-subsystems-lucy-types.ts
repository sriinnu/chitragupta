import type { AkashaFieldLike, SkillRegistryLike, UIExtensionRegistryLike } from "./mcp-subsystems-types.js";

export interface NatashaObserverLike {
	detectTrends(window: string, now?: number): unknown[];
	detectRegressions(window: string, now?: number): unknown[];
	measureVelocity(window: string, now?: number): unknown;
	observe(now?: number): unknown;
}

export interface TranscendenceEngineLike {
	ingestTrends(trends: unknown[]): void;
	ingestRegressions(regressions: unknown[]): void;
	prefetch(now?: number): unknown;
	lookup(entity: string, now?: number): unknown;
	fuzzyLookup(query: string, now?: number): unknown;
	getStats(): unknown;
	getPredictions(): unknown[];
}

export interface DurableAkashaRef {
	restore(db: unknown): void;
	persist(db: unknown): void;
}

export interface DaemonAkashaProxy extends AkashaFieldLike {
	__daemonProxy: true;
}

export interface SharedRegressionSignal {
	errorSignature: string;
	description: string;
	currentOccurrences: number;
	previousOccurrences: number;
	severity: "info" | "warning" | "critical";
	lastSeenBefore: string;
	detectedAt: string;
}

export interface DaemonAnomalyAlert {
	type?: unknown;
	severity?: unknown;
	details?: unknown;
	suggestion?: unknown;
}

export interface DaemonHealReport {
	anomalyType?: unknown;
	actionTaken?: unknown;
	outcome?: unknown;
	entity?: unknown;
}

export interface FreshContextOptions {
	noCache?: boolean;
	fresh?: boolean;
	project?: string;
}

export interface TranscendencePrediction {
	entity: string;
	content: string;
	source: string;
}

export interface SkillBootstrapDeps {
	registry: SkillRegistryLike;
	getUiExtensionRegistryBestEffort: () => Promise<UIExtensionRegistryLike | null>;
}
