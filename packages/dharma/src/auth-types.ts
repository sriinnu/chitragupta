/**
 * @chitragupta/dharma — Authentication & multi-tenant isolation types.
 *
 * Defines the shapes used by the API-key store, tenant registry,
 * and HTTP auth middleware to enforce identity, scopes, and rate limits
 * in production multi-user deployments.
 *
 * @module auth-types
 */

// ─── Auth Scopes ─────────────────────────────────────────────────────────────

/** Granular permission scopes that can be assigned to an API key. */
export type AuthScope =
	| "read"
	| "write"
	| "admin"
	| "tools"
	| "sessions"
	| "memory";

// ─── API Key ─────────────────────────────────────────────────────────────────

/** A persisted API key record. The `key` field stores a SHA-256 hash. */
export interface ApiKey {
	/** Unique identifier (UUID v4). */
	id: string;
	/** SHA-256 hash of the raw key (raw value is only returned at creation). */
	key: string;
	/** Human-readable label, e.g. "CI pipeline key". */
	name: string;
	/** Owning tenant identifier. */
	tenantId: string;
	/** Permission scopes granted by this key. */
	scopes: AuthScope[];
	/** Epoch ms when the key was created. */
	createdAt: number;
	/** Epoch ms when the key expires (undefined = never). */
	expiresAt?: number;
	/** Epoch ms of the most recent successful validation. */
	lastUsedAt?: number;
	/** Maximum requests per minute (undefined = unlimited). */
	rateLimit?: number;
}

// ─── Tenant ──────────────────────────────────────────────────────────────────

/** A tenant in the multi-tenant isolation model. */
export interface Tenant {
	/** Unique identifier (UUID v4). */
	id: string;
	/** Human-readable tenant name. */
	name: string;
	/** Epoch ms when the tenant was created. */
	createdAt: number;
	/** Optional metadata bag for integrations. */
	metadata?: Record<string, unknown>;
}

// ─── Auth Result ─────────────────────────────────────────────────────────────

/** Outcome of an API-key validation attempt. */
export interface AuthResult {
	/** Whether the key was successfully authenticated. */
	authenticated: boolean;
	/** Resolved tenant ID when authenticated. */
	tenantId?: string;
	/** UUID of the validated key (for per-key rate limiting). */
	keyId?: string;
	/** Scopes granted by the validated key. */
	scopes?: AuthScope[];
	/** Human-readable error when authentication fails. */
	error?: string;
}

// ─── Middleware Configuration ────────────────────────────────────────────────

/** Configuration for the HTTP auth middleware. */
export interface AuthMiddlewareConfig {
	/** Whether authentication is enforced. When false, all requests pass through. */
	enabled: boolean;
	/** HTTP header to extract the bearer token from. Default: "authorization". */
	headerName?: string;
	/** Expected prefix before the token value. Default: "Bearer". */
	bearerPrefix?: string;
	/** URL paths that skip authentication entirely (e.g. "/health"). */
	bypassPaths?: string[];
	/** Sliding-window duration in ms for rate limiting. Default: 60000. */
	rateLimitWindow?: number;
}
