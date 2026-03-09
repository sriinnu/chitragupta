/**
 * CLI command routing — handles all subcommand dispatch.
 *
 * Extracted from cli.ts for maintainability. Each case lazy-imports
 * its handler module to keep startup time low.
 *
 * @module cli-commands
 */

import { loadPlugins, listInstalledPlugins, getPluginDir } from "./plugin-loader.js";

/** Options forwarded from the argument parser. */
export interface SubcommandOptions {
	port?: number;
	host?: string;
}

/**
 * Route subcommands to their respective handlers.
 *
 * @param command - Primary command name (e.g. "provider", "session").
 * @param subcommand - Secondary subcommand (e.g. "list", "add").
 * @param rest - Remaining positional arguments.
 * @param opts - Optional port/host overrides.
 */
export async function handleSubcommand(
	command: string,
	subcommand: string | undefined,
	rest: string[],
	opts?: SubcommandOptions,
): Promise<void> {
	switch (command) {
		case "provider":
			await handleProvider(subcommand, rest);
			break;
		case "session":
			await handleSession(subcommand, rest);
			break;
		case "memory":
			await handleMemory(subcommand, rest);
			break;
		case "agent":
			await handleAgent(subcommand, rest);
			break;
		case "config":
			await handleConfig(subcommand, rest);
			break;
		case "mcp":
			await handleMcp(subcommand, rest);
			break;
		case "orchestrate":
			await handleOrchestrate(subcommand, rest);
			break;
		case "workflow":
			await handleWorkflow(subcommand, rest);
			break;
		case "sync":
			await handleSync(subcommand, rest);
			break;
		case "serve":
			await handleServe(opts);
			break;
		case "mcp-server":
			await handleMcpServer(subcommand, rest);
			return; // MCP server runs until killed
		case "plugin":
			await handlePlugin(subcommand);
			break;
		case "skill":
			await handleSkill(subcommand, rest);
			break;
		case "extension":
			await handleExtension(subcommand, rest);
			break;
		case "code":
			await handleCode(subcommand, rest);
			break;
		case "init":
			await handleInit(rest);
			break;
		case "run":
			await handleRun(subcommand, rest);
			break;
		case "focus":
			await handleFocus(subcommand, rest);
			break;
		case "daemon":
			await handleDaemon(subcommand, rest);
			return; // Daemon runs until killed
		default:
			process.stderr.write(
				`\nUnknown command: ${command}\n` +
				"Run `chitragupta --help` for usage information.\n\n",
			);
			process.exit(1);
	}
}

// ─── Individual Command Handlers ─────────────────────────────────────────────

async function handleProvider(subcommand: string | undefined, rest: string[]): Promise<void> {
	const provider = await import("./commands/provider.js");
	switch (subcommand) {
		case "list":
			await provider.list();
			break;
		case "add": {
			const name = rest[0];
			if (!name) { exitWithError("Provider ID required.", "chitragupta provider add <provider-id>"); }
			await provider.add(name);
			break;
		}
		case "test": {
			const name = rest[0];
			if (!name) { exitWithError("Provider ID required.", "chitragupta provider test <provider-id>"); }
			await provider.test(name);
			break;
		}
		default:
			exitWithUsage("chitragupta provider <list|add|test>");
	}
}

async function handleSession(subcommand: string | undefined, rest: string[]): Promise<void> {
	const session = await import("./commands/session.js");
	switch (subcommand) {
		case "list":
			await session.list();
			break;
		case "show": {
			const id = rest[0];
			if (!id) { exitWithError("Session ID required.", "chitragupta session show <session-id>"); }
			await session.show(id);
			break;
		}
		case "search": {
			const query = rest.join(" ");
			if (!query) { exitWithError("Search query required.", "chitragupta session search <query>"); }
			await session.search(query);
			break;
		}
		case "export": {
			const id = rest[0];
			if (!id) { exitWithError("Session ID required.", "chitragupta session export <session-id> [--format json|md] [--output file]"); }
			let format = "json";
			let output: string | undefined;
			for (let i = 1; i < rest.length; i++) {
				if (rest[i] === "--format" && i + 1 < rest.length) { format = rest[++i]; }
				else if (rest[i] === "--output" && i + 1 < rest.length) { output = rest[++i]; }
			}
			await session.exportSession(id, format, output);
			break;
		}
		case "import": {
			const file = rest[0];
			if (!file) { exitWithError("File path required.", "chitragupta session import <file>"); }
			await session.importSession(file);
			break;
		}
		default:
			exitWithUsage("chitragupta session <list|show|search|export|import>");
	}
}

async function handleMemory(subcommand: string | undefined, rest: string[]): Promise<void> {
	const memory = await import("./commands/memory.js");
	switch (subcommand) {
		case "show":
			await memory.show();
			break;
		case "edit":
			await memory.edit();
			break;
		case "search": {
			const query = rest.join(" ");
			if (!query) { exitWithError("Search query required.", "chitragupta memory search <query>"); }
			await memory.search(query);
			break;
		}
		default:
			exitWithUsage("chitragupta memory <show|edit|search>");
	}
}

