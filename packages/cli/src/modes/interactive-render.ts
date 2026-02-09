/**
 * @chitragupta/cli — Interactive mode rendering utilities.
 *
 * Premium rendering with the Nakshatram theme: themed status bar,
 * styled message labels, animated spinner, and git branch detection.
 *
 * Uses the @chitragupta/ui StatusBar component for the rich bottom bar
 * with provider health, context pressure, token counts, and cost.
 */

import { execSync } from "child_process";
import type { Agent, AgentEventType } from "@chitragupta/anina";
import type { AgentProfile, BudgetStatus, InputRequest, ThinkingLevel } from "@chitragupta/core";
import {
	bold,
	dim,
	gray,
	green,
	cyan,
	yellow,
	red,
	reset,
	clearLine,
	cursorTo,
	rgb,
	visibleLength,
} from "@chitragupta/ui/ansi";
import { StatusBar, type ProviderHealth } from "@chitragupta/ui/components/status-bar";
import { DEFAULT_THEME, hexToAnsi, hexToBgAnsi } from "@chitragupta/ui/theme";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionStats {
	totalCost: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	contextPercent: number;
	turnCount: number;
}

// ─── Theme Colors (Nakshatram) ──────────────────────────────────────────────

/** Precomputed ANSI escape sequences for the Nakshatram palette. */
export const THEME = {
	primary: hexToAnsi(DEFAULT_THEME.colors.primary),
	secondary: hexToAnsi(DEFAULT_THEME.colors.secondary),
	success: hexToAnsi(DEFAULT_THEME.colors.success),
	warning: hexToAnsi(DEFAULT_THEME.colors.warning),
	error: hexToAnsi(DEFAULT_THEME.colors.error),
	muted: hexToAnsi(DEFAULT_THEME.colors.muted),
	thinking: hexToAnsi(DEFAULT_THEME.colors.thinking),
	tool: hexToAnsi(DEFAULT_THEME.colors.tool),
	agent: hexToAnsi(DEFAULT_THEME.colors.agent),
	cost: hexToAnsi(DEFAULT_THEME.colors.cost),
	tokens: hexToAnsi(DEFAULT_THEME.colors.tokens),
	git: hexToAnsi(DEFAULT_THEME.colors.git),
	fg: hexToAnsi(DEFAULT_THEME.colors.foreground),
	border: hexToAnsi(DEFAULT_THEME.colors.border),
	bgSurface: hexToBgAnsi(DEFAULT_THEME.colors.bgSurface),
	bgOverlay: hexToBgAnsi(DEFAULT_THEME.colors.bgOverlay),
} as const;

// ─── Git Branch Detection ───────────────────────────────────────────────────

/** Cached git branch to avoid shelling out every render cycle. */
let _cachedGitBranch: string | null = null;
let _gitBranchTimestamp = 0;
const GIT_BRANCH_CACHE_MS = 10_000; // Refresh every 10s

/**
 * Detect the current git branch. Cached for 10s to avoid excessive spawns.
 * Returns empty string if not in a git repo.
 */
export function detectGitBranch(): string {
	const now = Date.now();
	if (_cachedGitBranch !== null && now - _gitBranchTimestamp < GIT_BRANCH_CACHE_MS) {
		return _cachedGitBranch;
	}

	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
			encoding: "utf-8",
			timeout: 2000,
		}).trim();
		_cachedGitBranch = branch;
		_gitBranchTimestamp = now;
		return branch;
	} catch {
		_cachedGitBranch = "";
		_gitBranchTimestamp = now;
		return "";
	}
}

/**
 * Check if git working tree has uncommitted changes.
 * Cached alongside branch detection.
 */
let _cachedGitDirty: boolean | null = null;

