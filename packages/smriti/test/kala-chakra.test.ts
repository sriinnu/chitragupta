import { describe, it, expect, beforeEach } from "vitest";
import {
	KalaChakra,
	TEMPORAL_SCALES,
	type TemporalScale,
	type KalaChakraConfig,
	type KalaContext,
	type CurrentState,
	type DatabaseLike,
} from "../src/kala-chakra.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const QUARTER = 90 * DAY;
const YEAR = 365 * DAY;

// Fixed "now" for deterministic tests
const NOW = new Date("2026-02-09T12:00:00Z").getTime();

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeState(overrides?: Partial<CurrentState>): CurrentState {
	return {
		turnNumber: 3,
		turnStartedAt: NOW - 5_000,  // 5 seconds ago
		tokensSoFar: 150,
		sessionId: "sess-test-001",
		sessionStartedAt: NOW - 600_000,  // 10 minutes ago
		sessionTurnCount: 3,
		sessionTokenTotal: 1200,
		...overrides,
	};
}

/**
 * Create a mock DatabaseLike that returns predefined counts.
 * The counters map SQL query fragments to return values.
 */
function createMockDb(counters?: Record<string, number>): DatabaseLike {
	const defaults: Record<string, number> = {
		sessions_day: 4,
		turns_day: 87,
		sessions_week: 18,
		turns_week: 412,
		sessions_month: 62,
		vasanas_month: 8,
		sessions_quarter: 180,
		sessions_year: 700,
		vasanas_year: 35,
		vidhis_year: 12,
		...counters,
	};

	return {
		prepare(sql: string) {
			return {
				get(..._params: unknown[]): unknown {
					// Match query to return correct mock data
					if (sql.includes("sessions") && sql.includes("SUM(turn_count)")) {
						// Turn count queries
						if (isWeekRange(_params)) return { cnt: defaults.turns_week };
						return { cnt: defaults.turns_day };
					}
					if (sql.includes("sessions") && sql.includes("COUNT(*)")) {
						if (isYearRange(_params)) return { cnt: defaults.sessions_year };
						if (isQuarterRange(_params)) return { cnt: defaults.sessions_quarter };
						if (isMonthRange(_params)) return { cnt: defaults.sessions_month };
						if (isWeekRange(_params)) return { cnt: defaults.sessions_week };
						return { cnt: defaults.sessions_day };
					}
					if (sql.includes("vasanas")) {
						if (isYearRangeNum(_params)) return { cnt: defaults.vasanas_year };
						return { cnt: defaults.vasanas_month };
					}
					if (sql.includes("vidhis")) {
						return { cnt: defaults.vidhis_year };
					}
					return { cnt: 0 };
				},
			};
		},
	};
}

/** Heuristic: week range queries span 7+ days. */
function isWeekRange(params: unknown[]): boolean {
	if (params.length < 2) return false;
	const [start, end] = params as [string, string];
	if (typeof start !== "string" || typeof end !== "string") return false;
	// Week queries have wider date spans
	const startDate = new Date(start).getTime();
	const endDate = new Date(end).getTime();
	return (endDate - startDate) > 2 * DAY && (endDate - startDate) < 15 * DAY;
}

/** Heuristic: month range queries. */
function isMonthRange(params: unknown[]): boolean {
	if (params.length < 2) return false;
	const [start, end] = params as [string, string];
	if (typeof start !== "string" || typeof end !== "string") return false;
	const startDate = new Date(start).getTime();
	const endDate = new Date(end).getTime();
	return (endDate - startDate) > 15 * DAY && (endDate - startDate) < 60 * DAY;
}

/** Heuristic: quarter range queries. */
function isQuarterRange(params: unknown[]): boolean {
	if (params.length < 2) return false;
	const [start, end] = params as [string, string];
	if (typeof start !== "string" || typeof end !== "string") return false;
	const startDate = new Date(start).getTime();
	const endDate = new Date(end).getTime();
	return (endDate - startDate) > 60 * DAY && (endDate - startDate) < 200 * DAY;
}

/** Heuristic: year range queries. */
function isYearRange(params: unknown[]): boolean {
	if (params.length < 2) return false;
	const [start, end] = params as [string, string];
	if (typeof start !== "string" || typeof end !== "string") return false;
	const startDate = new Date(start).getTime();
	const endDate = new Date(end).getTime();
	return (endDate - startDate) > 200 * DAY;
}

