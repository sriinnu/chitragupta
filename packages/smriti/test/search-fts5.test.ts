/**
 * Integration tests for FTS5 search functionality.
 *
 * Uses real SQLite databases in temp directories (no mocking of SQLite).
 * Tests: FTS5 MATCH queries, project filtering, deduplication, recency boost,
 * query sanitization, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";

// Mock getChitraguptaHome to point to our temp directory
let tmpDir: string;

vi.mock("@chitragupta/core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getChitraguptaHome: () => tmpDir,
	};
});

// Mock memory-store so searchMemory does not hit the real filesystem
const mockGetMemory = vi.fn<(scope: any) => string>(() => "");
const mockListMemoryScopes = vi.fn<() => any[]>(() => []);

vi.mock("../src/memory-store.js", () => ({
	getMemory: (scope: any) => mockGetMemory(scope),
	listMemoryScopes: () => mockListMemoryScopes(),
}));

// Mock session-store so the BM25 fallback path does not hit the filesystem
const mockListSessions = vi.fn<(project?: string) => any[]>(() => []);
const mockLoadSession = vi.fn<(id: string, project: string) => any>(() => ({
	meta: {},
	turns: [],
}));

vi.mock("../src/session-store.js", () => ({
	listSessions: (project?: string) => mockListSessions(project),
	loadSession: (id: string, project: string) => mockLoadSession(id, project),
}));

import {
	searchSessions,
	searchMemory,
	_resetSearchDbInit,
	sanitizeFts5Query,
} from "@chitragupta/smriti/search";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Insert a session row directly into SQLite. */
function insertSession(
	db: ReturnType<DatabaseManager["get"]>,
	opts: {
		id: string;
		project: string;
		title?: string;
		createdAt?: number;
		updatedAt?: number;
		agent?: string;
		model?: string;
		cost?: number;
		tokens?: number;
		tags?: string[];
		parentId?: string | null;
		branch?: string | null;
	},
): void {
	const now = Date.now();
	db.prepare(
		`INSERT INTO sessions (id, project, title, created_at, updated_at, file_path, agent, model, cost, tokens, tags, parent_id, branch)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		opts.id,
		opts.project,
		opts.title ?? "Test Session",
		opts.createdAt ?? now,
		opts.updatedAt ?? now,
		`sessions/test/${opts.id}.md`,
		opts.agent ?? "chitragupta",
		opts.model ?? "claude-sonnet",
		opts.cost ?? 0,
		opts.tokens ?? 0,
		JSON.stringify(opts.tags ?? []),
		opts.parentId ?? null,
		opts.branch ?? null,
	);
}

/**
 * Insert a turn row AND its FTS5 entry directly into SQLite.
 * Returns the auto-generated turn rowid.
 */
function insertTurnWithFts(
	db: ReturnType<DatabaseManager["get"]>,
	opts: {
		sessionId: string;
		turnNumber: number;
		role: "user" | "assistant";
		content: string;
		createdAt?: number;
	},
): number {
	const now = Date.now();
	const result = db.prepare(
		`INSERT INTO turns (session_id, turn_number, role, content, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
	).run(
		opts.sessionId,
		opts.turnNumber,
		opts.role,
		opts.content,
		opts.createdAt ?? now,
	);

	const turnId = Number(result.lastInsertRowid);

	// Insert into FTS5 index
	db.prepare("INSERT INTO turns_fts (rowid, content) VALUES (?, ?)").run(
		turnId,
		opts.content,
	);

	return turnId;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("FTS5 Search Integration", () => {
	let db: ReturnType<DatabaseManager["get"]>;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-fts5-test-"));
		DatabaseManager.reset();
		_resetSearchDbInit();
		vi.clearAllMocks();

		// Initialize the database and schema
		const dbm = DatabaseManager.instance(tmpDir);
		initAgentSchema(dbm);
		db = dbm.get("agent");
	});

	afterEach(() => {
		DatabaseManager.reset();
		_resetSearchDbInit();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// ─── Test a: FTS5 search finds sessions by turn content ─────────────

	it("FTS5 search finds sessions by turn content", () => {
		insertSession(db, {
			id: "s-fts-1",
			project: "/my/project",
			title: "Cooking Session",
		});
		insertTurnWithFts(db, {
			sessionId: "s-fts-1",
			turnNumber: 1,
			role: "user",
			content: "I love cooking Italian pasta with fresh basil and tomatoes",
		});
		insertTurnWithFts(db, {
			sessionId: "s-fts-1",
			turnNumber: 2,
			role: "assistant",
			content: "Here is a great recipe for homemade marinara sauce",
		});

		const results = searchSessions("pasta basil");
		expect(results.length).toBe(1);
		expect(results[0].id).toBe("s-fts-1");
		expect(results[0].title).toBe("Cooking Session");
		expect(results[0].project).toBe("/my/project");
	});

	// ─── Test b: FTS5 search filters by project ─────────────────────────

	it("FTS5 search filters by project", () => {
		insertSession(db, {
			id: "s-proj-a",
			project: "/project-alpha",
			title: "Alpha Session",
		});
		insertTurnWithFts(db, {
			sessionId: "s-proj-a",
			turnNumber: 1,
			role: "user",
			content: "Deploying kubernetes containers to production cluster",
		});

		insertSession(db, {
			id: "s-proj-b",
			project: "/project-beta",
			title: "Beta Session",
		});
		insertTurnWithFts(db, {
			sessionId: "s-proj-b",
			turnNumber: 1,
			role: "user",
			content: "Deploying kubernetes containers to staging cluster",
		});

		// Search with project filter
		const alphaResults = searchSessions("kubernetes containers", "/project-alpha");
		expect(alphaResults.length).toBe(1);
		expect(alphaResults[0].id).toBe("s-proj-a");
		expect(alphaResults[0].project).toBe("/project-alpha");

		// Search without filter should return both
		const allResults = searchSessions("kubernetes containers");
		expect(allResults.length).toBe(2);
	});

	// ─── Test c: FTS5 search deduplicates by session ────────────────────

	it("FTS5 search deduplicates by session", () => {
		insertSession(db, {
			id: "s-dedup",
			project: "/test",
			title: "Multi-Turn Session",
		});

		// Insert 5 turns all mentioning the same topic
		for (let i = 1; i <= 5; i++) {
			insertTurnWithFts(db, {
				sessionId: "s-dedup",
				turnNumber: i,
				role: i % 2 === 0 ? "assistant" : "user",
				content: `Discussion about TypeScript generics turn ${i} with advanced type inference`,
			});
		}

		const results = searchSessions("TypeScript generics");
		// Should return exactly 1 result (deduplicated by session)
		expect(results.length).toBe(1);
		expect(results[0].id).toBe("s-dedup");
	});

	// ─── Test d: FTS5 search applies recency boost ──────────────────────

	it("FTS5 search applies recency boost", () => {
		const now = Date.now();
		const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

		// Old session
		insertSession(db, {
			id: "s-old",
			project: "/test",
			title: "Old Session",
			createdAt: oneWeekAgo,
			updatedAt: oneWeekAgo,
		});
		insertTurnWithFts(db, {
			sessionId: "s-old",
			turnNumber: 1,
			role: "user",
			content: "Building a React dashboard with chart visualization components",
		});

		// Recent session
		insertSession(db, {
			id: "s-recent",
			project: "/test",
			title: "Recent Session",
			createdAt: now,
			updatedAt: now,
		});
		insertTurnWithFts(db, {
			sessionId: "s-recent",
			turnNumber: 1,
			role: "user",
			content: "Building a React dashboard with chart visualization components",
		});

		const results = searchSessions("React dashboard chart");
		expect(results.length).toBe(2);
		// Recent session should rank higher due to recency boost
		expect(results[0].id).toBe("s-recent");
		expect(results[1].id).toBe("s-old");
	});

	// ─── Test e: sanitizeFts5Query strips FTS5 operators ────────────────

	describe("sanitizeFts5Query", () => {
		it("strips FTS5 special characters", () => {
			expect(sanitizeFts5Query('test "query" here')).toBe('"test" "query" "here"');
			expect(sanitizeFts5Query("test*")).toBe('"test"');
			expect(sanitizeFts5Query("^boost")).toBe('"boost"');
			// Colon is removed but adjacent chars merge — no space is inserted
			expect(sanitizeFts5Query("col:value")).toBe('"colvalue"');
			// Separated by space works fine
			expect(sanitizeFts5Query("col: value")).toBe('"col" "value"');
		});

		it("removes FTS5 boolean operators", () => {
			expect(sanitizeFts5Query("cats AND dogs")).toBe('"cats" "dogs"');
			expect(sanitizeFts5Query("cats OR dogs")).toBe('"cats" "dogs"');
			expect(sanitizeFts5Query("NOT cats")).toBe('"cats"');
			expect(sanitizeFts5Query("cats NEAR dogs")).toBe('"cats" "dogs"');
		});

		it("filters out short tokens", () => {
			// Single-character tokens should be removed (length < 2)
			expect(sanitizeFts5Query("a b cd ef")).toBe('"cd" "ef"');
		});

		it("returns empty string for empty or whitespace-only input", () => {
			expect(sanitizeFts5Query("")).toBe("");
			expect(sanitizeFts5Query("   ")).toBe("");
		});

		it("returns empty string when only operators remain", () => {
			expect(sanitizeFts5Query("* ^ : ()")).toBe("");
		});

		it("handles parentheses and braces", () => {
			expect(sanitizeFts5Query("(test) {query}")).toBe('"test" "query"');
		});
	});

	// ─── Test f: FTS5 search returns empty for no matches ───────────────

	it("FTS5 search returns empty for no matches", () => {
		insertSession(db, {
			id: "s-no-match",
			project: "/test",
			title: "Some Session",
		});
		insertTurnWithFts(db, {
			sessionId: "s-no-match",
			turnNumber: 1,
			role: "user",
			content: "Discussion about Python data analysis with pandas",
		});

		const results = searchSessions("kubernetes docker containers");
		expect(results).toEqual([]);
	});

	// ─── Test g: FTS5 search returns empty for empty query ──────────────

	it("FTS5 search returns empty for empty query", () => {
		insertSession(db, {
			id: "s-empty-q",
			project: "/test",
			title: "Some Session",
		});
		insertTurnWithFts(db, {
			sessionId: "s-empty-q",
			turnNumber: 1,
			role: "user",
			content: "Some content here",
		});

		expect(searchSessions("")).toEqual([]);
		expect(searchSessions("   ")).toEqual([]);
	});

	// ─── Test h: searchMemory still uses BM25 ───────────────────────────

	it("searchMemory still uses BM25 (not FTS5)", () => {
		mockListMemoryScopes.mockReturnValue([
			{ type: "global" },
			{ type: "agent", agentId: "chitragupta" },
		]);
		mockGetMemory.mockImplementation((scope: any) => {
			if (scope.type === "global") {
				return "The user prefers TypeScript and React for frontend development projects.";
			}
			if (scope.type === "agent") {
				return "Agent configuration and deployment settings for production.";
			}
			return "";
		});

		const results = searchMemory("TypeScript React frontend");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].scope.type).toBe("global");
		expect(results[0].relevance).toBe(1); // Highest score normalized to 1
	});

	// ─── Additional integration tests ───────────────────────────────────

	it("FTS5 search returns correct SessionMeta shape", () => {
		const now = Date.now();
		insertSession(db, {
			id: "s-shape",
			project: "/shape/test",
			title: "Shape Test",
			createdAt: now,
			updatedAt: now,
			agent: "test-agent",
			model: "gpt-4",
			cost: 1.5,
			tokens: 3000,
			tags: ["test", "integration"],
			parentId: "s-parent",
			branch: "experiment",
		});
		insertTurnWithFts(db, {
			sessionId: "s-shape",
			turnNumber: 1,
			role: "user",
			content: "Verify the session metadata structure is correct",
		});

		const results = searchSessions("session metadata structure");
		expect(results.length).toBe(1);

		const meta = results[0];
		expect(meta.id).toBe("s-shape");
		expect(meta.title).toBe("Shape Test");
		expect(meta.project).toBe("/shape/test");
		expect(meta.agent).toBe("test-agent");
		expect(meta.model).toBe("gpt-4");
		expect(meta.totalCost).toBe(1.5);
		expect(meta.totalTokens).toBe(3000);
		expect(meta.tags).toEqual(["test", "integration"]);
		expect(meta.parent).toBe("s-parent");
		expect(meta.branch).toBe("experiment");
		expect(meta.created).toBe(new Date(now).toISOString());
		expect(meta.updated).toBe(new Date(now).toISOString());
	});

	it("FTS5 search handles porter stemming", () => {
		// FTS5 with porter tokenizer should match stemmed forms
		insertSession(db, {
			id: "s-stem",
			project: "/test",
			title: "Stemming Test",
		});
		insertTurnWithFts(db, {
			sessionId: "s-stem",
			turnNumber: 1,
			role: "user",
			content: "The programmer was programming a complex program",
		});

		// "programming" should match "program" due to porter stemming
		const results = searchSessions("program");
		expect(results.length).toBe(1);
		expect(results[0].id).toBe("s-stem");
	});

	it("FTS5 search across multiple sessions ranks by relevance", () => {
		const now = Date.now();

		// Session with highly relevant content (many matching terms)
		insertSession(db, {
			id: "s-high",
			project: "/test",
			title: "Highly Relevant",
			updatedAt: now,
		});
		insertTurnWithFts(db, {
			sessionId: "s-high",
			turnNumber: 1,
			role: "user",
			content:
				"Database optimization with query indexing and database performance tuning and database sharding strategies",
		});

		// Session with lower relevance (fewer mentions of matching terms)
		insertSession(db, {
			id: "s-low",
			project: "/test",
			title: "Low Relevance",
			updatedAt: now,
		});
		insertTurnWithFts(db, {
			sessionId: "s-low",
			turnNumber: 1,
			role: "user",
			content:
				"General discussion about database optimization for web development",
		});

		const results = searchSessions("database optimization");
		expect(results.length).toBe(2);
		// The session with more relevant content (more term occurrences) should rank first
		expect(results[0].id).toBe("s-high");
	});

	it("FTS5 search with query containing only short words returns empty", () => {
		insertSession(db, { id: "s-short", project: "/test" });
		insertTurnWithFts(db, {
			sessionId: "s-short",
			turnNumber: 1,
			role: "user",
			content: "Some content here",
		});

		// All terms are shorter than 2 chars after sanitization
		const results = searchSessions("a I");
		expect(results).toEqual([]);
	});
});
