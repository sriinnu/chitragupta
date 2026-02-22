/**
 * @chitragupta/cli — Interactive Coding REPL.
 *
 * Opens when `chitragupta code` is run without a task argument.
 * A focused coding workspace with:
 *   - Project context display (git branch, framework, language)
 *   - Task prompt with readline + history
 *   - Live phase streaming during orchestrator execution
 *   - Colored diff preview after each task
 *   - Session continuity (same provider across tasks)
 *   - Slash commands: /plan, /ask, /chat, /undo, /diff, /mode, /status, /git, /branch, /config, /quit
 */

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { askCodebase, chatResponse } from "./code-interactive-agents.js";
import { execSync } from "node:child_process";
import {
	bold,
	dim,
	gray,
	cyan,
	yellow,
	green,
	red,
	reset,
	rgb,
} from "@chitragupta/ui/ansi";
import type { CodingSetup } from "../coding-setup.js";
import {
	printBanner,
	formatMs,
	detectProject,
	printProjectInfo,
	printHelp,
	createProgressRenderer,
	createCodingEventRenderer,
	displayResult,
} from "./code-interactive-render.js";
import type { ProjectSnapshot } from "./code-interactive-render.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CodeInteractiveOptions {
	/** Project root directory. */
	project: string;
	/** Explicit provider override. */
	provider?: string;
	/** Model ID override. */
	model?: string;
	/** Default execution mode. */
	mode?: "full" | "execute" | "plan-only";
	/** Create git branches. */
	createBranch?: boolean;
	/** Auto-commit on success. */
	autoCommit?: boolean;
	/** Self-review after coding. */
	selfReview?: boolean;
	/** Timeout per task in seconds. */
	timeout?: number;
}

interface TaskHistory {
	task: string;
	success: boolean;
	filesModified: string[];
	filesCreated: string[];
	branch: string | null;
	commits: string[];
	elapsedMs: number;
	diffPreview?: string;
}

// ─── Main REPL ──────────────────────────────────────────────────────────────

