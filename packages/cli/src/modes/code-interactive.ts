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
 *   - Slash commands: /plan, /undo, /diff, /mode, /quit
 */

import * as readline from "node:readline";
import {
	bold,
	dim,
	gray,
	cyan,
	yellow,
	green,
	red,
	magenta,
	white,
	reset,
	rgb,
} from "@chitragupta/ui/ansi";
import type { CodingSetup } from "../coding-setup.js";

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

// ─── ANSI Helpers ───────────────────────────────────────────────────────────

/** Saffron (#FF9933) → Gold (#FFD700) gradient for the banner. */
const GRADIENT: Array<[number, number, number]> = [
	[255, 153, 51],
	[255, 167, 38],
	[255, 183, 28],
	[255, 199, 18],
	[255, 211, 8],
	[255, 215, 0],
];

const BANNER = [
	"  ██████╗  ██████╗ ██████╗ ███████╗",
	"  ██╔════╝██╔═══██╗██╔══██╗██╔════╝",
	"  ██║     ██║   ██║██║  ██║█████╗  ",
	"  ██║     ██║   ██║██║  ██║██╔══╝  ",
	"  ╚██████╗╚██████╔╝██████╔╝███████╗",
	"   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
];

function printBanner(): void {
	const { stdout } = process;
	stdout.write("\n");
	for (let i = 0; i < BANNER.length; i++) {
		const [r, g, b] = GRADIENT[i % GRADIENT.length];
		stdout.write(`${rgb(r, g, b)}${BANNER[i]}${reset}\n`);
	}
	stdout.write(dim("  Chitragupta Coding Agent (Kartru)\n"));
	stdout.write("\n");
}

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = ((ms % 60_000) / 1000).toFixed(0);
	return `${mins}m ${secs}s`;
}

// ─── Project Info ───────────────────────────────────────────────────────────

interface ProjectSnapshot {
	branch: string;
	language: string;
	framework: string;
	packageManager: string;
	hasTests: boolean;
}

function detectProject(projectPath: string): ProjectSnapshot {
	const fs = require("fs");
	const path = require("path");
	const { execSync } = require("child_process");

	let branch = "";
	try {
		branch = execSync("git branch --show-current 2>/dev/null", {
			cwd: projectPath,
			encoding: "utf-8",
		}).trim();
	} catch { /* not a git repo */ }

	let language = "unknown";
	let framework = "";
	let packageManager = "npm";
	let hasTests = false;

	const hasTsConfig = fs.existsSync(path.join(projectPath, "tsconfig.json"));
	const hasPkgJson = fs.existsSync(path.join(projectPath, "package.json"));

	if (hasTsConfig) language = "TypeScript";
	else if (hasPkgJson) language = "JavaScript";
	else if (fs.existsSync(path.join(projectPath, "pyproject.toml")) || fs.existsSync(path.join(projectPath, "setup.py"))) language = "Python";
	else if (fs.existsSync(path.join(projectPath, "Cargo.toml"))) language = "Rust";
	else if (fs.existsSync(path.join(projectPath, "go.mod"))) language = "Go";

	if (hasPkgJson) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf-8"));
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			if (deps.next) framework = "Next.js";
			else if (deps.react) framework = "React";
			else if (deps.vue) framework = "Vue";
			else if (deps.svelte || deps["@sveltejs/kit"]) framework = "Svelte";
			else if (deps.express) framework = "Express";
			else if (deps.hono) framework = "Hono";
			else if (deps.fastify) framework = "Fastify";

			if (deps.vitest) hasTests = true;
			else if (deps.jest) hasTests = true;
			else if (deps.mocha) hasTests = true;
		} catch { /* parse error */ }

		if (fs.existsSync(path.join(projectPath, "pnpm-lock.yaml"))) packageManager = "pnpm";
		else if (fs.existsSync(path.join(projectPath, "yarn.lock"))) packageManager = "yarn";
		else if (fs.existsSync(path.join(projectPath, "bun.lockb"))) packageManager = "bun";
	}

	return { branch, language, framework, packageManager, hasTests };
}

