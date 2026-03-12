import type { DatabaseManager } from "./database.js";

export const AGENT_SCHEMA_VERSION = 24;
export const GRAPH_SCHEMA_VERSION = 1;
export const VECTORS_SCHEMA_VERSION = 1;

export function ensureVersionTable(db: ReturnType<DatabaseManager["get"]>): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS _schema_versions (
			name    TEXT PRIMARY KEY,
			version INTEGER NOT NULL DEFAULT 0
		)
	`);
}

export function getSchemaVersion(db: ReturnType<DatabaseManager["get"]>, name: string): number {
	ensureVersionTable(db);
	const row = db.prepare("SELECT version FROM _schema_versions WHERE name = ?").get(name) as
		| { version: number }
		| undefined;
	return row?.version ?? 0;
}

export function setSchemaVersion(
	db: ReturnType<DatabaseManager["get"]>,
	name: string,
	version: number,
): void {
	ensureVersionTable(db);
	db.prepare(
		"INSERT OR REPLACE INTO _schema_versions (name, version) VALUES (?, ?)",
	).run(name, version);
}
