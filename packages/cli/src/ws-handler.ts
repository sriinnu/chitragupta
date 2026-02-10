/**
 * Sandhana — WebSocket handler for Chitragupta.
 * Sanskrit: Sandhana (संधान) = connection, junction.
 *
 * Pure Node.js WebSocket implementation — no external libraries.
 * Handles the HTTP Upgrade handshake, WebSocket frame parsing/encoding,
 * client lifecycle, ping/pong heartbeats, and message routing.
 *
 * Designed to hook into an existing http.Server via the `upgrade` event.
 */

import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import type { AuthMiddlewareConfig, AuthContext } from "@chitragupta/core";
import { authenticateWebSocket as dvarapalakaAuthWS } from "@chitragupta/core";
import { createLogger } from "@chitragupta/core";

const wsLog = createLogger("ws-handler");

// ─── Constants ──────────────────────────────────────────────────────────────

/** The magic GUID specified in RFC 6455 section 4.2.2 */
const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB9F3907FEE";

/** WebSocket frame opcodes */
enum Opcode {
	Continuation = 0x0,
	Text = 0x1,
	Binary = 0x2,
	Close = 0x8,
	Ping = 0x9,
	Pong = 0xa,
}

/** Maximum payload length we accept for a single frame (16 MiB). */
const MAX_PAYLOAD_LENGTH = 16 * 1024 * 1024;

/** Default ping interval in milliseconds. */
const DEFAULT_PING_INTERVAL = 30_000;

/** Default maximum concurrent connections. */
const DEFAULT_MAX_CONNECTIONS = 10;

// ─── Public Types ───────────────────────────────────────────────────────────

export interface WebSocketClient {
	/** Unique client identifier. */
	id: string;
	/** Send a structured message to this client. */
	send(data: unknown): void;
	/** Close the connection with an optional code and reason. */
	close(code?: number, reason?: string): void;
	/** Register a handler for incoming messages. */
	onMessage(handler: (msg: WebSocketMessage) => void): void;
	/** Register a handler for connection close. */
	onClose(handler: () => void): void;
	/** Whether the connection is still alive (responded to last ping). */
	isAlive: boolean;
	/** Event subscriptions for this client (glob patterns). */
	subscriptions: string[];
	/** Authenticated user context (set by Dvarpalaka auth). */
	authContext?: AuthContext;
}

export interface WebSocketMessage {
	/** Message type: "chat", "abort", "subscribe", "ping", etc. */
	type: string;
	/** Message payload. */
	data?: unknown;
	/** Client-provided request correlation ID. */
	requestId?: string;
}

export interface WebSocketServerOptions {
	/** Auth token required on upgrade. Omit to disable auth. */
	authToken?: string;
	/** Array of valid API keys. Checked alongside authToken. */
	apiKeys?: string[];
	/** Heartbeat ping interval in ms. Default: 30000. */
	pingInterval?: number;
	/** Maximum simultaneous connections. Default: 10. */
	maxConnections?: number;
	/** Enable logging to stdout. Default: false. */
	enableLogging?: boolean;
	/**
	 * Dvarpalaka auth middleware configuration.
	 * When set, uses JWT + RBAC auth for WebSocket upgrade.
	 * Falls back to legacy authToken/apiKeys when not set.
	 */
	auth?: AuthMiddlewareConfig;
}

export interface WebSocketServerEvents {
	/** Called when a new client connects. */
	onConnect?: (client: WebSocketClient) => void;
	/** Called when a client disconnects. */
	onDisconnect?: (clientId: string) => void;
	/** Called when a message is received from any client. */
	onMessage?: (client: WebSocketClient, msg: WebSocketMessage) => void;
}

// ─── Internal Client Implementation ─────────────────────────────────────────

class WsClient implements WebSocketClient {
	readonly id: string;
	isAlive: boolean = true;
	subscriptions: string[] = [];
	authContext?: AuthContext;

	private socket: Duplex;
	private messageHandlers: Array<(msg: WebSocketMessage) => void> = [];
	private closeHandlers: Array<() => void> = [];
	private closed: boolean = false;
	/** Buffer for accumulating fragmented frames. */
	private fragmentBuffer: Buffer[] = [];
	private fragmentOpcode: number = 0;

	constructor(socket: Duplex, id?: string) {
		this.id = id ?? randomUUID();
		this.socket = socket;
	}

	send(data: unknown): void {
		if (this.closed) return;
		const payload = typeof data === "string" ? data : JSON.stringify(data);
		const frame = encodeFrame(Opcode.Text, Buffer.from(payload, "utf-8"));
		try {
			this.socket.write(frame);
		} catch {
			// Socket may have been destroyed — ignore write errors
		}
	}

	close(code: number = 1000, reason: string = ""): void {
		if (this.closed) return;
		this.closed = true;

		// Build close frame payload: 2-byte status code + reason
		const reasonBuf = Buffer.from(reason, "utf-8");
		const payload = Buffer.alloc(2 + reasonBuf.length);
		payload.writeUInt16BE(code, 0);
		reasonBuf.copy(payload, 2);

		try {
			this.socket.write(encodeFrame(Opcode.Close, payload));
		} catch {
			// Ignore — best-effort close frame
		}

		// Destroy after a short delay to allow the frame to flush
		setTimeout(() => {
			try {
				this.socket.destroy();
			} catch {
				// Already destroyed
			}
		}, 100);
	}

