#!/usr/bin/env node

/**
 * @chitragupta/cli — Coding Agent Entry Point.
 *
 * Standalone binary for running Chitragupta's coding agent (Kartru)
 * directly from the terminal. Delegates to the CodingOrchestrator
 * for a full Plan → Branch → Execute → Validate → Review → Commit pipeline.
 *
 * Usage:
 *   chitragupta-code "fix the bug in login.ts"
 *   chitragupta-code "add input validation" --mode plan-only
 *   chitragupta-code "refactor auth" --provider anthropic --model claude-sonnet-4-5
 *   chitragupta-code "implement caching" --no-branch --no-commit
 *   chitragupta-code --help
 */

import { runCodeMode } from "./modes/code.js";
import { loadCredentials } from "./bootstrap.js";

// ─── Parse CLI Arguments ────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
	task: string;
	mode?: "full" | "execute" | "plan-only";
	provider?: string;
	model?: string;
	createBranch?: boolean;
	autoCommit?: boolean;
	selfReview?: boolean;
	project: string;
	timeout?: number;
	help: boolean;
	version: boolean;
} {
	let task = "";
	let mode: "full" | "execute" | "plan-only" | undefined;
	let provider: string | undefined;
	let model: string | undefined;
	let createBranch: boolean | undefined;
	let autoCommit: boolean | undefined;
	let selfReview: boolean | undefined;
	let project = process.env.CHITRAGUPTA_PROJECT ?? process.cwd();
	let timeout: number | undefined;
	let help = false;
	let version = false;

	const taskParts: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg === "-h" || arg === "--help") {
			help = true;
		} else if (arg === "-v" || arg === "--version") {
			version = true;
		} else if (arg === "--mode" && i + 1 < argv.length) {
			const m = argv[++i];
			if (m === "full" || m === "execute" || m === "plan-only") mode = m;
		} else if (arg === "--plan") {
			mode = "plan-only";
		} else if (arg === "--provider" && i + 1 < argv.length) {
			provider = argv[++i];
		} else if ((arg === "-m" || arg === "--model") && i + 1 < argv.length) {
			model = argv[++i];
		} else if (arg === "--project" && i + 1 < argv.length) {
			project = argv[++i];
		} else if (arg === "--timeout" && i + 1 < argv.length) {
			timeout = parseInt(argv[++i], 10) || undefined;
		} else if (arg === "--no-branch") {
			createBranch = false;
		} else if (arg === "--branch") {
			createBranch = true;
		} else if (arg === "--no-commit") {
			autoCommit = false;
		} else if (arg === "--commit") {
			autoCommit = true;
		} else if (arg === "--no-review") {
			selfReview = false;
		} else if (arg === "--review") {
			selfReview = true;
		} else if (!arg.startsWith("-")) {
			taskParts.push(arg);
		}
	}

	task = taskParts.join(" ");

	return {
		task, mode, provider, model, createBranch, autoCommit,
		selfReview, project, timeout, help, version,
	};
}

// ─── Help Text ──────────────────────────────────────────────────────────────

function printHelp(): void {
	process.stderr.write(`
Chitragupta Coding Agent (Kartru) — autonomous coding from the terminal

Usage:
  chitragupta-code                                 Open interactive coding REPL
  chitragupta-code "task description"              Run a single coding task
  chitragupta-code "task" --mode plan-only         Plan only, don't execute
  chitragupta-code "task" --plan                   Shorthand for --mode plan-only

Options:
  --mode <full|execute|plan-only>    Execution mode (default: full)
  --plan                             Shorthand for --mode plan-only
  --provider <id>                    AI provider (anthropic, openai, etc.)
  -m, --model <id>                   Model ID
  --project <path>                   Project directory (default: cwd)
  --timeout <seconds>                Timeout in seconds (default: 300)
  --no-branch                        Skip git branch creation
  --no-commit                        Skip auto-commit
  --no-review                        Skip self-review
  -h, --help                         Show this help
  -v, --version                      Show version

Modes:
  full        Plan → Branch → Execute → Validate → Review → Commit (default)
  execute     Execute → Validate (no git, no review)
  plan-only   Analyze and plan only, no execution

Output:
  Progress is streamed to stderr.
  Results and usage stats are printed to stdout:
    - Task result and plan steps
    - Token usage breakdown (input, output, cache) with cost
    - Tool usage breakdown (per-tool call counts with percentages)
    - Timing per phase

Configuration:
  Settings are read from ~/.chitragupta/config/settings.json (coding section).
  CLI flags override settings. Set defaults with:
    chitragupta config set coding.mode plan-only
    chitragupta config set coding.createBranch false
    chitragupta config set coding.autoCommit false
    chitragupta config set coding.timeout 600
    chitragupta config set coding.branchPrefix fix/

Getting Started:
  1. chitragupta provider add anthropic    # Configure an AI provider
  2. chitragupta init                      # Set up MCP + instructions
  3. chitragupta-code "your task here"     # Run the coding agent

Examples:
  chitragupta-code "fix the failing test in auth.test.ts"
  chitragupta-code "add rate limiting to the API endpoints" --no-branch
  chitragupta-code "refactor the database layer" --plan
  chitragupta-code "implement user search" --provider openai --model gpt-4o
`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	loadCredentials();

	// Load coding defaults from settings — CLI flags override these
	const { loadGlobalSettings } = await import("@chitragupta/core");
	const settings = loadGlobalSettings();
	const codingDefaults = settings.coding ?? {};

	const args = parseArgs(process.argv.slice(2));

	if (args.version) {
		process.stderr.write("chitragupta-code v0.1.0\n");
		process.exit(0);
	}

	if (args.help) {
		printHelp();
		process.exit(0);
	}

	// No task → open interactive coding REPL
	const exitCode = await runCodeMode({
		task: args.task,
		mode: args.mode ?? codingDefaults.mode,
		provider: args.provider ?? codingDefaults.provider,
		model: args.model ?? codingDefaults.model,
		createBranch: args.createBranch ?? codingDefaults.createBranch,
		autoCommit: args.autoCommit ?? codingDefaults.autoCommit,
		selfReview: args.selfReview ?? codingDefaults.selfReview,
		project: args.project,
		timeout: args.timeout ?? codingDefaults.timeout,
	});

	process.exit(exitCode);
}

main().catch((err) => {
	process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
