/**
 * Interactive commands — Core & session commands.
 *
 * Handles: /help, /model, /thinking, /compact, /memory, /clear, /status,
 * /cost, /diff, /agents, /delegate, /mcp, /branch, /tree, /skill, /skills,
 * /learn, /vidya, /stats, /power, /quit.
 *
 * @module
 */

import type { ThinkingLevel } from "@chitragupta/core";
import {
	bold, dim, gray, green, cyan, yellow, red, magenta, clearScreen,
} from "@chitragupta/ui/ansi";
import type { SlashCommandContext, SlashCommandResult } from "./interactive-cmd-registry.js";
import { THINKING_LEVELS } from "./interactive-cmd-registry.js";

// ─── Help text entries (command → description) ──────────────────────────────

const HELP_ENTRIES: ReadonlyArray<[string, string]> = [
	["/model <name>", "Switch model"],
	["/thinking <level>", "Set thinking (none|low|medium|high)"],
	["/compact", "Compact conversation context"],
	["/memory", "Show project memory"],
	["/memory search <q>", "Search memory (Anveshana multi-round)"],
	["/clear", "Clear conversation"],
	["/status", "Show session stats"],
	["/agents", "Show the agent tree"],
	["/delegate <p> <task>", "Spawn a sub-agent"],
	["/cost", "Show cost breakdown"],
	["/code <task>", "Spawn a focused coding agent"],
	["/review [files...]", "Spawn a review agent on files/changes"],
	["/debug <error>", "Spawn a debug agent to investigate"],
	["/research <question>", "Research the codebase"],
	["/refactor <desc>", "Refactor code (--plan, --rename)"],
	["/docs [task]", "Generate/update documentation"],
	["/diff", "Show recent file changes"],
	["/mcp", "Show MCP server status"],
	["/branch", "Branch the current session"],
	["/tree", "Show session tree"],
	["/skill <sub> <file>", "Import/export/convert skills (Setu)"],
	["/skills <sub>", "Skill security (pending/approve/reject/scan)"],
	["/chetana", "Show consciousness/cognitive state"],
	["/vidya", "Show Vidya skill ecosystem dashboard"],
	["/stats", "Show codebase power stats"],
	["/vasana", "List crystallized tendencies"],
	["/nidra", "Show sleep cycle daemon status"],
	["/vidhi", "List learned procedures"],
	["/pratyabhijna", "Show self-recognition narrative"],
	["/turiya [routing]", "Show model routing stats (Turiya)"],
	["/health", "Show Triguna health (sattva/rajas/tamas)"],
	["/rta [audit]", "Show Rta invariant rules or audit log"],
	["/buddhi [explain <id>]", "Show decisions with Nyaya reasoning"],
	["/samiti", "Samiti ambient channels dashboard"],
	["/sabha", "Sabha deliberation protocol status"],
	["/lokapala", "Lokapala guardian agent status"],
	["/akasha", "Akasha shared knowledge field"],
	["/kartavya", "Kartavya auto-execution pipeline"],
	["/kala", "Kala Chakra temporal awareness"],
	["/atman", "Complete agent soul report"],
	["/workflow [sub]", "Vayu DAG workflows (list/show/run/history)"],
	["/quit", "Exit Chitragupta"],
	["/help", "Show this help"],
];

