/**
 * Transcendence — The Precognition Engine
 *
 * Named after Lucy's 100% cerebral capacity — the ability to perceive
 * all of time simultaneously, predict what context will be needed before
 * it's requested, and transcend reactive cognition.
 *
 * Fuses 5 signal sources into context predictions:
 * 1. **Trend-Based** — Rising entities from NatashaObserver
 * 2. **Temporal Patterns** — Time-of-day / day-of-week entity relevance
 * 3. **Session Continuation** — Recent/interrupted session topics
 * 4. **Behavioral** — Vasana tendencies predicting likely actions
 * 5. **Co-occurrence** — Entity pairs that frequently appear together
 *
 * Research basis:
 * - Neural Paging (ArXiv 2603.02228): Predictive memory pre-loading
 * - MEM1 (ArXiv 2506.15841): Anticipatory context staging
 * - Codified Context (ArXiv 2602.20478): Context quality > quantity
 * - MemWeaver (ArXiv 2601.18204): Three-tier memory with prefetch
 *
 * @module transcendence
 */

import type {
	ContextPrediction, CachedContext, PrefetchResult, CacheStats,
	TranscendenceConfig, TranscendenceDb, PredictionSource,
} from "./transcendence-types.js";
import { DEFAULT_TRANSCENDENCE_CONFIG } from "./transcendence-types.js";
import type { TrendSignal, RegressionAlert } from "./natasha-types.js";
import {
	clamp, deduplicatePredictions, jaccardSimilarity,
	queryTemporalPatterns, queryCoOccurrences, queryRecentMemory,
} from "./transcendence-helpers.js";

// ─── Transcendence Engine ───────────────────────────────────────────────────

/**
 * Predictive context pre-fetcher that anticipates what memory context
 * will be needed before the user asks for it.
 *
 * @example
 * ```ts
 * const engine = new TranscendenceEngine(db);
 * engine.ingestTrends(natasha.detectTrends("day"));
 * engine.ingestRegressions(natasha.detectRegressions("day"));
 * const result = engine.prefetch();
 * const cached = engine.lookup("typescript");
 * ```
 */
export class TranscendenceEngine {
	private readonly db: TranscendenceDb;
	private readonly config: TranscendenceConfig;
	private cache = new Map<string, CachedContext>();
	private predictions: ContextPrediction[] = [];
	private stats: CacheStats = {
		totalLookups: 0, hits: 0, misses: 0, hitRate: 0,
		cacheSize: 0, cyclesRun: 0, avgPredictions: 0,
	};
	private trendSignals: TrendSignal[] = [];
	private regressionSignals: RegressionAlert[] = [];

	constructor(db: TranscendenceDb, config?: Partial<TranscendenceConfig>) {
		this.db = db;
		this.config = { ...DEFAULT_TRANSCENDENCE_CONFIG, ...config };
	}

	/** Ingest trend signals from NatashaObserver. */
	ingestTrends(trends: TrendSignal[]): void { this.trendSignals = trends; }

	/** Ingest regression alerts from NatashaObserver. */
	ingestRegressions(regressions: RegressionAlert[]): void { this.regressionSignals = regressions; }

	// ─── Prediction Cycle ───────────────────────────────────────────────

