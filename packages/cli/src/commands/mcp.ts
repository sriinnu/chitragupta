/**
 * @chitragupta/cli — MCP CLI command.
 *
 * chitragupta mcp list    — show configured MCP servers
 * chitragupta mcp add     — add a new MCP server
 * chitragupta mcp remove  — remove an MCP server
 * chitragupta mcp test    — test connection to a server
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome } from "@chitragupta/core";
import {
	McpClient,
	type McpRemoteServerConfig,
} from "@chitragupta/tantra";
import {
	bold,
	green,
	gray,
	yellow,
	cyan,
	dim,
	red,
} from "@chitragupta/ui/ansi";
import type { MCPServerConfig, MCPConfigFile } from "../mcp-loader.js";

// ─── Config Helpers ─────────────────────────────────────────────────────────

/**
 * Get the path to the global mcp.json config file.
 */
function getGlobalConfigPath(): string {
	return path.join(getChitraguptaHome(), "mcp.json");
}

/**
 * Get the path to the project-local mcp.json config file.
 */
function getProjectConfigPath(): string {
	return path.join(process.cwd(), ".chitragupta", "mcp.json");
}

/**
 * Read an mcp.json file and return its contents.
 * Returns a default empty config if the file doesn't exist.
 */
function readConfigFile(filePath: string): MCPConfigFile {
	try {
		if (fs.existsSync(filePath)) {
			const raw = fs.readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(raw) as MCPConfigFile;
			if (parsed.mcpServers && Array.isArray(parsed.mcpServers)) {
				return parsed;
			}
		}
	} catch {
		// Malformed file — return empty
	}
	return { mcpServers: [] };
}

/**
 * Write an mcp.json config file, creating parent directories as needed.
 */
function writeConfigFile(filePath: string, config: MCPConfigFile): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(config, null, "\t") + "\n", "utf-8");
}

// ─── Subcommands ────────────────────────────────────────────────────────────

/**
 * List all configured MCP servers from both global and project configs.
 */
export async function list(): Promise<void> {
	const globalPath = getGlobalConfigPath();
	const projectPath = getProjectConfigPath();

	const globalConfig = readConfigFile(globalPath);
	const projectConfig = readConfigFile(projectPath);

	process.stdout.write("\n" + bold("MCP Servers") + "\n\n");

	// Global servers
	if (globalConfig.mcpServers.length > 0) {
		process.stdout.write(dim("  Global") + gray(` (${globalPath})`) + "\n\n");

		for (const server of globalConfig.mcpServers) {
			const statusTag = server.enabled === false
				? red(" [disabled]")
				: green(" [enabled]");

			process.stdout.write(
				`  ${bold(server.name)}${statusTag}\n`,
			);
			process.stdout.write(
				`    ${dim("id:")} ${server.id}\n`,
			);
			process.stdout.write(
				`    ${dim("command:")} ${server.command}${server.args ? " " + server.args.join(" ") : ""}\n`,
			);

			if (server.env && Object.keys(server.env).length > 0) {
				const envKeys = Object.keys(server.env).join(", ");
				process.stdout.write(
					`    ${dim("env:")} ${envKeys}\n`,
				);
			}

			process.stdout.write("\n");
		}
	} else {
		process.stdout.write(dim("  Global") + gray(` (${globalPath})`) + "\n");
		process.stdout.write(gray("    No servers configured.\n\n"));
	}

	// Project servers
	if (projectConfig.mcpServers.length > 0) {
		process.stdout.write(dim("  Project") + gray(` (${projectPath})`) + "\n\n");

		for (const server of projectConfig.mcpServers) {
			const statusTag = server.enabled === false
				? red(" [disabled]")
				: green(" [enabled]");

			process.stdout.write(
				`  ${bold(server.name)}${statusTag}\n`,
			);
			process.stdout.write(
				`    ${dim("id:")} ${server.id}\n`,
			);
			process.stdout.write(
				`    ${dim("command:")} ${server.command}${server.args ? " " + server.args.join(" ") : ""}\n`,
			);

			process.stdout.write("\n");
		}
	} else {
		process.stdout.write(dim("  Project") + gray(` (${projectPath})`) + "\n");
		process.stdout.write(gray("    No servers configured.\n\n"));
	}

	process.stdout.write(
		gray("  Use `chitragupta mcp add <id> <command>` to add a server.\n\n"),
	);
}

