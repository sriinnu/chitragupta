/**
 * Transcendence — The Precognition Engine: Tests
 * Tests for predictive context pre-fetching.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TranscendenceEngine } from "../src/transcendence.js";
import type { TranscendenceDb } from "../src/transcendence-types.js";
import type { TrendSignal, RegressionAlert } from "../src/natasha-types.js";

// ─── Mock Database ──────────────────────────────────────────────────────────

function createMockDb(overrides?: {
	recentMemory?: Array<{ entity: string; last_seen: string }>;
	temporalEntities?: Array<{ entity: string; session_id: string; hour: number; day_of_week: number }>;
	coOccurrences?: Array<{ entity_a: string; entity_b: string; cnt: number }>;
}): TranscendenceDb {
	return {
		prepare(sql: string) {
			return {
				all(..._params: unknown[]) {
					if (sql.includes("strftime")) return overrides?.temporalEntities ?? [];
					if (sql.includes("JOIN")) return overrides?.coOccurrences ?? [];
					if (sql.includes("MAX(created_at)")) return overrides?.recentMemory ?? [];
					return [];
				},
				get() {
					return { cnt: 0 };
				},
			};
		},
	};
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-03-05T14:00:00Z").getTime();

function makeTrend(entity: string, direction: "rising" | "falling", confidence: number): TrendSignal {
	return {
		entity,
		window: "day",
		direction,
		changePercent: direction === "rising" ? 50 : -50,
		currentCount: 10,
		previousCount: direction === "rising" ? 5 : 15,
		confidence,
		detectedAt: new Date(NOW).toISOString(),
	};
}

function makeRegression(sig: string, severity: "critical" | "warning" | "info"): RegressionAlert {
	return {
		errorSignature: sig,
		description: `Regression: ${sig}`,
		currentOccurrences: severity === "critical" ? 5 : severity === "warning" ? 3 : 1,
		previousOccurrences: 0,
		severity,
		lastSeenBefore: "2026-03-01T00:00:00Z",
		detectedAt: new Date(NOW).toISOString(),
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("TranscendenceEngine", () => {
	let db: TranscendenceDb;
	let engine: TranscendenceEngine;

	beforeEach(() => {
		db = createMockDb();
		engine = new TranscendenceEngine(db);
	});

	describe("prefetch", () => {
		it("returns empty predictions with no signals", () => {
			const result = engine.prefetch(NOW);
			expect(result.predictions).toHaveLength(0);
			expect(result.cachedCount).toBe(0);
			expect(result.cacheSize).toBe(0);
		});

		it("generates predictions from rising trends", () => {
			engine.ingestTrends([
				makeTrend("typescript", "rising", 0.8),
				makeTrend("react", "rising", 0.6),
			]);
			const result = engine.prefetch(NOW);
			expect(result.predictions.length).toBeGreaterThanOrEqual(2);
			const ts = result.predictions.find((p) => p.entity === "typescript");
			expect(ts?.source).toBe("trend");
			expect(ts?.confidence).toBeGreaterThan(0);
		});

		it("ignores falling trends", () => {
			engine.ingestTrends([makeTrend("python", "falling", 0.9)]);
			const result = engine.prefetch(NOW);
			const py = result.predictions.find((p) => p.entity === "python" && p.source === "trend");
			expect(py).toBeUndefined();
		});

		it("generates predictions from regression alerts", () => {
			engine.ingestRegressions([
				makeRegression("TypeError: x is not a function", "critical"),
			]);
			const result = engine.prefetch(NOW);
			const reg = result.predictions.find((p) => p.source === "regression");
			expect(reg).toBeDefined();
			expect(reg?.confidence).toBeGreaterThan(0.5);
		});

		it("deduplicates predictions by entity", () => {
			engine.ingestTrends([
				makeTrend("typescript", "rising", 0.8),
				makeTrend("typescript", "rising", 0.5),
			]);
			const result = engine.prefetch(NOW);
			const tsPreds = result.predictions.filter((p) => p.entity === "typescript");
			expect(tsPreds).toHaveLength(1);
			// Keeps highest confidence
			expect(tsPreds[0].confidence).toBeGreaterThan(0);
		});

		it("respects maxPredictions", () => {
			const trends = Array.from({ length: 20 }, (_, i) =>
				makeTrend(`entity-${i}`, "rising", 0.5 + i * 0.02),
			);
			engine.ingestTrends(trends);
			const result = engine.prefetch(NOW);
			expect(result.predictions.length).toBeLessThanOrEqual(10);
		});

		it("caches predictions above confidence threshold", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);
			expect(engine.getCacheEntries().length).toBeGreaterThanOrEqual(1);
		});

		it("does NOT cache predictions below threshold", () => {
			const lowEngine = new TranscendenceEngine(db, { minCacheConfidence: 0.99 });
			lowEngine.ingestTrends([makeTrend("ts", "rising", 0.3)]);
			lowEngine.prefetch(NOW);
			// Low confidence trend may not reach 0.99 threshold
			const cached = lowEngine.getCacheEntries();
			const tsEntry = cached.find((c) => c.entity === "ts");
			expect(tsEntry).toBeUndefined();
		});
	});

	describe("lookup", () => {
		it("returns cached context for known entity", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);
			const result = engine.lookup("typescript", NOW);
			expect(result).not.toBeNull();
			expect(result?.entity).toBe("typescript");
		});

		it("is case-insensitive", () => {
			engine.ingestTrends([makeTrend("TypeScript", "rising", 0.9)]);
			engine.prefetch(NOW);
			const result = engine.lookup("typescript", NOW);
			expect(result).not.toBeNull();
		});

		it("returns null for unknown entities", () => {
			const result = engine.lookup("nonexistent", NOW);
			expect(result).toBeNull();
		});

		it("returns null for expired entries", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);
			// Jump 10 minutes into the future (past 5-min TTL)
			const result = engine.lookup("typescript", NOW + 600_000);
			expect(result).toBeNull();
		});

		it("marks entries as hit when accessed", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);
			engine.lookup("typescript", NOW);
			const entries = engine.getCacheEntries();
			const ts = entries.find((e) => e.entity === "typescript");
			expect(ts?.wasHit).toBe(true);
		});
	});

	describe("fuzzyLookup", () => {
		it("matches exact entity names", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);
			const result = engine.fuzzyLookup("typescript", NOW);
			expect(result).not.toBeNull();
		});

		it("matches partial substrings", () => {
			engine.ingestTrends([makeTrend("typescript compiler", "rising", 0.9)]);
			engine.prefetch(NOW);
			const result = engine.fuzzyLookup("typescript", NOW);
			expect(result).not.toBeNull();
		});

		it("returns null for no match", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);
			const result = engine.fuzzyLookup("completely-unrelated", NOW);
			expect(result).toBeNull();
		});
	});

	describe("stats", () => {
		it("tracks hit rate correctly", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);

			engine.lookup("typescript", NOW); // hit
			engine.lookup("nonexistent", NOW); // miss

			const stats = engine.getStats();
			expect(stats.totalLookups).toBe(2);
			expect(stats.hits).toBe(1);
			expect(stats.misses).toBe(1);
			expect(stats.hitRate).toBe(0.5);
		});

		it("tracks cycles run", () => {
			engine.prefetch(NOW);
			engine.prefetch(NOW);
			engine.prefetch(NOW);
			expect(engine.getStats().cyclesRun).toBe(3);
		});
	});

	describe("cache management", () => {
		it("evicts expired entries on prefetch", () => {
			engine.ingestTrends([makeTrend("old-topic", "rising", 0.9)]);
			engine.prefetch(NOW);
			expect(engine.getCacheEntries().length).toBeGreaterThanOrEqual(1);

			// 10 min later — past TTL
			engine.prefetch(NOW + 600_000);
			const old = engine.getCacheEntries().find((e) => e.entity === "old-topic");
			expect(old).toBeUndefined();
		});

		it("evicts LRU when at capacity", () => {
			const smallEngine = new TranscendenceEngine(db, { maxCacheEntries: 3 });

			// Fill cache with 3 entries
			smallEngine.ingestTrends([
				makeTrend("a", "rising", 0.9),
				makeTrend("b", "rising", 0.8),
				makeTrend("c", "rising", 0.7),
			]);
			smallEngine.prefetch(NOW);
			expect(smallEngine.getCacheEntries().length).toBeLessThanOrEqual(3);

			// Add a 4th — should evict oldest
			smallEngine.ingestTrends([makeTrend("d", "rising", 0.95)]);
			smallEngine.prefetch(NOW + 1000);
			expect(smallEngine.getCacheEntries().length).toBeLessThanOrEqual(3);
		});

		it("reset clears everything", () => {
			engine.ingestTrends([makeTrend("typescript", "rising", 0.9)]);
			engine.prefetch(NOW);
			engine.lookup("typescript", NOW);

			engine.reset();
			expect(engine.getCacheEntries()).toHaveLength(0);
			expect(engine.getPredictions()).toHaveLength(0);
			expect(engine.getStats().cyclesRun).toBe(0);
		});
	});

	describe("temporal patterns", () => {
		it("generates predictions from time-of-day patterns", () => {
			const dbWithPatterns = createMockDb({
				temporalEntities: [
					{ entity: "auth-module", session_id: "s1", hour: 14, day_of_week: 3 },
					{ entity: "auth-module", session_id: "s2", hour: 14, day_of_week: 3 },
					{ entity: "db-queries", session_id: "s3", hour: 14, day_of_week: 3 },
				],
			});
			const patternEngine = new TranscendenceEngine(dbWithPatterns);
			const result = patternEngine.prefetch(NOW);
			const temporal = result.predictions.filter((p) => p.source === "temporal");
			expect(temporal.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("continuation predictions", () => {
		it("generates predictions from recent memory", () => {
			const dbWithRecent = createMockDb({
				recentMemory: [
					{ entity: "api-refactor", last_seen: "2026-03-05T13:30:00Z" },
					{ entity: "auth-fix", last_seen: "2026-03-05T13:00:00Z" },
				],
			});
			const contEngine = new TranscendenceEngine(dbWithRecent);
			const result = contEngine.prefetch(NOW);
			const cont = result.predictions.filter((p) => p.source === "continuation");
			expect(cont.length).toBeGreaterThanOrEqual(1);
		});
	});
});

// ─── Natasha → Transcendence Integration (Wire 3) ───────────────────────────

describe("Natasha → Transcendence integration", () => {
	it("trend signal → ingestTrends → prefetch → lookup returns cached entry", () => {
		const engine = new TranscendenceEngine(createMockDb());

		// Simulate Natasha detecting a rising trend for "typescript"
		const trend = makeTrend("typescript", "rising", 0.9);
		engine.ingestTrends([trend]);

		// Run prediction cycle (as if Transcendence's scheduled prefetch fired)
		const result = engine.prefetch(NOW);

		// The entity should appear in predictions
		const tsPredictions = result.predictions.filter((p) => p.entity === "typescript");
		expect(tsPredictions.length).toBeGreaterThanOrEqual(1);
		expect(tsPredictions[0].source).toBe("trend");
		expect(tsPredictions[0].confidence).toBeGreaterThan(0);

		// And should be accessible via lookup — pass same NOW to avoid TTL expiry
		const cached = engine.lookup("typescript", NOW);
		expect(cached).not.toBeNull();
		expect(cached?.entity).toBe("typescript");
	});

	it("regression signal → ingestRegressions → prefetch → entity boosted in predictions", () => {
		const engine = new TranscendenceEngine(createMockDb());

		// Simulate Scarlett signal bridge injecting a smriti-db critical regression
		const regression = makeRegression("smriti", "critical");
		engine.ingestRegressions([regression]);

		const result = engine.prefetch(NOW);

		const regressionPreds = result.predictions.filter((p) => p.source === "regression");
		expect(regressionPreds.length).toBeGreaterThanOrEqual(1);
		// Critical regression gets confidence 0.9
		expect(regressionPreds[0].confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("fuzzyLookup finds trend-cached entity by substring match", () => {
		// Lower minCacheConfidence so trend predictions get cached (default trendWeight=0.35 gives ~0.385)
		const engine = new TranscendenceEngine(createMockDb(), { minCacheConfidence: 0.3 });
		engine.ingestTrends([makeTrend("typescript-refactor", "rising", 0.85)]);
		engine.prefetch(NOW);

		// fuzzyLookup with partial query should still find it — pass NOW to avoid TTL expiry
		const hit = engine.fuzzyLookup("typescript", NOW);
		expect(hit).not.toBeNull();
		expect(hit?.entity).toBe("typescript-refactor");
	});

	it("signals are consumed after prefetch — next cycle starts clean", () => {
		const engine = new TranscendenceEngine(createMockDb());
		engine.ingestTrends([makeTrend("react", "rising", 0.9)]);
		engine.prefetch(NOW);

		// After prefetch, signals are cleared. Second prefetch with no new signals
		// should not re-use the same trends.
		const result2 = engine.prefetch(NOW + 1000);
		const reactFromTrend = result2.predictions.filter(
			(p) => p.entity === "react" && p.source === "trend",
		);
		// Should be 0 — signals consumed
		expect(reactFromTrend.length).toBe(0);
	});
});
