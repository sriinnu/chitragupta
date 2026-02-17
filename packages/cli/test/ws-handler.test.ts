import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { createHash } from "node:crypto";
import net from "node:net";
import { WebSocketServer, computeAcceptKey, _internal } from "../src/ws-handler.js";
import type { WebSocketClient, WebSocketMessage } from "../src/ws-handler.js";

const { encodeFrame, parseFrame, Opcode, WS_MAGIC_GUID } = _internal;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal HTTP server on a random port. */
function createTestServer(): { server: http.Server; port: () => number } {
	const server = http.createServer((_req, res) => {
		res.writeHead(200);
		res.end("ok");
	});
	return {
		server,
		port: () => {
			const addr = server.address();
			return typeof addr === "object" && addr !== null ? addr.port : 0;
		},
	};
}

/** Start a server and return a cleanup function. */
async function startServer(server: http.Server): Promise<number> {
	return new Promise<number>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr !== null ? addr.port : 0;
			resolve(port);
		});
	});
}

/**
 * Perform a raw WebSocket handshake over a TCP socket.
 * Returns the socket for further frame-level communication.
 */
function rawWsConnect(
	port: number,
	opts: {
		token?: string;
		key?: string;
		headers?: Record<string, string>;
		path?: string;
	} = {},
): Promise<{ socket: net.Socket; response: string }> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
			const wsKey = opts.key ?? "dGhlIHNhbXBsZSBub25jZQ==";
			const path = opts.path ?? "/";
			const extraHeaders = opts.headers ?? {};

			if (opts.token) {
				extraHeaders["Authorization"] = `Bearer ${opts.token}`;
			}

			let request = [
				`GET ${path} HTTP/1.1`,
				`Host: 127.0.0.1:${port}`,
				"Upgrade: websocket",
				"Connection: Upgrade",
				`Sec-WebSocket-Key: ${wsKey}`,
				"Sec-WebSocket-Version: 13",
			];

			for (const [k, v] of Object.entries(extraHeaders)) {
				request.push(`${k}: ${v}`);
			}

			request.push("", "");
			socket.write(request.join("\r\n"));
		});

		let data = "";
		const onData = (chunk: Buffer) => {
			data += chunk.toString();
			if (data.includes("\r\n\r\n")) {
				socket.removeListener("data", onData);
				resolve({ socket, response: data });
			}
		};

		socket.on("data", onData);
		socket.on("error", reject);

		// Timeout after 2 seconds
		setTimeout(() => reject(new Error("Connection timeout")), 2000);
	});
}

/**
 * Build a masked WebSocket text frame (client-to-server must be masked).
 */
function buildMaskedTextFrame(text: string): Buffer {
	const payload = Buffer.from(text, "utf-8");
	const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
	const masked = Buffer.allocUnsafe(payload.length);
	for (let i = 0; i < payload.length; i++) {
		masked[i] = payload[i] ^ maskKey[i % 4];
	}

	const len = payload.length;
	let headerLen: number;

	if (len < 126) {
		headerLen = 2;
	} else if (len < 65536) {
		headerLen = 4;
	} else {
		headerLen = 10;
	}

	const frame = Buffer.alloc(headerLen + 4 + len);

	// FIN + Text opcode
	frame[0] = 0x80 | 0x01;

	// Mask bit + length
	if (len < 126) {
		frame[1] = 0x80 | len;
	} else if (len < 65536) {
		frame[1] = 0x80 | 126;
		frame.writeUInt16BE(len, 2);
	} else {
		frame[1] = 0x80 | 127;
		frame.writeUInt32BE(0, 2);
		frame.writeUInt32BE(len, 6);
	}

	maskKey.copy(frame, headerLen);
	masked.copy(frame, headerLen + 4);

	return frame;
}

/** Send a JSON message over a raw socket as a masked WebSocket frame. */
function sendWsMessage(socket: net.Socket, msg: Record<string, unknown>): void {
	const frame = buildMaskedTextFrame(JSON.stringify(msg));
	socket.write(frame);
}

