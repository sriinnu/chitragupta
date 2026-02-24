import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type BetterSqlite3 from "better-sqlite3";

// ─── In-Memory SQLite Mock ───────────────────────────────────────────────────

/**
 * Lightweight in-memory table engine for testing CritiqueStore
 * without requiring an actual SQLite binary.
 */
function createMockDb() {
	let rows: Array<Record<string, unknown>> = [];

	const db = {
		exec(_sql: string) {
			// Schema DDL is a no-op for the mock -- table is the `rows` array
		},
		prepare(sql: string) {
			return {
				run(...params: unknown[]) {
					if (sql.includes("INSERT INTO critiques")) {
						const [id, task_hash, severity, category, message, file, line, metadata, session_id, created_at] = params;
						rows.push({ id, task_hash, severity, category, message, file, line, metadata, session_id, created_at });
						return { changes: 1, lastInsertRowid: rows.length };
					}
					if (sql.includes("DELETE FROM critiques WHERE created_at")) {
						const cutoff = params[0] as number;
						const before = rows.length;
						rows = rows.filter(r => (r.created_at as number) >= cutoff);
						return { changes: before - rows.length };
					}
					if (sql.includes("DELETE FROM critiques WHERE task_hash")) {
						const hash = params[0] as string;
						const before = rows.length;
						rows = rows.filter(r => r.task_hash !== hash);
						return { changes: before - rows.length };
					}
					if (sql.includes("DELETE FROM critiques WHERE id IN")) {
						const taskHash = params[0] as string;
						const limit = params[1] as number;
						const taskRows = rows
							.filter(r => r.task_hash === taskHash)
							.sort((a, b) => (a.created_at as number) - (b.created_at as number));
						const toRemove = new Set(taskRows.slice(0, limit).map(r => r.id));
						rows = rows.filter(r => !toRemove.has(r.id as string));
						return { changes: toRemove.size };
					}
					if (sql.includes("DELETE FROM critiques")) {
						const cnt = rows.length;
						rows = [];
						return { changes: cnt };
					}
					return { changes: 0, lastInsertRowid: 0 };
				},
				get(...params: unknown[]) {
					if (sql.includes("COUNT(DISTINCT task_hash)")) {
						return { cnt: new Set(rows.map(r => r.task_hash)).size };
					}
					if (sql.includes("COUNT(*)") && sql.includes("WHERE task_hash")) {
						return { cnt: rows.filter(r => r.task_hash === params[0]).length };
					}
					if (sql.includes("COUNT(*)")) {
						return { cnt: rows.length };
					}
					if (sql.includes("SELECT") && sql.includes("FROM critiques") && sql.includes("WHERE task_hash") && sql.includes("category")) {
						const [taskHash, category, message, cutoff] = params;
						const match = rows.find(r =>
							r.task_hash === taskHash &&
							r.category === category &&
							r.message === message &&
							(r.created_at as number) > (cutoff as number),
						);
						return match ?? undefined;
					}
					return undefined;
				},
				all(...params: unknown[]) {
					if (sql.includes("GROUP BY severity")) {
						const map = new Map<string, number>();
						for (const r of rows) {
							const s = r.severity as string;
							map.set(s, (map.get(s) ?? 0) + 1);
						}
						return [...map.entries()].map(([severity, cnt]) => ({ severity, cnt }));
					}
					if (sql.includes("WHERE task_hash")) {
						const taskHash = params[0] as string;
						const limit = params[1] as number;
						return rows
							.filter(r => r.task_hash === taskHash)
							.sort((a, b) => (b.created_at as number) - (a.created_at as number))
							.slice(0, limit);
					}
					// Full table scan for searchCritiques
					return [...rows];
				},
			};
		},
	};
	return db as unknown as BetterSqlite3.Database;
}

// ─── Module Mocks ────────────────────────────────────────────────────────────

let mockDb: BetterSqlite3.Database;

