/**
 * @chitragupta/tantra — Legacy HTTP+SSE transport for MCP.
 *
 * This is the older two-endpoint HTTP+SSE transport:
 * - GET /sse opens a server-to-client event stream
 * - POST /message sends client-to-server JSON-RPC
 *
 * It is not the newer streamable HTTP transport. The implementation keeps
 * the legacy surface available, but hardens it for production use with
 * loopback binding, origin validation, and per-client response routing.
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

export { SSEClientTransport } from "./sse-client.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
export interface SSEMessageContext {
	clientId?: string;
	auth?: McpAuthContext;
}

type MessageHandler = (msg: AnyMessage, context?: SSEMessageContext) => void;

interface SSEServerStartOptions {
	host?: string;
	allowedOrigins?: string[] | ((origin: string) => boolean);
}

interface RateLimitWindow {
	count: number;
	startedAt: number;
}

// ─── SSEServerTransport ─────────────────────────────────────────────────────

interface SSEClient {
	id: string;
	res: ServerResponse;
	auth?: McpAuthContext;
}

/**
 * Server-side SSE transport.
 *
 * Creates an HTTP server with two endpoints:
 * - POST /message -- receives JSON-RPC requests from clients.
 * - GET /sse -- sends JSON-RPC responses/notifications as SSE events.
 *
 * Supports multiple concurrent clients. Each SSE client is assigned
 * a unique ID on connection.
 */
export class SSEServerTransport {
	private _server: Server | null = null;
	private _clients: Map<string, SSEClient> = new Map();
	private _handler: MessageHandler | null = null;
	private _allowedOrigins: string[] | ((origin: string) => boolean) | null = null;
	private _boundHost = "127.0.0.1";
	private _auth: NormalizedServerAuth | null = null;
	private _rateLimitWindows: Map<string, RateLimitWindow> = new Map();

	constructor(auth?: McpServerAuthConfig) {
		this._auth = normalizeServerAuth(auth);
	}

	/**
	 * Register a handler for incoming messages.
	 *
	 * @param handler - Callback invoked for each parsed JSON-RPC message.
	 */
	onMessage(handler: MessageHandler): void {
		this._handler = handler;
	}

	/**
	 * Send a message to a specific client. If no clientId, sends to the first client.
	 *
	 * @param message - The JSON-RPC message to send.
	 * @param clientId - Optional target client ID. Falls back to the first connected client.
	 */
	send(message: AnyMessage, clientId?: string): void {
		const data = JSON.stringify(message);
		const ssePayload = `data: ${data}\n\n`;

		if (clientId) {
			const client = this._clients.get(clientId);
			if (client) {
				client.res.write(ssePayload);
			}
		} else {
			// Send to the first connected client
			const first = this._clients.values().next();
			if (!first.done) {
				first.value.res.write(ssePayload);
			}
		}
	}

	/**
	 * Broadcast a message to all connected SSE clients.
	 *
	 * @param message - The JSON-RPC message to broadcast.
	 */
	broadcast(message: AnyMessage): void {
		const data = JSON.stringify(message);
		const ssePayload = `data: ${data}\n\n`;

		for (const client of this._clients.values()) {
			client.res.write(ssePayload);
		}
	}

	/**
	 * Start the HTTP server on the given port.
	 *
	 * @param port - The port number to listen on.
	 * @returns A promise that resolves when the server is listening.
	 */
	start(port: number, options: SSEServerStartOptions = {}): Promise<void> {
		this._boundHost = options.host ?? "127.0.0.1";
		this._allowedOrigins = options.allowedOrigins ?? null;
		return new Promise((resolve, reject) => {
			this._server = createServer((req, res) => {
				this._handleHttp(req, res);
			});

			this._server.on("error", reject);
			this._server.listen(port, this._boundHost, () => {
				resolve();
			});
		});
	}

