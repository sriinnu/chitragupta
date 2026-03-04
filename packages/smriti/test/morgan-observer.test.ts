/**
 * Morgan Observer — Tests
 * Tests for the temporal trending engine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MorganObserver } from "../src/morgan-observer.js";
import type { MorganDb } from "../src/morgan-types.js";

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
}): MorganDb {
	return {
		prepare(sql: string) {
			return {
				all(...params: unknown[]) {
					const key = `${params[0]}-${params[1]}`;
					if (sql.includes("memory")) {
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

describe("MorganObserver", () => {
	const NOW = new Date("2026-03-04T12:00:00Z").getTime();

	describe("detectTrends", () => {
		it("detects rising trends when current count exceeds previous", () => {
			const dayMs = 86_400_000;
			const currentStart = new Date(NOW - dayMs).toISOString();
			const currentEnd = new Date(NOW).toISOString();
			const prevStart = new Date(NOW - 2 * dayMs).toISOString();

			const db = createMockDb({
				entityMentions: {
					[`${currentStart}-${currentEnd}`]: [
						{ entity: "typescript", cnt: 10 },
					],
					[`${prevStart}-${currentStart}`]: [
						{ entity: "typescript", cnt: 3 },
					],
				},
			});

			const morgan = new MorganObserver(db);
			const trends = morgan.detectTrends("day", NOW);

			expect(trends.length).toBeGreaterThanOrEqual(1);
			const ts = trends.find((t) => t.entity === "typescript");
			expect(ts?.direction).toBe("rising");
			expect(ts?.changePercent).toBeGreaterThan(0);
		});

		it("detects falling trends when current count is zero", () => {
			const dayMs = 86_400_000;
			const currentStart = new Date(NOW - dayMs).toISOString();
			const currentEnd = new Date(NOW).toISOString();
			const prevStart = new Date(NOW - 2 * dayMs).toISOString();

			const db = createMockDb({
				entityMentions: {
					[`${currentStart}-${currentEnd}`]: [],
					[`${prevStart}-${currentStart}`]: [
						{ entity: "python", cnt: 5 },
					],
				},
			});

			const morgan = new MorganObserver(db);
			const trends = morgan.detectTrends("day", NOW);

			const ts = trends.find((t) => t.entity === "python");
			expect(ts?.direction).toBe("falling");
			expect(ts?.changePercent).toBe(-100);
		});

		it("ignores entities below minimum count threshold", () => {
			const dayMs = 86_400_000;
			const currentStart = new Date(NOW - dayMs).toISOString();
			const currentEnd = new Date(NOW).toISOString();
			const prevStart = new Date(NOW - 2 * dayMs).toISOString();

			const db = createMockDb({
				entityMentions: {
					[`${currentStart}-${currentEnd}`]: [
						{ entity: "obscure", cnt: 1 },
					],
					[`${prevStart}-${currentStart}`]: [],
				},
			});

			const morgan = new MorganObserver(db, { minCountThreshold: 3 });
			const trends = morgan.detectTrends("day", NOW);

			expect(trends.find((t) => t.entity === "obscure")).toBeUndefined();
		});

		it("ignores changes below minimum change percent", () => {
			const dayMs = 86_400_000;
			const currentStart = new Date(NOW - dayMs).toISOString();
			const currentEnd = new Date(NOW).toISOString();
			const prevStart = new Date(NOW - 2 * dayMs).toISOString();

			const db = createMockDb({
				entityMentions: {
					[`${currentStart}-${currentEnd}`]: [
						{ entity: "stable", cnt: 10 },
					],
					[`${prevStart}-${currentStart}`]: [
						{ entity: "stable", cnt: 9 },
					],
				},
			});

			const morgan = new MorganObserver(db, { minChangePercent: 25 });
			const trends = morgan.detectTrends("day", NOW);

			// ~11% change is below 25% threshold
			expect(trends.find((t) => t.entity === "stable")).toBeUndefined();
		});
	});

	describe("detectAllTrends", () => {
		it("returns trends for all four windows", () => {
			const db = createMockDb();
			const morgan = new MorganObserver(db);
			const allTrends = morgan.detectAllTrends(NOW);

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

			const morgan = new MorganObserver(db);
			const regressions = morgan.detectRegressions("day", NOW);

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

			const morgan = new MorganObserver(db);
			const regressions = morgan.detectRegressions("day", NOW);

			expect(regressions[0]?.severity).toBe("info");
		});
	});

	describe("measureVelocity", () => {
		it("computes velocity metrics for a window", () => {
			const dayMs = 86_400_000;
			const currentStart = new Date(NOW - dayMs).toISOString();
			const currentEnd = new Date(NOW).toISOString();
			const prevStart = new Date(NOW - 2 * dayMs).toISOString();

			const db = createMockDb({
				sessionCount: {
					[`${currentStart}-${currentEnd}`]: 5,
					[`${prevStart}-${currentStart}`]: 3,
				},
				turnCount: {
					[`${currentStart}-${currentEnd}`]: 50,
					[`${prevStart}-${currentStart}`]: 30,
				},
			});

			const morgan = new MorganObserver(db);
			const velocity = morgan.measureVelocity("day", NOW);

			expect(velocity.sessionCount).toBe(5);
			expect(velocity.totalTurns).toBe(50);
			expect(velocity.avgTurnsPerSession).toBe(10);
			expect(velocity.velocityDelta).toBeGreaterThan(0);
		});

		it("returns zero delta when both periods are empty", () => {
			const db = createMockDb();
			const morgan = new MorganObserver(db);
			const velocity = morgan.measureVelocity("day", NOW);

			expect(velocity.velocityDelta).toBe(0);
			expect(velocity.sessionCount).toBe(0);
		});
	});

	describe("observe", () => {
		it("returns a comprehensive summary", () => {
			const db = createMockDb();
			const morgan = new MorganObserver(db);
			const summary = morgan.observe(NOW);

			expect(summary.trends).toBeDefined();
			expect(summary.regressions).toBeDefined();
			expect(summary.velocity).toBeDefined();
			expect(summary.observedAt).toBeDefined();
		});
	});
});
