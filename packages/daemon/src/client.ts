/**
 * @chitragupta/daemon — Self-healing client.
 *
 * Connects to daemon via Unix socket with full resilience:
 * - Auto-start daemon if not running (Docker daemon pattern)
 * - Circuit breaker: HEALTHY → DEGRADED → HEALING → HEALTHY or DEAD
 * - Auto-restart daemon on crash (up to 3 attempts with backoff)
 * - Proactive heartbeat detects failures before requests do
 * - NDJSON framing, request/response correlation by id
 *
 * @module
 */

import net from "node:net";
import { resolvePaths } from "./paths.js";
import { createRequest, parseMessage, serialize, type RpcResponse } from "./protocol.js";
import { HealthMonitor, HealthState, type CircuitBreakerConfig } from "./resilience.js";

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
	/** Circuit breaker / resilience config. */
	resilience?: CircuitBreakerConfig;
	/** Enable proactive heartbeat (default: true). */
	heartbeat?: boolean;
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
	private healing = false;

	/** Health monitor — tracks circuit breaker state. */
	readonly health: HealthMonitor;

	constructor(config: DaemonClientConfig = {}) {
		this.socketPath = config.socketPath ?? resolvePaths().socket;
		this.timeout = config.timeout ?? 10_000;
		this.autoStart = config.autoStart ?? true;
		this.maxRetries = config.maxRetries ?? 5;
		this.health = new HealthMonitor(config.resilience);

		// Start heartbeat if enabled (default: true for long-lived clients)
		if (config.heartbeat !== false) {
			this.health.startHeartbeat(() => this.pingDaemon());
		}
	}

	/** Socket error codes that mean "daemon not running" (should auto-start). */
	private static readonly DAEMON_DOWN_CODES = new Set(["ECONNREFUSED", "ENOENT", "EACCES"]);

	/** Connect to the daemon. Auto-starts if needed. */
	async connect(): Promise<void> {
		if (this.connected) return;

		try {
			await this.tryConnect();
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (!this.autoStart || !code || !DaemonClient.DAEMON_DOWN_CODES.has(code)) {
				throw err;
			}
			await this.startAndRetry();
		}
	}

	/**
	 * Send an RPC request and await the response.
	 *
	 * Self-healing lifecycle:
	 * 1. If circuit is open (DEAD), throws immediately
	 * 2. Connects if needed — connect failure enters healing path
	 * 3. Sends request — on success, records healthy
	 * 4. On socket failure: disconnects, reconnects (auto-spawns), retries once
	 * 5. On repeated failures: transitions HEALTHY → DEGRADED → HEALING
	 * 6. After 3 failed restarts: circuit opens (DEAD)
	 */
	async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
		// Circuit open — don't even try
		if (this.health.isCircuitOpen()) {
			throw new DaemonUnavailableError(
				"Daemon unreachable — circuit open. Use direct access or reset.",
			);
		}

		// Connect with failure tracking — connect errors enter healing path
		if (!this.connected) {
			try {
				await this.connect();
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				const shouldHeal = this.health.recordFailure(reason);
				return this.selfHeal(method, params, shouldHeal);
			}
		}

		try {
			const result = await this.sendRequest(method, params);
			this.health.recordSuccess();
			return result;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			const shouldHeal = this.health.recordFailure(reason);

			// If socket died, attempt self-healing
			if (!this.connected || this.socket?.destroyed) {
				return this.selfHeal(method, params, shouldHeal);
			}
			throw err;
		}
	}

	/**
	 * Self-healing: reconnect, optionally restart daemon, retry the request.
	 *
	 * Flow:
	 * - Disconnect dead socket
	 * - Try reconnect (daemon may still be alive on a new connection)
	 * - If reconnect fails and in HEALING state: restart daemon
	 * - Retry the original request once
	 */
	private async selfHeal(
		method: string,
		params: Record<string, unknown> | undefined,
		shouldRestart: boolean,
	): Promise<unknown> {
		if (this.healing) {
			throw new DaemonUnavailableError("Already healing — request dropped");
		}

		this.healing = true;
		try {
			this.disconnect();

			// Try simple reconnect first (daemon may have recovered)
			try {
				await this.connect();
				const result = await this.sendRequest(method, params);
				this.health.recordSuccess();
				return result;
			} catch {
				// Reconnect failed — need daemon restart
			}

			// If health says we should restart
			if (shouldRestart && this.autoStart) {
				const healed = await this.attemptRestart();
				if (healed) {
					const result = await this.sendRequest(method, params);
					this.health.recordSuccess();
					return result;
				}
			}

			throw new DaemonUnavailableError(
				`Daemon recovery failed (state: ${this.health.getState()})`,
			);
		} finally {
			this.healing = false;
		}
	}

	/**
	 * Attempt to restart the daemon with exponential backoff.
	 * Returns true if daemon was restarted and we reconnected.
	 */
	private async attemptRestart(): Promise<boolean> {
		const cooldown = this.health.getRestartCooldown();
		await sleep(cooldown);

		try {
			const { spawnDaemon } = await import("./process.js");
			await spawnDaemon();

			// Wait and retry connection
			for (let attempt = 1; attempt <= 3; attempt++) {
				await sleep(300 * attempt);
				try {
					await this.tryConnect();
					this.health.recordRestartAttempt(true);
					return true;
				} catch {
					// Keep trying
				}
			}
		} catch {
			// Spawn failed
		}

		return this.health.recordRestartAttempt(false);
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

			try {
				this.socket!.write(serialize(req));
			} catch (err) {
				this.pending.delete(req.id);
				clearTimeout(timer);
				reject(err);
			}
		});
	}

	/** Send a notification (fire-and-forget, no response). */
	notify(method: string, params?: Record<string, unknown>): void {
		if (!this.connected || !this.socket) return;
		const msg = { jsonrpc: "2.0" as const, method, params };
		try {
			this.socket.write(JSON.stringify(msg) + "\n");
		} catch {
			// Best-effort — notifications are fire-and-forget
		}
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

	/** Full cleanup — disconnect + dispose health monitor. */
	dispose(): void {
		this.disconnect();
		this.health.dispose();
	}

	/** Whether the client is connected. */
	isConnected(): boolean {
		return this.connected;
	}

	/** Current health state. */
	healthState(): HealthState {
		return this.health.getState();
	}

	/** Reset circuit breaker — use after manual daemon restart. */
	resetCircuit(): void {
		this.health.reset();
	}

	/** Silent ping for heartbeat — returns true if daemon responds. */
	private async pingDaemon(): Promise<boolean> {
		if (!this.connected || !this.socket) return false;
		try {
			const result = await this.sendRequest("daemon.ping");
			return (result as { pong?: boolean })?.pong === true;
		} catch {
			return false;
		}
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

/** Error thrown when daemon is unreachable and circuit is open. */
export class DaemonUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DaemonUnavailableError";
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
