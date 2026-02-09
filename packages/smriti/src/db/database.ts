/**
 * DatabaseManager — Singleton SQLite connection manager for Chitragupta.
 *
 * Manages three databases:
 *   - agent.db:   sessions, turns, FTS5, vasanas, kartavyas, consolidation rules
 *   - graph.db:   knowledge graph nodes, edges, pagerank
 *   - vectors.db: embeddings (sqlite-vec, when available)
 *
 * All databases use WAL mode for concurrent reads during writes.
 */

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";

export type DatabaseName = "agent" | "graph" | "vectors";

/** Pragmas applied to every database on open. */
const DEFAULT_PRAGMAS: Record<string, string | number> = {
	journal_mode: "WAL",
	synchronous: "NORMAL", // Safe with WAL — fsync on checkpoint only
	cache_size: -64000, // 64MB cache (negative = KB)
	foreign_keys: 1,
	busy_timeout: 5000, // 5s wait on lock contention
	temp_store: "MEMORY",
	mmap_size: 268435456, // 256MB mmap for read performance
};

/**
 * Singleton manager for all Chitragupta SQLite databases.
 *
 * Usage:
 *   const db = DatabaseManager.instance();
 *   const agentDb = db.get("agent");
 *   agentDb.prepare("SELECT ...").all();
 */
export class DatabaseManager {
	private static _instance: DatabaseManager | null = null;
	private _databases = new Map<DatabaseName, BetterSqlite3.Database>();
	private _dbDir: string;
	private _closed = false;

	private constructor(dbDir?: string) {
		this._dbDir = dbDir ?? getChitraguptaHome();
		fs.mkdirSync(this._dbDir, { recursive: true });
	}

	/**
	 * Get or create the singleton instance.
	 * @param dbDir - Override the database directory (useful for testing).
	 */
	static instance(dbDir?: string): DatabaseManager {
		if (!DatabaseManager._instance || DatabaseManager._instance._closed) {
			DatabaseManager._instance = new DatabaseManager(dbDir);
		}
		return DatabaseManager._instance;
	}

	/**
	 * Reset the singleton (for testing). Closes all open databases.
	 */
	static reset(): void {
		if (DatabaseManager._instance) {
			DatabaseManager._instance.closeAll();
			DatabaseManager._instance = null;
		}
	}

	/**
	 * Get a database connection by name. Opens it on first access.
	 */
	get(name: DatabaseName): BetterSqlite3.Database {
		if (this._closed) {
			throw new Error("DatabaseManager has been closed");
		}

		let db = this._databases.get(name);
		if (!db) {
			db = this._open(name);
			this._databases.set(name, db);
		}
		return db;
	}

	/**
	 * Get the file path for a database.
	 */
	getPath(name: DatabaseName): string {
		return path.join(this._dbDir, `${name}.db`);
	}

	/**
	 * Close all open database connections.
	 */
	closeAll(): void {
		for (const [name, db] of this._databases) {
			try {
				db.close();
			} catch {
				// Best effort — db may already be closed
			}
			this._databases.delete(name);
		}
		this._closed = true;
	}

	/**
	 * Close a specific database connection.
	 */
	close(name: DatabaseName): void {
		const db = this._databases.get(name);
		if (db) {
			db.close();
			this._databases.delete(name);
		}
	}

	/**
	 * Run VACUUM on a database to reclaim space.
	 * Should be called during deep sleep / yearly archival.
	 */
	vacuum(name: DatabaseName): void {
		this.get(name).exec("VACUUM");
	}

	/**
	 * Check database integrity.
	 */
	integrityCheck(name: DatabaseName): string {
		const result = this.get(name).pragma("integrity_check") as Array<{ integrity_check: string }>;
		return result[0]?.integrity_check ?? "unknown";
	}

	/**
	 * Open a database file and apply pragmas.
	 */
	private _open(name: DatabaseName): BetterSqlite3.Database {
		const dbPath = this.getPath(name);
		const db = new Database(dbPath);

		// Apply performance pragmas
		for (const [key, value] of Object.entries(DEFAULT_PRAGMAS)) {
			db.pragma(`${key} = ${value}`);
		}

		return db;
	}
}
