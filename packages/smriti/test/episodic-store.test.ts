import { describe, it, expect, vi, beforeEach } from "vitest";
import type BetterSqlite3 from "better-sqlite3";

// ─── In-Memory SQLite Mock ───────────────────────────────────────────────────

/** Lightweight in-memory table engine for testing EpisodicMemoryStore. */
function createMockDb() {
	let rows: Array<Record<string, unknown>> = [];

	const db = {
		exec(_sql: string) { /* Schema DDL no-op */ },
		prepare(sql: string) {
			return {
				run(...params: unknown[]) {
					if (sql.includes("INSERT INTO episodes")) {
						const [id, created_at, project, error_signature, tool_name, file_path, description, solution, tags] = params;
						rows.push({
							id, created_at, project, error_signature, tool_name, file_path,
							description, solution, tags, recall_count: 0, last_recalled: null,
						});
						return { changes: 1, lastInsertRowid: rows.length };
					}
					if (sql.includes("UPDATE episodes SET recall_count")) {
						const [last_recalled, id] = params;
						const row = rows.find((r) => r.id === id);
						if (row) {
							row.recall_count = (row.recall_count as number) + 1;
							row.last_recalled = last_recalled;
						}
						return { changes: row ? 1 : 0 };
					}
					return { changes: 0 };
				},
				get() { return undefined; },
				all(...params: unknown[]) {
					if (sql.includes("WHERE error_signature = ?")) {
						const sig = params[0] as string;
						const limit = params[1] as number;
						return rows.filter((r) => r.error_signature === sig)
							.sort((a, b) => (b.recall_count as number) - (a.recall_count as number))
							.slice(0, limit);
					}
					if (sql.includes("WHERE file_path = ?")) {
						const fp = params[0] as string;
						const limit = params[1] as number;
						return rows.filter((r) => r.file_path === fp)
							.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
							.slice(0, limit);
					}
					if (sql.includes("WHERE tool_name = ?")) {
						const tn = params[0] as string;
						const limit = params[1] as number;
						return rows.filter((r) => r.tool_name === tn)
							.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
							.slice(0, limit);
					}
					if (sql.includes("WHERE recall_count > 0")) {
						const limit = params[0] as number;
						return rows.filter((r) => (r.recall_count as number) > 0)
							.sort((a, b) => (b.recall_count as number) - (a.recall_count as number))
							.slice(0, limit);
					}
					if (sql.includes("WHERE") && !sql.includes("recall_count > 0")) {
						let filtered = [...rows];
						let idx = 0;
						if (sql.includes("project = ?")) { filtered = filtered.filter((r) => r.project === params[idx]); idx++; }
						if (sql.includes("error_signature = ?")) { filtered = filtered.filter((r) => r.error_signature === params[idx]); idx++; }
						if (sql.includes("tool_name = ?")) { filtered = filtered.filter((r) => r.tool_name === params[idx]); idx++; }
						if (sql.includes("file_path = ?")) { filtered = filtered.filter((r) => r.file_path === params[idx]); idx++; }
						const limit = sql.includes("LIMIT") ? (params[idx] as number ?? 10) : 10;
						return filtered.sort((a, b) => (b.recall_count as number) - (a.recall_count as number)).slice(0, limit);
					}
					if (sql.includes("FROM episodes")) {
						const limit = params[0] as number;
						if (typeof limit === "number") {
							return [...rows].sort((a, b) => (b.recall_count as number) - (a.recall_count as number)).slice(0, limit);
						}
						return [...rows];
					}
					return [];
				},
			};
		},
	};
	return db as unknown as BetterSqlite3.Database;
}

// ─── Module Mocks ────────────────────────────────────────────────────────────

let mockDb: BetterSqlite3.Database;

vi.mock("../src/db/database.js", () => ({
	DatabaseManager: { instance: () => ({ get: () => mockDb }), reset: vi.fn() },
}));

vi.mock("../src/db/schema.js", () => ({
	initAgentSchema: vi.fn(), initGraphSchema: vi.fn(),
	initVectorsSchema: vi.fn(), initAllSchemas: vi.fn(),
}));

