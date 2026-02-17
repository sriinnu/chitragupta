/**
 * @chitragupta/ui — Rich formatted output for MCP tool results.
 *
 * Creates styled footer blocks for tool outputs with metrics,
 * timing, and ANSI colors. Inspired by Claude Code's "Bash Token Usage" panel.
 */

import { bold, dim, green, yellow, cyan, red, reset } from "./ansi.js";
import { hexToAnsi } from "./theme.js";

// ─── Saffron/Gold Theme Colors ──────────────────────────────────────────────

/** Saffron — primary tool color (#FF9933) */
const SAFFRON = hexToAnsi("#FF9933");
/** Gold — secondary accent (#FFD700) */
const GOLD = hexToAnsi("#FFD700");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolFooterOpts {
	toolName: string;
	elapsedMs: number;
	outputBytes: number;
	metadata?: Record<string, unknown>;
	isError?: boolean;
}

// ─── Formatting Utilities ───────────────────────────────────────────────────

/**
 * Format a byte count into a human-readable string.
 * @example formatBytes(4600) → "4.5KB"
 * @example formatBytes(89) → "89B"
 * @example formatBytes(1200000) → "1.1MB"
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Rough token estimate from byte count (GPT-4 average: ~4 bytes/token).
 */
export function estimateTokens(bytes: number): number {
	return Math.max(1, Math.round(bytes / 4));
}

/**
 * Format a token count with ~ prefix and magnitude suffix.
 * @example formatTokens(350) → "~350"
 * @example formatTokens(1200) → "~1.2k"
 * @example formatTokens(2500000) → "~2.5M"
 */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) return `~${tokens}`;
	if (tokens < 1_000_000) return `~${(tokens / 1000).toFixed(1)}k`;
	return `~${(tokens / 1_000_000).toFixed(1)}M`;
}

// ─── Per-Tool Metric Lines ──────────────────────────────────────────────────

/**
 * Generate tool-specific metric lines from metadata.
 * Returns an array of formatted strings (one per metric line).
 */
function formatToolMetrics(toolName: string, metadata?: Record<string, unknown>): string[] {
	if (!metadata) return [];
	const lines: string[] = [];

	switch (toolName) {
		case "bash": {
			if (metadata.exitCode !== undefined) {
				const code = metadata.exitCode as number;
				const exitStr = code === 0 ? green(`${code}`) : red(`${code}`);
				lines.push(`${dim("exit:")} ${exitStr}`);
			}
			if (metadata.truncated) lines.push(yellow("truncated"));
			if (metadata.timedOut) lines.push(red("timed out"));
			break;
		}

		case "read": {
			const displayed = metadata.displayedLines as number | undefined;
			const total = metadata.totalLines as number | undefined;
			if (displayed !== undefined && total !== undefined) {
				lines.push(`${dim("lines:")} ${green(`${displayed}`)}${dim("/")}${green(`${total}`)}`);
			} else if (displayed !== undefined) {
				lines.push(`${dim("lines:")} ${green(`${displayed}`)}`);
			}
			if (metadata.truncated) lines.push(yellow("truncated"));
			break;
		}

		case "grep": {
			const matches = metadata.matchCount as number | undefined;
			if (matches !== undefined) {
				lines.push(`${dim("matches:")} ${green(`${matches}`)}`);
			}
			if (metadata.capped) lines.push(yellow("capped"));
			break;
		}

		case "ls": {
			const entries = metadata.entryCount as number | undefined;
			if (entries !== undefined) {
				lines.push(`${dim("entries:")} ${green(`${entries}`)}`);
			}
			if (metadata.capped) lines.push(yellow("capped"));
			break;
		}

		case "find": {
			const matches = metadata.matchCount as number | undefined;
			if (matches !== undefined) {
				lines.push(`${dim("matches:")} ${green(`${matches}`)}`);
			}
			if (metadata.capped) lines.push(yellow("capped"));
			break;
		}

		case "edit": {
			const edits = metadata.editsApplied as number | undefined;
			if (edits !== undefined) {
				lines.push(`${dim("edits:")} ${green(`${edits}`)}`);
			}
			break;
		}

		case "write": {
			const writtenLines = metadata.lines as number | undefined;
			const fileSize = metadata.size as number | undefined;
			if (writtenLines !== undefined) {
				lines.push(`${dim("lines:")} ${green(`${writtenLines}`)}`);
			}
			if (fileSize !== undefined) {
				lines.push(`${dim("size:")} ${green(formatBytes(fileSize))}`);
			}
			break;
		}

		case "diff": {
			const additions = metadata.additions as number | undefined;
			const deletions = metadata.deletions as number | undefined;
			if (additions !== undefined || deletions !== undefined) {
				const parts: string[] = [];
				if (additions !== undefined) parts.push(green(`+${additions}`));
				if (deletions !== undefined) parts.push(red(`-${deletions}`));
				lines.push(parts.join(dim(" / ")));
			}
			break;
		}

		case "watch": {
			const changes = metadata.changeCount as number | undefined;
			if (changes !== undefined) {
				lines.push(`${dim("changes:")} ${green(`${changes}`)}`);
			}
			break;
		}

		case "memory":
		case "memory_search":
		case "chitragupta_memory_search":
		case "akasha_traces":
		case "akasha_deposit": {
			const scope = metadata.scope as string | undefined;
			const matchCount = metadata.matchCount as number | undefined;
			if (scope) lines.push(`${dim("scope:")} ${green(scope)}`);
			if (matchCount !== undefined) {
				lines.push(`${dim("matches:")} ${green(`${matchCount}`)}`);
			}
			break;
		}

		case "session":
		case "chitragupta_session_list":
		case "chitragupta_session_show": {
			const action = metadata.action as string | undefined;
			if (action) lines.push(`${dim("action:")} ${green(action)}`);
			break;
		}

		case "project_analysis": {
			const files = metadata.totalFiles as number | undefined;
			const totalLines = metadata.totalLines as number | undefined;
			const frameworks = metadata.frameworks as string[] | undefined;
			if (files !== undefined) lines.push(`${dim("files:")} ${green(`${files}`)}`);
			if (totalLines !== undefined) lines.push(`${dim("lines:")} ${green(`${totalLines}`)}`);
			if (frameworks !== undefined && frameworks.length > 0) {
				lines.push(`${dim("frameworks:")} ${green(`${frameworks.length}`)}`);
			}
			break;
		}

		default:
			// Generic: show any numeric metadata values
			for (const [key, value] of Object.entries(metadata)) {
				if (typeof value === "number") {
					lines.push(`${dim(`${key}:`)} ${green(`${value}`)}`);
				} else if (typeof value === "string" && value.length < 30) {
					lines.push(`${dim(`${key}:`)} ${green(value)}`);
				}
			}
			break;
	}

	return lines;
}

