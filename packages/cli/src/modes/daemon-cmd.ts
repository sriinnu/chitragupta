/**
 * @chitragupta/cli — Daemon subcommand handler.
 *
 * Provides CLI kill switch and lifecycle management for the background daemon:
 *   chitragupta daemon start   — fork detached daemon, write PID file
 *   chitragupta daemon stop    — send SIGTERM to daemon PID (kill switch)
 *   chitragupta daemon status  — show daemon health, uptime, capabilities
 *   chitragupta daemon restart — stop + start
 */

import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";

/** Path to the daemon PID file. */
function getPidPath(): string {
	return path.join(getChitraguptaHome(), "daemon.pid");
}

/** Read PID from file, or null if not found. */
function readPid(): number | null {
	const pidPath = getPidPath();
	if (!fs.existsSync(pidPath)) return null;
	try {
		const raw = fs.readFileSync(pidPath, "utf8").trim();
		const pid = parseInt(raw, 10);
		return isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

/** Check if a process with the given PID is alive. */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0); // Signal 0 = existence check
		return true;
	} catch {
		return false;
	}
}

/**
 * Start the daemon as a detached child process.
 * Writes the PID to ~/.chitragupta/daemon.pid.
 */
async function startDaemon(): Promise<void> {
	const existingPid = readPid();
	if (existingPid !== null && isAlive(existingPid)) {
		process.stdout.write(`  Daemon already running (PID ${existingPid})\n`);
		return;
	}

	const { fork } = await import("node:child_process");
	const entryPoint = path.resolve(
		path.dirname(new URL(import.meta.url).pathname),
		"../setup-daemon.js",
	);

	const child = fork(entryPoint, [], {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, CHITRAGUPTA_DAEMON: "1" },
	});

	if (!child.pid) {
		process.stderr.write("  Error: Failed to fork daemon process\n");
		process.exit(1);
	}

	child.unref();

	const pidPath = getPidPath();
	const pidDir = path.dirname(pidPath);
	fs.mkdirSync(pidDir, { recursive: true });
	fs.writeFileSync(pidPath, String(child.pid), "utf8");

	process.stdout.write(`  Daemon started (PID ${child.pid})\n`);
	process.stdout.write(`  PID file: ${pidPath}\n`);
}

/**
 * Stop the daemon by sending SIGTERM to the PID from the PID file.
 * Removes the PID file after successful termination.
 */
function stopDaemon(): void {
	const pid = readPid();
	if (pid === null) {
		process.stdout.write("  Daemon is not running (no PID file)\n");
		return;
	}

	if (!isAlive(pid)) {
		process.stdout.write(`  Daemon (PID ${pid}) is not running — cleaning up PID file\n`);
		fs.unlinkSync(getPidPath());
		return;
	}

	try {
		process.kill(pid, "SIGTERM");
		process.stdout.write(`  Sent SIGTERM to daemon (PID ${pid})\n`);
		fs.unlinkSync(getPidPath());
		process.stdout.write("  PID file removed — daemon stopped\n");
	} catch (err) {
		process.stderr.write(`  Error stopping daemon: ${err instanceof Error ? err.message : String(err)}\n`);
	}
}

/** Show daemon status: PID, uptime, health. */
async function showStatus(): Promise<void> {
	const pid = readPid();
	if (pid === null) {
		process.stdout.write("  Daemon: not running (no PID file)\n");
		return;
	}

	const alive = isAlive(pid);
	process.stdout.write(`  Daemon PID:  ${pid}\n`);
	process.stdout.write(`  Alive:       ${alive ? "yes" : "no (stale PID file)"}\n`);
	process.stdout.write(`  PID file:    ${getPidPath()}\n`);

	if (!alive) {
		process.stdout.write("\n  Daemon process is not running. Run 'chitragupta daemon start' to start it.\n");
	}
}

/**
 * Handle the `daemon` subcommand.
 *
 * @param action - The sub-action: start, stop, status, restart.
 */
export async function runDaemonCommand(action?: string): Promise<void> {
	process.stdout.write("\n  Chitragupta Daemon\n\n");

	switch (action) {
		case "start":
			await startDaemon();
			break;
		case "stop":
			stopDaemon();
			break;
		case "status":
			await showStatus();
			break;
		case "restart":
			stopDaemon();
			// Brief pause to let the old process terminate
			await new Promise((r) => setTimeout(r, 1000));
			await startDaemon();
			break;
		default:
			process.stdout.write("  Usage: chitragupta daemon <start|stop|status|restart>\n");
			process.stdout.write("\n  Actions:\n");
			process.stdout.write("    start    Start background daemon\n");
			process.stdout.write("    stop     Kill switch — send SIGTERM to daemon\n");
			process.stdout.write("    status   Show daemon health and uptime\n");
			process.stdout.write("    restart  Stop then start\n");
			break;
	}

	process.stdout.write("\n");
}
