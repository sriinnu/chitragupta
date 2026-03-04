/**
 * @chitragupta/cli — Interactive Coding REPL.
 *
 * Opens when `chitragupta code` is run without a task argument.
 * A focused coding workspace with:
 *   - Project context display (git branch, framework, language)
 *   - Task prompt with readline + history
 *   - CLI routing during task execution
 *   - Session continuity (same environment across tasks)
 *   - Slash commands: /plan, /ask, /chat, /undo, /diff, /mode, /status, /git, /branch, /config, /quit
 */

import * as readline from "node:readline";
import * as path from "node:path";
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
} from "@chitragupta/ui/ansi";
import {
	printBanner,
	formatMs,
	detectProject,
	printProjectInfo,
	printHelp,
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
	cli: string;
	elapsedMs: number;
}

// ─── Main REPL ──────────────────────────────────────────────────────────────

export async function runCodeInteractive(options: CodeInteractiveOptions): Promise<number> {
	const { loadGlobalSettings } = await import("@chitragupta/core");
	const settings = loadGlobalSettings();
	const cd = settings.coding ?? {};
	const { stdout, stderr } = process;

	const projectPath = options.project;
	const timeout = options.timeout ?? cd.timeout ?? 300;

	// ── Detect available coding CLIs ─────────────────────────────
	const { detectCodingClis, routeCodingTask } = await import("./coding-router.js");
	const clis = await detectCodingClis();
	const cliNames = clis.map((c) => c.name).join(", ") || "none";

	if (clis.length === 0) {
		stderr.write(red("\n  No coding CLI available on PATH.\n\n"));
		stderr.write(dim("  Install one of:\n"));
		stderr.write(dim("    - takumi (https://github.com/sriinnu/takumi)\n"));
		stderr.write(dim("    - claude (https://docs.anthropic.com/en/docs/claude-code)\n"));
		stderr.write(dim("    - codex  (https://github.com/openai/codex)\n"));
		stderr.write(dim("    - aider  (https://aider.chat)\n\n"));
		return 1;
	}

	// ── Banner & project info ───────────────────────────────────
	printBanner();

	const project = detectProject(projectPath);
	printProjectInfo(project, projectPath, cliNames, undefined, "cli-router");

	stdout.write(dim(`  Available CLIs: ${cyan(cliNames)}\n`));
	stdout.write(dim(`  Primary: ${green(clis[0].name)}\n\n`));

	printHelp();

	// ── Task history ────────────────────────────────────────────
	const history: TaskHistory[] = [];

	// ── Readline REPL ───────────────────────────────────────────
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: `${cyan("  >")} `,
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

					case "/diff": {
						try {
							const diff = execSync("git diff", { cwd: projectPath, encoding: "utf-8" }).trim();
							if (diff) {
								stdout.write("\n");
								for (const diffLine of diff.split("\n")) {
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
								stdout.write(dim("\n  No changes.\n\n"));
							}
						} catch {
							stdout.write(yellow("\n  Not a git repository.\n\n"));
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
								const mark = h.success ? green("v") : red("x");
								stdout.write(`  ${dim(`${i + 1}.`)} ${mark} [${h.cli}] ${h.task.slice(0, 60)}${h.task.length > 60 ? "..." : ""}`);
								stdout.write(`  ${dim(formatMs(h.elapsedMs))}\n`);
							}
							stdout.write("\n");
						}
						rl.prompt();
						return;
					}

					case "/undo": {
						try {
							execSync("git reset --soft HEAD~1", { cwd: projectPath, encoding: "utf-8" });
							stdout.write(green("\n  Undid last commit.\n"));
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
							stdout.write(`  ${dim("CLIs:")}   ${cyan(cliNames)}\n`);
							if (status) {
								stdout.write("\n");
								for (const statusLine of status.split("\n").slice(0, 20)) {
									const code = statusLine.slice(0, 2);
									const file = statusLine.slice(3);
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
								execSync(`git checkout ${arg}`, { cwd: projectPath, encoding: "utf-8" });
								stdout.write(green(`\n  Switched to branch: ${arg}\n\n`));
							} else {
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

					case "/config": {
						stdout.write("\n");
						stdout.write(`  ${dim("Available CLIs:")} ${cyan(cliNames)}\n`);
						stdout.write(`  ${dim("Primary CLI:")}    ${bold(clis[0].name)}\n`);
						stdout.write(`  ${dim("Timeout:")}        ${timeout}s\n`);
						stdout.write(`  ${dim("Project:")}        ${projectPath}\n`);
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
			await runTask(input);
			rl.prompt();
		});

		rl.on("close", () => {
			resolve(0);
		});

		async function runTask(task: string): Promise<void> {
			stdout.write("\n");

			if (task.length > 5000) {
				stdout.write(yellow(`  Warning: Task is very long (${task.length} chars). Consider splitting.\n\n`));
			}

			stdout.write(dim(`  -- Routing to ${clis[0].name}: `) + task.slice(0, 60) + (task.length > 60 ? "..." : "") + "\n\n");

			const t0 = performance.now();
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeout * 1000);

			try {
				const result = await routeCodingTask({
					task,
					cwd: projectPath,
					signal: controller.signal,
					onOutput: (chunk) => {
						stdout.write(`  ${gray(chunk.replace(/\n/g, "\n  "))}`);
					},
				});

				clearTimeout(timer);
				const elapsedMs = performance.now() - t0;

				stdout.write("\n");
				const status = result.exitCode === 0
					? green("Success")
					: red(`Failed (exit ${result.exitCode})`);
				stdout.write(`  ${dim("CLI:")} ${result.cli} | ${dim("Status:")} ${status} | ${dim("Time:")} ${formatMs(elapsedMs)}\n\n`);

				history.push({
					task,
					success: result.exitCode === 0,
					cli: result.cli,
					elapsedMs,
				});
			} catch (err) {
				clearTimeout(timer);
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("abort") || msg.includes("ABORT")) {
					stdout.write(red(`\n  Task timed out after ${timeout}s.\n\n`));
				} else {
					stdout.write(red(`\n  Error: ${msg}\n\n`));
				}
			}
		}
	});
}
