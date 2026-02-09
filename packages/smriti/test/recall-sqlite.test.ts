/**
 * Integration tests for RecallEngine SQLite persistence (Phase 0.6).
 *
 * Tests:
 *   - vectorToBlob / blobToVector roundtrip precision
 *   - RecallEngine persists entries to SQLite vectors.db
 *   - Entries survive engine reload (new RecallEngine instance)
 *   - Migration from JSON to SQLite
 *   - Search still works after SQLite migration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initVectorsSchema } from "@chitragupta/smriti/db/schema";
import {
	vectorToBlob,
	blobToVector,
	_resetRecallDbInit,
} from "../src/recall.js";

// ─── Mock getChitraguptaHome to use temp directory ────────────────────────────

let tmpDir: string;

vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: () => tmpDir,
}));

// ─── Mock embedding service to avoid Ollama dependency ────────────────────────

vi.mock("../src/embedding-service.js", () => {
	/** Deterministic hash-based embedding for tests. */
	function hashEmbedding(text: string): number[] {
		const dim = 384;
		const vec = new Array(dim).fill(0);
		for (let i = 0; i < text.length; i++) {
			vec[i % dim] += text.charCodeAt(i);
		}
		const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
		return vec.map((v) => v / mag);
	}

	return {
		EmbeddingService: class {
			async getEmbedding(text: string) {
				return hashEmbedding(text);
			}
			resetAvailability() {}
		},
		fallbackEmbedding: hashEmbedding,
	};
});

// ─── Mock session-store and streams to avoid filesystem side-effects ──────────

vi.mock("../src/session-store.js", () => ({
	listSessions: () => [],
	loadSession: () => ({ meta: { id: "x", title: "", tags: [] }, turns: [] }),
}));

