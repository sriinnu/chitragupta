/**
 * Scarlett — Self-Healing Daemon Watchdog.
 *
 * Named after Scarlett Johansson, who played Lucy — resilient,
 * survives everything, self-heals at 20% neural capacity.
 *
 * Monitors the Chitragupta daemon process and auto-restarts on crash.
 * Uses exponential backoff with restart storm prevention.
 *
 * @module
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createLogger } from "@chitragupta/core";
import { resolvePaths, type DaemonPaths } from "./paths.js";
import { readPid, removePid, isProcessAlive, spawnDaemon } from "./process.js";

const log = createLogger("daemon:scarlett");

/** Events emitted by ScarlettWatchdog. */
export interface ScarlettEvents {
	"crash-detected": [pid: number | null, reason: string];
	"restart-attempt": [attempt: number, backoffMs: number];
	"restart-success": [newPid: number];
	"restart-failed": [attempt: number, error: string];
	"storm-detected": [restartCount: number, windowMs: number];
	"giving-up": [reason: string];
}

/** Configuration for the watchdog. */
export interface ScarlettConfig {
	/** Poll interval in ms (default: 10_000). */
	pollIntervalMs?: number;
	/** Max restarts within the storm window before giving up (default: 5). */
	maxRestartsInWindow?: number;
	/** Storm detection window in ms (default: 300_000 = 5 minutes). */
	stormWindowMs?: number;
	/** Base backoff delay in ms — doubles each attempt (default: 1000). */
	baseBackoffMs?: number;
	/** Override daemon paths (for testing). */
	paths?: DaemonPaths;
}

const DEFAULTS: Required<Omit<ScarlettConfig, "paths">> = {
	pollIntervalMs: 10_000,
	maxRestartsInWindow: 5,
	stormWindowMs: 300_000,
	baseBackoffMs: 1000,
};

/**
 * Self-healing daemon watchdog.
 *
 * Periodically checks if the daemon process is alive by:
 * 1. Reading the PID file and checking `kill(pid, 0)`
 * 2. Attempting a socket ping (connection test)
 *
 * On crash detection:
 * - Cleans stale PID/socket files
 * - Calls `spawnDaemon()` with exponential backoff
 * - Tracks restarts in a sliding window for storm prevention
 * - Gives up after too many restarts in a short window
 */
export class ScarlettWatchdog extends EventEmitter<ScarlettEvents> {
	private readonly config: Required<Omit<ScarlettConfig, "paths">>;
	private readonly paths: DaemonPaths;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private readonly restartTimestamps: number[] = [];
	private consecutiveFailures = 0;
	private running = false;
	private checking = false;

	constructor(config: ScarlettConfig = {}) {
		super();
		const { paths: userPaths, ...rest } = config;
		this.config = { ...DEFAULTS, ...rest };
		this.paths = userPaths ?? resolvePaths();
	}

	/** Start the watchdog polling loop. */
	start(): void {
		if (this.running) return;
		this.running = true;
		log.info("Scarlett watchdog started", {
			pollMs: this.config.pollIntervalMs,
			maxRestarts: this.config.maxRestartsInWindow,
			stormWindowMs: this.config.stormWindowMs,
		});

		this.pollTimer = setInterval(() => {
			this.check().catch((err) => {
				log.error("Watchdog check error", err instanceof Error ? err : undefined);
			});
		}, this.config.pollIntervalMs);

		// Don't prevent process exit
		if (this.pollTimer.unref) this.pollTimer.unref();
	}

	/** Stop the watchdog and clean up. */
	stop(): void {
		if (!this.running) return;
		this.running = false;

		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}

