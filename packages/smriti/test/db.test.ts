/**
 * Tests for the SQLite database layer (DatabaseManager + schema).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAllSchemas, initAgentSchema, initGraphSchema, initVectorsSchema } from "@chitragupta/smriti/db/schema";

describe("DatabaseManager", () => {
	let tmpDir: string;
	let dbm: DatabaseManager;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-db-test-"));
		DatabaseManager.reset();
		dbm = DatabaseManager.instance(tmpDir);
	});

	afterEach(() => {
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("instance management", () => {
		it("should return the same instance on repeated calls", () => {
			const a = DatabaseManager.instance(tmpDir);
			const b = DatabaseManager.instance(tmpDir);
			expect(a).toBe(b);
		});

		it("should create a new instance after reset", () => {
			const a = DatabaseManager.instance(tmpDir);
			DatabaseManager.reset();
			const b = DatabaseManager.instance(tmpDir);
			expect(a).not.toBe(b);
		});
	});

	describe("database access", () => {
		it("should create agent.db on first access", () => {
			dbm.get("agent");
			expect(fs.existsSync(path.join(tmpDir, "agent.db"))).toBe(true);
		});

		it("should create graph.db on first access", () => {
			dbm.get("graph");
			expect(fs.existsSync(path.join(tmpDir, "graph.db"))).toBe(true);
		});

		it("should create vectors.db on first access", () => {
			dbm.get("vectors");
			expect(fs.existsSync(path.join(tmpDir, "vectors.db"))).toBe(true);
		});

		it("should return the same database object on repeated calls", () => {
			const a = dbm.get("agent");
			const b = dbm.get("agent");
			expect(a).toBe(b);
		});

		it("should set WAL journal mode", () => {
			const db = dbm.get("agent");
			const result = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
			expect(result[0].journal_mode).toBe("wal");
		});

		it("should throw after closeAll", () => {
			dbm.closeAll();
			expect(() => dbm.get("agent")).toThrow("DatabaseManager has been closed");
		});
	});

	describe("close", () => {
		it("should close a specific database", () => {
			dbm.get("agent");
			dbm.get("graph");
			dbm.close("agent");
			// graph should still work
			const gdb = dbm.get("graph");
			expect(gdb.prepare("SELECT 1 as v").get()).toEqual({ v: 1 });
			// agent should reopen
			const adb = dbm.get("agent");
			expect(adb.prepare("SELECT 1 as v").get()).toEqual({ v: 1 });
		});
	});

	describe("utility methods", () => {
		it("should return correct path", () => {
			expect(dbm.getPath("agent")).toBe(path.join(tmpDir, "agent.db"));
		});

		it("should pass integrity check on fresh database", () => {
			initAgentSchema(dbm);
			expect(dbm.integrityCheck("agent")).toBe("ok");
		});
	});
});

describe("Schema initialization", () => {
	let tmpDir: string;
	let dbm: DatabaseManager;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-schema-test-"));
		DatabaseManager.reset();
		dbm = DatabaseManager.instance(tmpDir);
	});

	afterEach(() => {
		DatabaseManager.reset();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("initAllSchemas", () => {
		it("should create all tables without error", () => {
			expect(() => initAllSchemas(dbm)).not.toThrow();
		});

		it("should be idempotent", () => {
			initAllSchemas(dbm);
			expect(() => initAllSchemas(dbm)).not.toThrow();
		});
	});

	describe("agent.db schema", () => {
		beforeEach(() => {
			initAgentSchema(dbm);
		});

		it("should create sessions table", () => {
			const db = dbm.get("agent");
			const info = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("id");
			expect(cols).toContain("project");
			expect(cols).toContain("title");
			expect(cols).toContain("created_at");
			expect(cols).toContain("updated_at");
			expect(cols).toContain("turn_count");
			expect(cols).toContain("file_path");
			expect(cols).toContain("tags");
		});

		it("should create turns table", () => {
			const db = dbm.get("agent");
			const info = db.prepare("PRAGMA table_info(turns)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("id");
			expect(cols).toContain("session_id");
			expect(cols).toContain("turn_number");
			expect(cols).toContain("role");
			expect(cols).toContain("content");
		});

		it("should create turns_fts virtual table", () => {
			const db = dbm.get("agent");
			const tables = db.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='turns_fts'"
			).all() as Array<{ name: string }>;
			expect(tables.length).toBe(1);
		});

		it("should create vasanas table", () => {
			const db = dbm.get("agent");
			const info = db.prepare("PRAGMA table_info(vasanas)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("id");
			expect(cols).toContain("name");
			expect(cols).toContain("strength");
			expect(cols).toContain("valence");
			expect(cols).toContain("project");
		});

		it("should create kartavyas table", () => {
			const db = dbm.get("agent");
			const info = db.prepare("PRAGMA table_info(kartavyas)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("id");
			expect(cols).toContain("trigger_type");
			expect(cols).toContain("status");
		});

		it("should create consolidation_rules table", () => {
			const db = dbm.get("agent");
			const info = db.prepare("PRAGMA table_info(consolidation_rules)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("category");
			expect(cols).toContain("confidence");
			expect(cols).toContain("project");
		});

		it("should allow inserting and querying sessions", () => {
			const db = dbm.get("agent");
			const now = Date.now();

			db.prepare(`
				INSERT INTO sessions (id, project, title, created_at, updated_at, file_path)
				VALUES (?, ?, ?, ?, ?, ?)
			`).run("s-test-1", "/my/project", "Test Session", now, now, "sessions/2026/02/session-2026-02-09.md");

			const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get("s-test-1") as Record<string, unknown>;
			expect(row.project).toBe("/my/project");
			expect(row.title).toBe("Test Session");
		});

		it("should allow inserting turns and searching via FTS5", () => {
			const db = dbm.get("agent");
			const now = Date.now();

			// Insert session first (FK constraint)
			db.prepare(`
				INSERT INTO sessions (id, project, title, created_at, updated_at, file_path)
				VALUES (?, ?, ?, ?, ?, ?)
			`).run("s-fts-test", "/project", "FTS Test", now, now, "test.md");

			// Insert turn
			db.prepare(`
				INSERT INTO turns (session_id, turn_number, role, content, created_at)
				VALUES (?, ?, ?, ?, ?)
			`).run("s-fts-test", 1, "user", "I love cooking Italian pasta with fresh basil", now);

			// Get the turn's rowid
			const turn = db.prepare("SELECT id FROM turns WHERE session_id = ?").get("s-fts-test") as { id: number };

			// Insert into FTS5
			db.prepare("INSERT INTO turns_fts (rowid, content) VALUES (?, ?)").run(
				turn.id,
				"I love cooking Italian pasta with fresh basil",
			);

			// Search
			const results = db.prepare(`
				SELECT t.session_id, t.content, rank
				FROM turns_fts f
				JOIN turns t ON t.id = f.rowid
				WHERE turns_fts MATCH 'pasta basil'
				ORDER BY rank
			`).all() as Array<{ session_id: string; content: string; rank: number }>;

			expect(results.length).toBe(1);
			expect(results[0].session_id).toBe("s-fts-test");
			expect(results[0].content).toContain("pasta");
		});
	});

	describe("graph.db schema", () => {
		beforeEach(() => {
			initGraphSchema(dbm);
		});

		it("should create nodes table", () => {
			const db = dbm.get("graph");
			const info = db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("id");
			expect(cols).toContain("type");
			expect(cols).toContain("label");
		});

		it("should create edges table with pramana and viveka fields", () => {
			const db = dbm.get("graph");
			const info = db.prepare("PRAGMA table_info(edges)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("source");
			expect(cols).toContain("target");
			expect(cols).toContain("pramana");
			expect(cols).toContain("viveka");
			expect(cols).toContain("valid_from");
			expect(cols).toContain("superseded_at");
		});

		it("should create pagerank table", () => {
			const db = dbm.get("graph");
			const info = db.prepare("PRAGMA table_info(pagerank)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("node_id");
			expect(cols).toContain("score");
		});

		it("should allow inserting nodes and edges", () => {
			const db = dbm.get("graph");
			const now = Date.now();

			db.prepare("INSERT INTO nodes (id, type, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
				"n1", "concept", "TypeScript", now, now,
			);
			db.prepare("INSERT INTO nodes (id, type, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
				"n2", "concept", "JavaScript", now, now,
			);
			db.prepare(`
				INSERT INTO edges (source, target, relationship, weight, pramana, viveka, recorded_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run("n1", "n2", "compiles_to", 1.0, "pratyaksha", "grounded", now);

			const edges = db.prepare("SELECT * FROM edges WHERE source = ?").all("n1") as Array<Record<string, unknown>>;
			expect(edges.length).toBe(1);
			expect(edges[0].pramana).toBe("pratyaksha");
		});
	});

	describe("vectors.db schema", () => {
		beforeEach(() => {
			initVectorsSchema(dbm);
		});

		it("should create embeddings table", () => {
			const db = dbm.get("vectors");
			const info = db.prepare("PRAGMA table_info(embeddings)").all() as Array<{ name: string }>;
			const cols = info.map((r) => r.name);
			expect(cols).toContain("id");
			expect(cols).toContain("vector");
			expect(cols).toContain("text");
			expect(cols).toContain("source_type");
			expect(cols).toContain("dimensions");
		});

		it("should allow inserting and retrieving vector blobs", () => {
			const db = dbm.get("vectors");
			const now = Date.now();
			const vector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
			const blob = Buffer.from(vector.buffer);

			db.prepare(`
				INSERT INTO embeddings (id, vector, text, source_type, source_id, dimensions, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run("emb-1", blob, "test text", "turn", "s-1", 4, now);

			const row = db.prepare("SELECT * FROM embeddings WHERE id = ?").get("emb-1") as {
				vector: Buffer;
				dimensions: number;
			};
			expect(row.dimensions).toBe(4);

			// Verify we can reconstruct the vector
			const restored = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dimensions);
			expect(restored[0]).toBeCloseTo(0.1);
			expect(restored[3]).toBeCloseTo(0.4);
		});
	});

	describe("schema versioning", () => {
		it("should track schema versions", () => {
			initAgentSchema(dbm);
			const db = dbm.get("agent");
			const row = db.prepare("SELECT version FROM _schema_versions WHERE name = 'agent'").get() as { version: number };
			expect(row.version).toBe(4);
		});

		it("should skip re-initialization when version matches", () => {
			initAgentSchema(dbm);
			// Second call should be a no-op
			initAgentSchema(dbm);
			const db = dbm.get("agent");
			const row = db.prepare("SELECT version FROM _schema_versions WHERE name = 'agent'").get() as { version: number };
			expect(row.version).toBe(4);
		});
	});
});
