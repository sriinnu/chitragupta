/**
 * @chitragupta/cli — Coding REPL rendering helpers.
 *
 * Banner, project info display, slash command help, phase streaming,
 * coding event rendering, and result display for the coding REPL.
 * Extracted from code-interactive.ts to keep file sizes under 450 LOC.
 */

import * as fs from "node:fs";
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
	rgb,
} from "@chitragupta/ui/ansi";

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

export interface ProjectSnapshot {
	branch: string;
	language: string;
	framework: string;
	packageManager: string;
	hasTests: boolean;
}

function detectProject(projectPath: string): ProjectSnapshot {

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
	stdout.write(bold("  Tasks:\n"));
	stdout.write(`  ${dim("  Type a coding task and press Enter to run it.")}\n`);
	stdout.write(`  ${dim("  Example:")} fix the failing test in auth.test.ts\n`);
	stdout.write(`  ${dim("  Example:")} add input validation to the login form\n`);
	stdout.write("\n");
	stdout.write(bold("  Commands:\n"));
	stdout.write(`  ${cyan("/plan")} ${dim("<task>")}     Plan only, don't execute\n`);
	stdout.write(`  ${cyan("/ask")} ${dim("<question>")}  Ask about the codebase (reads files, no edits)\n`);
	stdout.write(`  ${cyan("/chat")} ${dim("<msg>")}      Chat with the AI (no code execution)\n`);
	stdout.write(`  ${cyan("/mode")} ${dim("<mode>")}     Switch mode (full, execute, plan-only)\n`);
	stdout.write(`  ${cyan("/diff")}             Show last diff\n`);
	stdout.write(`  ${cyan("/history")}          Show task history\n`);
	stdout.write(`  ${cyan("/undo")}             Undo last commit (git reset --soft)\n`);
	stdout.write(`  ${cyan("/status")}           Show git status\n`);
	stdout.write(`  ${cyan("/git")} ${dim("<cmd>")}       Run a git command (e.g. /git log --oneline -5)\n`);
	stdout.write(`  ${cyan("/branch")}           Show/switch branches\n`);
	stdout.write(`  ${cyan("/config")}           Show current coding configuration\n`);
	stdout.write(`  ${cyan("/clear")}            Clear screen\n`);
	stdout.write(`  ${cyan("/quit")}             Exit\n`);
	stdout.write("\n");
}

// ─── Phase Streaming ────────────────────────────────────────────────────────

function createProgressRenderer(): (progress: { phase: string; message: string; elapsedMs: number }) => void {
	const { stdout } = process;
	const phases = new Map<string, boolean>();

	return (progress) => {
		const isNew = !phases.has(progress.phase);
		phases.set(progress.phase, true);

		if (!isNew) return;

		const icons: Record<string, string> = {
			planning: "📋",
			branching: "🌿",
			executing: "⚡",
			validating: "🧪",
			reviewing: "🔍",
			committing: "💾",
			done: "✅",
			error: "❌",
		};

		const icon = icons[progress.phase] ?? "⧖";
		const phase = progress.phase.padEnd(12);
		const time = formatMs(progress.elapsedMs).padStart(8);

		stdout.write(`  ${icon} ${bold(phase)} ${dim(time)}\n`);
	};
}

/** Stream coding agent events to terminal — tool calls, validation, retries. */
function createCodingEventRenderer(): (event: { type: string; name?: string; args?: Record<string, unknown>; text?: string; passed?: boolean; output?: string; attempt?: number; maxRetries?: number; durationMs?: number; path?: string }) => void {
	const { stdout } = process;
	const toolIcons: Record<string, string> = {
		read: "📖", write: "📝", edit: "✏️", bash: "🔧",
		grep: "🔎", find: "📂", ls: "📁", diff: "📊",
	};

	return (event) => {
		switch (event.type) {
			case "tool_call": {
				const icon = toolIcons[event.name ?? ""] ?? "🔨";
				const name = (event.name ?? "?").padEnd(6);
				const args = event.args ?? {};
				let detail = "";
				if (args.path || args.file_path) {
					const p = (args.path ?? args.file_path) as string;
					detail = dim(` ${p.split("/").pop()}`);
				} else if (args.command) {
					detail = dim(` ${(args.command as string).slice(0, 50)}`);
				} else if (args.pattern) {
					detail = dim(` /${args.pattern as string}/`);
				}
				stdout.write(`    ${icon} ${gray(name)}${detail}\n`);
				break;
			}
			case "validation_start":
				stdout.write(`    🧪 ${dim("running validation...")}\n`);
				break;
			case "validation_result":
				stdout.write(`    🧪 ${event.passed ? green("✓ pass") : red("✗ fail")}\n`);
				break;
			case "retry":
				stdout.write(`    🔄 ${yellow(`retry ${event.attempt}/${event.maxRetries}`)}\n`);
				break;
		}
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

	// Plan steps (important for /plan command and full mode)
	if (result.plan && result.plan.steps.length > 0) {
		stdout.write("\n");
		stdout.write(`  ${bold("Plan")} ${dim(`(${result.plan.steps.length} step${result.plan.steps.length > 1 ? "s" : ""})`)}\n`);
		for (const step of result.plan.steps) {
			const mark = step.completed ? green("✓") : dim("○");
			stdout.write(`  ${mark} ${dim(`${step.index}.`)} ${step.description}\n`);
		}
	}

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

