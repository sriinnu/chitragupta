/**
 * Sandhana — WebSocket handler for Chitragupta.
 * Manages client connections, message routing, and ping/pong heartbeats.
 */

import type {
	WebSocketClient,
	WebSocketMessage,
	WebSocketServerOptions,
	WebSocketServerEvents,
} from "./ws-types.js";
export type { WebSocketClient, WebSocketMessage, WebSocketServerOptions, WebSocketServerEvents } from "./ws-types.js";
import {
	Opcode,
	type ParsedFrame,
	DEFAULT_PING_INTERVAL,
	DEFAULT_MAX_CONNECTIONS,
	encodeFrame,
	parseFrame,
	computeAcceptKey,
	validateHandshake,
	sendHandshakeResponse,
	rejectUpgrade,
} from "./ws-frame.js";
import { authenticateUpgrade as legacyAuth, clientSubscribedTo } from "./ws-auth.js";
import { WsClient } from "./ws-client.js";
import http from "node:http";
import type https from "node:https";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import type { AuthMiddlewareConfig, AuthContext } from "@chitragupta/core";
import { authenticateWebSocket as dvarapalakaAuthWS } from "@chitragupta/core";
import { createLogger } from "@chitragupta/core";

const wsLog = createLogger("ws-handler");

// ─── WebSocket Server ───────────────────────────────────────────────────────

export { computeAcceptKey } from "./ws-frame.js";

export class WebSocketServer {
	private clients: Map<string, WsClient> = new Map();
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private attached: boolean = false;

	private readonly authToken?: string;
	private readonly apiKeys?: string[];
	private readonly authConfig?: AuthMiddlewareConfig;
	private readonly pingInterval: number;
	private readonly maxConnections: number;
	private readonly logging: boolean;

	/** External event hooks. */
	events: WebSocketServerEvents = {};

	constructor(private readonly options: WebSocketServerOptions = {}) {
		this.authToken = options.authToken;
		this.apiKeys = options.apiKeys;
		this.authConfig = options.auth;
		this.pingInterval = options.pingInterval ?? DEFAULT_PING_INTERVAL;
		this.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
		this.logging = options.enableLogging ?? false;
	}

