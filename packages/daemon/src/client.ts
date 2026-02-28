/**
 * @chitragupta/daemon — Client: connect to daemon via Unix socket.
 *
 * Auto-starts the daemon if not running (Docker daemon pattern).
 * NDJSON framing, request/response correlation by id.
 *
 * @module
 */

import net from "node:net";
import { resolvePaths } from "./paths.js";
import { createRequest, parseMessage, serialize, type RpcResponse } from "./protocol.js";

/** Client configuration. */
export interface DaemonClientConfig {
	/** Override socket path (default: auto-resolve). */
	socketPath?: string;
	/** Request timeout in ms (default: 10_000). */
	timeout?: number;
	/** Auto-start daemon if not running (default: true). */
	autoStart?: boolean;
	/** Max retries after auto-start (default: 5). */
	maxRetries?: number;
}

/** Pending request waiting for a response. */
interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** Client connection to the chitragupta daemon. */
export class DaemonClient {
	private socket: net.Socket | null = null;
	private buffer = "";
	private readonly pending = new Map<string | number, PendingRequest>();
	private readonly socketPath: string;
	private readonly timeout: number;
	private readonly autoStart: boolean;
	private readonly maxRetries: number;
	private connected = false;

	constructor(config: DaemonClientConfig = {}) {
		this.socketPath = config.socketPath ?? resolvePaths().socket;
		this.timeout = config.timeout ?? 10_000;
		this.autoStart = config.autoStart ?? true;
		this.maxRetries = config.maxRetries ?? 5;
	}

	/** Connect to the daemon. Auto-starts if needed. */
	async connect(): Promise<void> {
		if (this.connected) return;

		try {
			await this.tryConnect();
		} catch (err) {
			if (!this.autoStart || (err as NodeJS.ErrnoException).code !== "ECONNREFUSED") {
				throw err;
			}
			await this.startAndRetry();
		}
	}

	/**
	 * Send an RPC request and await the response.
	 * Self-healing: if socket dies mid-call, reconnects and retries once.
	 */
	async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.connected) await this.connect();

		try {
			return await this.sendRequest(method, params);
		} catch (err) {
			// Self-heal: if write fails (daemon crashed), reconnect and retry once
			if (!this.connected || this.socket?.destroyed) {
				this.disconnect();
				await this.connect();
				return this.sendRequest(method, params);
			}
			throw err;
		}
	}

	/** Internal: send a request and await correlation. */
	private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const req = createRequest(method, params);
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(req.id);
				reject(new Error(`Request timeout: ${method} (${this.timeout}ms)`));
			}, this.timeout);

			this.pending.set(req.id, { resolve, reject, timer });
			this.socket!.write(serialize(req));
		});
	}

	/** Send a notification (fire-and-forget, no response). */
	notify(method: string, params?: Record<string, unknown>): void {
		if (!this.connected || !this.socket) return;
		const msg = { jsonrpc: "2.0" as const, method, params };
		this.socket.write(JSON.stringify(msg) + "\n");
	}

	/** Disconnect from the daemon. */
	disconnect(): void {
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Client disconnected"));
		}
		this.pending.clear();
		this.socket?.destroy();
		this.socket = null;
		this.connected = false;
		this.buffer = "";
	}

	/** Whether the client is connected. */
	isConnected(): boolean {
		return this.connected;
	}

	/** Attempt a single connection to the socket. */
	private tryConnect(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const socket = net.createConnection(this.socketPath);
			let settled = false;

			socket.on("connect", () => {
				settled = true;
				this.socket = socket;
				this.connected = true;
				this.buffer = "";
				resolve();
			});

			socket.on("data", (chunk) => {
				this.buffer += chunk.toString("utf-8");
				this.processBuffer();
			});

			socket.on("close", () => {
				this.connected = false;
				this.socket = null;
			});

			socket.on("error", (err) => {
				if (!settled) {
					settled = true;
					reject(err);
				}
			});
		});
	}

	/** Process NDJSON buffer, resolve pending requests. */
	private processBuffer(): void {
		let idx: number;
		while ((idx = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (!line) continue;

			const msg = parseMessage(line);
			if (!msg || !("id" in msg)) continue;

			const resp = msg as RpcResponse;
			const pending = this.pending.get(resp.id);
			if (!pending) continue;

			clearTimeout(pending.timer);
			this.pending.delete(resp.id);

			if (resp.error) {
				pending.reject(new Error(`${resp.error.message} (code: ${resp.error.code})`));
			} else {
				pending.resolve(resp.result);
			}
		}
	}

	/** Auto-start daemon and retry connection. */
	private async startAndRetry(): Promise<void> {
		const { spawnDaemon } = await import("./process.js");
		await spawnDaemon();

		for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
			await sleep(200 * attempt);
			try {
				await this.tryConnect();
				return;
			} catch {
				if (attempt === this.maxRetries) {
					throw new Error(`Failed to connect after ${this.maxRetries} retries`);
				}
			}
		}
	}
}

/** Helper: sleep for ms. */
function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Convenience: create a connected client. */
export async function createClient(config?: DaemonClientConfig): Promise<DaemonClient> {
	const client = new DaemonClient(config);
	await client.connect();
	return client;
}