import { EpisodicMemoryStore } from "../src/episodic-store.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("EpisodicMemoryStore", () => {
	let store: EpisodicMemoryStore;

	beforeEach(() => { mockDb = createMockDb(); store = new EpisodicMemoryStore(); });

	describe("record + recall round-trip", () => {
		it("should store and recall by error signature", () => {
			const id = store.record({
				project: "/test", description: "Vitest ESM mismatch",
				solution: "Set module: NodeNext", errorSignature: "ERR_MODULE_NOT_FOUND:vitest",
				toolName: "vitest", filePath: "test/foo.test.ts", tags: ["esm", "vitest"],
			});
			expect(id).toBeDefined();
			const results = store.recallByError("ERR_MODULE_NOT_FOUND:vitest");
			expect(results).toHaveLength(1);
			expect(results[0].solution).toBe("Set module: NodeNext");
			expect(results[0].tags).toEqual(["esm", "vitest"]);
		});

		it("should store episode without optional fields", () => {
			store.record({ project: "/test", description: "Learned strict mode benefits" });
			const results = store.recall({ project: "/test" });
			expect(results).toHaveLength(1);
			expect(results[0].errorSignature).toBeNull();
			expect(results[0].toolName).toBeNull();
			expect(results[0].solution).toBeNull();
		});
	});

	describe("normalizeErrorSignature", () => {
		it("should strip file paths", () => {
			const n = EpisodicMemoryStore.normalizeErrorSignature("Cannot find '/Users/dev/src/utils.ts'");
			expect(n).not.toContain("/Users/dev"); expect(n).toContain("<PATH>");
		});

		it("should strip line:col references", () => {
			const n = EpisodicMemoryStore.normalizeErrorSignature("SyntaxError at file.ts:42:10");
			expect(n).not.toContain(":42:10");
		});

		it("should strip timestamps and UUIDs", () => {
			const n1 = EpisodicMemoryStore.normalizeErrorSignature("Error at 2026-03-04T10:30:00Z: timeout");
			expect(n1).toContain("<TIME>");
			const n2 = EpisodicMemoryStore.normalizeErrorSignature("Session a1b2c3d4-e5f6-7890-abcd-ef1234567890 gone");
			expect(n2).toContain("<UUID>");
		});

		it("should preserve error type and collapse whitespace", () => {
			const n = EpisodicMemoryStore.normalizeErrorSignature("ERR_MODULE_NOT_FOUND:    missing");
			expect(n).toContain("ERR_MODULE_NOT_FOUND");
			expect(n).not.toContain("   ");
		});

		it("should truncate to 200 chars", () => {
			expect(EpisodicMemoryStore.normalizeErrorSignature("A".repeat(500)).length).toBeLessThanOrEqual(200);
		});
	});

	describe("recallByError", () => {
		it("should find matching episodes", () => {
			store.record({ project: "/test", description: "TSC null check", errorSignature: "TS2322", toolName: "tsc" });
			store.record({ project: "/test", description: "Vitest timeout", errorSignature: "VITEST_TIMEOUT", toolName: "vitest" });
			expect(store.recallByError("TS2322")).toHaveLength(1);
			expect(store.recallByError("TS2322")[0].description).toContain("null check");
		});

		it("should return empty for unknown signature", () => {
			expect(store.recallByError("UNKNOWN")).toHaveLength(0);
		});
	});

	describe("recallByFile", () => {
		it("should find episodes related to a file", () => {
			store.record({ project: "/test", description: "Fixed utils", filePath: "src/utils.ts" });
			store.record({ project: "/test", description: "Fixed main", filePath: "src/main.ts" });
			const results = store.recallByFile("src/utils.ts");
			expect(results).toHaveLength(1);
			expect(results[0].description).toContain("utils");
		});

		it("should respect limit", () => {
			for (let i = 0; i < 15; i++) store.record({ project: "/t", description: `c${i}`, filePath: "f.ts" });
			expect(store.recallByFile("f.ts", 5)).toHaveLength(5);
		});
	});

	describe("recallByTool", () => {
		it("should find episodes for a tool", () => {
			store.record({ project: "/test", description: "ESLint config issue", toolName: "eslint" });
			store.record({ project: "/test", description: "Vitest coverage fail", toolName: "vitest" });
			expect(store.recallByTool("eslint")).toHaveLength(1);
		});

		it("should return empty for unknown tool", () => {
			expect(store.recallByTool("nonexistent")).toHaveLength(0);
		});
	});

	describe("search (full-text BM25)", () => {
		it("should find by description text", () => {
			store.record({ project: "/t", description: "Memory leak in event listener cleanup", solution: "Return cleanup fn" });
			store.record({ project: "/t", description: "TypeScript strict mode" });
			const results = store.search("memory leak event listener");
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].description).toContain("Memory leak");
		});

		it("should find by solution text", () => {
			store.record({ project: "/t", description: "Vitest ESM mismatch", solution: "Use moduleResolution NodeNext" });
			expect(store.search("NodeNext").length).toBeGreaterThanOrEqual(1);
		});

		it("should return empty for empty query", () => {
			store.record({ project: "/t", description: "Something" });
			expect(store.search("")).toHaveLength(0);
		});

		it("should respect limit", () => {
			for (let i = 0; i < 20; i++) store.record({ project: "/t", description: `perf issue ${i} database query` });
			expect(store.search("perf database", 3).length).toBeLessThanOrEqual(3);
		});
	});

	describe("bumpRecallCount", () => {
		it("should increment count and set last_recalled", () => {
			const id = store.record({ project: "/t", description: "Recurring issue", errorSignature: "RECURRING" });
			store.bumpRecallCount(id);
			const r = store.recallByError("RECURRING");
			expect(r[0].recallCount).toBe(1);
			expect(r[0].lastRecalled).not.toBeNull();
		});

		it("should increment multiple times", () => {
			const id = store.record({ project: "/t", description: "Frequent", errorSignature: "FREQ" });
			store.bumpRecallCount(id); store.bumpRecallCount(id); store.bumpRecallCount(id);
			expect(store.recallByError("FREQ")[0].recallCount).toBe(3);
		});
	});

	describe("getFrequentErrors", () => {
		it("should return most-recalled episodes in order", () => {
			const id1 = store.record({ project: "/t", description: "Rare", errorSignature: "RARE" });
			const id2 = store.record({ project: "/t", description: "Common", errorSignature: "COMMON" });
			store.bumpRecallCount(id1);
			store.bumpRecallCount(id2); store.bumpRecallCount(id2); store.bumpRecallCount(id2);
			const freq = store.getFrequentErrors(10);
			expect(freq).toHaveLength(2);
			expect(freq[0].errorSignature).toBe("COMMON");
			expect(freq[0].recallCount).toBe(3);
		});

		it("should exclude zero-recall episodes", () => {
			store.record({ project: "/t", description: "Never recalled", errorSignature: "NEVER" });
			expect(store.getFrequentErrors()).toHaveLength(0);
		});

		it("should respect limit", () => {
			for (let i = 0; i < 15; i++) {
				const id = store.record({ project: "/t", description: `E${i}`, errorSignature: `E_${i}` });
				store.bumpRecallCount(id);
			}
			expect(store.getFrequentErrors(5)).toHaveLength(5);
		});
	});

	describe("recall (multi-field query)", () => {
		it("should filter by multiple fields", () => {
			store.record({ project: "/test", description: "TSC in utils", errorSignature: "TS2322", toolName: "tsc", filePath: "utils.ts" });
			store.record({ project: "/test", description: "TSC in main", errorSignature: "TS2322", toolName: "tsc", filePath: "main.ts" });
			store.record({ project: "/other", description: "ESLint err", errorSignature: "ESLINT", toolName: "eslint" });
			const results = store.recall({ project: "/test", errorSignature: "TS2322", toolName: "tsc" });
			expect(results).toHaveLength(2);
		});

		it("should combine text search with field filters", () => {
			store.record({ project: "/t", description: "DB connection pool exhaustion under load", toolName: "postgres" });
			store.record({ project: "/t", description: "Redis timeout", toolName: "redis" });
			const results = store.recall({ project: "/t", text: "connection pool" });
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].description).toContain("connection pool");
		});
	});
});