export async function runCodeInteractive(options: CodeInteractiveOptions): Promise<number> {
	const { loadGlobalSettings } = await import("@chitragupta/core");
	const settings = loadGlobalSettings();
	const cd = settings.coding ?? {};
	const { stdout, stderr } = process;

	const projectPath = options.project;
	let mode: "full" | "execute" | "plan-only" = options.mode ?? cd.mode ?? "full";
	const timeout = options.timeout ?? cd.timeout ?? 300;

	// ── Setup provider (once, reused across all tasks) ──────────
	const { setupCodingEnvironment, createCodingOrchestrator } = await import("../coding-setup.js");

	const setup = await setupCodingEnvironment({
		projectPath,
		explicitProvider: options.provider,
		sessionId: "coding-repl",
	});

	if (!setup) {
		stderr.write(red("\n  No AI provider available.\n\n"));
		stderr.write(dim("  Quick fix:\n"));
		stderr.write(dim("    1. Set your provider API key as an environment variable\n"));
		stderr.write(dim("    2. Or register:  ") + cyan("chitragupta provider add anthropic") + "\n");
		stderr.write(dim("    3. List providers: ") + cyan("chitragupta provider list") + "\n\n");
		return 1;
	}

	const codingSetup: CodingSetup = setup;

	// ── Banner & project info ───────────────────────────────────
	printBanner();

	const project = detectProject(projectPath);
	printProjectInfo(project, projectPath, codingSetup.providerId, options.model, mode);

	printHelp();

	// ── Task history ────────────────────────────────────────────
	const history: TaskHistory[] = [];
	let lastDiff: string | undefined;

	// ── Readline REPL ───────────────────────────────────────────
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: `${cyan("  ❯")} `,
		historySize: 100,
	});

	rl.prompt();

	return new Promise<number>((resolve) => {
		rl.on("line", async (line: string) => {
			const input = line.trim();

			if (!input) {
				rl.prompt();
				return;
			}

			// ── Slash commands ───────────────────────────────
			if (input.startsWith("/")) {
				const [cmd, ...args] = input.split(/\s+/);
				const arg = args.join(" ");

				switch (cmd) {
					case "/quit":
					case "/exit":
					case "/q":
						stdout.write(dim("\n  Goodbye.\n\n"));
						rl.close();
						resolve(0);
						return;

					case "/help":
					case "/h":
						printHelp();
						rl.prompt();
						return;

					case "/clear":
						stdout.write("\x1B[2J\x1B[H");
						printBanner();
						rl.prompt();
						return;

					case "/mode": {
						if (arg === "full" || arg === "execute" || arg === "plan-only") {
							mode = arg;
							stdout.write(green(`\n  Mode set to: ${mode}\n\n`));
						} else {
							stdout.write(yellow(`\n  Usage: /mode <full|execute|plan-only>\n  Current: ${mode}\n\n`));
						}
						rl.prompt();
						return;
					}

					case "/plan": {
						if (!arg) {
							stdout.write(yellow("\n  Usage: /plan <task description>\n\n"));
							rl.prompt();
							return;
						}
						// Run with plan-only mode, then restore
						await runTask(arg, "plan-only");
						rl.prompt();
						return;
					}

					case "/diff": {
						if (lastDiff) {
							stdout.write("\n");
							for (const diffLine of lastDiff.split("\n")) {
								if (diffLine.startsWith("+") && !diffLine.startsWith("+++")) {
									stdout.write(`  ${green(diffLine)}\n`);
								} else if (diffLine.startsWith("-") && !diffLine.startsWith("---")) {
									stdout.write(`  ${red(diffLine)}\n`);
								} else if (diffLine.startsWith("@@")) {
									stdout.write(`  ${cyan(diffLine)}\n`);
								} else {
									stdout.write(`  ${dim(diffLine)}\n`);
								}
							}
							stdout.write("\n");
						} else {
							stdout.write(dim("\n  No diff available. Run a task first.\n\n"));
						}
						rl.prompt();
						return;
					}

					case "/history": {
						if (history.length === 0) {
							stdout.write(dim("\n  No tasks run yet.\n\n"));
						} else {
							stdout.write("\n");
							for (let i = 0; i < history.length; i++) {
								const h = history[i];
								const mark = h.success ? green("✓") : red("✗");
								const files = [...h.filesModified, ...h.filesCreated].length;
								stdout.write(`  ${dim(`${i + 1}.`)} ${mark} ${h.task.slice(0, 60)}${h.task.length > 60 ? "..." : ""}`);
								stdout.write(`  ${dim(formatMs(h.elapsedMs))} ${dim(files + " file(s)")}\n`);
							}
							stdout.write("\n");
						}
						rl.prompt();
						return;
					}

					case "/undo": {
						if (history.length === 0 || history[history.length - 1].commits.length === 0) {
							stdout.write(yellow("\n  Nothing to undo.\n\n"));
							rl.prompt();
							return;
						}
						const last = history[history.length - 1];
						try {
							execSync("git reset --soft HEAD~1", { cwd: projectPath, encoding: "utf-8" });
							stdout.write(green(`\n  Undid commit: ${last.commits[last.commits.length - 1]}\n`));
							stdout.write(dim("  Changes are staged. Use git restore/reset to discard.\n\n"));
						} catch (err) {
							stdout.write(red(`\n  Undo failed: ${err instanceof Error ? err.message : String(err)}\n\n`));
						}
						rl.prompt();
						return;
					}

					case "/status":
					case "/st": {
						try {
							const status = execSync("git status --short", { cwd: projectPath, encoding: "utf-8" }).trim();
							const branch = execSync("git branch --show-current", { cwd: projectPath, encoding: "utf-8" }).trim();
							stdout.write(`\n  ${dim("Branch:")} ${cyan(branch)}\n`);
							if (status) {
								stdout.write("\n");
								for (const line of status.split("\n").slice(0, 20)) {
									const code = line.slice(0, 2);
									const file = line.slice(3);
									if (code.includes("M")) stdout.write(`  ${yellow("M")} ${file}\n`);
									else if (code.includes("A") || code.includes("?")) stdout.write(`  ${green("A")} ${file}\n`);
									else if (code.includes("D")) stdout.write(`  ${red("D")} ${file}\n`);
									else stdout.write(`  ${dim(code)} ${file}\n`);
								}
								const total = status.split("\n").length;
								if (total > 20) stdout.write(dim(`  ... and ${total - 20} more\n`));
							} else {
								stdout.write(dim("  Working tree clean.\n"));
							}
							stdout.write("\n");
						} catch {
							stdout.write(yellow("\n  Not a git repository.\n\n"));
						}
						rl.prompt();
						return;
					}

					case "/git": {
						if (!arg) {
							stdout.write(yellow("\n  Usage: /git <command>  (e.g. /git log --oneline -5)\n\n"));
							rl.prompt();
							return;
						}
						try {
							const out = execSync(`git ${arg}`, { cwd: projectPath, encoding: "utf-8", timeout: 10_000 }).trim();
							if (out) stdout.write(`\n${out}\n\n`);
							else stdout.write(dim("\n  (no output)\n\n"));
						} catch (err) {
							stdout.write(red(`\n  git ${arg}: ${err instanceof Error ? err.message : String(err)}\n\n`));
						}
						rl.prompt();
						return;
					}

					case "/branch": {
						try {
							if (arg) {
								// Switch branch
								execSync(`git checkout ${arg}`, { cwd: projectPath, encoding: "utf-8" });
								stdout.write(green(`\n  Switched to branch: ${arg}\n\n`));
							} else {
								// List branches
								const branches = execSync("git branch", { cwd: projectPath, encoding: "utf-8" }).trim();
								stdout.write("\n");
								for (const b of branches.split("\n")) {
									if (b.startsWith("*")) stdout.write(`  ${green(b.trim())}\n`);
									else stdout.write(`  ${dim(b.trim())}\n`);
								}
								stdout.write("\n");
							}
						} catch (err) {
							stdout.write(red(`\n  ${err instanceof Error ? err.message : String(err)}\n\n`));
						}
						rl.prompt();
						return;
					}

					case "/ask": {
						if (!arg) {
							stdout.write(yellow("\n  Usage: /ask <question about the codebase>\n\n"));
							rl.prompt();
							return;
						}
						await askCodebase(arg, codingSetup, projectPath, options.model);
						rl.prompt();
						return;
					}

					case "/chat": {
						if (!arg) {
							stdout.write(yellow("\n  Usage: /chat <message>\n\n"));
							rl.prompt();
							return;
						}
						await chatResponse(arg, codingSetup, projectPath, options.model);
						rl.prompt();
						return;
					}

					case "/config": {
						stdout.write("\n");
						stdout.write(`  ${dim("Mode:")}        ${bold(mode)}\n`);
						stdout.write(`  ${dim("Provider:")}    ${cyan(codingSetup.providerId)}${options.model ? dim(` / ${options.model}`) : ""}\n`);
						stdout.write(`  ${dim("Branch:")}      ${options.createBranch !== false ? green("on") : red("off")}\n`);
						stdout.write(`  ${dim("Auto-commit:")} ${options.autoCommit !== false ? green("on") : red("off")}\n`);
						stdout.write(`  ${dim("Self-review:")} ${options.selfReview !== false ? green("on") : red("off")}\n`);
						stdout.write(`  ${dim("Timeout:")}     ${timeout}s\n`);
						stdout.write(`  ${dim("Project:")}     ${projectPath}\n`);
						stdout.write("\n");
						rl.prompt();
						return;
					}

					default:
						stdout.write(yellow(`\n  Unknown command: ${cmd}. Type /help for commands.\n\n`));
						rl.prompt();
						return;
				}
			}

			// ── Run coding task ──────────────────────────────
			await runTask(input, mode);
			rl.prompt();
		});

		rl.on("close", () => {
			resolve(0);
		});

		async function runTask(task: string, taskMode: "full" | "execute" | "plan-only"): Promise<void> {
			stdout.write("\n");

			// Warn on very long tasks
			if (task.length > 5000) {
				stdout.write(yellow(`  Warning: Task is very long (${task.length} chars). Consider splitting into smaller tasks.\n\n`));
			}

			stdout.write(dim(`  ── ${taskMode === "plan-only" ? "Planning" : "Running"}: `) + task.slice(0, 60) + (task.length > 60 ? "..." : "") + "\n\n");

			const onProgress = createProgressRenderer();
			const onCodingEvent = createCodingEventRenderer();

			try {
				const orchestrator = await createCodingOrchestrator({
					setup: codingSetup,
					projectPath,
					mode: taskMode,
					modelId: options.model,
					createBranch: options.createBranch ?? cd.createBranch,
					autoCommit: options.autoCommit ?? cd.autoCommit,
					selfReview: options.selfReview ?? cd.selfReview,
					timeoutMs: timeout * 1000,
					onProgress,
					onCodingEvent,
				});

				const result = await orchestrator.run(task);

				// Detect non-coding query (empty plan, no files changed) — route to chat
				if (!result.success && result.plan && result.plan.steps.length === 0) {
					stdout.write(dim("  Not a coding task — routing to chat...\n"));
					await chatResponse(task, codingSetup, projectPath, options.model);
				} else {
					displayResult(result);
				}

				// Save to history
				lastDiff = result.diffPreview;
				history.push({
					task,
					success: result.success,
					filesModified: result.filesModified,
					filesCreated: result.filesCreated,
					branch: result.git.featureBranch,
					commits: result.git.commits,
					elapsedMs: result.elapsedMs,
					diffPreview: result.diffPreview,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
					stdout.write(red(`\n  Task timed out after ${timeout}s.\n`));
					stdout.write(dim("  Try: /mode execute (skip git), or increase timeout with --timeout\n\n"));
				} else if (msg.includes("provider") || msg.includes("API") || msg.includes("401") || msg.includes("403")) {
					stdout.write(red(`\n  Provider error: ${msg}\n`));
					stdout.write(dim("  Check your API key and provider configuration.\n\n"));
				} else {
					stdout.write(red(`\n  Error: ${msg}\n\n`));
				}
			}
		}

		/**
		 * Ask a question about the codebase using read-only tools.
		 * The agent can read, grep, find, and ls files but cannot edit or write.
		 */


		/**
		 * Send a non-coding message to the AI and display the response.
		 * Uses a lightweight one-shot agent call — no orchestrator, no git, no tools.
		 */

	});
}
