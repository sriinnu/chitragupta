/**
 * Dvaara — HTTP API server for Chitragupta.
 * Sanskrit: Dvaara (द्वार) = gateway, door.
 *
 * Provides a REST API for external applications (like Vaayu AI assistant)
 * to interact with Chitragupta programmatically. Uses Node.js built-in
 * http module — no Express or other framework needed.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { JobQueue, QueueFullError } from "./job-queue.js";
import type { JobQueueConfig, JobStatus, Job } from "./job-queue.js";
import { WebSocketServer } from "./ws-handler.js";
import type { WebSocketClient, WebSocketMessage, WebSocketServerOptions } from "./ws-handler.js";
import type { Agent } from "@chitragupta/anina";
import {
	serializeAgent,
	serializeAgentDetail,
	serializeTree,
	listAllAgents,
	findAgentById,
	countDescendants,
	computeAgentStats,
} from "./agent-api.js";
import {
	getMemory,
	updateMemory,
	appendMemory,
	deleteMemory,
	searchMemory,
} from "@chitragupta/smriti";
import {
	parseScopeParam,
	getMemoryEntry,
	listAllScopes,
} from "./memory-api.js";
import type { AuthMiddlewareConfig, AuthContext } from "@chitragupta/core";
import {
	authenticateRequest,
	authorizeRoute,
	handleTokenExchange,
	handleTokenRefresh,
	handleAuthMe,
} from "@chitragupta/core";
import type { TokenExchangeConfig } from "@chitragupta/core";
import {
	createLogger,
	MetricsRegistry,
	registerDefaultMetrics,
	HealthChecker,
	MemoryHealthCheck,
	EventLoopHealthCheck,
	DiskHealthCheck,
} from "@chitragupta/core";

// ─── Observability ───────────────────────────────────────────────────────────

const log = createLogger("http-server");
const metricsRegistry = new MetricsRegistry();
const defaultMetrics = registerDefaultMetrics(metricsRegistry);
const healthChecker = new HealthChecker();
healthChecker.register(new MemoryHealthCheck());
healthChecker.register(new EventLoopHealthCheck());
healthChecker.register(new DiskHealthCheck());

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface RegisteredRoute {
	pattern: string;
	segments: string[];
	handler: RouteHandler;
}

// ─── Server ──────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 3141;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_BODY = 1_048_576; // 1 MiB
const DEFAULT_TIMEOUT = 30_000; // 30s

/** Default: only allow localhost origins (same-origin policy). */
const DEFAULT_CORS_ORIGINS = [
	"http://localhost",
	"http://127.0.0.1",
	"https://localhost",
	"https://127.0.0.1",
];

export class ChitraguptaServer {
	private server: http.Server | null = null;
	private routes: Map<string, RegisteredRoute[]> = new Map();
	private startTime = 0;

	// ── Rate Limiter ────────────────────────────────────────────────────
	/** Per-IP sliding window: maps IP to array of request timestamps. */
	private rateLimitMap = new Map<string, number[]>();
	/** Handle for the periodic stale-entry cleanup timer. */
	private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

	// ── WebSocket ──────────────────────────────────────────────────────
	/** WebSocket server instance. Available after start() if ws config is set. */
	ws: WebSocketServer | null = null;

	constructor(private config: ServerConfig = {}) {}

	/**
	 * Register a route handler.
	 *
	 * Pattern supports `:params` for path parameters:
	 * ```ts
	 * server.route("GET", "/api/sessions/:id", handler);
	 * ```
	 */
	route(method: string, pattern: string, handler: RouteHandler): void {
		const upper = method.toUpperCase();
		if (!this.routes.has(upper)) {
			this.routes.set(upper, []);
		}
		const segments = pattern.split("/").filter(Boolean);
		this.routes.get(upper)!.push({ pattern, segments, handler });
	}

