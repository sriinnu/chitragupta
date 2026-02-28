/**
 * @chitragupta/daemon — Platform-aware path resolution.
 *
 * Socket, PID file, and log paths for macOS/Linux/Windows.
 * Override any path with $CHITRAGUPTA_SOCKET or $CHITRAGUPTA_PID.
 *
 * @module
 */

import path from "node:path";
import fs from "node:fs";

/** Resolved daemon paths for the current platform. */
export interface DaemonPaths {
	/** Unix domain socket (or named pipe on Windows). */
	socket: string;
	/** PID file for the running daemon. */
	pid: string;
	/** Directory for daemon logs. */
	logDir: string;
	/** Lock file to prevent concurrent daemon starts. */
	lock: string;
}

/** Detect the current platform category. */
function getPlatform(): "macos" | "linux" | "windows" {
	switch (process.platform) {
		case "darwin":
			return "macos";
		case "win32":
			return "windows";
		default:
			return "linux";
	}
}

/** Get the chitragupta home directory (~/.chitragupta). */
function getHome(): string {
	return process.env.CHITRAGUPTA_HOME ?? path.join(
		process.env.HOME ?? process.env.USERPROFILE ?? "/tmp",
		".chitragupta",
	);
}

/**
 * Resolve daemon file paths for the current platform.
 *
 * macOS: ~/Library/Caches/chitragupta/daemon/
 * Linux: $XDG_RUNTIME_DIR/chitragupta/ or ~/.chitragupta/daemon/
 * Windows: ~/.chitragupta/daemon/ (named pipe path is virtual)
 */
export function resolvePaths(): DaemonPaths {
	const home = getHome();
	const platform = getPlatform();

	let daemonDir: string;
	if (process.env.CHITRAGUPTA_DAEMON_DIR) {
		daemonDir = process.env.CHITRAGUPTA_DAEMON_DIR;
	} else if (platform === "macos") {
		daemonDir = path.join(
			process.env.HOME ?? "/tmp",
			"Library", "Caches", "chitragupta", "daemon",
		);
	} else if (platform === "linux" && process.env.XDG_RUNTIME_DIR) {
		daemonDir = path.join(process.env.XDG_RUNTIME_DIR, "chitragupta");
	} else {
		daemonDir = path.join(home, "daemon");
	}

	const socket = process.env.CHITRAGUPTA_SOCKET ?? path.join(daemonDir, "chitragupta.sock");
	const pid = process.env.CHITRAGUPTA_PID ?? path.join(home, "daemon.pid");
	const logDir = path.join(home, "logs");
	const lock = path.join(daemonDir, "chitragupta.lock");

	return { socket, pid, logDir, lock };
}

/** Ensure all daemon directories exist. */
export function ensureDirs(paths: DaemonPaths): void {
	for (const dir of [path.dirname(paths.socket), path.dirname(paths.pid), paths.logDir]) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/** Remove stale socket file if it exists and no process is listening. */
export function cleanStaleSocket(socketPath: string): void {
	try {
		fs.unlinkSync(socketPath);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}