vi.mock("../src/db/database.js", () => ({
	DatabaseManager: {
		instance: () => ({
			get: () => mockDb,
		}),
		reset: vi.fn(),
	},
}));

vi.mock("../src/db/schema.js", () => ({
	initAgentSchema: vi.fn(),
	initGraphSchema: vi.fn(),
	initVectorsSchema: vi.fn(),
	initAllSchemas: vi.fn(),
}));

import { CritiqueStore } from "../src/critique-store.js";
import type { CritiqueFinding, CritiqueStoreConfig } from "../src/critique-store.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CritiqueStore", () => {
	let store: CritiqueStore;

	beforeEach(() => {
		mockDb = createMockDb();
		store = new CritiqueStore();
	});

	// ── storeCritique + retrieveCritiques ──────────────────────────────────

	describe("storeCritique / retrieveCritiques", () => {
		it("should store and retrieve a critique finding", () => {
			const result = store.storeCritique("task-abc", {
				severity: "warning",
				category: "security",
				message: "SQL injection risk in user input handler",
				file: "src/handler.ts",
				line: 42,
				sessionId: "sess-1",
			});

			expect(result.id).toBeDefined();
			expect(result.taskHash).toBe("task-abc");
			expect(result.severity).toBe("warning");
			expect(result.category).toBe("security");
			expect(result.message).toBe("SQL injection risk in user input handler");
			expect(result.file).toBe("src/handler.ts");
			expect(result.line).toBe(42);
			expect(result.createdAt).toBeGreaterThan(0);

			const retrieved = store.retrieveCritiques("task-abc");
			expect(retrieved).toHaveLength(1);
			expect(retrieved[0].message).toBe("SQL injection risk in user input handler");
		});

		it("should return most recent critiques first", () => {
			// Use vi.spyOn(Date, "now") to control timestamps
			let clock = 1000;
			const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);

			store.storeCritique("task-1", { severity: "info", category: "style", message: "first" });
			clock = 2000;
			store.storeCritique("task-1", { severity: "info", category: "style", message: "second" });
			clock = 3000;
			store.storeCritique("task-1", { severity: "info", category: "style", message: "third" });

			spy.mockRestore();

			const results = store.retrieveCritiques("task-1");
			expect(results[0].message).toBe("third");
			expect(results[2].message).toBe("first");
		});

		it("should respect k limit", () => {
			for (let i = 0; i < 20; i++) {
				store.storeCritique("task-many", {
					severity: "info",
					category: "perf",
					message: `finding ${i}`,
				});
			}

			const results = store.retrieveCritiques("task-many", 5);
			expect(results).toHaveLength(5);
		});

		it("should store and retrieve metadata", () => {
			store.storeCritique("task-meta", {
				severity: "error",
				category: "correctness",
				message: "Off by one in loop",
				metadata: { loopVar: "i", expected: 10, actual: 11 },
			});

			const retrieved = store.retrieveCritiques("task-meta");
			expect(retrieved[0].metadata).toEqual({ loopVar: "i", expected: 10, actual: 11 });
		});
	});

	// ── Deduplication ─────────────────────────────────────────────────────

	describe("deduplication", () => {
		it("should suppress duplicate findings within dedupeWindow", () => {
			store.storeCritique("task-dup", {
				severity: "warning",
				category: "security",
				message: "XSS vulnerability",
			});

			// Same finding again -- should be deduped
			const dup = store.storeCritique("task-dup", {
				severity: "warning",
				category: "security",
				message: "XSS vulnerability",
			});

			const all = store.retrieveCritiques("task-dup");
			expect(all).toHaveLength(1);
			expect(dup.id).toBe(all[0].id);
		});

		it("should allow different messages for same category", () => {
			store.storeCritique("task-diff", {
				severity: "warning",
				category: "security",
				message: "XSS vulnerability",
			});
			store.storeCritique("task-diff", {
				severity: "warning",
				category: "security",
				message: "CSRF vulnerability",
			});

			const all = store.retrieveCritiques("task-diff");
			expect(all).toHaveLength(2);
		});
	});

	// ── searchCritiques ────────────────────────────────────────────────────

	describe("searchCritiques", () => {
		it("should find critiques by text search", () => {
			store.storeCritique("task-a", {
				severity: "error",
				category: "performance",
				message: "Memory leak in event listener cleanup",
			});
			store.storeCritique("task-b", {
				severity: "warning",
				category: "security",
				message: "Unvalidated user input in API endpoint",
			});

			const results = store.searchCritiques("memory leak");
			expect(results).toHaveLength(1);
			expect(results[0].message).toContain("Memory leak");
		});

		it("should return empty for empty query", () => {
			store.storeCritique("task-x", {
				severity: "info",
				category: "style",
				message: "Naming convention violation",
			});

			expect(store.searchCritiques("")).toHaveLength(0);
		});

		it("should respect limit parameter", () => {
			for (let i = 0; i < 15; i++) {
				store.storeCritique(`task-${i}`, {
					severity: "info",
					category: "performance",
					message: `performance issue number ${i}`,
				});
			}

			const results = store.searchCritiques("performance issue", 5);
			expect(results.length).toBeLessThanOrEqual(5);
		});
	});

	// ── purgeExpired ──────────────────────────────────────────────────────

	describe("purgeExpired", () => {
		it("should remove findings older than retentionDays", () => {
			// Insert a finding at a fixed past timestamp (100 days ago)
			const pastMs = Date.now() - 100 * 24 * 60 * 60 * 1000;
			const spy = vi.spyOn(Date, "now").mockReturnValue(pastMs);

			store.storeCritique("task-old", {
				severity: "info",
				category: "style",
				message: "Old finding",
			});

			spy.mockRestore();

			// Default retention is 90 days -- finding at 100 days ago should be expired
			const removed = store.purgeExpired();
			expect(removed).toBe(1);

			const remaining = store.retrieveCritiques("task-old");
			expect(remaining).toHaveLength(0);
		});
	});

	// ── getStats ─────────────────────────────────────────────────────────

	describe("getStats", () => {
		it("should return correct aggregate statistics", () => {
			store.storeCritique("task-1", { severity: "error", category: "security", message: "a" });
			store.storeCritique("task-1", { severity: "warning", category: "perf", message: "b" });
			store.storeCritique("task-2", { severity: "error", category: "correctness", message: "c" });
			store.storeCritique("task-3", { severity: "critical", category: "security", message: "d" });

			const stats = store.getStats();
			expect(stats.totalCritiques).toBe(4);
			expect(stats.uniqueTasks).toBe(3);
			expect(stats.bySeverity.error).toBe(2);
			expect(stats.bySeverity.warning).toBe(1);
			expect(stats.bySeverity.critical).toBe(1);
		});

		it("should return zero stats for empty store", () => {
			const stats = store.getStats();
			expect(stats.totalCritiques).toBe(0);
			expect(stats.uniqueTasks).toBe(0);
			expect(Object.keys(stats.bySeverity)).toHaveLength(0);
		});
	});

	// ── clear ────────────────────────────────────────────────────────────

	describe("clear", () => {
		it("should clear all critiques when no taskHash provided", () => {
			store.storeCritique("task-1", { severity: "info", category: "a", message: "m1" });
			store.storeCritique("task-2", { severity: "info", category: "b", message: "m2" });

			store.clear();
			expect(store.getStats().totalCritiques).toBe(0);
		});

		it("should clear only critiques for a specific task", () => {
			store.storeCritique("task-1", { severity: "info", category: "a", message: "m1" });
			store.storeCritique("task-2", { severity: "info", category: "b", message: "m2" });

			store.clear("task-1");
			expect(store.retrieveCritiques("task-1")).toHaveLength(0);
			expect(store.retrieveCritiques("task-2")).toHaveLength(1);
		});
	});
});
