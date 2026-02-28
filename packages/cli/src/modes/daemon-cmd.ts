/**
 * @chitragupta/cli — Daemon subcommand handler.
 *
 * CLI interface for the centralized daemon:
 *   chitragupta daemon start   — spawn background daemon (socket server + consolidation)
 *   chitragupta daemon stop    — send SIGTERM to daemon (kill switch)
 *   chitragupta daemon status  — show daemon health, socket, uptime
 *   chitragupta daemon restart — stop + start
 *   chitragupta daemon ping    — verify daemon responds via socket
 */

import { checkStatus, spawnDaemon, stopDaemon, resolvePaths, createClient } from "@chitragupta/daemon";

/**
 * Handle the `daemon` subcommand.
 *
 * @param action - The sub-action: start, stop, status, restart, ping.
 */
export async function runDaemonCommand(action?: string): Promise<void> {
	process.stdout.write("\n  Chitragupta Daemon\n\n");

	switch (action) {
		case "start":
			await handleStart();
			break;
		case "stop":
			await handleStop();
			break;
		case "status":
			handleStatus();
			break;
		case "restart":
			await handleStop();
			await new Promise((r) => setTimeout(r, 500));
			await handleStart();
			break;
		case "ping":
			await handlePing();
			break;
		default:
			printUsage();
			break;
	}

	process.stdout.write("\n");
}

/** Start the daemon as a detached background process. */
async function handleStart(): Promise<void> {
	try {
		const pid = await spawnDaemon();
		const paths = resolvePaths();
		process.stdout.write(`  Daemon started (PID ${pid})\n`);
		process.stdout.write(`  Socket: ${paths.socket}\n`);
		process.stdout.write(`  PID file: ${paths.pid}\n`);
		process.stdout.write(`  Logs: ${paths.logDir}/\n`);
	} catch (err) {
		process.stderr.write(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	}
}

/** Stop a running daemon. */
async function handleStop(): Promise<void> {
	const stopped = await stopDaemon();
	if (stopped) {
		process.stdout.write("  Daemon stopped.\n");
	} else {
		process.stdout.write("  Daemon is not running.\n");
	}
}

/** Show daemon status. */
function handleStatus(): void {
	const status = checkStatus();
	const paths = resolvePaths();

	process.stdout.write(`  Running:   ${status.running ? "yes" : "no"}\n`);
	process.stdout.write(`  PID:       ${status.pid ?? "(none)"}\n`);
	process.stdout.write(`  Socket:    ${paths.socket}\n`);
	process.stdout.write(`  PID file:  ${paths.pid}\n`);
	process.stdout.write(`  Logs:      ${paths.logDir}/\n`);

	if (!status.running) {
		process.stdout.write("\n  Run 'chitragupta daemon start' to start.\n");
	}
}

/** Ping the daemon via socket to verify it responds. */
async function handlePing(): Promise<void> {
	try {
		const client = await createClient({ autoStart: false, timeout: 3_000 });
		const start = performance.now();
		const result = (await client.call("daemon.ping")) as Record<string, unknown>;
		const elapsed = performance.now() - start;
		client.disconnect();

		if (result.pong) {
			process.stdout.write(`  Pong! (${elapsed.toFixed(1)}ms)\n`);
		} else {
			process.stdout.write("  Unexpected response.\n");
		}
	} catch (err) {
		process.stderr.write(`  Daemon not reachable: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	}
}

/** Print usage help. */
function printUsage(): void {
	process.stdout.write("  Usage: chitragupta daemon <start|stop|status|restart|ping>\n");
	process.stdout.write("\n  Actions:\n");
	process.stdout.write("    start    Spawn background daemon (socket server + consolidation)\n");
	process.stdout.write("    stop     Kill switch — send SIGTERM to daemon\n");
	process.stdout.write("    status   Show daemon health, socket path, PID\n");
	process.stdout.write("    restart  Stop then start\n");
	process.stdout.write("    ping     Verify daemon responds via socket\n");
}