	onMessage(handler: (msg: WebSocketMessage) => void): void {
		this.messageHandlers.push(handler);
	}

	onClose(handler: () => void): void {
		this.closeHandlers.push(handler);
	}

	/** @internal — dispatch a parsed message to all registered handlers. */
	_dispatchMessage(msg: WebSocketMessage): void {
		for (const h of this.messageHandlers) {
			try {
				h(msg);
			} catch {
				// Consumer error — do not crash the server
			}
		}
	}

	/** @internal — notify all close handlers. */
	_dispatchClose(): void {
		this.closed = true;
		for (const h of this.closeHandlers) {
			try {
				h();
			} catch {
				// Consumer error — do not crash the server
			}
		}
	}

	/** @internal — send a raw pong frame. */
	_sendPong(payload: Buffer): void {
		if (this.closed) return;
		try {
			this.socket.write(encodeFrame(Opcode.Pong, payload));
		} catch {
			// Ignore
		}
	}

	/** @internal — send a raw ping frame. */
	_sendPing(): void {
		if (this.closed) return;
		try {
			this.socket.write(encodeFrame(Opcode.Ping, Buffer.alloc(0)));
		} catch {
			// Ignore
		}
	}

	/** @internal — accumulate fragment or return complete payload. */
	_handleFrame(opcode: number, payload: Buffer, fin: boolean): Buffer | null {
		if (opcode === Opcode.Continuation) {
			// Continuation of a fragmented message
			this.fragmentBuffer.push(payload);
			if (fin) {
				const complete = Buffer.concat(this.fragmentBuffer);
				this.fragmentBuffer = [];
				return complete;
			}
			return null;
		}

		// New frame
		if (!fin) {
			// Start of a fragmented message
			this.fragmentOpcode = opcode;
			this.fragmentBuffer = [payload];
			return null;
		}

		// Single complete frame — return as-is
		return payload;
	}

	/** @internal — get the opcode for the current fragment sequence. */
	get _effectiveOpcode(): number {
		return this.fragmentOpcode;
	}
}

// ─── Frame Encoding / Decoding ──────────────────────────────────────────────

/**
 * Encode a WebSocket frame.
 *
 * Server-to-client frames are NOT masked (per RFC 6455 section 5.1).
 */
function encodeFrame(opcode: number, payload: Buffer): Buffer {
	const len = payload.length;
	let headerLen: number;
	let extLen: number;

	if (len < 126) {
		headerLen = 2;
		extLen = 0;
	} else if (len < 65536) {
		headerLen = 4;
		extLen = 2;
	} else {
		headerLen = 10;
		extLen = 8;
	}

	const frame = Buffer.alloc(headerLen + len);

	// FIN bit + opcode
	frame[0] = 0x80 | opcode;

	// Payload length (no mask bit for server frames)
	if (extLen === 0) {
		frame[1] = len;
	} else if (extLen === 2) {
		frame[1] = 126;
		frame.writeUInt16BE(len, 2);
	} else {
		frame[1] = 127;
		// Write as two 32-bit values (Node Buffer doesn't support 64-bit write natively)
		frame.writeUInt32BE(0, 2); // high 32 bits — always 0 for our sizes
		frame.writeUInt32BE(len, 6);
	}

	payload.copy(frame, headerLen);
	return frame;
}

/**
 * Result of parsing a single WebSocket frame from a buffer.
 */
interface ParsedFrame {
	/** Whether FIN bit is set (final fragment). */
	fin: boolean;
	/** Frame opcode. */
	opcode: number;
	/** Unmasked payload data. */
	payload: Buffer;
	/** Total bytes consumed from the buffer. */
	bytesConsumed: number;
}

/**
 * Try to parse one WebSocket frame from the buffer.
 *
 * Returns null if the buffer does not yet contain a complete frame.
 * Client-to-server frames MUST be masked (RFC 6455 section 5.1).
 */