/** Handle core & session slash commands. Returns `null` if the command is not recognized. */
export async function handleCoreCommand(
	cmd: string,
	parts: string[],
	ctx: SlashCommandContext,
): Promise<SlashCommandResult | null> {
	const { agent, stdout, stats } = ctx;

	switch (cmd) {
		case "/help": {
			stdout.write("\n" + bold("Interactive Commands") + "\n\n");
			for (const [c, desc] of HELP_ENTRIES) {
				stdout.write("  " + cyan(c.padEnd(24)) + desc + "\n");
			}
			stdout.write("\n  " + dim("Keyboard shortcuts:") + "\n");
			stdout.write("  " + dim("Ctrl+C") + "               Clear input (twice to quit)\n");
			stdout.write("  " + dim("Escape") + "               Abort current operation\n");
			stdout.write("  " + dim("Ctrl+L") + "               Model selector\n");
			stdout.write("  " + dim("Shift+Tab") + "            Cycle thinking level\n");
			stdout.write("  " + dim("Tab") + "                  Complete slash command\n");
			stdout.write("  " + dim("Enter") + "                Send message\n\n");
			return { handled: true };
		}

		case "/model": {
			const modelId = parts[1];
			if (!modelId) {
				stdout.write(yellow("\n  Usage: /model <model-id>\n\n"));
				return { handled: true };
			}
			agent.setModel(modelId);
			stdout.write(green(`\n  Model switched to ${bold(modelId)}\n\n`));
			ctx.onModelChange?.(modelId);
			return { handled: true, newModel: modelId };
		}

		case "/thinking": {
			const level = parts[1] as ThinkingLevel | undefined;
			if (!level || !THINKING_LEVELS.includes(level)) {
				stdout.write(
					yellow(`\n  Usage: /thinking <${THINKING_LEVELS.join("|")}>\n`) +
					dim(`  Current: ${ctx.currentThinking}\n\n`),
				);
				return { handled: true };
			}
			agent.setThinkingLevel(level);
			stdout.write(green(`\n  Thinking level set to ${bold(level)}\n\n`));
			ctx.onThinkingChange?.(level);
			return { handled: true, newThinking: level };
		}

		case "/compact": {
			stdout.write(dim("\n  Compacting conversation context...\n"));
			const ctxManager = agent.getContextManager();
			if (ctxManager?.compact) {
				const state = agent.getState();
				const compacted = ctxManager.compact(state);
				agent.replaceState(compacted);
				stdout.write(green(`  Compacted: ${state.messages.length} messages -> ${compacted.messages.length} messages\n\n`));
			} else {
				stdout.write(yellow("  Compaction not available.\n\n"));
			}
			return { handled: true };
		}

		case "/memory": {
			const subCmd = parts[1];
			const searchQuery = parts.slice(2).join(" ");

			if (subCmd === "search" && searchQuery) {
				try {
					const { HybridSearchEngine } = await import("@chitragupta/smriti");
					const { AnveshanaEngine } = await import("@chitragupta/smriti");
					const hybridSearch = new HybridSearchEngine({ project: process.cwd() });
					const anveshana = new AnveshanaEngine(hybridSearch, { maxSubQueries: 4, maxRounds: 3, adaptiveTermination: true });
					const results = await anveshana.search(searchQuery);
					const searchStats = anveshana.getLastSearchStats();

					stdout.write("\n" + bold("Memory Search (Anveshana)") + gray(` for "${searchQuery}"`) + "\n");
					if (searchStats) {
						stdout.write(dim(`  ${searchStats.totalRounds} round(s), ${searchStats.subQueriesGenerated} sub-queries, ${results.length} result(s)`) + "\n");
					}
					stdout.write("\n");
					if (results.length === 0) {
						stdout.write(yellow("  No results found.\n"));
					} else {
						for (let i = 0; i < Math.min(results.length, 10); i++) {
							const r = results[i];
							stdout.write(`  ${cyan(`${i + 1}.`)} ${bold(r.title)} ${dim(`(score: ${r.score.toFixed(3)})`)}\n`);
							const snippet = r.content.length > 120 ? r.content.slice(0, 120) + "..." : r.content;
							stdout.write(`     ${snippet}\n`);
							if (r.foundBy.length > 1) {
								stdout.write(dim(`     Found by: ${r.foundBy.join(", ")}`) + "\n");
							}
						}
					}
					stdout.write("\n");
				} catch {
					const { search: searchMemory } = await import("../commands/memory.js");
					await searchMemory(searchQuery);
				}
				return { handled: true };
			}

			const { show: showMemory } = await import("../commands/memory.js");
			if (subCmd === "search" && !searchQuery) {
				stdout.write(yellow("\n  Usage: /memory search <query>\n\n"));
			} else {
				await showMemory();
			}
			return { handled: true };
		}

		case "/clear": {
			agent.clearMessages();
			stats.totalCost = 0;
			stats.totalInputTokens = 0;
			stats.totalOutputTokens = 0;
			stats.contextPercent = 0;
			stats.turnCount = 0;
			stdout.write(clearScreen());
			stdout.write(green("  Conversation cleared.\n\n"));
			return { handled: true };
		}

		case "/status": {
			stdout.write("\n" + bold("Session Status") + "\n\n");
			stdout.write(`  Model: ${cyan(ctx.currentModel)}\n`);
			stdout.write(`  Thinking: ${cyan(ctx.currentThinking)}\n`);
			stdout.write(`  Turns: ${stats.turnCount}\n`);
			stdout.write(`  Total cost: $${stats.totalCost.toFixed(4)}\n`);
			stdout.write(`  Input tokens: ${stats.totalInputTokens}\n`);
			stdout.write(`  Output tokens: ${stats.totalOutputTokens}\n`);
			stdout.write(`  Context usage: ~${Math.round(stats.contextPercent)}%\n`);
			stdout.write(`  Messages in history: ${agent.getMessages().length}\n\n`);
			return { handled: true };
		}

		case "/cost": {
			stdout.write("\n" + bold("Cost Breakdown") + "\n\n");
			stdout.write(`  Total cost:     ${cyan("$" + stats.totalCost.toFixed(6))}\n`);
			stdout.write(`  Input tokens:   ${stats.totalInputTokens}\n`);
			stdout.write(`  Output tokens:  ${stats.totalOutputTokens}\n`);
			stdout.write(`  Total tokens:   ${stats.totalInputTokens + stats.totalOutputTokens}\n`);
			stdout.write(`  Turns:          ${stats.turnCount}\n`);
			if (stats.turnCount > 0) {
				stdout.write(`  Avg cost/turn:  $${(stats.totalCost / stats.turnCount).toFixed(6)}\n`);
			}
			stdout.write("\n");
			return { handled: true };
		}

		case "/diff": {
			stdout.write("\n" + bold("Recent File Changes") + "\n\n");
			const messages = agent.getMessages();
			let changeCount = 0;
			for (const msg of messages) {
				for (const part of msg.content) {
					if (part.type === "tool_call") {
						const toolCall = part as { type: "tool_call"; name: string; arguments: string };
						if (toolCall.name === "write" || toolCall.name === "edit") {
							try {
								const toolArgs = JSON.parse(toolCall.arguments);
								const filePath = (toolArgs.path || toolArgs.file_path || "unknown") as string;
								const action = toolCall.name === "write" ? "wrote" : "edited";
								stdout.write(`  ${yellow(action)}: ${filePath}\n`);
								changeCount++;
							} catch { /* skip */ }
						}
					}
				}
			}
			if (changeCount === 0) stdout.write(dim("  No file changes in this session.\n"));
			stdout.write("\n");
			return { handled: true };
		}

		case "/agents": {
			stdout.write("\n" + bold("Agent Tree") + "\n\n");
			const tree = agent.renderTree();
			for (const treeLine of tree.split("\n")) stdout.write("  " + treeLine + "\n");
			stdout.write("\n");
			return { handled: true };
		}

		case "/delegate": {
			const purpose = parts[1];
			const taskMsg = parts.slice(2).join(" ");
			if (!purpose || !taskMsg) {
				stdout.write(
					yellow("\n  Usage: /delegate <purpose> <task message>\n") +
					dim("  Example: /delegate code-reviewer Review the last 3 files I edited\n\n"),
				);
				return { handled: true };
			}
			stdout.write(dim(`\n  Spawning sub-agent "${purpose}"...\n`));
			try {
				const result = await agent.delegate({ purpose }, taskMsg);
				const responseText = result.response.content
					.filter((p) => p.type === "text")
					.map((p) => (p as { type: "text"; text: string }).text)
					.join("");
				stdout.write("\n" + bold(magenta(`  Sub-agent: ${purpose}`)) + "\n\n");
				stdout.write("  " + responseText.replace(/\n/g, "\n  ") + "\n");
				if (result.cost) stdout.write(dim(`\n  Cost: $${result.cost.total.toFixed(4)}`) + "\n");
				stdout.write("\n");
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/mcp": {
			stdout.write("\n" + bold("MCP Servers") + "\n\n");
			try {
				const { getMCPRegistry } = await import("../mcp-loader.js");
				const registry = getMCPRegistry();
				if (!registry) {
					stdout.write(dim("  No MCP servers initialized.\n"));
					stdout.write(gray("  Configure servers in ~/.chitragupta/mcp.json or .chitragupta/mcp.json\n"));
				} else {
					const servers = registry.listServers();
					if (servers.length === 0) {
						stdout.write(dim("  No MCP servers registered.\n"));
					} else {
						for (const server of servers) {
							const stateColor = server.state === "ready" ? green : server.state === "error" ? red : yellow;
							stdout.write(`  ${bold(server.config.name)} ${stateColor(`[${server.state}]`)}\n`);
							stdout.write(`    ${dim("id:")} ${server.config.id}  ${dim("tools:")} ${server.tools.length}\n`);
							if (server.lastError) stdout.write(`    ${red("error:")} ${server.lastError.message}\n`);
						}
						const totalTools = registry.getToolCount();
						stdout.write("\n" + dim(`  Total: ${servers.length} server(s), ${totalTools} tool(s)`) + "\n");
					}
				}
			} catch {
				stdout.write(dim("  MCP support not available.\n"));
			}
			stdout.write("\n");
			return { handled: true };
		}

		case "/branch": {
			stdout.write("\n" + bold("Branch Session") + "\n\n");
			try {
				const { branchSession } = await import("@chitragupta/smriti/branch");
				const agentState = agent.getState() as Record<string, unknown>;
				const sessionId = agentState.sessionId as string | undefined;
				if (!sessionId) {
					stdout.write(yellow("  No active session to branch.\n"));
				} else {
					const branchName = parts[1] || `branch-${Date.now()}`;
					const newSession = branchSession(sessionId, process.cwd(), branchName);
					stdout.write(green(`  Branched session: ${bold(newSession.meta.id)}\n`));
					stdout.write(dim(`  Name: ${branchName}\n`));
					stdout.write(dim(`  Parent: ${sessionId}\n`));
				}
			} catch {
				stdout.write(dim("  Session branching not available.\n"));
			}
			stdout.write("\n");
			return { handled: true };
		}

		case "/tree": {
			stdout.write("\n" + bold("Session Tree") + "\n\n");
			try {
				const { getSessionTree } = await import("@chitragupta/smriti/branch");
				const { SessionTree: SessionTreeComponent } = await import("@chitragupta/ui/components/session-tree");
				const smritiTree = getSessionTree(process.cwd());
				type UITreeNode = { id: string; title: string; date?: string; turnCount?: number; children?: UITreeNode[] };
				function convertNode(node: { session: { id: string; title: string; updated: string }; children: unknown[] }): UITreeNode {
					return {
						id: node.session.id,
						title: node.session.title,
						date: node.session.updated,
						children: (node.children as typeof node[]).map(convertNode),
					};
				}
				const uiNodes = [convertNode(smritiTree.root as unknown as Parameters<typeof convertNode>[0])];
				const treeComponent = new SessionTreeComponent(uiNodes);
				const cols = stdout.columns || 80;
				const rows = stdout.rows || 24;
				const rendered = treeComponent.render(cols - 4, rows - 6);
				for (const treeLine of rendered) stdout.write("  " + treeLine + "\n");
			} catch {
				stdout.write(dim("  Session tree not available.\n"));
			}
			stdout.write("\n");
			return { handled: true };
		}

		case "/skill": {
			const subCmd = parts[1];
			const rest = parts.slice(2).join(" ").trim();
			if (!subCmd) {
				stdout.write(yellow("\n  Usage: /skill <detect|import|export|convert> <file> [--format <fmt>] [--to <fmt>]\n"));
				stdout.write(dim("  Setu (bridge) — convert skills between vidhya, Claude, and Gemini formats.\n\n"));
				stdout.write(dim("  /skill detect <file>                    Detect skill file format\n"));
				stdout.write(dim("  /skill import <file>                    Import to vidhya format\n"));
				stdout.write(dim("  /skill export <file> --format claude     Export to Claude SKILL.md\n"));
				stdout.write(dim("  /skill convert <file> --to gemini        Convert to Gemini extension\n\n"));
				return { handled: true };
			}
			try {
				const { runSkillPorterCommand } = await import("../commands/skill-porter.js");
				await runSkillPorterCommand(subCmd, rest ? rest.split(/\s+/) : []);
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/skills": {
			try {
				const { runSkillsCommand } = await import("../commands/skills.js");
				await runSkillsCommand(parts[1], parts.slice(2), stdout);
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/learn": {
			try {
				const { runSkillsCommand } = await import("../commands/skills.js");
				await runSkillsCommand("learn", [parts.slice(1).join(" ")], stdout);
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/vidya": {
			try {
				const { runVidyaCommand } = await import("../commands/vidya.js");
				type VidyaOrch = Parameters<typeof runVidyaCommand>[0];
				await runVidyaCommand(ctx.vidyaOrchestrator as unknown as VidyaOrch, parts.slice(1).join(" ").trim() || undefined, stdout);
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/stats":
		case "/power": {
			try {
				const { renderStatsCommand } = await import("../commands/stats.js");
				await renderStatsCommand(stdout, ctx.projectPath);
			} catch (err) {
				stdout.write(red(`  Error: ${err instanceof Error ? err.message : String(err)}\n\n`));
			}
			return { handled: true };
		}

		case "/quit":
		case "/exit":
		case "/q": {
			stdout.write(dim("\n  Goodbye.\n\n"));
			ctx.cleanup();
			return { handled: true, exit: true };
		}

		default:
			return null;
	}
}
