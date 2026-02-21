/**
 * Performance benchmarks for Chitragupta storage tier.
 *
 * Targets from PERFORMANCE_SPEC.md:
 *   - FTS5 search:        <10ms  (30K turns)
 *   - k-NN vector search: <5ms   (1K vectors, brute-force)
 *   - Graph neighbor:     <1ms   (node with 100 edges)
 *   - Session list:       <10ms  (1K sessions)
 *   - addTurn write:      <5ms
 *   - loadSession cached: <1ms   (L1 hit)
 *
 * Uses real SQLite databases in temp directories (no mocking).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { performance } from "perf_hooks";
import { DatabaseManager } from "@chitragupta/smriti/db/database";
import { initAgentSchema, initGraphSchema, initVectorsSchema } from "@chitragupta/smriti/db/schema";

let tmpDir: string;

vi.mock("@chitragupta/core", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getChitraguptaHome: () => tmpDir,
	};
});

// Mock memory-store (not benchmarked here)
vi.mock("../src/memory-store.js", () => ({
	getMemory: () => "",
	listMemoryScopes: () => [],
}));

// Mock session-store for search tests (search uses its own DB path)
vi.mock("../src/session-store.js", () => ({
	listSessions: () => [],
	loadSession: () => ({ meta: {}, turns: [] }),
}));

import { searchSessions, _resetSearchDbInit } from "@chitragupta/smriti/search";

// ─── Helpers ────────────────────────────────────────────────────────────────

function insertSession(
	db: ReturnType<DatabaseManager["get"]>,
	opts: { id: string; project: string; title?: string; createdAt?: number },
): void {
	const now = Date.now();
	db.prepare(
		`INSERT INTO sessions (id, project, title, created_at, updated_at, file_path, agent, model, cost, tokens, tags, parent_id, branch)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		opts.id,
		opts.project,
		opts.title ?? "Bench Session",
		opts.createdAt ?? now,
		opts.createdAt ?? now,
		`sessions/bench/${opts.id}.md`,
		"bench",
		"bench-model",
		0,
		0,
		"[]",
		null,
		null,
	);
}

function insertTurnWithFts(
	db: ReturnType<DatabaseManager["get"]>,
	opts: { sessionId: string; turnNumber: number; role: string; content: string; createdAt?: number },
): void {
	const now = Date.now();
	const result = db.prepare(
		`INSERT INTO turns (session_id, turn_number, role, content, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
	).run(opts.sessionId, opts.turnNumber, opts.role, opts.content, opts.createdAt ?? now);
	const turnId = Number(result.lastInsertRowid);
	db.prepare("INSERT INTO turns_fts (rowid, content) VALUES (?, ?)").run(turnId, opts.content);
}

function insertGraphNode(
	db: ReturnType<DatabaseManager["get"]>,
	opts: { id: string; label: string; type?: string },
): void {
	const now = Date.now();
	db.prepare(
		"INSERT OR IGNORE INTO nodes (id, label, type, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
	).run(opts.id, opts.label, opts.type ?? "entity", "{}", now, now);
}

function insertGraphEdge(
	db: ReturnType<DatabaseManager["get"]>,
	opts: { source: string; target: string; relationship?: string; weight?: number },
): void {
	db.prepare(
		"INSERT INTO edges (source, target, relationship, weight, recorded_at) VALUES (?, ?, ?, ?, ?)",
	).run(opts.source, opts.target, opts.relationship ?? "relates_to", opts.weight ?? 1.0, Date.now());
}

function insertVector(
	db: ReturnType<DatabaseManager["get"]>,
	opts: { id: string; text: string; dims?: number },
): void {
	const dims = opts.dims ?? 128;
	const vec = new Float32Array(dims);
	for (let i = 0; i < dims; i++) vec[i] = Math.random() * 2 - 1;
	const buf = Buffer.from(vec.buffer);
	db.prepare(
		"INSERT OR IGNORE INTO embeddings (id, vector, text, source_type, source_id, dimensions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
	).run(opts.id, buf, opts.text, "turn", opts.id, dims, Date.now());
}

/** Measure median of N runs. */
function benchmarkN(fn: () => void, n = 10): { median: number; p95: number; min: number } {
	const times: number[] = [];
	// Warm up (2 runs)
	fn();
	fn();
	for (let i = 0; i < n; i++) {
		const start = performance.now();
		fn();
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return {
		median: times[Math.floor(n / 2)],
		p95: times[Math.floor(n * 0.95)],
		min: times[0],
	};
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chi-bench-"));
	DatabaseManager.reset();
	_resetSearchDbInit();
});

