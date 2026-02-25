/**
 * @chitragupta/dharma — API Key Store (SQLite-backed).
 *
 * Manages creation, validation, revocation, and rate-limiting of API keys.
 * Keys are stored as SHA-256 hashes; raw values are only returned once at
 * creation time. Key format: `chg_<32 random hex chars>`.
 *
 * The store is generic over its database backend — callers inject a
 * `better-sqlite3`-compatible `Database` instance so that dharma avoids
 * a hard dependency on any specific SQLite package.
 *
 * @module api-key-store
 */

import crypto from "node:crypto";
import type { AuthScope, ApiKey, AuthResult } from "./auth-types.js";

// ─── Lightweight DB abstraction (better-sqlite3 compatible) ──────────────────

/** Minimal prepared-statement interface. */
interface PreparedStatement {
	run(...params: unknown[]): { changes: number };
	get(...params: unknown[]): unknown;
	all(...params: unknown[]): unknown[];
}

/** Minimal database interface matching `better-sqlite3`. */
export interface AuthDatabase {
	exec(sql: string): void;
	prepare(sql: string): PreparedStatement;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Prefix for all generated API keys. */
const KEY_PREFIX = "chg_";

/** Length of the random hex portion of a key. */
const KEY_RANDOM_LENGTH = 32;

/** Length of the per-key salt in bytes. */
const SALT_LENGTH = 16;

/** Default rate-limit sliding window (1 minute). */
const DEFAULT_RATE_WINDOW_MS = 60_000;

/** Default rate limit applied to unknown/invalid tokens to prevent brute-force. */
const UNKNOWN_TOKEN_RATE_LIMIT = 10;

// ─── Internal row shape ─────────────────────────────────────────────────────

/** Shape of a row in the `api_keys` SQLite table. */
interface ApiKeyRow {
	id: string;
	key_hash: string;
	/** Hex-encoded per-key salt (empty string for legacy unsalted keys). */
	key_salt: string;
	name: string;
	tenant_id: string;
	scopes: string;
	created_at: number;
	expires_at: number | null;
	last_used_at: number | null;
	rate_limit: number | null;
	revoked: number;
}

// ─── Rate-limit sliding window (in-memory) ──────────────────────────────────

/** In-memory sliding-window rate limiter per key ID. */
class SlidingWindowLimiter {
	private readonly windows = new Map<string, number[]>();
	private readonly windowMs: number;

	constructor(windowMs: number) {
		this.windowMs = windowMs;
	}