	/**
	 * Run a full prediction cycle — generate predictions, cache context.
	 * Call periodically (e.g., every 5 min) or on session start.
	 */
	prefetch(now?: number): PrefetchResult {
		const ts = now ?? Date.now();
		const startMs = Date.now();
		const predictions: ContextPrediction[] = [
			...this.predictFromTrends(ts),
			...this.predictFromTemporalPatterns(ts),
			...this.predictFromContinuation(ts),
			...this.predictFromRegressions(ts),
			...this.predictFromCoOccurrence(ts),
		];

		const deduped = deduplicatePredictions(predictions);
		deduped.sort((a, b) => b.confidence - a.confidence);
		const topPredictions = deduped.slice(0, this.config.maxPredictions);
		const evicted = this.evictExpired(ts);

		let cached = 0;
		for (const pred of topPredictions) {
			if (pred.confidence >= this.config.minCacheConfidence) {
				this.cacheEntry(pred, ts);
				cached++;
			}
		}

		this.predictions = topPredictions;
		this.stats.cyclesRun++;
		this.stats.cacheSize = this.cache.size;
		this.stats.avgPredictions = Math.round(
			(this.stats.avgPredictions * (this.stats.cyclesRun - 1) + topPredictions.length)
			/ this.stats.cyclesRun,
		);
		this.trendSignals = [];
		this.regressionSignals = [];

		return {
			predictions: topPredictions, cachedCount: cached, evictedCount: evicted,
			cacheSize: this.cache.size, durationMs: Date.now() - startMs,
			cycleAt: new Date(ts).toISOString(),
		};
	}

	// ─── Cache Lookup ───────────────────────────────────────────────────

	/** Look up pre-cached context for an entity. */
	lookup(entity: string, now?: number): CachedContext | null {
		const ts = now ?? Date.now();
		this.stats.totalLookups++;
		const entry = this.cache.get(entity.toLowerCase());
		if (!entry || new Date(entry.expiresAt).getTime() < ts) {
			this.stats.misses++;
			this.updateHitRate();
			return null;
		}
		entry.wasHit = true;
		this.stats.hits++;
		this.updateHitRate();
		return entry;
	}

	/** Fuzzy lookup — substring and Jaccard matching across cache. */
	fuzzyLookup(query: string, now?: number): CachedContext | null {
		const ts = now ?? Date.now();
		this.stats.totalLookups++;
		const q = query.toLowerCase();
		let best: CachedContext | null = null;
		let bestScore = 0;

		for (const [key, entry] of this.cache) {
			if (new Date(entry.expiresAt).getTime() < ts) continue;
			let score = 0;
			if (key === q) score = 1.0;
			else if (key.includes(q) || q.includes(key)) score = 0.7;
			else {
				const j = jaccardSimilarity(key.split(/\s+/), q.split(/\s+/));
				if (j > 0.3) score = j;
			}
			if (score > bestScore) { bestScore = score; best = entry; }
		}

		if (best) { best.wasHit = true; this.stats.hits++; }
		else { this.stats.misses++; }
		this.updateHitRate();
		return best;
	}

	// ─── Stats & Inspection ─────────────────────────────────────────────

	/** Get cache statistics. */
	getStats(): CacheStats { return { ...this.stats, cacheSize: this.cache.size }; }
	/** Get current predictions. */
	getPredictions(): ContextPrediction[] { return [...this.predictions]; }
	/** Get all cached entries. */
	getCacheEntries(): CachedContext[] { return [...this.cache.values()]; }
	/** Clear cache and reset stats. */
	reset(): void {
		this.cache.clear();
		this.predictions = [];
		this.stats = { totalLookups: 0, hits: 0, misses: 0, hitRate: 0, cacheSize: 0, cyclesRun: 0, avgPredictions: 0 };
	}

	// ─── Prediction Strategies ──────────────────────────────────────────

	private predictFromTrends(ts: number): ContextPrediction[] {
		const w = this.config.trendWeight;
		return this.trendSignals
			.filter((t) => t.direction === "rising" && t.confidence >= this.config.minTrendConfidence)
			.map((t) => ({
				entity: t.entity, confidence: clamp(
					t.confidence * w +
					clamp(t.changePercent / 200) * w * Math.min(1, t.currentCount / 3),
				),
				source: "trend" as PredictionSource,
				evidence: `Rising ${t.changePercent}% in ${t.window} (${t.currentCount} mentions)`,
				predictedAt: new Date(ts).toISOString(), validWindow: t.window,
			}));
	}