		this.removeAllListeners();
		log.info("Scarlett watchdog stopped");
	}

	/** Whether the watchdog is actively polling. */
	isRunning(): boolean {
		return this.running;
	}

	/** Number of restarts within the current storm window. */
	restartsInWindow(): number {
		const cutoff = Date.now() - this.config.stormWindowMs;
		return this.restartTimestamps.filter((t) => t > cutoff).length;
	}

	/**
	 * Single health check cycle.
	 *
	 * 1. Check PID file — if missing, daemon was never started (skip)
	 * 2. If PID exists but process dead → crash detected, attempt restart
	 * 3. If PID alive, verify socket connectivity as secondary check
	 */
	async check(): Promise<void> {
		if (this.checking) return;
		this.checking = true;

		try {
			const pid = readPid(this.paths.pid);

			// No PID file — daemon was never started or was cleanly stopped
			if (pid === null) {
				this.consecutiveFailures = 0;
				return;
			}

			// PID file exists — check if process is alive
			if (!isProcessAlive(pid)) {
				log.warn("Daemon crash detected", { stalePid: pid });
				this.emit("crash-detected", pid, "process not alive");
				await this.cleanupAndRestart();
				return;
			}

			// Process alive — verify socket is reachable
			const socketOk = await this.pingSocket();
			if (!socketOk) {
				this.consecutiveFailures++;
				// Only trigger restart after 3 consecutive socket failures
				// (process may be starting up or temporarily busy)
				if (this.consecutiveFailures >= 3) {
					log.warn("Daemon unresponsive", { pid, failures: this.consecutiveFailures });
					this.emit("crash-detected", pid, "socket unreachable");
					await this.cleanupAndRestart();
				}
				return;
			}

			// All good — reset failure counter
			this.consecutiveFailures = 0;
		} finally {
			this.checking = false;
		}
	}

	/**
	 * Attempt to connect to the daemon socket.
	 * Returns true if the socket accepts connections.
	 */
	private pingSocket(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const socket = net.createConnection(this.paths.socket);
			const timer = setTimeout(() => {
				socket.destroy();
				resolve(false);
			}, 3000);

			socket.on("connect", () => {
				clearTimeout(timer);
				socket.destroy();
				resolve(true);
			});

			socket.on("error", () => {
				clearTimeout(timer);
				socket.destroy();
				resolve(false);
			});
		});
	}

	/**
	 * Clean up stale files and attempt daemon restart with backoff.
	 * Respects storm prevention — gives up after too many restarts.
	 */
	private async cleanupAndRestart(): Promise<void> {
		// Storm detection — check sliding window
		const now = Date.now();
		const cutoff = now - this.config.stormWindowMs;
		// Prune old timestamps
		while (this.restartTimestamps.length > 0 && this.restartTimestamps[0] < cutoff) {
			this.restartTimestamps.shift();
		}

		if (this.restartTimestamps.length >= this.config.maxRestartsInWindow) {
			const reason = `${this.restartTimestamps.length} restarts in ${this.config.stormWindowMs}ms`;
			log.error("Restart storm detected — giving up", { restarts: this.restartTimestamps.length });
			this.emit("storm-detected", this.restartTimestamps.length, this.config.stormWindowMs);
			this.emit("giving-up", reason);
			this.writeWatchdogLog(`STORM: ${reason}`);
			this.stop();
			return;
		}

		// Clean up stale files
		this.cleanupStaleFiles();

		// Calculate backoff: baseBackoff * 2^(restartsInWindow)
		const attempt = this.restartTimestamps.length + 1;
		const backoffMs = this.config.baseBackoffMs * (2 ** this.restartTimestamps.length);
		this.emit("restart-attempt", attempt, backoffMs);
		log.info("Restart attempt", { attempt, backoffMs });

		await sleep(backoffMs);

		try {
			const newPid = await spawnDaemon();
			this.restartTimestamps.push(Date.now());
			this.consecutiveFailures = 0;
			log.info("Daemon restarted successfully", { newPid, attempt });
			this.emit("restart-success", newPid);
			this.writeWatchdogLog(`RESTART OK: pid=${newPid} attempt=${attempt}`);
		} catch (err) {
			this.restartTimestamps.push(Date.now());
			const msg = err instanceof Error ? err.message : String(err);
			log.error("Restart failed", { attempt, error: msg });
			this.emit("restart-failed", attempt, msg);
			this.writeWatchdogLog(`RESTART FAILED: attempt=${attempt} error=${msg}`);
		}
	}

	/** Remove stale PID and socket files. */
	private cleanupStaleFiles(): void {
		removePid(this.paths.pid);
		try {
			fs.unlinkSync(this.paths.socket);
		} catch (err: unknown) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
				log.debug("Socket cleanup failed", { error: (err as Error).message });
			}
		}
	}

	/** Append a line to the watchdog log file. */
	private writeWatchdogLog(message: string): void {
		try {
			const logDir = this.paths.logDir;
			fs.mkdirSync(logDir, { recursive: true });
			const logPath = path.join(logDir, "scarlett-watchdog.log");
			const line = `[${new Date().toISOString()}] ${message}\n`;
			fs.appendFileSync(logPath, line, "utf-8");
		} catch {
			// Best-effort logging — don't crash the watchdog
		}
	}
}

/** Helper: sleep for ms. */
function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ─── Convenience API ────────────────────────────────────────────────────────

let activeWatchdog: ScarlettWatchdog | null = null;

/**
 * Start the Scarlett watchdog singleton.
 * Safe to call multiple times — returns existing instance if running.
 */
export function startScarlett(config?: ScarlettConfig): ScarlettWatchdog {
	if (activeWatchdog?.isRunning()) return activeWatchdog;
	activeWatchdog = new ScarlettWatchdog(config);
	activeWatchdog.start();
	return activeWatchdog;
}

/**
 * Stop the active Scarlett watchdog.
 * No-op if not running.
 */
export function stopScarlett(): void {
	if (activeWatchdog) {
		activeWatchdog.stop();
		activeWatchdog = null;
	}
}