	/**
	 * Record a hit and return whether the request is within the limit.
	 * @param keyId - The API key identifier.
	 * @param limit - Max allowed requests in the window.
	 * @returns `true` if the request is allowed.
	 */
	check(keyId: string, limit: number): boolean {
		const now = Date.now();
		const cutoff = now - this.windowMs;
		let hits = this.windows.get(keyId) ?? [];
		hits = hits.filter((t) => t > cutoff);
		if (hits.length >= limit) {
			this.windows.set(keyId, hits);
			return false;
		}
		hits.push(now);
		this.windows.set(keyId, hits);
		return true;
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a raw API key string: `chg_<32 hex chars>`. */
function generateRawKey(): string {
	const random = crypto.randomBytes(KEY_RANDOM_LENGTH).toString("hex").slice(0, KEY_RANDOM_LENGTH);
	return `${KEY_PREFIX}${random}`;
}

/** Generate a random hex-encoded salt of {@link SALT_LENGTH} bytes. */
function generateSalt(): string {
	return crypto.randomBytes(SALT_LENGTH).toString("hex");
}

/** SHA-256 hash a raw key with an optional salt prefix. */
function hashKey(raw: string, salt = ""): string {
	return crypto.createHash("sha256").update(salt + raw).digest("hex");
}

/** Convert a DB row to a public ApiKey (masks the hash). */
function rowToApiKey(row: ApiKeyRow): ApiKey {
	return {
		id: row.id,
		key: `${row.key_hash.slice(0, 8)}...`,
		name: row.name,
		tenantId: row.tenant_id,
		scopes: JSON.parse(row.scopes) as AuthScope[],
		createdAt: row.created_at,
		expiresAt: row.expires_at ?? undefined,
		lastUsedAt: row.last_used_at ?? undefined,
		rateLimit: row.rate_limit ?? undefined,
	};
}

// ─── ApiKeyStore ─────────────────────────────────────────────────────────────

/**
 * SQLite-backed API key management service.
 *
 * Supports key lifecycle (create / validate / revoke / list) and per-key
 * sliding-window rate limiting.
 */
export class ApiKeyStore {
	private readonly db: AuthDatabase;
	private readonly limiter: SlidingWindowLimiter;
	private schemaReady = false;

	/**
	 * @param db - A `better-sqlite3`-compatible database connection.
	 * @param rateLimitWindowMs - Sliding-window duration for rate limits (default 60 s).
	 */
	constructor(db: AuthDatabase, rateLimitWindowMs = DEFAULT_RATE_WINDOW_MS) {
		this.db = db;
		this.limiter = new SlidingWindowLimiter(rateLimitWindowMs);
	}

	// ─── Schema ────────────────────────────────────────────────────────

	/** Lazily create the `api_keys` table, indices, and apply migrations. */
	private ensureSchema(): void {
		if (this.schemaReady) return;
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS api_keys (
				id          TEXT PRIMARY KEY,
				key_hash    TEXT NOT NULL,
				key_salt    TEXT NOT NULL DEFAULT '',
				name        TEXT NOT NULL,
				tenant_id   TEXT NOT NULL,
				scopes      TEXT NOT NULL DEFAULT '[]',
				created_at  INTEGER NOT NULL,
				expires_at  INTEGER,
				last_used_at INTEGER,
				rate_limit  INTEGER,
				revoked     INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
			CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON api_keys(key_hash);
		`);
		// Migration: add key_salt column to existing tables that lack it
		try {
			this.db.exec("ALTER TABLE api_keys ADD COLUMN key_salt TEXT NOT NULL DEFAULT ''");
		} catch {
			// Column already exists — ignore the error
		}
		this.schemaReady = true;
	}

	// ─── Public API ────────────────────────────────────────────────────

	/**
	 * Generate a new API key for a tenant.
	 *
	 * The raw key is returned **only once** — subsequent reads return a masked hash.
	 *
	 * @param tenantId - The owning tenant ID.
	 * @param name - A human-readable label for this key.
	 * @param scopes - Permission scopes to grant.
	 * @param options - Optional expiry and rate-limit overrides.
	 * @returns The raw key string and the persisted ApiKey record.
	 */
	createKey(
		tenantId: string,
		name: string,
		scopes: AuthScope[],
		options?: { expiresAt?: number; rateLimit?: number },
	): { key: string; record: ApiKey } {
		this.ensureSchema();
		const rawKey = generateRawKey();
		const salt = generateSalt();
		const keyHash = hashKey(rawKey, salt);
		const id = crypto.randomUUID();
		const now = Date.now();

		this.db.prepare(`
			INSERT INTO api_keys (id, key_hash, key_salt, name, tenant_id, scopes, created_at, expires_at, rate_limit, revoked)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
		`).run(
			id,
			keyHash,
			salt,
			name,
			tenantId,
			JSON.stringify(scopes),
			now,
			options?.expiresAt ?? null,
			options?.rateLimit ?? null,
		);

		const record: ApiKey = {
			id,
			key: `${keyHash.slice(0, 8)}...`,
			name,
			tenantId,
			scopes,
			createdAt: now,
			expiresAt: options?.expiresAt,
			rateLimit: options?.rateLimit,
		};

		return { key: rawKey, record };
	}

	/**
	 * Validate a raw API key and return the associated tenant + scopes.
	 *
	 * Iterates all stored keys and computes SHA-256(salt + token) for each,
	 * because each key has its own random salt. Rejects revoked, expired, or
	 * unknown keys.
	 *
	 * Rate limiting is applied even for unknown tokens (using the unsalted
	 * token hash as the limiter key) to prevent brute-force enumeration.
	 *
	 * @param rawKey - The full raw key string (e.g. `chg_abc123...`).
	 * @returns An {@link AuthResult} indicating success or failure.
	 */
	validateKey(rawKey: string): AuthResult {
		this.ensureSchema();

		const row = this.findKeyByToken(rawKey);

		if (!row) {
			// Apply rate limiting for unknown tokens to prevent brute-force
			const tokenFingerprint = hashKey(rawKey);
			if (!this.limiter.check(tokenFingerprint, UNKNOWN_TOKEN_RATE_LIMIT)) {
				return { authenticated: false, error: "Rate limit exceeded" };
			}
			return { authenticated: false, error: "Invalid API key" };
		}

		if (row.revoked === 1) {
			return { authenticated: false, error: "API key has been revoked" };
		}

		if (row.expires_at !== null && row.expires_at <= Date.now()) {
			return { authenticated: false, error: "API key has expired" };
		}

		// Update last_used_at
		const now = Date.now();
		this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now, row.id);

		const scopes = JSON.parse(row.scopes) as AuthScope[];

		return {
			authenticated: true,
			tenantId: row.tenant_id,
			keyId: row.id,
			scopes,
		};
	}

	/**
	 * Find a key row by iterating all keys and comparing salted hashes.
	 *
	 * Supports both salted (new) and unsalted (legacy) keys. Legacy keys
	 * have an empty `key_salt` column and use SHA-256(token) directly.
	 *
	 * @param rawKey - The raw API key string to look up.
	 * @returns The matching row or `undefined`.
	 */
	private findKeyByToken(rawKey: string): ApiKeyRow | undefined {
		const rows = this.db.prepare(
			"SELECT * FROM api_keys",
		).all() as ApiKeyRow[];

		for (const row of rows) {
			const salt = row.key_salt ?? "";
			const candidateHash = hashKey(rawKey, salt);
			if (candidateHash === row.key_hash) {
				return row;
			}
		}
		return undefined;
	}

	/**
	 * Revoke an API key by its record ID.
	 *
	 * @param keyId - The UUID of the key to revoke.
	 */
	revokeKey(keyId: string): void {
		this.ensureSchema();
		this.db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(keyId);
	}

	/**
	 * List all (non-revoked) keys for a tenant. Key values are masked.
	 *
	 * @param tenantId - The tenant whose keys to list.
	 * @returns Array of {@link ApiKey} records with masked hashes.
	 */
	listKeys(tenantId: string): ApiKey[] {
		this.ensureSchema();
		const rows = this.db.prepare(
			"SELECT * FROM api_keys WHERE tenant_id = ? AND revoked = 0 ORDER BY created_at DESC",
		).all(tenantId) as ApiKeyRow[];
		return rows.map(rowToApiKey);
	}

	/**
	 * Check whether a key is within its rate limit.
	 *
	 * Uses an in-memory sliding-window counter. Keys without a `rateLimit`
	 * configured are always allowed.
	 *
	 * @param keyId - The UUID of the key.
	 * @returns `true` if the request is allowed, `false` if rate-limited.
	 */
	checkRateLimit(keyId: string): boolean {
		this.ensureSchema();
		const row = this.db.prepare(
			"SELECT rate_limit FROM api_keys WHERE id = ?",
		).get(keyId) as { rate_limit: number | null } | undefined;

		if (!row || row.rate_limit === null) return true;
		return this.limiter.check(keyId, row.rate_limit);
	}
}