	private predictFromTemporalPatterns(ts: number): ContextPrediction[] {
		const w = this.config.temporalWeight;
		return queryTemporalPatterns(this.db, ts).flatMap((p) =>
			p.entities.map((entity) => ({
				entity, confidence: clamp(w * Math.min(1, p.observations / 5)),
				source: "temporal" as PredictionSource,
				evidence: `Seen ${p.observations}× at hour ${p.hour}, day ${p.dayOfWeek}`,
				predictedAt: new Date(ts).toISOString(), validWindow: "hour" as const,
			})),
		);
	}

	private predictFromContinuation(ts: number): ContextPrediction[] {
		const w = this.config.continuationWeight;
		return queryRecentMemory(this.db, ts).map((r, i) => ({
			entity: r.entity, confidence: clamp(w * (1 - i * 0.15)),
			source: "continuation" as PredictionSource,
			evidence: `Recent activity: last seen ${r.last_seen}`,
			predictedAt: new Date(ts).toISOString(), validWindow: "hour" as const,
		}));
	}

	private predictFromRegressions(ts: number): ContextPrediction[] {
		const sev: Record<string, number> = { critical: 0.9, warning: 0.6, info: 0.3 };
		return this.regressionSignals.map((r) => ({
			entity: r.errorSignature, confidence: clamp(sev[r.severity] ?? 0.3),
			source: "regression" as PredictionSource,
			evidence: `${r.severity}: ${r.description} (${r.currentOccurrences}× this period)`,
			predictedAt: new Date(ts).toISOString(), validWindow: "day" as const,
		}));
	}

	private predictFromCoOccurrence(ts: number): ContextPrediction[] {
		const coocs = queryCoOccurrences(this.db, this.config);
		const w = this.config.behavioralWeight;
		const active = new Set<string>();
		for (const t of this.trendSignals) active.add(t.entity.toLowerCase());
		for (const [, e] of this.cache) if (e.wasHit) active.add(e.entity.toLowerCase());

		return coocs
			.filter((co) => active.has(co.entityA.toLowerCase()))
			.map((co) => ({
				entity: co.entityB, confidence: clamp(co.strength * w),
				source: "cooccurrence" as PredictionSource,
				evidence: `Co-occurs with "${co.entityA}" (${co.count}×, strength=${co.strength.toFixed(2)})`,
				predictedAt: new Date(ts).toISOString(), validWindow: "day" as const,
			}));
	}

	// ─── Cache Management ───────────────────────────────────────────────

	private cacheEntry(pred: ContextPrediction, ts: number): void {
		const key = pred.entity.toLowerCase();
		if (this.cache.size >= this.config.maxCacheEntries && !this.cache.has(key)) {
			this.evictLRU();
		}
		this.cache.set(key, {
			entity: pred.entity, content: `[Predicted: ${pred.source}] ${pred.evidence}`,
			cachedAt: new Date(ts).toISOString(),
			expiresAt: new Date(ts + this.config.cacheTtlMs).toISOString(),
			source: pred.source, wasHit: false,
		});
	}

	private evictExpired(ts: number): number {
		let evicted = 0;
		for (const [key, entry] of this.cache) {
			if (new Date(entry.expiresAt).getTime() < ts) { this.cache.delete(key); evicted++; }
		}
		return evicted;
	}

	private evictLRU(): void {
		let oldest: string | null = null;
		let oldestTime = Infinity;
		// Prefer evicting non-hit entries
		for (const [key, entry] of this.cache) {
			if (entry.wasHit) continue;
			const t = new Date(entry.cachedAt).getTime();
			if (t < oldestTime) { oldestTime = t; oldest = key; }
		}
		if (!oldest) {
			for (const [key, entry] of this.cache) {
				const t = new Date(entry.cachedAt).getTime();
				if (t < oldestTime) { oldestTime = t; oldest = key; }
			}
		}
		if (oldest) this.cache.delete(oldest);
	}

	private updateHitRate(): void {
		this.stats.hitRate = this.stats.totalLookups > 0 ? this.stats.hits / this.stats.totalLookups : 0;
	}
}
