/**
 * @chitragupta/cli — Code mode.
 *
 * Non-interactive coding agent mode: takes a task, runs the CodingOrchestrator
 * (Sanyojaka), streams progress to stderr, and prints a rich result summary
 * with token usage, tool usage, cost breakdown, and timing to stdout.
 *
 * Usage:
 *   chitragupta code "fix the bug in login.ts"
 *   chitragupta code "add input validation" --mode plan-only
 *   chitragupta-code "refactor auth module" --provider anthropic --model claude-sonnet-4-5
 */

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
} from "@chitragupta/ui/ansi";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CodeModeOptions {
	/** The coding task to accomplish. */
	task: string;
	/** Execution mode. Default: "full". */
	mode?: "full" | "execute" | "plan-only";
	/** AI provider ID override. */
	provider?: string;
	/** Model ID override. */
	model?: string;
	/** Whether to create a git branch. Default: true. */
	createBranch?: boolean;
	/** Whether to auto-commit. Default: true. */
	autoCommit?: boolean;
	/** Whether to self-review. Default: true. */
	selfReview?: boolean;
	/** Project directory. Default: cwd. */
	project?: string;
	/** Timeout in seconds. Default: 300 (5 min). */
	timeout?: number;
	/** Whether to use ANSI colors. Default: auto-detect TTY. */
	color?: boolean;
}

/** Aggregated stats from the agent run. */
interface UsageStats {
	// Tokens
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;

	// Cost
	inputCost: number;
	outputCost: number;
	cacheReadCost: number;
	cacheWriteCost: number;
	totalCost: number;
	currency: string;

	// Tool usage: name → { count, errors }
	toolCalls: Map<string, { count: number; errors: number }>;
	totalToolCalls: number;
	totalToolErrors: number;