async function handleAgent(subcommand: string | undefined, rest: string[]): Promise<void> {
	const agent = await import("./commands/agent.js");
	switch (subcommand) {
		case "list":
			await agent.list();
			break;
		case "create": {
			const name = rest[0];
			if (!name) { exitWithError("Profile name required.", "chitragupta agent create <name>"); }
			await agent.create(name);
			break;
		}
		case "use": {
			const name = rest[0];
			if (!name) { exitWithError("Profile ID required.", "chitragupta agent use <profile-id>"); }
			await agent.use(name);
			break;
		}
		default:
			exitWithUsage("chitragupta agent <list|create|use>");
	}
}

async function handleConfig(subcommand: string | undefined, rest: string[]): Promise<void> {
	const config = await import("./commands/config.js");
	if (subcommand === "set") {
		const key = rest[0];
		const value = rest[1];
		if (!key || value === undefined) { exitWithError("Key and value required.", "chitragupta config set <key> <value>"); }
		await config.set(key, value);
	} else {
		await config.show();
	}
}

async function handleMcp(subcommand: string | undefined, rest: string[]): Promise<void> {
	const mcp = await import("./commands/mcp.js");
	await mcp.runMCPCommand(subcommand, rest);
}

async function handleOrchestrate(subcommand: string | undefined, rest: string[]): Promise<void> {
	const orchestrate = await import("./commands/orchestrate.js");
	await orchestrate.runOrchestrateCommand(subcommand, rest);
}

async function handleWorkflow(subcommand: string | undefined, rest: string[]): Promise<void> {
	const workflow = await import("./commands/workflow.js");
	await workflow.runWorkflowCommand(subcommand, rest);
}

async function handleSync(subcommand: string | undefined, rest: string[]): Promise<void> {
	const sync = await import("./commands/sync.js");
	await sync.runSyncCommand(subcommand, rest);
}

async function handleServe(opts?: SubcommandOptions): Promise<void> {
	const port = opts?.port ?? 3000;
	const host = opts?.host ?? "127.0.0.1";
	const { createChitragupta } = await import("./api.js");
	const chitragupta = await createChitragupta();
	const { runServerMode } = await import("./modes/server.js");
	await runServerMode({
		agent: chitragupta.agent,
		port,
		host,
		projectPath: process.cwd(),
	});
}

async function handleMcpServer(subcommand: string | undefined, rest: string[]): Promise<void> {
	const mcpArgs = [subcommand, ...rest].filter(Boolean) as string[];
	let mcpTransport: "stdio" | "sse" | "streamable-http" = "stdio";
	let mcpPort = 3001;
	let mcpProject = process.cwd();
	let mcpAgent = false;
	let mcpName = "chitragupta";

	for (let mi = 0; mi < mcpArgs.length; mi++) {
		if (mcpArgs[mi] === "--sse") mcpTransport = "sse";
		else if (mcpArgs[mi] === "--streamable-http") mcpTransport = "streamable-http";
		else if (mcpArgs[mi] === "--stdio") mcpTransport = "stdio";
		else if (mcpArgs[mi] === "--port" && mi + 1 < mcpArgs.length) mcpPort = parseInt(mcpArgs[++mi], 10) || 3001;
		else if (mcpArgs[mi] === "--project" && mi + 1 < mcpArgs.length) mcpProject = mcpArgs[++mi];
		else if (mcpArgs[mi] === "--agent") mcpAgent = true;
		else if (mcpArgs[mi] === "--name" && mi + 1 < mcpArgs.length) mcpName = mcpArgs[++mi];
	}

	const { runMcpServerMode } = await import("./modes/mcp-server.js");
	await runMcpServerMode({
		transport: mcpTransport,
		port: mcpPort,
		projectPath: mcpProject,
		enableAgent: mcpAgent,
		name: mcpName,
	});
}

async function handlePlugin(subcommand: string | undefined): Promise<void> {
	switch (subcommand) {
		case "list": {
			const installed = await listInstalledPlugins();
			if (installed.length === 0) {
				process.stdout.write(
					"\n  No plugins installed.\n" +
					`  Plugin directory: ${getPluginDir()}\n\n`,
				);
			} else {
				process.stdout.write("\n  Installed plugins:\n\n");
				for (const name of installed) {
					process.stdout.write(`    - ${name}\n`);
				}
				process.stdout.write(
					`\n  Plugin directory: ${getPluginDir()}\n\n`,
				);
			}
			break;
		}
		case "load": {
			const registry = await loadPlugins();
			if (registry.plugins.length === 0) {
				process.stdout.write(
					"\n  No plugins loaded.\n" +
					`  Place .js plugin files in: ${getPluginDir()}\n\n`,
				);
			} else {
				process.stdout.write("\n  Loaded plugins:\n\n");
				for (const plugin of registry.plugins) {
					const ver = plugin.version ? ` v${plugin.version}` : "";
					const toolCount = plugin.tools?.length ?? 0;
					const cmdCount = plugin.commands?.length ?? 0;
					process.stdout.write(
						`    - ${plugin.name}${ver}` +
						` (${toolCount} tool${toolCount !== 1 ? "s" : ""}` +
						`, ${cmdCount} command${cmdCount !== 1 ? "s" : ""})\n`,
					);
				}
				process.stdout.write("\n");
			}
			break;
		}
		case "install":
			process.stdout.write(
				"\n  Install plugins by placing .js ESM modules in:\n" +
				`    ${getPluginDir()}\n\n` +
				"  Each module must export a register() function that returns\n" +
				"  a { name, version?, tools?, commands? } plugin object.\n\n" +
				"  Single-file:  ~/.chitragupta/plugins/my-plugin.js\n" +
				"  Directory:    ~/.chitragupta/plugins/my-plugin/index.js\n\n",
			);
			break;
		case "remove":
			process.stdout.write(
				"\n  Remove plugins by deleting them from:\n" +
				`    ${getPluginDir()}\n\n`,
			);
			break;
		default:
			exitWithUsage("chitragupta plugin <list|load|install|remove>");
	}
}

