/**
 * @chitragupta/ui — Layout primitive components.
 *
 * Provides box drawing, horizontal layout, text centering,
 * and truncation utilities for terminal UI composition.
 */

import { reset, stripAnsi, visibleLength } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Box Options ────────────────────────────────────────────────────────────

export interface BoxOptions {
	border?: boolean;
	padding?: number;
	title?: string;
	theme?: Theme;
	borderStyle?: "single" | "double" | "rounded" | "heavy";
}

// ─── Border Characters ──────────────────────────────────────────────────────

interface BorderChars {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
}

const BORDERS: Record<string, BorderChars> = {
	single: {
		topLeft: "\u250C",
		topRight: "\u2510",
		bottomLeft: "\u2514",
		bottomRight: "\u2518",
		horizontal: "\u2500",
		vertical: "\u2502",
	},
	double: {
		topLeft: "\u2554",
		topRight: "\u2557",
		bottomLeft: "\u255A",
		bottomRight: "\u255D",
		horizontal: "\u2550",
		vertical: "\u2551",
	},
	rounded: {
		topLeft: "\u256D",
		topRight: "\u256E",
		bottomLeft: "\u2570",
		bottomRight: "\u256F",
		horizontal: "\u2500",
		vertical: "\u2502",
	},
	heavy: {
		topLeft: "\u250F",
		topRight: "\u2513",
		bottomLeft: "\u2517",
		bottomRight: "\u251B",
		horizontal: "\u2501",
		vertical: "\u2503",
	},
};

// ─── Box ────────────────────────────────────────────────────────────────────

/** Wrap content lines in an optional bordered box with padding */
export function box(content: string[], width: number, opts?: BoxOptions): string[] {
	const hasBorder = opts?.border ?? true;
	const padding = opts?.padding ?? 0;
	const title = opts?.title;
	const theme = opts?.theme ?? DEFAULT_THEME;
	const borderStyle = opts?.borderStyle ?? "single";
	const chars = BORDERS[borderStyle] ?? BORDERS.single;
	const borderColor = hexToAnsi(theme.colors.border);
	const titleColor = hexToAnsi(theme.colors.primary);

	if (!hasBorder && padding === 0) {
		// Just ensure lines fit within width
		return content.map((line) => {
			const vLen = visibleLength(line);
			if (vLen > width) {
				return truncate(line, width);
			}
			return line;
		});
	}

	const output: string[] = [];
	const innerWidth = hasBorder ? width - 2 : width;
	const contentWidth = innerWidth - padding * 2;

	if (hasBorder) {
		// Top border
		if (title) {
			const titleText = ` ${title} `;
			const titleVisLen = stripAnsi(titleText).length;
			const remainingWidth = Math.max(0, innerWidth - titleVisLen);
			const leftDash = Math.floor(remainingWidth / 2);
			const rightDash = remainingWidth - leftDash;
			output.push(
				`${borderColor}${chars.topLeft}${chars.horizontal.repeat(leftDash)}${reset}${titleColor}${titleText}${reset}${borderColor}${chars.horizontal.repeat(rightDash)}${chars.topRight}${reset}`,
			);
		} else {
			output.push(
				`${borderColor}${chars.topLeft}${chars.horizontal.repeat(innerWidth)}${chars.topRight}${reset}`,
			);
		}

		// Top padding lines
		for (let i = 0; i < padding; i++) {
			output.push(`${borderColor}${chars.vertical}${reset}${" ".repeat(innerWidth)}${borderColor}${chars.vertical}${reset}`);
		}
	}

	// Content lines
	for (const line of content) {
		const vLen = visibleLength(line);
		const paddedLine = " ".repeat(padding) + line;
		const totalVisible = padding + vLen;
		const rightPad = Math.max(0, innerWidth - totalVisible);

		if (hasBorder) {
			output.push(
				`${borderColor}${chars.vertical}${reset}${paddedLine}${" ".repeat(rightPad)}${borderColor}${chars.vertical}${reset}`,
			);
		} else {
			output.push(`${paddedLine}${" ".repeat(rightPad)}`);
		}
	}

	if (hasBorder) {
		// Bottom padding lines
		for (let i = 0; i < padding; i++) {
			output.push(`${borderColor}${chars.vertical}${reset}${" ".repeat(innerWidth)}${borderColor}${chars.vertical}${reset}`);
		}

		// Bottom border
		output.push(
			`${borderColor}${chars.bottomLeft}${chars.horizontal.repeat(innerWidth)}${chars.bottomRight}${reset}`,
		);
	}

	return output;
}

