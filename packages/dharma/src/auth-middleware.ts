/**
 * @chitragupta/dharma — HTTP Authentication Middleware.
 *
 * Creates a connect-style middleware that extracts a Bearer token from
 * the `Authorization` header (or a custom header), validates it against
 * an {@link ApiKeyStore}, enforces rate limits, and attaches tenant
 * context to the request via the `X-Tenant-Id` and `X-Auth-Scopes`
 * response headers.
 *
 * Bypass paths (e.g. health checks) skip authentication entirely.
 * Disabled configs pass all requests through without validation.
 *
 * @module auth-middleware
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiKeyStore } from "./api-key-store.js";
import type { AuthMiddlewareConfig, AuthResult } from "./auth-types.js";

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_HEADER = "authorization";
const DEFAULT_PREFIX = "Bearer";

// ─── Augmented request with tenant context ───────────────────────────────────

/**
 * Extends the standard {@link IncomingMessage} with tenant context
 * populated by the auth middleware.
 */
export interface AuthenticatedRequest extends IncomingMessage {
	/** Tenant context attached after successful auth. */
	authContext?: {
		tenantId: string;
		scopes: string[];
		keyId?: string;
	};
}

// ─── JSON error helpers ──────────────────────────────────────────────────────

/** Write a JSON error response and end the stream. */
function jsonError(res: ServerResponse, status: number, message: string): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: message }));
}

// ─── Path matching ───────────────────────────────────────────────────────────

/**
 * Check whether a request path matches any bypass pattern.
 * Supports exact matches and prefix matches (patterns ending with `*`).
 */
function matchesBypass(requestPath: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		if (pattern.endsWith("*")) {
			const prefix = pattern.slice(0, -1);
			if (requestPath.startsWith(prefix)) return true;
		} else if (requestPath === pattern) {
			return true;
		}
	}
	return false;
}

// ─── Token extraction ────────────────────────────────────────────────────────

/**
 * Extract the bearer token from the request headers.
 *
 * @param req - Incoming HTTP request.
 * @param headerName - Header to read (lowercase).
 * @param prefix - Expected prefix (e.g. "Bearer").
 * @returns The raw token string or `undefined` if missing/malformed.
 */
function extractToken(
	req: IncomingMessage,
	headerName: string,
	prefix: string,
): string | undefined {
	const headerValue = req.headers[headerName];
	if (typeof headerValue !== "string") return undefined;

	const trimmed = headerValue.trim();
	if (!trimmed.startsWith(`${prefix} `)) return undefined;

	return trimmed.slice(prefix.length + 1).trim();
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/** Callback signature for the middleware next function. */
export type MiddlewareNext = () => void;

/**
 * Create an HTTP auth middleware that validates API keys from request headers.
 *
 * The returned function follows the connect/express `(req, res, next)` pattern.
 *
 * Features:
 * - Bearer token extraction from configurable header
 * - Key validation via {@link ApiKeyStore}
 * - Per-key sliding-window rate limiting
 * - Configurable bypass paths (e.g. health, metrics)
 * - Proper 401 / 403 / 429 JSON error responses
 * - Tenant context propagation via response headers and `req.authContext`
 *
 * @param keyStore - The API key store to validate tokens against.
 * @param config - Optional middleware configuration.
 * @returns A middleware function compatible with Node.js HTTP servers.
 */
export function createAuthMiddleware(
	keyStore: ApiKeyStore,
	config?: AuthMiddlewareConfig,
): (req: AuthenticatedRequest, res: ServerResponse, next: MiddlewareNext) => void {
	const enabled = config?.enabled ?? true;
	const headerName = (config?.headerName ?? DEFAULT_HEADER).toLowerCase();
	const prefix = config?.bearerPrefix ?? DEFAULT_PREFIX;
	const bypassPaths = config?.bypassPaths ?? [];

	return (req: AuthenticatedRequest, res: ServerResponse, next: MiddlewareNext): void => {
		// If auth is disabled, pass through
		if (!enabled) {
			next();
			return;
		}

		// Parse the URL path (strip query string)
		const requestPath = (req.url ?? "/").split("?")[0];

		// Check bypass paths
		if (matchesBypass(requestPath, bypassPaths)) {
			next();
			return;
		}

		// Extract token
		const token = extractToken(req, headerName, prefix);
		if (!token) {
			jsonError(res, 401, "Missing or malformed Authorization header");
			return;
		}

		// Validate key (also rate-limits unknown tokens internally)
		const result: AuthResult = keyStore.validateKey(token);
		if (!result.authenticated) {
			if (result.error?.includes("Rate limit")) {
				jsonError(res, 429, result.error);
				return;
			}
			const status = result.error?.includes("revoked") ? 403 : 401;
			jsonError(res, status, result.error ?? "Authentication failed");
			return;
		}

		// Per-key rate limit check using the key ID from validation
		if (result.keyId && !keyStore.checkRateLimit(result.keyId)) {
			jsonError(res, 429, "Rate limit exceeded");
			return;
		}

		// Attach tenant context to request
		req.authContext = {
			tenantId: result.tenantId ?? "",
			scopes: result.scopes ?? [],
			keyId: result.keyId,
		};

		// Set response headers for downstream consumers
		res.setHeader("X-Tenant-Id", result.tenantId ?? "");
		res.setHeader("X-Auth-Scopes", (result.scopes ?? []).join(","));

		next();
	};
}

