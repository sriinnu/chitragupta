/**
 * Transcendence — The Precognition Engine: Type Definitions
 *
 * Named after Lucy's 100% cerebral capacity — the ability to perceive
 * all of time simultaneously, predict outcomes before they occur, and
 * transcend the limitations of reactive cognition.
 *
 * Transcendence converts the system from reactive (load context when asked)
 * to predictive (pre-stage context before it's needed). It fuses signals
 * from Natasha (trends), KalaChakra (temporal decay), and Vasana (behavioral
 * patterns) to build a prediction model of future context needs.
 *
 * Research basis:
 * - Neural Paging (ArXiv 2603.02228): Predictive memory page pre-loading
 * - MEM1 (ArXiv 2506.15841): Anticipatory context staging
 * - Codified Context (ArXiv 2602.20478): Context quality > quantity
 * - MemWeaver (ArXiv 2601.18204): Three-tier memory with prefetch
 *
 * @module transcendence-types
 */

import type { TrendSignal, TrendWindow } from "./natasha-types.js";

// ─── Prediction Signals ─────────────────────────────────────────────────────

/** Source of a prediction signal. */
export type PredictionSource =
	| "trend"       // From NatashaObserver rising entities
	| "temporal"    // From time-of-day/day-of-week patterns
	| "continuation" // From interrupted/recent session analysis
	| "behavioral"  // From Vasana behavioral tendencies
	| "regression"  // From Natasha regression alerts
	| "cooccurrence"; // From entity co-occurrence in past sessions

/** A single prediction of future context need. */
export interface ContextPrediction {
	/** The entity, topic, or query predicted to be needed. */
	entity: string;
	/** Confidence in this prediction (0-1). */
	confidence: number;
	/** What signal drove this prediction. */
	source: PredictionSource;
	/** Supporting evidence (trend signal, pattern, etc). */
	evidence: string;
	/** When this prediction was generated (ISO timestamp). */
	predictedAt: string;
	/** Time window the prediction is valid for. */
	validWindow: TrendWindow;
}

/** A cached context block ready for instant delivery. */
export interface CachedContext {
	/** The entity/topic this context is for. */
	entity: string;
	/** Pre-assembled context string. */
	content: string;
	/** When this cache entry was created (ISO timestamp). */
	cachedAt: string;
	/** When this cache entry expires (ISO timestamp). */
	expiresAt: string;
	/** How this was predicted. */
	source: PredictionSource;
	/** Whether this was served to a user (for hit rate tracking). */
	wasHit: boolean;
}

// ─── Prefetch Result ────────────────────────────────────────────────────────

/** Result of a prefetch cycle. */
export interface PrefetchResult {
	/** Predictions generated this cycle. */
	predictions: ContextPrediction[];
	/** Number of new cache entries written. */
	cachedCount: number;
	/** Number of stale entries evicted. */
	evictedCount: number;
	/** Total cache size after this cycle. */
	cacheSize: number;
	/** Duration of this prefetch cycle in ms. */
	durationMs: number;
	/** When this cycle ran (ISO timestamp). */
	cycleAt: string;
}

/** Cache hit/miss statistics. */
export interface CacheStats {
	/** Total cache lookups. */
	totalLookups: number;
	/** Cache hits (prediction matched actual need). */
	hits: number;
	/** Cache misses. */
	misses: number;
	/** Hit rate (0-1). */
	hitRate: number;
	/** Current cache entries. */
	cacheSize: number;
	/** Total prefetch cycles run. */
	cyclesRun: number;
	/** Average predictions per cycle. */
	avgPredictions: number;
}

// ─── Temporal Pattern ───────────────────────────────────────────────────────

/** Time-of-day activity pattern. */
export interface TemporalPattern {
	/** Hour of day (0-23). */
	hour: number;
	/** Day of week (0=Sunday, 6=Saturday). */
	dayOfWeek: number;
	/** Entities frequently accessed in this time slot. */
	entities: string[];
	/** Number of observations backing this pattern. */
	observations: number;
}

// ─── Co-occurrence ──────────────────────────────────────────────────────────

/** Entity co-occurrence pair — when A appears, B often follows. */
export interface CoOccurrence {
	/** Primary entity. */
	entityA: string;
	/** Co-occurring entity. */
	entityB: string;
	/** How often B appears when A does (0-1). */
	probability: number;
	/** Number of co-occurrences observed. */
	count: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Transcendence engine configuration. */
export interface TranscendenceConfig {
	/** Max predictions per cycle. Default: 10. */
	maxPredictions: number;
	/** Min confidence to cache a prediction. Default: 0.4. */
	minCacheConfidence: number;
	/** Cache TTL in ms. Default: 300_000 (5 min). */
	cacheTtlMs: number;
	/** Max cache entries. Default: 50. */
	maxCacheEntries: number;
	/** Min trend confidence to use as signal. Default: 0.3. */
	minTrendConfidence: number;
	/** Min co-occurrence probability to use. Default: 0.3. */
	minCoOccurrence: number;
	/** Weight for trend signals (0-1). Default: 0.35. */
	trendWeight: number;
	/** Weight for temporal pattern signals (0-1). Default: 0.25. */
	temporalWeight: number;
	/** Weight for continuation signals (0-1). Default: 0.25. */
	continuationWeight: number;
	/** Weight for behavioral signals (0-1). Default: 0.15. */
	behavioralWeight: number;
}

/** Default Transcendence configuration. */
export const DEFAULT_TRANSCENDENCE_CONFIG: Readonly<TranscendenceConfig> = {
	maxPredictions: 10,
	minCacheConfidence: 0.4,
	cacheTtlMs: 300_000,
	maxCacheEntries: 50,
	minTrendConfidence: 0.3,
	minCoOccurrence: 0.3,
	trendWeight: 0.35,
	temporalWeight: 0.25,
	continuationWeight: 0.25,
	behavioralWeight: 0.15,
} as const;

// ─── Database Types ─────────────────────────────────────────────────────────

/** Duck-typed DB interface for Transcendence queries. */
export interface TranscendenceDb {
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
	};
}

/** Row shape for session entity queries. */
export interface SessionEntityRow {
	entity: string;
	session_id: string;
	hour: number;
	day_of_week: number;
}

/** Row shape for co-occurrence queries. */
export interface CoOccurrenceRow {
	entity_a: string;
	entity_b: string;
	cnt: number;
}
