/**
 * Dvarpalaka — Authentication & authorization middleware.
 * Sanskrit: Dvarpalaka (द्वारपालक) = gatekeeper.
 *
 * Orchestrates JWT verification, RBAC authorization, tenant resolution,
 * and backward-compatible legacy token/API-key authentication.
 * Designed as pure functions that return results — not tied to any HTTP framework.
 */

import http from "node:http";
import type { JWTConfig, JWTPayload } from "./jwt.js";
import { verifyJWT } from "./jwt.js";
import type { Permission } from "./rbac.js";
import { RBACEngine } from "./rbac.js";
import type { OAuthProviderConfig } from "./oauth.js";
import type { TenantStore, TenantContext } from "./tenant.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Authenticated context attached to each request after successful auth. */
export interface AuthContext {
	/** Authenticated user ID. */
	userId: string;
	/** Tenant this user belongs to. */
	tenantId: string;
	/** Roles assigned to this user. */
	roles: string[];
	/** Resolved permissions (union of all role permissions). */
	permissions: Set<Permission>;
	/** The full decoded JWT payload (null for legacy token auth). */
	jwtPayload: JWTPayload | null;
	/** Tenant context (null if tenant store is not configured). */
	tenant: TenantContext | null;
	/** Whether this auth was via legacy token/API-key (backward compat). */
	isLegacy: boolean;
}

