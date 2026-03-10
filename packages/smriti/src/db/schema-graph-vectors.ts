import type { DatabaseManager } from "./database.js";
import {
	GRAPH_SCHEMA_VERSION,
	VECTORS_SCHEMA_VERSION,
	getSchemaVersion,
	setSchemaVersion,
} from "./schema-version.js";

export function initGraphSchema(dbm: DatabaseManager): void {
	const db = dbm.get("graph");
	const currentVersion = getSchemaVersion(db, "graph");

	if (currentVersion >= GRAPH_SCHEMA_VERSION) return;

	db.exec(`
		-- ─── Nodes ────────────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS nodes (
			id          TEXT PRIMARY KEY,
			type        TEXT NOT NULL,
			label       TEXT NOT NULL,
			content     TEXT NOT NULL DEFAULT '',
			metadata    TEXT,
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
			pramana     TEXT,
			viveka      TEXT,
			valid_from  INTEGER,
			valid_until INTEGER,
			recorded_at INTEGER NOT NULL,
			superseded_at INTEGER,
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

export function initVectorsSchema(dbm: DatabaseManager): void {
	const db = dbm.get("vectors");
	const currentVersion = getSchemaVersion(db, "vectors");

	if (currentVersion >= VECTORS_SCHEMA_VERSION) return;

	db.exec(`
		-- ─── Embeddings ───────────────────────────────────────────────────
		CREATE TABLE IF NOT EXISTS embeddings (
			id          TEXT PRIMARY KEY,
			vector      BLOB NOT NULL,
			text        TEXT NOT NULL,
			source_type TEXT NOT NULL,
			source_id   TEXT NOT NULL,
			dimensions  INTEGER NOT NULL,
			metadata    TEXT,
			created_at  INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
	`);

	setSchemaVersion(db, "vectors", VECTORS_SCHEMA_VERSION);
}
