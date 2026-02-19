/**
 * Dvaara — HTTP API server for Chitragupta.
 * Sanskrit: Dvaara (द्वार) = gateway, door.
 *
 * Provides a REST API for external applications (like Vaayu AI assistant)
 * to interact with Chitragupta programmatically. Uses Node.js built-in
 * http module — no Express or other framework needed.
 *
 * Route handlers are mounted by {@link createChitraguptaAPI} in http-api.ts.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "./ws-handler.js";
import {
	createLogger,
	MetricsRegistry,
	registerDefaultMetrics,
	authenticateRequest,
	authorizeRoute,
} from "@chitragupta/core";
import type { AuthMiddlewareConfig, AuthContext } from "@chitragupta/core";
import type { ServerConfig, RouteHandler, ParsedRequest, RegisteredRoute } from "./http-server-types.js";

// Re-export types and factory for backward compatibility
export type { ServerConfig, RouteHandler, ParsedRequest, RouteResponse } from "./http-server-types.js";
export { createChitraguptaAPI } from "./http-api.js";

const log = createLogger("http-server");
const metricsRegistry = new MetricsRegistry();
const defaultMetrics = registerDefaultMetrics(metricsRegistry);

const DEFAULT_PORT = 3141;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_BODY = 1_048_576;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CORS_ORIGINS = [
	"http://localhost", "http://127.0.0.1",
	"https://localhost", "https://127.0.0.1",
];

/**
 * Lightweight HTTP server with route-matching, CORS, rate limiting, and auth.
 */
export class ChitraguptaServer {
	private server: http.Server | null = null;
	private routes: Map<string, RegisteredRoute[]> = new Map();
	private startTime = 0;
	private rateLimitMap = new Map<string, number[]>();
	private rateLimitCleanupTimer: ReturnType<typeof setInterval> | null = null;

	/** WebSocket server instance. Available after start() if ws config is set. */
	ws: WebSocketServer | null = null;

	constructor(private config: ServerConfig = {}) {}

	/**
	 * Register a route handler. Pattern supports `:params` for path parameters.
	 */
	route(method: string, pattern: string, handler: RouteHandler): void {
		const upper = method.toUpperCase();
		if (!this.routes.has(upper)) this.routes.set(upper, []);
		const segments = pattern.split("/").filter(Boolean);
		this.routes.get(upper)!.push({ pattern, segments, handler });
	}