/** Heuristic: year range with numeric (Unix) params. */
function isYearRangeNum(params: unknown[]): boolean {
	if (params.length < 2) return false;
	const [start, end] = params as [number, number];
	if (typeof start !== "number" || typeof end !== "number") return false;
	return (end - start) > 200 * DAY;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("KalaChakra -- Multi-Scale Temporal Awareness", () => {
	let kala: KalaChakra;

	beforeEach(() => {
		kala = new KalaChakra();
	});

	// ── TEMPORAL_SCALES constant ────────────────────────────────────────

	describe("TEMPORAL_SCALES", () => {
		it("should have exactly 7 scales", () => {
			expect(TEMPORAL_SCALES).toHaveLength(7);
		});

		it("should be ordered from finest to coarsest", () => {
			expect(TEMPORAL_SCALES).toEqual([
				"turn", "session", "day", "week", "month", "quarter", "year",
			]);
		});
	});

	// ── Default Config ──────────────────────────────────────────────────

	describe("default configuration", () => {
		it("should have default scale weights that sum to 1.0", () => {
			const weights = kala.scaleWeights;
			const sum = Object.values(weights).reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1.0, 10);
		});

		it("should have default decay rates for all 7 scales", () => {
			const rates = kala.decayRates;
			for (const scale of TEMPORAL_SCALES) {
				expect(rates[scale]).toBeGreaterThan(0);
			}
		});

		it("should have decay rates in ascending order", () => {
			const rates = kala.decayRates;
			for (let i = 1; i < TEMPORAL_SCALES.length; i++) {
				expect(rates[TEMPORAL_SCALES[i]]).toBeGreaterThan(rates[TEMPORAL_SCALES[i - 1]]);
			}
		});

		it("should return readonly copies from accessors", () => {
			const rates1 = kala.decayRates;
			const rates2 = kala.decayRates;
			expect(rates1).toEqual(rates2);
			expect(rates1).not.toBe(rates2); // Different object references
		});
	});

	// ── Custom Config ───────────────────────────────────────────────────

	describe("custom configuration", () => {
		it("should accept partial decay rate overrides", () => {
			const custom = new KalaChakra({
				decayRates: { turn: 30_000, session: HOUR * 2 } as Record<TemporalScale, number>,
			});
			expect(custom.decayRates.turn).toBe(30_000);
			expect(custom.decayRates.session).toBe(HOUR * 2);
			// Others remain default
			expect(custom.decayRates.day).toBe(DAY);
		});

		it("should accept partial scale weight overrides", () => {
			const custom = new KalaChakra({
				scaleWeights: { turn: 0.5 } as Record<TemporalScale, number>,
			});
			expect(custom.scaleWeights.turn).toBe(0.5);
			// Others remain default
			expect(custom.scaleWeights.session).toBe(0.20);
		});

		it("should clamp decay rates to hard ceilings", () => {
			const custom = new KalaChakra({
				decayRates: {
					turn: 1,  // Below minimum (1000ms)
					year: Number.MAX_SAFE_INTEGER,  // Above maximum
				} as Record<TemporalScale, number>,
			});
			expect(custom.decayRates.turn).toBe(1_000); // Clamped to min
			expect(custom.decayRates.year).toBeLessThan(Number.MAX_SAFE_INTEGER);
		});

		it("should clamp scale weights to [0, 1]", () => {
			const custom = new KalaChakra({
				scaleWeights: {
					turn: -0.5,
					session: 2.0,
				} as Record<TemporalScale, number>,
			});
			expect(custom.scaleWeights.turn).toBe(0);
			expect(custom.scaleWeights.session).toBe(1);
		});
	});

	// ── decayFactor ─────────────────────────────────────────────────────

	describe("decayFactor()", () => {
		it("should return 1.0 at t=0", () => {
			for (const scale of TEMPORAL_SCALES) {
				expect(kala.decayFactor(0, scale)).toBeCloseTo(1.0, 10);
			}
		});

		it("should return ~0.5 at t = halfLife", () => {
			const rates = kala.decayRates;
			for (const scale of TEMPORAL_SCALES) {
				const factor = kala.decayFactor(rates[scale], scale);
				expect(factor).toBeCloseTo(0.5, 5);
			}
		});

		it("should return ~0.25 at t = 2 * halfLife", () => {
			const rates = kala.decayRates;
			for (const scale of TEMPORAL_SCALES) {
				const factor = kala.decayFactor(2 * rates[scale], scale);
				expect(factor).toBeCloseTo(0.25, 5);
			}
		});

		it("should approach 0 for very large elapsed time", () => {
			const factor = kala.decayFactor(100 * YEAR, "turn");
			expect(factor).toBeLessThan(1e-10);
		});

		it("should be monotonically decreasing", () => {
			for (const scale of TEMPORAL_SCALES) {
				let prev = kala.decayFactor(0, scale);
				for (let t = 1000; t <= 100_000; t += 1000) {
					const curr = kala.decayFactor(t, scale);
					expect(curr).toBeLessThanOrEqual(prev);
					prev = curr;
				}
			}
		});

		it("should treat negative elapsed as 0 (returns 1.0)", () => {
			expect(kala.decayFactor(-5_000, "turn")).toBeCloseTo(1.0, 10);
		});

		it("should return 1.0 for zero elapsed on all scales", () => {
			for (const scale of TEMPORAL_SCALES) {
				expect(kala.decayFactor(0, scale)).toBe(1.0);
			}
		});
	});

	// ── relevanceScore ──────────────────────────────────────────────────

	describe("relevanceScore()", () => {
		it("should return ~1.0 for a document at now", () => {
			const score = kala.relevanceScore(NOW, NOW);
			expect(score).toBeCloseTo(1.0, 5);
		});

		it("should return higher score for recent than old documents", () => {
			const recentScore = kala.relevanceScore(NOW - MINUTE, NOW);
			const oldScore = kala.relevanceScore(NOW - YEAR, NOW);
			expect(recentScore).toBeGreaterThan(oldScore);
		});

		it("should return score in [0, 1] range", () => {
			const testTimes = [0, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER, YEAR, 10 * YEAR];
			for (const elapsed of testTimes) {
				const score = kala.relevanceScore(NOW - elapsed, NOW);
				expect(score).toBeGreaterThanOrEqual(0);
				expect(score).toBeLessThanOrEqual(1.01); // Small tolerance for floating point
			}
		});

		it("should approach 0 for very old documents", () => {
			const score = kala.relevanceScore(NOW - 100 * YEAR, NOW);
			expect(score).toBeLessThan(0.01);
		});

		it("should be monotonically decreasing with age", () => {
			let prev = kala.relevanceScore(NOW, NOW);
			const steps = [MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER, YEAR, 5 * YEAR];
			for (const elapsed of steps) {
				const curr = kala.relevanceScore(NOW - elapsed, NOW);
				expect(curr).toBeLessThanOrEqual(prev);
				prev = curr;
			}
		});

		it("should use Date.now() when now is not provided", () => {
			const ts = Date.now() - 1000;
			const score = kala.relevanceScore(ts);
			expect(score).toBeGreaterThan(0.9);
		});

		it("should handle future timestamps gracefully (clamped to 0 elapsed)", () => {
			const score = kala.relevanceScore(NOW + DAY, NOW);
			// Future timestamps are clamped to elapsed=0, so relevance = 1.0
			expect(score).toBeCloseTo(1.0, 5);
		});
	});

	// ── multiScaleRelevance ─────────────────────────────────────────────

	describe("multiScaleRelevance()", () => {
		it("should equal relevanceScore when no scale is specified", () => {
			const ts = NOW - HOUR;
			const full = kala.relevanceScore(ts, NOW);
			const multi = kala.multiScaleRelevance(ts, undefined, NOW);
			expect(multi).toBeCloseTo(full, 10);
		});

		it("should return single-scale weighted contribution when scale is specified", () => {
			const ts = NOW - HOUR;
			const weights = kala.scaleWeights;
			const turnRelevance = kala.multiScaleRelevance(ts, "turn", NOW);
			// Should be weight_turn * decay_turn(1h)
			const expectedDecay = kala.decayFactor(HOUR, "turn");
			expect(turnRelevance).toBeCloseTo(weights.turn * expectedDecay, 10);
		});

		it("should return higher single-scale relevance for faster-decaying scales at short elapsed", () => {
			const ts = NOW - 30_000; // 30 seconds ago
			const turnRel = kala.multiScaleRelevance(ts, "turn", NOW);
			const yearRel = kala.multiScaleRelevance(ts, "year", NOW);
			// Turn has higher weight (0.25 vs 0.07) and similar decay at 30s
			// Both should be high, but turn has higher weight
			expect(turnRel).toBeGreaterThan(yearRel);
		});

		it("should return lower turn-scale relevance than year-scale for very old documents", () => {
			const ts = NOW - 2 * YEAR;
			const turnRel = kala.multiScaleRelevance(ts, "turn", NOW);
			const yearRel = kala.multiScaleRelevance(ts, "year", NOW);
			// At 2 years: turn decays to ~0, year decays to ~0.25
			// 0.25 * ~0 < 0.07 * 0.25
			expect(yearRel).toBeGreaterThan(turnRel);
		});

		it("sum of all single-scale relevances should equal full relevance", () => {
			const ts = NOW - 3 * DAY;
			const full = kala.relevanceScore(ts, NOW);
			let sum = 0;
			for (const scale of TEMPORAL_SCALES) {
				sum += kala.multiScaleRelevance(ts, scale, NOW);
			}
			expect(sum).toBeCloseTo(full, 10);
		});
	});

	// ── dominantScale ───────────────────────────────────────────────────

	describe("dominantScale()", () => {
		it("should return 'turn' for < 5 minutes", () => {
			expect(kala.dominantScale(0)).toBe("turn");
			expect(kala.dominantScale(30_000)).toBe("turn");
			expect(kala.dominantScale(4 * MINUTE)).toBe("turn");
		});

		it("should return 'session' for 5min to 2h", () => {
			expect(kala.dominantScale(5 * MINUTE)).toBe("session");
			expect(kala.dominantScale(HOUR)).toBe("session");
			expect(kala.dominantScale(119 * MINUTE)).toBe("session");
		});

		it("should return 'day' for 2h to 36h", () => {
			expect(kala.dominantScale(2 * HOUR)).toBe("day");
			expect(kala.dominantScale(12 * HOUR)).toBe("day");
			expect(kala.dominantScale(35 * HOUR)).toBe("day");
		});

		it("should return 'week' for 36h to 10d", () => {
			expect(kala.dominantScale(36 * HOUR)).toBe("week");
			expect(kala.dominantScale(5 * DAY)).toBe("week");
			expect(kala.dominantScale(9 * DAY)).toBe("week");
		});

		it("should return 'month' for 10d to 45d", () => {
			expect(kala.dominantScale(10 * DAY)).toBe("month");
			expect(kala.dominantScale(30 * DAY)).toBe("month");
			expect(kala.dominantScale(44 * DAY)).toBe("month");
		});

		it("should return 'quarter' for 45d to 120d", () => {
			expect(kala.dominantScale(45 * DAY)).toBe("quarter");
			expect(kala.dominantScale(90 * DAY)).toBe("quarter");
			expect(kala.dominantScale(119 * DAY)).toBe("quarter");
		});

		it("should return 'year' for >= 120d", () => {
			expect(kala.dominantScale(120 * DAY)).toBe("year");
			expect(kala.dominantScale(365 * DAY)).toBe("year");
			expect(kala.dominantScale(10 * YEAR)).toBe("year");
		});

		it("should handle negative elapsed by using absolute value", () => {
			expect(kala.dominantScale(-30_000)).toBe("turn");
			expect(kala.dominantScale(-HOUR)).toBe("session");
		});

		it("should handle boundary values precisely", () => {
			// Exactly at boundary: 5 minutes is session (>= 5min)
			expect(kala.dominantScale(5 * MINUTE)).toBe("session");
			// Just below boundary: < 5 min is turn
			expect(kala.dominantScale(5 * MINUTE - 1)).toBe("turn");
		});
	});

	// ── boostScore ──────────────────────────────────────────────────────

	describe("boostScore()", () => {
		it("should return ~originalScore for a document at now", () => {
			const boosted = kala.boostScore(0.8, NOW, NOW);
			// relevance ≈ 1.0, so boosted ≈ 0.8 * (0.5 + 0.5 * 1.0) = 0.8
			expect(boosted).toBeCloseTo(0.8, 2);
		});

		it("should return ~0.5 * originalScore for very old documents", () => {
			const boosted = kala.boostScore(0.8, NOW - 100 * YEAR, NOW);
			// relevance ≈ 0, so boosted ≈ 0.8 * 0.5 = 0.4
			expect(boosted).toBeCloseTo(0.4, 1);
		});

		it("should preserve ordering for documents with same age", () => {
			const ts = NOW - DAY;
			const boosted1 = kala.boostScore(0.9, ts, NOW);
			const boosted2 = kala.boostScore(0.7, ts, NOW);
			expect(boosted1).toBeGreaterThan(boosted2);
		});

		it("should boost recent document more than old document for same original score", () => {
			const score = 0.8;
			const recentBoosted = kala.boostScore(score, NOW - MINUTE, NOW);
			const oldBoosted = kala.boostScore(score, NOW - YEAR, NOW);
			expect(recentBoosted).toBeGreaterThan(oldBoosted);
		});

		it("should return value in [0.5 * original, original] range", () => {
			const original = 0.8;
			const tests = [0, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER, YEAR, 50 * YEAR];
			for (const elapsed of tests) {
				const boosted = kala.boostScore(original, NOW - elapsed, NOW);
				expect(boosted).toBeGreaterThanOrEqual(original * 0.5 - 0.001);
				expect(boosted).toBeLessThanOrEqual(original + 0.001);
			}
		});

		it("should handle zero original score", () => {
			const boosted = kala.boostScore(0, NOW - HOUR, NOW);
			expect(boosted).toBe(0);
		});

		it("should handle negative original score", () => {
			// Negative scores: boosted = negative * (0.5 + 0.5 * rel)
			// The formula still applies, resulting in a negative number
			const boosted = kala.boostScore(-1, NOW, NOW);
			expect(boosted).toBeCloseTo(-1, 2);
		});
	});

	// ── buildContext (no DB) ─────────────────────────────────────────────

	describe("buildContext() without database", () => {
		it("should return all 7 scales", () => {
			const ctx = kala.buildContext(makeState(), undefined, NOW);
			expect(ctx.turn).toBeDefined();
			expect(ctx.session).toBeDefined();
			expect(ctx.day).toBeDefined();
			expect(ctx.week).toBeDefined();
			expect(ctx.month).toBeDefined();
			expect(ctx.quarter).toBeDefined();
			expect(ctx.year).toBeDefined();
		});

		it("should populate turn context from state", () => {
			const state = makeState();
			const ctx = kala.buildContext(state, undefined, NOW);
			expect(ctx.turn.turnNumber).toBe(3);
			expect(ctx.turn.elapsed).toBe(NOW - state.turnStartedAt);
			expect(ctx.turn.tokensSoFar).toBe(150);
		});

		it("should populate session context from state", () => {
			const state = makeState();
			const ctx = kala.buildContext(state, undefined, NOW);
			expect(ctx.session.sessionId).toBe("sess-test-001");
			expect(ctx.session.turnCount).toBe(3);
			expect(ctx.session.elapsed).toBe(NOW - state.sessionStartedAt);
			expect(ctx.session.tokenTotal).toBe(1200);
		});

		it("should populate day context with correct date", () => {
			const ctx = kala.buildContext(makeState(), undefined, NOW);
			expect(ctx.day.date).toBe("2026-02-09");
		});

		it("should have zero counts for DB-dependent scales when no DB provided", () => {
			const ctx = kala.buildContext(makeState(), undefined, NOW);
			expect(ctx.day.sessionsToday).toBe(0);
			expect(ctx.day.turnsToday).toBe(0);
			expect(ctx.week.sessionsThisWeek).toBe(0);
			expect(ctx.week.avgTurnsPerSession).toBe(0);
			expect(ctx.month.sessionsThisMonth).toBe(0);
			expect(ctx.month.vasanasThisMonth).toBe(0);
			expect(ctx.quarter.sessionsThisQuarter).toBe(0);
			expect(ctx.year.sessionsThisYear).toBe(0);
			expect(ctx.year.vasanasThisYear).toBe(0);
			expect(ctx.year.vidhisThisYear).toBe(0);
		});

		it("should compute ISO week number", () => {
			const ctx = kala.buildContext(makeState(), undefined, NOW);
			// 2026-02-09 is in ISO week 7
			expect(ctx.week.weekNumber).toBeGreaterThan(0);
			expect(ctx.week.weekNumber).toBeLessThanOrEqual(53);
		});

		it("should compute correct month", () => {
			const ctx = kala.buildContext(makeState(), undefined, NOW);
			expect(ctx.month.month).toBe(2);  // February
			expect(ctx.month.year).toBe(2026);
		});

		it("should compute correct quarter", () => {
			const ctx = kala.buildContext(makeState(), undefined, NOW);
			expect(ctx.quarter.quarter).toBe(1);  // Feb = Q1
			expect(ctx.quarter.year).toBe(2026);
		});

		it("should compute correct year", () => {
			const ctx = kala.buildContext(makeState(), undefined, NOW);
			expect(ctx.year.year).toBe(2026);
		});
	});

	// ── buildContext (with DB) ───────────────────────────────────────────

	describe("buildContext() with database", () => {
		it("should query database for session/turn counts", () => {
			const db = createMockDb();
			const ctx = kala.buildContext(makeState(), db, NOW);
			expect(ctx.day.sessionsToday).toBe(4);
			expect(ctx.day.turnsToday).toBe(87);
		});

		it("should populate week context from database", () => {
			const db = createMockDb();
			const ctx = kala.buildContext(makeState(), db, NOW);
			expect(ctx.week.sessionsThisWeek).toBe(18);
			// avgTurnsPerSession = turnsThisWeek / sessionsThisWeek
			expect(ctx.week.avgTurnsPerSession).toBeCloseTo(412 / 18, 5);
		});

		it("should populate month vasana count from database", () => {
			const db = createMockDb();
			const ctx = kala.buildContext(makeState(), db, NOW);
			expect(ctx.month.sessionsThisMonth).toBe(62);
			expect(ctx.month.vasanasThisMonth).toBe(8);
		});

		it("should populate quarter count from database", () => {
			const db = createMockDb();
			const ctx = kala.buildContext(makeState(), db, NOW);
			expect(ctx.quarter.sessionsThisQuarter).toBe(180);
		});

		it("should populate year counts from database", () => {
			const db = createMockDb();
			const ctx = kala.buildContext(makeState(), db, NOW);
			expect(ctx.year.sessionsThisYear).toBe(700);
			expect(ctx.year.vasanasThisYear).toBe(35);
			expect(ctx.year.vidhisThisYear).toBe(12);
		});

		it("should handle database errors gracefully", () => {
			const errorDb: DatabaseLike = {
				prepare(_sql: string) {
					return {
						get() {
							throw new Error("DB error");
						},
					};
				},
			};
			// Should not throw -- returns 0 for failed queries
			const ctx = kala.buildContext(makeState(), errorDb, NOW);
			expect(ctx.day.sessionsToday).toBe(0);
			expect(ctx.year.sessionsThisYear).toBe(0);
		});
	});

	// ── Serialize / Restore ─────────────────────────────────────────────

	describe("serialize() / restore()", () => {
		it("should round-trip configuration", () => {
			const custom = new KalaChakra({
				decayRates: {
					turn: 30_000,
					session: 2 * HOUR,
					day: DAY,
					week: WEEK,
					month: MONTH,
					quarter: QUARTER,
					year: YEAR,
				},
				scaleWeights: {
					turn: 0.30,
					session: 0.25,
					day: 0.15,
					week: 0.10,
					month: 0.08,
					quarter: 0.07,
					year: 0.05,
				},
			});

			const serialized = custom.serialize();
			const restored = new KalaChakra();
			restored.restore(serialized);

			expect(restored.decayRates).toEqual(custom.decayRates);
			expect(restored.scaleWeights).toEqual(custom.scaleWeights);
		});

		it("should produce JSON-serializable output", () => {
			const data = kala.serialize();
			const json = JSON.stringify(data);
			const parsed = JSON.parse(json);
			expect(parsed.decayRates).toBeDefined();
			expect(parsed.scaleWeights).toBeDefined();
		});

		it("should ignore invalid restore data", () => {
			const originalRates = { ...kala.decayRates };
			kala.restore(null as any);
			expect(kala.decayRates).toEqual(originalRates);
		});

		it("should ignore non-object restore data", () => {
			const originalRates = { ...kala.decayRates };
			kala.restore("invalid" as any);
			expect(kala.decayRates).toEqual(originalRates);
		});

		it("should handle partial restore data", () => {
			const originalWeights = { ...kala.scaleWeights };
			kala.restore({ decayRates: { turn: 45_000 } as any });
			expect(kala.decayRates.turn).toBe(45_000);
			expect(kala.scaleWeights).toEqual(originalWeights);
		});

		it("should clamp restored values to hard ceilings", () => {
			kala.restore({
				decayRates: { turn: 1 } as any,  // Below minimum
			});
			expect(kala.decayRates.turn).toBe(1_000); // Clamped
		});
	});

	// ── Edge Cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle zero elapsed in all methods", () => {
			expect(kala.decayFactor(0, "turn")).toBe(1.0);
			expect(kala.relevanceScore(NOW, NOW)).toBeCloseTo(1.0, 10);
			expect(kala.boostScore(1, NOW, NOW)).toBeCloseTo(1.0, 2);
			expect(kala.dominantScale(0)).toBe("turn");
		});

		it("should handle very large elapsed times without overflow", () => {
			const hugeElapsed = Number.MAX_SAFE_INTEGER;
			const factor = kala.decayFactor(hugeElapsed, "turn");
			expect(factor).toBe(0); // exp(-huge) = 0
			expect(Number.isFinite(factor)).toBe(true);
		});

		it("should handle document timestamp = 0 (epoch)", () => {
			const score = kala.relevanceScore(0, NOW);
			expect(Number.isFinite(score)).toBe(true);
			expect(score).toBeGreaterThanOrEqual(0);
		});

		it("should produce consistent results across calls", () => {
			const ts = NOW - 3 * DAY;
			const score1 = kala.relevanceScore(ts, NOW);
			const score2 = kala.relevanceScore(ts, NOW);
			expect(score1).toBe(score2);
		});

		it("should handle all-zero weights gracefully", () => {
			const allZero = new KalaChakra({
				scaleWeights: {
					turn: 0, session: 0, day: 0,
					week: 0, month: 0, quarter: 0, year: 0,
				},
			});
			expect(allZero.relevanceScore(NOW - HOUR, NOW)).toBe(0);
			expect(allZero.boostScore(0.8, NOW - HOUR, NOW)).toBeCloseTo(0.4, 2);
		});

		it("should handle state with turnStartedAt in the future", () => {
			const state = makeState({ turnStartedAt: NOW + 10_000 });
			const ctx = kala.buildContext(state, undefined, NOW);
			// elapsed can be negative from state, but that's fine -- just means "not yet started"
			expect(ctx.turn.elapsed).toBe(-10_000);
		});
	});

	// ── Integration: Scale coherence ────────────────────────────────────

	describe("scale coherence", () => {
		it("decay should be faster for finer scales at same elapsed", () => {
			const elapsed = 2 * HOUR;
			const turnDecay = kala.decayFactor(elapsed, "turn");
			const yearDecay = kala.decayFactor(elapsed, "year");
			// Turn half-life = 1 min, so 2h = 120 half-lives → nearly 0
			// Year half-life = 365d, so 2h is tiny → nearly 1.0
			expect(turnDecay).toBeLessThan(yearDecay);
		});

		it("turn scale should have highest weighted contribution at t=0", () => {
			const ts = NOW; // exactly now
			const turnContrib = kala.multiScaleRelevance(ts, "turn", NOW);
			const sessionContrib = kala.multiScaleRelevance(ts, "session", NOW);
			// At t=0, decay=1.0 for all scales, so weight alone determines order.
			// turn weight (0.25) > session weight (0.20)
			expect(turnContrib).toBeGreaterThan(sessionContrib);
		});

		it("year scale should dominate very long-term relevance", () => {
			const ts = NOW - 5 * YEAR;
			const turnContrib = kala.multiScaleRelevance(ts, "turn", NOW);
			const yearContrib = kala.multiScaleRelevance(ts, "year", NOW);
			// Turn is essentially 0 at 5 years, year still has some residual
			expect(yearContrib).toBeGreaterThan(turnContrib);
		});
	});

	// ── Mathematical Properties ─────────────────────────────────────────

	describe("mathematical properties", () => {
		it("decay factor should satisfy f(a+b) = f(a) * f(b) (semigroup)", () => {
			// exp(-c*(a+b)) = exp(-c*a) * exp(-c*b)
			const a = 5000;
			const b = 8000;
			const fa = kala.decayFactor(a, "session");
			const fb = kala.decayFactor(b, "session");
			const fab = kala.decayFactor(a + b, "session");
			expect(fab).toBeCloseTo(fa * fb, 10);
		});

		it("relevance score should be a convex combination of decays", () => {
			// Since weights sum to 1 and decays are in [0,1],
			// the weighted sum is bounded by min and max decay across scales
			const elapsed = 3 * DAY;
			const decays = TEMPORAL_SCALES.map(s => kala.decayFactor(elapsed, s));
			const minDecay = Math.min(...decays);
			const maxDecay = Math.max(...decays);
			const score = kala.relevanceScore(NOW - elapsed, NOW);
			expect(score).toBeGreaterThanOrEqual(minDecay * 0 - 0.001); // min possible
			expect(score).toBeLessThanOrEqual(maxDecay + 0.001); // max possible
		});

		it("boost function should be monotonic in both arguments", () => {
			const ts = NOW - DAY;
			// Monotonic in originalScore
			expect(kala.boostScore(0.5, ts, NOW)).toBeLessThan(kala.boostScore(0.9, ts, NOW));
			// Monotonic in recency (more recent = higher)
			expect(kala.boostScore(0.8, NOW - YEAR, NOW)).toBeLessThan(kala.boostScore(0.8, NOW - MINUTE, NOW));
		});

		it("boost should be bounded: 0.5*x <= boost(x,t) <= x (for x > 0)", () => {
			const x = 0.75;
			for (let elapsed = 0; elapsed <= 10 * YEAR; elapsed += MONTH) {
				const boosted = kala.boostScore(x, NOW - elapsed, NOW);
				expect(boosted).toBeGreaterThanOrEqual(x * 0.5 - 0.001);
				expect(boosted).toBeLessThanOrEqual(x + 0.001);
			}
		});
	});

	// ── Quarter calculation ─────────────────────────────────────────────

	describe("quarter calculation", () => {
		it("should compute Q1 for Jan-Mar", () => {
			const janNow = new Date("2026-01-15T12:00:00Z").getTime();
			const ctx = kala.buildContext(makeState({ turnStartedAt: janNow - 1000, sessionStartedAt: janNow - 60000 }), undefined, janNow);
			expect(ctx.quarter.quarter).toBe(1);
		});

		it("should compute Q2 for Apr-Jun", () => {
			const aprNow = new Date("2026-04-15T12:00:00Z").getTime();
			const ctx = kala.buildContext(makeState({ turnStartedAt: aprNow - 1000, sessionStartedAt: aprNow - 60000 }), undefined, aprNow);
			expect(ctx.quarter.quarter).toBe(2);
		});

		it("should compute Q3 for Jul-Sep", () => {
			const julNow = new Date("2026-07-15T12:00:00Z").getTime();
			const ctx = kala.buildContext(makeState({ turnStartedAt: julNow - 1000, sessionStartedAt: julNow - 60000 }), undefined, julNow);
			expect(ctx.quarter.quarter).toBe(3);
		});

		it("should compute Q4 for Oct-Dec", () => {
			const octNow = new Date("2026-10-15T12:00:00Z").getTime();
			const ctx = kala.buildContext(makeState({ turnStartedAt: octNow - 1000, sessionStartedAt: octNow - 60000 }), undefined, octNow);
			expect(ctx.quarter.quarter).toBe(4);
		});
	});

	// ── Practical scenario tests ────────────────────────────────────────

	describe("practical scenarios", () => {
		it("should appropriately rank a 5-minute-old fix over a 30-day-old discussion", () => {
			const recentFix = NOW - 5 * MINUTE;
			const oldDiscussion = NOW - 30 * DAY;

			const recentScore = kala.boostScore(0.7, recentFix, NOW);   // Moderate base, very recent
			const oldScore = kala.boostScore(0.8, oldDiscussion, NOW);  // Good base, old

			// The recent fix should score higher despite lower base score
			expect(recentScore).toBeGreaterThan(oldScore);
		});

		it("should not completely suppress relevant old documents", () => {
			const ancientDoc = NOW - 2 * YEAR;
			const boosted = kala.boostScore(1.0, ancientDoc, NOW);
			// Should still retain at least 50% of its original score
			expect(boosted).toBeGreaterThanOrEqual(0.49);
		});

		it("should identify dominant scale correctly for real-world durations", () => {
			// "I just ran this" → turn
			expect(kala.dominantScale(10_000)).toBe("turn");
			// "Earlier this session" → session
			expect(kala.dominantScale(45 * MINUTE)).toBe("session");
			// "Yesterday" → day
			expect(kala.dominantScale(18 * HOUR)).toBe("day");
			// "Last week" → week
			expect(kala.dominantScale(6 * DAY)).toBe("week");
			// "Last month" → month
			expect(kala.dominantScale(25 * DAY)).toBe("month");
			// "Last quarter" → quarter
			expect(kala.dominantScale(80 * DAY)).toBe("quarter");
			// "Last year" → year
			expect(kala.dominantScale(300 * DAY)).toBe("year");
		});
	});
});
