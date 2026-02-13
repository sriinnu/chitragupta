/**
 * @chitragupta/smriti — Day Consolidation (Diary Writer) Tests.
 *
 * Tests the day-consolidation module which consolidates all sessions from a
 * given day into a single markdown file at ~/.chitragupta/days/YYYY/MM/DD.md.
 *
 * Uses in-memory fs mock and custom loadSessions option to avoid hitting
 * the real filesystem or session-store module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionMeta, SessionTurn } from "../src/types.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock @chitragupta/core
vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: () => "/home/test/.chitragupta",
	SessionError: class SessionError extends Error {
		constructor(msg: string) {
			super(msg);
			this.name = "SessionError";
		}
	},
}));

// Mock fs with in-memory filesystem
vi.mock("fs", () => {
	const store = new Map<string, string>();
	const dirs = new Set<string>();

	return {
		default: {
			existsSync: vi.fn((p: string) => store.has(p) || dirs.has(p)),
			readFileSync: vi.fn((p: string) => {
				if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
				return store.get(p)!;
			}),
			writeFileSync: vi.fn((p: string, data: string) => {
				store.set(p, data);
			}),
			mkdirSync: vi.fn((p: string) => {
				dirs.add(p);
			}),
			readdirSync: vi.fn((dirPath: string, opts?: any) => {
				const entries: any[] = [];
				for (const key of store.keys()) {
					if (key.startsWith(dirPath + "/")) {
						const remaining = key.slice(dirPath.length + 1);
						const firstPart = remaining.split("/")[0];
						if (!entries.some((e) => (typeof e === "string" ? e : e.name) === firstPart)) {
							if (opts?.withFileTypes) {
								entries.push({
									name: firstPart,
									isDirectory: () => remaining.includes("/"),
								});
							} else {
								entries.push(firstPart);
							}
						}
					}
				}
				for (const d of dirs) {
					if (d.startsWith(dirPath + "/")) {
						const remaining = d.slice(dirPath.length + 1);
						const firstPart = remaining.split("/")[0];
						if (!entries.some((e) => (typeof e === "string" ? e : e.name) === firstPart)) {
							if (opts?.withFileTypes) {
								entries.push({ name: firstPart, isDirectory: () => true });
							} else {
								entries.push(firstPart);
							}
						}
					}
				}
				return entries;
			}),
		},
		__store: store,
		__dirs: dirs,
	};
});

// Mock ./session-store.js (used by getUnconsolidatedDates)
vi.mock("../src/session-store.js", () => ({
	listSessionDates: vi.fn(() => []),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import {
	getDaysRoot,
	getDayFilePath,
	consolidateDay,
	readDayFile,
	listDayFiles,
	searchDayFiles,
	isDayConsolidated,
	getUnconsolidatedDates,
} from "../src/day-consolidation.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

let fsModule: any;

/** Build a minimal SessionMeta for testing. */
function makeMeta(overrides: Partial<SessionMeta> & { id: string; project: string }): SessionMeta {
	return {
		title: "Test Session",
		created: "2025-06-15T10:00:00Z",
		updated: "2025-06-15T11:00:00Z",
		agent: "claude",
		model: "claude-opus-4-6",
		parent: null,
		branch: null,
		tags: [],
		totalCost: 0,
		totalTokens: 0,
		...overrides,
	};
}

/** Build a turn with createdAt timestamp. */
function makeTurn(
	role: "user" | "assistant",
	content: string,
	turnNumber: number,
	createdAt: number,
): SessionTurn & { createdAt: number } {
	return { turnNumber, role, content, createdAt };
}

/** Build a session object for loadSessions. */
function makeSession(
	meta: SessionMeta,
	turns: Array<SessionTurn & { createdAt: number }>,
): { meta: SessionMeta; turns: Array<SessionTurn & { createdAt: number }> } {
	return { meta, turns };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
	fsModule = await import("fs");
	fsModule.__store.clear();
	fsModule.__dirs.clear();
});

// ─── getDaysRoot ────────────────────────────────────────────────────────────

describe("getDaysRoot", () => {
	it("should return the days directory under chitragupta home", () => {
		expect(getDaysRoot()).toBe("/home/test/.chitragupta/days");
	});
});

// ─── getDayFilePath ─────────────────────────────────────────────────────────