	/** Start the server. Returns the actual port. */
	async start(): Promise<number> {
		if (this.server) throw new Error("Server is already running");

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

		this.rateLimitCleanupTimer = setInterval(() => {
			const now = Date.now();
			for (const [ip, timestamps] of this.rateLimitMap) {
				const recent = timestamps.filter((t) => now - t <= rateLimitWindowMs);
				if (recent.length === 0) this.rateLimitMap.delete(ip);
				else this.rateLimitMap.set(ip, recent);
			}
		}, 60_000);

		this.server = http.createServer(async (req, res) => {
			const requestId = randomUUID();
			const startMs = Date.now();
			const allowedOrigin = this.resolveCorsOrigin(req.headers.origin, corsConfig);

			if (allowedOrigin) {
				res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
				if (allowedOrigin !== "*") res.setHeader("Vary", "Origin");
			}
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Request-ID");
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			res.setHeader("X-Request-ID", requestId);

			if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

			const rawPath = (req.url ?? "/").split("?")[0];
			const isHealthCheck = req.method === "GET" && rawPath === "/api/health";

			// Rate limiting (skip health check)
			if (!isHealthCheck && this.isRateLimited(req, rateLimit, rateLimitWindowMs)) {
				const retryAfterSec = Math.ceil(rateLimitWindowMs / 1000);
				res.setHeader("Retry-After", String(retryAfterSec));
				this.sendJSON(res, 429, { error: "Too Many Requests", retryAfter: retryAfterSec, requestId });
				if (logging) this.log(requestId, req.method ?? "?", rawPath, 429, Date.now() - startMs);
				return;
			}

			// Auth middleware
			const authResult = await this.authenticate(
				req, rawPath, isHealthCheck, authEnabled, dvarapalakaEnabled,
				authConfig, authToken, apiKeys,
			);
			if (authResult === false) {
				this.sendJSON(res, 401, { error: "Unauthorized", requestId });
				if (logging) this.log(requestId, req.method ?? "?", rawPath, 401, Date.now() - startMs);
				return;
			}
			if (authResult === "forbidden") {
				this.sendJSON(res, 403, { error: "Forbidden: insufficient permissions", requestId });
				if (logging) this.log(requestId, req.method ?? "?", rawPath, 403, Date.now() - startMs);
				return;
			}

			try {
				const parsed = await this.parseRequest(req, requestId, maxBody);
				if (typeof authResult === "object") parsed.auth = authResult;
				const match = this.matchRoute(parsed.method, parsed.path);
				if (!match) {
					this.sendJSON(res, 404, { error: "Not Found", path: parsed.path, requestId });
					if (logging) this.log(requestId, parsed.method, parsed.path, 404, Date.now() - startMs);
					return;
				}
				parsed.params = match.params;
				const response = await this.withTimeout(match.handler(parsed), timeoutMs);
				if (response.headers) {
					for (const [key, val] of Object.entries(response.headers)) res.setHeader(key, val);
				}
				this.sendJSON(res, response.status, response.body);
				const durationMs = Date.now() - startMs;
				defaultMetrics.httpRequestsTotal.inc(1, { method: parsed.method, path: parsed.path, status: String(response.status) });
				defaultMetrics.httpRequestDuration.observe(durationMs / 1000, { method: parsed.method, path: parsed.path });
				if (logging) this.log(requestId, parsed.method, parsed.path, response.status, durationMs);
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
				resolve((typeof addr === "object" && addr !== null) ? addr.port : port);
			});
			this.server!.once("error", reject);
		});
	}

	/** Stop the server gracefully. */
	async stop(): Promise<void> {
		if (!this.server) return;
		if (this.rateLimitCleanupTimer) {
			clearInterval(this.rateLimitCleanupTimer);
			this.rateLimitCleanupTimer = null;
		}
		this.rateLimitMap.clear();
		if (this.ws) { this.ws.shutdown(); this.ws = null; }
		return new Promise<void>((resolve, reject) => {
			this.server!.close((err) => {
				this.server = null;
				this.startTime = 0;
				if (err) reject(err); else resolve();
			});
		});
	}

	/** Whether the server is currently running. */
	get isRunning(): boolean { return this.server !== null; }

	/** Server uptime in milliseconds. Returns 0 if not running. */
	get uptime(): number { return this.startTime > 0 ? Date.now() - this.startTime : 0; }

	// ── Private helpers ─────────────────────────────────────────────────

	private resolveCorsOrigin(origin: string | undefined, corsConfig: string | undefined): string {
		if (corsConfig === "*") return "*";
		if (corsConfig) return corsConfig;
		if (origin && DEFAULT_CORS_ORIGINS.some((a) => origin.startsWith(a))) return origin;
		return "";
	}

	private isRateLimited(req: http.IncomingMessage, limit: number, windowMs: number): boolean {
		const clientIp =
			(req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
			req.socket.remoteAddress ?? "unknown";
		const now = Date.now();
		const timestamps = this.rateLimitMap.get(clientIp) ?? [];
		const recent = timestamps.filter((t) => now - t <= windowMs);
		recent.push(now);
		this.rateLimitMap.set(clientIp, recent);
		return recent.length > limit;
	}

	private async authenticate(
		req: http.IncomingMessage, rawPath: string, isHealthCheck: boolean,
		authEnabled: boolean, dvarapalakaEnabled: boolean,
		authConfig?: AuthMiddlewareConfig, authToken?: string, apiKeys?: string[],
	): Promise<AuthContext | false | "forbidden" | true> {
		if (dvarapalakaEnabled && authConfig) {
			const bridgeConfig: AuthMiddlewareConfig = {
				...authConfig,
				legacyAuthToken: authConfig.legacyAuthToken ?? authToken,
				legacyApiKeys: authConfig.legacyApiKeys ?? apiKeys,
			};
			const headers: Record<string, string | undefined> = {};
			for (const [key, val] of Object.entries(req.headers)) {
				if (typeof val === "string") headers[key] = val;
			}
			const result = await authenticateRequest(
				{ method: req.method ?? "GET", path: rawPath, headers }, bridgeConfig,
			);
			if (!result) return false;
			if (!authorizeRoute(result, req.method ?? "GET", rawPath, bridgeConfig)) return "forbidden";
			return result;
		}
		if (authEnabled && !isHealthCheck) {
			const authHeader = req.headers["authorization"] ?? "";
			const apiKeyHeader = typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : "";
			const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
			if (authToken && bearer === authToken) return true;
			if (apiKeys?.length) {
				const candidate = apiKeyHeader || bearer;
				if (candidate && apiKeys.includes(candidate)) return true;
			}
			return false;
		}
		return true;
	}

	private async parseRequest(req: http.IncomingMessage, requestId: string, maxBody: number): Promise<ParsedRequest> {
		const rawUrl = req.url ?? "/";
		const url = new URL(rawUrl, `http://${req.headers.host ?? "localhost"}`);
		const method = (req.method ?? "GET").toUpperCase();
		const path = url.pathname;
		const query: Record<string, string> = {};
		for (const [key, val] of url.searchParams.entries()) query[key] = val;
		const headers: Record<string, string> = {};
		for (const [key, val] of Object.entries(req.headers)) {
			if (typeof val === "string") headers[key] = val;
		}
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
				if (size > maxSize) { req.destroy(); reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`)); return; }
				chunks.push(chunk);
			});
			req.on("end", () => {
				if (size === 0) { resolve(undefined); return; }
				const raw = Buffer.concat(chunks).toString("utf-8");
				try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON in request body")); }
			});
			req.on("error", reject);
		});
	}

	private matchRoute(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | null {
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
				if (routeSeg.startsWith(":")) params[routeSeg.slice(1)] = decodeURIComponent(pathSeg);
				else if (routeSeg !== pathSeg) { matched = false; break; }
			}
			if (matched) return { handler: route.handler, params };
		}
		return null;
	}

	private sendJSON(res: http.ServerResponse, status: number, body: unknown): void {
		res.writeHead(status); res.end(JSON.stringify(body));
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
