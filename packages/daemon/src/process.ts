/**
 * @chitragupta/daemon — Process management.
 *
 * Fork daemon to background, PID file, signal handling,
 * status check, graceful shutdown.
 *
 * @module
 */

import { execSync, fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@chitragupta/core";
import { resolvePaths, isWindows } from "./paths.js";

const log = createLogger("daemon:process");

/** Daemon process status. */
export interface DaemonStatus {
	running: boolean;
	pid: number | null;
	socket: string;
	uptime: number | null;
}

/** Write the current PID to the PID file. */
export function writePid(pidPath: string): void {
	fs.mkdirSync(path.dirname(pidPath), { recursive: true });
	fs.writeFileSync(pidPath, String(process.pid), "utf-8");
}

/** Read the PID from the PID file. Returns null if missing. */
export function readPid(pidPath: string): number | null {
	try {
		const content = fs.readFileSync(pidPath, "utf-8").trim();
		const pid = parseInt(content, 10);
		return Number.isFinite(pid) ? pid : null;
	} catch {
		return null;
	}
}

/** Remove the PID file. */
export function removePid(pidPath: string): void {
	try {
		fs.unlinkSync(pidPath);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

/**
 * Check if a process with the given PID is alive.
 * On Windows, uses `tasklist` since `kill(pid, 0)` is unreliable.
 */
export function isProcessAlive(pid: number): boolean {
	if (isWindows()) {
		try {
			const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
				encoding: "utf-8",
				timeout: 3000,
				windowsHide: true,
			});
			return output.includes(String(pid));
		} catch {
			return false;
		}
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Check daemon status: is it running, what PID, etc.
 */
export function checkStatus(): DaemonStatus {
	const paths = resolvePaths();
	const pid = readPid(paths.pid);

	if (pid !== null && isProcessAlive(pid)) {
		return { running: true, pid, socket: paths.socket, uptime: null };
	}

	// Stale PID file — clean up
	if (pid !== null) {
		removePid(paths.pid);
	}

	return { running: false, pid: null, socket: paths.socket, uptime: null };
}

/**
 * Spawn the daemon as a detached background process.
 *
 * Uses Node's `fork()` with `detached: true` and `stdio: 'ignore'`
 * so the daemon survives parent exit. The daemon entry point
 * is the package's `./dist/entry.js` module.
 */
export async function spawnDaemon(): Promise<number> {
	const status = checkStatus();
	if (status.running && status.pid) {
		log.info("Daemon already running", { pid: status.pid });
		return status.pid;
	}

	const paths = resolvePaths();

	// Acquire lock to prevent concurrent spawn races (multiple MCP sessions starting daemon)
	const lockAcquired = acquireLock(paths.lock);
	if (!lockAcquired) {
		log.info("Another process is spawning the daemon, waiting...");
		// Wait for the other spawner to finish, then check if daemon is up
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setTimeout(r, 500));
			const recheck = checkStatus();
			if (recheck.running && recheck.pid) return recheck.pid;
		}
		throw new Error("Daemon spawn lock held too long — check for stale lock file");
	}

	try {
		return await doSpawn(paths);
	} finally {
		releaseLock(paths.lock);
	}
}

/** Acquire a file-based lock. Returns false if already held. */
function acquireLock(lockPath: string): boolean {
	try {
		fs.mkdirSync(path.dirname(lockPath), { recursive: true });
		// O_EXCL fails if file exists — atomic lock acquisition
		const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
		fs.writeSync(fd, `${process.pid}\n${Date.now()}`);
		fs.closeSync(fd);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			// Check if lock is stale: older than 30s AND holder PID is no longer alive
			try {
				const stat = fs.statSync(lockPath);
				const ageMs = Date.now() - stat.mtimeMs;
				if (ageMs > 30_000) {
					// Read PID from lock content (format: "PID\ntimestamp")
					const holderPid = readLockPid(lockPath);
					if (holderPid !== null && isProcessAlive(holderPid)) {
						// Lock holder is still alive — do NOT break the lock
						log.debug("Lock holder still alive, respecting lock", { holderPid, ageMs });
						return false;
					}
					// PID dead or unreadable — safe to break stale lock
					log.debug("Breaking stale lock", { holderPid, ageMs });
					fs.unlinkSync(lockPath);
					return acquireLock(lockPath); // Retry once after removing stale lock
				}
			} catch { /* lock disappeared — race is fine */ }
			return false;
		}
		throw err;
	}
}

/** Release the lock file. */
function releaseLock(lockPath: string): void {
	try { fs.unlinkSync(lockPath); } catch { /* best-effort */ }
}

