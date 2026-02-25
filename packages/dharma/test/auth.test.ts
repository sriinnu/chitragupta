/**
 * @chitragupta/dharma — Authentication & Multi-Tenant tests.
 *
 * Covers: ApiKeyStore (create/validate/revoke/expire/rate-limit/list),
 * TenantStore (CRUD), and auth middleware (401/403/429/bypass/scopes).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { ServerResponse, IncomingMessage } from "node:http";
import { ApiKeyStore } from "../src/api-key-store.js";
import { TenantStore } from "../src/tenant-store.js";
import { createAuthMiddleware } from "../src/auth-middleware.js";
import type {
	AuthScope,
	AuthResult,
	AuthMiddlewareConfig,
} from "../src/auth-types.js";
import type { AuthenticatedRequest } from "../src/auth-middleware.js";
import type { AuthDatabase } from "../src/api-key-store.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fresh in-memory SQLite database for each test. */
function freshDb(): AuthDatabase {
	return new Database(":memory:") as unknown as AuthDatabase;
}

/** Build a minimal mock IncomingMessage. */
function mockReq(opts: {
	url?: string;
	headers?: Record<string, string>;
}): AuthenticatedRequest {
	return {
		url: opts.url ?? "/api/data",
		headers: opts.headers ?? {},
	} as AuthenticatedRequest;
}

/** Build a minimal mock ServerResponse capturing status and body. */
function mockRes(): ServerResponse & { _status: number; _body: string; _headers: Record<string, string> } {
	const headers: Record<string, string> = {};
	const res = {
		_status: 0,
		_body: "",
		_headers: headers,
		writeHead(status: number, hdrs?: Record<string, string>) {
			res._status = status;
			if (hdrs) Object.assign(headers, hdrs);
		},
		end(body?: string) {
			res._body = body ?? "";
		},
		setHeader(name: string, value: string) {
			headers[name] = value;
		},
	};
	return res as unknown as ServerResponse & { _status: number; _body: string; _headers: Record<string, string> };
}

// ─── ApiKeyStore ─────────────────────────────────────────────────────────────

describe("ApiKeyStore", () => {
	let db: AuthDatabase;
	let store: ApiKeyStore;

	beforeEach(() => {
		db = freshDb();
		store = new ApiKeyStore(db);
	});

	// ── Creation ─────────────────────────────────────────────────────

	it("should create a key with the chg_ prefix", () => {
		const { key } = store.createKey("t1", "test-key", ["read"]);
		expect(key).toMatch(/^chg_[a-f0-9]{32}$/);
	});

	it("should return a record with masked hash", () => {
		const { record } = store.createKey("t1", "test-key", ["read", "write"]);
		expect(record.key).toMatch(/^[a-f0-9]{8}\.\.\.$/);
		expect(record.name).toBe("test-key");
		expect(record.tenantId).toBe("t1");
		expect(record.scopes).toEqual(["read", "write"]);
		expect(record.createdAt).toBeGreaterThan(0);
	});

	it("should generate unique keys on each creation", () => {
		const k1 = store.createKey("t1", "key-1", ["read"]);
		const k2 = store.createKey("t1", "key-2", ["read"]);
		expect(k1.key).not.toBe(k2.key);
		expect(k1.record.id).not.toBe(k2.record.id);
	});

	it("should persist optional expiresAt and rateLimit", () => {
		const future = Date.now() + 3600_000;
		const { record } = store.createKey("t1", "expiring", ["read"], {
			expiresAt: future,
			rateLimit: 100,
		});
		expect(record.expiresAt).toBe(future);
		expect(record.rateLimit).toBe(100);
	});

	// ── Validation ───────────────────────────────────────────────────

	it("should validate a correct key", () => {
		const { key, record } = store.createKey("t1", "valid", ["read", "admin"]);
		const result = store.validateKey(key);
		expect(result.authenticated).toBe(true);
		expect(result.tenantId).toBe("t1");
		expect(result.keyId).toBe(record.id);
		expect(result.scopes).toEqual(["read", "admin"]);
	});

	it("should reject an unknown key", () => {
		const result = store.validateKey("chg_does_not_exist_aaaaaaaaaa");
		expect(result.authenticated).toBe(false);
		expect(result.error).toContain("Invalid");
	});

	it("should reject a revoked key", () => {
		const { key, record } = store.createKey("t1", "doomed", ["write"]);
		store.revokeKey(record.id);
		const result = store.validateKey(key);
		expect(result.authenticated).toBe(false);
		expect(result.error).toContain("revoked");
	});

	it("should reject an expired key", () => {
		const past = Date.now() - 1000;
		const { key } = store.createKey("t1", "old", ["read"], { expiresAt: past });
		const result = store.validateKey(key);
		expect(result.authenticated).toBe(false);
		expect(result.error).toContain("expired");
	});

	it("should accept a key that has not yet expired", () => {
		const future = Date.now() + 60_000;
		const { key } = store.createKey("t1", "fresh", ["read"], { expiresAt: future });
		const result = store.validateKey(key);
		expect(result.authenticated).toBe(true);
	});

	it("should update lastUsedAt on validation", () => {
		const { key } = store.createKey("t1", "tracked", ["read"]);
		const before = Date.now();
		store.validateKey(key);
		const keys = store.listKeys("t1");
		expect(keys[0].lastUsedAt).toBeDefined();
		expect(keys[0].lastUsedAt).toBeGreaterThanOrEqual(before);
	});

	// ── Revocation ───────────────────────────────────────────────────

	it("should revoke a key by ID", () => {
		const { key, record } = store.createKey("t1", "target", ["read"]);
		store.revokeKey(record.id);
		const result = store.validateKey(key);
		expect(result.authenticated).toBe(false);
	});

	it("should not throw when revoking a non-existent key", () => {
		expect(() => store.revokeKey("non-existent-id")).not.toThrow();
	});

	// ── Listing ──────────────────────────────────────────────────────

	it("should list keys for a specific tenant", () => {
		store.createKey("t1", "a", ["read"]);
		store.createKey("t1", "b", ["write"]);
		store.createKey("t2", "c", ["admin"]);
		const t1Keys = store.listKeys("t1");
		expect(t1Keys).toHaveLength(2);
		expect(t1Keys.every((k) => k.tenantId === "t1")).toBe(true);
	});

	it("should not list revoked keys", () => {
		const { record } = store.createKey("t1", "revoked", ["read"]);
		store.createKey("t1", "active", ["read"]);
		store.revokeKey(record.id);
		const keys = store.listKeys("t1");
		expect(keys).toHaveLength(1);
		expect(keys[0].name).toBe("active");
	});

	it("should return empty array for unknown tenant", () => {
		expect(store.listKeys("unknown")).toEqual([]);
	});

	// ── Rate Limiting ────────────────────────────────────────────────

	it("should allow requests within the rate limit", () => {
		const { record } = store.createKey("t1", "limited", ["read"], { rateLimit: 5 });
		for (let i = 0; i < 5; i++) {
			expect(store.checkRateLimit(record.id)).toBe(true);
		}
	});

	it("should deny requests exceeding the rate limit", () => {
		const { record } = store.createKey("t1", "limited", ["read"], { rateLimit: 3 });
		store.checkRateLimit(record.id);
		store.checkRateLimit(record.id);
		store.checkRateLimit(record.id);
		expect(store.checkRateLimit(record.id)).toBe(false);
	});

	it("should allow unlimited requests for keys without rateLimit", () => {
		const { record } = store.createKey("t1", "unlimited", ["read"]);
		for (let i = 0; i < 100; i++) {
			expect(store.checkRateLimit(record.id)).toBe(true);
		}
	});

	it("should return true for unknown key ID in rate limit check", () => {
		expect(store.checkRateLimit("nonexistent")).toBe(true);
	});
});

