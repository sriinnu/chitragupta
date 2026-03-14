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

			it("should create akasha_traces table", () => {
				const db = dbm.get("agent");
				const info = db.prepare("PRAGMA table_info(akasha_traces)").all() as Array<{ name: string }>;
				const cols = info.map((r) => r.name);
				expect(cols).toContain("id");
				expect(cols).toContain("agent_id");
				expect(cols).toContain("trace_type");
				expect(cols).toContain("topic");
				expect(cols).toContain("strength");
			});

			it("should create C8 observation/pattern/prediction/heal tables", () => {
				const db = dbm.get("agent");
				const tables = [
					"tool_usage",
					"error_resolutions",
					"edit_patterns",
					"user_corrections",
					"preferences",
					"detected_patterns",
					"markov_transitions",
					"heal_outcomes",
				];

				for (const table of tables) {
					const row = db.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
					).get(table) as { name?: string } | undefined;
					expect(row?.name).toBe(table);
				}
			});

			it("should create agent_task_checkpoints table", () => {
				const db = dbm.get("agent");
				const info = db.prepare("PRAGMA table_info(agent_task_checkpoints)").all() as Array<{ name: string }>;
				const cols = info.map((r) => r.name);
				expect(cols).toContain("project");
				expect(cols).toContain("task_key");
				expect(cols).toContain("status");
				expect(cols).toContain("phase");
				expect(cols).toContain("checkpoint_json");
			});

				it("should create research_experiments table", () => {
					const db = dbm.get("agent");
				const row = db.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name = 'research_experiments'",
				).get() as { name?: string } | undefined;
				expect(row?.name).toBe("research_experiments");
				const info = db.prepare("PRAGMA table_info(research_experiments)").all() as Array<{ name: string }>;
				const cols = info.map((entry) => entry.name);
					expect(cols).toContain("experiment_key");
					expect(cols).toContain("budget_ms");
					expect(cols).toContain("sabha_id");
					expect(cols).toContain("git_branch");
					expect(cols).toContain("git_head_commit");
					expect(cols).toContain("git_dirty_before");
					expect(cols).toContain("git_dirty_after");
				});

				it("should create research_loop_summaries table", () => {
					const db = dbm.get("agent");
					const row = db.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND name = 'research_loop_summaries'",
					).get() as { name?: string } | undefined;
					expect(row?.name).toBe("research_loop_summaries");
					const info = db.prepare("PRAGMA table_info(research_loop_summaries)").all() as Array<{ name: string }>;
					const cols = info.map((entry) => entry.name);
					expect(cols).toContain("loop_key");
					expect(cols).toContain("session_lineage_key");
					expect(cols).toContain("rounds_requested");
					expect(cols).toContain("rounds_completed");
					expect(cols).toContain("summary_json");
				});

					it("should create research_loop_checkpoints table", () => {
						const db = dbm.get("agent");
						const row = db.prepare(
						"SELECT name FROM sqlite_master WHERE type='table' AND name = 'research_loop_checkpoints'",
					).get() as { name?: string } | undefined;
					expect(row?.name).toBe("research_loop_checkpoints");
					const info = db.prepare("PRAGMA table_info(research_loop_checkpoints)").all() as Array<{ name: string }>;
					const cols = info.map((entry) => entry.name);
					expect(cols).toContain("loop_key");
					expect(cols).toContain("phase");
						expect(cols).toContain("status");
						expect(cols).toContain("checkpoint_json");
					});

					it("should create research_refinement_queue table", () => {
						const db = dbm.get("agent");
						const row = db.prepare(
							"SELECT name FROM sqlite_master WHERE type='table' AND name = 'research_refinement_queue'",
						).get() as { name?: string } | undefined;
						expect(row?.name).toBe("research_refinement_queue");
						const info = db.prepare("PRAGMA table_info(research_refinement_queue)").all() as Array<{ name: string }>;
						const cols = info.map((entry) => entry.name);
						expect(cols).toContain("scope_key");
						expect(cols).toContain("label");
						expect(cols).toContain("project");
						expect(cols).toContain("scope_json");
						expect(cols).toContain("attempt_count");
						expect(cols).toContain("next_attempt_at");
					});

						it("should create remote semantic sync embedding epoch column", () => {
							const db = dbm.get("agent");
						const info = db.prepare("PRAGMA table_info(remote_semantic_sync)").all() as Array<{ name: string }>;
					const cols = info.map((entry) => entry.name);
					expect(cols).toContain("embedding_epoch");
					expect(cols).toContain("quality_hash");
				});

			it("should create sabha_state durability table", () => {
				const db = dbm.get("agent");
				const info = db.prepare("PRAGMA table_info(sabha_state)").all() as Array<{ name: string }>;
				const cols = info.map((row) => row.name);
				expect(cols).toContain("id");
				expect(cols).toContain("revision");
				expect(cols).toContain("sabha_json");
				expect(cols).toContain("client_bindings_json");
				expect(cols).toContain("perspectives_json");
			});

				it("should create sabha_event_log durability table", () => {
					const db = dbm.get("agent");
					const info = db.prepare("PRAGMA table_info(sabha_event_log)").all() as Array<{ name: string }>;
					const cols = info.map((row) => row.name);
					expect(cols).toContain("sabha_id");
				expect(cols).toContain("event_id");
				expect(cols).toContain("revision");
				expect(cols).toContain("parent_revision");
				expect(cols).toContain("event_type");
					expect(cols).toContain("event_json");
					expect(cols).toContain("created_at");
				});

			it("should create semantic_runtime_state table", () => {
				const db = dbm.get("agent");
					const info = db.prepare("PRAGMA table_info(semantic_runtime_state)").all() as Array<{ name: string }>;
					const cols = info.map((row) => row.name);
					expect(cols).toContain("name");
					expect(cols).toContain("value_json");
				expect(cols).toContain("updated_at");
			});

			it("should add semantic runtime state for legacy schema 23 databases", () => {
				const db = dbm.get("agent");
				db.exec("CREATE TABLE IF NOT EXISTS _schema_versions (name TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0)");
				db.prepare(
					"INSERT INTO _schema_versions (name, version) VALUES ('agent', 23) ON CONFLICT(name) DO UPDATE SET version = excluded.version",
				).run();
				db.exec("DROP TABLE IF EXISTS semantic_runtime_state");

				initAgentSchema(dbm);

				const row = db.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' AND name = 'semantic_runtime_state'",
				).get() as { name?: string } | undefined;
				expect(row?.name).toBe("semantic_runtime_state");
				const version = db.prepare("SELECT version FROM _schema_versions WHERE name = 'agent'").get() as { version: number };
		expect(version.version).toBe(29);
			});

			it("should add nidra notification counter column", () => {
				const db = dbm.get("agent");
				const info = db.prepare("PRAGMA table_info(nidra_state)").all() as Array<{ name: string }>;
				const cols = info.map((row) => row.name);
				expect(cols).toContain("session_notifications_since_deep_sleep");
				expect(cols).toContain("preserve_pending_sessions_on_listening");
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
			expect(row.version).toBe(29);
				});

				it("should skip re-initialization when version matches", () => {
					initAgentSchema(dbm);
					// Second call should be a no-op
					initAgentSchema(dbm);
					const db = dbm.get("agent");
					const row = db.prepare("SELECT version FROM _schema_versions WHERE name = 'agent'").get() as { version: number };
			expect(row.version).toBe(29);
				});

			it("should add remote semantic embedding epochs for legacy databases", () => {
				const db = dbm.get("agent");
				db.exec(`
					CREATE TABLE _schema_versions (
						name    TEXT PRIMARY KEY,
						version INTEGER NOT NULL DEFAULT 0
					);

					CREATE TABLE remote_semantic_sync (
						target         TEXT NOT NULL,
						artifact_id    TEXT NOT NULL,
						level          TEXT NOT NULL,
						period         TEXT NOT NULL,
						project        TEXT,
						content_hash   TEXT NOT NULL,
						quality_hash   TEXT,
						remote_id      TEXT,
						last_synced_at INTEGER,
						last_error     TEXT,
						updated_at     INTEGER NOT NULL,
						PRIMARY KEY (target, artifact_id)
					);
				`);
				db.prepare(
					"INSERT INTO _schema_versions (name, version) VALUES ('agent', 20) ON CONFLICT(name) DO UPDATE SET version = excluded.version",
				).run();

				initAgentSchema(dbm);

					const info = db.prepare("PRAGMA table_info(remote_semantic_sync)").all() as Array<{ name: string }>;
					const cols = info.map((entry) => entry.name);
					expect(cols).toContain("embedding_epoch");
					expect(cols).toContain("quality_hash");
				});

			it("should rebuild consolidation_log with swapna constraint for legacy databases", () => {
				const db = dbm.get("agent");
				db.exec(`
					CREATE TABLE _schema_versions (
						name    TEXT PRIMARY KEY,
						version INTEGER NOT NULL DEFAULT 0
					);

					CREATE TABLE consolidation_log (
						id          INTEGER PRIMARY KEY AUTOINCREMENT,
						project     TEXT NOT NULL,
						cycle_type  TEXT NOT NULL CHECK(cycle_type IN ('svapna', 'monthly', 'yearly')),
						cycle_id    TEXT,
						phase       TEXT,
						phase_duration_ms INTEGER,
						vasanas_created INTEGER DEFAULT 0,
						vidhis_created INTEGER DEFAULT 0,
						samskaras_processed INTEGER DEFAULT 0,
						sessions_processed INTEGER DEFAULT 0,
						status      TEXT NOT NULL DEFAULT 'running'
							CHECK(status IN ('running', 'success', 'failed', 'partial')),
						error_message TEXT,
						created_at  INTEGER NOT NULL
					);

					INSERT INTO consolidation_log (project, cycle_type, cycle_id, status, created_at)
					VALUES ('demo', 'svapna', 'svapna-legacy', 'success', 123456);
				`);
				db.prepare(
					"INSERT INTO _schema_versions (name, version) VALUES ('agent', 15) ON CONFLICT(name) DO UPDATE SET version = excluded.version",
				).run();

				initAgentSchema(dbm);

				const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'consolidation_log'").get() as { sql: string };
				expect(sql.sql).toContain("'swapna'");
				expect(sql.sql).not.toContain("'svapna'");

				const migrated = db
					.prepare("SELECT cycle_type, cycle_id FROM consolidation_log WHERE project = ?")
					.get("demo") as { cycle_type: string; cycle_id: string };
				expect(migrated.cycle_type).toBe("swapna");
				expect(migrated.cycle_id).toBe("swapna-legacy");
			});

			it("should backfill research experiment columns from legacy record_json rows", () => {
				const db = dbm.get("agent");
				db.exec(`
					CREATE TABLE _schema_versions (
						name    TEXT PRIMARY KEY,
						version INTEGER NOT NULL DEFAULT 0
					);

						CREATE TABLE research_experiments (
							id                    TEXT PRIMARY KEY,
							project               TEXT NOT NULL,
						session_id            TEXT,
						parent_session_id     TEXT,
						session_lineage_key   TEXT,
						topic                 TEXT NOT NULL,
						metric_name           TEXT NOT NULL,
						objective             TEXT NOT NULL,
						baseline_metric       REAL,
						observed_metric       REAL,
						delta                 REAL,
						decision              TEXT NOT NULL,
						council_verdict       TEXT,
						route_class           TEXT,
						execution_route_class TEXT,
							selected_capability_id TEXT,
							selected_model_id     TEXT,
							selected_provider_id  TEXT,
							packed_context        TEXT,
							packed_runtime        TEXT,
							packed_source         TEXT,
							record_json           TEXT NOT NULL,
							created_at            INTEGER NOT NULL,
							updated_at            INTEGER NOT NULL
						);
				`);
				db.prepare(`
					INSERT INTO research_experiments (
						id, project, session_id, topic, metric_name, objective, decision, record_json, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(
					"exp-legacy-1",
					"/repo/project",
					"sess-1",
					"optimizer sweep",
					"val_bpb",
					"minimize",
					"keep",
					JSON.stringify({
							experimentKey: "exp-key-legacy",
							budgetMs: 300000,
							sabhaId: "sabha-legacy",
							run: {
								gitBranch: "main",
								gitHeadCommit: "abc123abc123abc123abc123abc123abc123abcd",
								gitDirtyBefore: false,
								gitDirtyAfter: true,
							},
						}),
					123456,
					123456,
				);
				db.prepare(
					"INSERT INTO _schema_versions (name, version) VALUES ('agent', 17) ON CONFLICT(name) DO UPDATE SET version = excluded.version",
				).run();

				initAgentSchema(dbm);

				const row = db.prepare(`
						SELECT experiment_key, budget_ms, sabha_id, git_branch, git_head_commit, git_dirty_before, git_dirty_after
						FROM research_experiments
						WHERE id = ?
					`).get("exp-legacy-1") as {
						experiment_key: string | null;
						budget_ms: number | null;
						sabha_id: string | null;
						git_branch: string | null;
						git_head_commit: string | null;
						git_dirty_before: number | null;
						git_dirty_after: number | null;
					};
					expect(row.experiment_key).toBe("exp-key-legacy");
					expect(row.budget_ms).toBe(300000);
					expect(row.sabha_id).toBe("sabha-legacy");
					expect(row.git_branch).toBe("main");
					expect(row.git_head_commit).toBe("abc123abc123abc123abc123abc123abc123abcd");
					expect(row.git_dirty_before).toBe(0);
					expect(row.git_dirty_after).toBe(1);
				});

			it("should normalize legacy git provenance columns while backfilling", () => {
				const db = dbm.get("agent");
				db.exec(`
					CREATE TABLE _schema_versions (
						name    TEXT PRIMARY KEY,
						version INTEGER NOT NULL DEFAULT 0
					);

					CREATE TABLE research_experiments (
						id                    TEXT PRIMARY KEY,
						project               TEXT NOT NULL,
						session_id            TEXT,
						parent_session_id     TEXT,
						session_lineage_key   TEXT,
						topic                 TEXT NOT NULL,
						metric_name           TEXT NOT NULL,
						objective             TEXT NOT NULL,
						baseline_metric       REAL,
						observed_metric       REAL,
						delta                 REAL,
						decision              TEXT NOT NULL,
						council_verdict       TEXT,
						route_class           TEXT,
						execution_route_class TEXT,
						selected_capability_id TEXT,
						selected_model_id     TEXT,
						selected_provider_id  TEXT,
						git_branch            TEXT,
						git_head_commit       TEXT,
						git_dirty_before      INTEGER,
						git_dirty_after       INTEGER,
						packed_context        TEXT,
						packed_runtime        TEXT,
						packed_source         TEXT,
						record_json           TEXT NOT NULL,
						created_at            INTEGER NOT NULL,
						updated_at            INTEGER NOT NULL
					);
				`);
				db.prepare(`
					INSERT INTO research_experiments (
						id, project, session_id, topic, metric_name, objective, decision,
						git_branch, git_head_commit, record_json, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(
					"exp-legacy-2",
					"/repo/project",
					"sess-2",
					"branch normalization",
					"val_bpb",
					"minimize",
					"keep",
					"  main  ",
					"   ",
					JSON.stringify({
						run: {
							gitBranch: "feature/fallback",
							gitHeadCommit: "abcd",
							gitDirtyBefore: true,
							gitDirtyAfter: false,
						},
					}),
					123456,
					123456,
				);
				db.prepare(
					"INSERT INTO _schema_versions (name, version) VALUES ('agent', 17) ON CONFLICT(name) DO UPDATE SET version = excluded.version",
				).run();

				initAgentSchema(dbm);

				const row = db.prepare(`
					SELECT git_branch, git_head_commit, git_dirty_before, git_dirty_after
					FROM research_experiments
					WHERE id = ?
				`).get("exp-legacy-2") as {
					git_branch: string | null;
					git_head_commit: string | null;
					git_dirty_before: number | null;
					git_dirty_after: number | null;
				};
				expect(row.git_branch).toBe("main");
				expect(row.git_head_commit).toBe("abcd");
				expect(row.git_dirty_before).toBe(1);
				expect(row.git_dirty_after).toBe(0);
			});

			it("should backfill overnight research loop metadata from legacy record_json rows", () => {
				const db = dbm.get("agent");
				db.exec(`
					CREATE TABLE _schema_versions (
						name    TEXT PRIMARY KEY,
						version INTEGER NOT NULL DEFAULT 0
					);

					CREATE TABLE research_experiments (
						id                    TEXT PRIMARY KEY,
						project               TEXT NOT NULL,
						experiment_key        TEXT,
						budget_ms             INTEGER,
						session_id            TEXT,
						parent_session_id     TEXT,
						session_lineage_key   TEXT,
						topic                 TEXT NOT NULL,
						metric_name           TEXT NOT NULL,
						objective             TEXT NOT NULL,
						baseline_metric       REAL,
						observed_metric       REAL,
						delta                 REAL,
						decision              TEXT NOT NULL,
						sabha_id              TEXT,
						council_verdict       TEXT,
						route_class           TEXT,
						execution_route_class TEXT,
						selected_capability_id TEXT,
						selected_model_id     TEXT,
						selected_provider_id  TEXT,
						git_branch            TEXT,
						git_head_commit       TEXT,
						git_dirty_before      INTEGER,
						git_dirty_after       INTEGER,
						packed_context        TEXT,
						packed_runtime        TEXT,
						packed_source         TEXT,
						record_json           TEXT NOT NULL,
						created_at            INTEGER NOT NULL,
						updated_at            INTEGER NOT NULL
					);
				`);
				db.prepare(`
					INSERT INTO research_experiments (
						id, project, experiment_key, topic, metric_name, objective, decision, record_json, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(
					"exp-legacy-loop-1",
					"/repo/project",
					"loop-exp",
					"overnight refinement",
					"val_bpb",
					"minimize",
					"keep",
					JSON.stringify({
						loopKey: "loop-xyz",
						roundNumber: 3,
						totalRounds: 6,
						plannerRoute: {
							routeClass: "coding.deep-reasoning",
							selectedCapabilityId: "engine.planner",
							executionBinding: {
								selectedModelId: "planner-model",
								selectedProviderId: "planner-provider",
							},
						},
					}),
					123456,
					123456,
				);
				db.prepare(
					"INSERT INTO _schema_versions (name, version) VALUES ('agent', 19) ON CONFLICT(name) DO UPDATE SET version = excluded.version",
				).run();

				initAgentSchema(dbm);

				const row = db.prepare(`
					SELECT loop_key, round_number, total_rounds, planner_route_class, planner_selected_capability_id, planner_selected_model_id, planner_selected_provider_id
					FROM research_experiments
					WHERE id = ?
				`).get("exp-legacy-loop-1") as {
					loop_key: string | null;
					round_number: number | null;
					total_rounds: number | null;
					planner_route_class: string | null;
					planner_selected_capability_id: string | null;
					planner_selected_model_id: string | null;
					planner_selected_provider_id: string | null;
				};
				expect(row.loop_key).toBe("loop-xyz");
				expect(row.round_number).toBe(3);
				expect(row.total_rounds).toBe(6);
				expect(row.planner_route_class).toBe("coding.deep-reasoning");
				expect(row.planner_selected_capability_id).toBe("engine.planner");
				expect(row.planner_selected_model_id).toBe("planner-model");
				expect(row.planner_selected_provider_id).toBe("planner-provider");
			});
		});
	});
