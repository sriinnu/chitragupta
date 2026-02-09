/**
 * @chitragupta/ui — Terminal markdown renderer.
 *
 * Converts markdown text into ANSI-styled terminal output with support
 * for headings, bold, italic, code blocks with per-language syntax
 * highlighting, tables, lists, links, blockquotes, and horizontal rules.
 */

import { bold, cyan, dim, italic, magenta, reset, stripAnsi, underline, visibleLength, yellow } from "../ansi.js";
import { detectLanguage, highlightCodeLine } from "./syntax-highlight.js";

// Re-export detectLanguage so existing consumers keep working
export { detectLanguage } from "./syntax-highlight.js";

// ─── Word Wrapping ──────────────────────────────────────────────────────────

function wordWrap(text: string, width: number): string[] {
	if (width <= 0) return [text];

	const lines: string[] = [];
	const words = text.split(/(\s+)/);
	let currentLine = "";
	let currentVisible = 0;

	for (const word of words) {
		const visibleWord = stripAnsi(word);

		if (currentVisible + visibleWord.length > width && currentLine.length > 0) {
			lines.push(currentLine);
			currentLine = "";
			currentVisible = 0;

			// Skip leading whitespace on new line
			if (word.trim().length === 0) continue;
		}

		currentLine += word;
		currentVisible += visibleWord.length;
	}

	if (currentLine.length > 0) {
		lines.push(currentLine);
	}

	return lines.length > 0 ? lines : [""];
}

// ─── Inline Formatting ──────────────────────────────────────────────────────