export function isGitDirty(): boolean {
	const now = Date.now();
	if (_cachedGitDirty !== null && now - _gitBranchTimestamp < GIT_BRANCH_CACHE_MS) {
		return _cachedGitDirty;
	}

	try {
		const status = execSync("git status --porcelain 2>/dev/null", {
			encoding: "utf-8",
			timeout: 2000,
		}).trim();
		_cachedGitDirty = status.length > 0;
		return _cachedGitDirty;
	} catch {
		_cachedGitDirty = false;
		return false;
	}
}

// ─── Singleton StatusBar ────────────────────────────────────────────────────

let _statusBar: StatusBar | null = null;

function getStatusBar(): StatusBar {
	if (!_statusBar) {
		_statusBar = new StatusBar({ theme: DEFAULT_THEME });
	}
	return _statusBar;
}

// ─── Display Helpers ────────────────────────────────────────────────────────

export function renderPrompt(
	stdout: NodeJS.WriteStream,
	inputBuffer: string,
): void {
	stdout.write(clearLine() + cursorTo(1));
	const chi = `${THEME.primary}${DEFAULT_THEME.symbols.prompt}${reset}`;
	stdout.write(`${chi} ${inputBuffer}`);
}

export function renderStatusBar(
	stdout: NodeJS.WriteStream,
	currentModel: string,
	currentThinking: ThinkingLevel,
	stats: SessionStats,
	providerHealth?: ProviderHealth,
): void {
	const cols = stdout.columns || 80;
	const bar = getStatusBar();

	// Update data
	bar.update({
		model: currentModel,
		cost: stats.totalCost,
		inputTokens: stats.totalInputTokens,
		outputTokens: stats.totalOutputTokens,
		contextPercent: stats.contextPercent > 0 ? Math.round(stats.contextPercent) : undefined,
		thinkingLevel: currentThinking,
	});

	// Provider health
	if (providerHealth) {
		bar.setProviderHealth(providerHealth);
	}

	// Git branch
	const branch = detectGitBranch();
	if (branch) {
		const dirty = isGitDirty();
		bar.setGitBranch(dirty ? `${branch} \u2022` : branch);
	}

	stdout.write("\n" + bar.render(cols) + "\n");
}

export function printAssistantLabel(
	stdout: NodeJS.WriteStream,
	profileName: string,
): void {
	// Themed: agent color for the name, with a left border accent
	stdout.write(
		`\n${THEME.primary}\u2502${reset} ${THEME.agent}${bold(profileName)}${reset}\n\n`,
	);
}

export function printUserLabel(stdout: NodeJS.WriteStream): void {
	// Themed: secondary color for user, with a left border accent
	stdout.write(
		`\n${THEME.secondary}\u2502${reset} ${THEME.secondary}${bold("You")}${reset}\n\n`,
	);
}

/**
 * Render a thinking block header.
 */
export function printThinkingStart(stdout: NodeJS.WriteStream): void {
	stdout.write(
		`${THEME.thinking}\u250C\u2500 \u25C6 thinking ${THEME.muted}\u2500\u2500\u2500${reset}\n`,
	);
}

/**
 * Render a thinking block footer.
 */
export function printThinkingEnd(stdout: NodeJS.WriteStream): void {
	stdout.write(`${THEME.thinking}\u2514\u2500\u2500\u2500${reset}\n\n`);
}

/**
 * Render a tool call header with the tool name and arguments summary.
 */
export function printToolStart(
	stdout: NodeJS.WriteStream,
	toolName: string,
	args?: string,
): void {
	const argsSummary = args ? ` ${dim(truncateStr(args, 60))}` : "";
	stdout.write(
		`${THEME.tool}\u250C \u2699 ${bold(toolName)}${argsSummary}${reset}\n`,
	);
}

/**
 * Render a tool call result footer with optional metrics.
 */
export function printToolEnd(
	stdout: NodeJS.WriteStream,
	status: "done" | "error",
	duration?: number,
): void {
	const statusStr = status === "done"
		? `${THEME.success}done${reset}`
		: `${THEME.error}error${reset}`;
	const durationStr = duration !== undefined
		? ` ${THEME.muted}${duration}ms${reset}`
		: "";
	stdout.write(`${THEME.tool}\u2514 ${statusStr}${durationStr}${reset}\n`);
}

