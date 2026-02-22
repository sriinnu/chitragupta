/**
 * @chitragupta/cli — WebSocket client implementation.
 *
 * Internal WsClient class that wraps a raw Duplex socket and provides
 * the WebSocketClient interface: send, close, onMessage, onClose.
 * Handles frame fragmentation reassembly.
 * Extracted from ws-handler.ts to keep file sizes under 450 LOC.
 */

import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import type { AuthContext } from "@chitragupta/core";
import { Opcode, encodeFrame } from "./ws-frame.js";
import type { WebSocketClient, WebSocketMessage } from "./ws-types.js";

// ─── Internal Client Implementation ─────────────────────────────────────────

export class WsClient implements WebSocketClient {
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