function parseFrame(buffer: Buffer, offset: number = 0): ParsedFrame | null {
	const available = buffer.length - offset;
	if (available < 2) return null;

	const byte0 = buffer[offset];
	const byte1 = buffer[offset + 1];

	const fin = (byte0 & 0x80) !== 0;
	const opcode = byte0 & 0x0f;
	const masked = (byte1 & 0x80) !== 0;
	let payloadLen = byte1 & 0x7f;

	let headerLen = 2;

	if (payloadLen === 126) {
		if (available < 4) return null;
		payloadLen = buffer.readUInt16BE(offset + 2);
		headerLen = 4;
	} else if (payloadLen === 127) {
		if (available < 10) return null;
		// Read 64-bit length; ignore high 32 bits (we cap at MAX_PAYLOAD_LENGTH)
		const high = buffer.readUInt32BE(offset + 2);
		const low = buffer.readUInt32BE(offset + 6);
		if (high !== 0) {
			// Payload > 4 GiB — reject
			return null;
		}
		payloadLen = low;
		headerLen = 10;
	}

	if (payloadLen > MAX_PAYLOAD_LENGTH) {
		return null;
	}

	const maskLen = masked ? 4 : 0;
	const totalLen = headerLen + maskLen + payloadLen;

	if (available < totalLen) return null;

	let payload: Buffer;
	if (masked) {
		const maskKey = buffer.subarray(offset + headerLen, offset + headerLen + 4);
		const raw = buffer.subarray(
			offset + headerLen + 4,
			offset + headerLen + 4 + payloadLen,
		);
		// Unmask in-place on a copy
		payload = Buffer.allocUnsafe(payloadLen);
		for (let i = 0; i < payloadLen; i++) {
			payload[i] = raw[i] ^ maskKey[i % 4];
		}
	} else {
		payload = Buffer.from(
			buffer.subarray(offset + headerLen, offset + headerLen + payloadLen),
		);
	}

	return { fin, opcode, payload, bytesConsumed: totalLen };
}

// ─── WebSocket Handshake ────────────────────────────────────────────────────

/**
 * Compute the Sec-WebSocket-Accept value per RFC 6455 section 4.2.2.
 */
export function computeAcceptKey(secWebSocketKey: string): string {
	return createHash("sha1")
		.update(secWebSocketKey + WS_MAGIC_GUID)
		.digest("base64");
}

/**
 * Validate the handshake request headers.
 * Returns the Sec-WebSocket-Key if valid, or null if the handshake should be rejected.
 */
function validateHandshake(req: http.IncomingMessage): string | null {
	const upgrade = req.headers["upgrade"];
	if (!upgrade || upgrade.toLowerCase() !== "websocket") return null;

	const connection = req.headers["connection"];
	if (!connection || !connection.toLowerCase().includes("upgrade")) return null;

	const key = req.headers["sec-websocket-key"];
	if (typeof key !== "string" || key.length === 0) return null;

	const version = req.headers["sec-websocket-version"];
	if (version !== "13") return null;

	return key;
}

/**
 * Send the 101 Switching Protocols response to complete the handshake.
 */
function sendHandshakeResponse(socket: Duplex, acceptKey: string): void {
	const response = [
		"HTTP/1.1 101 Switching Protocols",
		"Upgrade: websocket",
		"Connection: Upgrade",
		`Sec-WebSocket-Accept: ${acceptKey}`,
		"",
		"",
	].join("\r\n");

	socket.write(response);
}

/**
 * Send an HTTP error response on the raw socket and destroy it.
 */
function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
	const body = JSON.stringify({ error: message });
	const response = [
		`HTTP/1.1 ${statusCode} ${message}`,
		"Content-Type: application/json",
		`Content-Length: ${Buffer.byteLength(body)}`,
		"Connection: close",
		"",
		body,
	].join("\r\n");

	socket.write(response);
	socket.destroy();
}

// ─── WebSocket Server ───────────────────────────────────────────────────────

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
	attach(server: http.Server): void {
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

	/**
	 * Authenticate the upgrade request.
	 *
	 * Checks in this order:
	 * 1. Query parameter `?token=xxx`
	 * 2. Sec-WebSocket-Protocol header (subprotocol containing the token)
	 * 3. Authorization header (Bearer token)
	 *
	 * Returns true if auth is disabled or the token matches.
	 */
	private authenticateUpgrade(req: http.IncomingMessage): boolean {
		const authEnabled = Boolean(this.authToken) || Boolean(this.apiKeys?.length);
		if (!authEnabled) return true;

		// 1. Query parameter ?token=xxx
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const queryToken = url.searchParams.get("token");

		// 2. Sec-WebSocket-Protocol header
		const protocol = req.headers["sec-websocket-protocol"];
		const protocolToken = typeof protocol === "string" ? protocol.trim() : "";

		// 3. Authorization header
		const authHeader = req.headers["authorization"] ?? "";
		const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

		// Collect all candidate tokens
		const candidates = [queryToken, protocolToken, bearer].filter(Boolean) as string[];

		for (const candidate of candidates) {
			// Check authToken
			if (this.authToken && candidate === this.authToken) return true;
			// Check apiKeys
			if (this.apiKeys?.includes(candidate)) return true;
		}

		return false;
	}

	/**
	 * Check whether a client is subscribed to a given event type.
	 *
	 * If the client has no subscriptions, they receive all events.
	 * Supports wildcard patterns like "agent:*" or "*".
	 */
	private clientSubscribedTo(client: WebSocketClient, event: string): boolean {
		if (client.subscriptions.length === 0) return true;

		for (const pattern of client.subscriptions) {
			if (pattern === "*") return true;
			if (pattern === event) return true;
			// Glob: "agent:*" matches "agent:start", "agent:done", etc.
			if (pattern.endsWith("*")) {
				const prefix = pattern.slice(0, -1);
				if (event.startsWith(prefix)) return true;
			}
		}

		return false;
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
	WS_MAGIC_GUID,
};
