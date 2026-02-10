/**
 * Schema — DDL for all Chitragupta SQLite tables.
 *
 * Tables are created idempotently (IF NOT EXISTS). Migrations are version-tracked
 * via a `schema_version` pragma so future changes can be applied incrementally.
 *
 * Three databases:
 *   agent.db  — sessions, turns, FTS5, vasanas, kartavyas, consolidation
 *   graph.db  — knowledge graph nodes, edges, pagerank
 *   vectors.db — embeddings (sqlite-vec HNSW when available, fallback to brute-force)
 */

import type { DatabaseManager } from "./database.js";

// Current schema versions — bump when adding migrations
const AGENT_SCHEMA_VERSION = 3;
const GRAPH_SCHEMA_VERSION = 1;
const VECTORS_SCHEMA_VERSION = 1;

/**
 * Initialize all database schemas. Safe to call multiple times.
 */
export function initAllSchemas(dbm: DatabaseManager): void {
	initAgentSchema(dbm);
	initGraphSchema(dbm);
	initVectorsSchema(dbm);
}

/**
 * Initialize agent.db schema: sessions, turns, FTS5, vasanas, kartavyas.
 */
export function initAgentSchema(dbm: DatabaseManager): void {
	const db = dbm.get("agent");
	const currentVersion = getSchemaVersion(db, "agent");

	if (currentVersion >= AGENT_SCHEMA_VERSION) return;

	db.exec(`
		-- ─── Sessions ─────────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS sessions (
			id          TEXT PRIMARY KEY,
			project     TEXT NOT NULL,
			title       TEXT NOT NULL DEFAULT 'New Session',
			created_at  INTEGER NOT NULL,  -- Unix epoch ms
			updated_at  INTEGER NOT NULL,
			turn_count  INTEGER NOT NULL DEFAULT 0,
			model       TEXT,
			agent       TEXT DEFAULT 'chitragupta',
			cost        REAL DEFAULT 0,
			tokens      INTEGER DEFAULT 0,
			tags        TEXT,              -- JSON array
			file_path   TEXT NOT NULL,     -- Relative path to .md file
			parent_id   TEXT,              -- For branching
			branch      TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
		CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
		CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);

		-- ─── Turns ────────────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS turns (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			turn_number INTEGER NOT NULL,
			role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
			content     TEXT NOT NULL,
			agent       TEXT,
			model       TEXT,
			tool_calls  TEXT,              -- JSON array of tool calls
			created_at  INTEGER NOT NULL,  -- Unix epoch ms
			UNIQUE(session_id, turn_number)
		);

		CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
		CREATE INDEX IF NOT EXISTS idx_turns_created ON turns(created_at DESC);

		-- ─── FTS5 Full-Text Search on turns ──────────────────────────────
		CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
			content,
			content_rowid='id',
			tokenize='porter unicode61'
		);

		-- ─── Consolidation Rules (Samskaara patterns) ────────────────────
		CREATE TABLE IF NOT EXISTS consolidation_rules (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			category    TEXT NOT NULL,      -- 'preference', 'decision', 'pattern', 'fact', 'correction'
			rule_text   TEXT NOT NULL,
			confidence  REAL NOT NULL DEFAULT 0.5,
			source_sessions TEXT,           -- JSON array of session IDs
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL,
			hit_count   INTEGER DEFAULT 1,
			project     TEXT               -- NULL = global
		);

		CREATE INDEX IF NOT EXISTS idx_rules_category ON consolidation_rules(category);
		CREATE INDEX IF NOT EXISTS idx_rules_project ON consolidation_rules(project);

		-- ─── Vasanas (crystallized behavioral tendencies) ─────────────────
		CREATE TABLE IF NOT EXISTS vasanas (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT NOT NULL,
			description TEXT NOT NULL,
			valence     TEXT NOT NULL CHECK(valence IN ('positive', 'negative', 'neutral')),
			strength    REAL NOT NULL DEFAULT 0.5,  -- 0-1
			stability   REAL NOT NULL DEFAULT 0.0,  -- BOCPD stability score
			source_samskaras TEXT,          -- JSON array of rule IDs that crystallized into this
			project     TEXT,              -- NULL = global (cross-project)
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL,
			last_activated INTEGER,         -- Last time this vasana influenced behavior
			activation_count INTEGER DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_vasanas_project ON vasanas(project);
		CREATE INDEX IF NOT EXISTS idx_vasanas_strength ON vasanas(strength DESC);

		-- ─── Kartavyas (auto-executable tasks) ───────────────────────────
		CREATE TABLE IF NOT EXISTS kartavyas (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT NOT NULL,
			description TEXT NOT NULL,
			trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron', 'event', 'threshold')),
			trigger_config TEXT NOT NULL,   -- JSON: cron expression, event name, or threshold config
			vasana_id   INTEGER REFERENCES vasanas(id),
			status      TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'approved', 'active', 'paused', 'retired')),
			last_run    INTEGER,
			run_count   INTEGER DEFAULT 0,
			success_count INTEGER DEFAULT 0,
			failure_count INTEGER DEFAULT 0,
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_kartavyas_status ON kartavyas(status);
	`);

	// ─── Phase 1 migration: Self-Evolution Engine tables ─────────────
	if (currentVersion < 2) {
		db.exec(`
			-- ─── Samskaras (behavioral impressions / detected patterns) ──────
			CREATE TABLE IF NOT EXISTS samskaras (
				id          TEXT PRIMARY KEY,   -- FNV-1a hash of pattern_type + content
				session_id  TEXT NOT NULL,
				pattern_type TEXT NOT NULL CHECK(pattern_type IN (
					'tool-sequence', 'preference', 'decision', 'correction', 'convention'
				)),
				pattern_content TEXT NOT NULL,
				observation_count INTEGER NOT NULL DEFAULT 1,
				confidence  REAL NOT NULL DEFAULT 0.5,
				pramana_type TEXT,              -- 'pratyaksha', 'anumana', 'shabda', 'upamana', 'arthapatti', 'anupalabdhi'
				project     TEXT,               -- NULL = global
				created_at  INTEGER NOT NULL,
				updated_at  INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_samskaras_session ON samskaras(session_id);
			CREATE INDEX IF NOT EXISTS idx_samskaras_type ON samskaras(pattern_type);
			CREATE INDEX IF NOT EXISTS idx_samskaras_confidence ON samskaras(confidence DESC);
			CREATE INDEX IF NOT EXISTS idx_samskaras_project ON samskaras(project);

			-- ─── Vidhis (procedural memory — learned tool sequences) ────────
			CREATE TABLE IF NOT EXISTS vidhis (
				id          TEXT PRIMARY KEY,   -- FNV-1a hash
				project     TEXT NOT NULL,
				name        TEXT NOT NULL,
				learned_from TEXT NOT NULL,     -- JSON array of session IDs
				confidence  REAL NOT NULL DEFAULT 0.5,
				steps       TEXT NOT NULL,      -- JSON array of VidhiStep
				triggers    TEXT NOT NULL,      -- JSON array of trigger phrases
				success_rate REAL DEFAULT 0.0,
				success_count INTEGER DEFAULT 0,
				failure_count INTEGER DEFAULT 0,
				parameter_schema TEXT,          -- JSON object of ParamDef
				created_at  INTEGER NOT NULL,
				updated_at  INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_vidhis_project ON vidhis(project);
			CREATE INDEX IF NOT EXISTS idx_vidhis_name ON vidhis(project, name);
			CREATE INDEX IF NOT EXISTS idx_vidhis_success ON vidhis(success_rate DESC);

			-- ─── Nidra State (singleton — sleep cycle state machine) ────────
			CREATE TABLE IF NOT EXISTS nidra_state (
				id          INTEGER PRIMARY KEY CHECK(id = 1),  -- Singleton row
				current_state TEXT NOT NULL DEFAULT 'LISTENING'
					CHECK(current_state IN ('LISTENING', 'DREAMING', 'DEEP_SLEEP')),
				last_state_change INTEGER NOT NULL,
				last_heartbeat INTEGER NOT NULL,
				last_consolidation_start INTEGER,
				last_consolidation_end INTEGER,
				consolidation_phase TEXT,       -- Current Svapna phase if DREAMING
				consolidation_progress REAL DEFAULT 0.0,  -- [0, 1]
				updated_at  INTEGER NOT NULL
			);

			-- Seed singleton row
			INSERT OR IGNORE INTO nidra_state (id, current_state, last_state_change, last_heartbeat, updated_at)
			VALUES (1, 'LISTENING', ${Date.now()}, ${Date.now()}, ${Date.now()});

			-- ─── Consolidation Log (dream cycle & cron audit trail) ─────────
			CREATE TABLE IF NOT EXISTS consolidation_log (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				project     TEXT NOT NULL,
				cycle_type  TEXT NOT NULL CHECK(cycle_type IN ('svapna', 'monthly', 'yearly')),
				cycle_id    TEXT,               -- e.g. 'svapna-2026-02-09T14:30:00Z'
				phase       TEXT,               -- REPLAY, RECOMBINE, CRYSTALLIZE, PROCEDURALIZE, COMPRESS
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

			CREATE INDEX IF NOT EXISTS idx_conslog_project ON consolidation_log(project);
			CREATE INDEX IF NOT EXISTS idx_conslog_type ON consolidation_log(cycle_type);
			CREATE INDEX IF NOT EXISTS idx_conslog_created ON consolidation_log(created_at DESC);

			-- ─── Pratyabhijna Context (session identity snapshots) ──────────
			CREATE TABLE IF NOT EXISTS pratyabhijna_context (
				session_id  TEXT PRIMARY KEY,
				project     TEXT NOT NULL,
				identity_summary TEXT,         -- The self-recognition text
				global_vasanas TEXT,           -- JSON array of top global vasanas loaded
				project_vasanas TEXT,          -- JSON array of top project vasanas loaded
				active_samskaras TEXT,         -- JSON array of active samskaras
				cross_project_insights TEXT,   -- JSON array
				tool_mastery TEXT,             -- JSON object of tool → mastery score
				warmup_ms   REAL,             -- How long pratyabhijna took
				created_at  INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_pratyabhijna_project ON pratyabhijna_context(project);
		`);
	}

	// ─── Phase 3 migration: Metadata column for external system fields ──
	if (currentVersion < 3) {
		db.exec(`
			-- Add metadata column for storing external system fields (e.g. Vaayu session data)
			ALTER TABLE sessions ADD COLUMN metadata TEXT;
		`);
	}

	setSchemaVersion(db, "agent", AGENT_SCHEMA_VERSION);
}

