/**
 * @chitragupta/cli — Process Discovery Scanner.
 *
 * Scans heartbeat files and system processes to discover running
 * Chitragupta instances, their parent terminals, and multiplexer context.
 *
 * Used by:
 *   - `chitragupta ps` CLI command
 *   - Menubar/tray apps for session list
 *   - Terminal jump/focus features
 *
 * @module
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getChitraguptaHome } from "@chitragupta/core";

/** Discovered process info. */
export interface DiscoveredProcess {
	/** Process ID. */
	pid: number;
	/** Parent process ID. */
	ppid: number;
	/** Command name. */
	command: string;
	/** Full command line arguments. */
	args: string;
	/** Working directory (if available). */
	cwd: string | null;
	/** Terminal device (e.g., /dev/ttys001). */
	tty: string | null;
	/** Uptime in seconds. */
	uptime: number | null;
	/** Process state. */
	state: "running" | "sleeping" | "zombie" | "unknown";
	/** Whether this is a Chitragupta MCP server process. */
	isMcp: boolean;
	/** Whether this is a daemon process. */
	isDaemon: boolean;
	/** Whether this is a CLI interactive process. */
	isCli: boolean;
	/** Terminal multiplexer context (tmux, screen, etc). */
	multiplexer: MuxContext | null;
}

/** Terminal multiplexer context. */
export interface MuxContext {
	type: "tmux" | "screen" | "zellij" | "none";
	sessionName: string | null;
	windowId: string | null;
	paneId: string | null;
}

/** Heartbeat-enriched process info. */
export interface EnrichedProcess extends DiscoveredProcess {
	heartbeat: Record<string, unknown> | null;
}

/** Scan result summary. */
export interface ScanResult {
	/** All discovered Chitragupta processes. */
	processes: EnrichedProcess[];
	/** Count of live MCP server instances. */
	mcpCount: number;
	/** Whether the daemon is running. */
	daemonAlive: boolean;
	/** Scan duration in milliseconds. */
	durationMs: number;
	/** Timestamp of the scan. */
	timestamp: number;
}

/**
 * Scan for running Chitragupta processes.
 *
 * Combines two discovery methods:
 *   1. Heartbeat files (high-fidelity, MCP servers only)
 *   2. ps command (catches daemon, CLI, and other processes)
 *
 * @returns Enriched scan result with process details.
 */
export function scanProcesses(): ScanResult {
	const t0 = Date.now();

	// Method 1: Heartbeat files (fast, reliable)
	const heartbeats = readHeartbeatFiles();
	const heartbeatPids = new Set(
		heartbeats.map(h => (h as Record<string, unknown>).pid as number),
	);

	// Method 2: ps command (broader, catches all chitragupta processes)
	const psProcesses = discoverViaPs();

	// Merge: heartbeat data enriches ps data
	const processes: EnrichedProcess[] = [];
	const seenPids = new Set<number>();

	for (const proc of psProcesses) {
		seenPids.add(proc.pid);
		const hb = heartbeats.find(
			h => (h as Record<string, unknown>).pid === proc.pid,
		);
		processes.push({
			...proc,
			heartbeat: hb ? (hb as Record<string, unknown>) : null,
		});
	}

	// Add heartbeat-only processes (not found by ps — e.g., on remote machines)
	for (const hb of heartbeats) {
		const pid = (hb as Record<string, unknown>).pid as number;
		if (!seenPids.has(pid)) {
			processes.push({
				pid,
				ppid: 0,
				command: "chitragupta-mcp",
				args: "",
				cwd: ((hb as Record<string, unknown>).workspace as string) ?? null,
				tty: null,
				uptime: ((hb as Record<string, unknown>).uptime as number) ?? null,
				state: "running",
				isMcp: true,
				isDaemon: false,
				isCli: false,
				multiplexer: null,
				heartbeat: hb as Record<string, unknown>,
			});
		}
	}

	// Suppress lint: heartbeatPids used for future enrichment
	void heartbeatPids;

	return {
		processes,
		mcpCount: processes.filter(p => p.isMcp).length,
		daemonAlive: processes.some(p => p.isDaemon),
		durationMs: Date.now() - t0,
		timestamp: Date.now(),
	};
}

/** Read heartbeat files from telemetry directory. */
function readHeartbeatFiles(): unknown[] {
	const dir = path.join(getChitraguptaHome(), "telemetry", "instances");
	if (!fs.existsSync(dir)) return [];

	const now = Date.now();
	const results: unknown[] = [];

	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".tmp-")) continue;
			try {
				const fp = path.join(dir, entry.name);
				const stat = fs.statSync(fp);
				// Skip stale heartbeats (older than 10 seconds)
				if (now - stat.mtimeMs > 10_000) continue;
				results.push(JSON.parse(fs.readFileSync(fp, "utf-8")));
			} catch { /* skip corrupt */ }
		}
	} catch { /* dir unreadable */ }

	return results;
}