// ─── Horizontal Layout ──────────────────────────────────────────────────────

/** Render two sets of lines side by side */
export function horizontalLayout(left: string[], right: string[], width: number, opts?: { gap?: number }): string[] {
	const gap = opts?.gap ?? 2;
	const maxLines = Math.max(left.length, right.length);
	const output: string[] = [];

	// Calculate left column width from content
	let maxLeftWidth = 0;
	for (const line of left) {
		const vLen = visibleLength(line);
		if (vLen > maxLeftWidth) maxLeftWidth = vLen;
	}

	// Limit left column to half the width
	const leftWidth = Math.min(maxLeftWidth, Math.floor((width - gap) / 2));
	const rightWidth = width - leftWidth - gap;

	for (let i = 0; i < maxLines; i++) {
		const leftLine = i < left.length ? left[i] : "";
		const rightLine = i < right.length ? right[i] : "";

		const leftVisLen = visibleLength(leftLine);
		const leftPadded = leftVisLen < leftWidth ? leftLine + " ".repeat(leftWidth - leftVisLen) : truncate(leftLine, leftWidth);

		const rightTruncated = visibleLength(rightLine) > rightWidth ? truncate(rightLine, rightWidth) : rightLine;

		output.push(`${leftPadded}${" ".repeat(gap)}${rightTruncated}`);
	}

	return output;
}

// ─── Center ─────────────────────────────────────────────────────────────────

/** Center-align text within a given width */
export function center(text: string, width: number): string {
	const vLen = visibleLength(text);
	if (vLen >= width) {
		return truncate(text, width);
	}

	const totalPadding = width - vLen;
	const leftPad = Math.floor(totalPadding / 2);
	const rightPad = totalPadding - leftPad;

	return " ".repeat(leftPad) + text + " ".repeat(rightPad);
}

// ─── Truncate ───────────────────────────────────────────────────────────────

/** Truncate text to maxWidth with ellipsis, preserving ANSI codes */
export function truncate(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (maxWidth <= 1) return "\u2026";

	const stripped = stripAnsi(text);
	if (stripped.length <= maxWidth) return text;

	// Walk through the string preserving ANSI codes
	// biome-ignore lint: complex regex needed for full ANSI parsing
	const re = /(\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\))/g;
	let visibleCount = 0;
	let result = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	match = re.exec(text);
	while (match !== null) {
		// Characters before this escape
		const textBefore = text.slice(lastIndex, match.index);
		for (const ch of textBefore) {
			if (visibleCount >= maxWidth - 1) {
				result += "\u2026";
				result += "\x1b[0m"; // Reset to be safe
				return result;
			}
			result += ch;
			visibleCount++;
		}

		// Include the escape sequence (doesn't count as visible)
		result += match[0];
		lastIndex = re.lastIndex;
		match = re.exec(text);
	}

	// Remaining text after last escape
	const remaining = text.slice(lastIndex);
	for (const ch of remaining) {
		if (visibleCount >= maxWidth - 1) {
			result += "\u2026";
			result += "\x1b[0m";
			return result;
		}
		result += ch;
		visibleCount++;
	}

	return result;
}

// ─── Padding ────────────────────────────────────────────────────────────────

/** Pad a string to a specific width (right padding) */
export function padRight(text: string, width: number): string {
	const vLen = visibleLength(text);
	if (vLen >= width) return text;
	return text + " ".repeat(width - vLen);
}

/** Pad a string to a specific width (left padding) */
export function padLeft(text: string, width: number): string {
	const vLen = visibleLength(text);
	if (vLen >= width) return text;
	return " ".repeat(width - vLen) + text;
}