	/**
	 * Attach to an existing HTTP server.
	 *
	 * Listens for the `upgrade` event and handles WebSocket handshakes.
	 * Can only be attached once.
	 */
	attach(server: http.Server | https.Server): void {
		if (this.attached) {
			throw new Error("WebSocketServer is already attached to a server");
		}
		this.attached = true;

		server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
			this.handleUpgrade(req, socket, head);
		});

		// Start ping/pong heartbeat
		this.startHeartbeat();
	}

	/**
	 * Broadcast a message to all connected clients.
	 * Optionally filter by event subscription patterns.
	 */
	broadcast(event: string, data?: unknown, requestId?: string): void {
		const message: WebSocketMessage = { type: event, data, requestId };
		for (const client of this.clients.values()) {
			if (this.clientSubscribedTo(client, event)) {
				client.send(message);
			}
		}
	}

	/**
	 * Send a message to a specific client by ID.
	 * Returns false if the client was not found.
	 */
	sendTo(clientId: string, event: string, data?: unknown, requestId?: string): boolean {
		const client = this.clients.get(clientId);
		if (!client) return false;
		client.send({ type: event, data, requestId });
		return true;
	}

	/** Get the number of connected clients. */
	get clientCount(): number {
		return this.clients.size;
	}

	/** Get a client by ID. */
	getClient(clientId: string): WebSocketClient | undefined {
		return this.clients.get(clientId);
	}

	/** Get all connected client IDs. */
	getClientIds(): string[] {
		return Array.from(this.clients.keys());
	}

	/**
	 * Disconnect all clients and stop the heartbeat timer.
	 */
	shutdown(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}

		for (const client of this.clients.values()) {
			client.close(1001, "Server shutting down");
		}
		this.clients.clear();
		this.attached = false;
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private handleUpgrade(
		req: http.IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): void {
		// Validate the WebSocket handshake
		const wsKey = validateHandshake(req);
		if (!wsKey) {
			rejectUpgrade(socket, 400, "Bad Request: invalid WebSocket handshake");
			return;
		}

		// Check connection limit
		if (this.clients.size >= this.maxConnections) {
			rejectUpgrade(socket, 503, "Service Unavailable: max connections reached");
			return;
		}

		// Authenticate using Dvarpalaka (async) or legacy (sync)
		if (this.authConfig) {
			// Build bridge config with legacy fallback
			const bridgeConfig: AuthMiddlewareConfig = {
				...this.authConfig,
				legacyAuthToken: this.authConfig.legacyAuthToken ?? this.authToken,
				legacyApiKeys: this.authConfig.legacyApiKeys ?? this.apiKeys,
			};

			dvarapalakaAuthWS(req, bridgeConfig)
				.then((authCtx) => {
					if (!authCtx) {
						rejectUpgrade(socket, 401, "Unauthorized");
						return;
					}
					this.completeUpgrade(req, socket, head, wsKey, authCtx);
				})
				.catch(() => {
					rejectUpgrade(socket, 401, "Unauthorized");
				});
			return;
		}

		// Legacy sync auth
		if (!this.authenticateUpgrade(req)) {
			rejectUpgrade(socket, 401, "Unauthorized");
			return;
		}

		this.completeUpgrade(req, socket, head, wsKey, undefined);
	}

	/**
	 * Complete the WebSocket upgrade after authentication.
	 */
	private completeUpgrade(
		_req: http.IncomingMessage,
		socket: Duplex,
		head: Buffer,
		wsKey: string,
		authCtx: AuthContext | undefined,
	): void {
		// Complete the handshake
		const acceptKey = computeAcceptKey(wsKey);
		sendHandshakeResponse(socket, acceptKey);

		// Create the client
		const client = new WsClient(socket);
		if (authCtx) {
			client.authContext = authCtx;
		}
		this.clients.set(client.id, client);

		if (this.logging) {
			this.log(`Client connected: ${client.id}`);
		}

		// Notify external listeners
		this.events.onConnect?.(client);

		// Set up data handling
		let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

		// If there is a head buffer from the upgrade, prepend it
		if (head && head.length > 0) {
			buffer = Buffer.from(head);
		}

		socket.on("data", (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			this.processBuffer(client, buffer, (remaining) => {
				buffer = remaining;
			});
		});

		socket.on("close", () => {
			this.removeClient(client);
		});

		socket.on("error", () => {
			this.removeClient(client);
		});
	}

	/**
	 * Process the read buffer, parsing as many complete frames as possible.
	 */
	private processBuffer(
		client: WsClient,
		buffer: Buffer,
		setRemaining: (buf: Buffer) => void,
	): void {
		let offset = 0;

		while (offset < buffer.length) {
			const frame = parseFrame(buffer, offset);
			if (!frame) break;

			offset += frame.bytesConsumed;
			this.handleFrame(client, frame);
		}

		// Keep unprocessed bytes
		if (offset > 0) {
			setRemaining(Buffer.from(buffer.subarray(offset)));
		} else {
			setRemaining(buffer);
		}
	}

	/**
	 * Handle a single parsed WebSocket frame.
	 */
	private handleFrame(client: WsClient, frame: ParsedFrame): void {
		switch (frame.opcode) {
			case Opcode.Text:
			case Opcode.Continuation: {
				const payload = client._handleFrame(frame.opcode, frame.payload, frame.fin);
				if (payload !== null) {
					this.handleTextMessage(client, payload.toString("utf-8"));
				}
				break;
			}

			case Opcode.Close: {
				// Echo close frame back and tear down
				client.close();
				this.removeClient(client);
				break;
			}

			case Opcode.Ping: {
				// Respond with pong carrying the same payload
				client._sendPong(frame.payload);
				break;
			}

			case Opcode.Pong: {
				// Mark client as alive
				client.isAlive = true;
				break;
			}

			case Opcode.Binary: {
				// We don't support binary frames — close with 1003 (unsupported data)
				client.close(1003, "Binary frames not supported");
				this.removeClient(client);
				break;
			}

			default: {
				// Unknown opcode — ignore
				break;
			}
		}
	}

	/**
	 * Parse and dispatch a text message from a client.
	 */
	private handleTextMessage(client: WsClient, text: string): void {
		let msg: WebSocketMessage;

		try {
			const parsed = JSON.parse(text);
			if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
				client.send({
					type: "error",
					data: { error: "Invalid message: must be JSON with a 'type' field" },
				});
				return;
			}
			msg = parsed as WebSocketMessage;
		} catch {
			client.send({
				type: "error",
				data: { error: "Invalid JSON" },
			});
			return;
		}

		// Handle built-in message types
		switch (msg.type) {
			case "ping": {
				client.send({ type: "pong" });
				return;
			}

			case "subscribe": {
				const events = (msg.data as { events?: string[] })?.events;
				if (Array.isArray(events)) {
					client.subscriptions = events.map(String);
					client.send({
						type: "subscribed",
						data: { events: client.subscriptions },
					});
				} else {
					client.send({
						type: "error",
						data: { error: "subscribe requires data.events array" },
					});
				}
				return;
			}

			default: {
				// Dispatch to client-level handlers
				client._dispatchMessage(msg);
				// Dispatch to server-level handler
				this.events.onMessage?.(client, msg);
				break;
			}
		}
	}

	private authenticateUpgrade(req: http.IncomingMessage): boolean {
		return legacyAuth(req, this.authToken, this.apiKeys);
	}

	private clientSubscribedTo(client: WebSocketClient, event: string): boolean {
		return clientSubscribedTo(client, event);
	}

	/**
	 * Remove a client from tracking and notify listeners.
	 */
	private removeClient(client: WsClient): void {
		if (!this.clients.has(client.id)) return;

		this.clients.delete(client.id);
		client._dispatchClose();

		if (this.logging) {
			this.log(`Client disconnected: ${client.id}`);
		}

		this.events.onDisconnect?.(client.id);
	}

	/**
	 * Start the heartbeat timer.
	 *
	 * Every `pingInterval` ms, iterate all clients:
	 * - If not alive since last ping -> dead, disconnect
	 * - Otherwise, mark not alive and send ping
	 */
	private startHeartbeat(): void {
		if (this.pingInterval <= 0) return;

		this.pingTimer = setInterval(() => {
			for (const client of this.clients.values()) {
				if (!client.isAlive) {
					// Did not respond to last ping — assume dead
					if (this.logging) {
						this.log(`Client ${client.id} failed heartbeat — disconnecting`);
					}
					client.close(1001, "Heartbeat timeout");
					this.removeClient(client);
					continue;
				}

				// Mark as not-alive until next pong
				client.isAlive = false;
				client._sendPing();
			}
		}, this.pingInterval);

		// Unref so it does not keep the process alive
		if (this.pingTimer && typeof this.pingTimer === "object" && "unref" in this.pingTimer) {
			(this.pingTimer as NodeJS.Timeout).unref();
		}
	}

	private log(message: string): void {
		wsLog.info(message);
	}
}

// ─── Exports for testing ────────────────────────────────────────────────────

/** @internal — exported for unit testing frame encoding/decoding. */
export const _internal = {
	encodeFrame,
	parseFrame,
	validateHandshake,
	Opcode: Opcode as unknown as Record<string, number>,
	WS_MAGIC_GUID: "258EAFA5-E914-47DA-95CA-5AB9F3907FEE",
};
