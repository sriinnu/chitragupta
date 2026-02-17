/**
 * @chitragupta/tantra — Stdio transport for MCP.
 *
 * StdioServerTransport reads JSON-RPC from stdin, writes to stdout.
 * StdioClientTransport spawns a child process and communicates over its stdio.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../types.js";
import { parseMessage } from "../jsonrpc.js";

type AnyMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
type MessageHandler = (msg: AnyMessage) => void;

// ─── StdioServerTransport ───────────────────────────────────────────────────

/**
 * Server-side stdio transport.
 *
 * Reads line-delimited JSON-RPC messages from process.stdin and writes
 * JSON-RPC responses to process.stdout. Used by MCP servers that
 * communicate over stdio.
 */
export class StdioServerTransport {
	private _handler: MessageHandler | null = null;
	private _buffer = "";
	private _running = false;
	private _onData: ((chunk: Buffer) => void) | null = null;

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
	 * @param message - The JSON-RPC message to send.
	 */
	send(message: AnyMessage): void {
		const line = JSON.stringify(message) + "\n";
		process.stdout.write(line);
	}

	/**
	 * Start reading from stdin. Messages are parsed and dispatched to the handler.
	 */
	start(): void {
		if (this._running) return;
		this._running = true;
		this._buffer = "";

		this._onData = (chunk: Buffer) => {
			this._buffer += chunk.toString("utf-8");
			this._drain();
		};

		process.stdin.setEncoding("utf-8");
		process.stdin.on("data", this._onData);
		process.stdin.resume();
	}

	/**
	 * Stop reading from stdin.
	 */
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
	 * Drain the buffer, extracting complete lines and parsing them.
	 */
	private _drain(): void {
		let newlineIdx = this._buffer.indexOf("\n");
		while (newlineIdx !== -1) {
			const line = this._buffer.slice(0, newlineIdx).trim();
			this._buffer = this._buffer.slice(newlineIdx + 1);

			if (line.length > 0) {
				const msg = parseMessage(line);
				if (msg && this._handler) {
					this._handler(msg);
				}
			}

			newlineIdx = this._buffer.indexOf("\n");
		}
	}
}

// ─── StdioClientTransport ───────────────────────────────────────────────────

/**
 * Client-side stdio transport.
 *
 * Spawns a child process and communicates over its stdin/stdout.
 * Used by MCP clients that connect to server processes via stdio.
 */
export class StdioClientTransport {
	private _child: ChildProcess | null = null;
	private _handler: MessageHandler | null = null;
	private _buffer = "";
	private _command = "";
	private _args: string[] = [];

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
		const line = JSON.stringify(message) + "\n";
		this._child.stdin.write(line);
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

		this._command = command;
		this._args = args;
		this._buffer = "";

		this._child = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this._child.stdout?.setEncoding("utf-8");
		this._child.stdout?.on("data", (chunk: string) => {
			this._buffer += chunk;
			this._drain();
		});

		this._child.on("error", (_err) => {
			// Error is already propagated through the child process 'close' event.
			// Suppressed to avoid interfering with JSON-RPC communication on stderr.
		});

		this._child.on("close", (_code) => {
			this._child = null;
		});
	}

	/**
	 * Kill the child process and disconnect.
	 */
	disconnect(): void {
		if (this._child) {
			this._child.kill();
			this._child = null;
		}
		this._buffer = "";
	}

	/**
	 * Drain the buffer, extracting complete lines and parsing them.
	 */
	private _drain(): void {
		let newlineIdx = this._buffer.indexOf("\n");
		while (newlineIdx !== -1) {
			const line = this._buffer.slice(0, newlineIdx).trim();
			this._buffer = this._buffer.slice(newlineIdx + 1);

			if (line.length > 0) {
				const msg = parseMessage(line);
				if (msg && this._handler) {
					this._handler(msg);
				}
			}

			newlineIdx = this._buffer.indexOf("\n");
		}
	}
}
