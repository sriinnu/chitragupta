import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	AnveshanaEngine,
	type SubQuery,
	type RoundResult,
	type MultiRoundResult,
	type MultiRoundConfig,
} from "../src/multi-round-retrieval.js";
import type { HybridSearchEngine, HybridSearchResult } from "../src/hybrid-search.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a mock HybridSearchResult. */
function mockResult(
	id: string,
	title: string,
	content: string,
	score: number,
): HybridSearchResult {
	return { id, title, content, sources: ["bm25"], score, ranks: { bm25: 1 } };
}

/** Create a mock HybridSearchEngine with configurable per-query responses. */
function createMockHybrid(
	responses?: Record<string, HybridSearchResult[]>,
): HybridSearchEngine {
	const defaultResults: HybridSearchResult[] = [
		mockResult("doc-1", "Auth Design", "JWT auth with refresh tokens", 0.8),
		mockResult("doc-2", "API Layer", "REST endpoints for user service", 0.6),
		mockResult("doc-3", "Session Mgmt", "Redis-backed sessions", 0.4),
	];

	return {
		search: vi.fn().mockImplementation(async (query: string) => {
			if (responses && responses[query]) {
				return responses[query];
			}
			// For unknown queries, return a subset based on query to simulate relevance.
			if (query.toLowerCase().includes("auth")) {
				return [defaultResults[0], defaultResults[2]];
			}
			if (query.toLowerCase().includes("api")) {
				return [defaultResults[1]];
			}
			return defaultResults;
		}),
	} as unknown as HybridSearchEngine;
}

// ─── isComplexQuery ─────────────────────────────────────────────────────────