/** Discover Chitragupta processes via ps command. */
function discoverViaPs(): DiscoveredProcess[] {
	const platform = process.platform;
	const results: DiscoveredProcess[] = [];

	try {
		let output: string;
		if (platform === "win32") {
			output = execSync(
				"wmic process where \"name like '%chitragupta%' or commandline like '%chitragupta%'\" get processid,parentprocessid,commandline /format:csv",
				{ encoding: "utf-8", timeout: 5000 },
			);
			// Parse WMIC CSV output
			for (const line of output.split("\n").slice(1)) {
				const parts = line.trim().split(",");
				if (parts.length < 4) continue;
				const [, cmdline, ppid, pid] = parts;
				results.push(buildProcess(
					parseInt(pid ?? "0", 10),
					parseInt(ppid ?? "0", 10),
					cmdline ?? "",
				));
			}
		} else {
			// Unix: ps with custom format
			output = execSync(
				"ps -eo pid,ppid,tty,etime,comm,args 2>/dev/null | grep -i chitragupta | grep -v grep",
				{ encoding: "utf-8", timeout: 5000 },
			);
			for (const line of output.trim().split("\n")) {
				if (!line.trim()) continue;
				const parts = line.trim().split(/\s+/);
				if (parts.length < 6) continue;
				const pid = parseInt(parts[0], 10);
				const ppid = parseInt(parts[1], 10);
				const tty = parts[2] === "?" ? null : (parts[2] ?? null);
				const command = parts[4];
				const args = parts.slice(5).join(" ");

				const proc = buildProcess(pid, ppid, args);
				proc.tty = tty;
				proc.command = command ?? "unknown";
				results.push(proc);
			}
		}
	} catch {
		// ps failed — return empty (heartbeat files are the primary source)
	}

	return results;
}

/** Build a DiscoveredProcess from parsed data. */
function buildProcess(pid: number, ppid: number, args: string): DiscoveredProcess {
	const isMcp = args.includes("chitragupta-mcp") || args.includes("mcp-server");
	const isDaemon = args.includes("chitragupta-daemon") || args.includes("daemon");
	const isCli = args.includes("chitragupta") && !isMcp && !isDaemon;

	return {
		pid,
		ppid,
		command: isMcp ? "chitragupta-mcp" : isDaemon ? "chitragupta-daemon" : "chitragupta",
		args,
		cwd: null,
		tty: null,
		uptime: null,
		state: "running",
		isMcp,
		isDaemon,
		isCli,
		multiplexer: detectMultiplexer(ppid),
	};
}

/** Detect terminal multiplexer from PID ancestry. */
function detectMultiplexer(ppid: number): MuxContext | null {
	if (process.platform === "win32") return null;

	try {
		// Walk up PID ancestry looking for tmux/screen/zellij
		let currentPid = ppid;
		for (let depth = 0; depth < 5; depth++) {
			if (currentPid <= 1) break;

			const cmdOutput = execSync(
				`ps -o comm=,ppid= -p ${currentPid} 2>/dev/null`,
				{ encoding: "utf-8", timeout: 2000 },
			).trim();
			const [comm, nextPpid] = cmdOutput.split(/\s+/);

			if (comm?.includes("tmux")) {
				const tmuxEnv = process.env.TMUX ?? "";
				const tmuxParts = tmuxEnv.split(",");
				return {
					type: "tmux",
					sessionName: getTmuxSession(),
					windowId: tmuxParts[1] ?? null,
					paneId: process.env.TMUX_PANE ?? null,
				};
			}

			if (comm?.includes("screen")) {
				return { type: "screen", sessionName: process.env.STY ?? null, windowId: null, paneId: null };
			}

			if (comm?.includes("zellij")) {
				return { type: "zellij", sessionName: process.env.ZELLIJ_SESSION_NAME ?? null, windowId: null, paneId: null };
			}

			currentPid = parseInt(nextPpid ?? "0", 10);
		}
	} catch {
		/* ancestry walk failed */
	}

	return null;
}

/** Get current tmux session name. */
function getTmuxSession(): string | null {
	try {
		return execSync("tmux display-message -p '#S' 2>/dev/null", {
			encoding: "utf-8",
			timeout: 2000,
		}).trim() || null;
	} catch {
		return null;
	}
}

/**
 * Format scan results for CLI display.
 *
 * @param result - Scan result from scanProcesses().
 * @returns Formatted string for terminal output.
 */
export function formatScanResult(result: ScanResult): string {
	const lines: string[] = [];
	lines.push(`Chitragupta Processes (${result.processes.length} found, ${result.durationMs}ms)\n`);
	lines.push(`  Daemon: ${result.daemonAlive ? "ALIVE" : "NOT RUNNING"}`);
	lines.push(`  MCP Servers: ${result.mcpCount}\n`);

	for (const proc of result.processes) {
		const type = proc.isMcp ? "MCP" : proc.isDaemon ? "DAEMON" : "CLI";
		const tty = proc.tty ? ` tty=${proc.tty}` : "";
		const mux = proc.multiplexer
			? ` [${proc.multiplexer.type}:${proc.multiplexer.sessionName ?? "?"}]`
			: "";
		lines.push(`  PID ${proc.pid}  ${type}  ppid=${proc.ppid}${tty}${mux}`);

		if (proc.heartbeat) {
			const hb = proc.heartbeat;
			lines.push(
				`    session=${String(hb.sessionId ?? "none").slice(0, 8)}  tools=${String(hb.toolCallCount ?? 0)}  turns=${String(hb.turnCount ?? 0)}  pressure=${String(hb.contextPressure ?? 0)}`,
			);
		}
	}

	return lines.join("\n");
}