/**
 * Render an error message with a red left border.
 */
export function printError(stdout: NodeJS.WriteStream, message: string): void {
	stdout.write(`\n${THEME.error}\u2502 Error: ${message}${reset}\n`);
}

// ─── Spinner ────────────────────────────────────────────────────────────────

/** Braille spinner frames from the Nakshatram theme. */
const SPINNER_FRAMES = DEFAULT_THEME.symbols.spinner;

export interface SpinnerHandle {
	start(): void;
	stop(): void;
	/** Update the spinner's label text while spinning. */
	setLabel(label: string): void;
}

export function createSpinner(stdout: NodeJS.WriteStream): SpinnerHandle {
	let spinnerTimer: ReturnType<typeof setInterval> | null = null;
	let spinnerFrame = 0;
	let label = "Thinking...";

	return {
		start() {
			if (spinnerTimer) return;
			spinnerFrame = 0;
			spinnerTimer = setInterval(() => {
				stdout.write(clearLine() + cursorTo(1));
				const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
				stdout.write(`  ${THEME.thinking}${frame}${reset} ${dim(label)}`);
				spinnerFrame++;
			}, 100);
		},
		stop() {
			if (spinnerTimer) {
				clearInterval(spinnerTimer);
				spinnerTimer = null;
				stdout.write(clearLine() + cursorTo(1));
			}
		},
		setLabel(newLabel: string) {
			label = newLabel;
		},
	};
}

// ─── Simple interactive fallback (non-TTY) ──────────────────────────────────

export interface SimpleInteractiveOptions {
	agent: Agent;
	profile: AgentProfile;
	initialPrompt?: string;
}

/**
 * Fallback interactive mode for non-TTY environments.
 * Uses readline for simple line-by-line input.
 */
export async function runSimpleInteractive(options: SimpleInteractiveOptions): Promise<void> {
	const { agent, profile, initialPrompt } = options;
	const readline = await import("readline");

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const stdout = process.stdout;

	// Wire up event handler
	let streamingText = "";

	agent.setOnEvent((event: AgentEventType, data: unknown) => {
		const eventData = data as Record<string, unknown>;

		switch (event) {
			case "stream:text": {
				const text = eventData.text as string;
				stdout.write(text);
				streamingText += text;
				break;
			}
			case "stream:thinking": {
				// Skip thinking in non-TTY
				break;
			}
			case "tool:start": {
				const name = eventData.name as string;
				stdout.write(`[tool: ${name}] `);
				break;
			}
			case "tool:done": {
				stdout.write("done\n");
				break;
			}
		}
	});

	// Welcome
	stdout.write(`\n  ${profile.name} is ready. Type your message.\n\n`);

	// Handle initial prompt
	if (initialPrompt) {
		stdout.write(`> ${initialPrompt}\n\n`);
		streamingText = "";
		try {
			await agent.prompt(initialPrompt);
			stdout.write("\n\n");
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			process.stderr.write(`\nError: ${msg}\n\n`);
		}
	}

	// Read loop
	const askQuestion = (): void => {
		rl.question("> ", async (input: string) => {
			const trimmed = input.trim();

			if (!trimmed) {
				askQuestion();
				return;
			}

			if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
				stdout.write("  Goodbye.\n\n");
				rl.close();
				process.exit(0);
			}

			if (trimmed.startsWith("/")) {
				stdout.write(`  Unknown command: ${trimmed}\n\n`);
				askQuestion();
				return;
			}

			stdout.write("\n");
			streamingText = "";

			try {
				await agent.prompt(trimmed);
				if (streamingText && !streamingText.endsWith("\n")) {
					stdout.write("\n");
				}
				stdout.write("\n");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				process.stderr.write(`\nError: ${msg}\n\n`);
			}

			askQuestion();
		});
	};

	askQuestion();

	// Keep alive
	await new Promise<void>((resolve) => {
		rl.on("close", resolve);
	});
}