function printProjectInfo(project: ProjectSnapshot, projectPath: string, providerId: string, model: string | undefined, mode: string): void {
	const { stdout } = process;
	const path = require("path");
	const dirName = path.basename(projectPath);

	stdout.write(dim("  ─────────────────────────────────────\n"));
	stdout.write(`  ${dim("Project:")}  ${bold(dirName)}`);
	if (project.branch) stdout.write(`  ${dim("on")} ${cyan(project.branch)}`);
	stdout.write("\n");

	const parts: string[] = [];
	if (project.language !== "unknown") parts.push(project.language);
	if (project.framework) parts.push(project.framework);
	parts.push(project.packageManager);
	if (project.hasTests) parts.push("tests");

	stdout.write(`  ${dim("Stack:")}    ${parts.join(dim(" / "))}\n`);
	stdout.write(`  ${dim("Provider:")} ${cyan(providerId)}${model ? dim(` / ${model}`) : ""}\n`);
	stdout.write(`  ${dim("Mode:")}     ${mode}\n`);
	stdout.write(dim("  ─────────────────────────────────────\n"));
	stdout.write("\n");
}

// ─── Slash Commands ─────────────────────────────────────────────────────────

function printHelp(): void {
	const { stdout } = process;
	stdout.write("\n");
	stdout.write(bold("  Commands:\n"));
	stdout.write(`  ${cyan("/plan")} ${dim("<task>")}     Plan only (don't execute)\n`);
	stdout.write(`  ${cyan("/mode")} ${dim("<mode>")}     Switch mode (full, execute, plan-only)\n`);
	stdout.write(`  ${cyan("/diff")}             Show last diff\n`);
	stdout.write(`  ${cyan("/history")}          Show task history\n`);
	stdout.write(`  ${cyan("/undo")}             Undo last commit (git reset)\n`);
	stdout.write(`  ${cyan("/clear")}            Clear screen\n`);
	stdout.write(`  ${cyan("/quit")}             Exit\n`);
	stdout.write("\n");
	stdout.write(dim("  Type a coding task and press Enter to run it.\n\n"));
}

// ─── Phase Streaming ────────────────────────────────────────────────────────

function createProgressRenderer(): (progress: { phase: string; message: string; elapsedMs: number }) => void {
	const { stdout } = process;
	const phases = new Map<string, boolean>();

	return (progress) => {
		const isNew = !phases.has(progress.phase);
		phases.set(progress.phase, true);

		if (!isNew) return; // Only print first occurrence of each phase

		const icons: Record<string, string> = {
			plan: "📋",
			branch: "🌿",
			execute: "⚡",
			validate: "🧪",
			review: "🔍",
			commit: "💾",
			done: "✅",
			error: "❌",
		};

		const icon = icons[progress.phase] ?? "⧖";
		const phase = progress.phase.padEnd(10);
		const time = formatMs(progress.elapsedMs).padStart(8);

		stdout.write(`  ${icon} ${bold(phase)} ${dim(time)}\n`);
	};
}

// ─── Result Display ─────────────────────────────────────────────────────────

