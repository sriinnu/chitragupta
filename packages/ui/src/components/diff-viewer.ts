/**
 * @chitragupta/ui — File diff display component.
 *
 * Renders file diffs in the terminal with side-by-side or unified format,
 * color-coded additions/removals, line numbers, and collapsible unchanged
 * sections.
 */

import { bold, dim, gray, green, red, reset, stripAnsi, visibleLength, yellow } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiffFormat = "unified" | "side-by-side";

export interface DiffOptions {
	format?: DiffFormat;
	contextLines?: number;
	theme?: Theme;
	showLineNumbers?: boolean;
	collapseUnchanged?: boolean;
	unchangedContextSize?: number;
}

export interface DiffLine {
	type: "add" | "remove" | "unchanged" | "header" | "separator";
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
}

// ─── Diff Algorithm (Simple LCS-based) ──────────────────────────────────────

interface DiffEntry {
	type: "add" | "remove" | "unchanged";
	oldLine?: string;
	newLine?: string;
	oldLineNum?: number;
	newLineNum?: number;
}

function computeDiff(oldLines: string[], newLines: string[]): DiffEntry[] {
	const entries: DiffEntry[] = [];

	// Simple O(NM) LCS for reasonable-sized diffs
	const m = oldLines.length;
	const n = newLines.length;

	// Build LCS table
	const dp: number[][] = [];
	for (let i = 0; i <= m; i++) {
		dp[i] = new Array(n + 1).fill(0);
	}

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find diff
	const result: DiffEntry[] = [];
	let i = m;
	let j = n;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			result.push({
				type: "unchanged",
				oldLine: oldLines[i - 1],
				newLine: newLines[j - 1],
				oldLineNum: i,
				newLineNum: j,
			});
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			result.push({
				type: "add",
				newLine: newLines[j - 1],
				newLineNum: j,
			});
			j--;
		} else if (i > 0) {
			result.push({
				type: "remove",
				oldLine: oldLines[i - 1],
				oldLineNum: i,
			});
			i--;
		}
	}

	result.reverse();
	return result;
}

// ─── Parse Unified Diff ─────────────────────────────────────────────────────

function parseUnifiedDiff(diff: string): DiffEntry[] {
	const lines = diff.split("\n");
	const entries: DiffEntry[] = [];
	let oldLineNum = 0;
	let newLineNum = 0;

	for (const line of lines) {
		// Hunk header
		const hunkMatch = line.match(/^@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
		if (hunkMatch) {
			oldLineNum = parseInt(hunkMatch[1], 10);
			newLineNum = parseInt(hunkMatch[2], 10);
			continue;
		}

		// Skip diff headers
		if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ") || line.startsWith("index ")) {
			continue;
		}

		if (line.startsWith("+")) {
			entries.push({
				type: "add",
				newLine: line.slice(1),
				newLineNum: newLineNum++,
			});
		} else if (line.startsWith("-")) {
			entries.push({
				type: "remove",
				oldLine: line.slice(1),
				oldLineNum: oldLineNum++,
			});
		} else if (line.startsWith(" ")) {
			entries.push({
				type: "unchanged",
				oldLine: line.slice(1),
				newLine: line.slice(1),
				oldLineNum: oldLineNum++,
				newLineNum: newLineNum++,
			});
		}
	}

	return entries;
}

// ─── Collapse Unchanged Sections ─────────────────────────────────────────────

interface CollapsedBlock {
	type: "entries" | "collapsed";
	entries?: DiffEntry[];
	count?: number;
}

function collapseUnchanged(entries: DiffEntry[], contextSize: number): CollapsedBlock[] {
	const blocks: CollapsedBlock[] = [];
	let unchangedRun: DiffEntry[] = [];

	const flushUnchanged = (): void => {
		if (unchangedRun.length === 0) return;

		if (unchangedRun.length <= contextSize * 2 + 1) {
			// Short enough to show in full
			blocks.push({ type: "entries", entries: [...unchangedRun] });
		} else {
			// Show first contextSize, collapse middle, show last contextSize
			blocks.push({ type: "entries", entries: unchangedRun.slice(0, contextSize) });
			blocks.push({ type: "collapsed", count: unchangedRun.length - contextSize * 2 });
			blocks.push({ type: "entries", entries: unchangedRun.slice(-contextSize) });
		}
		unchangedRun = [];
	};

	for (const entry of entries) {
		if (entry.type === "unchanged") {
			unchangedRun.push(entry);
		} else {
			flushUnchanged();
			if (blocks.length > 0 && blocks[blocks.length - 1].type === "entries") {
				blocks[blocks.length - 1].entries!.push(entry);
			} else {
				blocks.push({ type: "entries", entries: [entry] });
			}
		}
	}
	flushUnchanged();

	return blocks;
}

