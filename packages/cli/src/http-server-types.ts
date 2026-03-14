/**
 * Types for the Dvaara HTTP API server.
 * @module http-server-types
 */

import type { AuthContext, AuthMiddlewareConfig, TokenExchangeConfig } from "@chitragupta/core";
import type { AuthMiddlewareConfig as DharmaAuthConfig } from "@chitragupta/dharma";
import type { ApiKeyStore } from "@chitragupta/dharma";
import type { JobQueueConfig } from "./job-queue.js";
import type { WebSocketServerOptions } from "./ws-handler.js";
import type { TlsCertificates } from "./tls/tls-types.js";

export interface ServerConfig {
	/** Port to listen on. Default: 3141 (pi). */
	port?: number;
	/** Host to bind to. Default: "127.0.0.1" (local only). */
	host?: string;
	/** CORS origin. Default: localhost only. Set to "*" to allow all origins. */
	corsOrigin?: string;
	/** Enable request logging to console. Default: false. */
	enableLogging?: boolean;
	/** Maximum request body size in bytes. Default: 1_048_576 (1 MiB). */
	maxBodySize?: number;
	/** Request timeout in milliseconds. Default: 30_000 (30s). */
	requestTimeoutMs?: number;
	/** Maximum requests per window. Default: 60. */
	rateLimit?: number;
	/** Rate limit window in milliseconds. Default: 60_000 (1 minute). */
	rateLimitWindowMs?: number;
	/**
	 * Single bearer token for auth. When set, all requests (except
	 * GET /api/health and OPTIONS) must include `Authorization: Bearer <token>`.
	 */
	authToken?: string;
	/**
	 * Array of valid API keys. When set, requests must include either
	 * `X-API-Key: <key>` or `Authorization: Bearer <key>`.
	 * Can be used alongside or instead of `authToken`.
	 */
	apiKeys?: string[];
	/** Configuration for the async job queue. */
	jobQueue?: JobQueueConfig;
	/** WebSocket server options. When present, enables WebSocket support. */
	ws?: WebSocketServerOptions;
	/**
	 * Dvarpalaka auth middleware configuration.
	 * When set, enables JWT + RBAC + tenant isolation.
	 * Backward compatible: when not set, falls back to legacy authToken/apiKeys.
	 */
	auth?: AuthMiddlewareConfig;
	/**
	 * Token exchange configuration for OAuth → JWT flow.
	 * Required for /api/auth/* routes when using JWT auth.
	 */
	tokenExchange?: TokenExchangeConfig;
	/**
	 * Absolute path to the Hub SPA `dist/` directory.
	 * When set, the server serves static files from this directory
	 * for any GET request that does not start with `/api/`.
	 * Non-file paths fall back to `index.html` for SPA routing.
	 */
	hubDistPath?: string;
	/**
	 * Kavach TLS certificate material. When set, the server uses
	 * `https.createServer()` instead of `http.createServer()`.
	 * WebSocket upgrades automatically use `wss://`.
	 */
	tls?: TlsCertificates;
	/**
	 * Dharma API-key auth middleware configuration.
	 *
	 * When set, wires the `@chitragupta/dharma` auth middleware into the
	 * request pipeline. Provides per-key rate limiting, tenant isolation,
	 * and scope-based authorization via the `ApiKeyStore`.
	 *
	 * Health/status endpoints (`/api/health`) are bypassed by default.
	 * Set `dharmaAuth.config.enabled = false` to disable (default OFF).
	 * A warning is logged when auth is disabled.
	 */
	dharmaAuth?: {
		/** The API key store instance to validate tokens against. */
		keyStore: ApiKeyStore;
		/** Middleware configuration (enabled, bypass paths, etc.). */
		config?: DharmaAuthConfig;
	};
}

export interface RouteHandler {
	(req: ParsedRequest): Promise<RouteResponse>;
}

export interface ParsedRequest {
	/** HTTP method (GET, POST, etc.) */
	method: string;
	/** URL path (e.g. "/api/sessions/abc") */
	path: string;
	/** Path parameters extracted from route pattern (e.g. { id: "abc" }) */
	params: Record<string, string>;
	/** Query string parameters */
	query: Record<string, string>;
	/** Parsed JSON body (for POST/PUT/PATCH) */
	body: unknown;
	/** Request headers (lowercased keys) */
	headers: Record<string, string>;
	/** Unique request ID for tracing */
	requestId: string;
	/** Authenticated user context (set by Dvarpalaka auth middleware). */
	auth?: AuthContext;
}

export interface RouteResponse {
	/** HTTP status code */
	status: number;
	/** Response body (will be JSON-serialized) */
	body: unknown;
	/** Optional extra response headers */
	headers?: Record<string, string>;
}

export interface RegisteredRoute {
	pattern: string;
	segments: string[];
	handler: RouteHandler;
}

export interface SessionOpenOptions {
	sessionId?: string;
	title?: string;
	clientKey?: string;
	sessionLineageKey?: string;
	sessionReusePolicy?: "isolated" | "same_day";
	consumer?: string;
	surface?: string;
	channel?: string;
	actorId?: string;
}

export interface PromptRequestOptions extends SessionOpenOptions {
	requestId?: string;
	onEvent?: (type: string, data: unknown) => void;
	signal?: AbortSignal;
}

/**
 * Dependencies injected into route mounting functions.
 * Each route module uses a subset of these.
 */
export interface ApiDeps {
	getAgent: () => unknown;
	getSession: () => unknown;
	loadSession?: (id: string) => Promise<unknown> | unknown;
	openSession?: (options?: SessionOpenOptions) => Promise<{ id: string; created: boolean }>;
	openSharedSession?: (options?: SessionOpenOptions) => Promise<{ id?: string; session?: unknown; created: boolean }>;
	listSessions: () => unknown[] | Promise<unknown[]>;
	listProviders?: () => unknown[];
	listTools?: () => unknown[];
	prompt?: (message: string, options?: PromptRequestOptions) => Promise<string>;
	getVidyaOrchestrator?: () => unknown;
	getVasanaEngine?: () => unknown;
	getNidraDaemon?: () => unknown;
	getVidhiEngine?: () => unknown;
	getTuriyaRouter?: () => unknown;
	getTriguna?: () => unknown;
	getRtaEngine?: () => unknown;
	getBuddhi?: () => unknown;
	getDatabase?: () => unknown;
	getSamiti?: () => unknown;
	getSabhaEngine?: () => unknown;
	getLokapala?: () => unknown;
	getAkasha?: () => unknown;
	getKartavyaEngine?: () => unknown;
	getKalaChakra?: () => unknown;
	getProjectPath?: () => string;
	/** Lazy getter for the Dvara-Bandhu pairing engine. */
	getPairingEngine?: () => unknown;
	/** Lazy getter for the budget tracker. */
	getBudgetTracker?: () => unknown;
	/** Lazy getter for global settings. */
	getSettings?: () => unknown;
	/** Webhook HMAC secret for inbound webhook signature verification. */
	getWebhookSecret?: () => string | undefined;
	/** Lazy getter for the P2P mesh router (for webhook→actor forwarding). */
	getMeshRouter?: () => unknown;
	/** P2P mesh status snapshot getter. */
	getMeshStatus?: () =>
		| import("./mesh-observability.js").MeshStatusSnapshot
		| Promise<import("./mesh-observability.js").MeshStatusSnapshot | undefined>
		| undefined;
	/** Connect to a remote peer endpoint. Returns true if connected. */
	connectToPeer?: (endpoint: string) => Promise<boolean>;
}