describe("AnveshanaEngine", () => {
	let engine: AnveshanaEngine;
	let mockHybrid: HybridSearchEngine;

	beforeEach(() => {
		mockHybrid = createMockHybrid();
		engine = new AnveshanaEngine(mockHybrid);
	});

	describe("isComplexQuery", () => {
		it("should return false for simple short queries", () => {
			expect(engine.isComplexQuery("auth design")).toBe(false);
			expect(engine.isComplexQuery("find files")).toBe(false);
			expect(engine.isComplexQuery("JWT tokens")).toBe(false);
		});

		it("should return true for queries with conjunctions", () => {
			expect(engine.isComplexQuery("auth and API changes")).toBe(true);
			expect(engine.isComplexQuery("sessions that expire")).toBe(true);
			expect(engine.isComplexQuery("users which are banned")).toBe(true);
		});

		it("should return true for queries exceeding word threshold", () => {
			expect(engine.isComplexQuery(
				"what architecture decisions did we make about the auth layer",
			)).toBe(true);
		});

		it("should return true for temporal queries", () => {
			expect(engine.isComplexQuery("decisions before last week")).toBe(true);
			expect(engine.isComplexQuery("changes after deploy")).toBe(true);
			expect(engine.isComplexQuery("recently updated files")).toBe(true);
		});

		it("should return true for comparative queries", () => {
			expect(engine.isComplexQuery("REST vs GraphQL")).toBe(true);
			expect(engine.isComplexQuery("React compared to Vue")).toBe(true);
		});

		it("should return true for queries with multiple quoted terms", () => {
			expect(engine.isComplexQuery('"auth" and "sessions"')).toBe(true);
		});

		it("should return true for queries with multiple named entities", () => {
			expect(engine.isComplexQuery("changes in Redis and Postgres")).toBe(true);
		});
	});

	// ─── decompose ────────────────────────────────────────────────────────────

	describe("decompose", () => {
		it("should return just the original for simple queries", () => {
			const result = engine.decompose("auth design");
			expect(result).toHaveLength(1);
			expect(result[0].query).toBe("auth design");
			expect(result[0].weight).toBe(1.0);
			expect(result[0].intent).toBe("original query");
		});

		it("should decompose compound queries with conjunctions", () => {
			const result = engine.decompose("auth decisions and API layer changes");
			expect(result.length).toBeGreaterThanOrEqual(2);

			// Original query is always first with weight 1.0.
			expect(result[0].weight).toBe(1.0);

			// Should have sub-queries derived from splitting on "and".
			const queries = result.map((r) => r.query);
			expect(queries[0]).toBe("auth decisions and API layer changes");
		});

		it("should decompose comparative queries (vs)", () => {
			const result = engine.decompose("REST vs GraphQL decisions");
			expect(result.length).toBeGreaterThanOrEqual(2);

			const queries = result.map((r) => r.query.toLowerCase());
			expect(queries).toContain("rest vs graphql decisions");

			// Should have extracted the two sides of comparison.
			const nonOriginal = result.filter((r) => r.intent !== "original query");
			expect(nonOriginal.length).toBeGreaterThanOrEqual(2);
		});

		it("should decompose multi-entity list queries", () => {
			const result = engine.decompose(
				"authentication, authorization, and session management",
			);
			expect(result.length).toBeGreaterThanOrEqual(3);

			// Should contain entities from the comma-separated list.
			const queries = result.map((r) => r.query.toLowerCase());
			expect(queries.some((q) => q.includes("authentication"))).toBe(true);
			expect(queries.some((q) => q.includes("authorization"))).toBe(true);
			expect(queries.some((q) => q.includes("session management"))).toBe(true);
		});

		it("should assign decreasing weights to later sub-queries", () => {
			const result = engine.decompose("auth decisions and API layer changes");
			if (result.length >= 2) {
				// Original is always weight 1.0.
				expect(result[0].weight).toBe(1.0);
				// Subsequent sub-queries should have lower weights.
				for (let i = 1; i < result.length; i++) {
					expect(result[i].weight).toBeLessThanOrEqual(1.0);
					expect(result[i].weight).toBeGreaterThanOrEqual(0.4);
				}
			}
		});

		it("should return empty array for empty query", () => {
			expect(engine.decompose("")).toHaveLength(0);
			expect(engine.decompose("   ")).toHaveLength(0);
		});

		it("should respect maxSubQueries config", () => {
			const limited = new AnveshanaEngine(mockHybrid, { maxSubQueries: 2 });
			const result = limited.decompose(
				"authentication, authorization, sessions, and tokens",
			);
			expect(result.length).toBeLessThanOrEqual(2);
		});
	});

	// ─── search — simple query ────────────────────────────────────────────────

	describe("search - simple query", () => {
		it("should delegate directly to hybrid search without decomposition", async () => {
			const results = await engine.search("auth design");
			expect(mockHybrid.search).toHaveBeenCalledTimes(1);
			expect(mockHybrid.search).toHaveBeenCalledWith("auth design");

			// Results should pass through from hybrid search.
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].foundBy).toEqual(["auth design"]);
		});

		it("should record correct stats for simple query", async () => {
			await engine.search("auth");
			const stats = engine.getLastSearchStats();
			expect(stats).not.toBeNull();
			expect(stats!.totalRounds).toBe(1);
			expect(stats!.subQueriesGenerated).toBe(0);
		});
	});

	// ─── search — complex query ───────────────────────────────────────────────

	describe("search - complex query", () => {
		it("should decompose and run multiple sub-queries", async () => {
			const results = await engine.search("auth decisions and API layer changes");

			// Should have called hybrid search multiple times (original + decomposed).
			expect(vi.mocked(mockHybrid.search).mock.calls.length).toBeGreaterThan(1);

			// Should return fused results.
			expect(results.length).toBeGreaterThan(0);
		});

		it("should respect maxResults config", async () => {
			const limited = new AnveshanaEngine(mockHybrid, { maxResults: 2 });
			const results = await limited.search(
				"auth decisions and API layer changes and session management",
			);
			expect(results.length).toBeLessThanOrEqual(2);
		});
	});

	// ─── fuseResults ──────────────────────────────────────────────────────────

	describe("fuseResults", () => {
		it("should deduplicate documents found by multiple sub-queries", () => {
			const rounds: RoundResult[] = [
				{
					subQuery: { query: "auth", intent: "test", weight: 1.0 },
					results: [
						{
							id: "doc-1", title: "Auth", content: "JWT auth",
							foundBy: ["auth"], score: 0.8,
							roundScores: [{ query: "auth", score: 0.8 }],
						},
					],
					round: 0,
				},
				{
					subQuery: { query: "API", intent: "test", weight: 0.8 },
					results: [
						{
							id: "doc-1", title: "Auth", content: "JWT auth",
							foundBy: ["API"], score: 0.6,
							roundScores: [{ query: "API", score: 0.6 }],
						},
						{
							id: "doc-2", title: "API Layer", content: "REST endpoints",
							foundBy: ["API"], score: 0.5,
							roundScores: [{ query: "API", score: 0.5 }],
						},
					],
					round: 0,
				},
			];

			const fused = engine.fuseResults(rounds);

			// doc-1 should appear once (deduplicated), with boosted score.
			const doc1 = fused.find((r) => r.id === "doc-1");
			expect(doc1).toBeDefined();
			expect(doc1!.foundBy).toContain("auth");
			expect(doc1!.foundBy).toContain("API");

			// doc-1 should have a higher score due to multi-query boost.
			const doc2 = fused.find((r) => r.id === "doc-2");
			expect(doc2).toBeDefined();
			expect(doc1!.score).toBeGreaterThan(doc2!.score);
		});

		it("should apply multi-query boost correctly", () => {
			const rounds: RoundResult[] = [
				{
					subQuery: { query: "auth", intent: "test", weight: 1.0 },
					results: [{
						id: "doc-1", title: "Auth", content: "JWT",
						foundBy: ["auth"], score: 1.0,
						roundScores: [{ query: "auth", score: 1.0 }],
					}],
					round: 0,
				},
				{
					subQuery: { query: "tokens", intent: "test", weight: 1.0 },
					results: [{
						id: "doc-1", title: "Auth", content: "JWT",
						foundBy: ["tokens"], score: 1.0,
						roundScores: [{ query: "tokens", score: 1.0 }],
					}],
					round: 0,
				},
			];

			const fused = engine.fuseResults(rounds);
			const doc1 = fused.find((r) => r.id === "doc-1")!;

			// Found by 2 queries: score = (1.0*1.0 + 1.0*1.0) * 1.3^(2-1) = 2.0 * 1.3 = 2.6
			expect(doc1.score).toBeCloseTo(2.6, 4);
		});

		it("should pass through single-round results without boost", () => {
			const rounds: RoundResult[] = [
				{
					subQuery: { query: "auth", intent: "test", weight: 1.0 },
					results: [{
						id: "doc-1", title: "Auth", content: "JWT",
						foundBy: ["auth"], score: 0.8,
						roundScores: [{ query: "auth", score: 0.8 }],
					}],
					round: 0,
				},
			];

			const fused = engine.fuseResults(rounds);
			expect(fused).toHaveLength(1);
			// No multi-query boost: score = 0.8 * 1.0 * 1.0 = 0.8
			expect(fused[0].score).toBeCloseTo(0.8, 4);
			expect(fused[0].foundBy).toEqual(["auth"]);
		});

		it("should sort results by fused score descending", () => {
			const rounds: RoundResult[] = [
				{
					subQuery: { query: "test", intent: "test", weight: 1.0 },
					results: [
						{
							id: "low", title: "Low", content: "...",
							foundBy: ["test"], score: 0.2,
							roundScores: [{ query: "test", score: 0.2 }],
						},
						{
							id: "high", title: "High", content: "...",
							foundBy: ["test"], score: 0.9,
							roundScores: [{ query: "test", score: 0.9 }],
						},
					],
					round: 0,
				},
			];

			const fused = engine.fuseResults(rounds);
			expect(fused[0].id).toBe("high");
			expect(fused[1].id).toBe("low");
		});
	});

	// ─── generateFollowUp ─────────────────────────────────────────────────────

	describe("generateFollowUp", () => {
		it("should produce sub-queries for missing concepts", () => {
			const currentResults: MultiRoundResult[] = [
				{
					id: "doc-1", title: "Auth Design", content: "JWT auth tokens",
					foundBy: ["auth"], score: 0.8,
					roundScores: [{ query: "auth", score: 0.8 }],
				},
			];

			const previousSubQueries: SubQuery[] = [
				{ query: "auth decisions", intent: "original", weight: 1.0 },
			];

			const followUps = engine.generateFollowUp(
				"auth decisions and API layer architecture",
				currentResults,
				previousSubQueries,
			);

			// "API", "layer", "architecture" are not in current results.
			expect(followUps.length).toBeGreaterThan(0);

			// Follow-up queries should NOT duplicate previous queries.
			const prevTexts = new Set(previousSubQueries.map((sq) => sq.query.toLowerCase()));
			for (const fu of followUps) {
				expect(prevTexts.has(fu.query.toLowerCase())).toBe(false);
			}
		});

		it("should return empty when all concepts are covered", () => {
			const currentResults: MultiRoundResult[] = [
				{
					id: "doc-1", title: "Auth Design",
					content: "JWT auth tokens decisions in the API layer architecture",
					foundBy: ["auth"], score: 0.8,
					roundScores: [{ query: "auth", score: 0.8 }],
				},
			];

			const previousSubQueries: SubQuery[] = [
				{ query: "auth decisions", intent: "original", weight: 1.0 },
				{ query: "API", intent: "gap", weight: 0.6 },
				{ query: "layer", intent: "gap", weight: 0.6 },
				{ query: "architecture", intent: "gap", weight: 0.6 },
			];

			const followUps = engine.generateFollowUp(
				"auth decisions and API layer architecture",
				currentResults,
				previousSubQueries,
			);

			expect(followUps).toHaveLength(0);
		});

		it("should assign follow-up weight of 0.6", () => {
			const followUps = engine.generateFollowUp(
				"authentication and database migrations",
				[],
				[{ query: "authentication", intent: "original", weight: 1.0 }],
			);

			for (const fu of followUps) {
				expect(fu.weight).toBe(0.6);
			}
		});
	});

	// ─── Adaptive termination ─────────────────────────────────────────────────

	describe("adaptive termination", () => {
		it("should stop early when no improvement is found", async () => {
			// Create a mock that always returns the exact same results.
			const staticResults: HybridSearchResult[] = [
				mockResult("doc-1", "Auth", "JWT auth", 0.8),
			];
			const staticHybrid = {
				search: vi.fn().mockResolvedValue(staticResults),
			} as unknown as HybridSearchEngine;

			const adaptiveEngine = new AnveshanaEngine(staticHybrid, {
				maxRounds: 5,
				adaptiveTermination: true,
				improvementThreshold: 0.05,
			});

			await adaptiveEngine.search(
				"auth decisions and API layer changes that affected sessions",
			);

			const stats = adaptiveEngine.getLastSearchStats();
			expect(stats).not.toBeNull();

			// Should have terminated before maxRounds (5).
			// With static results, follow-up generation should yield no new docs,
			// triggering early termination.
			expect(stats!.totalRounds).toBeLessThanOrEqual(5);
		});
	});

	// ─── getLastSearchStats ───────────────────────────────────────────────────

	describe("getLastSearchStats", () => {
		it("should return null before any search", () => {
			expect(engine.getLastSearchStats()).toBeNull();
		});

		it("should return correct stats after simple search", async () => {
			await engine.search("auth");
			const stats = engine.getLastSearchStats();
			expect(stats).not.toBeNull();
			expect(stats!.totalRounds).toBe(1);
			expect(stats!.subQueriesGenerated).toBe(0);
			expect(stats!.resultsAfter).toBeGreaterThan(0);
		});

		it("should return correct stats after complex search", async () => {
			await engine.search("auth decisions and API layer changes");
			const stats = engine.getLastSearchStats();
			expect(stats).not.toBeNull();
			expect(stats!.totalRounds).toBeGreaterThanOrEqual(1);
			expect(stats!.subQueriesGenerated).toBeGreaterThan(0);
			expect(stats!.resultsAfter).toBeGreaterThan(0);
		});

		it("should update stats on subsequent searches", async () => {
			await engine.search("auth");
			const stats1 = engine.getLastSearchStats();

			await engine.search("auth decisions and API layer changes");
			const stats2 = engine.getLastSearchStats();

			// Stats should have changed.
			expect(stats2!.subQueriesGenerated).toBeGreaterThan(stats1!.subQueriesGenerated);
		});
	});
});
