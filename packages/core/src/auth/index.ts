/**
 * Kavacham — Authentication & Authorization module.
 * Sanskrit: Kavacham (कवचम्) = shield, armour, protection.
 *
 * Re-exports all auth primitives for convenient consumption.
 */

// JWT
export {
	signJWT,
	verifyJWT,
	decodeJWT,
	refreshJWT,
	base64urlEncode,
	base64urlDecode,
} from "./jwt.js";
export type { JWTConfig, JWTPayload, JWTSignInput } from "./jwt.js";

// RBAC
export {
	RBACEngine,
	BUILT_IN_ROLES,
	PERMISSIONS,
	ROUTE_PERMISSIONS,
} from "./rbac.js";
export type { Permission, RoleDefinition } from "./rbac.js";

// OAuth
export {
	verifyGoogleToken,
	verifyAppleToken,
	verifyGitHubToken,
	verifyOAuthToken,
	clearJWKSCache,
} from "./oauth.js";
export type { OAuthProviderConfig, OAuthTokenClaims } from "./oauth.js";

// Tenant
export {
	DEFAULT_TENANT,
	InMemoryTenantStore,
} from "./tenant.js";
export type { TenantConfig, TenantContext, TenantStore } from "./tenant.js";

// Middleware
export {
	authenticateRequest,
	authenticateWebSocket,
	authorizeRoute,
} from "./middleware.js";
export type { AuthContext, AuthMiddlewareConfig } from "./middleware.js";

// Token Exchange
export {
	handleTokenExchange,
	handleTokenRefresh,
	handleAuthMe,
} from "./token-exchange.js";
export type {
	TokenExchangeConfig,
	TokenExchangeRequest,
	TokenExchangeResponse,
	TokenRefreshRequest,
	TokenRefreshResponse,
	AuthMeResponse,
} from "./token-exchange.js";
