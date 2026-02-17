/**
 * @chitragupta/ui -- Editor cursor movement, navigation, and text mutations.
 *
 * Extracted from editor.ts to keep file sizes manageable.
 * Provides pure/near-pure functions for cursor movement (including word mode),
 * navigation key handling, and text insertion/deletion operations.
 */

import type { KeyEvent } from "../keys.js";
import type { Position } from "./editor.js";

// ─── Cursor Movement ─────────────────────────────────────────────────────────

/** Move cursor left. In word mode, skip to the start of the previous word. */
export function moveCursorLeft(
	lines: string[], cursor: Position, wordMode = false,
): void {
	if (wordMode) {
		if (cursor.col > 0) {
			const line = lines[cursor.line] ?? "";
			let col = cursor.col - 1;
			while (col > 0 && line[col] === " ") col--;
			while (col > 0 && line[col - 1] !== " ") col--;
			cursor.col = col;
		} else if (cursor.line > 0) {
			cursor.line--;
			cursor.col = lines[cursor.line].length;
		}
	} else {
		if (cursor.col > 0) cursor.col--;
		else if (cursor.line > 0) {
			cursor.line--;
			cursor.col = lines[cursor.line].length;
		}
	}
}

/** Move cursor right. In word mode, skip to the end of the current word. */
export function moveCursorRight(
	lines: string[], cursor: Position, wordMode = false,
): void {
	const line = lines[cursor.line] ?? "";
	if (wordMode) {
		if (cursor.col < line.length) {
			let col = cursor.col;
			while (col < line.length && line[col] !== " ") col++;
			while (col < line.length && line[col] === " ") col++;
			cursor.col = col;
		} else if (cursor.line < lines.length - 1) {
			cursor.line++;
			cursor.col = 0;
		}
	} else {
		if (cursor.col < line.length) cursor.col++;
		else if (cursor.line < lines.length - 1) {
			cursor.line++;
			cursor.col = 0;
		}
	}
}

/** Move cursor up one line, clamping column. */
export function moveCursorUp(lines: string[], cursor: Position): void {
	if (cursor.line > 0) {
		cursor.line--;
		cursor.col = Math.min(cursor.col, lines[cursor.line].length);
	}
}

/** Move cursor down one line, clamping column. */
export function moveCursorDown(lines: string[], cursor: Position): void {
	if (cursor.line < lines.length - 1) {
		cursor.line++;
		cursor.col = Math.min(cursor.col, lines[cursor.line].length);
	}
}

/** Select (extend cursor) to the previous word boundary. */
export function selectWordLeft(lines: string[], cursor: Position): void {
	if (cursor.col > 0) {
		const line = lines[cursor.line] ?? "";
		let col = cursor.col - 1;
		while (col > 0 && /\s/.test(line[col])) col--;
		while (col > 0 && /\S/.test(line[col - 1])) col--;
		cursor.col = col;
	} else if (cursor.line > 0) {
		cursor.line--;
		cursor.col = lines[cursor.line].length;
	}
}

/** Select (extend cursor) to the next word boundary. */
export function selectWordRight(lines: string[], cursor: Position): void {
	const line = lines[cursor.line] ?? "";
	if (cursor.col < line.length) {
		let col = cursor.col;
		while (col < line.length && /\S/.test(line[col])) col++;
		while (col < line.length && /\s/.test(line[col])) col++;
		cursor.col = col;
	} else if (cursor.line < lines.length - 1) {
		cursor.line++;
		cursor.col = 0;
	}
}

// ─── Navigation Key Dispatch ─────────────────────────────────────────────────

/**
 * Handle navigation keys (arrows, home, end, page up/down).
 *
 * @returns true if the key was handled, false otherwise.
 */
export function handleNavigationKey(
	key: KeyEvent, lines: string[], cursor: Position,
): boolean {
	switch (key.name) {
		case "left":
			if (key.ctrl && key.shift) selectWordLeft(lines, cursor);
			else moveCursorLeft(lines, cursor, key.ctrl);
			return true;
		case "right":
			if (key.ctrl && key.shift) selectWordRight(lines, cursor);
			else moveCursorRight(lines, cursor, key.ctrl);
			return true;
		case "home":
			cursor.col = 0;
			return true;
		case "end":
			cursor.col = (lines[cursor.line] ?? "").length;
			return true;
		case "pageup":
			cursor.line = 0;
			cursor.col = Math.min(cursor.col, lines[0].length);
			return true;
		case "pagedown":
			cursor.line = lines.length - 1;
			cursor.col = Math.min(cursor.col, (lines[cursor.line] ?? "").length);
			return true;
		default:
			return false;
	}
}

// ─── Text Mutations ──────────────────────────────────────────────────────────

/** Insert a single character at the cursor position. */
export function insertChar(
	lines: string[], cursor: Position, ch: string,
): void {
	const line = lines[cursor.line] ?? "";
	lines[cursor.line] = line.slice(0, cursor.col) + ch + line.slice(cursor.col);
	cursor.col += ch.length;
}

/** Insert multi-line text at the cursor position. */
export function insertText(
	lines: string[], cursor: Position, text: string,
): void {
	const textLines = text.split("\n");
	if (textLines.length === 1) {
		insertChar(lines, cursor, textLines[0]);
		return;
	}

	const line = lines[cursor.line] ?? "";
	const before = line.slice(0, cursor.col);
	const after = line.slice(cursor.col);
	lines[cursor.line] = before + textLines[0];
	for (let i = 1; i < textLines.length - 1; i++) {
		lines.splice(cursor.line + i, 0, textLines[i]);
	}
	const lastPastedLine = textLines[textLines.length - 1];
	lines.splice(cursor.line + textLines.length - 1, 0, lastPastedLine + after);
	cursor.line += textLines.length - 1;
	cursor.col = lastPastedLine.length;
}

/** Insert a newline at the cursor position, splitting the current line. */
export function insertNewline(lines: string[], cursor: Position): void {
	const line = lines[cursor.line] ?? "";
	lines[cursor.line] = line.slice(0, cursor.col);
	lines.splice(cursor.line + 1, 0, line.slice(cursor.col));
	cursor.line++;
	cursor.col = 0;
}

/** Delete the character before the cursor (backspace). */
export function deleteBackward(lines: string[], cursor: Position): void {
	if (cursor.col > 0) {
		const line = lines[cursor.line] ?? "";
		lines[cursor.line] = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
		cursor.col--;
	} else if (cursor.line > 0) {
		const currentContent = lines[cursor.line] ?? "";
		lines.splice(cursor.line, 1);
		cursor.line--;
		cursor.col = lines[cursor.line].length;
		lines[cursor.line] += currentContent;
	}
}

/** Delete the character at the cursor (forward delete). */
export function deleteForward(lines: string[], cursor: Position): void {
	const line = lines[cursor.line] ?? "";
	if (cursor.col < line.length) {
		lines[cursor.line] = line.slice(0, cursor.col) + line.slice(cursor.col + 1);
	} else if (cursor.line < lines.length - 1) {
		lines[cursor.line] += lines[cursor.line + 1];
		lines.splice(cursor.line + 1, 1);
	}
}
