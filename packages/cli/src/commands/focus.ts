/**
 * @chitragupta/cli — `chitragupta focus` command.
 *
 * Focuses / jumps to the terminal running a Chitragupta process.
 *
 * Usage:
 *   chitragupta focus <pid>     — focus terminal of specific PID
 *   chitragupta focus --latest  — focus the most recently started session
 *   chitragupta focus           — list running sessions with PIDs
 *
 * @module
 */

import { scanProcesses, formatScanResult } from "../discovery/process-scanner.js";
import { focusTerminal, detectMuxInfo } from "../discovery/terminal-focus.js";
import type { FocusTarget } from "../discovery/terminal-focus.js";
import type { EnrichedProcess } from "../discovery/process-scanner.js";

/**
 * Handle the `chitragupta focus` command.
 *
 * @param subcommand - First positional arg (PID string) or undefined.
 * @param rest - Remaining args (may contain --latest).
 */
export async function handleFocusCommand(
	subcommand: string | undefined,
	rest: string[],
): Promise<void> {
	const allArgs = [subcommand, ...rest].filter(Boolean) as string[];
	const isLatest = allArgs.includes("--latest");
	const pidArg = allArgs.find(a => /^\d+$/.test(a));

	// Case 1: Focus a specific PID
	if (pidArg) {
		await focusByPid(parseInt(pidArg, 10));
		return;
	}

	// Case 2: Focus the most recently started session
	if (isLatest) {
		await focusLatest();
		return;
	}

	// Case 3: No args — list running sessions
	listSessions();
}

/** Focus the terminal of a specific PID. */
async function focusByPid(pid: number): Promise<void> {
	process.stdout.write(`\n  Detecting terminal for PID ${pid}...\n`);

	const muxInfo = await detectMuxInfo(pid);
	const target = buildFocusTarget(pid, muxInfo);

	const result = await focusTerminal(target);

	if (result.success) {
		process.stdout.write(`  [${result.method}] ${result.message}\n\n`);
	} else {
		process.stderr.write(`  Failed: ${result.message}\n`);
		process.stderr.write("  Could not focus terminal — try switching manually.\n\n");
	}
}

/** Focus the most recently started Chitragupta session. */
async function focusLatest(): Promise<void> {
	const scan = scanProcesses();

	if (scan.processes.length === 0) {
		process.stderr.write(
			"\n  No running Chitragupta sessions found.\n" +
			"  Start one with: chitragupta serve\n\n",
		);
		return;
	}

	// Sort by heartbeat timestamp (newest first), fall back to PID (higher = newer)
	const sorted = [...scan.processes].sort((a, b) => {
		const tsA = getHeartbeatTimestamp(a);
		const tsB = getHeartbeatTimestamp(b);
		if (tsA && tsB) return tsB - tsA;
		if (tsA) return -1;
		if (tsB) return 1;
		return b.pid - a.pid;
	});

	const latest = sorted[0];
	if (!latest) {
		process.stderr.write("\n  No focusable session found.\n\n");
		return;
	}

	process.stdout.write(
		`\n  Latest session: PID ${latest.pid} (${latest.command})\n`,
	);

	await focusByPid(latest.pid);
}

/** List all running sessions with focusable info. */
function listSessions(): void {
	const scan = scanProcesses();

	if (scan.processes.length === 0) {
		process.stdout.write(
			"\n  No running Chitragupta sessions.\n" +
			"  Start one with: chitragupta serve\n\n",
		);
		return;
	}

	process.stdout.write(`\n${formatScanResult(scan)}\n`);
	process.stdout.write(
		"\n  To focus a session:\n" +
		"    chitragupta focus <pid>\n" +
		"    chitragupta focus --latest\n\n",
	);
}

/** Extract heartbeat start timestamp from an enriched process. */
function getHeartbeatTimestamp(proc: EnrichedProcess): number | null {
	const hb = proc.heartbeat;
	if (!hb) return null;
	const ts = hb.startedAt ?? hb.timestamp ?? hb.createdAt;
	return typeof ts === "number" ? ts : null;
}

/**
 * Build a FocusTarget from detected multiplexer info.
 *
 * Merges the PID with whatever tmux/screen/tty info was discovered.
 */
function buildFocusTarget(
	pid: number,
	muxInfo: Partial<FocusTarget>,
): FocusTarget {
	return {
		pid,
		tty: muxInfo.tty,
		tmux: muxInfo.tmux,
		screen: muxInfo.screen,
	};
}
