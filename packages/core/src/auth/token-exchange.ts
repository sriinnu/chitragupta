/**
 * Vinimaya — Token exchange endpoint handlers.
 * Sanskrit: Vinimaya (विनिमय) = exchange, barter.
 *
 * Pure functions that handle OAuth token exchange and JWT refresh.
 * Returns response objects — not wired to HTTP directly.
 * The HTTP server registers these as route handlers.
 */

import type { JWTConfig, JWTPayload } from "./jwt.js";
import { signJWT, verifyJWT, refreshJWT } from "./jwt.js";
import type { OAuthProviderConfig, OAuthTokenClaims } from "./oauth.js";
import { verifyOAuthToken } from "./oauth.js";
import type { TenantStore } from "./tenant.js";
import { DEFAULT_TENANT } from "./tenant.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenExchangeRequest {
	/** OAuth provider: "google", "apple", "github". */
	provider: string;
	/** OAuth token (ID token for Google/Apple, access token for GitHub). */
	token: string;
}

export interface TokenExchangeResponse {
	/** Chitragupta JWT access token. */
	accessToken: string;
	/** Token lifetime in seconds. */
	expiresIn: number;
	/** Token type — always "Bearer". */
	tokenType: "Bearer";
	/** User information from the OAuth provider. */
	user: {
		id: string;
		email?: string;
		name?: string;
	};
}

export interface TokenRefreshRequest {
	/** Existing JWT to refresh. */
	token: string;
}

export interface TokenRefreshResponse {
	/** New JWT access token. */
	accessToken: string;
	/** Token lifetime in seconds. */
	expiresIn: number;
	/** Token type — always "Bearer". */
	tokenType: "Bearer";
}

export interface AuthMeResponse {
	/** User ID. */
	userId: string;
	/** Tenant ID. */
	tenantId: string;
	/** Assigned roles. */
	roles: string[];
	/** Permission scopes. */
	scope: string[];
	/** Token expiration (Unix timestamp). */
	exp: number;
	/** Token issued at (Unix timestamp). */
	iat: number;
}

/** HTTP-style response shape returned by the handlers. */
export interface HandlerResponse {
	status: number;
	body: unknown;
}

// ─── Token Exchange Config ───────────────────────────────────────────────────

export interface TokenExchangeConfig {
	/** JWT config for signing new tokens. */
	jwt: JWTConfig;
	/** OAuth provider configs keyed by provider ID. */
	oauthProviders: Map<string, OAuthProviderConfig>;
	/** Tenant store for user→tenant resolution. */
	tenantStore?: TenantStore;
	/** Default roles for new users. */
	defaultRoles?: string[];
	/** Default tenant ID for new users. */
	defaultTenantId?: string;
	/** Callback to resolve or create a user from OAuth claims. */
	resolveUser?: (claims: OAuthTokenClaims) => Promise<{
		userId: string;
		tenantId: string;
		roles: string[];
	}>;
}

// ─── Default User Resolver ───────────────────────────────────────────────────

/**
 * Default user resolution: maps OAuth sub to a user ID,
 * assigns default roles and tenant.
 */
function defaultResolveUser(
	claims: OAuthTokenClaims,
	config: TokenExchangeConfig,
): { userId: string; tenantId: string; roles: string[] } {
	return {
		userId: `${claims.provider}:${claims.sub}`,
		tenantId: config.defaultTenantId ?? DEFAULT_TENANT.tenantId,
		roles: config.defaultRoles ?? ["viewer"],
	};
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * Handle `POST /api/auth/token` — exchange an OAuth token for a Chitragupta JWT.
 */
export async function handleTokenExchange(
	body: unknown,
	config: TokenExchangeConfig,
): Promise<HandlerResponse> {
	// Validate request body
	if (!body || typeof body !== "object") {
		return { status: 400, body: { error: "Request body must be a JSON object" } };
	}

	const req = body as Record<string, unknown>;
	const provider = req.provider;
	const token = req.token;

	if (typeof provider !== "string" || provider.length === 0) {
		return { status: 400, body: { error: "Missing or empty 'provider' field" } };
	}

	if (typeof token !== "string" || token.length === 0) {
		return { status: 400, body: { error: "Missing or empty 'token' field" } };
	}

	// Look up provider config
	const providerConfig = config.oauthProviders.get(provider);
	if (!providerConfig) {
		return { status: 400, body: { error: `Unsupported OAuth provider: ${provider}` } };
	}

	// Verify the OAuth token
	const claims = await verifyOAuthToken(provider, token, providerConfig);
	if (!claims) {
		return { status: 401, body: { error: "Invalid or expired OAuth token" } };
	}

	// Resolve user
	const userInfo = config.resolveUser
		? await config.resolveUser(claims)
		: defaultResolveUser(claims, config);

	// Sign Chitragupta JWT
	const expiresIn = config.jwt.expiresIn ?? 3600;
	const accessToken = signJWT(
		{
			sub: userInfo.userId,
			roles: userInfo.roles,
			tenantId: userInfo.tenantId,
			scope: userInfo.roles, // Scope mirrors roles by default
		},
		config.jwt,
	);

	const response: TokenExchangeResponse = {
		accessToken,
		expiresIn,
		tokenType: "Bearer",
		user: {
			id: userInfo.userId,
			email: claims.email,
			name: claims.name,
		},
	};

	return { status: 200, body: response };
}

/**
 * Handle `POST /api/auth/refresh` — refresh an existing JWT.
 */
export function handleTokenRefresh(
	body: unknown,
	config: TokenExchangeConfig,
): HandlerResponse {
	if (!body || typeof body !== "object") {
		return { status: 400, body: { error: "Request body must be a JSON object" } };
	}

	const req = body as Record<string, unknown>;
	const token = req.token;

	if (typeof token !== "string" || token.length === 0) {
		return { status: 400, body: { error: "Missing or empty 'token' field" } };
	}

	const newToken = refreshJWT(token, config.jwt);
	if (!newToken) {
		return { status: 401, body: { error: "Invalid or expired token" } };
	}

	const expiresIn = config.jwt.expiresIn ?? 3600;
	const response: TokenRefreshResponse = {
		accessToken: newToken,
		expiresIn,
		tokenType: "Bearer",
	};

	return { status: 200, body: response };
}

/**
 * Handle `GET /api/auth/me` — return current user info from JWT.
 */
export function handleAuthMe(
	jwtPayload: JWTPayload | null,
): HandlerResponse {
	if (!jwtPayload) {
		return { status: 401, body: { error: "Not authenticated or using legacy auth" } };
	}

	const response: AuthMeResponse = {
		userId: jwtPayload.sub,
		tenantId: jwtPayload.tenantId,
		roles: jwtPayload.roles,
		scope: jwtPayload.scope,
		exp: jwtPayload.exp,
		iat: jwtPayload.iat,
	};

	return { status: 200, body: response };
}