afterEach(() => {
	DatabaseManager.reset();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// FTS5 Search Benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe("Benchmark: FTS5 Search", () => {
	it("should search 1K turns in <10ms (median)", () => {
		const dbm = DatabaseManager.instance();
		initAgentSchema(dbm);
		const db = dbm.get("agent");

		// Seed 50 sessions × 20 turns = 1,000 turns
		const words = ["typescript", "function", "variable", "async", "promise", "error", "database", "query", "index", "cache"];
		for (let s = 0; s < 50; s++) {
			const sid = `bench-session-${s}`;
			insertSession(db, { id: sid, project: "/bench" });
			for (let t = 0; t < 20; t++) {
				const w1 = words[Math.floor(Math.random() * words.length)];
				const w2 = words[Math.floor(Math.random() * words.length)];
				insertTurnWithFts(db, {
					sessionId: sid,
					turnNumber: t + 1,
					role: t % 2 === 0 ? "user" : "assistant",
					content: `Discussing ${w1} and ${w2} patterns for session ${s} turn ${t}`,
				});
			}
		}

		const result = benchmarkN(() => {
			searchSessions("typescript error");
		}, 20);

		expect(result.median).toBeLessThan(10);
	});

	it("should search 5K turns in <10ms (median)", () => {
		const dbm = DatabaseManager.instance();
		initAgentSchema(dbm);
		const db = dbm.get("agent");

		const words = ["refactor", "deploy", "migration", "schema", "endpoint", "middleware", "hooks", "state", "reducer", "selector"];
		for (let s = 0; s < 100; s++) {
			const sid = `bench-5k-${s}`;
			insertSession(db, { id: sid, project: "/bench" });
			for (let t = 0; t < 50; t++) {
				const w1 = words[Math.floor(Math.random() * words.length)];
				const w2 = words[Math.floor(Math.random() * words.length)];
				insertTurnWithFts(db, {
					sessionId: sid,
					turnNumber: t + 1,
					role: t % 2 === 0 ? "user" : "assistant",
					content: `Working on ${w1} with ${w2} for module ${s} step ${t}`,
				});
			}
		}

		const result = benchmarkN(() => {
			searchSessions("schema migration");
		}, 20);

		expect(result.median).toBeLessThan(10);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Session List Benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe("Benchmark: Session Listing", () => {
	it("should list 1K sessions in <10ms (median)", () => {
		const dbm = DatabaseManager.instance();
		initAgentSchema(dbm);
		const db = dbm.get("agent");

		const insertBatch = db.prepare(
			`INSERT INTO sessions (id, project, title, created_at, updated_at, file_path, agent, model, cost, tokens, tags, parent_id, branch)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const txn = db.transaction(() => {
			for (let i = 0; i < 1000; i++) {
				const now = Date.now() - i * 60000;
				insertBatch.run(
					`list-bench-${i}`, "/bench", `Session ${i}`, now, now,
					`sessions/bench/list-bench-${i}.md`, "bench", "model", 0, 0, "[]", null, null,
				);
			}
		});
		txn();

		const result = benchmarkN(() => {
			db.prepare("SELECT * FROM sessions WHERE project = ? ORDER BY updated_at DESC").all("/bench");
		}, 20);

		expect(result.median).toBeLessThan(10);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Graph Neighbor Benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe("Benchmark: Graph Neighbors", () => {
	it("should look up neighbors of a node with 100 edges in <1ms (median)", () => {
		const dbm = DatabaseManager.instance();
		initGraphSchema(dbm);
		const db = dbm.get("graph");

		// Create hub node with 100 outgoing edges
		insertGraphNode(db, { id: "hub", label: "Hub Node" });
		const insertEdgeBatch = db.transaction(() => {
			for (let i = 0; i < 100; i++) {
				const targetId = `target-${i}`;
				insertGraphNode(db, { id: targetId, label: `Target ${i}` });
				insertGraphEdge(db, { source: "hub", target: targetId });
			}
		});
		insertEdgeBatch();

		const result = benchmarkN(() => {
			db.prepare("SELECT * FROM edges WHERE source = ?").all("hub");
		}, 50);

		expect(result.median).toBeLessThan(1);
	});

	it("should look up a node by ID in <0.5ms (median)", () => {
		const dbm = DatabaseManager.instance();
		initGraphSchema(dbm);
		const db = dbm.get("graph");

		for (let i = 0; i < 500; i++) {
			insertGraphNode(db, { id: `node-${i}`, label: `Node ${i}` });
		}

		const result = benchmarkN(() => {
			db.prepare("SELECT * FROM nodes WHERE id = ?").get("node-250");
		}, 50);

		expect(result.median).toBeLessThan(0.5);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Vector Search Benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe("Benchmark: Vector Operations", () => {
	it("should serialize/deserialize 128-dim vector in <0.1ms", () => {
		const dims = 128;
		const vec = new Float32Array(dims);
		for (let i = 0; i < dims; i++) vec[i] = Math.random();

		const result = benchmarkN(() => {
			// Serialize
			const buf = Buffer.from(vec.buffer);
			// Deserialize
			const restored = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
			// Cosine similarity with self (sanity)
			let dot = 0;
			for (let i = 0; i < dims; i++) dot += restored[i] * vec[i];
		}, 100);

		expect(result.median).toBeLessThan(0.1);
	});

	it("should brute-force k-NN over 1K vectors in <5ms", () => {
		const dims = 128;
		const k = 10;
		const vectors: Float32Array[] = [];
		for (let i = 0; i < 1000; i++) {
			const v = new Float32Array(dims);
			for (let d = 0; d < dims; d++) v[d] = Math.random() * 2 - 1;
			vectors.push(v);
		}
		const query = new Float32Array(dims);
		for (let d = 0; d < dims; d++) query[d] = Math.random() * 2 - 1;

		const result = benchmarkN(() => {
			// Brute-force cosine similarity
			const scores: Array<{ idx: number; score: number }> = [];
			for (let i = 0; i < vectors.length; i++) {
				let dot = 0, normA = 0, normB = 0;
				for (let d = 0; d < dims; d++) {
					dot += query[d] * vectors[i][d];
					normA += query[d] * query[d];
					normB += vectors[i][d] * vectors[i][d];
				}
				const denom = Math.sqrt(normA) * Math.sqrt(normB);
				scores.push({ idx: i, score: denom > 0 ? dot / denom : 0 });
			}
			scores.sort((a, b) => b.score - a.score);
			scores.slice(0, k);
		}, 20);

		expect(result.median).toBeLessThan(5);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Write Path Benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe("Benchmark: Write Path", () => {
	it("should insert a turn + FTS5 index in <5ms (median)", () => {
		const dbm = DatabaseManager.instance();
		initAgentSchema(dbm);
		const db = dbm.get("agent");

		insertSession(db, { id: "write-bench", project: "/bench" });

		let turnNum = 0;
		const result = benchmarkN(() => {
			turnNum++;
			const res = db.prepare(
				"INSERT INTO turns (session_id, turn_number, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
			).run("write-bench", turnNum, "user", `Turn ${turnNum} content about testing performance`, Date.now());
			db.prepare("INSERT INTO turns_fts (rowid, content) VALUES (?, ?)").run(
				Number(res.lastInsertRowid),
				`Turn ${turnNum} content about testing performance`,
			);
			db.prepare("UPDATE sessions SET turn_count = turn_count + 1, updated_at = ? WHERE id = ?").run(
				Date.now(),
				"write-bench",
			);
		}, 50);

		expect(result.median).toBeLessThan(5);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Concurrent Read/Write Benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe("Benchmark: Concurrent Access", () => {
	it("should handle interleaved reads and writes without exceeding 50ms for reads", () => {
		const dbm = DatabaseManager.instance();
		initAgentSchema(dbm);
		const db = dbm.get("agent");

		// Seed data
		for (let s = 0; s < 20; s++) {
			const sid = `concurrent-${s}`;
			insertSession(db, { id: sid, project: "/bench" });
			for (let t = 0; t < 10; t++) {
				insertTurnWithFts(db, {
					sessionId: sid,
					turnNumber: t + 1,
					role: "user",
					content: `Concurrent test content for session ${s} turn ${t}`,
				});
			}
		}

		// Interleave: write, then read, measure read latency
		const readTimes: number[] = [];
		for (let i = 0; i < 20; i++) {
			// Write
			const res = db.prepare(
				"INSERT INTO turns (session_id, turn_number, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
			).run("concurrent-0", 100 + i, "assistant", `Write during benchmark ${i}`, Date.now());
			db.prepare("INSERT INTO turns_fts (rowid, content) VALUES (?, ?)").run(
				Number(res.lastInsertRowid),
				`Write during benchmark ${i}`,
			);

			// Read (search)
			const start = performance.now();
			searchSessions("concurrent test content");
			readTimes.push(performance.now() - start);
		}

		readTimes.sort((a, b) => a - b);
		const p95 = readTimes[Math.floor(readTimes.length * 0.95)];
		expect(p95).toBeLessThan(50);
	});
});