// ─── Sandesha Input Request Rendering ────────────────────────────────────────

/**
 * Render an input request from a sub-agent.
 * Shows a themed prompt with optional choices, default value, and timeout.
 */
export function printInputRequest(
	stdout: NodeJS.WriteStream,
	request: InputRequest,
): void {
	// Header: diamond + agent ID
	stdout.write(
		`\n${THEME.primary}\u27D0 Input requested by agent ${bold(request.agentId.slice(0, 8))}${reset}\n`,
	);

	// Prompt text
	stdout.write(`  ${request.prompt}\n`);

	// Numbered choices
	if (request.choices && request.choices.length > 0) {
		for (let i = 0; i < request.choices.length; i++) {
			stdout.write(`  ${THEME.secondary}${i + 1}.${reset} ${request.choices[i]}\n`);
		}
	}

	// Default value
	if (request.defaultValue !== undefined) {
		stdout.write(`  ${dim(`default: ${request.defaultValue}`)}\n`);
	}

	// Timeout
	if (request.timeoutMs !== undefined) {
		const seconds = Math.ceil(request.timeoutMs / 1000);
		stdout.write(`  ${dim(`timeout: ${seconds}s`)}\n`);
	}

	// Input hint
	stdout.write(`  ${dim("Type your response and press Enter:")}\n`);
}

// ─── Budget Warnings ────────────────────────────────────────────────────────

/**
 * Print a budget warning or hard-stop message.
 *
 * - Yellow warning at threshold: "Budget warning: $X.XX / $Y.YY (Z%)"
 * - Red hard stop: "Budget exceeded: $X.XX / $Y.YY — session paused"
 */
export function printBudgetWarning(
	stdout: NodeJS.WriteStream,
	status: BudgetStatus,
): void {
	// Session budget alerts
	if (status.sessionExceeded) {
		const pct = status.sessionLimit > 0
			? Math.round((status.sessionCost / status.sessionLimit) * 100)
			: 0;
		stdout.write(
			`\n${red(bold("  Budget exceeded"))}: ` +
			`$${status.sessionCost.toFixed(4)} / $${status.sessionLimit.toFixed(2)} ` +
			`(${pct}%) ${red("\u2014 session paused")}${reset}\n`,
		);
	} else if (status.sessionWarning) {
		const pct = status.sessionLimit > 0
			? Math.round((status.sessionCost / status.sessionLimit) * 100)
			: 0;
		stdout.write(
			`\n${yellow("  Budget warning")}: ` +
			`$${status.sessionCost.toFixed(4)} / $${status.sessionLimit.toFixed(2)} ` +
			`(${pct}%)${reset}\n`,
		);
	}

	// Daily budget alerts
	if (status.dailyExceeded) {
		const pct = status.dailyLimit > 0
			? Math.round((status.dailyCost / status.dailyLimit) * 100)
			: 0;
		stdout.write(
			`\n${red(bold("  Daily budget exceeded"))}: ` +
			`$${status.dailyCost.toFixed(4)} / $${status.dailyLimit.toFixed(2)} ` +
			`(${pct}%) ${red("\u2014 session paused")}${reset}\n`,
		);
	} else if (status.dailyWarning) {
		const pct = status.dailyLimit > 0
			? Math.round((status.dailyCost / status.dailyLimit) * 100)
			: 0;
		stdout.write(
			`\n${yellow("  Daily budget warning")}: ` +
			`$${status.dailyCost.toFixed(4)} / $${status.dailyLimit.toFixed(2)} ` +
			`(${pct}%)${reset}\n`,
		);
	}
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Truncate a string with ellipsis if it exceeds maxLen. */
function truncateStr(s: string, maxLen: number): string {
	if (s.length <= maxLen) return s;
	return s.slice(0, maxLen - 1) + "\u2026";
}