	// Agent turns
	turns: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function formatCost(n: number): string {
	if (n < 0.001) return `$${n.toFixed(6)}`;
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(4)}`;
}

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60_000);
	const secs = ((ms % 60_000) / 1000).toFixed(0);
	return `${mins}m ${secs}s`;
}

function padRight(s: string, len: number): string {
	return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
	return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

/**
 * Extract usage stats from the agent's message history.
 * Sums CostBreakdown from assistant messages, counts tool calls from content parts.
 */
function computeStats(messages: readonly {
	role: string;
	content: readonly { type: string; name?: string; isError?: boolean }[];
	cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; total: number; currency: string };
}[]): UsageStats {
	const stats: UsageStats = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		inputCost: 0,
		outputCost: 0,
		cacheReadCost: 0,
		cacheWriteCost: 0,
		totalCost: 0,
		currency: "USD",
		toolCalls: new Map(),
		totalToolCalls: 0,
		totalToolErrors: 0,
		turns: 0,
	};

	for (const msg of messages) {
		// Count assistant turns
		if (msg.role === "assistant") {
			stats.turns++;

			// Sum costs
			if (msg.cost) {
				stats.inputCost += msg.cost.input;
				stats.outputCost += msg.cost.output;
				stats.cacheReadCost += msg.cost.cacheRead ?? 0;
				stats.cacheWriteCost += msg.cost.cacheWrite ?? 0;
				stats.totalCost += msg.cost.total;
				stats.currency = msg.cost.currency;
			}
		}

		// Count tool calls
		for (const part of msg.content) {
			if (part.type === "tool_call" && "name" in part) {
				const name = part.name as string;
				const entry = stats.toolCalls.get(name) ?? { count: 0, errors: 0 };
				entry.count++;
				stats.toolCalls.set(name, entry);
				stats.totalToolCalls++;
			}
			if (part.type === "tool_result" && part.isError) {
				stats.totalToolErrors++;
			}
		}
	}

	return stats;
}

// ─── Render ─────────────────────────────────────────────────────────────────

function renderHeader(
	task: string,
	mode: string,
	providerId: string,
	modelId: string | undefined,
	useColor: boolean,
): string {
	const lines: string[] = [];
	const header = "═══ Chitragupta Coding Agent ═════════════════";
	lines.push(useColor ? bold(cyan(header)) : header);
	lines.push("");
	lines.push(`  Task:     ${task}`);
	lines.push(`  Mode:     ${mode}${providerId ? ` | Provider: ${providerId}` : ""}${modelId ? ` | Model: ${modelId}` : ""}`);
	lines.push("");
	return lines.join("\n");
}

function renderProgress(
	phases: { phase: string; message: string; elapsedMs: number }[],
	useColor: boolean,
): string {
	const lines: string[] = [];
	const sectionHeader = "── Progress ──";
	lines.push(useColor ? dim(sectionHeader) : sectionHeader);

	for (const p of phases) {
		const mark = p.phase === "error" ? (useColor ? red("✗") : "✗") : (useColor ? green("✓") : "✓");
		const phase = padRight(p.phase, 12);
		const time = padLeft(formatMs(p.elapsedMs), 8);
		const msg = p.message.length > 60 ? p.message.slice(0, 57) + "..." : p.message;
		lines.push(`  ${mark} ${useColor ? bold(phase) : phase} ${useColor ? dim(time) : time}  ${useColor ? gray(msg) : msg}`);
	}

	lines.push("");
	return lines.join("\n");
}

function renderFiles(
	filesModified: string[],
	filesCreated: string[],
	useColor: boolean,
): string {
	if (filesModified.length === 0 && filesCreated.length === 0) return "";

	const lines: string[] = [];
	const sectionHeader = "── Files ──";
	lines.push(useColor ? dim(sectionHeader) : sectionHeader);

	if (filesModified.length > 0) {
		const label = useColor ? yellow("Modified:") : "Modified:";
		lines.push(`  ${label} ${filesModified.join(", ")}`);
	}
	if (filesCreated.length > 0) {
		const label = useColor ? green("Created:") : "Created:";
		lines.push(`  ${label}  ${filesCreated.join(", ")}`);
	}
	lines.push("");
	return lines.join("\n");
}

function renderGit(
	git: { featureBranch: string | null; commits: string[] },
	useColor: boolean,
): string {
	if (!git.featureBranch && git.commits.length === 0) return "";

	const lines: string[] = [];
	const sectionHeader = "── Git ──";
	lines.push(useColor ? dim(sectionHeader) : sectionHeader);
	if (git.featureBranch) lines.push(`  Branch:  ${useColor ? cyan(git.featureBranch) : git.featureBranch}`);
	if (git.commits.length > 0) lines.push(`  Commits: ${useColor ? dim(git.commits.join(", ")) : git.commits.join(", ")}`);
	lines.push("");
	return lines.join("\n");
}

function renderTokenUsage(stats: UsageStats, useColor: boolean): string {
	const lines: string[] = [];
	const header = "══ Token Usage ═════════════════════════════════";
	lines.push(useColor ? bold(header) : header);

	const rows: [string, number, number][] = [
		["Input", stats.inputTokens, stats.inputCost],
		["Output", stats.outputTokens, stats.outputCost],
	];
	if (stats.cacheReadCost > 0) rows.push(["Cache Read", stats.cacheReadTokens, stats.cacheReadCost]);
	if (stats.cacheWriteCost > 0) rows.push(["Cache Write", stats.cacheWriteTokens, stats.cacheWriteCost]);

	for (const [label, tokens, cost] of rows) {
		const tokenStr = padLeft(formatTokens(tokens), 8);
		const costStr = padLeft(formatCost(cost), 10);
		const bullet = useColor ? cyan("▸") : "▸";
		const labelStr = padRight(`${label}:`, 14);
		lines.push(`  ${bullet} ${useColor ? dim(labelStr) : labelStr}${useColor ? white(tokenStr) : tokenStr} tokens  ${useColor ? yellow(costStr) : costStr}`);
	}

	// Total line
	lines.push(useColor ? dim("  ─────────────────────────────────") : "  ─────────────────────────────────");
	const totalTokenStr = padLeft(formatTokens(stats.totalTokens), 8);
	const totalCostStr = padLeft(formatCost(stats.totalCost), 10);
	lines.push(`  ${useColor ? bold("Total:") : "Total:"}        ${useColor ? bold(white(totalTokenStr)) : totalTokenStr} tokens  ${useColor ? bold(yellow(totalCostStr)) : totalCostStr}`);

	lines.push("");
	return lines.join("\n");
}

function renderToolUsage(stats: UsageStats, useColor: boolean): string {
	const lines: string[] = [];
	const header = "══ Tool Usage ══════════════════════════════════";
	lines.push(useColor ? bold(header) : header);

	if (stats.toolCalls.size === 0) {
		lines.push("  (no tool calls)");
		lines.push("");
		return lines.join("\n");
	}

	// Sort by count descending
	const sorted = [...stats.toolCalls.entries()].sort((a, b) => b[1].count - a[1].count);

	for (const [name, { count, errors }] of sorted) {
		const pct = stats.totalToolCalls > 0 ? ((count / stats.totalToolCalls) * 100).toFixed(1) : "0.0";
		const bullet = useColor ? magenta("▸") : "▸";
		const nameStr = padRight(`${name}:`, 10);
		const countStr = padLeft(String(count), 4);
		const pctStr = padLeft(`(${pct}%)`, 8);
		const errStr = errors > 0 ? (useColor ? red(` ${errors} err`) : ` ${errors} err`) : "";
		lines.push(`  ${bullet} ${useColor ? dim(nameStr) : nameStr}${useColor ? white(countStr) : countStr} calls  ${useColor ? gray(pctStr) : pctStr}${errStr}`);
	}

	// Total
	lines.push(useColor ? dim("  ─────────────────────────────────") : "  ─────────────────────────────────");
	lines.push(`  ${useColor ? bold("Total:") : "Total:"}  ${stats.totalToolCalls} calls | ${stats.turns} turns${stats.totalToolErrors > 0 ? (useColor ? red(` | ${stats.totalToolErrors} errors`) : ` | ${stats.totalToolErrors} errors`) : ""}`);

	lines.push("");
	return lines.join("\n");
}

function renderResult(
	result: {
		success: boolean;
		plan: { task: string; steps: { index: number; description: string; completed: boolean }[]; complexity: string } | null;
		git: { featureBranch: string | null; commits: string[] };
		reviewIssues: { severity: string; file: string; line?: number; message: string }[];
		validationPassed: boolean;
		filesModified: string[];
		filesCreated: string[];
		elapsedMs: number;
		progressLog: { phase: string; message: string; elapsedMs: number }[];
	},
	stats: UsageStats,
	providerId: string,
	modelId: string | undefined,
	useColor: boolean,
): string {
	const parts: string[] = [];

	// Header
	const task = result.plan?.task ?? "(unknown)";
	const mode = result.plan ? "planned" : "direct";
	parts.push(renderHeader(task, mode, providerId, modelId, useColor));

	// Status
	const status = result.success
		? (useColor ? bold(green("✓ Success")) : "✓ Success")
		: (useColor ? bold(red("✗ Failed")) : "✗ Failed");
	const complexity = result.plan?.complexity ?? "unknown";
	parts.push(`  Status: ${status} | Complexity: ${complexity}`);
	parts.push("");

	// Progress phases
	if (result.progressLog.length > 0) {
		// Deduplicate: take the last event per phase
		const phaseMap = new Map<string, { phase: string; message: string; elapsedMs: number }>();
		for (const p of result.progressLog) {
			phaseMap.set(p.phase, p);
		}
		parts.push(renderProgress([...phaseMap.values()], useColor));
	}

	// Plan
	if (result.plan && result.plan.steps.length > 0) {
		const sectionHeader = "── Plan ──";
		parts.push(useColor ? dim(sectionHeader) : sectionHeader);
		for (const step of result.plan.steps) {
			const mark = step.completed
				? (useColor ? green("✓") : "✓")
				: (useColor ? gray("○") : "○");
			parts.push(`  ${step.index}. [${mark}] ${step.description}`);
		}
		parts.push("");
	}

	// Files
	parts.push(renderFiles(result.filesModified, result.filesCreated, useColor));

	// Git
	parts.push(renderGit(result.git, useColor));

	// Validation
	if (result.validationPassed !== undefined) {
		const valHeader = "── Validation ──";
		parts.push(useColor ? dim(valHeader) : valHeader);
		parts.push(`  Result: ${result.validationPassed ? (useColor ? green("✓ passed") : "✓ passed") : (useColor ? red("✗ failed") : "✗ failed")}`);
		parts.push("");
	}

	// Review
	if (result.reviewIssues.length > 0) {
		const revHeader = "── Review ──";
		parts.push(useColor ? dim(revHeader) : revHeader);
		parts.push(`  ${result.reviewIssues.length} issue(s) found`);
		for (const issue of result.reviewIssues.slice(0, 10)) {
			const sev = issue.severity === "error" ? (useColor ? red(issue.severity) : issue.severity) : (useColor ? yellow(issue.severity) : issue.severity);
			parts.push(`    ${sev} ${issue.file}${issue.line ? `:${issue.line}` : ""} — ${issue.message}`);
		}
		parts.push("");
	}

	// Token usage
	if (stats.totalCost > 0 || stats.totalToolCalls > 0) {
		parts.push(renderTokenUsage(stats, useColor));
	}

	// Tool usage
	if (stats.totalToolCalls > 0) {
		parts.push(renderToolUsage(stats, useColor));
	}

	// Timing
	const timeStr = formatMs(result.elapsedMs);
	parts.push(useColor ? bold(dim(`⏱ ${timeStr}`)) : `⏱ ${timeStr}`);

	return parts.filter(Boolean).join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Run code mode: set up provider, run the CodingOrchestrator, stream progress
 * to stderr, print rich result with usage stats to stdout, and exit.
 *
 * @returns Process exit code (0 for success, 1 for error).
 */
export async function runCodeMode(options: CodeModeOptions): Promise<number> {
	const {
		task,
		mode = "full",
		project = process.cwd(),
		timeout = 300,
	} = options;
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
				? (useColor ? red("✗") : "✗")
				: progress.phase === "done"
					? (useColor ? green("✓") : "✓")
					: (useColor ? yellow("⧖") : "⧖");
			const phaseStr = padRight(progress.phase, 12);
			const timeStr = padLeft(formatMs(progress.elapsedMs), 8);
			process.stderr.write(`  ${mark} ${useColor ? bold(phaseStr) : phaseStr} ${useColor ? dim(timeStr) : timeStr}\n`);
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
			currency: "USD",
			toolCalls: new Map(), totalToolCalls: 0, totalToolErrors: 0, turns: 0,
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
