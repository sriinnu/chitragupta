/**
 * @chitragupta/dharma — Tenant Store (SQLite-backed).
 *
 * Manages tenant lifecycle (create, read, list, delete) for multi-tenant
 * isolation. Each tenant is a logical container that owns API keys
 * and associated data.
 *
 * Like {@link ApiKeyStore}, the store accepts a generic database instance
 * to avoid coupling dharma to a specific SQLite package.
 *
 * @module tenant-store
 */

import crypto from "node:crypto";
import type { Tenant } from "./auth-types.js";
import type { AuthDatabase } from "./api-key-store.js";

// ─── Internal row shape ─────────────────────────────────────────────────────

/** Shape of a row in the `tenants` SQLite table. */
interface TenantRow {
	id: string;
	name: string;
	created_at: number;
	metadata: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a DB row to a public {@link Tenant}. */
function rowToTenant(row: TenantRow): Tenant {
	let metadata: Record<string, unknown> | undefined;
	if (row.metadata) {
		try {
			metadata = JSON.parse(row.metadata) as Record<string, unknown>;
		} catch {
			metadata = undefined;
		}
	}
	return {
		id: row.id,
		name: row.name,
		createdAt: row.created_at,
		metadata,
	};
}

// ─── TenantStore ─────────────────────────────────────────────────────────────

/**
 * SQLite-backed tenant registry.
 *
 * Provides CRUD operations for tenant entities used by the auth subsystem
 * to enforce data isolation across API keys and sessions.
 */
export class TenantStore {
	private readonly db: AuthDatabase;
	private schemaReady = false;

	/**
	 * @param db - A `better-sqlite3`-compatible database connection.
	 */
	constructor(db: AuthDatabase) {
		this.db = db;
	}

	// ─── Schema ────────────────────────────────────────────────────────

	/** Lazily create the `tenants` table. */
	private ensureSchema(): void {
		if (this.schemaReady) return;
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS tenants (
				id         TEXT PRIMARY KEY,
				name       TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				metadata   TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(name);
		`);
		this.schemaReady = true;
	}

	// ─── Public API ────────────────────────────────────────────────────

	/**
	 * Create a new tenant.
	 *
	 * @param name - Human-readable tenant name.
	 * @param metadata - Optional metadata bag.
	 * @returns The newly created {@link Tenant}.
	 */
	createTenant(name: string, metadata?: Record<string, unknown>): Tenant {
		this.ensureSchema();
		const id = crypto.randomUUID();
		const now = Date.now();
		const metaJson = metadata ? JSON.stringify(metadata) : null;

		this.db.prepare(
			"INSERT INTO tenants (id, name, created_at, metadata) VALUES (?, ?, ?, ?)",
		).run(id, name, now, metaJson);

		return { id, name, createdAt: now, metadata };
	}

	/**
	 * Retrieve a tenant by ID.
	 *
	 * @param id - Tenant UUID.
	 * @returns The matching {@link Tenant}, or `undefined` if not found.
	 */
	getTenant(id: string): Tenant | undefined {
		this.ensureSchema();
		const row = this.db.prepare(
			"SELECT * FROM tenants WHERE id = ?",
		).get(id) as TenantRow | undefined;

		return row ? rowToTenant(row) : undefined;
	}

	/**
	 * List all tenants, ordered by creation time descending.
	 *
	 * @returns Array of {@link Tenant} records.
	 */
	listTenants(): Tenant[] {
		this.ensureSchema();
		const rows = this.db.prepare(
			"SELECT * FROM tenants ORDER BY created_at DESC",
		).all() as TenantRow[];
		return rows.map(rowToTenant);
	}

	/**
	 * Delete a tenant by ID.
	 *
	 * Note: this does **not** cascade to API keys. Callers should revoke
	 * associated keys separately if needed.
	 *
	 * @param id - Tenant UUID to delete.
	 */
	deleteTenant(id: string): void {
		this.ensureSchema();
		this.db.prepare("DELETE FROM tenants WHERE id = ?").run(id);
	}
}