// ─── Render Functions ────────────────────────────────────────────────────────

/**
 * Render a diff from old and new content strings.
 * Returns styled terminal output lines.
 */
export function renderDiff(
	oldContent: string,
	newContent: string,
	width: number,
	opts?: DiffOptions,
): string[] {
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const entries = computeDiff(oldLines, newLines);
	return renderDiffEntries(entries, width, opts);
}

/**
 * Render a diff from a unified diff string.
 * Returns styled terminal output lines.
 */
export function renderUnifiedDiff(
	diffString: string,
	width: number,
	opts?: DiffOptions,
): string[] {
	const entries = parseUnifiedDiff(diffString);
	return renderDiffEntries(entries, width, opts);
}

function renderDiffEntries(
	entries: DiffEntry[],
	width: number,
	opts?: DiffOptions,
): string[] {
	const format = opts?.format ?? "unified";
	const showLineNumbers = opts?.showLineNumbers ?? true;
	const shouldCollapse = opts?.collapseUnchanged ?? true;
	const contextSize = opts?.unchangedContextSize ?? 3;
	const theme = opts?.theme ?? DEFAULT_THEME;

	if (format === "side-by-side") {
		return renderSideBySide(entries, width, showLineNumbers, shouldCollapse, contextSize, theme);
	}
	return renderUnified(entries, width, showLineNumbers, shouldCollapse, contextSize, theme);
}

function renderUnified(
	entries: DiffEntry[],
	width: number,
	showLineNumbers: boolean,
	shouldCollapse: boolean,
	contextSize: number,
	_theme: Theme,
): string[] {
	const output: string[] = [];

	// Calculate line number width
	let maxLineNum = 0;
	for (const entry of entries) {
		if (entry.oldLineNum !== undefined && entry.oldLineNum > maxLineNum) maxLineNum = entry.oldLineNum;
		if (entry.newLineNum !== undefined && entry.newLineNum > maxLineNum) maxLineNum = entry.newLineNum;
	}
	const lineNumWidth = showLineNumbers ? String(maxLineNum).length : 0;

	const blocks = shouldCollapse ? collapseUnchanged(entries, contextSize) : [{ type: "entries" as const, entries }];

	for (const block of blocks) {
		if (block.type === "collapsed") {
			const collapseText = `... ${block.count} unchanged lines ...`;
			output.push(dim(`  ${"".padStart(lineNumWidth * 2 + 5)}${collapseText}`));
			continue;
		}

		for (const entry of block.entries ?? []) {
			const lineContent = entry.type === "remove" ? (entry.oldLine ?? "") : (entry.newLine ?? entry.oldLine ?? "");

			let lineNumStr = "";
			if (showLineNumbers) {
				const old = entry.oldLineNum !== undefined ? String(entry.oldLineNum).padStart(lineNumWidth) : " ".repeat(lineNumWidth);
				const nw = entry.newLineNum !== undefined ? String(entry.newLineNum).padStart(lineNumWidth) : " ".repeat(lineNumWidth);
				lineNumStr = `${dim(old)} ${dim(nw)} `;
			}

			const maxContentWidth = width - visibleLength(stripAnsi(lineNumStr)) - 4;
			const truncatedContent = lineContent.length > maxContentWidth
				? lineContent.slice(0, maxContentWidth - 1) + "\u2026"
				: lineContent;

			switch (entry.type) {
				case "add":
					output.push(`  ${lineNumStr}${green("+ " + truncatedContent)}`);
					break;
				case "remove":
					output.push(`  ${lineNumStr}${red("- " + truncatedContent)}`);
					break;
				case "unchanged":
					output.push(`  ${lineNumStr}${dim("  " + truncatedContent)}`);
					break;
			}
		}
	}

	// Summary
	const additions = entries.filter((e) => e.type === "add").length;
	const removals = entries.filter((e) => e.type === "remove").length;
	output.push("");
	output.push(
		`  ${green(`+${additions}`)} ${red(`-${removals}`)} ${gray(`(${entries.length} lines)`)}`,
	);

	return output;
}

