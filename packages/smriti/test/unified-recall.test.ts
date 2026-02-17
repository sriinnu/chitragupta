/**
 * @chitragupta/smriti — Unified Recall Engine tests.
 *
 * Tests:
 *   - Basic recall with empty/single/multi-layer results
 *   - Turn search integration (FTS5 session search + loadSession + scoring)
 *   - Memory search integration (searchMemory + score boost)
 *   - Day file search integration (searchDayFiles + fixed score)
 *   - Result ranking and limiting
 *   - Deduplication (sessionId + snippet prefix)
 *   - Options filtering (includeMemory, includeDayFiles, project)
 *   - Error resilience (Promise.allSettled)
 *   - Edge cases (short queries, empty turns, term filtering)
 *
 * NOTE: We use vi.spyOn (not vi.mock) for search.js because vitest has a race
 * condition with concurrent dynamic imports: when Promise.allSettled runs three
 * async functions that each do `await import("./search.js")`, the mock module
 * is not reliably returned for all concurrent callers. vi.spyOn modifies the
 * module's exports in-place, so concurrent dynamic imports all see the spy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock heavy infrastructure to prevent SQLite loading ─────────────────────

vi.mock("../src/db/database.js", () => ({
	DatabaseManager: {
		instance: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(undefined),
		}),
	},
}));

vi.mock("../src/db/schema.js", () => ({
	initAgentSchema: vi.fn(),
	initGraphSchema: vi.fn(),
	initVectorsSchema: vi.fn(),
}));

vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: () => "/tmp/test-chitragupta-unified-recall",
	SessionError: class SessionError extends Error {
		constructor(msg: string) {
			super(msg);
			this.name = "SessionError";
		}
	},
}));

// ─── Mock hybrid search infrastructure ──────────────────────────────────────
// By default, hybrid returns [] so FTS5 fallback path is exercised.
// Tests in the "hybrid search integration" block override this.
let mockHybridSearchResults: Array<{
	id: string; title: string; content: string;
	sources: Array<"bm25" | "vector" | "graphrag">; score: number;
	ranks: { bm25?: number; vector?: number; graphrag?: number };
}> = [];

vi.mock("../src/hybrid-search.js", () => ({
	HybridSearchEngine: class MockHybridSearchEngine {
		async search() { return mockHybridSearchResults; }
	},
}));

vi.mock("../src/recall.js", () => ({
	RecallEngine: class MockRecallEngine {},
}));

vi.mock("../src/graphrag.js", () => ({
	GraphRAGEngine: class MockGraphRAGEngine {},
}));

// ─── Import real modules, then spy on their exports ──────────────────────────

import * as searchModule from "../src/search.js";
import * as sessionStoreModule from "../src/session-store.js";
import * as dayConsolidationModule from "../src/day-consolidation.js";
import { recall } from "../src/unified-recall.js";
import type { RecallAnswer } from "../src/unified-recall.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal SessionMeta for mocking. */
function makeMeta(overrides: Partial<{
	id: string;
	project: string;
	created: string;
	provider: string;
	agent: string;
}> = {}) {
	return {
		id: overrides.id ?? "session-2025-01-15-abcd",
		title: "Test session",
		created: overrides.created ?? "2025-01-15T10:30:00Z",
		updated: "2025-01-15T11:00:00Z",
		agent: overrides.agent ?? "claude",
		model: "opus",
		provider: overrides.provider,
		project: overrides.project ?? "/home/user/my-project",
		parent: null,
		branch: "main",
		tags: [],
		totalCost: 0,
		totalTokens: 0,
	};
}

/** Build a minimal Session object with turns. */
function makeSession(turns: Array<{ role: "user" | "assistant"; content: string }>) {
	return {
		meta: makeMeta(),
		turns: turns.map((t, i) => ({
			turnNumber: i + 1,
			role: t.role,
			content: t.content,
		})),
	};
}

/** Build a minimal MemoryResult for mocking. */
function makeMemoryResult(content: string, relevance?: number) {
	return {
		scope: { type: "global" as const },
		content,
		relevance,
	};
}

/** Build a day file search result for mocking. */
function makeDayFileResult(date: string, matchTexts: Array<{ line: number; text: string }>) {
	return { date, matches: matchTexts };
}

// ─── Spy setup ───────────────────────────────────────────────────────────────