/**
 * Add a new MCP server to the global or project config.
 *
 * @param id - Unique server identifier.
 * @param command - The command to spawn.
 * @param args - Additional arguments for the command.
 * @param options - Optional flags (--project to add to project config, --name for display name).
 */
export async function add(
	id: string,
	command: string,
	args: string[],
	options: { project?: boolean; name?: string } = {},
): Promise<void> {
	if (!id) {
		process.stderr.write(
			red("\n  Error: Server ID is required.\n") +
			gray("  Usage: chitragupta mcp add <id> <command> [args...]\n\n"),
		);
		process.exit(1);
	}

	if (!command) {
		process.stderr.write(
			red("\n  Error: Command is required.\n") +
			gray("  Usage: chitragupta mcp add <id> <command> [args...]\n\n"),
		);
		process.exit(1);
	}

	const configPath = options.project ? getProjectConfigPath() : getGlobalConfigPath();
	const config = readConfigFile(configPath);

	// Check for duplicate
	const existing = config.mcpServers.find((s) => s.id === id);
	if (existing) {
		process.stderr.write(
			red(`\n  Error: Server "${id}" already exists.\n`) +
			gray("  Use `chitragupta mcp remove` first, or choose a different ID.\n\n"),
		);
		process.exit(1);
	}

	const newServer: MCPServerConfig = {
		id,
		name: options.name ?? id,
		command,
		args: args.length > 0 ? args : undefined,
		enabled: true,
	};

	config.mcpServers.push(newServer);
	writeConfigFile(configPath, config);

	const scope = options.project ? "project" : "global";
	process.stdout.write(
		"\n" + green(`  Added MCP server "${bold(newServer.name)}" to ${scope} config.`) + "\n",
	);
	process.stdout.write(
		gray(`  Config: ${configPath}`) + "\n\n",
	);
}

/**
 * Remove an MCP server from the global or project config.
 *
 * @param id - The server ID to remove.
 * @param options - Optional flags (--project to target project config).
 */
export async function remove(
	id: string,
	options: { project?: boolean } = {},
): Promise<void> {
	if (!id) {
		process.stderr.write(
			red("\n  Error: Server ID is required.\n") +
			gray("  Usage: chitragupta mcp remove <id>\n\n"),
		);
		process.exit(1);
	}

	const configPath = options.project ? getProjectConfigPath() : getGlobalConfigPath();
	const config = readConfigFile(configPath);

	const idx = config.mcpServers.findIndex((s) => s.id === id);
	if (idx === -1) {
		process.stderr.write(
			yellow(`\n  Server "${id}" not found in ${options.project ? "project" : "global"} config.\n\n`),
		);
		process.exit(1);
	}

	const removed = config.mcpServers.splice(idx, 1)[0];
	writeConfigFile(configPath, config);

	process.stdout.write(
		"\n" + green(`  Removed MCP server "${bold(removed.name)}".`) + "\n\n",
	);
}

/**
 * Test connection to an MCP server by ID.
 *
 * Looks up the server config, spawns it, performs the MCP handshake,
 * lists its tools, and disconnects.
 *
 * @param id - The server ID to test.
 */
