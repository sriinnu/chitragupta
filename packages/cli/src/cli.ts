#!/usr/bin/env node

/**
 * @chitragupta/cli — Entry point.
 *
 * The main CLI binary. Parses arguments, routes to subcommands
 * or launches the main interactive/print mode.
 */

import { ChitraguptaError } from "@chitragupta/core";
import { parseArgs, printHelp } from "./args.js";
import { main } from "./main.js";
import { loadPlugins, listInstalledPlugins, getPluginDir } from "./plugin-loader.js";

const VERSION = "0.1.0";

/**
 * Route subcommands to their respective handlers.
 */
async function handleSubcommand(command: string, subcommand: string | undefined, rest: string[], opts?: { port?: number; host?: string }): Promise<void> {
	switch (command) {
		case "provider": {
			const provider = await import("./commands/provider.js");
			switch (subcommand) {
				case "list":
					await provider.list();
					break;
				case "add": {
					const name = rest[0];
					if (!name) {
						process.stderr.write(
							"\nError: Provider ID required.\n" +
							"Usage: chitragupta provider add <provider-id>\n\n",
						);
						process.exit(1);
					}
					await provider.add(name);
					break;
				}
				case "test": {
					const name = rest[0];
					if (!name) {
						process.stderr.write(
							"\nError: Provider ID required.\n" +
							"Usage: chitragupta provider test <provider-id>\n\n",
						);
						process.exit(1);
					}
					await provider.test(name);
					break;
				}
				default:
					process.stderr.write(
						"\nUsage: chitragupta provider <list|add|test>\n\n",
					);
					process.exit(1);
			}
			break;
		}

		case "session": {
			const session = await import("./commands/session.js");
			switch (subcommand) {
				case "list":
					await session.list();
					break;
				case "show": {
					const id = rest[0];
					if (!id) {
						process.stderr.write(
							"\nError: Session ID required.\n" +
							"Usage: chitragupta session show <session-id>\n\n",
						);
						process.exit(1);
					}
					await session.show(id);
					break;
				}
				case "search": {
					const query = rest.join(" ");
					if (!query) {
						process.stderr.write(
							"\nError: Search query required.\n" +
							"Usage: chitragupta session search <query>\n\n",
						);
						process.exit(1);
					}
					await session.search(query);
					break;
				}
				case "export": {
					const id = rest[0];
					if (!id) {
						process.stderr.write(
							"\nError: Session ID required.\n" +
							"Usage: chitragupta session export <session-id> [--format json|md] [--output file]\n\n",
						);
						process.exit(1);
					}
					// Parse optional --format and --output flags from rest
					let format = "json";
					let output: string | undefined;
					for (let i = 1; i < rest.length; i++) {
						if (rest[i] === "--format" && i + 1 < rest.length) {
							format = rest[++i];
						} else if (rest[i] === "--output" && i + 1 < rest.length) {
							output = rest[++i];
						}
					}
					await session.exportSession(id, format, output);
					break;
				}
				case "import": {
					const file = rest[0];
					if (!file) {
						process.stderr.write(
							"\nError: File path required.\n" +
							"Usage: chitragupta session import <file>\n\n",
						);
						process.exit(1);
					}
					await session.importSession(file);
					break;
				}
				default:
					process.stderr.write(
						"\nUsage: chitragupta session <list|show|search|export|import>\n\n",
					);
					process.exit(1);
			}
			break;
		}

		case "memory": {
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
					if (!query) {
						process.stderr.write(
							"\nError: Search query required.\n" +
							"Usage: chitragupta memory search <query>\n\n",
						);
						process.exit(1);
					}
					await memory.search(query);
					break;
				}
				default:
					process.stderr.write(
						"\nUsage: chitragupta memory <show|edit|search>\n\n",
					);
					process.exit(1);
			}
			break;
		}

		case "agent": {
			const agent = await import("./commands/agent.js");
			switch (subcommand) {
				case "list":
					await agent.list();
					break;
				case "create": {
					const name = rest[0];
					if (!name) {
						process.stderr.write(
							"\nError: Profile name required.\n" +
							"Usage: chitragupta agent create <name>\n\n",
						);
						process.exit(1);
					}
					await agent.create(name);
					break;
				}
				case "use": {
					const name = rest[0];
					if (!name) {
						process.stderr.write(
							"\nError: Profile ID required.\n" +
							"Usage: chitragupta agent use <profile-id>\n\n",
						);
						process.exit(1);
					}
					await agent.use(name);
					break;
				}
				default:
					process.stderr.write(
						"\nUsage: chitragupta agent <list|create|use>\n\n",
					);
					process.exit(1);
			}
			break;
		}

		case "config": {
			const config = await import("./commands/config.js");
			if (subcommand === "set") {
				const key = rest[0];
				const value = rest[1];
				if (!key || value === undefined) {
					process.stderr.write(
						"\nError: Key and value required.\n" +
						"Usage: chitragupta config set <key> <value>\n\n",
					);
					process.exit(1);
				}
				await config.set(key, value);
			} else {
				// Default: show config
				await config.show();
			}
			break;
		}

		case "mcp": {
			const mcp = await import("./commands/mcp.js");
			await mcp.runMCPCommand(subcommand, rest);
			break;
		}

		case "orchestrate": {
			const orchestrate = await import("./commands/orchestrate.js");
			await orchestrate.runOrchestrateCommand(subcommand, rest);
			break;
		}

		case "workflow": {
			const workflow = await import("./commands/workflow.js");
			await workflow.runWorkflowCommand(subcommand, rest);
			break;
		}

		case "serve": {
			const port = opts?.port ?? 3000;
			const host = opts?.host ?? "localhost";

			// Reuse the main() initialization flow to create a fully-wired agent
			// then hand it to the HTTP server instead of the TUI.
			const { createChitragupta } = await import("./api.js");
			const chitragupta = await createChitragupta();

			const { runServerMode } = await import("./modes/server.js");
			await runServerMode({
				agent: chitragupta.agent,
				port,
				host,
				projectPath: process.cwd(),
			});
			break;
		}

		case "mcp-server": {
			// Parse flags from subcommand + rest args
			const mcpArgs = [subcommand, ...rest].filter(Boolean) as string[];
			let mcpTransport: "stdio" | "sse" = "stdio";
			let mcpPort = 3001;
			let mcpProject = process.cwd();
			let mcpAgent = false;
			let mcpName = "chitragupta";

			for (let mi = 0; mi < mcpArgs.length; mi++) {
				if (mcpArgs[mi] === "--sse") mcpTransport = "sse";
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
			// MCP server runs until killed — don't exit
			return;
		}

		case "plugin": {
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
					process.stderr.write(
						"\nUsage: chitragupta plugin <list|load|install|remove>\n\n",
					);
					process.exit(1);
			}
			break;
		}

		case "skill": {
			const skillPorter = await import("./commands/skill-porter.js");
			await skillPorter.runSkillPorterCommand(subcommand, rest);
			break;
		}

		case "code": {
			// Parse flags from subcommand + rest args
			const codeArgs = [subcommand, ...rest].filter(Boolean) as string[];
			let codeTask = "";
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

			codeTask = codeTaskParts.join(" ");
			// No task → opens interactive coding REPL

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
			break; // unreachable but satisfies TS
		}

		case "init": {
			const init = await import("./commands/init.js");
			await init.run(rest);
			break;
		}

		case "daemon": {
			const { parseDaemonArgs, runDaemonMode } = await import("./modes/daemon.js");
			const daemonOpts = parseDaemonArgs([subcommand, ...rest].filter(Boolean) as string[]);
			await runDaemonMode(daemonOpts);
			// Daemon runs until killed — don't exit
			return;
		}

		default:
			process.stderr.write(
				`\nUnknown command: ${command}\n` +
				"Run `chitragupta --help` for usage information.\n\n",
			);
			process.exit(1);
	}
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	// ─── Version ────────────────────────────────────────────────────────
	if (args.version) {
		process.stdout.write(`chitragupta v${VERSION}\n`);
		process.exit(0);
	}

	// ─── Help ───────────────────────────────────────────────────────────
	if (args.help) {
		printHelp();
		process.exit(0);
	}

	// ─── Subcommands ────────────────────────────────────────────────────
	if (args.command) {
		await handleSubcommand(args.command, args.subcommand, args.rest, { port: args.port, host: args.host });
		process.exit(0);
	}

	// ─── Main mode (interactive or print) ───────────────────────────────
	try {
		await main(args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = error instanceof ChitraguptaError ? error.code : undefined;

		// Friendly error messages for common issues
		if (code === "AUTH_ERROR") {
			process.stderr.write(
				`\nAuthentication error: ${message}\n\n` +
				"Run `chitragupta provider list` to see available providers.\n" +
				"Run `chitragupta provider add <id>` to configure a provider.\n\n",
			);
		} else if (code === "PROVIDER_ERROR") {
			process.stderr.write(
				`\nProvider error: ${message}\n\n`,
			);
		} else {
			process.stderr.write(
				`\nError: ${message}\n\n`,
			);
		}

		process.exit(1);
	}
}

run().catch((error) => {
	process.stderr.write(`\nFatal error: ${error?.message ?? error}\n\n`);
	process.exit(1);
});