// ─── TenantStore ─────────────────────────────────────────────────────────────

describe("TenantStore", () => {
	let db: AuthDatabase;
	let store: TenantStore;

	beforeEach(() => {
		db = freshDb();
		store = new TenantStore(db);
	});

	it("should create a tenant with generated ID", () => {
		const tenant = store.createTenant("Acme Corp");
		expect(tenant.id).toBeDefined();
		expect(tenant.name).toBe("Acme Corp");
		expect(tenant.createdAt).toBeGreaterThan(0);
	});

	it("should persist and retrieve tenant metadata", () => {
		const tenant = store.createTenant("Meta Corp", { plan: "enterprise", seats: 50 });
		const fetched = store.getTenant(tenant.id);
		expect(fetched).toBeDefined();
		expect(fetched?.metadata).toEqual({ plan: "enterprise", seats: 50 });
	});

	it("should return undefined for unknown tenant ID", () => {
		expect(store.getTenant("no-such-id")).toBeUndefined();
	});

	it("should list all tenants", () => {
		store.createTenant("Alpha");
		store.createTenant("Beta");
		store.createTenant("Gamma");
		const all = store.listTenants();
		expect(all).toHaveLength(3);
		const names = all.map((t) => t.name).sort();
		expect(names).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("should delete a tenant by ID", () => {
		const tenant = store.createTenant("Doomed");
		store.deleteTenant(tenant.id);
		expect(store.getTenant(tenant.id)).toBeUndefined();
	});

	it("should not throw when deleting a non-existent tenant", () => {
		expect(() => store.deleteTenant("ghost")).not.toThrow();
	});

	it("should handle tenants without metadata", () => {
		const tenant = store.createTenant("Simple");
		const fetched = store.getTenant(tenant.id);
		expect(fetched?.metadata).toBeUndefined();
	});
});

// ─── Auth Middleware ─────────────────────────────────────────────────────────

describe("createAuthMiddleware", () => {
	let db: AuthDatabase;
	let keyStore: ApiKeyStore;

	beforeEach(() => {
		db = freshDb();
		keyStore = new ApiKeyStore(db);
	});

	it("should pass through when auth is disabled", () => {
		const mw = createAuthMiddleware(keyStore, { enabled: false });
		const req = mockReq({});
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it("should bypass configured paths", () => {
		const mw = createAuthMiddleware(keyStore, {
			enabled: true,
			bypassPaths: ["/health", "/api/metrics"],
		});
		const req = mockReq({ url: "/health" });
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it("should bypass paths with wildcard patterns", () => {
		const mw = createAuthMiddleware(keyStore, {
			enabled: true,
			bypassPaths: ["/public/*"],
		});
		const req = mockReq({ url: "/public/docs/intro" });
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it("should return 401 when no Authorization header is present", () => {
		const mw = createAuthMiddleware(keyStore, { enabled: true });
		const req = mockReq({});
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(res._status).toBe(401);
		expect(next).not.toHaveBeenCalled();
		expect(JSON.parse(res._body)).toHaveProperty("error");
	});

	it("should return 401 for malformed Authorization header", () => {
		const mw = createAuthMiddleware(keyStore, { enabled: true });
		const req = mockReq({ headers: { authorization: "Basic abc123" } });
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(res._status).toBe(401);
		expect(next).not.toHaveBeenCalled();
	});

	it("should return 401 for an invalid token", () => {
		const mw = createAuthMiddleware(keyStore, { enabled: true });
		const req = mockReq({
			headers: { authorization: "Bearer chg_invalidtoken000000000000000" },
		});
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(res._status).toBe(401);
		expect(next).not.toHaveBeenCalled();
	});

	it("should return 403 for a revoked key", () => {
		const { key, record } = keyStore.createKey("t1", "revoked-mw", ["read"]);
		keyStore.revokeKey(record.id);
		const mw = createAuthMiddleware(keyStore, { enabled: true });
		const req = mockReq({
			headers: { authorization: `Bearer ${key}` },
		});
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(res._status).toBe(403);
		expect(next).not.toHaveBeenCalled();
	});

	it("should call next and attach context for a valid key", () => {
		const { key, record } = keyStore.createKey("t1", "valid-mw", ["read", "tools"]);
		const mw = createAuthMiddleware(keyStore, { enabled: true });
		const req = mockReq({
			headers: { authorization: `Bearer ${key}` },
		});
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(next).toHaveBeenCalledOnce();
		expect(req.authContext).toBeDefined();
		expect(req.authContext?.tenantId).toBe("t1");
		expect(req.authContext?.scopes).toContain("read");
		expect(req.authContext?.scopes).toContain("tools");
		expect(req.authContext?.keyId).toBe(record.id);
	});

	it("should set X-Tenant-Id response header on success", () => {
		const { key } = keyStore.createKey("t1", "headers-mw", ["read"]);
		const mw = createAuthMiddleware(keyStore, { enabled: true });
		const req = mockReq({
			headers: { authorization: `Bearer ${key}` },
		});
		const res = mockRes();
		mw(req, res, vi.fn());
		expect(res._headers["X-Tenant-Id"]).toBe("t1");
	});

	it("should set X-Auth-Scopes response header on success", () => {
		const { key } = keyStore.createKey("t1", "scopes-mw", ["admin", "memory"]);
		const mw = createAuthMiddleware(keyStore, { enabled: true });
		const req = mockReq({
			headers: { authorization: `Bearer ${key}` },
		});
		const res = mockRes();
		mw(req, res, vi.fn());
		expect(res._headers["X-Auth-Scopes"]).toBe("admin,memory");
	});

	it("should strip query string when matching bypass paths", () => {
		const mw = createAuthMiddleware(keyStore, {
			enabled: true,
			bypassPaths: ["/health"],
		});
		const req = mockReq({ url: "/health?verbose=true" });
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it("should use custom header name when configured", () => {
		const { key } = keyStore.createKey("t1", "custom-header", ["read"]);
		const mw = createAuthMiddleware(keyStore, {
			enabled: true,
			headerName: "X-Api-Key",
		});
		const req = mockReq({
			headers: { "x-api-key": `Bearer ${key}` },
		});
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it("should use default config when no config is provided", () => {
		const mw = createAuthMiddleware(keyStore);
		const req = mockReq({});
		const res = mockRes();
		const next = vi.fn();
		mw(req, res, next);
		// Should enforce auth by default and return 401
		expect(res._status).toBe(401);
		expect(next).not.toHaveBeenCalled();
	});
});

// ─── Scope Verification (integration) ───────────────────────────────────────

describe("scope verification", () => {
	it("should return the exact scopes assigned to a key", () => {
		const db = freshDb();
		const store = new ApiKeyStore(db);
		const scopes: AuthScope[] = ["read", "write", "tools", "sessions"];
		const { key } = store.createKey("t1", "scoped", scopes);
		const result = store.validateKey(key);
		expect(result.scopes).toEqual(scopes);
	});

	it("should return empty scopes array for key created with no scopes", () => {
		const db = freshDb();
		const store = new ApiKeyStore(db);
		const { key } = store.createKey("t1", "no-scopes", []);
		const result = store.validateKey(key);
		expect(result.scopes).toEqual([]);
	});
});