function displayResult(result: {
	success: boolean;
	plan: { task: string; steps: { index: number; description: string; completed: boolean }[]; complexity: string } | null;
	git: { featureBranch: string | null; commits: string[] };
	filesModified: string[];
	filesCreated: string[];
	reviewIssues: { severity: string; file: string; line?: number; message: string }[];
	validationPassed: boolean;
	elapsedMs: number;
	diffPreview?: string;
	diffStats?: { filesChanged: number; insertions: number; deletions: number };
	phaseTimings?: Array<{ phase: string; durationMs: number }>;
	errors?: Array<{ phase: string; message: string; recoverable: boolean }>;
}): void {
	const { stdout } = process;

	stdout.write("\n");

	// Status
	const status = result.success ? green("Success") : red("Failed");
	const complexity = result.plan?.complexity ?? "—";
	stdout.write(`  ${bold(status)}  ${dim("complexity:")} ${complexity}  ${dim("in")} ${formatMs(result.elapsedMs)}\n`);

	// Files
	if (result.filesModified.length > 0 || result.filesCreated.length > 0) {
		stdout.write("\n");
		if (result.filesModified.length > 0) {
			stdout.write(`  ${yellow("M")} ${result.filesModified.join(dim(", "))}\n`);
		}
		if (result.filesCreated.length > 0) {
			stdout.write(`  ${green("A")} ${result.filesCreated.join(dim(", "))}\n`);
		}
	}

	// Diff stats
	if (result.diffStats) {
		stdout.write(`  ${green("+" + result.diffStats.insertions)} ${red("-" + result.diffStats.deletions)} ${dim("in " + result.diffStats.filesChanged + " file(s)")}\n`);
	}

	// Git
	if (result.git.featureBranch || result.git.commits.length > 0) {
		stdout.write("\n");
		if (result.git.featureBranch) stdout.write(`  ${dim("Branch:")} ${cyan(result.git.featureBranch)}\n`);
		if (result.git.commits.length > 0) stdout.write(`  ${dim("Commit:")} ${dim(result.git.commits.join(", "))}\n`);
	}

	// Validation
	if (result.validationPassed !== undefined) {
		const val = result.validationPassed ? green("pass") : red("fail");
		stdout.write(`  ${dim("Tests:")}  ${val}\n`);
	}

	// Review issues
	if (result.reviewIssues.length > 0) {
		stdout.write(`\n  ${yellow(result.reviewIssues.length + " review issue(s):")}\n`);
		for (const issue of result.reviewIssues.slice(0, 5)) {
			const sev = issue.severity === "error" ? red(issue.severity) : yellow(issue.severity);
			stdout.write(`    ${sev} ${dim(issue.file)}${issue.line ? dim(":" + issue.line) : ""} ${issue.message}\n`);
		}
	}

	// Diff preview (collapsed — show first 20 lines)
	if (result.diffPreview) {
		stdout.write("\n" + dim("  ── Diff ──\n"));
		const lines = result.diffPreview.split("\n").slice(0, 20);
		for (const line of lines) {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				stdout.write(`  ${green(line)}\n`);
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				stdout.write(`  ${red(line)}\n`);
			} else if (line.startsWith("@@")) {
				stdout.write(`  ${cyan(line)}\n`);
			} else {
				stdout.write(`  ${dim(line)}\n`);
			}
		}
		const remaining = result.diffPreview.split("\n").length - 20;
		if (remaining > 0) {
			stdout.write(dim(`  ... ${remaining} more lines. Run /diff to see full.\n`));
		}
	}

	// Errors
	if (result.errors && result.errors.length > 0) {
		stdout.write("\n");
		for (const err of result.errors) {
			const recov = err.recoverable ? dim(" (recovered)") : "";
			stdout.write(`  ${red("[" + err.phase + "]")} ${err.message}${recov}\n`);
		}
	}

	stdout.write("\n");
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
		stderr.write(red("\n  No AI provider available.\n"));
		stderr.write(dim("  Run: chitragupta provider add anthropic\n\n"));
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
							const { execSync } = require("child_process");
							execSync("git reset --soft HEAD~1", { cwd: projectPath, encoding: "utf-8" });
							stdout.write(green(`\n  Undid commit: ${last.commits[last.commits.length - 1]}\n`));
							stdout.write(dim("  Changes are staged. Use git restore/reset to discard.\n\n"));
						} catch (err) {
							stdout.write(red(`\n  Undo failed: ${err instanceof Error ? err.message : String(err)}\n\n`));
						}
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
			stdout.write(dim(`  ── ${taskMode === "plan-only" ? "Planning" : "Running"}: `) + task.slice(0, 60) + (task.length > 60 ? "..." : "") + "\n\n");

			const onProgress = createProgressRenderer();

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
				});

				const result = await orchestrator.run(task);

				displayResult(result);

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
				stdout.write(red(`\n  Error: ${msg}\n\n`));
			}
		}
	});
}
