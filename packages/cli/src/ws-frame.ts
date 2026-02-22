/**
 * @chitragupta/cli — WebSocket frame encoding/decoding and handshake.
 *
 * Pure Node.js RFC 6455 frame parser and encoder.
 * Extracted from ws-handler.ts to keep file sizes under 450 LOC.
 */

import http from "node:http";
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

/** The magic GUID specified in RFC 6455 section 4.2.2 */
export const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-5AB9F3907FEE";

/** WebSocket frame opcodes */
export enum Opcode {
	Continuation = 0x0,
	Text = 0x1,
	Binary = 0x2,
	Close = 0x8,
	Ping = 0x9,
	Pong = 0xa,
}

/** Maximum payload length we accept for a single frame (16 MiB). */
export const MAX_PAYLOAD_LENGTH = 16 * 1024 * 1024;

/** Default ping interval in milliseconds. */
export const DEFAULT_PING_INTERVAL = 30_000;

/** Default maximum concurrent connections. */
export const DEFAULT_MAX_CONNECTIONS = 10;

/**
 * Result of parsing a single WebSocket frame from a buffer.
 */
export interface ParsedFrame {
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
 * Encode a WebSocket frame.
 *
 * Server-to-client frames are NOT masked (per RFC 6455 section 5.1).
 *
 * @param opcode - The frame opcode.
 * @param payload - The payload data.
 * @returns The encoded frame buffer.
 */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
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
		frame.writeUInt32BE(0, 2);
		frame.writeUInt32BE(len, 6);
	}

	payload.copy(frame, headerLen);
	return frame;
}

/**
 * Try to parse one WebSocket frame from the buffer.
 *
 * Returns null if the buffer does not yet contain a complete frame.
 * Client-to-server frames MUST be masked (RFC 6455 section 5.1).
 *
 * @param buffer - The raw data buffer.
 * @param offset - Offset into the buffer to start parsing.
 * @returns Parsed frame or null if incomplete.
 */
export function parseFrame(buffer: Buffer, offset: number = 0): ParsedFrame | null {
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
		const high = buffer.readUInt32BE(offset + 2);
		const low = buffer.readUInt32BE(offset + 6);
		if (high !== 0) return null;
		payloadLen = low;
		headerLen = 10;
	}

	if (payloadLen > MAX_PAYLOAD_LENGTH) return null;

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

/**
 * Compute the Sec-WebSocket-Accept value per RFC 6455 section 4.2.2.
 *
 * @param secWebSocketKey - The client's Sec-WebSocket-Key header value.
 * @returns The base64-encoded accept key.
 */
export function computeAcceptKey(secWebSocketKey: string): string {
	return createHash("sha1")
		.update(secWebSocketKey + WS_MAGIC_GUID)
		.digest("base64");
}

/**
 * Validate the handshake request headers.
 * Returns the Sec-WebSocket-Key if valid, or null if the handshake should be rejected.
 *
 * @param req - The HTTP upgrade request.
 * @returns The WebSocket key or null.
 */
export function validateHandshake(req: http.IncomingMessage): string | null {
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
 *
 * @param socket - The raw duplex socket.
 * @param acceptKey - The computed accept key.
 */
export function sendHandshakeResponse(socket: Duplex, acceptKey: string): void {
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
 *
 * @param socket - The raw duplex socket.
 * @param statusCode - HTTP status code.
 * @param message - Error message.
 */
export function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
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