export async function test(id: string): Promise<void> {
	if (!id) {
		process.stderr.write(
			red("\n  Error: Server ID is required.\n") +
			gray("  Usage: chitragupta mcp test <id>\n\n"),
		);
		process.exit(1);
	}

	// Find the server config from global or project
	const globalConfig = readConfigFile(getGlobalConfigPath());
	const projectConfig = readConfigFile(getProjectConfigPath());

	const allServers = [...globalConfig.mcpServers, ...projectConfig.mcpServers];
	const serverConfig = allServers.find((s) => s.id === id);

	if (!serverConfig) {
		process.stderr.write(
			red(`\n  Error: Server "${id}" not found in any config.\n\n`),
		);
		process.exit(1);
		return; // TypeScript flow
	}

	process.stdout.write(
		"\n" + dim(`  Testing MCP server "${serverConfig.name}"...`) + "\n",
	);
	process.stdout.write(
		dim(`  Command: ${serverConfig.command}${serverConfig.args ? " " + serverConfig.args.join(" ") : ""}`) + "\n\n",
	);

	const client = new McpClient({
		transport: "stdio",
		serverCommand: serverConfig.command,
		serverArgs: serverConfig.args,
		timeout: 15_000,
	});

	try {
		// Connect and handshake
		const info = await client.connect();

		process.stdout.write(
			green("  Connected successfully.") + "\n",
		);
		process.stdout.write(
			`  Server: ${cyan(info.name)} v${info.version}\n`,
		);

		// List tools
		const tools = await client.listTools();
		if (tools.length > 0) {
			process.stdout.write(
				`  Tools (${tools.length}):\n`,
			);
			for (const tool of tools) {
				process.stdout.write(
					`    ${cyan(tool.name)} — ${dim(tool.description)}\n`,
				);
			}
		} else {
			process.stdout.write(gray("  No tools reported.\n"));
		}

		// List resources
		const resources = await client.listResources().catch(() => []);
		if (resources.length > 0) {
			process.stdout.write(
				`  Resources (${resources.length}):\n`,
			);
			for (const res of resources) {
				process.stdout.write(
					`    ${cyan(res.name)} — ${dim(res.uri)}\n`,
				);
			}
		}

		await client.disconnect();
		process.stdout.write("\n" + green("  Test passed.") + "\n\n");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stdout.write(red(`  Test failed: ${message}`) + "\n\n");

		try {
			await client.disconnect();
		} catch {
			// Best effort
		}

		process.exit(1);
	}
}

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Route an `chitragupta mcp <subcommand>` invocation to the correct handler.
 *
 * @param subcommand - The subcommand (list, add, remove, test).
 * @param rest - Remaining positional arguments.
 */
export async function runMCPCommand(
	subcommand: string | undefined,
	rest: string[],
): Promise<void> {
	// Parse --project flag from rest
	const isProject = rest.includes("--project");
	const filteredRest = rest.filter((a) => a !== "--project");

	// Parse --name flag from rest
	let name: string | undefined;
	const nameIdx = filteredRest.indexOf("--name");
	if (nameIdx >= 0 && nameIdx + 1 < filteredRest.length) {
		name = filteredRest[nameIdx + 1];
		filteredRest.splice(nameIdx, 2);
	}

	switch (subcommand) {
		case "list":
			await list();
			break;

		case "add": {
			const id = filteredRest[0];
			const command = filteredRest[1];
			const cmdArgs = filteredRest.slice(2);
			await add(id, command, cmdArgs, { project: isProject, name });
			break;
		}

		case "remove": {
			const id = filteredRest[0];
			await remove(id, { project: isProject });
			break;
		}

		case "test": {
			const id = filteredRest[0];
			await test(id);
			break;
		}

		default:
			process.stderr.write(
				"\nUsage: chitragupta mcp <list|add|remove|test>\n\n" +
				"  " + cyan("list") + "                     Show configured MCP servers\n" +
				"  " + cyan("add <id> <cmd> [args]") + "   Add a new MCP server\n" +
				"  " + cyan("remove <id>") + "             Remove an MCP server\n" +
				"  " + cyan("test <id>") + "               Test connection to a server\n" +
				"\nFlags:\n" +
				"  " + dim("--project") + "               Target project config instead of global\n" +
				"  " + dim("--name <name>") + "           Display name for add command\n\n",
			);
			process.exit(1);
	}
}
