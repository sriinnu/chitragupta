#!/usr/bin/env node

/**
 * @chitragupta/cli — MCP Server Entry Point.
 *
 * Standalone binary for running Chitragupta as an MCP server.
 * Designed for direct integration with MCP clients:
 *
 *   Claude Code:  Add to ~/.claude/claude_code_config.json
 *   Codex:        Add to MCP config
 *   Generic:      npx chitragupta-mcp
 *
 * Usage:
 *   chitragupta-mcp                         Stdio mode (default)
 *   chitragupta-mcp --sse --port 3001       SSE/HTTP mode
 *   chitragupta-mcp --agent                 Enable agent prompt tool
 *   chitragupta-mcp --project /path/to/dir  Set project directory
 *
 * Environment variables:
 *   CHITRAGUPTA_MCP_TRANSPORT    "stdio" or "sse" (default: "stdio")
 *   CHITRAGUPTA_MCP_PORT         Port for SSE mode (default: 3001)
 *   CHITRAGUPTA_MCP_PROJECT      Project directory (default: cwd)
 *   CHITRAGUPTA_MCP_AGENT        "true" to enable agent tool
 *   CHITRAGUPTA_MCP_NAME         Server name (default: "chitragupta")
 */

import { runMcpServerMode } from "./modes/mcp-server.js";
import { loadCredentials } from "./bootstrap.js";
import { configureLogging, ConsoleTransport } from "@chitragupta/core";
import { CLI_PACKAGE_VERSION } from "./version.js";

// ─── Stdout Guard ───────────────────────────────────────────────────────────
// In stdio mode, stdout is EXCLUSIVELY for MCP JSON-RPC framed messages.
// Redirect console.log → stderr so stray logs from dependencies can't
// corrupt the protocol stream and cause client-side timeouts.

console.log = (...args: unknown[]) => { console.error(...args); };

// ─── Crash Guards ───────────────────────────────────────────────────────────
// Prevent silent crashes that kill the MCP server without any user feedback.

process.on("uncaughtException", (err) => {
	process.stderr.write(`[chitragupta-mcp] Uncaught exception: ${err.message}\n${err.stack ?? ""}\n`);
});
process.on("unhandledRejection", (reason) => {
	const msg = reason instanceof Error ? reason.message : String(reason);
	process.stderr.write(`[chitragupta-mcp] Unhandled rejection: ${msg}\n`);
});

// ─── Diagnostics ────────────────────────────────────────────────────────────

/** Run environment diagnostics and print results. */
async function runDiagnostics(): Promise<void> {
	const w = (s: string) => process.stderr.write(s);
	w("\n  Chitragupta MCP — Environment Check\n\n");

	// Node.js version
	const nodeV = process.version;
	const major = parseInt(nodeV.slice(1), 10);
	w(`  Node.js:        ${nodeV} ${major >= 22 ? "OK" : "FAIL (need >=22)"}\n`);

	// Platform
	w(`  Platform:       ${process.platform}/${process.arch}\n`);
	w(`  CWD:            ${process.cwd()}\n`);

	// better-sqlite3 native module
	try {
		await import("better-sqlite3");
		w("  better-sqlite3: OK (native module loaded)\n");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		w(`  better-sqlite3: FAIL — ${msg}\n`);
		w("    Fix: Install build tools (macOS: xcode-select --install, Linux: apt install build-essential)\n");
		w("    Then: rm -rf node_modules && npm install\n");
	}

	// Data directory
	try {
		const { getChitraguptaHome } = await import("@chitragupta/core");
		const home = getChitraguptaHome();
		const { existsSync, mkdirSync } = await import("fs");
		if (!existsSync(home)) mkdirSync(home, { recursive: true });
		w(`  Data dir:       ${home} (exists)\n`);
	} catch (err: unknown) {
		w(`  Data dir:       FAIL — ${err instanceof Error ? err.message : String(err)}\n`);
	}

	// Core imports
	for (const mod of ["@chitragupta/tantra", "@chitragupta/smriti", "@chitragupta/yantra"]) {
		try {
			await import(mod);
			w(`  ${mod.padEnd(25)} OK\n`);
		} catch (err: unknown) {
			w(`  ${mod.padEnd(25)} FAIL — ${err instanceof Error ? err.message : String(err)}\n`);
		}
	}

	w("\n  If all checks pass but MCP still fails, run with CHITRAGUPTA_DEBUG=1\n");
	w("  and check stderr output for errors.\n\n");
}

