/**
 * @chitragupta/cli — Code mode.
 *
 * Non-interactive coding mode: takes a task, routes it to the best
 * available coding CLI on PATH, streams progress to stderr, and prints
 * the result summary to stdout.
 *
 * Types and formatting helpers are in `code-helpers.ts`.
 *
 * Usage:
 *   chitragupta code "fix the bug in login.ts"
 *   chitragupta code "add input validation" --mode plan-only
 *   chitragupta-code "refactor auth module" --provider anthropic --model claude-sonnet-4-5
 */

import {
	bold,
	cyan,
	dim,
	green,
	red,
} from "@chitragupta/ui/ansi";

// Re-export for backward compatibility
export type { CodeModeOptions, UsageStats } from "./code-helpers.js";
export { formatTokens, formatCost, formatMs, padRight, padLeft } from "./code-helpers.js";
import type { CodeModeOptions } from "./code-helpers.js";

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Run code mode: detect available CLIs, route the coding task to the best
 * available CLI, stream output to stderr, and exit.
 *
 * When no task is provided, falls through to the interactive REPL.
 *
 * @returns Process exit code (0 for success, 1 for error).
 */
export async function runCodeMode(options: CodeModeOptions): Promise<number> {
	const { loadGlobalSettings } = await import("@chitragupta/core");
	const settings = loadGlobalSettings();
	const cd = settings.coding ?? {};

	const {
		task,
		project = process.cwd(),
		timeout = cd.timeout ?? 300,
	} = options;

	// ── No task --> open interactive coding REPL ─────────────────
	if (!task) {
		const { runCodeInteractive } = await import("./code-interactive.js");
		return runCodeInteractive({
			project,
			provider: options.provider,
			model: options.model,
			mode: options.mode ?? cd.mode,
			createBranch: options.createBranch,
			autoCommit: options.autoCommit,
			selfReview: options.selfReview,
			timeout,
		});
	}

	const useColor = options.color ?? process.stdout.isTTY ?? false;

	// ── Print initial header to stderr ──────────────────────────────
	const headerLine = useColor
		? bold(cyan("═══ Chitragupta Code Router ══════════════════"))
		: "═══ Chitragupta Code Router ══════════════════";
	process.stderr.write(`\n${headerLine}\n`);
	process.stderr.write(`  Task: ${task}\n\n`);

	try {
		const { routeCodingTask, detectCodingClis } = await import("./coding-router.js");

		// Show detected CLIs
		const clis = await detectCodingClis();
		const cliNames = clis.map((c) => c.name).join(", ") || "none";
		process.stderr.write(`  Available CLIs: ${useColor ? cyan(cliNames) : cliNames}\n`);

		if (clis.length === 0) {
			const msg = "No coding CLI available on PATH. Install takumi, claude, codex, or aider.";
			process.stderr.write(useColor ? red(`\n  Error: ${msg}\n\n`) : `\n  Error: ${msg}\n\n`);
			return 1;
		}

		process.stderr.write(`  Routing to: ${useColor ? bold(green(clis[0].name)) : clis[0].name}\n\n`);

		// ── Create abort controller for timeout ────────────────────
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout * 1000);

		// ── Run ─────────────────────────────────────────────────────
		const result = await routeCodingTask({
			task,
			cwd: project,
			signal: controller.signal,
			onOutput: (chunk) => {
				process.stderr.write(chunk);
			},
		});

		clearTimeout(timer);

		// ── Summary ─────────────────────────────────────────────────
		process.stderr.write("\n");
		const status = result.exitCode === 0
			? (useColor ? green("Success") : "Success")
			: (useColor ? red(`Failed (exit ${result.exitCode})`) : `Failed (exit ${result.exitCode})`);
		process.stderr.write(`  CLI: ${result.cli} | Status: ${status}\n\n`);

		// Print output to stdout for piping
		if (result.output) {
			process.stdout.write(result.output);
			if (!result.output.endsWith("\n")) process.stdout.write("\n");
		}

		return result.exitCode === 0 ? 0 : 1;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("abort") || message.includes("ABORT")) {
			process.stderr.write(useColor ? red(`\n  Task timed out after ${timeout}s.\n\n`) : `\n  Task timed out after ${timeout}s.\n\n`);
		} else {
			process.stderr.write(useColor ? red(`\n  Error: ${message}\n\n`) : `\n  Error: ${message}\n\n`);
		}
		return 1;
	}
}