/** Read and parse a WebSocket text frame from a socket. */
function readWsFrame(socket: net.Socket, timeoutMs: number = 2000): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Frame read timeout")), timeoutMs);

		const onData = (chunk: Buffer) => {
			// Parse the unmasked server-to-client frame
			const parsed = parseFrame(chunk);
			if (parsed && (parsed.opcode === Opcode.Text || parsed.opcode === 0x01)) {
				clearTimeout(timer);
				socket.removeListener("data", onData);
				resolve(parsed.payload.toString("utf-8"));
			}
		};

		socket.on("data", onData);
	});
}

/** Read and parse a WebSocket JSON message from a socket. */
async function readWsJSON(socket: net.Socket, timeoutMs?: number): Promise<Record<string, unknown>> {
	const text = await readWsFrame(socket, timeoutMs);
	return JSON.parse(text);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("WebSocket Handler", () => {
	// ═══════════════════════════════════════════════════════════════════════
	// Handshake computation
	// ═══════════════════════════════════════════════════════════════════════

	describe("computeAcceptKey", () => {
		it("should compute correct Sec-WebSocket-Accept for RFC example", () => {
			// Use a known key and verify the accept hash matches SHA-1(key + GUID)
			const key = "dGhlIHNhbXBsZSBub25jZQ==";
			const expected = createHash("sha1")
				.update(key + WS_MAGIC_GUID)
				.digest("base64");

			expect(computeAcceptKey(key)).toBe(expected);
			// Verify the computed value is a valid base64 SHA-1 hash (28 chars)
			expect(computeAcceptKey(key)).toHaveLength(28);
		});

		it("should produce different results for different keys", () => {
			const key1 = computeAcceptKey("aaa=");
			const key2 = computeAcceptKey("bbb=");
			expect(key1).not.toBe(key2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Frame encoding/decoding
	// ═══════════════════════════════════════════════════════════════════════

	describe("frame encoding/decoding", () => {
		it("should encode and parse a short text frame", () => {
			const text = "Hello";
			const payload = Buffer.from(text, "utf-8");
			const frame = encodeFrame(Opcode.Text, payload);

			expect(frame[0]).toBe(0x80 | Opcode.Text); // FIN + Text
			expect(frame[1]).toBe(text.length); // No mask, length < 126

			const parsed = parseFrame(frame);
			expect(parsed).not.toBeNull();
			expect(parsed!.fin).toBe(true);
			expect(parsed!.opcode).toBe(Opcode.Text);
			expect(parsed!.payload.toString("utf-8")).toBe(text);
		});

		it("should encode and parse a medium-length frame (126-65535 bytes)", () => {
			const payload = Buffer.alloc(200, 0x41); // 200 bytes of 'A'
			const frame = encodeFrame(Opcode.Text, payload);

			expect(frame[1]).toBe(126); // Extended 16-bit length
			expect(frame.readUInt16BE(2)).toBe(200);

			const parsed = parseFrame(frame);
			expect(parsed).not.toBeNull();
			expect(parsed!.payload.length).toBe(200);
			expect(parsed!.payload[0]).toBe(0x41);
		});

		it("should encode a close frame", () => {
			const payload = Buffer.alloc(2);
			payload.writeUInt16BE(1000, 0);
			const frame = encodeFrame(Opcode.Close, payload);

			expect(frame[0] & 0x0f).toBe(Opcode.Close);
		});

		it("should encode a ping frame", () => {
			const frame = encodeFrame(Opcode.Ping, Buffer.alloc(0));
			expect(frame[0] & 0x0f).toBe(Opcode.Ping);
			expect(frame[1]).toBe(0); // Empty payload
		});

		it("should return null for incomplete buffer", () => {
			const frame = encodeFrame(Opcode.Text, Buffer.from("Hello"));
			// Truncate the frame
			const truncated = frame.subarray(0, 2);
			expect(parseFrame(truncated)).toBeNull();
		});

		it("should return null for too-short buffer", () => {
			expect(parseFrame(Buffer.alloc(1))).toBeNull();
		});

		it("should parse masked frames (client-to-server)", () => {
			const text = "test";
			const maskedFrame = buildMaskedTextFrame(text);
			const parsed = parseFrame(maskedFrame);

			expect(parsed).not.toBeNull();
			expect(parsed!.fin).toBe(true);
			expect(parsed!.opcode).toBe(Opcode.Text);
			expect(parsed!.payload.toString("utf-8")).toBe(text);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// WebSocket Server — lifecycle and connections
	// ═══════════════════════════════════════════════════════════════════════

	describe("WebSocketServer", () => {
		let httpServer: http.Server;
		let wsServer: WebSocketServer;
		let port: number;

		afterEach(async () => {
			wsServer?.shutdown();
			await new Promise<void>((resolve) => {
				httpServer?.close(() => resolve());
			});
		});

		it("should accept a WebSocket handshake and track clients", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 }); // Disable ping for test
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<string>((resolve) => {
				wsServer.events.onConnect = (client) => resolve(client.id);
			});

			const { response } = await rawWsConnect(port);

			expect(response).toContain("101 Switching Protocols");
			expect(response).toContain("Upgrade: websocket");
			expect(response).toContain("Sec-WebSocket-Accept:");

			const clientId = await connected;
			expect(clientId).toBeTruthy();
			expect(wsServer.clientCount).toBe(1);
		});

		it("should reject connections when auth is required but missing", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({
				authToken: "secret-token",
				pingInterval: 0,
			});
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const { response, socket } = await rawWsConnect(port);

			expect(response).toContain("401");
			expect(response).toContain("Unauthorized");
			expect(wsServer.clientCount).toBe(0);

			socket.destroy();
		});

		it("should accept connections with valid auth token in query param", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({
				authToken: "secret-token",
				pingInterval: 0,
			});
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const { response, socket } = await rawWsConnect(port, {
				path: "/?token=secret-token",
			});

			expect(response).toContain("101 Switching Protocols");
			await connected;
			expect(wsServer.clientCount).toBe(1);

			socket.destroy();
		});

		it("should accept connections with valid auth token in Bearer header", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({
				authToken: "bearer-token",
				pingInterval: 0,
			});
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const { response, socket } = await rawWsConnect(port, {
				token: "bearer-token",
			});

			expect(response).toContain("101 Switching Protocols");
			await connected;
			expect(wsServer.clientCount).toBe(1);

			socket.destroy();
		});

		it("should reject connections exceeding max connections", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({
				maxConnections: 1,
				pingInterval: 0,
			});
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			// First connection should succeed
			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});
			const { socket: s1 } = await rawWsConnect(port);
			await connected;
			expect(wsServer.clientCount).toBe(1);

			// Second connection should be rejected
			const { response: r2, socket: s2 } = await rawWsConnect(port);
			expect(r2).toContain("503");
			expect(r2).toContain("max connections");

			s1.destroy();
			s2.destroy();
		});

		it("should handle client disconnect and update count", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const disconnected = new Promise<string>((resolve) => {
				wsServer.events.onDisconnect = (id) => resolve(id);
			});

			const { socket } = await rawWsConnect(port);
			await connected;
			expect(wsServer.clientCount).toBe(1);

			// Send a proper close frame (opcode 0x8) then destroy
			const closePayload = Buffer.alloc(2);
			closePayload.writeUInt16BE(1000, 0);
			const maskKey = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
			const maskedPayload = Buffer.allocUnsafe(2);
			maskedPayload[0] = closePayload[0] ^ maskKey[0];
			maskedPayload[1] = closePayload[1] ^ maskKey[1];
			const closeFrame = Buffer.alloc(2 + 4 + 2);
			closeFrame[0] = 0x88; // FIN + close opcode
			closeFrame[1] = 0x82; // mask bit + payload length 2
			maskKey.copy(closeFrame, 2);
			maskedPayload.copy(closeFrame, 6);
			socket.write(closeFrame);

			// Also destroy to ensure the socket closes
			setTimeout(() => socket.destroy(), 50);

			const disconnectedId = await disconnected;
			expect(disconnectedId).toBeTruthy();
			expect(wsServer.clientCount).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Message handling
	// ═══════════════════════════════════════════════════════════════════════

	describe("message handling", () => {
		let httpServer: http.Server;
		let wsServer: WebSocketServer;
		let port: number;

		afterEach(async () => {
			wsServer?.shutdown();
			await new Promise<void>((resolve) => {
				httpServer?.close(() => resolve());
			});
		});

		it("should respond with pong to ping messages", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const { socket } = await rawWsConnect(port);
			await connected;

			// Set up read before write to avoid race
			const responsePromise = readWsJSON(socket);
			sendWsMessage(socket, { type: "ping" });
			const response = await responsePromise;

			expect(response.type).toBe("pong");

			socket.destroy();
		});

		it("should handle subscribe messages", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const { socket } = await rawWsConnect(port);
			await connected;

			const responsePromise = readWsJSON(socket);
			sendWsMessage(socket, {
				type: "subscribe",
				data: { events: ["agent:*", "tool:*"] },
			});
			const response = await responsePromise;

			expect(response.type).toBe("subscribed");
			expect(response.data).toEqual({ events: ["agent:*", "tool:*"] });

			socket.destroy();
		});

		it("should dispatch custom messages to onMessage handler", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const messageReceived = new Promise<WebSocketMessage>((resolve) => {
				wsServer.events.onMessage = (_client, msg) => resolve(msg);
			});

			const { socket } = await rawWsConnect(port);
			await connected;

			sendWsMessage(socket, {
				type: "chat",
				data: { message: "hello" },
				requestId: "req-1",
			});

			const msg = await messageReceived;
			expect(msg.type).toBe("chat");
			expect((msg.data as Record<string, unknown>).message).toBe("hello");
			expect(msg.requestId).toBe("req-1");

			socket.destroy();
		});

		it("should send error for invalid JSON", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const { socket } = await rawWsConnect(port);
			await connected;

			const responsePromise = readWsJSON(socket);
			// Send invalid JSON
			const frame = buildMaskedTextFrame("not json {{{");
			socket.write(frame);
			const response = await responsePromise;

			expect(response.type).toBe("error");
			expect((response.data as Record<string, unknown>).error).toContain("Invalid JSON");

			socket.destroy();
		});

		it("should send error for message without type field", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const { socket } = await rawWsConnect(port);
			await connected;

			const responsePromise = readWsJSON(socket);
			sendWsMessage(socket, { data: "no type" } as unknown as Record<string, unknown>);
			const response = await responsePromise;

			expect(response.type).toBe("error");
			expect((response.data as Record<string, unknown>).error).toContain("type");

			socket.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Broadcast and sendTo
	// ═══════════════════════════════════════════════════════════════════════

	describe("broadcast and sendTo", () => {
		let httpServer: http.Server;
		let wsServer: WebSocketServer;
		let port: number;

		afterEach(async () => {
			wsServer?.shutdown();
			await new Promise<void>((resolve) => {
				httpServer?.close(() => resolve());
			});
		});

		it("should broadcast to all connected clients", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			let connectCount = 0;
			const allConnected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => {
					connectCount++;
					if (connectCount >= 2) resolve();
				};
			});

			const { socket: s1 } = await rawWsConnect(port);
			const { socket: s2 } = await rawWsConnect(port);
			await allConnected;

			expect(wsServer.clientCount).toBe(2);

			// Set up reads before broadcast
			const p1 = readWsJSON(s1);
			const p2 = readWsJSON(s2);

			wsServer.broadcast("test:event", { value: 42 }, "bc-1");

			const [r1, r2] = await Promise.all([p1, p2]);

			expect(r1.type).toBe("test:event");
			expect(r1.data).toEqual({ value: 42 });
			expect(r1.requestId).toBe("bc-1");

			expect(r2.type).toBe("test:event");
			expect(r2.data).toEqual({ value: 42 });

			s1.destroy();
			s2.destroy();
		});

		it("should sendTo a specific client by ID", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			let firstClientId = "";
			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = (client) => {
					if (!firstClientId) {
						firstClientId = client.id;
						resolve();
					}
				};
			});

			const { socket: s1 } = await rawWsConnect(port);
			await connected;

			const p1 = readWsJSON(s1);
			const sent = wsServer.sendTo(firstClientId, "direct:msg", { hello: "world" });
			expect(sent).toBe(true);

			const r1 = await p1;
			expect(r1.type).toBe("direct:msg");
			expect(r1.data).toEqual({ hello: "world" });

			// sendTo to non-existent client returns false
			expect(wsServer.sendTo("nonexistent-id", "test", {})).toBe(false);

			s1.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Ping/Pong heartbeat
	// ═══════════════════════════════════════════════════════════════════════

	describe("ping/pong heartbeat", () => {
		let httpServer: http.Server;
		let wsServer: WebSocketServer;

		afterEach(async () => {
			wsServer?.shutdown();
			await new Promise<void>((resolve) => {
				httpServer?.close(() => resolve());
			});
		});

		it("should send ping frames and mark non-responsive clients as dead", async () => {
			const { server } = createTestServer();
			httpServer = server;
			// Very short ping interval for testing
			wsServer = new WebSocketServer({ pingInterval: 100 });
			wsServer.attach(httpServer);
			const port = await startServer(httpServer);

			const connected = new Promise<WebSocketClient>((resolve) => {
				wsServer.events.onConnect = (client) => resolve(client);
			});

			const disconnected = new Promise<string>((resolve) => {
				wsServer.events.onDisconnect = (id) => resolve(id);
			});

			const { socket } = await rawWsConnect(port);
			const client = await connected;
			expect(client.isAlive).toBe(true);

			// Do NOT respond to ping — after two intervals the client should be dead
			// First interval: marks isAlive=false, sends ping
			// Second interval: sees isAlive=false, disconnects
			const deadId = await disconnected;
			expect(deadId).toBe(client.id);
			expect(wsServer.clientCount).toBe(0);

			socket.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Subscription filtering
	// ═══════════════════════════════════════════════════════════════════════

	describe("subscription filtering", () => {
		let httpServer: http.Server;
		let wsServer: WebSocketServer;
		let port: number;

		afterEach(async () => {
			wsServer?.shutdown();
			await new Promise<void>((resolve) => {
				httpServer?.close(() => resolve());
			});
		});

		it("should only broadcast to clients with matching subscriptions", async () => {
			const { server } = createTestServer();
			httpServer = server;
			wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			port = await startServer(httpServer);

			let connectCount = 0;
			const allConnected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => {
					connectCount++;
					if (connectCount >= 2) resolve();
				};
			});

			const { socket: s1 } = await rawWsConnect(port);
			const { socket: s2 } = await rawWsConnect(port);
			await allConnected;

			// Client 1 subscribes to "agent:*" only
			const subResponse = readWsJSON(s1);
			sendWsMessage(s1, {
				type: "subscribe",
				data: { events: ["agent:*"] },
			});
			await subResponse;

			// Client 2 has no subscriptions — receives everything
			// Broadcast an agent event — both should receive
			const p1 = readWsJSON(s1);
			const p2 = readWsJSON(s2);
			wsServer.broadcast("agent:start", { agentId: "a1" });

			const [r1, r2] = await Promise.all([p1, p2]);
			expect(r1.type).toBe("agent:start");
			expect(r2.type).toBe("agent:start");

			// Now broadcast a "tool:start" event — only client 2 should receive
			// Client 1 is subscribed to "agent:*" and should NOT get "tool:start"
			const p2b = readWsJSON(s2);
			wsServer.broadcast("tool:start", { tool: "bash" });

			const r2b = await p2b;
			expect(r2b.type).toBe("tool:start");

			// Client 1 should NOT have received "tool:start"
			// We verify by sending a direct message — if tool:start was queued, it would come first
			const p1check = readWsJSON(s1);
			wsServer.sendTo(wsServer.getClientIds()[0], "check", {});
			const r1check = await p1check;
			expect(r1check.type).toBe("check"); // Not "tool:start"

			s1.destroy();
			s2.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Server shutdown
	// ═══════════════════════════════════════════════════════════════════════

	describe("shutdown", () => {
		it("should disconnect all clients on shutdown", async () => {
			const { server } = createTestServer();
			const httpServer = server;
			const wsServer = new WebSocketServer({ pingInterval: 0 });
			wsServer.attach(httpServer);
			const port = await startServer(httpServer);

			const connected = new Promise<void>((resolve) => {
				wsServer.events.onConnect = () => resolve();
			});

			const { socket } = await rawWsConnect(port);
			await connected;
			expect(wsServer.clientCount).toBe(1);

			wsServer.shutdown();
			expect(wsServer.clientCount).toBe(0);

			socket.destroy();
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		});
	});
});