// ─── Header Builder ─────────────────────────────────────────────────────────

const HEADER_WIDTH = 40;

function buildHeader(toolName: string): string {
	const label = ` ${toolName} `;
	const leftBar = "═══";
	const rightPad = Math.max(1, HEADER_WIDTH - leftBar.length - label.length);
	const rightBar = "═".repeat(rightPad);
	return dim(leftBar) + `${SAFFRON}${bold(label)}${reset}` + dim(rightBar);
}

// ─── Main Formatter ─────────────────────────────────────────────────────────

/**
 * Format a rich footer block for an MCP tool result.
 *
 * @example
 * ```
 * ═══ bash ═══════════════════════════════
 * ▸ exit: 0 | output: 4.6KB (~1.2k tokens)
 * ⏱ 42.3ms
 * ```
 */
export function formatToolFooter(opts: ToolFooterOpts): string {
	const { toolName, elapsedMs, outputBytes, metadata, isError } = opts;
	const lines: string[] = [];

	// Header line
	lines.push(buildHeader(toolName));

	// Metrics line: ▸ [tool-specific] | output: XKB (~Yk tokens)
	const toolMetrics = formatToolMetrics(toolName, metadata);
	const bytes = formatBytes(outputBytes);
	const tokens = formatTokens(estimateTokens(outputBytes));
	const outputPart = `${dim("output:")} ${green(bytes)} ${yellow(`(${tokens} tokens)`)}`;

	const bullet = `${GOLD}▸${reset}`;

	if (toolMetrics.length > 0) {
		const metricStr = toolMetrics.join(dim(" | "));
		lines.push(`${bullet} ${metricStr} ${dim("|")} ${outputPart}`);
	} else {
		lines.push(`${bullet} ${outputPart}`);
	}

	// Error indicator
	if (isError) {
		lines.push(`${bullet} ${red("error")}`);
	}

	// Timing line
	const timeStr = elapsedMs < 1000
		? `${elapsedMs.toFixed(1)}ms`
		: `${(elapsedMs / 1000).toFixed(2)}s`;
	lines.push(`${cyan("⏱")} ${cyan(timeStr)}`);

	return lines.join("\n");
}