vi.mock("../src/streams.js", () => ({
	StreamManager: class {
		listFlowDevices() { return []; }
		readContent() { return null; }
	},
	STREAM_ORDER: [],
	STREAM_CONFIGS: {},
	PRESERVATION_RATIOS: {},
	estimateTokens: () => 0,
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { RecallEngine, migrateEmbeddingsJson } from "../src/recall.js";
import type { Session } from "../src/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(id: string, title: string, content: string): Session {
	return {
		meta: {
			id,
			title,
			created: "2026-01-15T00:00:00Z",
			updated: "2026-01-15T01:00:00Z",
			agent: "chitragupta",
			model: "claude-3",
			project: "/test",
			parent: null,
			branch: null,
			tags: ["test"],
			totalCost: 0,
			totalTokens: 0,
		},
		turns: [
			{ turnNumber: 1, role: "user", content },
			{ turnNumber: 2, role: "assistant", content: `Response to: ${content}` },
		],
	};
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("recall-sqlite", () => {
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-sqlite-test-"));
		DatabaseManager.reset();
		_resetRecallDbInit();
	});

	afterEach(() => {
		DatabaseManager.reset();
		_resetRecallDbInit();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// ═══════════════════════════════════════════════════════════════════
	// 1. Vector Serialization Roundtrip
	// ═══════════════════════════════════════════════════════════════════

	describe("vectorToBlob / blobToVector roundtrip", () => {
		it("should preserve an empty vector", () => {
			const original: number[] = [];
			const blob = vectorToBlob(original);
			const restored = blobToVector(blob);
			expect(restored).toEqual(original);
		});

		it("should preserve a single-element vector", () => {
			const original = [3.14159];
			const blob = vectorToBlob(original);
			const restored = blobToVector(blob);
			expect(restored.length).toBe(1);
			expect(restored[0]).toBeCloseTo(3.14159, 4); // Float32 precision
		});

		it("should preserve a 384-dim vector with precision", () => {
			const original = Array.from({ length: 384 }, (_, i) => Math.sin(i) * 0.1);
			const blob = vectorToBlob(original);
			const restored = blobToVector(blob);

			expect(restored.length).toBe(384);
			for (let i = 0; i < 384; i++) {
				// Float32 has ~7 digits of precision
				expect(restored[i]).toBeCloseTo(original[i], 5);
			}
		});

		it("should produce a Buffer of correct byte length", () => {
			const vec = [1.0, 2.0, 3.0, 4.0];
			const blob = vectorToBlob(vec);
			// 4 floats * 4 bytes each = 16 bytes
			expect(blob.byteLength).toBe(16);
		});

		it("should handle negative values, zeros, and very small numbers", () => {
			const original = [0, -1.5, 1e-10, -1e-10, 999.999];
			const blob = vectorToBlob(original);
			const restored = blobToVector(blob);
			expect(restored.length).toBe(5);
			expect(restored[0]).toBe(0);
			expect(restored[1]).toBeCloseTo(-1.5, 5);
			expect(restored[4]).toBeCloseTo(999.999, 2); // Float32 loses some precision at large values
		});

		it("should roundtrip through SQLite BLOB column", () => {
			const dbm = DatabaseManager.instance(tmpDir);
			initVectorsSchema(dbm);
			const db = dbm.get("vectors");

			const original = [0.1, 0.2, 0.3, 0.4, 0.5];
			const blob = vectorToBlob(original);

			db.prepare(`
				INSERT INTO embeddings (id, vector, text, source_type, source_id, dimensions, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run("test-roundtrip", blob, "test", "session", "s-1", 5, Date.now());

			const row = db.prepare("SELECT vector FROM embeddings WHERE id = ?").get("test-roundtrip") as { vector: Buffer };
			const restored = blobToVector(row.vector);

			expect(restored.length).toBe(5);
			for (let i = 0; i < 5; i++) {
				expect(restored[i]).toBeCloseTo(original[i], 5);
			}
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// 2. SQLite Persistence
	// ═══════════════════════════════════════════════════════════════════

	describe("RecallEngine SQLite persistence", () => {
		it("should start with an empty index on fresh database", () => {
			// DatabaseManager will use tmpDir via getChitraguptaHome mock
			const engine = new RecallEngine();
			expect(engine.getIndexSize()).toBe(0);
		});

		it("should persist entries to SQLite after indexSession", async () => {
			const engine = new RecallEngine();
			const session = makeSession("s-persist-1", "Persistence Test", "Testing SQLite persistence layer");

			await engine.indexSession(session);
			expect(engine.getIndexSize()).toBeGreaterThan(0);

			// Verify data is in SQLite
			const dbm = DatabaseManager.instance();
			const db = dbm.get("vectors");
			const count = (db.prepare("SELECT COUNT(*) as c FROM embeddings").get() as { c: number }).c;
			expect(count).toBeGreaterThan(0);
		});

		it("should survive engine reload — entries persist across instances", async () => {
			// First engine: index a session
			const engine1 = new RecallEngine();
			const session = makeSession("s-reload-1", "Reload Test", "This should survive reload");
			await engine1.indexSession(session);
			const size1 = engine1.getIndexSize();
			expect(size1).toBeGreaterThan(0);

			// Reset the init flag so a new engine re-reads from SQLite
			_resetRecallDbInit();

			// Second engine: should load the same entries from SQLite
			const engine2 = new RecallEngine();
			expect(engine2.getIndexSize()).toBe(size1);
		});

		it("should store and retrieve metadata correctly", async () => {
			const engine = new RecallEngine();
			const session = makeSession("s-meta-1", "Metadata Check", "Checking metadata fields");
			await engine.indexSession(session);

			const dbm = DatabaseManager.instance();
			const db = dbm.get("vectors");
			const row = db.prepare("SELECT * FROM embeddings WHERE source_id = ?").get("s-meta-1") as any;

			expect(row).toBeDefined();
			expect(row.source_type).toBe("session");
			expect(row.source_id).toBe("s-meta-1");
			expect(row.text.length).toBeGreaterThan(0);
			expect(row.dimensions).toBeGreaterThan(0);

			const metadata = JSON.parse(row.metadata);
			expect(metadata.title).toBe("Metadata Check");
			expect(metadata.tags).toContain("test");
			expect(metadata.date).toBe("2026-01-15T01:00:00Z");
		});

		it("should replace entries on re-index of same session", async () => {
			const engine = new RecallEngine();

			const session1 = makeSession("s-replace-1", "Version 1", "Original content");
			await engine.indexSession(session1);

			const session2 = makeSession("s-replace-1", "Version 2", "Updated content");
			await engine.indexSession(session2);

			// Should still have only one entry for this session
			const dbm = DatabaseManager.instance();
			const db = dbm.get("vectors");
			const rows = db.prepare("SELECT * FROM embeddings WHERE source_id = ?").all("s-replace-1") as any[];
			expect(rows.length).toBe(1);

			const metadata = JSON.parse(rows[0].metadata);
			expect(metadata.title).toBe("Version 2");
		});

		it("should persist stream entries to SQLite", async () => {
			const engine = new RecallEngine();
			await engine.indexStream("identity", "User prefers dark mode and TypeScript.");

			const dbm = DatabaseManager.instance();
			const db = dbm.get("vectors");
			const row = db.prepare("SELECT * FROM embeddings WHERE source_type = 'stream'").get() as any;

			expect(row).toBeDefined();
			expect(row.source_id).toBe("stream-identity");
			expect(row.text).toContain("dark mode");
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// 3. Search After SQLite Persistence
	// ═══════════════════════════════════════════════════════════════════

	describe("search works with SQLite backend", () => {
		it("should find indexed session via recall", async () => {
			const engine = new RecallEngine();
			const session = makeSession("s-search-1", "Database Migration", "We decided to use PostgreSQL for the new service");
			await engine.indexSession(session);

			const results = await engine.recall("PostgreSQL database", { threshold: 0 });
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].sessionId).toBe("s-search-1");
			expect(results[0].source).toBe("session");
		});

		it("should find indexed session after reload", async () => {
			// Index in first engine
			const engine1 = new RecallEngine();
			const session = makeSession("s-search-reload", "API Design", "RESTful API with versioned endpoints");
			await engine1.indexSession(session);

			// Reload
			_resetRecallDbInit();
			const engine2 = new RecallEngine();

			const results = await engine2.recall("REST API endpoints", { threshold: 0 });
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].sessionId).toBe("s-search-reload");
		});

		it("should return empty results when nothing matches", async () => {
			const engine = new RecallEngine();
			const results = await engine.recall("quantum computing entanglement");
			expect(results).toHaveLength(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// 4. Migration from JSON to SQLite
	// ═══════════════════════════════════════════════════════════════════

	describe("migrateEmbeddingsJson", () => {
		it("should return zeros when JSON file does not exist", () => {
			const result = migrateEmbeddingsJson();
			expect(result.migrated).toBe(0);
			expect(result.skipped).toBe(0);
		});

		it("should migrate entries from JSON to SQLite", () => {
			// Create a legacy JSON file
			const indexDir = path.join(tmpDir, "smriti", "index");
			fs.mkdirSync(indexDir, { recursive: true });

			const entries = [
				{
					id: "legacy-1",
					vector: [0.1, 0.2, 0.3],
					source: "session",
					sourceId: "s-legacy-1",
					title: "Legacy Session",
					text: "Legacy session content",
					summary: "Legacy summary",
					tags: ["legacy"],
					date: "2025-12-01T00:00:00Z",
				},
				{
					id: "legacy-2",
					vector: [0.4, 0.5, 0.6],
					source: "stream",
					sourceId: "stream-identity",
					title: "Identity Stream",
					text: "Identity stream content",
					summary: "Identity summary",
					tags: ["identity"],
					date: "2025-12-02T00:00:00Z",
				},
			];

			fs.writeFileSync(
				path.join(indexDir, "embeddings.json"),
				JSON.stringify(entries),
				"utf-8",
			);

			// Initialize DatabaseManager for this tmpDir
			DatabaseManager.instance(tmpDir);

			const result = migrateEmbeddingsJson();
			expect(result.migrated).toBe(2);
			expect(result.skipped).toBe(0);

			// Verify entries are in SQLite
			const dbm = DatabaseManager.instance();
			const db = dbm.get("vectors");
			const rows = db.prepare("SELECT * FROM embeddings ORDER BY id").all() as any[];
			expect(rows.length).toBe(2);
			expect(rows[0].id).toBe("legacy-1");
			expect(rows[0].source_type).toBe("session");
			expect(rows[1].id).toBe("legacy-2");
			expect(rows[1].source_type).toBe("stream");

			// Verify vectors roundtrip
			const vec1 = blobToVector(rows[0].vector);
			expect(vec1[0]).toBeCloseTo(0.1, 5);
			expect(vec1[1]).toBeCloseTo(0.2, 5);
			expect(vec1[2]).toBeCloseTo(0.3, 5);

			// Verify JSON file was renamed to .bak
			expect(fs.existsSync(path.join(indexDir, "embeddings.json"))).toBe(false);
			expect(fs.existsSync(path.join(indexDir, "embeddings.json.bak"))).toBe(true);
		});

		it("should skip entries that already exist in SQLite (idempotent)", () => {
			const indexDir = path.join(tmpDir, "smriti", "index");
			fs.mkdirSync(indexDir, { recursive: true });

			const entries = [
				{
					id: "dup-1",
					vector: [1.0, 2.0],
					source: "session",
					sourceId: "s-dup-1",
					title: "Dup",
					text: "Duplicate test",
					summary: "Summary",
					tags: [],
					date: "2025-12-01T00:00:00Z",
				},
			];

			// Pre-insert into SQLite
			const dbm = DatabaseManager.instance(tmpDir);
			initVectorsSchema(dbm);
			const db = dbm.get("vectors");
			db.prepare(`
				INSERT INTO embeddings (id, vector, text, source_type, source_id, dimensions, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run("dup-1", vectorToBlob([1.0, 2.0]), "Duplicate test", "session", "s-dup-1", 2, Date.now());

			// Write JSON file
			fs.writeFileSync(
				path.join(indexDir, "embeddings.json"),
				JSON.stringify(entries),
				"utf-8",
			);

			const result = migrateEmbeddingsJson();
			expect(result.migrated).toBe(0);
			expect(result.skipped).toBe(1);
		});

		it("should handle malformed JSON gracefully", () => {
			const indexDir = path.join(tmpDir, "smriti", "index");
			fs.mkdirSync(indexDir, { recursive: true });

			fs.writeFileSync(
				path.join(indexDir, "embeddings.json"),
				"NOT VALID JSON{{{",
				"utf-8",
			);

			const result = migrateEmbeddingsJson();
			expect(result.migrated).toBe(0);
			expect(result.skipped).toBe(0);
		});

		it("should allow RecallEngine to load migrated entries", () => {
			// Create a legacy JSON file
			const indexDir = path.join(tmpDir, "smriti", "index");
			fs.mkdirSync(indexDir, { recursive: true });

			const entries = [
				{
					id: "mig-load-1",
					vector: Array.from({ length: 384 }, (_, i) => Math.sin(i) * 0.01),
					source: "session",
					sourceId: "s-mig-load-1",
					title: "Migrated Session",
					text: "Content from the migrated session",
					summary: "Migrated summary",
					tags: ["migrated"],
					date: "2025-11-15T00:00:00Z",
				},
			];

			fs.writeFileSync(
				path.join(indexDir, "embeddings.json"),
				JSON.stringify(entries),
				"utf-8",
			);

			// Initialize DB and run migration
			DatabaseManager.instance(tmpDir);
			const result = migrateEmbeddingsJson();
			expect(result.migrated).toBe(1);

			// Now create a RecallEngine — it should load from SQLite
			_resetRecallDbInit();
			const engine = new RecallEngine();
			expect(engine.getIndexSize()).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// 5. Edge Cases
	// ═══════════════════════════════════════════════════════════════════

	describe("edge cases", () => {
		it("should handle getIndexSize correctly as entries are added/removed", async () => {
			const engine = new RecallEngine();
			expect(engine.getIndexSize()).toBe(0);

			await engine.indexSession(makeSession("s-ec-1", "EC1", "Edge case 1"));
			expect(engine.getIndexSize()).toBe(1);

			await engine.indexSession(makeSession("s-ec-2", "EC2", "Edge case 2"));
			expect(engine.getIndexSize()).toBe(2);

			// Re-indexing same session should not increase count
			await engine.indexSession(makeSession("s-ec-1", "EC1 Updated", "Updated edge case 1"));
			expect(engine.getIndexSize()).toBe(2);
		});

		it("should not persist stream with empty content", async () => {
			const engine = new RecallEngine();
			await engine.indexStream("flow", "   ");
			expect(engine.getIndexSize()).toBe(0);
		});

		it("should handle multiple concurrent session indexes", async () => {
			const engine = new RecallEngine();

			// Index 5 sessions sequentially
			for (let i = 0; i < 5; i++) {
				await engine.indexSession(
					makeSession(`s-multi-${i}`, `Session ${i}`, `Content for session ${i}`),
				);
			}

			expect(engine.getIndexSize()).toBe(5);

			// Verify SQLite has all 5
			const dbm = DatabaseManager.instance();
			const db = dbm.get("vectors");
			const count = (db.prepare("SELECT COUNT(*) as c FROM embeddings").get() as { c: number }).c;
			expect(count).toBe(5);
		});
	});
});