function formatInline(text: string): string {
	let result = text;

	// Bold+italic ***text***
	result = result.replace(/\*\*\*(.+?)\*\*\*/g, (_m, t) => bold(italic(t)));
	// Bold **text**
	result = result.replace(/\*\*(.+?)\*\*/g, (_m, t) => bold(t));
	// Italic *text* or _text_
	result = result.replace(/\*(.+?)\*/g, (_m, t) => italic(t));
	result = result.replace(/_(.+?)_/g, (_m, t) => italic(t));
	// Strikethrough ~~text~~
	result = result.replace(/~~(.+?)~~/g, (_m, t) => `\x1b[9m${t}\x1b[29m`);
	// Code `text`
	result = result.replace(/`([^`]+)`/g, (_m, t) => `\x1b[48;5;236m\x1b[38;5;180m ${t} \x1b[0m`);
	// Links [text](url)
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
		return `${underline(cyan(label))} ${dim(`(${url})`)}`;
	});

	return result;
}

// ─── Table Rendering ─────────────────────────────────────────────────────────

interface TableData {
	headers: string[];
	alignments: Array<"left" | "center" | "right">;
	rows: string[][];
}

function parseTable(lines: string[], startIndex: number): { table: TableData; endIndex: number } | null {
	if (startIndex + 1 >= lines.length) return null;

	const headerLine = lines[startIndex];
	const separatorLine = lines[startIndex + 1];

	if (!/^\s*\|?[\s:]*-+[\s:|-]*\|?\s*$/.test(separatorLine)) return null;

	const parseRow = (line: string): string[] => {
		let trimmed = line.trim();
		if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
		if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
		return trimmed.split("|").map((cell) => cell.trim());
	};

	const headers = parseRow(headerLine);
	const sepCells = parseRow(separatorLine);

	const alignments: Array<"left" | "center" | "right"> = sepCells.map((cell) => {
		const s = cell.trim();
		const leftColon = s.startsWith(":");
		const rightColon = s.endsWith(":");
		if (leftColon && rightColon) return "center";
		if (rightColon) return "right";
		return "left";
	});

	const rows: string[][] = [];
	let endIndex = startIndex + 2;

	while (endIndex < lines.length) {
		const line = lines[endIndex];
		if (!line.trim().includes("|")) break;
		rows.push(parseRow(line));
		endIndex++;
	}

	return { table: { headers, alignments, rows }, endIndex };
}

function renderTable(table: TableData, maxWidth: number): string[] {
	const output: string[] = [];
	const colCount = table.headers.length;

	// Calculate column widths
	const colWidths: number[] = table.headers.map((h) => stripAnsi(h).length);
	for (const row of table.rows) {
		for (let i = 0; i < colCount && i < row.length; i++) {
			colWidths[i] = Math.max(colWidths[i] ?? 0, stripAnsi(row[i]).length);
		}
	}

	// Ensure widths fit within maxWidth
	const totalBorderWidth = colCount + 1 + colCount * 2;
	const totalContentWidth = colWidths.reduce((a, b) => a + b, 0);
	if (totalContentWidth + totalBorderWidth > maxWidth) {
		const availableContent = maxWidth - totalBorderWidth;
		const ratio = availableContent / totalContentWidth;
		for (let i = 0; i < colWidths.length; i++) {
			colWidths[i] = Math.max(3, Math.floor(colWidths[i] * ratio));
		}
	}

	const padCell = (text: string, width: number, alignment: "left" | "center" | "right"): string => {
		const vis = stripAnsi(text).length;
		const truncated = vis > width ? text.slice(0, width - 1) + "\u2026" : text;
		const truncVis = stripAnsi(truncated).length;
		const pad = width - truncVis;
		if (alignment === "right") return " ".repeat(pad) + truncated;
		if (alignment === "center") {
			const left = Math.floor(pad / 2);
			return " ".repeat(left) + truncated + " ".repeat(pad - left);
		}
		return truncated + " ".repeat(pad);
	};

	// Top border
	const topBorder = dim("\u250C" + colWidths.map((w) => "\u2500".repeat(w + 2)).join("\u252C") + "\u2510");
	output.push(`  ${topBorder}`);

	// Header row
	const headerCells = table.headers.map((h, i) => {
		const formatted = bold(formatInline(h));
		return padCell(formatted, colWidths[i] ?? 3, table.alignments[i] ?? "left");
	});
	output.push(`  ${dim("\u2502")} ${headerCells.join(` ${dim("\u2502")} `)} ${dim("\u2502")}`);

	// Header separator
	const midBorder = dim("\u251C" + colWidths.map((w) => "\u2500".repeat(w + 2)).join("\u253C") + "\u2524");
	output.push(`  ${midBorder}`);

	// Data rows
	for (const row of table.rows) {
		const cells = table.headers.map((_, i) => {
			const text = row[i] ?? "";
			const formatted = formatInline(text);
			return padCell(formatted, colWidths[i] ?? 3, table.alignments[i] ?? "left");
		});
		output.push(`  ${dim("\u2502")} ${cells.join(` ${dim("\u2502")} `)} ${dim("\u2502")}`);
	}

	// Bottom border
	const bottomBorder = dim("\u2514" + colWidths.map((w) => "\u2500".repeat(w + 2)).join("\u2534") + "\u2518");
	output.push(`  ${bottomBorder}`);

	return output;
}

// ─── Main Renderer ──────────────────────────────────────────────────────────

/** Convert a markdown string to ANSI-styled terminal output lines */
export function renderMarkdown(md: string, width: number): string {
	const lines = md.split("\n");
	const output: string[] = [];
	let inCodeBlock = false;
	let codeLang = "";
	const codeLines: string[] = [];
	let inList = false;

	const effectiveWidth = Math.max(width - 2, 20);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Code block toggle
		if (line.trimStart().startsWith("```")) {
			if (!inCodeBlock) {
				inCodeBlock = true;
				codeLang = line.trimStart().slice(3).trim();
				codeLines.length = 0;
				if (inList) inList = false;
			} else {
				inCodeBlock = false;
				if (!codeLang) codeLang = detectLanguage(codeLines.join("\n"));

				const codeWidth = Math.min(effectiveWidth - 4, effectiveWidth);
				const bgStyle = "\x1b[48;5;236m\x1b[38;5;253m";

				if (codeLang) {
					output.push(`  ${dim(`\u250C\u2500 ${codeLang} ` + "\u2500".repeat(Math.max(0, codeWidth - codeLang.length - 5)) + "\u2510")}`);
				} else {
					output.push(`  ${dim("\u250C" + "\u2500".repeat(Math.max(0, codeWidth - 2)) + "\u2510")}`);
				}

				for (const codeLine of codeLines) {
					const highlighted = highlightCodeLine(codeLine, codeLang);
					const padded = codeLine + " ".repeat(Math.max(0, codeWidth - 4 - stripAnsi(codeLine).length));
					const styledLine = codeLang
						? highlighted + " ".repeat(Math.max(0, codeWidth - 4 - stripAnsi(codeLine).length))
						: padded;
					output.push(`  ${dim("\u2502")} ${bgStyle}${styledLine}${reset} ${dim("\u2502")}`);
				}

				output.push(`  ${dim("\u2514" + "\u2500".repeat(Math.max(0, codeWidth - 2)) + "\u2518")}`);
				output.push("");
				codeLang = "";
			}
			continue;
		}

		if (inCodeBlock) { codeLines.push(line); continue; }

		// Horizontal rule
		if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
			inList = false;
			output.push(dim("\u2500".repeat(Math.min(effectiveWidth, 40))));
			output.push("");
			continue;
		}

		// Table detection
		if (line.trim().includes("|") && i + 1 < lines.length) {
			const tableResult = parseTable(lines, i);
			if (tableResult) {
				inList = false;
				output.push("", ...renderTable(tableResult.table, effectiveWidth), "");
				i = tableResult.endIndex - 1;
				continue;
			}
		}

		// Headings
		const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
		if (headingMatch) {
			inList = false;
			const level = headingMatch[1].length;
			const text = headingMatch[2];
			const formatted = formatInline(text);

			if (level === 1) {
				output.push("", bold(magenta(`\u2550\u2550 ${formatted} ` + "\u2550".repeat(Math.max(0, effectiveWidth - stripAnsi(text).length - 4)))), "");
			} else if (level === 2) {
				output.push("", bold(cyan(`\u2500\u2500 ${formatted}`)), "");
			} else {
				output.push("", bold(yellow(`   ${formatted}`)), "");
			}
			continue;
		}

		// Blockquote
		if (line.startsWith(">")) {
			const content = line.replace(/^>\s*/, "");
			const formatted = formatInline(content);
			for (const wline of wordWrap(formatted, effectiveWidth - 4)) {
				output.push(`  ${dim("\u2502")} ${italic(wline)}`);
			}
			continue;
		}

		// Unordered list
		const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
		if (ulMatch) {
			inList = true;
			const indent = ulMatch[1];
			const content = ulMatch[3];
			const formatted = formatInline(content);
			const depth = Math.floor(indent.length / 2);
			const bullets = ["\u2022", "\u25E6", "\u25AA"];
			const bullet = bullets[Math.min(depth, bullets.length - 1)];
			const prefix = "  ".repeat(depth) + `  ${cyan(bullet)} `;
			const prefixLen = 2 * depth + 4;
			const wrapped = wordWrap(formatted, effectiveWidth - prefixLen);
			output.push(prefix + wrapped[0]);
			for (let j = 1; j < wrapped.length; j++) {
				output.push(" ".repeat(prefixLen) + wrapped[j]);
			}
			continue;
		}

		// Ordered list
		const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
		if (olMatch) {
			inList = true;
			const indent = olMatch[1];
			const num = olMatch[2];
			const content = olMatch[3];
			const formatted = formatInline(content);
			const depth = Math.floor(indent.length / 2);
			const prefix = "  ".repeat(depth) + `  ${dim(num + ".")} `;
			const prefixLen = 2 * depth + num.length + 4;
			const wrapped = wordWrap(formatted, effectiveWidth - prefixLen);
			output.push(prefix + wrapped[0]);
			for (let j = 1; j < wrapped.length; j++) {
				output.push(" ".repeat(prefixLen) + wrapped[j]);
			}
			continue;
		}

		// Empty line
		if (line.trim() === "") {
			if (inList) inList = false;
			output.push("");
			continue;
		}

		// Regular paragraph
		const formatted = formatInline(line);
		for (const wline of wordWrap(formatted, effectiveWidth)) {
			output.push(`  ${wline}`);
		}
	}

	return output.join("\n");
}