/**
 * Initialize graph.db schema: nodes, edges, pagerank.
 */
export function initGraphSchema(dbm: DatabaseManager): void {
	const db = dbm.get("graph");
	const currentVersion = getSchemaVersion(db, "graph");

	if (currentVersion >= GRAPH_SCHEMA_VERSION) return;

	db.exec(`
		-- ─── Nodes ────────────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS nodes (
			id          TEXT PRIMARY KEY,
			type        TEXT NOT NULL,      -- 'session', 'memory', 'concept', 'file', 'decision', 'entity'
			label       TEXT NOT NULL,
			content     TEXT NOT NULL DEFAULT '',
			metadata    TEXT,              -- JSON
			created_at  INTEGER NOT NULL,
			updated_at  INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);

		-- ─── Edges ────────────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS edges (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			source      TEXT NOT NULL REFERENCES nodes(id),
			target      TEXT NOT NULL REFERENCES nodes(id),
			relationship TEXT NOT NULL,
			weight      REAL NOT NULL DEFAULT 1.0,
			pramana     TEXT,              -- Epistemology type: 'pratyaksha', 'anumana', 'shabda', 'upamana', 'arthapatti', 'anupalabdhi'
			viveka      TEXT,              -- Grounding: 'grounded', 'inferred', 'uncertain'
			valid_from  INTEGER,           -- Bi-temporal: when relationship became true (epoch ms)
			valid_until INTEGER,           -- When relationship ended (NULL = still valid)
			recorded_at INTEGER NOT NULL,  -- When edge was recorded
			superseded_at INTEGER,         -- When superseded by newer version (NULL = current)
			UNIQUE(source, target, relationship, recorded_at)
		);

		CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
		CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
		CREATE INDEX IF NOT EXISTS idx_edges_relationship ON edges(relationship);

		-- ─── PageRank ─────────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS pagerank (
			node_id     TEXT PRIMARY KEY REFERENCES nodes(id),
			score       REAL NOT NULL DEFAULT 0.0,
			updated_at  INTEGER NOT NULL
		);
	`);

	setSchemaVersion(db, "graph", GRAPH_SCHEMA_VERSION);
}

