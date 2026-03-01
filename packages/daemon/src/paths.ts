/**
 * @chitragupta/daemon — Platform-aware path resolution.
 *
 * Socket, PID file, and log paths for macOS/Linux/Windows.
 * Override any path with $CHITRAGUPTA_SOCKET or $CHITRAGUPTA_PID.
 *
 * @module
 */

import os from "node:os";
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
export function getPlatform(): "macos" | "linux" | "windows" {
	switch (process.platform) {
		case "darwin":
			return "macos";
		case "win32":
			return "windows";
		default:
			return "linux";
	}
}

/** Whether the current platform is Windows. */
export function isWindows(): boolean {
	return process.platform === "win32";
}

/** Get the chitragupta home directory (~/.chitragupta or %LOCALAPPDATA%\chitragupta). */
function getHome(): string {
	if (process.env.CHITRAGUPTA_HOME) return process.env.CHITRAGUPTA_HOME;
	if (isWindows() && process.env.LOCALAPPDATA) {
		return path.join(process.env.LOCALAPPDATA, "chitragupta");
	}
	return path.join(
		process.env.HOME ?? process.env.USERPROFILE ?? os.tmpdir(),
		".chitragupta",
	);
}

/** Named pipe path for Windows daemon IPC. */
const WINDOWS_PIPE = "\\\\.\\pipe\\chitragupta";

/**
 * Resolve daemon file paths for the current platform.
 *
 * macOS: ~/Library/Caches/chitragupta/daemon/
 * Linux: $XDG_RUNTIME_DIR/chitragupta/ or ~/.chitragupta/daemon/
 * Windows: %LOCALAPPDATA%\chitragupta\daemon\ (named pipe is virtual)
 */
export function resolvePaths(): DaemonPaths {
	const home = getHome();
	const platform = getPlatform();

	let daemonDir: string;
	if (process.env.CHITRAGUPTA_DAEMON_DIR) {
		daemonDir = process.env.CHITRAGUPTA_DAEMON_DIR;
	} else if (platform === "macos") {
		daemonDir = path.join(
			process.env.HOME ?? os.tmpdir(),
			"Library", "Caches", "chitragupta", "daemon",
		);
	} else if (platform === "linux" && process.env.XDG_RUNTIME_DIR) {
		daemonDir = path.join(process.env.XDG_RUNTIME_DIR, "chitragupta");
	} else {
		daemonDir = path.join(home, "daemon");
	}

	// Windows uses a named pipe (virtual path), Unix uses a socket file
	const socket = process.env.CHITRAGUPTA_SOCKET
		?? (platform === "windows" ? WINDOWS_PIPE : path.join(daemonDir, "chitragupta.sock"));

	const pid = process.env.CHITRAGUPTA_PID ?? path.join(home, "daemon.pid");
	const logDir = path.join(home, "logs");
	const lock = path.join(daemonDir, "chitragupta.lock");

	return { socket, pid, logDir, lock };
}

/** Ensure all daemon directories exist. */
export function ensureDirs(paths: DaemonPaths): void {
	// On Windows, named pipe paths are virtual — skip mkdir for socket parent
	const dirs = isWindows()
		? [path.dirname(paths.pid), paths.logDir]
		: [path.dirname(paths.socket), path.dirname(paths.pid), paths.logDir];

	for (const dir of dirs) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * Remove stale socket file if it exists and no process is listening.
 * No-op on Windows (named pipes are virtual, no file to clean).
 */
export function cleanStaleSocket(socketPath: string): void {
	if (isWindows()) return;
	try {
		fs.unlinkSync(socketPath);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}
