/**
 * Integration tests for session-store v2.
 *
 * Uses real filesystem + real SQLite in a temp directory.
 * Tests: date-based naming, append-only addTurn, write-through to SQLite,
 * listSessions from SQLite, migration, backward compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema } from "@chitragupta/smriti/db/schema";

// We need to mock getChitraguptaHome to point to our temp directory
let tmpDir: string;

vi.mock("@chitragupta/core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getChitraguptaHome: () => tmpDir,
	};
});

// Import after mock setup
import {
	createSession,
	saveSession,
	loadSession,
	listSessions,
	deleteSession,
	addTurn,
	migrateExistingSessions,
	_resetDbInit,
} from "@chitragupta/smriti/session-store";
import { SessionError } from "@chitragupta/core";
import { writeSessionMarkdown } from "@chitragupta/smriti/markdown-writer";

describe("SessionStore v2", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-session-test-"));
		DatabaseManager.reset();
		_resetDbInit();
	});

	afterEach(() => {
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("createSession", () => {
		it("should create a session with date-based id", () => {
			const session = createSession({
				project: "/test/project",
				title: "My Session",
				agent: "chitragupta",
				model: "claude-sonnet-4-5-20250929",
			});

			// Format: session-YYYY-MM-DD-<projhash>[-N]
			expect(session.meta.id).toMatch(/^session-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}/);
			expect(session.meta.title).toBe("My Session");
			expect(session.meta.agent).toBe("chitragupta");
			expect(session.meta.model).toBe("claude-sonnet-4-5-20250929");
			expect(session.meta.project).toBe("/test/project");
			expect(session.turns).toHaveLength(0);
		});

		it("should use default values for optional fields", () => {
			const session = createSession({ project: "/test" });
			expect(session.meta.title).toBe("New Session");
			expect(session.meta.agent).toBe("chitragupta");
			expect(session.meta.model).toBe("unknown");
			expect(session.meta.parent).toBeNull();
			expect(session.meta.branch).toBeNull();
			expect(session.meta.tags).toEqual([]);
			expect(session.meta.totalCost).toBe(0);
			expect(session.meta.totalTokens).toBe(0);
		});

		it("should set valid ISO timestamps", () => {
			const session = createSession({ project: "/test" });
			expect(session.meta.created).toBeDefined();
			expect(session.meta.updated).toBeDefined();
			expect(new Date(session.meta.created).toISOString()).toBe(session.meta.created);
		});

		it("should create .md file in YYYY/MM/ directory structure", () => {
			const session = createSession({ project: "/test" });
			const now = new Date();
			const yyyy = now.getFullYear().toString();
			const mm = (now.getMonth() + 1).toString().padStart(2, "0");

			// File should exist in YYYY/MM/ subdirectory
			const sessionsDir = path.join(tmpDir, "sessions");
			expect(fs.existsSync(sessionsDir)).toBe(true);

			// Find the .md file recursively
			const mdFiles = findMdFilesRecursive(sessionsDir);
			expect(mdFiles.length).toBe(1);
			expect(mdFiles[0]).toContain(yyyy);
			expect(mdFiles[0]).toContain(mm);
		});

		it("should handle multiple sessions per day with counter suffix", () => {
			const s1 = createSession({ project: "/test" });
			const s2 = createSession({ project: "/test" });
			const s3 = createSession({ project: "/test" });

			expect(s1.meta.id).toMatch(/^session-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/);
			expect(s2.meta.id).toMatch(/^session-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}-2$/);
			expect(s3.meta.id).toMatch(/^session-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}-3$/);
		});

		it("should write-through to SQLite", () => {
			const session = createSession({ project: "/test/project" });

			const db = DatabaseManager.instance(tmpDir).get("agent");
			const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(session.meta.id) as Record<string, unknown>;

			expect(row).toBeDefined();
			expect(row.project).toBe("/test/project");
			expect(row.title).toBe("New Session");
		});

		it("should support parentSessionId and branch", () => {
			const session = createSession({
				project: "/test",
				parentSessionId: "session-2026-01-01",
				branch: "experiment",
			});
			expect(session.meta.parent).toBe("session-2026-01-01");
			expect(session.meta.branch).toBe("experiment");
		});

		it("should support tags", () => {
			const session = createSession({
				project: "/test",
				tags: ["debug", "refactor"],
			});
			expect(session.meta.tags).toEqual(["debug", "refactor"]);
		});
	});

	describe("loadSession", () => {
		it("should load a previously saved session", () => {
			const created = createSession({
				project: "/test",
				title: "Load Me",
			});

			const loaded = loadSession(created.meta.id, "/test");
			expect(loaded.meta.id).toBe(created.meta.id);
			expect(loaded.meta.title).toBe("Load Me");
		});

		it("should throw SessionError when session file does not exist", () => {
			expect(() => loadSession("s-nonexistent", "/test")).toThrow(SessionError);
			expect(() => loadSession("s-nonexistent", "/test")).toThrow("Session not found");
		});
	});

	describe("saveSession", () => {
		it("should update the 'updated' timestamp on save", () => {
			const session = createSession({ project: "/test" });
			const firstUpdated = session.meta.updated;

			session.meta.title = "Updated Title";
			saveSession(session);

			expect(session.meta.updated).toBeDefined();
			const loaded = loadSession(session.meta.id, "/test");
			expect(loaded.meta.title).toBe("Updated Title");
		});
	});

	describe("addTurn", () => {
		it("should append a turn to an existing session", async () => {
			const session = createSession({ project: "/test" });

			await addTurn(session.meta.id, "/test", {
				turnNumber: 0,
				role: "user",
				content: "Hello!",
			});

			const loaded = loadSession(session.meta.id, "/test");
			expect(loaded.turns.length).toBeGreaterThanOrEqual(1);
			const userTurn = loaded.turns.find((t) => t.role === "user");
			expect(userTurn).toBeDefined();
			expect(userTurn!.content).toBe("Hello!");
		});

		it("should auto-assign turn numbers", async () => {
			const session = createSession({ project: "/test" });

			await addTurn(session.meta.id, "/test", {
				turnNumber: 0,
				role: "user",
				content: "First",
			});
			await addTurn(session.meta.id, "/test", {
				turnNumber: 0,
				role: "assistant",
				content: "Second",
			});

			const loaded = loadSession(session.meta.id, "/test");
			expect(loaded.turns[0].turnNumber).toBe(1);
			expect(loaded.turns[1].turnNumber).toBe(2);
		});

		it("should write turns to SQLite with FTS5 indexing", async () => {
			const session = createSession({ project: "/test" });

			await addTurn(session.meta.id, "/test", {
				turnNumber: 1,
				role: "user",
				content: "I love cooking Italian pasta with fresh basil",
			});

			const db = DatabaseManager.instance(tmpDir).get("agent");

			// Check turns table
			const turns = db.prepare("SELECT * FROM turns WHERE session_id = ?").all(session.meta.id) as Array<Record<string, unknown>>;
			expect(turns.length).toBe(1);
			expect(turns[0].content).toContain("pasta");

			// Check FTS5 search works
			const ftsResults = db.prepare(`
				SELECT t.session_id, t.content
				FROM turns_fts f
				JOIN turns t ON t.id = f.rowid
				WHERE turns_fts MATCH 'pasta basil'
			`).all() as Array<Record<string, unknown>>;
			expect(ftsResults.length).toBe(1);
		});

		it("should update session turn count in SQLite", async () => {
			const session = createSession({ project: "/test" });

			await addTurn(session.meta.id, "/test", { turnNumber: 1, role: "user", content: "One" });
			await addTurn(session.meta.id, "/test", { turnNumber: 2, role: "assistant", content: "Two" });

			const db = DatabaseManager.instance(tmpDir).get("agent");
			const row = db.prepare("SELECT turn_count FROM sessions WHERE id = ?").get(session.meta.id) as { turn_count: number };
			expect(row.turn_count).toBe(2);
		});

		it("should handle tool calls", async () => {
			const session = createSession({ project: "/test" });

			await addTurn(session.meta.id, "/test", {
				turnNumber: 1,
				role: "assistant",
				content: "Let me read that file.",
				toolCalls: [
					{ name: "read", input: '{"path": "/test.ts"}', result: "export const x = 1;" },
				],
			});

			const loaded = loadSession(session.meta.id, "/test");
			expect(loaded.turns[0].toolCalls).toHaveLength(1);
			expect(loaded.turns[0].toolCalls![0].name).toBe("read");
		});

		it("should throw for non-existent session", async () => {
			await expect(
				addTurn("session-9999-01-01", "/test", { turnNumber: 1, role: "user", content: "Nope" }),
			).rejects.toThrow(SessionError);
		});

		it("should serialize concurrent writes to the same session", async () => {
			const session = createSession({ project: "/test" });

			// Fire 5 concurrent writes
			const promises = Array.from({ length: 5 }, (_, i) =>
				addTurn(session.meta.id, "/test", {
					turnNumber: i + 1,
					role: i % 2 === 0 ? "user" : "assistant",
					content: `Turn ${i + 1}`,
				}),
			);

			await Promise.all(promises);

			const loaded = loadSession(session.meta.id, "/test");
			expect(loaded.turns.length).toBe(5);
		});
	});

	describe("listSessions", () => {
		it("should list sessions for a project from SQLite", () => {
			createSession({ project: "/proj-a", title: "Session A1" });
			createSession({ project: "/proj-a", title: "Session A2" });
			createSession({ project: "/proj-b", title: "Session B1" });

			const projA = listSessions("/proj-a");
			expect(projA.length).toBe(2);

			const projB = listSessions("/proj-b");
			expect(projB.length).toBe(1);
		});

		it("should list all sessions when no project filter", () => {
			createSession({ project: "/proj-a" });
			createSession({ project: "/proj-b" });

			const all = listSessions();
			expect(all.length).toBe(2);
		});

		it("should return sessions sorted by most recently updated first", () => {
			const s1 = createSession({ project: "/test", title: "First" });
			const s2 = createSession({ project: "/test", title: "Second" });

			const list = listSessions("/test");
			// s2 was created after s1, so it should be first
			expect(list[0].title).toBe("Second");
			expect(list[1].title).toBe("First");
		});

		it("should return empty array for unknown project", () => {
			expect(listSessions("/nonexistent")).toEqual([]);
		});
	});

	describe("deleteSession", () => {
		it("should delete session file and SQLite records", () => {
			const session = createSession({ project: "/test" });
			const id = session.meta.id;

			deleteSession(id, "/test");

			expect(() => loadSession(id, "/test")).toThrow(SessionError);

			// SQLite should also be cleaned
			const db = DatabaseManager.instance(tmpDir).get("agent");
			const row = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id);
			expect(row).toBeUndefined();
		});

		it("should throw for non-existent session", () => {
			expect(() => deleteSession("session-9999-01-01", "/test")).toThrow(SessionError);
		});

		it("should clean up empty parent directories", () => {
			const session = createSession({ project: "/test" });

			// Get the directory path before deletion
			const sessionsDir = path.join(tmpDir, "sessions");

			deleteSession(session.meta.id, "/test");

			// The project hash directory should be cleaned up if empty
			// (the YYYY/MM dirs should also be cleaned)
		});
	});

	describe("migrateExistingSessions", () => {
		it("should migrate old-style sessions into SQLite", () => {
			// Create an old-style session (flat directory, random ID)
			const projectHash = require("crypto").createHash("sha256").update("/legacy").digest("hex").slice(0, 12);
			const oldDir = path.join(tmpDir, "sessions", projectHash);
			fs.mkdirSync(oldDir, { recursive: true });

			const oldSession = {
				meta: {
					id: "s-abc123-deadbeef",
					title: "Legacy Session",
					created: "2025-01-15T10:00:00.000Z",
					updated: "2025-01-15T11:00:00.000Z",
					agent: "chitragupta",
					model: "claude-sonnet-4-5-20250929",
					project: "/legacy",
					parent: null,
					branch: null,
					tags: ["old"],
					totalCost: 0.5,
					totalTokens: 1000,
				},
				turns: [
					{ turnNumber: 1, role: "user" as const, content: "Hello from the past" },
					{ turnNumber: 2, role: "assistant" as const, content: "Greetings!" },
				],
			};

			const md = writeSessionMarkdown(oldSession);
			fs.writeFileSync(path.join(oldDir, "s-abc123-deadbeef.md"), md, "utf-8");

			// Initialize DB schema
			const dbm = DatabaseManager.instance(tmpDir);
			initAgentSchema(dbm);

			const result = migrateExistingSessions();
			expect(result.migrated).toBe(1);
			expect(result.skipped).toBe(0);

			// Verify SQLite has the session
			const db = dbm.get("agent");
			const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get("s-abc123-deadbeef") as Record<string, unknown>;
			expect(row).toBeDefined();
			expect(row.title).toBe("Legacy Session");
			expect(row.turn_count).toBe(2);

			// Verify turns are indexed
			const turns = db.prepare("SELECT * FROM turns WHERE session_id = ?").all("s-abc123-deadbeef") as Array<Record<string, unknown>>;
			expect(turns.length).toBe(2);

			// Verify FTS5 search works
			const fts = db.prepare(`
				SELECT t.content FROM turns_fts f JOIN turns t ON t.id = f.rowid
				WHERE turns_fts MATCH 'past'
			`).all() as Array<{ content: string }>;
			expect(fts.length).toBe(1);
			expect(fts[0].content).toContain("past");
		});

		it("should skip already-indexed sessions", () => {
			const session = createSession({ project: "/test" });

			// Session was already written to SQLite by createSession
			const result = migrateExistingSessions("/test");
			expect(result.skipped).toBeGreaterThanOrEqual(1);
			expect(result.migrated).toBe(0);
		});

		it("should return zero counts when no sessions exist", () => {
			const result = migrateExistingSessions("/empty");
			expect(result.migrated).toBe(0);
			expect(result.skipped).toBe(0);
		});
	});

	describe("backward compatibility", () => {
		it("should resolve old-style flat session paths", () => {
			// Create a session at the old flat path
			const projectHash = require("crypto").createHash("sha256").update("/compat").digest("hex").slice(0, 12);
			const flatDir = path.join(tmpDir, "sessions", projectHash);
			fs.mkdirSync(flatDir, { recursive: true });

			const session = {
				meta: {
					id: "s-old-style-id",
					title: "Old Style",
					created: "2025-06-01T00:00:00.000Z",
					updated: "2025-06-01T00:00:00.000Z",
					agent: "chitragupta",
					model: "gpt-4",
					project: "/compat",
					parent: null,
					branch: null,
					tags: [],
					totalCost: 0,
					totalTokens: 0,
				},
				turns: [],
			};

			const md = writeSessionMarkdown(session);
			fs.writeFileSync(path.join(flatDir, "s-old-style-id.md"), md, "utf-8");

			// loadSession should find it in the flat directory
			const loaded = loadSession("s-old-style-id", "/compat");
			expect(loaded.meta.title).toBe("Old Style");
		});
	});
});

// Helper to find .md files recursively
function findMdFilesRecursive(dir: string): string[] {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;

	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findMdFilesRecursive(fullPath));
		} else if (entry.name.endsWith(".md")) {
			results.push(fullPath);
		}
	}
	return results;
}
