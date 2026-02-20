/**
 * @chitragupta/tantra — Stdio transport for MCP.
 *
 * StdioServerTransport reads JSON-RPC from stdin, writes to stdout.
 * StdioClientTransport spawns a child process and communicates over its stdio.
 *
 * Transport compatibility:
 * - Primary: MCP framed messages (`Content-Length: ...\r\n\r\n{json}`)
 * - Fallback: line-delimited JSON (legacy/internal compatibility)
 * @module transport/stdio
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../types.js";
import { parseMessage } from "../jsonrpc.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
type MessageHandler = (msg: AnyMessage) => void;

const HEADER_DELIMITER = "\r\n\r\n";
const NEWLINE = "\n";

/** Create a zero-length Buffer. */
function emptyBuffer(): Buffer {
	return Buffer.alloc(0);
}

/** Encode a JSON-RPC message using MCP Content-Length framing. */
function encodeFramedMessage(message: AnyMessage): string {
	const payload = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(payload, "utf8")}${HEADER_DELIMITER}${payload}`;
}

/** Parse result from a consume attempt. */
interface ConsumeResult {
	consumed: number;
	raw: string;
}

/**
 * Try to consume a Content-Length framed message from the buffer.
 * Returns null if not enough data, "invalid" if header is malformed,
 * or a ConsumeResult with consumed byte count and raw JSON string.
 */
function tryConsumeFramedMessage(buffer: Buffer): ConsumeResult | "invalid" | null {
	const headerEnd = buffer.indexOf(HEADER_DELIMITER);
	if (headerEnd === -1) return null;

	const header = buffer.slice(0, headerEnd).toString("utf8");
	const match = header.match(/Content-Length:\s*(\d+)/i);
	if (!match) return "invalid";

	const bodyLength = Number.parseInt(match[1], 10);
	if (!Number.isFinite(bodyLength) || bodyLength < 0) return "invalid";

	const start = headerEnd + Buffer.byteLength(HEADER_DELIMITER, "utf8");
	const end = start + bodyLength;
	if (buffer.length < end) return null;

	return {
		consumed: end,
		raw: buffer.slice(start, end).toString("utf8"),
	};
}

/**
 * Try to consume a newline-delimited message from the buffer.
 * Returns null if no complete line, or a ConsumeResult.
 */
function tryConsumeLineMessage(buffer: Buffer): ConsumeResult | null {
	const newlineIndex = buffer.indexOf(NEWLINE);
	if (newlineIndex === -1) return null;

	const raw = buffer.slice(0, newlineIndex).toString("utf8").trim();
	return {
		consumed: newlineIndex + 1,
		raw,
	};
}

/** Skip leading \n and \r bytes from the buffer. */
function trimLeadingNewlines(buffer: Buffer): Buffer {
	let idx = 0;
	while (idx < buffer.length) {
		const c = buffer[idx];
		if (c !== 0x0a && c !== 0x0d) break;
		idx += 1;
	}
	return idx > 0 ? buffer.slice(idx) : buffer;
}

/** Parse raw JSON into a message and deliver to handler. */
function deliverRawMessage(raw: string, handler: MessageHandler | null): void {
	if (!raw) return;
	const msg = parseMessage(raw);
	if (msg && handler) {
		handler(msg);
	}
}

// ─── StdioServerTransport ───────────────────────────────────────────────────

/**
 * Server-side stdio transport.
 *
 * Reads JSON-RPC messages from process.stdin and writes responses to stdout.
 * Accepts both framed MCP and legacy line-delimited JSON payloads.
 */
export class StdioServerTransport {
	private _handler: MessageHandler | null = null;
	private _buffer: Buffer = emptyBuffer();
	private _running = false;
	private _onData: ((chunk: Buffer | string) => void) | null = null;

	/**
	 * Register a handler for incoming messages.
	 *
	 * @param handler - Callback invoked for each parsed JSON-RPC message.
	 */
	onMessage(handler: MessageHandler): void {
		this._handler = handler;
	}

	/**
	 * Send a JSON-RPC message to stdout.
	 *
	 * Uses framed MCP transport to interoperate with standards-compliant hosts.
	 *
	 * @param message - The JSON-RPC message to send.
	 */
	send(message: AnyMessage): void {
		process.stdout.write(encodeFramedMessage(message));
	}

	/**
	 * Start reading from stdin. Messages are parsed and dispatched to the handler.
	 */
	start(): void {
		if (this._running) return;
		this._running = true;
		this._buffer = emptyBuffer();

		this._onData = (chunk: Buffer | string) => {
			const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
			this._buffer = Buffer.concat([this._buffer, incoming]);
			this._drain();
		};

		process.stdin.on("data", this._onData);
		process.stdin.resume();
	}

	/** Stop reading from stdin. */
	stop(): void {
		if (!this._running) return;
		this._running = false;

		if (this._onData) {
			process.stdin.off("data", this._onData);
			this._onData = null;
		}
		process.stdin.pause();
	}

	/**
	 * Drain buffered bytes into parsed JSON-RPC messages.
	 *
	 * Tries Content-Length framing first; falls back to line-delimited JSON.
	 */
	private _drain(): void {
		while (this._buffer.length > 0) {
			this._buffer = trimLeadingNewlines(this._buffer);
			if (this._buffer.length === 0) return;

			// Try Content-Length framing first
			const framed = tryConsumeFramedMessage(this._buffer);
			if (framed === "invalid") {
				// Invalid header — try line-delimited fallback
				const line = tryConsumeLineMessage(this._buffer);
				if (!line) return;
				this._buffer = this._buffer.slice(line.consumed);
				deliverRawMessage(line.raw, this._handler);
				continue;
			}
			if (framed) {
				this._buffer = this._buffer.slice(framed.consumed);
				deliverRawMessage(framed.raw, this._handler);
				continue;
			}

			// Not enough data for a frame — try line fallback
			const line = tryConsumeLineMessage(this._buffer);
			if (!line) return;
			this._buffer = this._buffer.slice(line.consumed);
			deliverRawMessage(line.raw, this._handler);
		}
	}
}

// ─── StdioClientTransport ───────────────────────────────────────────────────

/**
 * Client-side stdio transport.
 *
 * Spawns a child process and communicates over its stdin/stdout.
 * Sends framed MCP messages; accepts framed and line-delimited responses.
 */
export class StdioClientTransport {
	private _child: ChildProcess | null = null;
	private _handler: MessageHandler | null = null;
	private _buffer: Buffer = emptyBuffer();

	/**
	 * Register a handler for incoming messages from the child process.
	 *
	 * @param handler - Callback invoked for each parsed JSON-RPC message.
	 */
	onMessage(handler: MessageHandler): void {
		this._handler = handler;
	}

	/**
	 * Send a JSON-RPC message to the child process's stdin.
	 *
	 * @param message - The JSON-RPC message to send.
	 * @throws If not connected.
	 */
	send(message: AnyMessage): void {
		if (!this._child || !this._child.stdin) {
			throw new Error("StdioClientTransport: not connected");
		}
		this._child.stdin.write(encodeFramedMessage(message));
	}

	/**
	 * Spawn the child process and begin communication.
	 *
	 * @param command - The executable command to spawn.
	 * @param args - Optional command-line arguments.
	 */
	connect(command: string, args: string[] = []): void {
		if (this._child) {
			this.disconnect();
		}

		this._buffer = emptyBuffer();

		this._child = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this._child.stdout?.on("data", (chunk: Buffer | string) => {
			const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
			this._buffer = Buffer.concat([this._buffer, incoming]);
			this._drain();
		});

		this._child.on("error", () => {
			// Suppressed to avoid interfering with JSON-RPC communication on stderr.
		});

		this._child.on("close", () => {
			this._child = null;
		});
	}

	/** Kill the child process and disconnect. */
	disconnect(): void {
		if (this._child) {
			this._child.kill();
			this._child = null;
		}
		this._buffer = emptyBuffer();
	}

	/**
	 * Drain buffered bytes into parsed JSON-RPC messages.
	 *
	 * Tries Content-Length framing first; falls back to line-delimited JSON.
	 */
	private _drain(): void {
		while (this._buffer.length > 0) {
			this._buffer = trimLeadingNewlines(this._buffer);
			if (this._buffer.length === 0) return;

			const framed = tryConsumeFramedMessage(this._buffer);
			if (framed === "invalid") {
				const line = tryConsumeLineMessage(this._buffer);
				if (!line) return;
				this._buffer = this._buffer.slice(line.consumed);
				deliverRawMessage(line.raw, this._handler);
				continue;
			}
			if (framed) {
				this._buffer = this._buffer.slice(framed.consumed);
				deliverRawMessage(framed.raw, this._handler);
				continue;
			}

			const line = tryConsumeLineMessage(this._buffer);
			if (!line) return;
			this._buffer = this._buffer.slice(line.consumed);
			deliverRawMessage(line.raw, this._handler);
		}
	}
}