	/**
	 * Stop the HTTP server and close all SSE connections.
	 */
	stop(): Promise<void> {
		return new Promise((resolve) => {
			// Close all SSE connections
			for (const client of this._clients.values()) {
				client.res.end();
			}
			this._clients.clear();

			if (this._server) {
				this._server.close(() => {
					this._server = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * Route incoming HTTP requests to the appropriate handler.
	 */
	private _handleHttp(req: IncomingMessage, res: ServerResponse): void {
		const origin = req.headers.origin;
		if (origin && !this._isOriginAllowed(origin)) {
			res.writeHead(403, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Origin not allowed" }));
			return;
		}

		// CORS headers
		if (origin && this._isOriginAllowed(origin)) {
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Vary", "Origin");
		}
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader(
			"Access-Control-Allow-Headers",
			this._auth ? `Content-Type, ${this._auth.headerName}` : "Content-Type",
		);

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

		if (req.method === "GET" && url.pathname === "/sse") {
			this._handleSSE(req, res, url);
		} else if (req.method === "POST" && url.pathname === "/message") {
			this._handleMessage(req, res, url);
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	/**
	 * Handle GET /sse — establish an SSE connection.
	 */
	private _handleSSE(req: IncomingMessage, res: ServerResponse, url: URL): void {
		const auth = this._authenticate(req, url);
		if (!auth.ok) {
			this._writeJsonError(res, auth.statusCode, auth.error);
			return;
		}

		const clientId = randomUUID();

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
		});

		// Send the client their ID as the first event
		res.write(`event: endpoint\ndata: /message?clientId=${clientId}\n\n`);

		this._clients.set(clientId, { id: clientId, res, auth: auth.context });

		res.on("close", () => {
			this._clients.delete(clientId);
		});
	}

	/**
	 * Handle POST /message — receive a JSON-RPC message from a client.
	 */
	private _handleMessage(req: IncomingMessage, res: ServerResponse, url: URL): void {
		const auth = this._authenticate(req, url);
		if (!auth.ok) {
			this._writeJsonError(res, auth.statusCode, auth.error);
			return;
		}

		const clientId = url.searchParams.get("clientId");
		if (!clientId) {
			this._writeJsonError(res, 400, "Missing required clientId");
			return;
		}
		const client = this._clients.get(clientId);
		if (!client) {
			this._writeJsonError(res, 404, "Unknown SSE client");
			return;
		}
		if (!this._isClientBoundToAuth(client, auth.context)) {
			this._writeJsonError(res, 403, "Client/token mismatch");
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

			if (this._handler) {
				this._handler(msg, { clientId, auth: auth.context });
			}

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		});
	}

	private _isOriginAllowed(origin: string): boolean {
		if (!origin) return true;
		if (typeof this._allowedOrigins === "function") {
			return this._allowedOrigins(origin);
		}
		if (Array.isArray(this._allowedOrigins)) {
			return this._allowedOrigins.includes(origin);
		}
		return isLoopbackOrigin(origin);
	}

	private _authenticate(req: IncomingMessage, url: URL): {
		ok: boolean;
		context?: McpAuthContext;
		statusCode: number;
		error?: string;
	} {
		if (!this._auth) {
			return { ok: true, statusCode: 200 };
		}

		const token = this._extractToken(req, url);
		if (!token) {
			if (!this._auth.required) {
				return { ok: true, statusCode: 200 };
			}
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
		if (!this._auth?.rateLimit || !("method" in msg) || typeof msg.method !== "string") {
			return null;
		}

		const exemptMethods = new Set(this._auth.rateLimit.exemptMethods ?? []);
		if (exemptMethods.has(msg.method)) return null;

		const rateLimitKey = context?.keyId ?? context?.tenantId ?? "anonymous";
		const now = Date.now();
		const current = this._rateLimitWindows.get(rateLimitKey);
		if (!current || now - current.startedAt >= this._auth.rateLimit.windowMs) {
			this._rateLimitWindows.set(rateLimitKey, { count: 1, startedAt: now });
			return null;
		}

		if (current.count >= this._auth.rateLimit.maxRequests) {
			return "Rate limit exceeded";
		}

		current.count += 1;
		return null;
	}

	private _isClientBoundToAuth(client: SSEClient, context?: McpAuthContext): boolean {
		if (!client.auth || !context) return true;
		if (client.auth.keyId && context.keyId && client.auth.keyId !== context.keyId) return false;
		if (client.auth.tenantId && context.tenantId && client.auth.tenantId !== context.tenantId) return false;
		return true;
	}

	private _writeJsonError(res: ServerResponse, statusCode: number, error?: string): void {
		res.writeHead(statusCode, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: error ?? "Request failed" }));
	}
}

// ─── SSEClientTransport ─────────────────────────────────────────────────────

/**
 * Client-side SSE transport.
 *
 * Connects to an MCP server's SSE endpoint and sends requests via POST.
 * Implements auto-reconnect with exponential backoff (up to 10 attempts).
 */
