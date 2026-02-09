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

// ─── Parse CLI Arguments ────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
	transport: "stdio" | "sse";
	port: number;
	projectPath: string;
	enableAgent: boolean;
	name: string;
} {
	let transport: "stdio" | "sse" = (process.env.CHITRAGUPTA_MCP_TRANSPORT as "stdio" | "sse") ?? "stdio";
	let port = parseInt(process.env.CHITRAGUPTA_MCP_PORT ?? "3001", 10) || 3001;
	let projectPath = process.env.CHITRAGUPTA_MCP_PROJECT ?? process.cwd();
	let enableAgent = process.env.CHITRAGUPTA_MCP_AGENT === "true";
	let name = process.env.CHITRAGUPTA_MCP_NAME ?? "chitragupta";

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === "--sse") {
			transport = "sse";
		} else if (arg === "--stdio") {
			transport = "stdio";
		} else if (arg === "--port" && i + 1 < argv.length) {
			port = parseInt(argv[++i], 10) || 3001;
		} else if (arg === "--project" && i + 1 < argv.length) {
			projectPath = argv[++i];
		} else if (arg === "--agent") {
			enableAgent = true;
		} else if (arg === "--name" && i + 1 < argv.length) {
			name = argv[++i];
		} else if (arg === "-h" || arg === "--help") {
			process.stderr.write(
				"\nChitragupta MCP Server\n\n" +
				"Usage:\n" +
				"  chitragupta-mcp                         Stdio mode (default)\n" +
				"  chitragupta-mcp --sse --port 3001       SSE/HTTP mode\n" +
				"  chitragupta-mcp --agent                 Enable agent prompt tool\n" +
				"  chitragupta-mcp --project /path/to/dir  Set project directory\n" +
				"  chitragupta-mcp --name my-chitragupta      Custom server name\n\n" +
				"Environment variables:\n" +
				"  CHITRAGUPTA_MCP_TRANSPORT    stdio|sse (default: stdio)\n" +
				"  CHITRAGUPTA_MCP_PORT         SSE port (default: 3001)\n" +
				"  CHITRAGUPTA_MCP_PROJECT      Project directory\n" +
				"  CHITRAGUPTA_MCP_AGENT        true to enable agent\n" +
				"  CHITRAGUPTA_MCP_NAME         Server name\n\n" +
				"Claude Code integration:\n" +
				"  Add to ~/.claude/claude_code_config.json:\n" +
				'  {\n' +
				'    "mcpServers": {\n' +
				'      "chitragupta": {\n' +
				'        "command": "npx",\n' +
				'        "args": ["chitragupta-mcp", "--project", "/path/to/project"]\n' +
				'      }\n' +
				'    }\n' +
				'  }\n\n',
			);
			process.exit(0);
		} else if (arg === "-v" || arg === "--version") {
			process.stderr.write("chitragupta-mcp v0.1.0\n");
			process.exit(0);
		}
	}

	return { transport, port, projectPath, enableAgent, name };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	// Load credentials first so API keys are available
	loadCredentials();

	const args = parseArgs(process.argv.slice(2));

	await runMcpServerMode({
		transport: args.transport,
		port: args.port,
		projectPath: args.projectPath,
		enableAgent: args.enableAgent,
		name: args.name,
	});
}

main().catch((err) => {
	process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
