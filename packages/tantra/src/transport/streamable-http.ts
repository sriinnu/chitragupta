/**
 * @chitragupta/tantra — Streamable HTTP transport for MCP.
 *
 * Minimal streamable-HTTP surface:
 * - GET /mcp opens a server-to-client SSE stream and returns `mcp-session-id`
 * - POST /mcp sends a JSON-RPC request/notification and returns the response body
 * - DELETE /mcp closes a session
 *
 * This keeps the existing JSON-RPC server/client model while tightening the
 * outer transport away from the older split `/sse` + `/message` transport.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	McpAuthContext,
	McpMethodAuthorization,
	McpServerAuthConfig,
} from "../types.js";
import { parseMessage } from "../jsonrpc.js";
import { isLoopbackOrigin, type NormalizedServerAuth, normalizeServerAuth } from "./transport-auth.js";

export { StreamableHttpClientTransport } from "./streamable-http-client.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface StreamableHttpMessageContext {
	clientId?: string;
	auth?: McpAuthContext;
}

type MessageHandler = (msg: AnyMessage, context?: StreamableHttpMessageContext) => void;

interface StreamableHttpStartOptions {
	host?: string;
	allowedOrigins?: string[] | ((origin: string) => boolean);
}
interface RateLimitWindow {
	count: number;
	startedAt: number;
}

interface StreamSession {
	id: string;
	res: ServerResponse;
	auth?: McpAuthContext;
}

const SESSION_HEADER = "mcp-session-id";
const RESPONSE_TIMEOUT_MS = 30_000;

export class StreamableHttpServerTransport {
	private _server: Server | null = null;
	private _sessions = new Map<string, StreamSession>();
	private _handler: MessageHandler | null = null;
	private _allowedOrigins: string[] | ((origin: string) => boolean) | null = null;
	private _boundHost = "127.0.0.1";
	private _auth: NormalizedServerAuth | null = null;
	private _rateLimitWindows = new Map<string, RateLimitWindow>();
	private _pendingResponses = new Map<string, { res: ServerResponse; timer: ReturnType<typeof setTimeout> }>();

	constructor(auth?: McpServerAuthConfig) {
		this._auth = normalizeServerAuth(auth);
	}

	onMessage(handler: MessageHandler): void {
		this._handler = handler;
	}

	send(message: AnyMessage, clientId?: string): void {
		const responseId = "id" in message ? message.id : undefined;
		if (clientId && responseId !== undefined) {
			const key = this._pendingKey(clientId, responseId);
			const pending = this._pendingResponses.get(key);
			if (pending) {
				clearTimeout(pending.timer);
				this._pendingResponses.delete(key);
				pending.res.writeHead(200, {
					"Content-Type": "application/json",
					[SESSION_HEADER]: clientId,
				});
				pending.res.end(JSON.stringify(message));
				return;
			}
		}

		const data = JSON.stringify(message);
		const payload = `data: ${data}\n\n`;
		if (clientId) {
			const session = this._sessions.get(clientId);
			if (session) session.res.write(payload);
			return;
		}
		for (const session of this._sessions.values()) {
			session.res.write(payload);
		}
	}

	broadcast(message: AnyMessage): void {
		this.send(message);
	}

	start(port: number, options: StreamableHttpStartOptions = {}): Promise<void> {
		this._boundHost = options.host ?? "127.0.0.1";
		this._allowedOrigins = options.allowedOrigins ?? null;
		return new Promise((resolve, reject) => {
			this._server = createServer((req, res) => this._handleHttp(req, res));
			this._server.on("error", reject);
			this._server.listen(port, this._boundHost, () => resolve());
		});
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			for (const { timer, res } of this._pendingResponses.values()) {
				clearTimeout(timer);
				res.end();
			}
			this._pendingResponses.clear();
			for (const session of this._sessions.values()) {
				session.res.end();
			}
			this._sessions.clear();
			if (!this._server) {
				resolve();
				return;
			}
			this._server.close(() => {
				this._server = null;
				resolve();
			});
		});
	}

	private _handleHttp(req: IncomingMessage, res: ServerResponse): void {
		const origin = req.headers.origin;
		if (origin && !this._isOriginAllowed(origin)) {
			this._writeJsonError(res, 403, "Origin not allowed");
			return;
		}

		if (origin && this._isOriginAllowed(origin)) {
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Vary", "Origin");
		}
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
		res.setHeader(
			"Access-Control-Allow-Headers",
			this._auth
				? `Content-Type, ${this._auth.headerName}, ${SESSION_HEADER}`
				: `Content-Type, ${SESSION_HEADER}`,
		);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		if (url.pathname !== "/mcp") {
			this._writeJsonError(res, 404, "Not found");
			return;
		}

		if (req.method === "GET") {
			this._handleStream(req, res, url);
			return;
		}
		if (req.method === "POST") {
			this._handleMessage(req, res, url);
			return;
		}
		if (req.method === "DELETE") {
			this._handleDelete(req, res, url);
			return;
		}

		this._writeJsonError(res, 405, "Method not allowed");
	}

	private _handleStream(req: IncomingMessage, res: ServerResponse, url: URL): void {
		const auth = this._authenticate(req, url);
		if (!auth.ok) {
			this._writeJsonError(res, auth.statusCode, auth.error);
			return;
		}

		const requestedId = this._extractSessionId(req, url);
		const sessionId = requestedId || randomUUID();
		const existing = this._sessions.get(sessionId);
		if (existing) {
			existing.res.end();
			this._sessions.delete(sessionId);
		}

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			[SESSION_HEADER]: sessionId,
		});
		res.write(": connected\n\n");
		this._sessions.set(sessionId, { id: sessionId, res, auth: auth.context });
		res.on("close", () => {
			this._sessions.delete(sessionId);
		});
	}

	private _handleMessage(req: IncomingMessage, res: ServerResponse, url: URL): void {
		const auth = this._authenticate(req, url);
		if (!auth.ok) {
			this._writeJsonError(res, auth.statusCode, auth.error);
			return;
		}

		const sessionId = this._extractSessionId(req, url);
		if (!sessionId) {
			this._writeJsonError(res, 400, `Missing ${SESSION_HEADER}`);
			return;
		}
		const session = this._sessions.get(sessionId);
		if (!session) {
			this._writeJsonError(res, 404, "Unknown streamable HTTP session");
			return;
		}
		if (!this._isClientBoundToAuth(session, auth.context)) {
			this._writeJsonError(res, 403, "Session/token mismatch");
			return;
		}

		let body = "";
		req.setEncoding("utf-8");
		req.on("data", (chunk: string) => {
			body += chunk;
		});

		req.on("end", () => {
			const msg = parseMessage(body);
			if (!msg) {
				this._writeJsonError(res, 400, "Invalid JSON-RPC message");
				return;
			}

			const rateLimitError = this._consumeRateLimit(msg, auth.context);
			if (rateLimitError) {
				this._writeJsonError(res, 429, rateLimitError);
				return;
			}

			const authorization = this._authorizeMessage(msg, auth.context);
			if (!authorization.allowed) {
				this._writeJsonError(
					res,
					403,
					authorization.error ?? `Forbidden${authorization.requiredScope ? `: requires ${authorization.requiredScope}` : ""}`,
				);
				return;
			}

			if ("id" in msg) {
				const key = this._pendingKey(sessionId, msg.id);
				const timer = setTimeout(() => {
					this._pendingResponses.delete(key);
					if (!res.writableEnded) {
						this._writeJsonError(res, 504, "Streamable HTTP response timed out");
					}
				}, RESPONSE_TIMEOUT_MS);
				this._pendingResponses.set(key, { res, timer });
			} else {
				res.writeHead(202, {
					"Content-Type": "application/json",
					[SESSION_HEADER]: sessionId,
				});
				res.end(JSON.stringify({ accepted: true }));
			}

			if (this._handler) {
				this._handler(msg, { clientId: sessionId, auth: auth.context });
			}
		});
	}

	private _handleDelete(req: IncomingMessage, res: ServerResponse, url: URL): void {
		const sessionId = this._extractSessionId(req, url);
		if (!sessionId) {
			this._writeJsonError(res, 400, `Missing ${SESSION_HEADER}`);
			return;
		}
		const session = this._sessions.get(sessionId);
		if (session) {
			session.res.end();
			this._sessions.delete(sessionId);
		}
		res.writeHead(204);
		res.end();
	}

	private _pendingKey(sessionId: string, responseId: string | number): string {
		return `${sessionId}:${String(responseId)}`;
	}

	private _extractSessionId(req: IncomingMessage, url: URL): string {
		const rawHeader = req.headers[SESSION_HEADER];
		const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
		if (typeof headerValue === "string" && headerValue.trim()) return headerValue.trim();
		const queryValue = url.searchParams.get("sessionId");
		return typeof queryValue === "string" ? queryValue.trim() : "";
	}

	private _isOriginAllowed(origin: string): boolean {
		if (!origin) return true;
		if (typeof this._allowedOrigins === "function") return this._allowedOrigins(origin);
		if (Array.isArray(this._allowedOrigins)) return this._allowedOrigins.includes(origin);
		return isLoopbackOrigin(origin);
	}

	private _authenticate(req: IncomingMessage, url: URL): {
		ok: boolean;
		context?: McpAuthContext;
		statusCode: number;
		error?: string;
	} {
		if (!this._auth) return { ok: true, statusCode: 200 };
		const token = this._extractToken(req, url);
		if (!token) {
			if (!this._auth.required) return { ok: true, statusCode: 200 };
			return { ok: false, statusCode: 401, error: "Missing bridge token" };
		}
		const result = this._auth.validateToken(token);
		if (!result.authenticated) {
			return { ok: false, statusCode: 401, error: result.error ?? "Unauthorized" };
		}
		return {
			ok: true,
			statusCode: 200,
			context: {
				keyId: result.keyId,
				tenantId: result.tenantId,
				scopes: result.scopes ?? [],
			},
		};
	}

	private _extractToken(req: IncomingMessage, url: URL): string | null {
		if (!this._auth) return null;
		const headerValue = req.headers[this._auth.headerLookup];
		const rawHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
		if (typeof rawHeader === "string" && rawHeader.trim()) {
			const trimmed = rawHeader.trim();
			const bearerPrefix = `${this._auth.bearerPrefix} `;
			if (trimmed.startsWith(bearerPrefix)) {
				return trimmed.slice(bearerPrefix.length).trim();
			}
			return trimmed;
		}
		if (this._auth.allowQueryToken) {
			const token = url.searchParams.get(this._auth.queryParam);
			if (typeof token === "string" && token.trim()) {
				return token.trim();
			}
		}
		return null;
	}

	private _authorizeMessage(msg: AnyMessage, context?: McpAuthContext): McpMethodAuthorization {
		if (!this._auth?.authorizeMethod || !("method" in msg) || typeof msg.method !== "string") {
			return { allowed: true };
		}
		return this._auth.authorizeMethod(msg.method, context ?? { scopes: [] });
	}

	private _consumeRateLimit(msg: AnyMessage, context?: McpAuthContext): string | null {
		if (!this._auth?.rateLimit || !("method" in msg) || typeof msg.method !== "string") return null;
		const exemptMethods = new Set(this._auth.rateLimit.exemptMethods ?? []);
		if (exemptMethods.has(msg.method)) return null;
		const rateLimitKey = context?.keyId ?? context?.tenantId ?? "anonymous";
		const now = Date.now();
		const current = this._rateLimitWindows.get(rateLimitKey);
		if (!current || now - current.startedAt >= this._auth.rateLimit.windowMs) {
			this._rateLimitWindows.set(rateLimitKey, { count: 1, startedAt: now });
			return null;
		}
		if (current.count >= this._auth.rateLimit.maxRequests) return "Rate limit exceeded";
		current.count += 1;
		return null;
	}

	private _isClientBoundToAuth(session: StreamSession, context?: McpAuthContext): boolean {
		if (!session.auth || !context) return true;
		if (session.auth.keyId && context.keyId && session.auth.keyId !== context.keyId) return false;
		if (session.auth.tenantId && context.tenantId && session.auth.tenantId !== context.tenantId) return false;
		return true;
	}

	private _writeJsonError(res: ServerResponse, statusCode: number, error?: string): void {
		if (res.writableEnded) return;
		res.writeHead(statusCode, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: error ?? "Request failed" }));
	}
}