let spySearchSessions: ReturnType<typeof vi.spyOn>;
let spySearchMemory: ReturnType<typeof vi.spyOn>;
let spyLoadSession: ReturnType<typeof vi.spyOn>;
let spySearchDayFiles: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.restoreAllMocks();
	mockHybridSearchResults = []; // Reset hybrid to empty → FTS5 fallback used

	spySearchSessions = vi.spyOn(searchModule, "searchSessions").mockReturnValue([]);
	spySearchMemory = vi.spyOn(searchModule, "searchMemory").mockReturnValue([]);
	spyLoadSession = vi.spyOn(sessionStoreModule, "loadSession").mockReturnValue({
		meta: makeMeta(),
		turns: [],
	});
	spySearchDayFiles = vi.spyOn(dayConsolidationModule, "searchDayFiles").mockReturnValue([]);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("recall — unified recall engine", () => {
	// ═══════════════════════════════════════════════════════════════════════════
	// 1. Basic Recall
	// ═══════════════════════════════════════════════════════════════════════════

	describe("basic recall", () => {
		it("returns empty array when all layers return nothing", async () => {
			const results = await recall("how to fix yaxis");
			expect(results).toEqual([]);
		});

		it("returns turns results when only sessions match", async () => {
			const meta = makeMeta({ provider: "claude-code" });
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "user", content: "how to fix yaxis interval" },
				{ role: "assistant", content: "You can fix the yaxis by setting the interval property" },
			]));

			const results = await recall("fix yaxis interval");

			expect(results.length).toBe(1);
			expect(results[0].primarySource).toBe("turns");
			expect(results[0].sessionId).toBe(meta.id);
		});

		it("returns memory results when only memory matches", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("Always use pnpm install --force after renames", 0.8),
			]);

			const results = await recall("pnpm install");

			expect(results.length).toBe(1);
			expect(results[0].primarySource).toBe("memory");
			expect(results[0].answer).toMatch(/^From memory:/);
		});

		it("returns dayfile results when only day files match", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-15", [{ line: 10, text: "Fixed the auth bug" }]),
			]);

			const results = await recall("auth bug");

			expect(results.length).toBe(1);
			expect(results[0].primarySource).toBe("dayfile");
			expect(results[0].date).toBe("2025-01-15");
		});

		it("returns combined results from all layers", async () => {
			const meta = makeMeta({ provider: "codex" });
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "The database connection uses pooling for performance" },
			]));
			spySearchMemory.mockReturnValue([
				makeMemoryResult("Database pool size should be 10", 0.7),
			]);
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-10", [{ line: 5, text: "Set database pool to 10" }]),
			]);

			const results = await recall("database pool");

			expect(results.length).toBe(3);
			const sources = results.map((r) => r.primarySource);
			expect(sources).toContain("turns");
			expect(sources).toContain("memory");
			expect(sources).toContain("dayfile");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 2. Turn Search Integration
	// ═══════════════════════════════════════════════════════════════════════════

	describe("turn search integration", () => {
		it("passes query and project to searchSessions", async () => {
			await recall("test query", { project: "/foo/bar" });

			expect(spySearchSessions).toHaveBeenCalledWith("test query", "/foo/bar");
		});

		it("loads each matched session via loadSession", async () => {
			const meta1 = makeMeta({ id: "session-1", project: "/proj1" });
			const meta2 = makeMeta({ id: "session-2", project: "/proj2" });
			spySearchSessions.mockReturnValue([meta1, meta2]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "some relevant content here" },
			]));

			await recall("relevant content");

			expect(spyLoadSession).toHaveBeenCalledWith(meta1.id, meta1.project);
			expect(spyLoadSession).toHaveBeenCalledWith(meta2.id, meta2.project);
		});

		it("scores turns by query term overlap and picks best turn", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "irrelevant content about nothing" },
				{ role: "assistant", content: "you should fix the yaxis by changing interval" },
			]));

			const results = await recall("fix the yaxis");

			expect(results.length).toBe(1);
			// Second turn matches more terms -> selected as best
			expect(results[0].snippet).toContain("fix the yaxis");
		});

		it("filters query terms with length <= 2 during scoring", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "we need to fix the issue" },
			]));

			// "to" and "it" have length <= 2, excluded from scoring
			const results = await recall("to fix it");

			expect(results.length).toBe(1);
			// "fix" matches -> score > 0 (with base boost)
			expect(results[0].score).toBeGreaterThan(0);
		});

		it("truncates snippet to max 300 chars", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			const longContent = "x".repeat(500);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: longContent },
			]));

			const results = await recall("xxx");

			expect(results.length).toBe(1);
			expect(results[0].snippet.length).toBeLessThanOrEqual(300);
		});

		it("builds answer with project name, date, and provider", async () => {
			const meta = makeMeta({
				project: "/home/user/my-cool-project",
				created: "2025-03-20T14:00:00Z",
				provider: "claude-code",
			});
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "the answer about testing is here" },
			]));

			const results = await recall("testing answer");

			expect(results.length).toBe(1);
			expect(results[0].answer).toContain("my-cool-project");
			expect(results[0].answer).toContain("2025-03-20");
			expect(results[0].answer).toContain("claude-code");
			expect(results[0].project).toBe("/home/user/my-cool-project");
			expect(results[0].date).toBe("2025-03-20");
			expect(results[0].provider).toBe("claude-code");
		});

		it("falls back to agent name when provider is undefined", async () => {
			const meta = makeMeta({ agent: "gpt-4", provider: undefined });
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "some matching content here" },
			]));

			const results = await recall("matching content");

			expect(results.length).toBe(1);
			expect(results[0].answer).toContain("gpt-4");
			expect(results[0].provider).toBe("gpt-4");
		});

		it("adds 0.3 base boost to turn scores (capped at 1.0)", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			// All 3 long-enough terms match -> termHits/queryTerms = 1.0
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "always fix the yaxis interval properly" },
			]));

			const results = await recall("fix yaxis interval");

			expect(results.length).toBe(1);
			// score = min(1.0 + 0.3, 1.0) = 1.0
			expect(results[0].score).toBe(1.0);
		});

		it("computes partial term overlap correctly", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			// Only "fix" (>2 chars) matches out of ["fix", "yaxis", "interval"]
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "we should fix it soon" },
			]));

			const results = await recall("fix yaxis interval");

			expect(results.length).toBe(1);
			// termHits = 1 (fix), queryTerms = 3 -> 1/3 + 0.3 base = ~0.633
			expect(results[0].score).toBeCloseTo(1 / 3 + 0.3, 2);
		});

		it("limits session processing to first 10 metas", async () => {
			const metas = Array.from({ length: 15 }, (_, i) =>
				makeMeta({ id: `session-${i}` }),
			);
			spySearchSessions.mockReturnValue(metas);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "matching content" },
			]));

			await recall("matching");

			// loadSession should only be called for the first 10
			expect(spyLoadSession).toHaveBeenCalledTimes(10);
		});

		it("handles sessions with zero turns gracefully", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([]));

			const results = await recall("anything");

			// No turns -> bestTurn = "", bestScore = 0, still pushes a result
			expect(results.length).toBe(1);
			expect(results[0].snippet).toBe("");
		});

		it("returns score 0.3 for zero term overlap (base boost only)", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "user", content: "completely unrelated words" },
			]));

			const results = await recall("fix yaxis interval");

			expect(results.length).toBe(1);
			// 0 term hits -> score = min(0 + 0.3, 1.0) = 0.3
			expect(results[0].score).toBeCloseTo(0.3, 5);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 3. Memory Search Integration
	// ═══════════════════════════════════════════════════════════════════════════

	describe("memory search integration", () => {
		it("calls searchMemory with the query", async () => {
			await recall("how to deploy");

			expect(spySearchMemory).toHaveBeenCalledWith("how to deploy");
		});

		it("prefixes answer with 'From memory:'", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("Use docker compose for deployment", 0.6),
			]);

			const results = await recall("deploy");

			expect(results.length).toBe(1);
			expect(results[0].answer).toBe("From memory: Use docker compose for deployment");
		});

		it("boosts relevance score by 0.1 (capped at 1.0)", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("fact about testing", 0.7),
			]);

			const results = await recall("testing");

			expect(results.length).toBe(1);
			expect(results[0].score).toBeCloseTo(0.8, 5); // 0.7 + 0.1
		});

		it("caps boosted score at 1.0", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("high relevance fact", 0.95),
			]);

			const results = await recall("something");

			expect(results[0].score).toBe(1.0); // min(0.95 + 0.1, 1.0)
		});

		it("uses default relevance of 0.5 when relevance is undefined", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("some fact", undefined),
			]);

			const results = await recall("something");

			expect(results[0].score).toBeCloseTo(0.6, 5); // 0.5 + 0.1
		});

		it("truncates memory content in snippet to 300 chars", async () => {
			const longContent = "y".repeat(500);
			spySearchMemory.mockReturnValue([
				makeMemoryResult(longContent, 0.5),
			]);

			const results = await recall("test");

			expect(results[0].snippet.length).toBeLessThanOrEqual(300);
			expect(results[0].answer.length).toBeLessThanOrEqual("From memory: ".length + 300);
		});

		it("limits memory results to 5 before adding", async () => {
			const memResults = Array.from({ length: 10 }, (_, i) =>
				makeMemoryResult(`fact number ${i} is unique and different`, 0.5),
			);
			spySearchMemory.mockReturnValue(memResults);

			const results = await recall("test", { limit: 20 });

			// searchMemoryLayer slices to 5 internally
			const memoryResults = results.filter((r) => r.primarySource === "memory");
			expect(memoryResults.length).toBeLessThanOrEqual(5);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 4. Day File Search Integration
	// ═══════════════════════════════════════════════════════════════════════════

	describe("day file search integration", () => {
		it("calls searchDayFiles with query and limit", async () => {
			await recall("deploy issue", { limit: 3 });

			expect(spySearchDayFiles).toHaveBeenCalledWith("deploy issue", { limit: 3 });
		});

		it("uses default limit of 5 when not specified", async () => {
			await recall("deploy issue");

			expect(spySearchDayFiles).toHaveBeenCalledWith("deploy issue", { limit: 5 });
		});

		it("assigns fixed score of 0.5 to day file results", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-02-01", [{ line: 1, text: "deployed app" }]),
			]);

			const results = await recall("deploy");

			expect(results.length).toBe(1);
			expect(results[0].score).toBe(0.5);
		});

		it("includes date in the answer and result", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-06-15", [{ line: 1, text: "migrated database" }]),
			]);

			const results = await recall("database");

			expect(results[0].answer).toContain("2025-06-15");
			expect(results[0].date).toBe("2025-06-15");
		});

		it("joins multiple matches with pipe separator in answer", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-20", [
					{ line: 1, text: "first match" },
					{ line: 5, text: "second match" },
				]),
			]);

			const results = await recall("test");

			// answer = "On 2025-01-20: first match | second match"
			expect(results[0].answer).toContain("first match");
			expect(results[0].answer).toContain("second match");
			expect(results[0].answer).toContain("|");
		});

		it("joins multiple matches with newline in snippet", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-20", [
					{ line: 1, text: "first line" },
					{ line: 5, text: "second line" },
				]),
			]);

			const results = await recall("test");

			expect(results[0].snippet).toContain("first line");
			expect(results[0].snippet).toContain("second line");
			expect(results[0].snippet).toContain("\n");
		});

		it("truncates combined match text in answer to 300 chars", async () => {
			const longMatches = Array.from({ length: 20 }, (_, i) => ({
				line: i + 1,
				text: "x".repeat(50),
			}));
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-20", longMatches),
			]);

			const results = await recall("test");

			const joinedPortion = results[0].answer.replace(/^On \d{4}-\d{2}-\d{2}: /, "");
			expect(joinedPortion.length).toBeLessThanOrEqual(300);
		});

		it("truncates snippet to 300 chars", async () => {
			const longMatches = Array.from({ length: 20 }, (_, i) => ({
				line: i + 1,
				text: "z".repeat(50),
			}));
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-20", longMatches),
			]);

			const results = await recall("test");

			expect(results[0].snippet.length).toBeLessThanOrEqual(300);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 5. Result Ranking and Limiting
	// ═══════════════════════════════════════════════════════════════════════════

	describe("result ranking and limiting", () => {
		it("sorts results by score in descending order", async () => {
			// Memory with high score
			spySearchMemory.mockReturnValue([
				makeMemoryResult("high relevance content", 0.9),
			]);
			// Day file with fixed 0.5
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "day match content" }]),
			]);
			// Turn with moderate score
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "partially matching turn content" },
			]));

			const results = await recall("matching");

			// Verify descending order
			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
			}
		});

		it("respects default limit of 5", async () => {
			const memResults = Array.from({ length: 5 }, (_, i) =>
				makeMemoryResult(`fact number ${i} is unique`, 0.5 + i * 0.05),
			);
			spySearchMemory.mockReturnValue(memResults);

			const dayResults = Array.from({ length: 5 }, (_, i) =>
				makeDayFileResult(`2025-01-${String(i + 1).padStart(2, "0")}`, [
					{ line: 1, text: `day fact ${i} unique content` },
				]),
			);
			spySearchDayFiles.mockReturnValue(dayResults);

			const results = await recall("fact");

			expect(results.length).toBeLessThanOrEqual(5);
		});

		it("respects custom limit", async () => {
			const memResults = Array.from({ length: 5 }, (_, i) =>
				makeMemoryResult(`fact number ${i} unique`, 0.5),
			);
			spySearchMemory.mockReturnValue(memResults);

			const results = await recall("fact", { limit: 2 });

			expect(results.length).toBeLessThanOrEqual(2);
		});

		it("higher-scored sources appear first in output", async () => {
			// Memory result with 0.9 relevance -> score 1.0
			spySearchMemory.mockReturnValue([
				makeMemoryResult("critical fact about importance", 0.9),
			]);
			// Day file result -> score 0.5
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "some day info about things" }]),
			]);

			const results = await recall("critical");

			expect(results.length).toBe(2);
			expect(results[0].score).toBeGreaterThan(results[1].score);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 6. Deduplication
	// ═══════════════════════════════════════════════════════════════════════════

	describe("deduplication", () => {
		it("deduplicates results with the same sessionId", async () => {
			const meta = makeMeta({ id: "session-2025-01-15-abcd" });
			spySearchSessions.mockReturnValue([meta, meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "some relevant matching content here" },
			]));

			const results = await recall("matching content");

			const turnResults = results.filter((r) => r.primarySource === "turns");
			expect(turnResults.length).toBe(1);
		});

		it("deduplicates results with same primarySource and snippet prefix", async () => {
			const longPrefix = "identical content about testing that is long enough to share the same first fifty characters easily";
			spySearchMemory.mockReturnValue([
				makeMemoryResult(longPrefix + " -- version A", 0.8),
				makeMemoryResult(longPrefix + " -- version B", 0.6),
			]);

			const results = await recall("testing");

			const memResults = results.filter((r) => r.primarySource === "memory");
			expect(memResults.length).toBe(1);
		});

		it("keeps results with different sessionIds", async () => {
			const meta1 = makeMeta({ id: "session-1" });
			const meta2 = makeMeta({ id: "session-2" });
			spySearchSessions.mockReturnValue([meta1, meta2]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "matching content" },
			]));

			const results = await recall("matching");

			const turnResults = results.filter((r) => r.primarySource === "turns");
			expect(turnResults.length).toBe(2);
		});

		it("keeps results with same source but different snippet prefixes", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("first unique fact about deployments and servers", 0.7),
				makeMemoryResult("second unique fact about databases and schemas", 0.6),
			]);

			const results = await recall("fact");

			const memResults = results.filter((r) => r.primarySource === "memory");
			expect(memResults.length).toBe(2);
		});

		it("deduplicates using first 50 chars of snippet (lowercased)", async () => {
			const prefix = "A".repeat(50);
			spySearchMemory.mockReturnValue([
				makeMemoryResult(prefix + " EXTRA STUFF UNIQUE 1", 0.8),
				makeMemoryResult(prefix + " OTHER STUFF UNIQUE 2", 0.6),
			]);

			const results = await recall("test");

			const memResults = results.filter((r) => r.primarySource === "memory");
			expect(memResults.length).toBe(1);
		});

		it("preserves first occurrence during session-keyed dedup", async () => {
			const meta = makeMeta({ id: "session-dup" });
			spySearchSessions.mockReturnValue([meta, meta]);

			let callNum = 0;
			spyLoadSession.mockImplementation(() => {
				callNum++;
				if (callNum === 1) {
					return makeSession([
						{ role: "assistant", content: "high match fix yaxis interval" },
					]);
				}
				return makeSession([
					{ role: "assistant", content: "low relevance unrelated" },
				]);
			});

			const results = await recall("fix yaxis interval");

			const turnResults = results.filter((r) => r.primarySource === "turns");
			expect(turnResults.length).toBe(1);
			expect(turnResults[0].sessionId).toBe("session-dup");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 7. Options Filtering
	// ═══════════════════════════════════════════════════════════════════════════

	describe("options filtering", () => {
		it("excludes memory results when includeMemory is false", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "day result" }]),
			]);

			const results = await recall("test", { includeMemory: false });

			const memResults = results.filter((r) => r.primarySource === "memory");
			expect(memResults.length).toBe(0);
		});

		it("excludes day file results when includeDayFiles is false", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("memory result", 0.6),
			]);

			const results = await recall("test", { includeDayFiles: false });

			const dayResults = results.filter((r) => r.primarySource === "dayfile");
			expect(dayResults.length).toBe(0);
		});

		it("includes memory by default (includeMemory not specified)", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("default included", 0.5),
			]);

			const results = await recall("test");

			expect(spySearchMemory).toHaveBeenCalled();
			const memResults = results.filter((r) => r.primarySource === "memory");
			expect(memResults.length).toBe(1);
		});

		it("includes day files by default (includeDayFiles not specified)", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "default day" }]),
			]);

			const results = await recall("test");

			expect(spySearchDayFiles).toHaveBeenCalled();
			const dayResults = results.filter((r) => r.primarySource === "dayfile");
			expect(dayResults.length).toBe(1);
		});

		it("passes project filter to searchSessions (turn search)", async () => {
			await recall("query", { project: "/home/user/specific-project" });

			expect(spySearchSessions).toHaveBeenCalledWith("query", "/home/user/specific-project");
		});

		it("passes undefined project when not specified", async () => {
			await recall("query");

			expect(spySearchSessions).toHaveBeenCalledWith("query", undefined);
		});

		it("excludes both memory and day files when both flags are false", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "only turns should appear here" },
			]));

			const results = await recall("turns", {
				includeMemory: false,
				includeDayFiles: false,
			});

			for (const r of results) {
				expect(r.primarySource).toBe("turns");
			}
		});

		it("applies limit to final output", async () => {
			const metas = Array.from({ length: 5 }, (_, i) =>
				makeMeta({ id: `session-${i}` }),
			);
			spySearchSessions.mockReturnValue(metas);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "matching content" },
			]));

			const results = await recall("matching", { limit: 2, includeMemory: false, includeDayFiles: false });

			expect(results.length).toBeLessThanOrEqual(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 8. Error Resilience
	// ═══════════════════════════════════════════════════════════════════════════

	describe("error resilience", () => {
		it("returns other layers when searchSessions throws", async () => {
			spySearchSessions.mockImplementation(() => {
				throw new Error("FTS5 index corrupt");
			});
			spySearchMemory.mockReturnValue([
				makeMemoryResult("memory still works", 0.7),
			]);
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "day file works" }]),
			]);

			const results = await recall("test");

			// searchTurns catches internally -> returns []
			expect(results.some((r) => r.primarySource === "memory")).toBe(true);
			expect(results.some((r) => r.primarySource === "dayfile")).toBe(true);
		});

		it("returns other layers when searchMemory throws", async () => {
			spySearchMemory.mockImplementation(() => {
				throw new Error("Memory store unavailable");
			});
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "turn content matches query" },
			]));
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "day works" }]),
			]);

			const results = await recall("matches query");

			expect(results.some((r) => r.primarySource === "turns")).toBe(true);
			expect(results.some((r) => r.primarySource === "dayfile")).toBe(true);
			expect(results.every((r) => r.primarySource !== "memory")).toBe(true);
		});

		it("returns other layers when searchDayFiles throws", async () => {
			spySearchDayFiles.mockImplementation(() => {
				throw new Error("Day file directory missing");
			});
			spySearchMemory.mockReturnValue([
				makeMemoryResult("memory works", 0.6),
			]);

			const results = await recall("works");

			const memResults = results.filter((r) => r.primarySource === "memory");
			expect(memResults.length).toBe(1);
			expect(memResults[0].primarySource).toBe("memory");
		});

		it("skips unloadable sessions but processes others", async () => {
			const meta1 = makeMeta({ id: "good-session" });
			const meta2 = makeMeta({ id: "bad-session" });
			const meta3 = makeMeta({ id: "another-good" });
			spySearchSessions.mockReturnValue([meta1, meta2, meta3]);

			let callCount = 0;
			spyLoadSession.mockImplementation(() => {
				callCount++;
				if (callCount === 2) throw new Error("Corrupted session file");
				return makeSession([
					{ role: "assistant", content: "matching content here" },
				]);
			});

			const results = await recall("matching content");

			const turnResults = results.filter((r) => r.primarySource === "turns");
			expect(turnResults.length).toBe(2);
		});

		it("handles all three layers throwing simultaneously", async () => {
			spySearchSessions.mockImplementation(() => {
				throw new Error("sessions broken");
			});
			spySearchMemory.mockImplementation(() => {
				throw new Error("memory broken");
			});
			spySearchDayFiles.mockImplementation(() => {
				throw new Error("dayfiles broken");
			});

			const results = await recall("test");

			// All layers fail gracefully -> empty results
			expect(results).toEqual([]);
		});

		it("does not reject the promise even when layers fail", async () => {
			spySearchSessions.mockImplementation(() => {
				throw new Error("boom");
			});

			// Should NOT throw
			await expect(recall("test")).resolves.toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 9. Edge Cases
	// ═══════════════════════════════════════════════════════════════════════════

	describe("edge cases", () => {
		it("works with very short single-word query", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("a bug was found in authentication", 0.5),
			]);

			const results = await recall("bug");

			const memResults = results.filter((r) => r.primarySource === "memory");
			expect(memResults.length).toBe(1);
		});

		it("handles empty query string", async () => {
			const results = await recall("");

			expect(Array.isArray(results)).toBe(true);
		});

		it("handles query with only short words (length <= 2)", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "I am ok no it is me" },
			]));

			const results = await recall("I am ok");

			expect(results.length).toBe(1);
			// All terms <= 2 chars -> no hits, score = min(0 + 0.3, 1.0) = 0.3
			expect(results[0].score).toBeCloseTo(0.3, 5);
		});

		it("handles turns with empty content", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "" },
			]));

			const results = await recall("anything useful");

			expect(results.length).toBe(1);
			expect(results[0].snippet).toBe("");
			expect(results[0].score).toBeCloseTo(0.3, 5);
		});

		it("handles recall with no options (defaults applied)", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("default behavior test", 0.5),
			]);
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "day match" }]),
			]);

			const results = await recall("test");

			expect(results.length).toBe(2);
		});

		it("handles limit of 1 correctly", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("high score content about importance", 0.9),
				makeMemoryResult("low score content about trivia", 0.3),
			]);
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "day content" }]),
			]);

			const results = await recall("test", { limit: 1 });

			expect(results.length).toBe(1);
			expect(results[0].score).toBe(1.0); // 0.9 + 0.1 boost
		});

		it("handles day file result with empty matches array", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", []),
			]);

			const results = await recall("test");

			const dayResults = results.filter((r) => r.primarySource === "dayfile");
			expect(dayResults.length).toBe(1);
			expect(dayResults[0].answer).toContain("2025-01-01");
			expect(dayResults[0].snippet).toBe("");
		});

		it("extracts project name from last path segment", async () => {
			const meta = makeMeta({ project: "/very/deep/nested/path/project-name" });
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "content that matches the query" },
			]));

			const results = await recall("matches query");

			expect(results[0].answer).toContain("project-name");
			expect(results[0].answer).not.toContain("/very/deep/nested/path/");
		});

		it("handles multiple day file results across different dates", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-01", [{ line: 1, text: "jan match" }]),
				makeDayFileResult("2025-06-15", [{ line: 1, text: "jun match" }]),
				makeDayFileResult("2025-12-31", [{ line: 1, text: "dec match" }]),
			]);

			const results = await recall("match");

			expect(results.length).toBe(3);
			const dates = results.map((r) => r.date);
			expect(dates).toContain("2025-01-01");
			expect(dates).toContain("2025-06-15");
			expect(dates).toContain("2025-12-31");
		});

		it("handles queryTerms splitting from whitespace-only query", async () => {
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "some content" },
			]));

			const results = await recall(" ");

			expect(Array.isArray(results)).toBe(true);
		});

		it("answer format for turns follows 'In <project> (<date>) via <provider>: <snippet>'", async () => {
			const meta = makeMeta({
				project: "/home/user/my-project",
				created: "2025-05-10T08:00:00Z",
				provider: "vaayu",
			});
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "helpful answer about config" },
			]));

			const results = await recall("config answer");

			expect(results[0].answer).toMatch(/^In my-project \(2025-05-10\) via vaayu: /);
		});

		it("answer format for dayfiles follows 'On <date>: <matches>'", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-08-22", [{ line: 1, text: "deployed v2.0" }]),
			]);

			const results = await recall("deploy");

			expect(results[0].answer).toMatch(/^On 2025-08-22: /);
		});

		it("RecallAnswer has all expected fields for turn result", async () => {
			const meta = makeMeta({
				id: "sess-123",
				project: "/proj",
				created: "2025-04-01T00:00:00Z",
				provider: "test-provider",
			});
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "answer content here" },
			]));

			const results = await recall("answer");

			expect(results.length).toBe(1);
			const r = results[0];
			expect(r).toHaveProperty("score");
			expect(r).toHaveProperty("answer");
			expect(r).toHaveProperty("primarySource", "turns");
			expect(r).toHaveProperty("sessionId", "sess-123");
			expect(r).toHaveProperty("project", "/proj");
			expect(r).toHaveProperty("date", "2025-04-01");
			expect(r).toHaveProperty("provider", "test-provider");
			expect(r).toHaveProperty("snippet");
			expect(typeof r.score).toBe("number");
			expect(r.score).toBeGreaterThanOrEqual(0);
			expect(r.score).toBeLessThanOrEqual(1);
		});

		it("RecallAnswer has all expected fields for memory result", async () => {
			spySearchMemory.mockReturnValue([
				makeMemoryResult("remembered fact", 0.6),
			]);

			const results = await recall("fact");

			expect(results.length).toBe(1);
			const r = results[0];
			expect(r).toHaveProperty("score");
			expect(r).toHaveProperty("answer");
			expect(r).toHaveProperty("primarySource", "memory");
			expect(r).toHaveProperty("snippet");
			expect(r.sessionId).toBeUndefined();
		});

		it("RecallAnswer has all expected fields for dayfile result", async () => {
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-07-04", [{ line: 1, text: "independence day" }]),
			]);

			const results = await recall("independence");

			expect(results.length).toBe(1);
			const r = results[0];
			expect(r).toHaveProperty("score", 0.5);
			expect(r).toHaveProperty("answer");
			expect(r).toHaveProperty("primarySource", "dayfile");
			expect(r).toHaveProperty("date", "2025-07-04");
			expect(r).toHaveProperty("snippet");
			expect(r.sessionId).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// 10. Hybrid Search Integration
	// ═══════════════════════════════════════════════════════════════════════════

	describe("hybrid search integration", () => {
		it("uses hybrid results when available (skips FTS5 fallback)", async () => {
			mockHybridSearchResults = [{
				id: "session-2025-01-15-abcd",
				title: "Test session",
				content: "how to fix the yaxis interval correctly",
				sources: ["bm25", "vector"],
				score: 2.5,
				ranks: { bm25: 1, vector: 2 },
			}];

			// FTS5 fallback data — should NOT be used when hybrid succeeds
			const meta = makeMeta();
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "this should not appear" },
			]));

			const results = await recall("fix yaxis");

			// Hybrid result should be preferred
			const hybridResults = results.filter((r) => r.primarySource === "hybrid");
			expect(hybridResults.length).toBe(1);
			expect(hybridResults[0].snippet).toContain("yaxis interval");

			// FTS5 fallback should NOT produce turns results
			const turnResults = results.filter((r) => r.primarySource === "turns");
			expect(turnResults.length).toBe(0);
		});

		it("assigns primarySource 'turns' for single-source bm25 hybrid result", async () => {
			mockHybridSearchResults = [{
				id: "session-2025-01-15-abcd",
				title: "BM25 only",
				content: "found via text search",
				sources: ["bm25"],
				score: 1.0,
				ranks: { bm25: 1 },
			}];

			const results = await recall("text search");

			expect(results.length).toBeGreaterThanOrEqual(1);
			const first = results.find((r) => r.snippet.includes("found via text search"));
			expect(first?.primarySource).toBe("turns");
		});

		it("assigns primarySource 'graph' for single-source graphrag hybrid result", async () => {
			mockHybridSearchResults = [{
				id: "node-42",
				title: "Graph entity",
				content: "entity from knowledge graph",
				sources: ["graphrag"],
				score: 1.5,
				ranks: { graphrag: 1 },
			}];

			const results = await recall("knowledge graph");

			const first = results.find((r) => r.snippet.includes("entity from knowledge graph"));
			expect(first?.primarySource).toBe("graph");
		});

		it("assigns primarySource 'hybrid' for multi-source results", async () => {
			mockHybridSearchResults = [{
				id: "session-2025-01-15-abcd",
				title: "Multi-source",
				content: "found by both bm25 and vector",
				sources: ["bm25", "vector"],
				score: 3.0,
				ranks: { bm25: 1, vector: 2 },
			}];

			const results = await recall("both sources");

			const first = results.find((r) => r.snippet.includes("found by both"));
			expect(first?.primarySource).toBe("hybrid");
		});

		it("normalizes RRF scores to 0-1 range", async () => {
			mockHybridSearchResults = [{
				id: "session-high",
				title: "High score",
				content: "very relevant result",
				sources: ["bm25", "vector", "graphrag"],
				score: 10.0, // High RRF score
				ranks: { bm25: 1, vector: 1, graphrag: 1 },
			}];

			const results = await recall("relevant");

			// score = min(10 / (10 + 0.5), 1.0) = min(0.952, 1.0) = 0.952
			expect(results[0].score).toBeLessThanOrEqual(1.0);
			expect(results[0].score).toBeGreaterThan(0.9);
		});

		it("extracts sessionId from id when it starts with 'session-'", async () => {
			mockHybridSearchResults = [{
				id: "session-2025-06-01-beef",
				title: "Session match",
				content: "matched content",
				sources: ["bm25"],
				score: 1.0,
				ranks: { bm25: 1 },
			}];

			const results = await recall("matched");

			const first = results.find((r) => r.snippet.includes("matched content"));
			expect(first?.sessionId).toBe("session-2025-06-01-beef");
		});

		it("does not set sessionId when id does not start with 'session-'", async () => {
			mockHybridSearchResults = [{
				id: "graph-node-42",
				title: "Graph result",
				content: "from graph",
				sources: ["graphrag"],
				score: 1.0,
				ranks: { graphrag: 1 },
			}];

			const results = await recall("graph");

			const first = results.find((r) => r.snippet.includes("from graph"));
			expect(first?.sessionId).toBeUndefined();
		});

		it("falls back to FTS5 when hybrid returns empty", async () => {
			mockHybridSearchResults = []; // Empty → fallback

			const meta = makeMeta({ provider: "claude-code" });
			spySearchSessions.mockReturnValue([meta]);
			spyLoadSession.mockReturnValue(makeSession([
				{ role: "assistant", content: "fallback content matches query" },
			]));

			const results = await recall("matches query");

			const turnResults = results.filter((r) => r.primarySource === "turns");
			expect(turnResults.length).toBe(1);
			expect(turnResults[0].snippet).toContain("fallback content");
		});

		it("combines hybrid results with memory and dayfile layers", async () => {
			mockHybridSearchResults = [{
				id: "session-2025-01-15-abcd",
				title: "Hybrid hit",
				content: "from hybrid search engine",
				sources: ["bm25", "vector"],
				score: 2.0,
				ranks: { bm25: 1, vector: 3 },
			}];
			spySearchMemory.mockReturnValue([
				makeMemoryResult("from memory store", 0.7),
			]);
			spySearchDayFiles.mockReturnValue([
				makeDayFileResult("2025-01-20", [{ line: 1, text: "from day file" }]),
			]);

			const results = await recall("search");

			const sources = results.map((r) => r.primarySource);
			expect(sources).toContain("hybrid");
			expect(sources).toContain("memory");
			expect(sources).toContain("dayfile");
		});

		it("truncates hybrid content in snippet to 300 chars", async () => {
			mockHybridSearchResults = [{
				id: "session-long",
				title: "Long content",
				content: "x".repeat(500),
				sources: ["bm25"],
				score: 1.0,
				ranks: { bm25: 1 },
			}];

			const results = await recall("test");

			expect(results[0].snippet.length).toBeLessThanOrEqual(300);
		});

		it("builds answer as 'title: content' for hybrid results", async () => {
			mockHybridSearchResults = [{
				id: "session-fmt",
				title: "Auth module refactor",
				content: "Refactored the auth module to use JWT",
				sources: ["bm25"],
				score: 1.0,
				ranks: { bm25: 1 },
			}];

			const results = await recall("auth");

			expect(results[0].answer).toBe("Auth module refactor: Refactored the auth module to use JWT");
		});
	});
});
