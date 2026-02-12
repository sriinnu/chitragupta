/**
 * @chitragupta/tantra — Server-Sent Events (SSE) transport for MCP.
 *
 * SSEServerTransport creates an HTTP server with POST /message and GET /sse endpoints.
 * SSEClientTransport connects to an SSE endpoint and sends requests via POST.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../types.js";
import { parseMessage } from "../jsonrpc.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
type MessageHandler = (msg: AnyMessage) => void;

// ─── SSEServerTransport ─────────────────────────────────────────────────────

interface SSEClient {
	id: string;
	res: ServerResponse;
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
	start(port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			this._server = createServer((req, res) => {
				this._handleHttp(req, res);
			});

			this._server.on("error", reject);
			this._server.listen(port, () => {
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
		// CORS headers
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

		if (req.method === "GET" && url.pathname === "/sse") {
			this._handleSSE(req, res);
		} else if (req.method === "POST" && url.pathname === "/message") {
			this._handleMessage(req, res);
		} else {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		}
	}

	/**
	 * Handle GET /sse — establish an SSE connection.
	 */
	private _handleSSE(_req: IncomingMessage, res: ServerResponse): void {
		const clientId = randomUUID();

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
		});

		// Send the client their ID as the first event
		res.write(`event: endpoint\ndata: /message?clientId=${clientId}\n\n`);

		this._clients.set(clientId, { id: clientId, res });

		res.on("close", () => {
			this._clients.delete(clientId);
		});
	}

	/**
	 * Handle POST /message — receive a JSON-RPC message from a client.
	 */
	private _handleMessage(req: IncomingMessage, res: ServerResponse): void {
		let body = "";

		req.setEncoding("utf-8");
		req.on("data", (chunk: string) => {
			body += chunk;
		});

		req.on("end", () => {
			const msg = parseMessage(body);
			if (!msg) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid JSON-RPC message" }));
				return;
			}

			if (this._handler) {
				this._handler(msg);
			}

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		});
	}
}

// ─── SSEClientTransport ─────────────────────────────────────────────────────

/**
 * Client-side SSE transport.
 *
 * Connects to an MCP server's SSE endpoint and sends requests via POST.
 * Implements auto-reconnect with exponential backoff (up to 10 attempts).
 */
export class SSEClientTransport {
	private _handler: MessageHandler | null = null;
	private _baseUrl = "";
	private _messageEndpoint = "";
	private _connected = false;
	private _abortController: AbortController | null = null;
	private _reconnectAttempts = 0;
	private _maxReconnectAttempts = 10;
	private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Register a handler for incoming messages from the server.
	 *
	 * @param handler - Callback invoked for each parsed JSON-RPC message.
	 */
	onMessage(handler: MessageHandler): void {
		this._handler = handler;
	}

	/**
	 * Send a JSON-RPC message to the server via POST.
	 *
	 * @param message - The JSON-RPC message to send.
	 * @returns A promise that resolves on successful delivery.
	 * @throws If not connected or the POST fails.
	 */
	send(message: AnyMessage): Promise<void> {
		if (!this._connected || !this._messageEndpoint) {
			return Promise.reject(new Error("SSEClientTransport: not connected"));
		}

		const body = JSON.stringify(message);
		const url = new URL(this._messageEndpoint, this._baseUrl);
		const isHttps = url.protocol === "https:";
		const doRequest = isHttps ? httpsRequest : httpRequest;

		return new Promise((resolve, reject) => {
			const req = doRequest(
				url,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(body),
					},
				},
				(res) => {
					// Consume response
					res.resume();
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						resolve();
					} else {
						reject(new Error(`SSEClientTransport: POST failed with status ${res.statusCode}`));
					}
				},
			);

			req.on("error", reject);
			req.setTimeout(30_000, () => {
				req.destroy(new Error("SSEClientTransport: POST timed out after 30s"));
			});
			req.write(body);
			req.end();
		});
	}

	/**
	 * Connect to the SSE endpoint.
	 *
	 * @param url - The base URL of the MCP server (e.g., "http://localhost:3001").
	 * @returns A promise that resolves when the SSE connection is established.
	 */
	connect(url: string): Promise<void> {
		this._baseUrl = url;
		this._reconnectAttempts = 0;

		return this._doConnect();
	}

	/**
	 * Disconnect from the SSE endpoint.
	 */
	disconnect(): void {
		this._connected = false;
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = null;
		}
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
		}
	}

	/**
	 * Internal: establish the SSE connection.
	 */
	private _doConnect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const sseUrl = new URL("/sse", this._baseUrl);
			const isHttps = sseUrl.protocol === "https:";
			const doRequest = isHttps ? httpsRequest : httpRequest;

			this._abortController = new AbortController();

			const req = doRequest(
				sseUrl,
				{
					method: "GET",
					headers: { Accept: "text/event-stream" },
				},
				(res) => {
					if (res.statusCode !== 200) {
						reject(new Error(`SSEClientTransport: SSE connect failed with status ${res.statusCode}`));
						return;
					}

					this._connected = true;
					this._reconnectAttempts = 0;
					let buffer = "";

					res.setEncoding("utf-8");
					res.on("data", (chunk: string) => {
						buffer += chunk;
						// Parse SSE events from buffer
						const events = buffer.split("\n\n");
						buffer = events.pop() ?? "";

						for (const event of events) {
							this._parseSSEEvent(event);
						}
					});

					res.on("end", () => {
						this._connected = false;
						this._scheduleReconnect();
					});

					res.on("error", () => {
						this._connected = false;
						this._scheduleReconnect();
					});

					resolve();
				},
			);

			req.on("error", (err) => {
				if (this._reconnectAttempts === 0) {
					reject(err);
				} else {
					this._scheduleReconnect();
				}
			});

			req.end();
		});
	}

	/**
	 * Parse an SSE event string and dispatch the message.
	 */
	private _parseSSEEvent(event: string): void {
		const lines = event.split("\n");
		let eventType = "";
		let data = "";

		for (const line of lines) {
			if (line.startsWith("event:")) {
				eventType = line.slice(6).trim();
			} else if (line.startsWith("data:")) {
				data += (data ? "\n" : "") + line.slice(5).trim();
			}
		}

		if (eventType === "endpoint" && data) {
			// Store the message endpoint
			this._messageEndpoint = data;
			return;
		}

		if (data) {
			const msg = parseMessage(data);
			if (msg && this._handler) {
				this._handler(msg);
			}
		}
	}

	/**
	 * Schedule a reconnect attempt with exponential backoff.
	 */
	private _scheduleReconnect(): void {
		if (this._reconnectAttempts >= this._maxReconnectAttempts) {
			return;
		}

		const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30_000);
		this._reconnectAttempts++;

		this._reconnectTimer = setTimeout(() => {
			this._doConnect().catch(() => {
				// Reconnect failure handled by _scheduleReconnect in the connect flow
			});
		}, delay);
	}
}