// ─── Parse CLI Arguments ────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
	transport: "stdio" | "sse";
	port: number;
	projectPath: string;
	enableAgent: boolean;
	name: string;
	check: boolean;
} {
	let transport: "stdio" | "sse" = (process.env.CHITRAGUPTA_MCP_TRANSPORT as "stdio" | "sse") ?? "stdio";
	let port = parseInt(process.env.CHITRAGUPTA_MCP_PORT ?? "3001", 10) || 3001;
	let projectPath = process.env.CHITRAGUPTA_MCP_PROJECT ?? process.cwd();
	let enableAgent = process.env.CHITRAGUPTA_MCP_AGENT === "true";
	let name = process.env.CHITRAGUPTA_MCP_NAME ?? "chitragupta";
	let check = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === "--sse") {
			transport = "sse";
		} else if (arg === "--stdio") {
			transport = "stdio";
		} else if (arg === "--port" && i + 1 < argv.length) {
			const parsed = parseInt(argv[++i], 10);
			port = (!isNaN(parsed) && parsed > 0 && parsed < 65536) ? parsed : 3001;
		} else if (arg === "--project" && i + 1 < argv.length) {
			projectPath = argv[++i];
		} else if (arg === "--agent") {
			enableAgent = true;
		} else if (arg === "--name" && i + 1 < argv.length) {
			name = argv[++i];
		} else if (arg === "--check") {
			check = true;
		} else if (arg === "-h" || arg === "--help") {
			process.stderr.write(
				"\nChitragupta MCP Server\n\n" +
				"Usage:\n" +
				"  chitragupta-mcp                         Stdio mode (default)\n" +
				"  chitragupta-mcp --sse --port 3001       SSE/HTTP mode\n" +
				"  chitragupta-mcp --agent                 Enable agent prompt tool\n" +
				"  chitragupta-mcp --project /path/to/dir  Set project directory\n" +
				"  chitragupta-mcp --check                 Run environment diagnostics\n" +
				"  chitragupta-mcp --name my-chitragupta   Custom server name\n\n" +
				"Environment variables:\n" +
				"  CHITRAGUPTA_MCP_TRANSPORT    stdio|sse (default: stdio)\n" +
				"  CHITRAGUPTA_MCP_PORT         SSE port (default: 3001)\n" +
				"  CHITRAGUPTA_MCP_PROJECT      Project directory\n" +
				"  CHITRAGUPTA_MCP_AGENT        true to enable agent\n" +
				"  CHITRAGUPTA_MCP_NAME         Server name\n\n" +
				"Claude Code integration (.mcp.json in project root):\n" +
				'  {\n' +
				'    "mcpServers": {\n' +
				'      "chitragupta": {\n' +
				'        "command": "npx",\n' +
				'        "args": ["-y", "-p", "@yugenlab/chitragupta", "chitragupta-mcp"]\n' +
				'      }\n' +
				'    }\n' +
				'  }\n\n',
			);
			process.exit(0);
		} else if (arg === "-v" || arg === "--version") {
			process.stderr.write(`chitragupta-mcp v${CLI_PACKAGE_VERSION}\n`);
			process.exit(0);
		}
	}

	return { transport, port, projectPath, enableAgent, name, check };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const t0 = performance.now();
	const args = parseArgs(process.argv.slice(2));

	// Diagnostic mode — check environment and exit
	if (args.check) {
		await runDiagnostics();
		process.exit(0);
	}

	// In stdio mode, ALL log output must go to stderr to keep stdout
	// clean for JSON-RPC messages. Without this, DEBUG/INFO logs from
	// NidraDaemon, DaemonManager, etc. corrupt the MCP protocol handshake.
	if (args.transport === "stdio") {
		configureLogging({
			transports: [new ConsoleTransport({ forceStderr: true })],
		});
	}

	// Load credentials (sets API key env vars). Fast (<10ms) but
	// deferred after logging so any import-time logs go to stderr.
	loadCredentials();

	process.stderr.write(`[mcp] Bootstrap: ${(performance.now() - t0).toFixed(0)}ms\n`);

	await runMcpServerMode({
		transport: args.transport,
		port: args.port,
		projectPath: args.projectPath,
		enableAgent: args.enableAgent,
		name: args.name,
	});
}

main().catch((err) => {
	process.stderr.write(`[chitragupta-mcp] Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
	process.exit(1);
});