describe("getDayFilePath", () => {
	it("should convert YYYY-MM-DD to the correct file path", () => {
		const result = getDayFilePath("2025-01-15");
		expect(result).toBe("/home/test/.chitragupta/days/2025/01/15.md");
	});

	it("should handle different months and days", () => {
		expect(getDayFilePath("2024-12-31")).toBe("/home/test/.chitragupta/days/2024/12/31.md");
		expect(getDayFilePath("2025-06-01")).toBe("/home/test/.chitragupta/days/2025/06/01.md");
	});

	it("should throw SessionError for invalid date format", () => {
		expect(() => getDayFilePath("not-a-date")).toThrow("Invalid date");
	});

	it("should throw SessionError for date without zero-padding", () => {
		expect(() => getDayFilePath("2025-1-5")).toThrow("Invalid date");
	});

	it("should throw SessionError for partial date strings", () => {
		expect(() => getDayFilePath("2025-01")).toThrow("Invalid date");
		expect(() => getDayFilePath("2025")).toThrow("Invalid date");
	});

	it("should throw SessionError for empty string", () => {
		expect(() => getDayFilePath("")).toThrow("Invalid date");
	});

	it("should throw SessionError for date with extra characters", () => {
		expect(() => getDayFilePath("2025-01-15T10:00:00Z")).toThrow("Invalid date");
	});
});

// ─── consolidateDay ─────────────────────────────────────────────────────────

