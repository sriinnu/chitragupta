/**
 * Natasha Observer — Tests
 * Tests for the temporal trending engine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NatashaObserver } from "../src/natasha-observer.js";
import type { NatashaDb } from "../src/natasha-types.js";

// ─── Mock Database ──────────────────────────────────────────────────────────

/** Create a mock database with configurable query results. */
function createMockDb(overrides?: {
	entityMentions?: Record<string, Array<{ entity: string; cnt: number }>>;
	errorFrequency?: Record<string, Array<{
		error_signature: string;
		description: string;
		solution: string | null;
		cnt: number;
		last_seen: string;
	}>>;
	sessionCount?: Record<string, number>;
	turnCount?: Record<string, number>;
}): NatashaDb {
	return {
		prepare(sql: string) {
			return {
				all(...params: unknown[]) {
					const key = `${params[0]}-${params[1]}`;
					if (sql.includes("akasha_traces")) {
						return overrides?.entityMentions?.[key] ?? [];
					}
					if (sql.includes("episodes")) {
						return overrides?.errorFrequency?.[key] ?? [];
					}
					return [];
				},
				get(...params: unknown[]) {
					const key = `${params[0]}-${params[1]}`;
					if (sql.includes("SUM")) {
						return { cnt: overrides?.turnCount?.[key] ?? 0 };
					}
					if (sql.includes("COUNT")) {
						return { cnt: overrides?.sessionCount?.[key] ?? 0 };
					}
					return { cnt: 0 };
				},
			};
		},
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("NatashaObserver", () => {
	const NOW = new Date("2026-03-04T12:00:00Z").getTime();

	describe("detectTrends", () => {
		it("detects rising trends when current count exceeds previous", () => {
			const dayMs = 86_400_000;
			const currentStartMs = NOW - dayMs;
			const currentEndMs = NOW;
			const prevStartMs = NOW - 2 * dayMs;
			const prevEndMs = currentStartMs;

			const db = createMockDb({
				entityMentions: {
					[`${currentStartMs}-${currentEndMs}`]: [
						{ entity: "typescript", cnt: 10 },
					],
					[`${prevStartMs}-${prevEndMs}`]: [
						{ entity: "typescript", cnt: 3 },
					],
				},
			});

			const natasha = new NatashaObserver(db);
			const trends = natasha.detectTrends("day", NOW);

			expect(trends.length).toBeGreaterThanOrEqual(1);
			const ts = trends.find((t) => t.entity === "typescript");
			expect(ts?.direction).toBe("rising");
			expect(ts?.changePercent).toBeGreaterThan(0);
		});

		it("detects falling trends when current count is zero", () => {
			const dayMs = 86_400_000;
			const currentStartMs = NOW - dayMs;
			const currentEndMs = NOW;
			const prevStartMs = NOW - 2 * dayMs;
			const prevEndMs = currentStartMs;

			const db = createMockDb({
				entityMentions: {
					[`${currentStartMs}-${currentEndMs}`]: [],
					[`${prevStartMs}-${prevEndMs}`]: [
						{ entity: "python", cnt: 5 },
					],
				},
			});

			const natasha = new NatashaObserver(db);
			const trends = natasha.detectTrends("day", NOW);

			const ts = trends.find((t) => t.entity === "python");
			expect(ts?.direction).toBe("falling");
			expect(ts?.changePercent).toBe(-100);
		});

		it("ignores entities below minimum count threshold", () => {
			const dayMs = 86_400_000;
			const currentStartMs = NOW - dayMs;
			const currentEndMs = NOW;
			const prevStartMs = NOW - 2 * dayMs;
			const prevEndMs = currentStartMs;

			const db = createMockDb({
				entityMentions: {
					[`${currentStartMs}-${currentEndMs}`]: [
						{ entity: "obscure", cnt: 1 },
					],
					[`${prevStartMs}-${prevEndMs}`]: [],
				},
			});

			const natasha = new NatashaObserver(db, { minCountThreshold: 3 });
			const trends = natasha.detectTrends("day", NOW);

			expect(trends.find((t) => t.entity === "obscure")).toBeUndefined();
		});

		it("ignores changes below minimum change percent", () => {
			const dayMs = 86_400_000;
			const currentStartMs = NOW - dayMs;
			const currentEndMs = NOW;
			const prevStartMs = NOW - 2 * dayMs;
			const prevEndMs = currentStartMs;

			const db = createMockDb({
				entityMentions: {
					[`${currentStartMs}-${currentEndMs}`]: [
						{ entity: "stable", cnt: 10 },
					],
					[`${prevStartMs}-${prevEndMs}`]: [
						{ entity: "stable", cnt: 9 },
					],
				},
			});

			const natasha = new NatashaObserver(db, { minChangePercent: 25 });
			const trends = natasha.detectTrends("day", NOW);

			// ~11% change is below 25% threshold
			expect(trends.find((t) => t.entity === "stable")).toBeUndefined();
		});
	});

	describe("detectAllTrends", () => {
		it("returns trends for all four windows", () => {
			const db = createMockDb();
			const natasha = new NatashaObserver(db);
			const allTrends = natasha.detectAllTrends(NOW);

			expect(allTrends.size).toBe(4);
			expect(allTrends.has("hour")).toBe(true);
			expect(allTrends.has("day")).toBe(true);
			expect(allTrends.has("week")).toBe(true);
			expect(allTrends.has("month")).toBe(true);
		});
	});

	describe("detectRegressions", () => {
		it("detects a regression when error appears after being absent", () => {
			const dayMs = 86_400_000;
			const currentStart = new Date(NOW - dayMs).toISOString();
			const currentEnd = new Date(NOW).toISOString();
			const prevStart = new Date(NOW - 2 * dayMs).toISOString();

			const db = createMockDb({
				errorFrequency: {
					[`${currentStart}-${currentEnd}`]: [
						{
							error_signature: "TypeError: x is not a function",
							description: "Type error in handler",
							solution: "Check import statement",
							cnt: 3,
							last_seen: "2026-03-04T10:00:00Z",
						},
					],
					[`${prevStart}-${currentStart}`]: [],
				},
			});

			const natasha = new NatashaObserver(db);
			const regressions = natasha.detectRegressions("day", NOW);

			expect(regressions.length).toBe(1);
			expect(regressions[0].errorSignature).toBe("TypeError: x is not a function");
			expect(regressions[0].severity).toBe("critical");
			expect(regressions[0].knownFix).toBe("Check import statement");
		});

		it("classifies severity based on occurrence count", () => {
			const dayMs = 86_400_000;
			const currentStart = new Date(NOW - dayMs).toISOString();
			const currentEnd = new Date(NOW).toISOString();
			const prevStart = new Date(NOW - 2 * dayMs).toISOString();

			const db = createMockDb({
				errorFrequency: {
					[`${currentStart}-${currentEnd}`]: [
						{
							error_signature: "minor-error",
							description: "Minor issue",
							solution: null,
							cnt: 1,
							last_seen: "2026-03-04T10:00:00Z",
						},
					],
					[`${prevStart}-${currentStart}`]: [],
				},
			});

			const natasha = new NatashaObserver(db);
			const regressions = natasha.detectRegressions("day", NOW);

			expect(regressions[0]?.severity).toBe("info");
		});
	});

	describe("measureVelocity", () => {
		it("computes velocity metrics for a window", () => {
			const dayMs = 86_400_000;
			const currentStartMs = NOW - dayMs;
			const currentEndMs = NOW;
			const prevStartMs = NOW - 2 * dayMs;
			const prevEndMs = currentStartMs;

			const db = createMockDb({
				sessionCount: {
					[`${currentStartMs}-${currentEndMs}`]: 5,
					[`${prevStartMs}-${prevEndMs}`]: 3,
				},
				turnCount: {
					[`${currentStartMs}-${currentEndMs}`]: 50,
					[`${prevStartMs}-${prevEndMs}`]: 30,
				},
			});

			const natasha = new NatashaObserver(db);
			const velocity = natasha.measureVelocity("day", NOW);

			expect(velocity.sessionCount).toBe(5);
			expect(velocity.totalTurns).toBe(50);
			expect(velocity.avgTurnsPerSession).toBe(10);
			expect(velocity.velocityDelta).toBeGreaterThan(0);
		});

		it("returns zero delta when both periods are empty", () => {
			const db = createMockDb();
			const natasha = new NatashaObserver(db);
			const velocity = natasha.measureVelocity("day", NOW);

			expect(velocity.velocityDelta).toBe(0);
			expect(velocity.sessionCount).toBe(0);
		});
	});

	describe("observe", () => {
		it("returns a comprehensive summary", () => {
			const db = createMockDb();
			const natasha = new NatashaObserver(db);
			const summary = natasha.observe(NOW);

			expect(summary.trends).toBeDefined();
			expect(summary.regressions).toBeDefined();
			expect(summary.velocity).toBeDefined();
			expect(summary.observedAt).toBeDefined();
		});
	});
});