/**
 * Initialize vectors.db schema.
 * Uses a plain table for embeddings. sqlite-vec HNSW can be layered on top
 * when the extension is available.
 */
export function initVectorsSchema(dbm: DatabaseManager): void {
	const db = dbm.get("vectors");
	const currentVersion = getSchemaVersion(db, "vectors");

	if (currentVersion >= VECTORS_SCHEMA_VERSION) return;

	db.exec(`
		-- ─── Embeddings ───────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS embeddings (
			id          TEXT PRIMARY KEY,
			vector      BLOB NOT NULL,     -- Float32Array as binary blob
			text        TEXT NOT NULL,      -- Source text that was embedded
			source_type TEXT NOT NULL,      -- 'turn', 'session', 'memory', 'consolidated'
			source_id   TEXT NOT NULL,      -- ID of the source document
			dimensions  INTEGER NOT NULL,   -- Vector dimensionality (e.g. 1536)
			metadata    TEXT,              -- JSON
			created_at  INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
	`);

	setSchemaVersion(db, "vectors", VECTORS_SCHEMA_VERSION);
}

// ─── Schema Version Tracking ────────────────────────────────────────────────

/**
 * Schema version is stored in a `_schema_versions` table within each database.
 * This allows independent versioning per database.
 */
function ensureVersionTable(db: ReturnType<DatabaseManager["get"]>): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS _schema_versions (
			name    TEXT PRIMARY KEY,
			version INTEGER NOT NULL DEFAULT 0
		)
	`);
}

function getSchemaVersion(db: ReturnType<DatabaseManager["get"]>, name: string): number {
	ensureVersionTable(db);
	const row = db.prepare("SELECT version FROM _schema_versions WHERE name = ?").get(name) as
		| { version: number }
		| undefined;
	return row?.version ?? 0;
}

function setSchemaVersion(
	db: ReturnType<DatabaseManager["get"]>,
	name: string,
	version: number,
): void {
	ensureVersionTable(db);
	db.prepare(
		"INSERT OR REPLACE INTO _schema_versions (name, version) VALUES (?, ?)",
	).run(name, version);
}
