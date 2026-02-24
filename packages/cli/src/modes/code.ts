/**
 * @chitragupta/cli — Code mode.
 *
 * Non-interactive coding agent mode: takes a task, runs the CodingOrchestrator
 * (Sanyojaka), streams progress to stderr, and prints a rich result summary
 * with token usage, tool usage, cost breakdown, and timing to stdout.
 *
 * Types, formatting helpers, and render functions are in `code-helpers.ts`.
 *
 * Usage:
 *   chitragupta code "fix the bug in login.ts"
 *   chitragupta code "add input validation" --mode plan-only
 *   chitragupta-code "refactor auth module" --provider anthropic --model claude-sonnet-4-5
 */

import {
	bold,
	cyan,
	red,
} from "@chitragupta/ui/ansi";

import {
	computeStats,
	formatMs,
	padLeft,
	padRight,
	renderResult,
} from "./code-helpers.js";
import type { UsageStats } from "./code-helpers.js";

// Re-export for backward compatibility
export type { CodeModeOptions, UsageStats } from "./code-helpers.js";
export { formatTokens, formatCost, formatMs, padRight, padLeft } from "./code-helpers.js";
import type { CodeModeOptions } from "./code-helpers.js";

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Run code mode: set up provider, run the CodingOrchestrator, stream progress
 * to stderr, print rich result with usage stats to stdout, and exit.
 *
 * @returns Process exit code (0 for success, 1 for error).
 */
export async function runCodeMode(options: CodeModeOptions): Promise<number> {
	// Load coding defaults from settings — CLI flags take priority
	const { loadGlobalSettings } = await import("@chitragupta/core");
	const settings = loadGlobalSettings();
	const cd = settings.coding ?? {};

	const {
		task,
		mode = cd.mode ?? "full",
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
		? bold(cyan("═══ Chitragupta Coding Agent ═════════════════"))
		: "═══ Chitragupta Coding Agent ═════════════════";
	process.stderr.write(`\n${headerLine}\n`);
	process.stderr.write(`  Task: ${task}\n`);
	process.stderr.write(`  Mode: ${mode}\n\n`);

	try {
		// ── Shared setup ────────────────────────────────────────────
		const { setupCodingEnvironment, createCodingOrchestrator } = await import("../coding-setup.js");

		const setup = await setupCodingEnvironment({
			projectPath: project,
			explicitProvider: options.provider,
			sessionId: "coding-cli",
		});
		if (!setup) {
			const msg = "No AI provider available. Set an API key or install a CLI provider.";
			process.stderr.write(useColor ? red(`\n  Error: ${msg}\n\n`) : `\n  Error: ${msg}\n\n`);
			process.stderr.write("  Run `chitragupta provider list` to see available providers.\n");
			process.stderr.write("  Run `chitragupta provider add <id>` to configure one.\n\n");
			return 1;
		}

		const providerId = setup.providerId;
		const modelId = options.model;

		process.stderr.write(`  Provider: ${useColor ? cyan(providerId) : providerId}`);
		if (modelId) process.stderr.write(` | Model: ${useColor ? cyan(modelId) : modelId}`);
		process.stderr.write("\n\n");

		// ── Progress streaming to stderr ────────────────────────────
		const onProgress = (progress: { phase: string; message: string; elapsedMs: number }) => {
			const mark = progress.phase === "error"
				? (useColor ? red("X") : "X")
				: progress.phase === "done"
					? (useColor ? "\x1b[32mV\x1b[0m" : "V")
					: (useColor ? "\x1b[33m*\x1b[0m" : "*");
			const phaseStr = padRight(progress.phase, 12);
			const timeStr = padLeft(formatMs(progress.elapsedMs), 8);
			process.stderr.write(`  ${mark} ${useColor ? bold(phaseStr) : phaseStr} ${timeStr}\n`);
		};

		// ── Create orchestrator ─────────────────────────────────────
		const orchestrator = await createCodingOrchestrator({
			setup,
			projectPath: project,
			mode,
			modelId,
			createBranch: options.createBranch,
			autoCommit: options.autoCommit,
			selfReview: options.selfReview,
			timeoutMs: timeout * 1000,
			onProgress,
		});

		// ── Run ─────────────────────────────────────────────────────
		const result = await orchestrator.run(task);

		// ── Compute usage stats from agent messages ─────────────────
		let stats: UsageStats = {
			inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
			inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0,
			currency: "USD", toolCalls: new Map(), totalToolCalls: 0, totalToolErrors: 0, turns: 0,
		};

		const agent = orchestrator.getCodingAgent();
		if (agent) {
			const messages = agent.getAgent().getMessages();
			stats = computeStats(messages as readonly {
				role: string;
				content: readonly { type: string; name?: string; isError?: boolean }[];
				cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; total: number; currency: string };
			}[]);
		}

		// ── Render rich output to stdout ────────────────────────────
		process.stderr.write("\n");
		const output = renderResult(result, stats, providerId, modelId, useColor);
		process.stdout.write(output + "\n");

		return result.success ? 0 : 1;

	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(useColor ? red(`\n  Error: ${message}\n\n`) : `\n  Error: ${message}\n\n`);
		return 1;
	}
}
