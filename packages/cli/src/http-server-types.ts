/**
 * Types for the Dvaara HTTP API server.
 * @module http-server-types
 */

import type { AuthContext, AuthMiddlewareConfig, TokenExchangeConfig } from "@chitragupta/core";
import type { JobQueueConfig } from "./job-queue.js";
import type { WebSocketServerOptions } from "./ws-handler.js";

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

/**
 * Dependencies injected into route mounting functions.
 * Each route module uses a subset of these.
 */
export interface ApiDeps {
	getAgent: () => unknown;
	getSession: () => unknown;
	listSessions: () => unknown[];
	listProviders?: () => unknown[];
	listTools?: () => unknown[];
	prompt?: (message: string, onEvent?: (type: string, data: unknown) => void, signal?: AbortSignal) => Promise<string>;
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
	getBudgetTracker?: () => unknown;
	getProjectPath?: () => string;
}
