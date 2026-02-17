/**
 * Sandhana Pariikshaka — WebSocket load test client for Chitragupta.
 * Sanskrit: Sandhana (संधान) = connection, Pariikshaka (परीक्षक) = tester.
 *
 * Raw TCP-level WebSocket client for load testing. Performs the
 * HTTP Upgrade handshake manually and encodes/decodes frames using
 * the same logic as ws-handler.ts. NO external dependencies.
 */

import net from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

// ─── Constants ───────────────────────────────────────────────────────────────

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB9F3907FEE";

const Opcode = {
	Text: 0x1,
	Close: 0x8,
	Ping: 0x9,
	Pong: 0xa,
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WsChatResult {
	duration: number;
	response: string;
}

export interface WsPingResult {
	duration: number;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class LoadWsClient {
	private socket: net.Socket | null = null;
	private readonly url: string;
	private readonly authToken?: string;
	private buffer: Buffer = Buffer.alloc(0);
	private connected = false;

	/** Pending response resolvers keyed by requestId. */
	private pending = new Map<string, {
		resolve: (value: unknown) => void;
		reject: (err: Error) => void;
		accumulated: string;
	}>();

	/** Accumulated metrics. */
	messagesReceived = 0;
	errorsCount = 0;
	latencies: number[] = [];

	constructor(url: string, authToken?: string) {
		this.url = url;
		this.authToken = authToken;
	}

	/** Perform the WebSocket upgrade handshake. */
	async connect(): Promise<void> {
		const parsed = new URL(this.url);
		const host = parsed.hostname;
		const port = parseInt(parsed.port || "80", 10);
		const path = parsed.pathname || "/";

		return new Promise<void>((resolve, reject) => {
			const socket = net.createConnection({ host, port }, () => {
				const wsKey = randomBytes(16).toString("base64");
				const expectedAccept = createHash("sha1")
					.update(wsKey + WS_MAGIC_GUID)
					.digest("base64");

				const reqLines = [
					`GET ${path} HTTP/1.1`,
					`Host: ${host}:${port}`,
					"Upgrade: websocket",
					"Connection: Upgrade",
					`Sec-WebSocket-Key: ${wsKey}`,
					"Sec-WebSocket-Version: 13",
				];

				if (this.authToken) {
					reqLines.push(`Authorization: Bearer ${this.authToken}`);
				}

				reqLines.push("", "");
				socket.write(reqLines.join("\r\n"));

				let handshakeData = "";
				const onData = (chunk: Buffer) => {
					handshakeData += chunk.toString();
					if (handshakeData.includes("\r\n\r\n")) {
						socket.removeListener("data", onData);

						if (!handshakeData.startsWith("HTTP/1.1 101")) {
							socket.destroy();
							reject(new Error(`WebSocket handshake failed: ${handshakeData.split("\r\n")[0]}`));
							return;
						}

						// Verify Sec-WebSocket-Accept
						const acceptMatch = handshakeData.match(/Sec-WebSocket-Accept:\s*(.+)/i);
						if (!acceptMatch || acceptMatch[1].trim() !== expectedAccept) {
							socket.destroy();
							reject(new Error("Invalid Sec-WebSocket-Accept"));
							return;
						}

						this.socket = socket;
						this.connected = true;

						// Switch to frame-based processing
						socket.on("data", (data: Buffer) => this.onFrameData(data));
						resolve();
					}
				};

				socket.on("data", onData);
			});

			socket.on("error", (err) => {
				if (!this.connected) {
					reject(err);
				} else {
					this.errorsCount++;
				}
			});

			setTimeout(() => {
				if (!this.connected) {
					socket.destroy();
					reject(new Error("WebSocket connect timeout"));
				}
			}, 5000);
		});
	}

	/** Send a chat message and wait for the chat:done response. */
	async sendChat(message: string): Promise<WsChatResult> {
		if (!this.connected || !this.socket) {
			throw new Error("WebSocket not connected");
		}

		const requestId = randomUUID();
		const startMs = performance.now();

		const promise = new Promise<unknown>((resolve, reject) => {
			this.pending.set(requestId, { resolve, reject, accumulated: "" });

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.pending.has(requestId)) {
					this.pending.delete(requestId);
					reject(new Error("Chat response timeout"));
				}
			}, 30_000);
		});

		const payload = JSON.stringify({
			type: "chat",
			data: { message },
			requestId,
		});

		this.sendFrame(Opcode.Text, Buffer.from(payload, "utf-8"));

		const response = await promise;
		const duration = performance.now() - startMs;
		this.latencies.push(duration);

		return { duration, response: response as string };
	}

	/** Send a ping and measure round-trip time. */
	async sendPing(): Promise<WsPingResult> {
		if (!this.connected || !this.socket) {
			throw new Error("WebSocket not connected");
		}

		const startMs = performance.now();
		const requestId = randomUUID();

		const promise = new Promise<void>((resolve, reject) => {
			this.pending.set(requestId, {
				resolve: () => resolve(),
				reject,
				accumulated: "",
			});

			setTimeout(() => {
				if (this.pending.has(requestId)) {
					this.pending.delete(requestId);
					reject(new Error("Ping timeout"));
				}
			}, 5000);
		});

		const payload = JSON.stringify({ type: "ping", requestId });
		this.sendFrame(Opcode.Text, Buffer.from(payload, "utf-8"));

		await promise;
		const duration = performance.now() - startMs;
		this.latencies.push(duration);

		return { duration };
	}

	/** Close the WebSocket connection. */
	disconnect(): void {
		if (this.socket) {
			// Send close frame
			const payload = Buffer.alloc(2);
			payload.writeUInt16BE(1000, 0);
			this.sendFrame(Opcode.Close, payload);

			setTimeout(() => {
				this.socket?.destroy();
				this.socket = null;
				this.connected = false;
			}, 100);
		}
	}

	isConnected(): boolean {
		return this.connected;
	}

	// ─── Frame Handling ──────────────────────────────────────────────────

	/**
	 * Accumulate data and attempt to parse server-to-client frames.
	 * Server frames are NOT masked (per RFC 6455).
	 */
	private onFrameData(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);

		while (this.buffer.length >= 2) {
			const parsed = this.parseServerFrame(this.buffer);
			if (!parsed) break; // Incomplete frame

			this.buffer = this.buffer.subarray(parsed.bytesConsumed);

			if (parsed.opcode === Opcode.Text) {
				this.messagesReceived++;
				const text = parsed.payload.toString("utf-8");
				try {
					const msg = JSON.parse(text);
					this.handleMessage(msg);
				} catch {
					// Non-JSON frame — ignore
				}
			} else if (parsed.opcode === Opcode.Ping) {
				// Respond with pong
				this.sendFrame(Opcode.Pong, parsed.payload);
			} else if (parsed.opcode === Opcode.Close) {
				this.connected = false;
				this.socket?.destroy();
				this.socket = null;
			}
		}
	}

	/** Handle a parsed JSON message from the server. */
	private handleMessage(msg: { type?: string; data?: unknown; requestId?: string }): void {
		const requestId = msg.requestId;
		if (!requestId) return;

		const entry = this.pending.get(requestId);
		if (!entry) return;

		switch (msg.type) {
			case "pong": {
				this.pending.delete(requestId);
				entry.resolve(undefined);
				break;
			}
			case "stream:text": {
				const text = typeof msg.data === "string" ? msg.data : "";
				entry.accumulated += text;
				break;
			}
			case "chat:done": {
				this.pending.delete(requestId);
				const data = msg.data as { response?: string } | undefined;
				entry.resolve(entry.accumulated || data?.response || "");
				break;
			}
			case "chat:error": {
				this.pending.delete(requestId);
				const data = msg.data as { error?: string } | undefined;
				entry.reject(new Error(data?.error ?? "Chat error"));
				this.errorsCount++;
				break;
			}
			case "chat:start":
				// Acknowledgement — nothing to do
				break;
			default:
				break;
		}
	}

	/**
	 * Encode and send a masked client-to-server WebSocket frame.
	 * Client frames MUST be masked per RFC 6455.
	 */
	private sendFrame(opcode: number, payload: Buffer): void {
		if (!this.socket) return;

		const len = payload.length;
		const maskKey = randomBytes(4);
		let headerLen: number;

		if (len < 126) {
			headerLen = 6; // 2 header + 4 mask
		} else if (len < 65536) {
			headerLen = 8; // 2 header + 2 ext + 4 mask
		} else {
			headerLen = 14; // 2 header + 8 ext + 4 mask
		}

		const frame = Buffer.alloc(headerLen + len);

		// FIN + opcode
		frame[0] = 0x80 | opcode;

		// Payload length with mask bit set
		if (len < 126) {
			frame[1] = 0x80 | len;
			maskKey.copy(frame, 2);
		} else if (len < 65536) {
			frame[1] = 0x80 | 126;
			frame.writeUInt16BE(len, 2);
			maskKey.copy(frame, 4);
		} else {
			frame[1] = 0x80 | 127;
			frame.writeUInt32BE(0, 2);
			frame.writeUInt32BE(len, 6);
			maskKey.copy(frame, 10);
		}

		// Mask and copy payload
		for (let i = 0; i < len; i++) {
			frame[headerLen + i] = payload[i] ^ maskKey[i & 3];
		}

		try {
			this.socket.write(frame);
		} catch {
			// Socket may be destroyed
			this.errorsCount++;
		}
	}

	/**
	 * Parse a single server-to-client frame (NOT masked).
	 * Returns null if the buffer does not contain a complete frame.
	 */
	private parseServerFrame(buffer: Buffer): {
		opcode: number;
		payload: Buffer;
		bytesConsumed: number;
	} | null {
		if (buffer.length < 2) return null;

		const opcode = buffer[0] & 0x0f;
		const masked = (buffer[1] & 0x80) !== 0;
		let payloadLen = buffer[1] & 0x7f;
		let offset = 2;

		if (payloadLen === 126) {
			if (buffer.length < 4) return null;
			payloadLen = buffer.readUInt16BE(2);
			offset = 4;
		} else if (payloadLen === 127) {
			if (buffer.length < 10) return null;
			payloadLen = buffer.readUInt32BE(6); // Ignore high 32 bits
			offset = 10;
		}

		// Server frames should NOT be masked, but handle gracefully
		if (masked) {
			offset += 4;
		}

		if (buffer.length < offset + payloadLen) return null;

		let payload = buffer.subarray(offset, offset + payloadLen);

		if (masked) {
			const maskKey = buffer.subarray(offset - 4, offset);
			payload = Buffer.from(payload); // Copy to avoid modifying buffer
			for (let i = 0; i < payloadLen; i++) {
				payload[i] ^= maskKey[i & 3];
			}
		}

		return {
			opcode,
			payload,
			bytesConsumed: offset + payloadLen,
		};
	}
}
