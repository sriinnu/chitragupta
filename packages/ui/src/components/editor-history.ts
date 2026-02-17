/**
 * @chitragupta/ui — Editor history navigation and undo/redo stack.
 *
 * Extracted from editor.ts to keep file sizes manageable.
 * Provides history navigation (up/down through past inputs),
 * undo/redo with snapshot debouncing, and bracket matching.
 */

import type { Position } from "./editor.js";

// ─── Undo/Redo Snapshot ─────────────────────────────────────────────────────

export interface EditorSnapshot {
	lines: string[];
	cursor: Position;
}

// ─── Bracket Pairs ──────────────────────────────────────────────────────────

export const BRACKET_PAIRS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
};

export const CLOSE_TO_OPEN: Record<string, string> = {
	")": "(",
	"]": "[",
	"}": "{",
};

// ─── History Manager ────────────────────────────────────────────────────────

/**
 * Manages input history navigation (up/down arrow through previous inputs).
 */
export class HistoryManager {
	private history: string[] = [];
	private historyIndex = -1;
	private historyMax: number;
	private historyDraft = "";

	constructor(maxEntries = 100) {
		this.historyMax = maxEntries;
	}

	/** Current history browsing index (-1 = not browsing) */
	get index(): number {
		return this.historyIndex;
	}

	/** Add an entry to input history */
	addEntry(entry: string): void {
		if (entry.trim().length === 0) return;
		// Avoid consecutive duplicates
		if (this.history.length > 0 && this.history[this.history.length - 1] === entry) return;
		this.history.push(entry);
		if (this.history.length > this.historyMax) {
			this.history.shift();
		}
		this.historyIndex = -1;
	}

	/** Get the full history array */
	getEntries(): string[] {
		return [...this.history];
	}

	/** Whether we have any history entries */
	get hasEntries(): boolean {
		return this.history.length > 0;
	}

	/** Whether we are currently browsing history */
	get isBrowsing(): boolean {
		return this.historyIndex >= 0;
	}

	/**
	 * Navigate through history.
	 * @param direction - negative = older, positive = newer
	 * @param currentValue - current editor text (saved as draft on first navigation)
	 * @returns The history entry text, or null if no navigation occurred
	 */
	navigate(direction: number, currentValue: string): string | null {
		if (direction < 0) {
			// Going back in history
			if (this.historyIndex < 0) {
				// Save current text as draft
				this.historyDraft = currentValue;
				this.historyIndex = this.history.length - 1;
			} else if (this.historyIndex > 0) {
				this.historyIndex--;
			} else {
				return null; // Already at oldest
			}
		} else {
			// Going forward in history
			if (this.historyIndex < 0) return null; // Not in history mode
			if (this.historyIndex < this.history.length - 1) {
				this.historyIndex++;
			} else {
				// Restore draft
				this.historyIndex = -1;
				return this.historyDraft;
			}
		}

		// Load history entry
		if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
			return this.history[this.historyIndex];
		}

		return null;
	}

	/** Reset browsing state */
	resetBrowsing(): void {
		this.historyIndex = -1;
	}
}

// ─── Undo/Redo Manager ─────────────────────────────────────────────────────

/**
 * Manages undo/redo stacks with snapshot debouncing.
 */
export class UndoRedoManager {
	private undoStack: EditorSnapshot[] = [];
	private redoStack: EditorSnapshot[] = [];
	private undoMax: number;
	private lastSnapshotTime = 0;

	constructor(maxSnapshots = 50) {
		this.undoMax = maxSnapshots;
	}

	/** Push a snapshot onto the undo stack (debounced at 300ms) */
	pushUndo(lines: string[], cursor: Position): void {
		const now = Date.now();
		// Debounce: don't push if less than 300ms since last push
		if (now - this.lastSnapshotTime < 300 && this.undoStack.length > 0) return;
		this.lastSnapshotTime = now;

		this.undoStack.push({
			lines: [...lines],
			cursor: { ...cursor },
		});
		if (this.undoStack.length > this.undoMax) {
			this.undoStack.shift();
		}
		// Clear redo stack on new edit
		this.redoStack = [];
	}

	/** Undo: pop from undo stack, push current state to redo */
	undo(currentLines: string[], currentCursor: Position): EditorSnapshot | null {
		if (this.undoStack.length === 0) return null;
		this.redoStack.push({
			lines: [...currentLines],
			cursor: { ...currentCursor },
		});
		return this.undoStack.pop()!;
	}

	/** Redo: pop from redo stack, push current state to undo */
	redo(currentLines: string[], currentCursor: Position): EditorSnapshot | null {
		if (this.redoStack.length === 0) return null;
		this.undoStack.push({
			lines: [...currentLines],
			cursor: { ...currentCursor },
		});
		return this.redoStack.pop()!;
	}
}

// ─── Bracket Matching ───────────────────────────────────────────────────────

/**
 * Find the matching bracket for the character at the given position.
 *
 * @returns The position of the matching bracket, or null if none found.
 */
export function findMatchingBracket(
	lines: string[],
	startLine: number,
	startCol: number,
	fromChar: string,
	toChar: string,
	direction: number,
): Position | null {
	let depth = 0;
	let line = startLine;
	let col = startCol;

	while (line >= 0 && line < lines.length) {
		const text = lines[line];
		while (col >= 0 && col < text.length) {
			const c = text[col];
			if (c === fromChar) depth++;
			if (c === toChar) depth--;

			if (depth === 0) {
				return { line, col };
			}

			col += direction;
		}

		line += direction;
		if (line >= 0 && line < lines.length) {
			col = direction > 0 ? 0 : lines[line].length - 1;
		}
	}

	return null;
}

/**
 * Update the bracket match for the current cursor position.
 *
 * @returns The matched bracket position, or null if none.
 */
export function updateBracketMatch(
	lines: string[],
	cursor: Position,
): Position | null {
	const line = lines[cursor.line] ?? "";
	if (cursor.col >= line.length) return null;

	const ch = line[cursor.col];

	if (BRACKET_PAIRS[ch]) {
		// Forward search for closing bracket
		return findMatchingBracket(
			lines,
			cursor.line,
			cursor.col,
			ch,
			BRACKET_PAIRS[ch],
			1,
		);
	} else if (CLOSE_TO_OPEN[ch]) {
		// Backward search for opening bracket
		return findMatchingBracket(
			lines,
			cursor.line,
			cursor.col,
			ch,
			CLOSE_TO_OPEN[ch],
			-1,
		);
	}

	return null;
}