/** Configuration for the Dvarpalaka auth middleware. */
export interface AuthMiddlewareConfig {
	/** JWT configuration for token verification. */
	jwt?: JWTConfig;
	/** RBAC engine for permission checks. */
	rbac?: RBACEngine;
	/** Tenant store for multi-tenant resolution. */
	tenantStore?: TenantStore;
	/** OAuth provider configurations (keyed by provider ID). */
	oauthProviders?: Map<string, OAuthProviderConfig>;
	/**
	 * Routes that do not require authentication.
	 * Format: "METHOD /path" (e.g. "GET /api/health").
	 * Glob patterns supported: "GET /api/public/*".
	 */
	publicRoutes?: Set<string>;
	/**
	 * Legacy auth: single bearer token.
	 * When JWT config is not set, falls back to this.
	 */
	legacyAuthToken?: string;
	/**
	 * Legacy auth: array of valid API keys.
	 * When JWT config is not set, falls back to these.
	 */
	legacyApiKeys?: string[];
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Default public routes (always allowed without auth). */
const DEFAULT_PUBLIC_ROUTES = new Set([
	"GET /api/health",
	"OPTIONS *",
]);

/**
 * Extract a bearer token from the Authorization header.
 */
function extractBearerToken(headers: Record<string, string | undefined>): string | null {
	const authHeader = headers["authorization"] ?? "";
	if (authHeader.startsWith("Bearer ")) {
		const token = authHeader.slice(7).trim();
		return token.length > 0 ? token : null;
	}
	return null;
}

/**
 * Extract an API key from the X-API-Key header.
 */
function extractApiKey(headers: Record<string, string | undefined>): string | null {
	const key = headers["x-api-key"];
	return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Check if a route matches a set of patterns.
 */
function routeMatchesPatterns(method: string, path: string, patterns: Set<string>): boolean {
	// Exact match
	if (patterns.has(`${method} ${path}`)) return true;

	// Wildcard match (e.g. "OPTIONS *")
	if (patterns.has(`${method} *`)) return true;

	// Glob patterns (e.g. "GET /api/public/*")
	for (const pattern of patterns) {
		const [patternMethod, patternPath] = pattern.split(" ");
		if (patternMethod !== method) continue;
		if (patternPath && patternPath.endsWith("*")) {
			const prefix = patternPath.slice(0, -1);
			if (path.startsWith(prefix)) return true;
		}
	}

	return false;
}

/**
 * Build a legacy AuthContext for backward-compatible token/API-key auth.
 */
function buildLegacyContext(): AuthContext {
	return {
		userId: "legacy",
		tenantId: "default",
		roles: ["admin"],
		permissions: new Set(["*"]),
		jwtPayload: null,
		tenant: null,
		isLegacy: true,
	};
}

/**
 * Build an AuthContext from a verified JWT payload.
 */
async function buildJWTContext(
	payload: JWTPayload,
	rbac: RBACEngine | undefined,
	tenantStore: TenantStore | undefined,
): Promise<AuthContext> {
	// Resolve permissions from roles
	const permissions = new Set<Permission>();
	if (rbac) {
		for (const roleName of payload.roles) {
			for (const perm of rbac.getPermissions(roleName)) {
				permissions.add(perm);
			}
		}
	}

	// Resolve tenant
	let tenant: TenantContext | null = null;
	if (tenantStore) {
		tenant = await tenantStore.getTenant(payload.tenantId);
	}

	return {
		userId: payload.sub,
		tenantId: payload.tenantId,
		roles: payload.roles,
		permissions,
		jwtPayload: payload,
		tenant,
		isLegacy: false,
	};
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Authenticate an HTTP request.
 *
 * Tries JWT verification first. If no JWT config is set,
 * falls back to legacy bearer token / API key authentication.
 *
 * Returns an AuthContext on success, or null on failure.
 */
export async function authenticateRequest(
	req: {
		method: string;
		path: string;
		headers: Record<string, string | undefined>;
	},
	config: AuthMiddlewareConfig,
): Promise<AuthContext | null> {
	const publicRoutes = config.publicRoutes
		? new Set([...DEFAULT_PUBLIC_ROUTES, ...config.publicRoutes])
		: DEFAULT_PUBLIC_ROUTES;

	// Check if route is public
	if (routeMatchesPatterns(req.method, req.path, publicRoutes)) {
		return buildLegacyContext(); // Grant access with default context
	}

	const bearerToken = extractBearerToken(req.headers as Record<string, string | undefined>);
	const apiKey = extractApiKey(req.headers as Record<string, string | undefined>);

	// ── JWT-based authentication ───────────────────────────────────
	if (config.jwt) {
		// Try bearer token as JWT
		if (bearerToken) {
			const payload = verifyJWT(bearerToken, config.jwt);
			if (payload) {
				return buildJWTContext(payload, config.rbac, config.tenantStore);
			}
		}
		// JWT configured but no valid JWT found — reject
		// (unless legacy fallback is also configured)
		if (!config.legacyAuthToken && !config.legacyApiKeys?.length) {
			return null;
		}
	}

	// ── Legacy authentication (backward compat) ────────────────────
	const legacyAuthEnabled = Boolean(config.legacyAuthToken) || Boolean(config.legacyApiKeys?.length);

	if (!legacyAuthEnabled) {
		// No auth configured at all — allow all (single-user mode)
		return buildLegacyContext();
	}

	const candidate = bearerToken ?? apiKey;

	// Check legacy auth token
	if (config.legacyAuthToken && candidate === config.legacyAuthToken) {
		return buildLegacyContext();
	}

	// Check legacy API keys
	if (config.legacyApiKeys?.length && candidate) {
		if (config.legacyApiKeys.includes(candidate)) {
			return buildLegacyContext();
		}
	}

	return null;
}

/**
 * Authenticate a WebSocket upgrade request.
 *
 * Checks for auth tokens in:
 * 1. Query parameter `?token=xxx`
 * 2. Sec-WebSocket-Protocol header
 * 3. Authorization header (Bearer token)
 *
 * Returns an AuthContext on success, or null on failure.
 */
export async function authenticateWebSocket(
	req: http.IncomingMessage,
	config: AuthMiddlewareConfig,
): Promise<AuthContext | null> {
	// Extract tokens from all possible locations
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	const queryToken = url.searchParams.get("token");
	const protocol = req.headers["sec-websocket-protocol"];
	const protocolToken = typeof protocol === "string" ? protocol.trim() : null;
	const authHeader = req.headers["authorization"] ?? "";
	const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

	// Try each candidate
	const candidates = [queryToken, protocolToken, bearerToken].filter(
		(c): c is string => c !== null && c.length > 0,
	);

	// ── JWT-based authentication ───────────────────────────────────
	if (config.jwt) {
		for (const candidate of candidates) {
			const payload = verifyJWT(candidate, config.jwt);
			if (payload) {
				return buildJWTContext(payload, config.rbac, config.tenantStore);
			}
		}
		// JWT configured but no valid JWT — try legacy fallback
		if (!config.legacyAuthToken && !config.legacyApiKeys?.length) {
			return null;
		}
	}

	// ── Legacy authentication ──────────────────────────────────────
	const legacyAuthEnabled = Boolean(config.legacyAuthToken) || Boolean(config.legacyApiKeys?.length);

	if (!legacyAuthEnabled) {
		// No auth configured — allow all
		return buildLegacyContext();
	}

	for (const candidate of candidates) {
		if (config.legacyAuthToken && candidate === config.legacyAuthToken) {
			return buildLegacyContext();
		}
		if (config.legacyApiKeys?.includes(candidate)) {
			return buildLegacyContext();
		}
	}

	return null;
}

/**
 * Authorize a route based on RBAC permissions.
 *
 * Returns true if the user has the required permission for the route.
 * Returns true for public routes or when no RBAC is configured.
 */
export function authorizeRoute(
	context: AuthContext,
	method: string,
	path: string,
	config: AuthMiddlewareConfig,
): boolean {
	// Legacy auth contexts get full access
	if (context.isLegacy) return true;

	// No RBAC configured — allow all authenticated requests
	if (!config.rbac) return true;

	const permission = config.rbac.resolveRoutePermission(method, path);

	// Public route (permission is null)
	if (permission === null) return true;

	// No mapping found — allow any authenticated user
	if (permission === undefined) return true;

	// Check permission
	return config.rbac.authorize(context.roles, permission);
}