async function handleSkill(subcommand: string | undefined, rest: string[]): Promise<void> {
	const skillPorter = await import("./commands/skill-porter.js");
	await skillPorter.runSkillPorterCommand(subcommand, rest);
}

async function handleCode(subcommand: string | undefined, rest: string[]): Promise<void> {
	const codeArgs = [subcommand, ...rest].filter(Boolean) as string[];
	let codeMode: "full" | "execute" | "plan-only" | undefined;
	let codeProvider: string | undefined;
	let codeModel: string | undefined;
	let codeBranch: boolean | undefined;
	let codeCommit: boolean | undefined;
	let codeReview: boolean | undefined;
	let codeProject = process.cwd();
	let codeTimeout: number | undefined;

	const codeTaskParts: string[] = [];
	for (let ci = 0; ci < codeArgs.length; ci++) {
		if (codeArgs[ci] === "--mode" && ci + 1 < codeArgs.length) {
			const m = codeArgs[++ci];
			if (m === "full" || m === "execute" || m === "plan-only") codeMode = m;
		} else if (codeArgs[ci] === "--plan") {
			codeMode = "plan-only";
		} else if (codeArgs[ci] === "--provider" && ci + 1 < codeArgs.length) {
			codeProvider = codeArgs[++ci];
		} else if ((codeArgs[ci] === "-m" || codeArgs[ci] === "--model") && ci + 1 < codeArgs.length) {
			codeModel = codeArgs[++ci];
		} else if (codeArgs[ci] === "--project" && ci + 1 < codeArgs.length) {
			codeProject = codeArgs[++ci];
		} else if (codeArgs[ci] === "--timeout" && ci + 1 < codeArgs.length) {
			codeTimeout = parseInt(codeArgs[++ci], 10) || undefined;
		} else if (codeArgs[ci] === "--no-branch") codeBranch = false;
		else if (codeArgs[ci] === "--branch") codeBranch = true;
		else if (codeArgs[ci] === "--no-commit") codeCommit = false;
		else if (codeArgs[ci] === "--commit") codeCommit = true;
		else if (codeArgs[ci] === "--no-review") codeReview = false;
		else if (codeArgs[ci] === "--review") codeReview = true;
		else if (!codeArgs[ci].startsWith("-")) codeTaskParts.push(codeArgs[ci]);
	}

	const codeTask = codeTaskParts.join(" ");
	const { runCodeMode } = await import("./modes/code.js");
	const codeExitCode = await runCodeMode({
		task: codeTask,
		mode: codeMode,
		provider: codeProvider,
		model: codeModel,
		createBranch: codeBranch,
		autoCommit: codeCommit,
		selfReview: codeReview,
		project: codeProject,
		timeout: codeTimeout,
	});
	process.exit(codeExitCode);
}

async function handleInit(rest: string[]): Promise<void> {
	const init = await import("./commands/init.js");
	await init.run(rest);
}

async function handleRun(subcommand: string | undefined, rest: string[]): Promise<void> {
	const run = await import("./commands/run.js");
	await run.runRunCommand(subcommand, rest);
}

async function handleDaemon(subcommand: string | undefined, _rest: string[]): Promise<void> {
	const { runDaemonCommand } = await import("./modes/daemon-cmd.js");
	await runDaemonCommand(subcommand);
}

async function handleExtension(subcommand: string | undefined, rest: string[]): Promise<void> {
	const { handleExtensionCommand } = await import("./commands/extension.js");
	await handleExtensionCommand(subcommand, rest);
}

async function handleFocus(subcommand: string | undefined, rest: string[]): Promise<void> {
	const { handleFocusCommand } = await import("./commands/focus.js");
	await handleFocusCommand(subcommand, rest);
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────

/** Print an error message with usage hint and exit. */
function exitWithError(message: string, usage: string): never {
	process.stderr.write(`\nError: ${message}\nUsage: ${usage}\n\n`);
	process.exit(1);
}

/** Print a usage message and exit. */
function exitWithUsage(usage: string): never {
	process.stderr.write(`\nUsage: ${usage}\n\n`);
	process.exit(1);
}
