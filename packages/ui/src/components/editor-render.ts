/**
 * Editor render helpers — line prefix building and text wrapping.
 *
 * Extracted from editor.ts for maintainability.
 *
 * @module editor-render
 */

import { dim, gray, reset } from "../ansi.js";
import { hexToAnsi, type Theme } from "../theme.js";
import type { CompletionItem } from "./editor.js";
import { renderCompletionMenu } from "./editor-completion.js";

/**
 * Build the line prefix for editor rendering.
 *
 * Handles prompt symbol, line numbers, and wrapped-line indicators.
 */
export function buildLinePrefix(
	lineIdx: number,
	rowIdx: number,
	isMultiline: boolean,
	gutterWidth: number,
	promptColor: string,
	lineNumColor: string,
	promptSymbol: string,
): string {
	if (lineIdx === 0 && rowIdx === 0) {
		if (isMultiline) {
			const num = String(lineIdx + 1).padStart(gutterWidth);
			return `${promptColor}${promptSymbol}${reset} ${lineNumColor}${num}${reset} `;
		}
		return `${promptColor}${promptSymbol}${reset} `;
	}
	if (rowIdx === 0) {
		const num = String(lineIdx + 1).padStart(gutterWidth);
		return `  ${lineNumColor}${num}${reset} `;
	}
	const wrapIndicator = dim("\u2937 ");
	if (isMultiline) return `  ${" ".repeat(gutterWidth)} ${wrapIndicator}`;
	return `  ${wrapIndicator}`;
}

/**
 * Wrap a single line into multiple rows of `maxWidth` characters.
 * Returns the original line as a single-element array if it fits.
 */
export function wrapLine(line: string, maxWidth: number): string[] {
	if (maxWidth <= 0 || line.length <= maxWidth) return [line];
	const rows: string[] = [];
	let pos = 0;
	while (pos < line.length) {
		rows.push(line.slice(pos, pos + maxWidth));
		pos += maxWidth;
	}
	return rows;
}