	/** Start the server. Returns the actual port. */
	async start(): Promise<number> {
		if (this.server) {
			throw new Error("Server is already running");
		}

		const port = this.config.port ?? DEFAULT_PORT;
		const host = this.config.host ?? DEFAULT_HOST;
		const corsConfig = this.config.corsOrigin;
		const maxBody = this.config.maxBodySize ?? DEFAULT_MAX_BODY;
		const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT;
		const logging = this.config.enableLogging ?? false;
		const rateLimit = this.config.rateLimit ?? 60;
		const rateLimitWindowMs = this.config.rateLimitWindowMs ?? 60_000;
		const authToken = this.config.authToken;
		const apiKeys = this.config.apiKeys;
		const authConfig = this.config.auth;
		const dvarapalakaEnabled = Boolean(authConfig);
		const authEnabled = dvarapalakaEnabled || Boolean(authToken) || Boolean(apiKeys?.length);

		// Start periodic cleanup for stale rate-limit entries (every 60s)
		this.rateLimitCleanupTimer = setInterval(() => {
			const now = Date.now();
			for (const [ip, timestamps] of this.rateLimitMap) {
				const recent = timestamps.filter((t) => now - t <= rateLimitWindowMs);
				if (recent.length === 0) {
					this.rateLimitMap.delete(ip);
				} else {
					this.rateLimitMap.set(ip, recent);
				}
			}
		}, 60_000);

		this.server = http.createServer(async (req, res) => {
			const requestId = randomUUID();
			const startMs = Date.now();

			// ── CORS origin resolution ────────────────────────────────────
			// Determine allowed origin based on configuration:
			//   - corsOrigin === "*"  → explicit opt-in to wildcard (user override)
			//   - corsOrigin truthy   → user-specified single origin
			//   - otherwise           → default: only allow localhost origins
			const origin = req.headers.origin;
			let allowedOrigin = "";

			if (corsConfig === "*") {
				allowedOrigin = "*"; // explicit opt-in to wildcard
			} else if (corsConfig) {
				allowedOrigin = corsConfig; // user-specified origin
			} else if (origin) {
				// Default: only allow localhost
				const isLocalhost = DEFAULT_CORS_ORIGINS.some(
					(allowed) => origin.startsWith(allowed),
				);
				if (isLocalhost) {
					allowedOrigin = origin;
				}
			}

			// Set CORS and JSON headers on every response
			if (allowedOrigin) {
				res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
				// When reflecting the specific origin, add Vary: Origin so
				// caches/proxies do not serve the wrong CORS header.
				if (allowedOrigin !== "*") {
					res.setHeader("Vary", "Origin");
				}
			}
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Request-ID");
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			res.setHeader("X-Request-ID", requestId);

			// Handle CORS preflight
			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			// ── Rate limiting ────────────────────────────────────────────
			// Skip rate limiting for health check (mirrors auth skip).
			const ratePath = (req.url ?? "/").split("?")[0];
			const isHealthCheck = req.method === "GET" && ratePath === "/api/health";

			if (!isHealthCheck) {
				const clientIp =
					(req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
					req.socket.remoteAddress ??
					"unknown";

				const now = Date.now();
				const timestamps = this.rateLimitMap.get(clientIp) ?? [];
				// Prune timestamps outside the current window
				const recent = timestamps.filter((t) => now - t <= rateLimitWindowMs);
				recent.push(now);
				this.rateLimitMap.set(clientIp, recent);

				if (recent.length > rateLimit) {
					const retryAfterSec = Math.ceil(rateLimitWindowMs / 1000);
					res.setHeader("Retry-After", String(retryAfterSec));
					this.sendJSON(res, 429, {
						error: "Too Many Requests",
						retryAfter: retryAfterSec,
						requestId,
					});
					if (logging) {
						this.log(requestId, req.method ?? "?", ratePath, 429, Date.now() - startMs);
					}
					return;
				}
			}

			// ── Auth middleware (Dvarpalaka) ─────────────────────────────
			// Skip auth for GET /api/health (needed by Docker HEALTHCHECK).
			const rawPath = (req.url ?? "/").split("?")[0];
			let requestAuth: AuthContext | undefined;

			if (dvarapalakaEnabled && authConfig) {
				// New JWT + RBAC auth via Dvarpalaka middleware.
				// Build a bridge config that includes legacy fallback.
				const bridgeConfig: AuthMiddlewareConfig = {
					...authConfig,
					legacyAuthToken: authConfig.legacyAuthToken ?? authToken,
					legacyApiKeys: authConfig.legacyApiKeys ?? apiKeys,
				};

				const headers: Record<string, string | undefined> = {};
				for (const [key, val] of Object.entries(req.headers)) {
					if (typeof val === "string") headers[key] = val;
				}

				const authResult = await authenticateRequest(
					{ method: req.method ?? "GET", path: rawPath, headers },
					bridgeConfig,
				);

				if (!authResult) {
					this.sendJSON(res, 401, { error: "Unauthorized", requestId });
					if (logging) {
						this.log(requestId, req.method ?? "?", rawPath, 401, Date.now() - startMs);
					}
					return;
				}

				// RBAC authorization check
				if (!authorizeRoute(authResult, req.method ?? "GET", rawPath, bridgeConfig)) {
					this.sendJSON(res, 403, { error: "Forbidden: insufficient permissions", requestId });
					if (logging) {
						this.log(requestId, req.method ?? "?", rawPath, 403, Date.now() - startMs);
					}
					return;
				}

				requestAuth = authResult;
			} else if (authEnabled && !(req.method === "GET" && rawPath === "/api/health")) {
				// Legacy auth: single bearer token / API key check.
				const authHeader = req.headers["authorization"] ?? "";
				const apiKeyHeader = typeof req.headers["x-api-key"] === "string"
					? req.headers["x-api-key"]
					: "";

				let authenticated = false;

				const bearer = authHeader.startsWith("Bearer ")
					? authHeader.slice(7)
					: "";

				if (authToken && bearer === authToken) {
					authenticated = true;
				}

				if (!authenticated && apiKeys?.length) {
					const candidate = apiKeyHeader || bearer;
					if (candidate && apiKeys.includes(candidate)) {
						authenticated = true;
					}
				}

				if (!authenticated) {
					this.sendJSON(res, 401, { error: "Unauthorized" });
					if (logging) {
						this.log(requestId, req.method ?? "?", rawPath, 401, Date.now() - startMs);
					}
					return;
				}
			}

			try {
				const parsed = await this.parseRequest(req, requestId, maxBody);
				// Attach auth context if available
				if (requestAuth) {
					parsed.auth = requestAuth;
				}
				const match = this.matchRoute(parsed.method, parsed.path);

				if (!match) {
					this.sendJSON(res, 404, { error: "Not Found", path: parsed.path, requestId });
					if (logging) {
						this.log(requestId, parsed.method, parsed.path, 404, Date.now() - startMs);
					}
					return;
				}

				parsed.params = match.params;

				// Execute handler with timeout
				const response = await this.withTimeout(match.handler(parsed), timeoutMs);

				// Apply extra headers from handler
				if (response.headers) {
					for (const [key, val] of Object.entries(response.headers)) {
						res.setHeader(key, val);
					}
				}

				this.sendJSON(res, response.status, response.body);

				// ── Record metrics ────────────────────────────────────
				const durationMs = Date.now() - startMs;
				const durationSec = durationMs / 1000;
				defaultMetrics.httpRequestsTotal.inc(1, { method: parsed.method, path: parsed.path, status: String(response.status) });
				defaultMetrics.httpRequestDuration.observe(durationSec, { method: parsed.method, path: parsed.path });

				if (logging) {
					this.log(requestId, parsed.method, parsed.path, response.status, durationMs);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const status = message === "Request timeout" ? 408 : 500;
				this.sendJSON(res, status, { error: message, requestId });

				const durationMs = Date.now() - startMs;
				defaultMetrics.httpRequestsTotal.inc(1, { method: req.method ?? "?", path: req.url ?? "?", status: String(status) });
				defaultMetrics.httpRequestDuration.observe(durationMs / 1000, { method: req.method ?? "?", path: req.url ?? "?" });

				if (logging) {
					log.error(`Request failed: ${req.method ?? "?"} ${req.url ?? "?"}`, err instanceof Error ? err : undefined, { requestId, status, duration: durationMs });
				}
			}
		});

		this.server.timeout = timeoutMs;

		// ── Attach WebSocket server ─────────────────────────────────────
		if (this.config.ws) {
			this.ws = new WebSocketServer({
				authToken: this.config.ws.authToken ?? this.config.authToken,
				apiKeys: this.config.ws.apiKeys ?? this.config.apiKeys,
				pingInterval: this.config.ws.pingInterval,
				maxConnections: this.config.ws.maxConnections,
				enableLogging: this.config.ws.enableLogging ?? this.config.enableLogging,
				auth: this.config.ws.auth ?? this.config.auth,
			});
			this.ws.attach(this.server);
		}

		return new Promise<number>((resolve, reject) => {
			this.server!.listen(port, host, () => {
				this.startTime = Date.now();
				const addr = this.server!.address();
				const actualPort = (typeof addr === "object" && addr !== null) ? addr.port : port;
				resolve(actualPort);
			});
			this.server!.once("error", reject);
		});
	}

	/** Stop the server gracefully. */
	async stop(): Promise<void> {
		if (!this.server) return;

		// Clean up rate limiter
		if (this.rateLimitCleanupTimer) {
			clearInterval(this.rateLimitCleanupTimer);
			this.rateLimitCleanupTimer = null;
		}
		this.rateLimitMap.clear();

		// Shut down WebSocket server
		if (this.ws) {
			this.ws.shutdown();
			this.ws = null;
		}

		return new Promise<void>((resolve, reject) => {
			this.server!.close((err) => {
				this.server = null;
				this.startTime = 0;
				if (err) reject(err);
				else resolve();
			});
		});
	}

	/** Whether the server is currently running. */
	get isRunning(): boolean {
		return this.server !== null;
	}

	/** Server uptime in milliseconds. Returns 0 if not running. */
	get uptime(): number {
		return this.startTime > 0 ? Date.now() - this.startTime : 0;
	}

	// ─── Internal ────────────────────────────────────────────────────────

	private async parseRequest(
		req: http.IncomingMessage,
		requestId: string,
		maxBody: number,
	): Promise<ParsedRequest> {
		const rawUrl = req.url ?? "/";
		const url = new URL(rawUrl, `http://${req.headers.host ?? "localhost"}`);
		const method = (req.method ?? "GET").toUpperCase();
		const path = url.pathname;

		// Parse query string
		const query: Record<string, string> = {};
		for (const [key, val] of url.searchParams.entries()) {
			query[key] = val;
		}

		// Parse headers (already lowercased by Node)
		const headers: Record<string, string> = {};
		for (const [key, val] of Object.entries(req.headers)) {
			if (typeof val === "string") {
				headers[key] = val;
			}
		}

		// Parse body for methods that carry one
		let body: unknown = undefined;
		if (method === "POST" || method === "PUT" || method === "PATCH") {
			body = await this.readBody(req, maxBody);
		}

		return { method, path, params: {}, query, body, headers, requestId };
	}

	private readBody(req: http.IncomingMessage, maxSize: number): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			let size = 0;

			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > maxSize) {
					req.destroy();
					reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`));
					return;
				}
				chunks.push(chunk);
			});

			req.on("end", () => {
				if (size === 0) {
					resolve(undefined);
					return;
				}
				const raw = Buffer.concat(chunks).toString("utf-8");
				try {
					resolve(JSON.parse(raw));
				} catch {
					reject(new Error("Invalid JSON in request body"));
				}
			});

			req.on("error", reject);
		});
	}

	private matchRoute(
		method: string,
		path: string,
	): { handler: RouteHandler; params: Record<string, string> } | null {
		const routes = this.routes.get(method);
		if (!routes) return null;

		const pathSegments = path.split("/").filter(Boolean);

		for (const route of routes) {
			if (route.segments.length !== pathSegments.length) continue;

			const params: Record<string, string> = {};
			let matched = true;

			for (let i = 0; i < route.segments.length; i++) {
				const routeSeg = route.segments[i];
				const pathSeg = pathSegments[i];

				if (routeSeg.startsWith(":")) {
					// Path parameter — capture it
					params[routeSeg.slice(1)] = decodeURIComponent(pathSeg);
				} else if (routeSeg !== pathSeg) {
					matched = false;
					break;
				}
			}

			if (matched) {
				return { handler: route.handler, params };
			}
		}

		return null;
	}

	private sendJSON(res: http.ServerResponse, status: number, body: unknown): void {
		const json = JSON.stringify(body);
		res.writeHead(status);
		res.end(json);
	}

	private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Request timeout")), ms);
			promise
				.then((val) => { clearTimeout(timer); resolve(val); })
				.catch((err) => { clearTimeout(timer); reject(err); });
		});
	}

	private log(requestId: string, method: string, path: string, status: number, durationMs: number): void {
		log.info(`${method} ${path} ${status}`, { requestId, method, path, status, duration: durationMs });
	}
}

// ─── Pre-configured API Factory ──────────────────────────────────────────────

/**
 * Create a pre-configured server with all Chitragupta API routes.
 *
 * The `deps` object provides access to the CLI's runtime state,
 * injected from `main.ts` so the server does not own those objects.
 */
export function createChitraguptaAPI(deps: {
	getAgent: () => unknown;
	getSession: () => unknown;
	listSessions: () => unknown[];
	listProviders?: () => unknown[];
	listTools?: () => unknown[];
	prompt?: (message: string, onEvent?: (type: string, data: unknown) => void, signal?: AbortSignal) => Promise<string>;
	/** Lazy getter for VidyaOrchestrator (may not be initialized at mount time). */
	getVidyaOrchestrator?: () => unknown;
	/** Lazy getters for Phase 1 Self-Evolution modules (optional). */
	getVasanaEngine?: () => unknown;
	getNidraDaemon?: () => unknown;
	getVidhiEngine?: () => unknown;
	/** Lazy getters for Phase 2 Intelligence Layer modules (optional). */
	getTuriyaRouter?: () => unknown;
	getTriguna?: () => unknown;
	getRtaEngine?: () => unknown;
	getBuddhi?: () => unknown;
	getDatabase?: () => unknown;
	/** Lazy getters for Phase 3 Collaboration modules (optional). */
	getSamiti?: () => unknown;
	getSabhaEngine?: () => unknown;
	getLokapala?: () => unknown;
	getAkasha?: () => unknown;
	/** Lazy getters for Phase 4 Autonomy modules (optional). */
	getKartavyaEngine?: () => unknown;
	getKalaChakra?: () => unknown;
	getProjectPath?: () => string;
}, config?: ServerConfig): ChitraguptaServer {
	const server = new ChitraguptaServer(config);
	const version = "0.1.0";

	// ─── Job Queue ──────────────────────────────────────────────────
	const jobRunner = async (
		message: string,
		onEvent: (type: string, data: unknown) => void,
		signal: AbortSignal,
	): Promise<string> => {
		// Prefer the explicit prompt function, fall back to agent.run
		if (deps.prompt) {
			return deps.prompt(message, onEvent, signal);
		}
		const agent = deps.getAgent() as Record<string, unknown> | null;
		if (!agent || typeof agent.run !== "function") {
			throw new Error("Agent not available");
		}
		return (agent.run as (msg: string) => Promise<string>)(message);
	};

	const jobQueue = new JobQueue(jobRunner, config?.jobQueue);

	// ─── GET /api/health ─────────────────────────────────────────────
	server.route("GET", "/api/health", async () => ({
		status: 200,
		body: {
			status: "ok",
			version,
			uptime: server.uptime,
			timestamp: new Date().toISOString(),
		},
	}));

	// ─── GET /api/health/deep ───────────────────────────────────────
	server.route("GET", "/api/health/deep", async () => {
		try {
			const report = await healthChecker.getStatus();
			const httpStatus = report.status === "DOWN" ? 503 : 200;
			return { status: httpStatus, body: report };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Health check failed: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/metrics ───────────────────────────────────────────
	server.route("GET", "/api/metrics", async () => ({
		status: 200,
		body: metricsRegistry.collect(),
		headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
	}));

	// ─── GET /api/sessions ───────────────────────────────────────────
	server.route("GET", "/api/sessions", async () => {
		try {
			const sessions = deps.listSessions();
			return { status: 200, body: { sessions } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list sessions: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/sessions/:id ───────────────────────────────────────
	server.route("GET", "/api/sessions/:id", async (req) => {
		try {
			const session = deps.getSession();
			if (!session || (session as Record<string, unknown>).id !== req.params.id) {
				return { status: 404, body: { error: `Session not found: ${req.params.id}` } };
			}
			return { status: 200, body: { session } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get session: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/sessions ──────────────────────────────────────────
	server.route("POST", "/api/sessions", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const title = typeof body.title === "string" ? body.title : "API Session";
			// Delegate to caller — we expose the intent, not the implementation
			return {
				status: 201,
				body: {
					message: "Session creation requested",
					title,
					requestId: req.requestId,
				},
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to create session: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/chat ──────────────────────────────────────────────
	server.route("POST", "/api/chat", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const message = body.message;
			if (typeof message !== "string" || message.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'message' field in request body" } };
			}

			const agent = deps.getAgent() as Record<string, unknown> | null;
			if (!agent) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			// Call the agent's run method if available
			if (typeof agent.run === "function") {
				const result = await (agent.run as (msg: string) => Promise<unknown>)(message.trim());
				return { status: 200, body: { response: result, requestId: req.requestId } };
			}

			return { status: 501, body: { error: "Agent does not support run()" } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Chat error: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/providers ──────────────────────────────────────────
	server.route("GET", "/api/providers", async () => {
		try {
			const providers = deps.listProviders?.() ?? [];
			return { status: 200, body: { providers } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list providers: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/tools ──────────────────────────────────────────────
	server.route("GET", "/api/tools", async () => {
		try {
			const tools = deps.listTools?.() ?? [];
			return { status: 200, body: { tools } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list tools: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/agent/status ───────────────────────────────────────
	server.route("GET", "/api/agent/status", async () => {
		try {
			const agent = deps.getAgent() as Record<string, unknown> | null;
			if (!agent) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			return {
				status: 200,
				body: {
					initialized: true,
					model: agent.model ?? null,
					providerId: agent.providerId ?? null,
					tokenUsage: agent.tokenUsage ?? null,
				},
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get agent status: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/agent/reset ───────────────────────────────────────
	server.route("POST", "/api/agent/reset", async (req) => {
		try {
			const agent = deps.getAgent() as Record<string, unknown> | null;
			if (!agent) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			if (typeof agent.reset === "function") {
				(agent.reset as () => void)();
				return { status: 200, body: { message: "Agent state reset", requestId: req.requestId } };
			}

			return { status: 501, body: { error: "Agent does not support reset()" } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to reset agent: ${(err as Error).message}` },
			};
		}
	});

	// ═════════════════════════════════════════════════════════════════════
	// Karya — Async Job Queue Routes
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/jobs/stats ────────────────────────────────────────
	// NOTE: Registered before /api/jobs/:id so "stats" is not captured as :id.
	server.route("GET", "/api/jobs/stats", async () => {
		try {
			const stats = jobQueue.getStats();
			return { status: 200, body: stats };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get stats: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/jobs ─────────────────────────────────────────────
	server.route("POST", "/api/jobs", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const message = body.message;
			if (typeof message !== "string" || message.trim().length === 0) {
				return {
					status: 400,
					body: { error: "Missing or empty 'message' field in request body" },
				};
			}

			const metadata = (typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata))
				? body.metadata as Record<string, unknown>
				: undefined;

			const job = jobQueue.submit(message.trim(), metadata);
			return {
				status: 202,
				body: {
					jobId: job.id,
					status: job.status,
					createdAt: job.createdAt,
				},
			};
		} catch (err) {
			if (err instanceof QueueFullError) {
				return {
					status: 429,
					body: {
						error: err.message,
						maxQueueSize: err.maxQueueSize,
					},
				};
			}
			return {
				status: 500,
				body: { error: `Failed to submit job: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/jobs ──────────────────────────────────────────────
	server.route("GET", "/api/jobs", async (req) => {
		try {
			const statusFilter = req.query.status as JobStatus | undefined;
			const filter = statusFilter ? { status: statusFilter } : undefined;
			const jobs = jobQueue.listJobs(filter);

			// Return summaries without the full events array
			const summaries = jobs.map((j) => ({
				id: j.id,
				status: j.status,
				message: j.message,
				createdAt: j.createdAt,
				startedAt: j.startedAt,
				completedAt: j.completedAt,
				eventCount: j.events.length,
				hasResponse: j.response !== undefined,
				hasError: j.error !== undefined,
				metadata: j.metadata,
			}));

			return { status: 200, body: { jobs: summaries } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list jobs: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/jobs/:id ──────────────────────────────────────────
	server.route("GET", "/api/jobs/:id", async (req) => {
		try {
			const job = jobQueue.getJob(req.params.id);
			if (!job) {
				return { status: 404, body: { error: `Job not found: ${req.params.id}` } };
			}

			const includeEvents = req.query.events !== "false";
			const result: Record<string, unknown> = {
				id: job.id,
				status: job.status,
				message: job.message,
				response: job.response,
				error: job.error,
				createdAt: job.createdAt,
				startedAt: job.startedAt,
				completedAt: job.completedAt,
				cost: job.cost,
				tokens: job.tokens,
				metadata: job.metadata,
			};

			if (includeEvents) {
				result.events = job.events;
			} else {
				result.eventCount = job.events.length;
			}

			return { status: 200, body: result };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get job: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/jobs/:id/cancel ──────────────────────────────────
	server.route("POST", "/api/jobs/:id/cancel", async (req) => {
		try {
			const job = jobQueue.getJob(req.params.id);
			if (!job) {
				return { status: 404, body: { error: `Job not found: ${req.params.id}` } };
			}

			const cancelled = jobQueue.cancelJob(req.params.id);
			if (!cancelled) {
				return {
					status: 409,
					body: {
						error: `Cannot cancel job in '${job.status}' state`,
						jobId: job.id,
						status: job.status,
					},
				};
			}

			return {
				status: 200,
				body: { jobId: job.id, status: "cancelled" },
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to cancel job: ${(err as Error).message}` },
			};
		}
	});

	// ═════════════════════════════════════════════════════════════════════
	// Memory CRUD API (Smriti Dvaara)
	// ═════════════════════════════════════════════════════════════════════

	// ─── GET /api/memory/scopes ─────────────────────────────────────
	server.route("GET", "/api/memory/scopes", async () => {
		try {
			const scopes = listAllScopes();
			return { status: 200, body: { scopes } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list memory scopes: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/memory/search ────────────────────────────────────
	// Registered before :scope routes so "/api/memory/search" is not
	// captured by the :scope parameter.
	server.route("POST", "/api/memory/search", async (req) => {
		try {
			const body = (req.body ?? {}) as Record<string, unknown>;
			const query = body.query;
			if (typeof query !== "string" || query.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'query' field in request body" } };
			}

			const limit = typeof body.limit === "number" && body.limit > 0
				? Math.floor(body.limit)
				: 20;

			const raw = searchMemory(query.trim());
			const results = raw.slice(0, limit).map((r) => ({
				content: r.content,
				score: r.relevance ?? 0,
				source: r.scope.type,
			}));

			return { status: 200, body: { results } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Memory search failed: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/memory/:scope ─────────────────────────────────────
	server.route("GET", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);

			if (!scope) {
				const isSession = scopeStr.startsWith("session:");
				const msg = isSession
					? "Session-scoped memory is accessed via the session API, not /api/memory"
					: `Invalid scope format: "${scopeStr}". Use "global", "project:<path>", or "agent:<id>"`;
				return { status: 400, body: { error: msg } };
			}

			const entry = getMemoryEntry(scope);
			return { status: 200, body: entry };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get memory: ${(err as Error).message}` },
			};
		}
	});

	// ─── PUT /api/memory/:scope ─────────────────────────────────────
	server.route("PUT", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);

			if (!scope) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}

			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.content !== "string") {
				return { status: 400, body: { error: "Missing 'content' field in request body (must be a string)" } };
			}

			await updateMemory(scope, body.content);
			const timestamp = new Date().toISOString();

			return {
				status: 200,
				body: { scope: scopeStr, message: "Memory updated", timestamp },
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to update memory: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/memory/:scope ────────────────────────────────────
	server.route("POST", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);

			if (!scope) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}

			const body = (req.body ?? {}) as Record<string, unknown>;
			if (typeof body.entry !== "string" || body.entry.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'entry' field in request body" } };
			}

			await appendMemory(scope, body.entry.trim());
			const timestamp = new Date().toISOString();

			return {
				status: 200,
				body: { scope: scopeStr, message: "Entry appended", timestamp },
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to append memory: ${(err as Error).message}` },
			};
		}
	});

	// ─── DELETE /api/memory/:scope ──────────────────────────────────
	server.route("DELETE", "/api/memory/:scope", async (req) => {
		try {
			const scopeStr = req.params.scope;
			const scope = parseScopeParam(scopeStr);

			if (!scope) {
				return { status: 400, body: { error: `Invalid scope format: "${scopeStr}"` } };
			}

			// Check existence before deleting so we can 404 on missing
			const entry = getMemoryEntry(scope);
			if (!entry.exists) {
				return { status: 404, body: { error: `Memory not found for scope: "${scopeStr}"` } };
			}

			deleteMemory(scope);
			return { status: 200, body: { scope: scopeStr, message: "Memory deleted" } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to delete memory: ${(err as Error).message}` },
			};
		}
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Agent Tree API
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Helper: resolve the root Agent from deps.getAgent().
	 * Returns null if the agent is not initialized.
	 */
	const getRootAgent = (): Agent | null => {
		const raw = deps.getAgent();
		if (!raw) return null;
		// The agent must have the tree API methods to qualify
		if (typeof (raw as Agent).getRoot !== "function") return null;
		return raw as Agent;
	};

	// ─── GET /api/agents/tree — Full tree from root ─────────────────
	// Registered BEFORE /api/agents/:id so the router does not capture
	// "tree" as an :id parameter.
	server.route("GET", "/api/agents/tree", async () => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}
			return { status: 200, body: { tree: serializeTree(root.getRoot()) } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get agent tree: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/agents/stats — Aggregate statistics ───────────────
	server.route("GET", "/api/agents/stats", async () => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}
			return { status: 200, body: computeAgentStats(root) };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to compute agent stats: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/agents — List all agents (flat) ───────────────────
	server.route("GET", "/api/agents", async (req) => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			let agents = listAllAgents(root);

			// Optional status filter
			const statusFilter = req.query.status;
			if (statusFilter) {
				agents = agents.filter((a) => a.status === statusFilter);
			}

			return { status: 200, body: { agents } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to list agents: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/agents/:id/tree — Subtree rooted at agent ─────────
	// Registered BEFORE /api/agents/:id so the 3-segment pattern
	// matches before the 2-segment one.
	server.route("GET", "/api/agents/:id/tree", async (req) => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			const agent = findAgentById(root, req.params.id);
			if (!agent) {
				return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			}

			return { status: 200, body: { tree: serializeTree(agent) } };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get agent subtree: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/agents/:id/spawn — Spawn a sub-agent ─────────────
	server.route("POST", "/api/agents/:id/spawn", async (req) => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			const parent = findAgentById(root, req.params.id);
			if (!parent) {
				return { status: 404, body: { error: `Parent agent not found: ${req.params.id}` } };
			}

			const body = (req.body ?? {}) as Record<string, unknown>;
			const purpose = body.purpose;
			if (typeof purpose !== "string" || purpose.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'purpose' field in request body" } };
			}

			const spawnConfig: Record<string, unknown> = { purpose: purpose.trim() };
			if (typeof body.model === "string") spawnConfig.model = body.model;

			try {
				const child = parent.spawn(spawnConfig as unknown as import("@chitragupta/anina").SpawnConfig);
				return { status: 201, body: { agent: serializeAgent(child) } };
			} catch (spawnErr) {
				const msg = (spawnErr as Error).message;
				// Agent.spawn() throws on max depth / max children violations
				if (msg.includes("Cannot spawn")) {
					return { status: 409, body: { error: msg } };
				}
				throw spawnErr;
			}
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to spawn agent: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/agents/:id/abort — Abort an agent and children ───
	server.route("POST", "/api/agents/:id/abort", async (req) => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			const agent = findAgentById(root, req.params.id);
			if (!agent) {
				return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			}

			const currentStatus = agent.getStatus();
			if (currentStatus === "completed" || currentStatus === "aborted") {
				return {
					status: 409,
					body: { error: `Agent is already ${currentStatus}`, agentId: agent.id },
				};
			}

			const childrenCount = countDescendants(agent);
			agent.abort();

			return {
				status: 200,
				body: {
					agentId: agent.id,
					status: "aborted",
					childrenAborted: childrenCount,
				},
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to abort agent: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/agents/:id/prompt — Send prompt to specific agent ─
	server.route("POST", "/api/agents/:id/prompt", async (req) => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			const agent = findAgentById(root, req.params.id);
			if (!agent) {
				return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			}

			const body = (req.body ?? {}) as Record<string, unknown>;
			const message = body.message;
			if (typeof message !== "string" || message.trim().length === 0) {
				return { status: 400, body: { error: "Missing or empty 'message' field in request body" } };
			}

			const result = await agent.prompt(message.trim());
			// Extract text from the AgentMessage content parts
			const text = result.content
				.filter((p): p is { type: "text"; text: string } => p.type === "text")
				.map((p) => p.text)
				.join("");

			return {
				status: 200,
				body: { response: text, agentId: agent.id, requestId: req.requestId },
			};
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to prompt agent: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/agents/:id — Get specific agent details ───────────
	// Registered LAST among /api/agents/* so more specific routes match first.
	server.route("GET", "/api/agents/:id", async (req) => {
		try {
			const root = getRootAgent();
			if (!root) {
				return { status: 503, body: { error: "Agent not initialized" } };
			}

			const agent = findAgentById(root, req.params.id);
			if (!agent) {
				return { status: 404, body: { error: `Agent not found: ${req.params.id}` } };
			}

			return { status: 200, body: serializeAgentDetail(agent) };
		} catch (err) {
			return {
				status: 500,
				body: { error: `Failed to get agent: ${(err as Error).message}` },
			};
		}
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Auth API (Dvarpalaka Routes)
	// ═══════════════════════════════════════════════════════════════════════

	// ─── POST /api/auth/token — OAuth token exchange ────────────────
	server.route("POST", "/api/auth/token", async (req) => {
		if (!config?.tokenExchange) {
			return { status: 501, body: { error: "Token exchange not configured" } };
		}
		try {
			return await handleTokenExchange(req.body, config.tokenExchange);
		} catch (err) {
			return {
				status: 500,
				body: { error: `Token exchange failed: ${(err as Error).message}` },
			};
		}
	});

	// ─── POST /api/auth/refresh — Refresh JWT ───────────────────────
	server.route("POST", "/api/auth/refresh", async (req) => {
		if (!config?.tokenExchange) {
			return { status: 501, body: { error: "Token exchange not configured" } };
		}
		try {
			return handleTokenRefresh(req.body, config.tokenExchange);
		} catch (err) {
			return {
				status: 500,
				body: { error: `Token refresh failed: ${(err as Error).message}` },
			};
		}
	});

	// ─── GET /api/auth/me — Current user info ───────────────────────
	server.route("GET", "/api/auth/me", async (req) => {
		try {
			return handleAuthMe(req.auth?.jwtPayload ?? null);
		} catch (err) {
			return {
				status: 500,
				body: { error: `Auth info failed: ${(err as Error).message}` },
			};
		}
	});

	// ─── Skill API routes (Vidya) ───────────────────────────────────
	if (deps.getVidyaOrchestrator) {
		const getOrch = deps.getVidyaOrchestrator;
		import("./routes/skills.js").then(({ mountSkillRoutes }) => {
			// mountSkillRoutes expects () => OrchestratorLike | undefined (duck-typed interface
			// defined in routes/skills.ts). getOrch is typed as () => unknown in deps but is
			// structurally compatible at runtime. Using `as any` to avoid repeating the full
			// OrchestratorLike interface signature here.
			mountSkillRoutes(server, getOrch as any);
		}).catch(() => {
			// Silently skip: skill routes are optional
		});
	}

	// ─── Evolution API routes (Phase 1 Self-Evolution) ────────────
	if (deps.getVasanaEngine || deps.getNidraDaemon || deps.getVidhiEngine) {
		import("./routes/evolution.js").then(({ mountEvolutionRoutes }) => {
			mountEvolutionRoutes(server, {
				getVasanaEngine: (deps.getVasanaEngine ?? (() => undefined)) as any,
				getNidraDaemon: (deps.getNidraDaemon ?? (() => undefined)) as any,
				getVidhiEngine: (deps.getVidhiEngine ?? (() => undefined)) as any,
				getProjectPath: deps.getProjectPath ?? (() => process.cwd()),
			});
		}).catch(() => {
			// Silently skip: evolution routes are optional
		});
	}

	// ─── Intelligence API routes (Phase 2 Intelligence Layer) ──────
	if (deps.getTuriyaRouter || deps.getTriguna || deps.getRtaEngine || deps.getBuddhi) {
		import("./routes/intelligence.js").then(({ mountIntelligenceRoutes }) => {
			mountIntelligenceRoutes(server, {
				getTuriyaRouter: (deps.getTuriyaRouter ?? (() => undefined)) as any,
				getTriguna: (deps.getTriguna ?? (() => undefined)) as any,
				getRtaEngine: (deps.getRtaEngine ?? (() => undefined)) as any,
				getBuddhi: (deps.getBuddhi ?? (() => undefined)) as any,
				getDatabase: (deps.getDatabase ?? (() => undefined)) as any,
				getProjectPath: deps.getProjectPath ?? (() => process.cwd()),
			});
		}).catch(() => {
			// Silently skip: intelligence routes are optional
		});
	}

	// ─── Workflow API routes (Phase 5.5 Vayu DAG) ──────────────────
	import("./routes/workflow.js").then(({ mountWorkflowRoutes }) => {
		mountWorkflowRoutes(server);
	}).catch(() => {
		// Silently skip: workflow routes are optional
	});

	// ─── Collaboration API routes (Phase 3 Multi-Agent) ────────────
	if (deps.getSamiti || deps.getSabhaEngine || deps.getLokapala || deps.getAkasha) {
		import("./routes/collaboration.js").then(({ mountCollaborationRoutes }) => {
			mountCollaborationRoutes(server, {
				getSamiti: (deps.getSamiti ?? (() => undefined)) as any,
				getSabhaEngine: (deps.getSabhaEngine ?? (() => undefined)) as any,
				getLokapala: (deps.getLokapala ?? (() => undefined)) as any,
				getAkasha: (deps.getAkasha ?? (() => undefined)) as any,
			});
		}).catch(() => {
			// Silently skip: collaboration routes are optional
		});
	}

	// ─── Autonomy API routes (Phase 4 Behavioral Autonomy) ─────────
	if (deps.getKartavyaEngine || deps.getKalaChakra) {
		import("./routes/autonomy.js").then(({ mountAutonomyRoutes }) => {
			mountAutonomyRoutes(server, {
				getKartavyaEngine: (deps.getKartavyaEngine ?? (() => undefined)) as any,
				getKalaChakra: (deps.getKalaChakra ?? (() => undefined)) as any,
				getProjectPath: deps.getProjectPath ?? (() => process.cwd()),
			});
		}).catch(() => {
			// Silently skip: autonomy routes are optional
		});
	}

	// ─── OpenAPI spec endpoint ──────────────────────────────────────
	import("./openapi.js").then(({ generateOpenAPISpec }) => {
		server.route("GET", "/api/openapi.json", async () => {
			try {
				const spec = generateOpenAPISpec(version);
				return { status: 200, body: spec };
			} catch (err) {
				return {
					status: 500,
					body: { error: `Failed to generate OpenAPI spec: ${(err as Error).message}` },
				};
			}
		});
	}).catch(() => {
		// Silently skip: openapi module is optional
	});

	// ─── WebSocket chat handler ─────────────────────────────────────
	// When a WebSocket "chat" message arrives, run the prompt and stream
	// events back to the client. The "abort" message cancels the running
	// request. This wiring is server-side only — the WebSocket itself is
	// attached in ChitraguptaServer.start() via config.ws.
	const activeAborts = new Map<string, AbortController>();

	const wireWebSocketEvents = () => {
		if (!server.ws) return;

		server.ws.events.onMessage = (client, msg) => {
			switch (msg.type) {
				case "chat": {
					const data = msg.data as { message?: string } | undefined;
					const message = data?.message;
					if (typeof message !== "string" || message.trim().length === 0) {
						client.send({
							type: "chat:error",
							data: { error: "Missing or empty 'message' in data" },
							requestId: msg.requestId,
						});
						return;
					}

					const requestId = msg.requestId ?? randomUUID();
					const ac = new AbortController();
					activeAborts.set(requestId, ac);

					client.send({ type: "chat:start", requestId });

					const onEvent = (type: string, eventData: unknown) => {
						const ed = eventData as Record<string, unknown>;
						switch (type) {
							case "stream:text":
								client.send({ type: "stream:text", data: ed.text, requestId });
								break;
							case "stream:thinking":
								client.send({ type: "stream:thinking", data: ed.text, requestId });
								break;
							case "tool:start":
								client.send({
									type: "tool:start",
									data: { name: ed.name, input: ed.input },
									requestId,
								});
								break;
							case "tool:done":
								client.send({
									type: "tool:done",
									data: { name: ed.name, result: ed.result },
									requestId,
								});
								break;
							default:
								if (server.ws) {
									server.ws.sendTo(client.id, type, eventData, requestId);
								}
								break;
						}
					};

					jobRunner(message.trim(), onEvent, ac.signal)
						.then((response) => {
							client.send({
								type: "chat:done",
								data: { response },
								requestId,
							});
						})
						.catch((err) => {
							const errorMsg = err instanceof Error ? err.message : String(err);
							client.send({
								type: "chat:error",
								data: { error: errorMsg },
								requestId,
							});
						})
						.finally(() => {
							activeAborts.delete(requestId);
						});

					break;
				}

				case "abort": {
					const requestId = msg.requestId;
					if (requestId && activeAborts.has(requestId)) {
						activeAborts.get(requestId)!.abort();
						activeAborts.delete(requestId);
						client.send({ type: "chat:aborted", requestId });
					} else {
						client.send({
							type: "error",
							data: { error: `No active request with id: ${requestId}` },
						});
					}
					break;
				}

				default:
					break;
			}
		};
	};

	// Wire WebSocket events after start() so the ws instance is available
	const originalStart = server.start.bind(server);
	server.start = async function () {
		const port = await originalStart();
		wireWebSocketEvents();
		return port;
	};

	return server;
}