function renderSideBySide(
	entries: DiffEntry[],
	width: number,
	showLineNumbers: boolean,
	shouldCollapse: boolean,
	contextSize: number,
	_theme: Theme,
): string[] {
	const output: string[] = [];

	// Calculate dimensions
	let maxLineNum = 0;
	for (const entry of entries) {
		if (entry.oldLineNum !== undefined && entry.oldLineNum > maxLineNum) maxLineNum = entry.oldLineNum;
		if (entry.newLineNum !== undefined && entry.newLineNum > maxLineNum) maxLineNum = entry.newLineNum;
	}
	const lineNumWidth = showLineNumbers ? String(maxLineNum).length : 0;
	const gutterWidth = lineNumWidth + 2; // number + space + indicator
	const halfWidth = Math.floor((width - 3) / 2); // -3 for separator " | "
	const contentWidth = halfWidth - gutterWidth;

	// Header
	const leftHeader = "Old".padEnd(halfWidth);
	const rightHeader = "New".padEnd(halfWidth);
	output.push(bold(`  ${leftHeader} ${dim("\u2502")} ${rightHeader}`));
	output.push(dim("  " + "\u2500".repeat(halfWidth) + "\u253C" + "\u2500".repeat(halfWidth + 1)));

	const blocks = shouldCollapse ? collapseUnchanged(entries, contextSize) : [{ type: "entries" as const, entries }];

	for (const block of blocks) {
		if (block.type === "collapsed") {
			const collapseText = `... ${block.count} unchanged lines ...`;
			const leftSide = dim(collapseText.padEnd(halfWidth));
			const rightSide = dim(collapseText.padEnd(halfWidth));
			output.push(`  ${leftSide} ${dim("\u2502")} ${rightSide}`);
			continue;
		}

		for (const entry of block.entries ?? []) {
			const truncate = (text: string, maxW: number): string => {
				if (text.length > maxW) return text.slice(0, maxW - 1) + "\u2026";
				return text;
			};

			let leftSide: string;
			let rightSide: string;

			switch (entry.type) {
				case "unchanged": {
					const num = showLineNumbers ? dim(String(entry.oldLineNum ?? "").padStart(lineNumWidth)) + " " : "";
					const content = truncate(entry.oldLine ?? "", contentWidth);
					leftSide = `${num}${dim("  " + content)}`;
					const rNum = showLineNumbers ? dim(String(entry.newLineNum ?? "").padStart(lineNumWidth)) + " " : "";
					rightSide = `${rNum}${dim("  " + content)}`;
					break;
				}
				case "remove": {
					const num = showLineNumbers ? dim(String(entry.oldLineNum ?? "").padStart(lineNumWidth)) + " " : "";
					const content = truncate(entry.oldLine ?? "", contentWidth);
					leftSide = `${num}${red("- " + content)}`;
					rightSide = " ".repeat(gutterWidth + contentWidth + 2);
					break;
				}
				case "add": {
					leftSide = " ".repeat(gutterWidth + contentWidth + 2);
					const rNum = showLineNumbers ? dim(String(entry.newLineNum ?? "").padStart(lineNumWidth)) + " " : "";
					const content = truncate(entry.newLine ?? "", contentWidth);
					rightSide = `${rNum}${green("+ " + content)}`;
					break;
				}
			}

			// Pad sides to ensure alignment
			const leftPadded = leftSide + " ".repeat(Math.max(0, halfWidth - visibleLength(stripAnsi(leftSide))));
			output.push(`  ${leftPadded} ${dim("\u2502")} ${rightSide}`);
		}
	}

	// Summary
	const additions = entries.filter((e) => e.type === "add").length;
	const removals = entries.filter((e) => e.type === "remove").length;
	output.push("");
	output.push(
		`  ${green(`+${additions}`)} ${red(`-${removals}`)} ${gray(`(${entries.length} lines)`)}`,
	);

	return output;
}