/** Read the PID from a lock file. Returns null if unreadable or invalid. */
function readLockPid(lockPath: string): number | null {
	try {
		const content = fs.readFileSync(lockPath, "utf-8");
		const firstLine = content.split("\n")[0].trim();
		const pid = parseInt(firstLine, 10);
		return Number.isFinite(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/** Internal: actual daemon spawn after lock acquired. */
async function doSpawn(paths: ReturnType<typeof resolvePaths>): Promise<number> {
	// Resolve the daemon entry point — works from both src/ (tsx dev) and dist/ (built)
	// Use fileURLToPath for correct handling of encoded chars and Windows drive letters
	const { fileURLToPath } = await import("node:url");
	const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const daemonEntry = path.join(pkgRoot, "dist", "entry.js");

	if (!fs.existsSync(daemonEntry)) {
		throw new Error(
			`Daemon entry not found: ${daemonEntry}\n` +
			`Run 'pnpm --filter @chitragupta/daemon build' first.`,
		);
	}

	fs.mkdirSync(paths.logDir, { recursive: true });

	const outLog = fs.openSync(path.join(paths.logDir, "daemon.out.log"), "a");
	const errLog = fs.openSync(path.join(paths.logDir, "daemon.err.log"), "a");

	const child = fork(daemonEntry, [], {
		detached: true,
		stdio: ["ignore", outLog, errLog, "ipc"],
		env: {
			...process.env,
			CHITRAGUPTA_DAEMON: "1",
			NODE_OPTIONS: "--max-old-space-size=256 --max-semi-space-size=16",
		},
	});

	// Wait for the daemon to signal readiness (or exit with error)
	const pid = await new Promise<number>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Daemon startup timed out (10s)"));
		}, 10_000);

		child.on("message", (msg) => {
			if (typeof msg === "object" && msg !== null && (msg as { ready?: boolean }).ready) {
				clearTimeout(timeout);
				resolve(child.pid!);
			}
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});

		child.on("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`Daemon exited during startup with code ${code}`));
		});
	});

	// Detach — let daemon run independently
	child.unref();
	child.disconnect();
	fs.closeSync(outLog);
	fs.closeSync(errLog);

	log.info("Daemon spawned", { pid });
	return pid;
}

/**
 * Stop a running daemon.
 *
 * On Unix: sends SIGTERM, falls back to SIGKILL after 5s.
 * On Windows: attempts RPC shutdown first, falls back to `taskkill /F /T`.
 */
export async function stopDaemon(): Promise<boolean> {
	const status = checkStatus();
	if (!status.running || !status.pid) {
		log.info("Daemon not running");
		return false;
	}

	const pid = status.pid;

	if (isWindows()) {
		// Prefer graceful RPC shutdown — SIGTERM is unreliable on Windows
		try {
			const { createClient } = await import("./client.js");
			const client = await createClient();
			await client.call("daemon.shutdown");
			client.disconnect();
		} catch {
			log.debug("RPC shutdown failed, will force-kill", { pid });
		}

		// Wait for graceful exit
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setTimeout(r, 100));
			if (!isProcessAlive(pid)) {
				const paths = resolvePaths();
				removePid(paths.pid);
				log.info("Daemon stopped gracefully", { pid });
				return true;
			}
		}

		// Force kill via taskkill
		forceKillWindows(pid);
	} else {
		process.kill(pid, "SIGTERM");
		log.info("Sent SIGTERM to daemon", { pid });

		// Wait for process to exit
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setTimeout(r, 100));
			if (!isProcessAlive(pid)) {
				const paths = resolvePaths();
				removePid(paths.pid);
				log.info("Daemon stopped gracefully", { pid });
				return true;
			}
		}

		// Force kill
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			/* already dead */
		}
	}

	const paths = resolvePaths();
	removePid(paths.pid);
	log.warn("Daemon force-killed", { pid });
	return true;
}

/** Force-kill a process on Windows using `taskkill /F /T`. */
function forceKillWindows(pid: number): void {
	try {
		execSync(`taskkill /PID ${pid} /F /T`, {
			encoding: "utf-8",
			timeout: 5000,
			windowsHide: true,
		});
	} catch {
		/* process may already be dead */
	}
}

/**
 * Install signal handlers for graceful daemon shutdown.
 * Called from the daemon entry point.
 * On Windows, skips SIGHUP (not supported).
 */
export function installSignalHandlers(onShutdown: () => Promise<void>): void {
	let shutting = false;

	const handler = async (signal: string) => {
		if (shutting) return;
		shutting = true;
		log.info("Signal received", { signal });
		try {
			await onShutdown();
		} catch (err) {
			log.error("Shutdown error", err instanceof Error ? err : undefined);
		}
		const paths = resolvePaths();
		removePid(paths.pid);
		process.exit(0);
	};

	process.on("SIGTERM", () => { handler("SIGTERM").catch(() => process.exit(1)); });
	process.on("SIGINT", () => { handler("SIGINT").catch(() => process.exit(1)); });

	// SIGHUP is not supported on Windows — skip to avoid crash
	if (!isWindows()) {
		process.on("SIGHUP", () => { handler("SIGHUP").catch(() => process.exit(1)); });
	}
}