describe("consolidateDay", () => {
	it("should return zero stats for empty sessions", async () => {
		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [],
		});

		expect(result.date).toBe("2025-06-15");
		expect(result.sessionsProcessed).toBe(0);
		expect(result.projectCount).toBe(0);
		expect(result.totalTurns).toBe(0);
		expect(result.extractedFacts).toEqual([]);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("should consolidate a single session with one project", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/my-project" });
		const turns = [
			makeTurn("user", "Hello, help me with this project", 1, Date.parse("2025-06-15T10:00:00Z")),
			makeTurn("assistant", "Sure, I can help!", 2, Date.parse("2025-06-15T10:01:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.sessionsProcessed).toBe(1);
		expect(result.projectCount).toBe(1);
		expect(result.totalTurns).toBe(2);
		expect(result.filePath).toBe("/home/test/.chitragupta/days/2025/06/15.md");

		// Verify file was written
		const content = fsModule.__store.get(result.filePath);
		expect(content).toBeDefined();
		expect(content).toContain("2025-06-15");
		expect(content).toContain("Project: /test/my-project");
	});

	it("should consolidate multiple sessions across 2 projects", async () => {
		const meta1 = makeMeta({
			id: "session-2025-06-15-abc1",
			project: "/project/alpha",
			branch: "main",
			metadata: { provider: "claude-code" },
		});
		const meta2 = makeMeta({
			id: "session-2025-06-15-abc2",
			project: "/project/beta",
			branch: "feat/login",
			metadata: { provider: "codex" },
		});
		const meta3 = makeMeta({
			id: "session-2025-06-15-abc3",
			project: "/project/alpha",
			branch: "main",
			metadata: { provider: "claude-code" },
		});

		const turns1 = [makeTurn("user", "Fix bug in alpha", 1, Date.parse("2025-06-15T09:00:00Z"))];
		const turns2 = [makeTurn("user", "Add login page", 1, Date.parse("2025-06-15T10:00:00Z"))];
		const turns3 = [makeTurn("user", "Deploy alpha", 1, Date.parse("2025-06-15T14:00:00Z"))];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [
				makeSession(meta1, turns1),
				makeSession(meta2, turns2),
				makeSession(meta3, turns3),
			],
		});

		expect(result.sessionsProcessed).toBe(3);
		expect(result.projectCount).toBe(2);
		expect(result.totalTurns).toBe(3);

		const content = fsModule.__store.get(result.filePath)!;
		expect(content).toContain("Project: /project/alpha");
		expect(content).toContain("Project: /project/beta");
	});

	it("should extract tool calls from turn content and populate tool timeline", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/tools" });
		const turns = [
			makeTurn("assistant", '[tool:read] {"path":"src/index.ts"}', 1, Date.parse("2025-06-15T10:00:00Z")),
			makeTurn("assistant", '[tool:edit] {"path":"src/index.ts"}', 2, Date.parse("2025-06-15T10:01:00Z")),
			makeTurn("assistant", '[tool:read] {"path":"src/utils.ts"}', 3, Date.parse("2025-06-15T10:02:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get(result.filePath)!;
		expect(content).toContain("Tool Timeline");
		expect(content).toContain("**read**: 2 calls");
		expect(content).toContain("**edit**: 1 calls");
	});

	it("should extract file modifications and list them in output", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/files" });
		const turns = [
			makeTurn("assistant", "File created: src/new-module.ts", 1, Date.parse("2025-06-15T10:00:00Z")),
			makeTurn("assistant", "File edited: src/index.ts", 2, Date.parse("2025-06-15T10:01:00Z")),
			makeTurn("assistant", "File modified: package.json", 3, Date.parse("2025-06-15T10:02:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get(result.filePath)!;
		expect(content).toContain("Files Modified");
		expect(content).toContain("src/new-module.ts");
		expect(content).toContain("src/index.ts");
		expect(content).toContain("package.json");
	});

	it("should extract user facts like 'I live in Vienna'", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/facts" });
		const turns = [
			makeTurn("user", "I live in Vienna and work on open source", 1, Date.parse("2025-06-15T10:00:00Z")),
			makeTurn("assistant", "Great! How can I help?", 2, Date.parse("2025-06-15T10:01:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.extractedFacts.length).toBeGreaterThan(0);
		expect(result.extractedFacts.some((f) => f.toLowerCase().includes("vienna"))).toBe(true);

		const content = fsModule.__store.get(result.filePath)!;
		expect(content).toContain("Facts Learned");
	});

	it("should extract 'my name is' facts from user turns", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/facts" });
		const turns = [
			makeTurn("user", "My name is Sriinnu", 1, Date.parse("2025-06-15T10:00:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.extractedFacts.some((f) => f.toLowerCase().includes("sriinnu"))).toBe(true);
	});

	it("should extract 'I work at' facts from user turns", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/facts" });
		const turns = [
			makeTurn("user", "I work at Anthropic on AI safety", 1, Date.parse("2025-06-15T10:00:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.extractedFacts.some((f) => f.toLowerCase().includes("anthropic"))).toBe(true);
	});

	it("should extract 'I prefer' facts from user turns", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/facts" });
		const turns = [
			makeTurn("user", "I prefer dark mode for everything", 1, Date.parse("2025-06-15T10:00:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.extractedFacts.some((f) => f.toLowerCase().includes("dark mode"))).toBe(true);
	});

	it("should extract 'always use' and 'never use' facts from user turns", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/facts" });
		const turns = [
			makeTurn("user", "Always use ESM imports in this project", 1, Date.parse("2025-06-15T10:00:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.extractedFacts.some((f) => f.toLowerCase().includes("esm imports"))).toBe(true);
	});

	it("should not extract facts from assistant turns", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/facts" });
		const turns = [
			makeTurn("assistant", "I live in the cloud and my name is Claude", 1, Date.parse("2025-06-15T10:00:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.extractedFacts).toEqual([]);
	});

	it("should deduplicate extracted facts", async () => {
		const meta1 = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/facts" });
		const meta2 = makeMeta({ id: "session-2025-06-15-abc2", project: "/test/facts" });
		const turns1 = [
			makeTurn("user", "I live in Vienna", 1, Date.parse("2025-06-15T10:00:00Z")),
		];
		const turns2 = [
			makeTurn("user", "I live in Vienna", 1, Date.parse("2025-06-15T14:00:00Z")),
		];

		const result = await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta1, turns1), makeSession(meta2, turns2)],
		});

		const viennaFacts = result.extractedFacts.filter((f) => f.toLowerCase().includes("vienna"));
		expect(viennaFacts.length).toBe(1);
	});

	it("should skip consolidation if day file already exists (not forced)", async () => {
		// Pre-populate a day file with specific content
		const dayPath = "/home/test/.chitragupta/days/2025/06/15.md";
		fsModule.__store.set(dayPath, [
			"# 2025-06-15 — Sunday",
			"",
			"## Project: /test/cached",
			"",
			"### Session: session-cached",
			"",
			"## Project: /test/cached2",
			"",
		].join("\n"));

		const loadSessions = vi.fn(async () => []);

		const result = await consolidateDay("2025-06-15", { loadSessions });

		// loadSessions should NOT have been called
		expect(loadSessions).not.toHaveBeenCalled();
		// It should parse the existing file for counts
		expect(result.sessionsProcessed).toBe(1); // 1 "### Session:" header
		expect(result.projectCount).toBe(2); // 2 "## Project:" headers
		expect(result.filePath).toBe(dayPath);
	});

	it("should force re-consolidation and overwrite existing file", async () => {
		// Pre-populate a stale day file
		const dayPath = "/home/test/.chitragupta/days/2025/06/15.md";
		fsModule.__store.set(dayPath, "# Old content\n## Project: /stale\n### Session: old-session");

		const meta = makeMeta({ id: "session-fresh", project: "/test/fresh" });
		const turns = [makeTurn("user", "Fresh data", 1, Date.parse("2025-06-15T10:00:00Z"))];

		const result = await consolidateDay("2025-06-15", {
			force: true,
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(result.sessionsProcessed).toBe(1);
		expect(result.projectCount).toBe(1);

		const content = fsModule.__store.get(dayPath)!;
		expect(content).toContain("Project: /test/fresh");
		expect(content).not.toContain("/stale");
	});

	it("should create directories for the day file path", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/dirs" });
		const turns = [makeTurn("user", "Test", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		expect(fsModule.default.mkdirSync).toHaveBeenCalledWith(
			"/home/test/.chitragupta/days/2025/06",
			{ recursive: true },
		);
	});

	it("should include provider info from session metadata", async () => {
		const meta = makeMeta({
			id: "session-2025-06-15-abc1",
			project: "/test/providers",
			metadata: { provider: "claude-code" },
		});
		const turns = [makeTurn("user", "Test", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("claude-code");
	});

	it("should fall back to agent field when metadata.provider is absent", async () => {
		const meta = makeMeta({
			id: "session-2025-06-15-abc1",
			project: "/test/agent-fallback",
			agent: "chitragupta-agent",
		});
		const turns = [makeTurn("user", "Test", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("chitragupta-agent");
	});

	it("should track branch info per project", async () => {
		const meta = makeMeta({
			id: "session-2025-06-15-abc1",
			project: "/test/branching",
			branch: "feat/awesome",
		});
		const turns = [makeTurn("user", "Test", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("feat/awesome");
	});
});

// ─── Markdown output format ─────────────────────────────────────────────────

describe("Markdown output format", () => {
	it("should contain date header with weekday name", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/format" });
		const turns = [makeTurn("user", "Hello", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		// 2025-06-15 is a Sunday
		expect(content).toMatch(/^# 2025-06-15 — Sunday/);
	});

	it("should contain session count, project count, and turn count in header", async () => {
		const meta1 = makeMeta({ id: "s1", project: "/project/a" });
		const meta2 = makeMeta({ id: "s2", project: "/project/b" });
		const turns1 = [
			makeTurn("user", "Hello", 1, Date.parse("2025-06-15T10:00:00Z")),
			makeTurn("assistant", "Hi", 2, Date.parse("2025-06-15T10:01:00Z")),
		];
		const turns2 = [makeTurn("user", "Test", 1, Date.parse("2025-06-15T11:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta1, turns1), makeSession(meta2, turns2)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("2 sessions | 2 projects | 3 turns");
	});

	it("should contain 'Facts Learned' section when facts are found", async () => {
		const meta = makeMeta({ id: "s1", project: "/test/format" });
		const turns = [
			makeTurn("user", "I live in Tokyo and I work at Google", 1, Date.parse("2025-06-15T10:00:00Z")),
		];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("## Facts Learned");
	});

	it("should not contain 'Facts Learned' section when no facts are found", async () => {
		const meta = makeMeta({ id: "s1", project: "/test/format" });
		const turns = [
			makeTurn("user", "Fix the login bug", 1, Date.parse("2025-06-15T10:00:00Z")),
		];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).not.toContain("Facts Learned");
	});

	it("should contain 'Project:' sections for each project", async () => {
		const meta1 = makeMeta({ id: "s1", project: "/project/alpha" });
		const meta2 = makeMeta({ id: "s2", project: "/project/beta" });
		const turns = [makeTurn("user", "Work", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta1, turns), makeSession(meta2, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("## Project: /project/alpha");
		expect(content).toContain("## Project: /project/beta");
	});

	it("should contain 'Consolidated by Chitragupta' footer", async () => {
		const meta = makeMeta({ id: "s1", project: "/test/format" });
		const turns = [makeTurn("user", "Done", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("Consolidated by Chitragupta");
	});

	it("should contain session listings with session IDs", async () => {
		const meta = makeMeta({ id: "session-2025-06-15-abc1", project: "/test/format" });
		const turns = [makeTurn("user", "Hello", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("### Session: session-2025-06-15-abc1");
	});

	it("should contain Files Modified count in project metadata", async () => {
		const meta = makeMeta({ id: "s1", project: "/test/format" });
		const turns = [
			makeTurn("assistant", "File created: src/app.ts", 1, Date.parse("2025-06-15T10:00:00Z")),
			makeTurn("assistant", "File edited: src/main.ts", 2, Date.parse("2025-06-15T10:01:00Z")),
		];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("**Files Modified**: 2");
	});

	it("should separate sections with a horizontal rule before the footer", async () => {
		const meta = makeMeta({ id: "s1", project: "/test/format" });
		const turns = [makeTurn("user", "Hello", 1, Date.parse("2025-06-15T10:00:00Z"))];

		await consolidateDay("2025-06-15", {
			loadSessions: async () => [makeSession(meta, turns)],
		});

		const content = fsModule.__store.get("/home/test/.chitragupta/days/2025/06/15.md")!;
		expect(content).toContain("---");
	});
});

// ─── readDayFile ────────────────────────────────────────────────────────────

describe("readDayFile", () => {
	it("should return file content for an existing day file", () => {
		const dayPath = "/home/test/.chitragupta/days/2025/03/20.md";
		fsModule.__store.set(dayPath, "# 2025-03-20 — Thursday\n\nSome content");

		const content = readDayFile("2025-03-20");

		expect(content).toBe("# 2025-03-20 — Thursday\n\nSome content");
	});

	it("should return null for a non-existent day file", () => {
		const content = readDayFile("2025-12-25");
		expect(content).toBeNull();
	});
});

// ─── listDayFiles ───────────────────────────────────────────────────────────

describe("listDayFiles", () => {
	it("should return empty array when no days directory exists", () => {
		const result = listDayFiles();
		expect(result).toEqual([]);
	});

	it("should return empty array when days directory exists but has no files", () => {
		fsModule.__dirs.add("/home/test/.chitragupta/days");
		const result = listDayFiles();
		expect(result).toEqual([]);
	});

	it("should list day files sorted most recent first", () => {
		// Populate in-memory fs with day files
		fsModule.__store.set("/home/test/.chitragupta/days/2025/01/10.md", "day1");
		fsModule.__store.set("/home/test/.chitragupta/days/2025/03/22.md", "day2");
		fsModule.__store.set("/home/test/.chitragupta/days/2025/02/05.md", "day3");
		// Also need the days root to exist
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const result = listDayFiles();

		expect(result).toEqual(["2025-03-22", "2025-02-05", "2025-01-10"]);
	});

	it("should handle files across different years", () => {
		fsModule.__store.set("/home/test/.chitragupta/days/2024/12/31.md", "old");
		fsModule.__store.set("/home/test/.chitragupta/days/2025/01/01.md", "new");
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const result = listDayFiles();

		expect(result).toEqual(["2025-01-01", "2024-12-31"]);
	});

	it("should skip non-.md files", () => {
		fsModule.__store.set("/home/test/.chitragupta/days/2025/01/10.md", "day1");
		fsModule.__store.set("/home/test/.chitragupta/days/2025/01/10.txt", "not-a-day");
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const result = listDayFiles();

		expect(result).toEqual(["2025-01-10"]);
	});
});

// ─── searchDayFiles ─────────────────────────────────────────────────────────

describe("searchDayFiles", () => {
	it("should return empty array when no day files exist", () => {
		const results = searchDayFiles("anything");
		expect(results).toEqual([]);
	});

	it("should find matches in a single day file", () => {
		fsModule.__store.set(
			"/home/test/.chitragupta/days/2025/06/15.md",
			"# 2025-06-15 — Sunday\n\n## Project: /test\nDeployed the authentication module\n",
		);
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const results = searchDayFiles("authentication");

		expect(results.length).toBe(1);
		expect(results[0].date).toBe("2025-06-15");
		expect(results[0].matches.length).toBe(1);
		expect(results[0].matches[0].text).toContain("authentication");
		expect(results[0].matches[0].line).toBe(4); // line number (1-indexed)
	});

	it("should perform case-insensitive matching", () => {
		fsModule.__store.set(
			"/home/test/.chitragupta/days/2025/06/15.md",
			"# Title\nDeployed the AUTHENTICATION module\n",
		);
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const results = searchDayFiles("authentication");

		expect(results.length).toBe(1);
		expect(results[0].matches.length).toBe(1);
	});

	it("should respect the limit parameter", () => {
		// Create multiple day files with matching content
		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/15.md", "match target\n");
		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/14.md", "match target\n");
		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/13.md", "match target\n");
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const results = searchDayFiles("target", { limit: 2 });

		expect(results.length).toBe(2);
	});

	it("should cap at max 5 matches per day file", () => {
		// Create a day file with more than 5 matching lines
		const lines = Array.from({ length: 10 }, (_, i) => `Line ${i}: keyword match here`);
		fsModule.__store.set(
			"/home/test/.chitragupta/days/2025/06/15.md",
			lines.join("\n"),
		);
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const results = searchDayFiles("keyword");

		expect(results.length).toBe(1);
		expect(results[0].matches.length).toBe(5);
	});

	it("should return correct line numbers for matches", () => {
		fsModule.__store.set(
			"/home/test/.chitragupta/days/2025/06/15.md",
			"line one\nline two\ntarget found here\nline four\n",
		);
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const results = searchDayFiles("target");

		expect(results[0].matches[0].line).toBe(3);
	});

	it("should not return files with no matches", () => {
		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/15.md", "has match keyword\n");
		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/14.md", "no relevant content\n");
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const results = searchDayFiles("keyword");

		expect(results.length).toBe(1);
		expect(results[0].date).toBe("2025-06-15");
	});

	it("should default to limit of 10 when not specified", () => {
		// Create 15 matching day files
		for (let i = 1; i <= 15; i++) {
			const dd = String(i).padStart(2, "0");
			fsModule.__store.set(
				`/home/test/.chitragupta/days/2025/06/${dd}.md`,
				"target keyword\n",
			);
		}
		fsModule.__dirs.add("/home/test/.chitragupta/days");

		const results = searchDayFiles("target");

		expect(results.length).toBe(10);
	});
});

// ─── isDayConsolidated ──────────────────────────────────────────────────────

describe("isDayConsolidated", () => {
	it("should return true when the day file exists", () => {
		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/15.md", "content");

		expect(isDayConsolidated("2025-06-15")).toBe(true);
	});

	it("should return false when the day file does not exist", () => {
		expect(isDayConsolidated("2025-12-25")).toBe(false);
	});
});

// ─── getUnconsolidatedDates ─────────────────────────────────────────────────

describe("getUnconsolidatedDates", () => {
	it("should return dates that have sessions but no day files", async () => {
		const { listSessionDates } = await import("../src/session-store.js");
		(listSessionDates as any).mockReturnValue(["2025-06-15", "2025-06-14", "2025-06-13"]);

		// Mark one as consolidated
		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/14.md", "consolidated");

		const result = await getUnconsolidatedDates();

		expect(result).toContain("2025-06-15");
		expect(result).not.toContain("2025-06-14");
		expect(result).toContain("2025-06-13");
	});

	it("should return empty array when all dates are consolidated", async () => {
		const { listSessionDates } = await import("../src/session-store.js");
		(listSessionDates as any).mockReturnValue(["2025-06-15"]);

		fsModule.__store.set("/home/test/.chitragupta/days/2025/06/15.md", "consolidated");

		const result = await getUnconsolidatedDates();

		expect(result).toEqual([]);
	});

	it("should return empty array when no session dates exist", async () => {
		const { listSessionDates } = await import("../src/session-store.js");
		(listSessionDates as any).mockReturnValue([]);

		const result = await getUnconsolidatedDates();

		expect(result).toEqual([]);
	});

	it("should respect the limit parameter", async () => {
		const { listSessionDates } = await import("../src/session-store.js");
		(listSessionDates as any).mockReturnValue([
			"2025-06-15",
			"2025-06-14",
			"2025-06-13",
			"2025-06-12",
			"2025-06-11",
		]);

		const result = await getUnconsolidatedDates(2);

		expect(result.length).toBe(2);
	});

	it("should default limit to 30 when not provided", async () => {
		const { listSessionDates } = await import("../src/session-store.js");
		const dates = Array.from({ length: 40 }, (_, i) => {
			const day = String(i + 1).padStart(2, "0");
			// Spread across months to get > 30 unique valid dates
			const month = i < 28 ? "01" : "02";
			const dd = i < 28 ? String(i + 1).padStart(2, "0") : String(i - 27).padStart(2, "0");
			return `2025-${month}-${dd}`;
		});
		(listSessionDates as any).mockReturnValue(dates);

		const result = await getUnconsolidatedDates();

		expect(result.length).toBe(30);
	});
});
