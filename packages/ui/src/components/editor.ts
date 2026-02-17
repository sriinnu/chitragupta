/**
 * @chitragupta/ui -- Multi-line text editor component.
 *
 * Provides a keyboard-driven text editing experience with cursor navigation,
 * multi-line support (Alt+Enter / Shift+Enter for newlines), history navigation,
 * tab completion, undo/redo, bracket matching, and line wrapping display.
 */

import { dim, gray, reset } from "../ansi.js";
import type { KeyEvent } from "../keys.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";
import {
	HistoryManager,
	UndoRedoManager,
	updateBracketMatch,
} from "./editor-history.js";
import {
	CompletionManager,
	applyCompletion,
	renderCompletionMenu,
} from "./editor-completion.js";
import {
	deleteBackward,
	deleteForward,
	handleNavigationKey,
	insertChar,
	insertNewline,
	insertText,
	moveCursorDown,
	moveCursorUp,
} from "./editor-navigation.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Position {
	line: number;
	col: number;
}

export type PromptMode = "normal" | "multi-line" | "command";

export interface EditorStats {
	chars: number;
	tokens: number;
	lines: number;
	words: number;
}

type SubmitHandler = (text: string) => void;
type CancelHandler = () => void;
type ChangeHandler = (text: string) => void;

/** A completion provider returns suggestions given the current text and cursor position */
export interface CompletionProvider {
	provide(text: string, cursor: Position): CompletionItem[];
}

export interface CompletionItem {
	label: string;
	insertText: string;
	description?: string;
}

// ─── Editor ─────────────────────────────────────────────────────────────────

export class Editor {
	private lines: string[] = [""];
	private cursor: Position = { line: 0, col: 0 };
	private submitHandlers: SubmitHandler[] = [];
	private cancelHandlers: CancelHandler[] = [];
	private changeHandlers: ChangeHandler[] = [];
	private scrollOffset = 0;
	private theme: Theme;
	private placeholder: string;

	// Delegates
	private historyMgr = new HistoryManager(100);
	private undoRedoMgr = new UndoRedoManager(50);
	private completionMgr = new CompletionManager();

	// Bracket matching
	private matchedBracket: Position | null = null;

	// Line wrapping
	private displayWidth = 80;

	// Prompt mode indicator
	private _promptMode: PromptMode = "normal";

	constructor(opts?: { theme?: Theme; initialValue?: string; placeholder?: string }) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.placeholder = opts?.placeholder ?? "";
		if (opts?.initialValue) {
			this.lines = opts.initialValue.split("\n");
			this.cursor = {
				line: this.lines.length - 1,
				col: this.lines[this.lines.length - 1].length,
			};
		}
	}

	/** Current editor content */
	get value(): string { return this.lines.join("\n"); }

	/** Set editor content programmatically */
	set value(text: string) {
		this.undoRedoMgr.pushUndo(this.lines, this.cursor);
		this.lines = text.split("\n");
		this.cursor = {
			line: this.lines.length - 1,
			col: this.lines[this.lines.length - 1].length,
		};
		this.emitChange();
	}

	/** Current cursor position */
	get cursorPos(): Position { return { ...this.cursor }; }

	/** Whether the editor has content */
	get isEmpty(): boolean { return this.lines.length === 1 && this.lines[0].length === 0; }

	/** Current prompt mode indicator */
	get promptMode(): PromptMode { return this._promptMode; }

	/** Set the prompt mode */
	set promptMode(mode: PromptMode) { this._promptMode = mode; }

	/**
	 * Get character, token, line, and word statistics for the current content.
	 * Token estimation uses ceil(chars / 4) as an approximation.
	 */
	getStats(): EditorStats {
		const text = this.value;
		const chars = text.length;
		const lines = this.lines.length;
		const words = text.trim().length === 0
			? 0
			: text.trim().split(/\s+/).length;
		const tokens = Math.ceil(chars / 4);
		return { chars, tokens, lines, words };
	}

	/** Register a submit handler (called on Enter) */
	onSubmit(handler: SubmitHandler): void { this.submitHandlers.push(handler); }

	/** Register a cancel handler (called on Ctrl+C) */
	onCancel(handler: CancelHandler): void { this.cancelHandlers.push(handler); }

	/** Register a change handler */
	onChange(handler: ChangeHandler): void { this.changeHandlers.push(handler); }

	// ─── History ────────────────────────────────────────────────────────

	/** Add an entry to input history */
	addHistory(entry: string): void { this.historyMgr.addEntry(entry); }

	/** Get the full history array */
	getHistory(): string[] { return this.historyMgr.getEntries(); }

	// ─── Tab Completion ─────────────────────────────────────────────────

	/** Register a completion provider */
	registerCompletion(provider: CompletionProvider): void { this.completionMgr.registerProvider(provider); }

	/** Remove a completion provider */
	unregisterCompletion(provider: CompletionProvider): void { this.completionMgr.unregisterProvider(provider); }

	/** Whether completion menu is currently shown */
	get isCompletionActive(): boolean { return this.completionMgr.isActive; }

	/** Currently visible completion items */
	get completions(): CompletionItem[] { return this.completionMgr.currentItems; }

	/** Current completion selection index */
	get completionSelectedIndex(): number { return this.completionMgr.selectedIndex; }

	// ─── Undo / Redo ────────────────────────────────────────────────────

	/** Undo the last change */
	undo(): void {
		const snapshot = this.undoRedoMgr.undo(this.lines, this.cursor);
		if (!snapshot) return;
		this.lines = [...snapshot.lines];
		this.cursor = { ...snapshot.cursor };
		this.emitChange();
	}

	/** Redo the last undone change */
	redo(): void {
		const snapshot = this.undoRedoMgr.redo(this.lines, this.cursor);
		if (!snapshot) return;
		this.lines = [...snapshot.lines];
		this.cursor = { ...snapshot.cursor };
		this.emitChange();
	}

	// ─── Bracket Matching ───────────────────────────────────────────────

	/** Get the position of the matching bracket for the cursor, if any */
	get matchingBracket(): Position | null {
		return this.matchedBracket ? { ...this.matchedBracket } : null;
	}

	// ─── Key Handler ────────────────────────────────────────────────────

	/** Process a key event */
	handleKey(key: KeyEvent): void {
		// Completion interaction
		if (this.completionMgr.isActive) {
			if (key.name === "tab" && !key.shift) { this.completionMgr.cycleForward(); return; }
			if (key.name === "tab" && key.shift) { this.completionMgr.cycleBackward(); return; }
			if (key.name === "return" && !key.ctrl && !key.meta && !key.shift) { this.acceptCompletion(); return; }
			if (key.name === "escape") { this.completionMgr.dismiss(); return; }
		}

		// Submit: Enter (no modifiers)
		if (key.name === "return" && !key.ctrl && !key.meta && !key.shift) {
			const text = this.value;
			this.historyMgr.addEntry(text);
			for (const handler of this.submitHandlers) handler(text);
			return;
		}

		// New line: Shift+Enter or Alt+Enter
		if (key.name === "return" && (key.shift || key.meta)) {
			this.pushUndo();
			insertNewline(this.lines, this.cursor);
			this.emitChange();
			return;
		}

		// Cancel: Ctrl+C
		if (key.name === "c" && key.ctrl) {
			for (const handler of this.cancelHandlers) handler();
			return;
		}

		// Undo: Ctrl+Z
		if (key.name === "z" && key.ctrl && !key.shift) { this.undo(); return; }

		// Redo: Ctrl+Shift+Z or Ctrl+Y
		if ((key.name === "z" && key.ctrl && key.shift) || (key.name === "y" && key.ctrl)) { this.redo(); return; }

		// History: Up arrow when on first line (or single line)
		if (key.name === "up" && !key.ctrl && !key.meta && !key.shift) {
			if (this.cursor.line === 0 && this.lines.length === 1 && this.historyMgr.hasEntries) {
				this.navigateHistory(-1); return;
			}
			moveCursorUp(this.lines, this.cursor);
			this.refreshBracketMatch();
			return;
		}

		// History: Down arrow when on last line (or single line)
		if (key.name === "down" && !key.ctrl && !key.meta && !key.shift) {
			if (this.cursor.line === this.lines.length - 1 && this.lines.length === 1 && this.historyMgr.isBrowsing) {
				this.navigateHistory(1); return;
			}
			moveCursorDown(this.lines, this.cursor);
			this.refreshBracketMatch();
			return;
		}

		// Tab: trigger completion (when not already active)
		if (key.name === "tab" && !key.shift && !key.ctrl && !key.meta) {
			if (!this.completionMgr.isActive) { this.triggerCompletion(); return; }
		}

		// Paste event
		if (key.name === "paste") {
			this.pushUndo();
			insertText(this.lines, this.cursor, key.sequence);
			this.emitChange();
			return;
		}

		// Navigation
		if (handleNavigationKey(key, this.lines, this.cursor)) { this.refreshBracketMatch(); return; }

		// Deletion
		if (key.name === "backspace") {
			this.pushUndo(); deleteBackward(this.lines, this.cursor); this.emitChange(); this.refreshBracketMatch(); return;
		}
		if (key.name === "delete") {
			this.pushUndo(); deleteForward(this.lines, this.cursor); this.emitChange(); this.refreshBracketMatch(); return;
		}

		// Ctrl+A: move to beginning
		if (key.name === "a" && key.ctrl) { this.cursor.line = 0; this.cursor.col = 0; this.refreshBracketMatch(); return; }
		// Ctrl+E: move to end of line
		if (key.name === "e" && key.ctrl) { this.cursor.col = this.currentLine.length; this.refreshBracketMatch(); return; }
		// Ctrl+K: delete to end of line
		if (key.name === "k" && key.ctrl) {
			this.pushUndo();
			this.lines[this.cursor.line] = this.currentLine.slice(0, this.cursor.col);
			this.emitChange(); return;
		}
		// Ctrl+U: delete to beginning of line
		if (key.name === "u" && key.ctrl) {
			this.pushUndo();
			this.lines[this.cursor.line] = this.currentLine.slice(this.cursor.col);
			this.cursor.col = 0; this.emitChange(); return;
		}

		// Regular character input
		if (!key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence.charCodeAt(0) >= 32) {
			this.pushUndo(); insertChar(this.lines, this.cursor, key.sequence);
			this.emitChange(); this.refreshBracketMatch(); this.completionMgr.dismiss(); return;
		}
		// Multi-byte characters (e.g. emoji)
		if (!key.ctrl && !key.meta && key.name.length > 1 && key.sequence.charCodeAt(0) >= 128) {
			this.pushUndo(); insertChar(this.lines, this.cursor, key.sequence);
			this.emitChange(); this.refreshBracketMatch(); this.completionMgr.dismiss();
		}
	}

	/** Render the editor for display */
	render(width: number): string[] {
		this.displayWidth = width;
		const output: string[] = [];
		const promptColor = hexToAnsi(this.theme.colors.primary);
		const lineNumColor = hexToAnsi(this.theme.colors.muted);
		const cursorStyle = "\x1b[7m";
		const cursorReset = "\x1b[27m";
		const bracketHighlight = "\x1b[1m\x1b[33m";
		const bracketReset = "\x1b[22m\x1b[39m";

		// Show placeholder if empty
		if (this.isEmpty && this.historyMgr.index < 0) {
			output.push(`${promptColor}${this.theme.symbols.prompt}${reset} ${dim(this.placeholder)}${cursorStyle} ${cursorReset}`);
			if (this.completionMgr.isActive && this.completionMgr.currentItems.length > 0) {
				renderCompletionMenu(output, this.completionMgr.currentItems, this.completionMgr.selectedIndex, this.theme);
			}
			return output;
		}

		const isMultiline = this.lines.length > 1;
		const gutterWidth = isMultiline ? String(this.lines.length).length + 1 : 0;
		const contentWidth = width - gutterWidth - 3;

		for (let i = 0; i < this.lines.length; i++) {
			const line = this.lines[i];
			const wrappedRows = this.wrapLine(line, contentWidth);

			for (let rowIdx = 0; rowIdx < wrappedRows.length; rowIdx++) {
				const rowText = wrappedRows[rowIdx];
				const rowOffset = wrappedRows.slice(0, rowIdx).reduce((sum, r) => sum + r.length, 0);
				const prefix = this.buildLinePrefix(i, rowIdx, isMultiline, gutterWidth, promptColor, lineNumColor);
				const isCursorLine = i === this.cursor.line;
				const cursorInRow = isCursorLine && this.cursor.col >= rowOffset && this.cursor.col <= rowOffset + rowText.length;
				const isBracketLine = this.matchedBracket !== null && this.matchedBracket.line === i;
				const bracketInRow = isBracketLine && this.matchedBracket!.col >= rowOffset && this.matchedBracket!.col < rowOffset + rowText.length;

				if (cursorInRow || bracketInRow) {
					let renderedRow = "";
					for (let c = 0; c < rowText.length; c++) {
						const absCol = rowOffset + c;
						if (isCursorLine && absCol === this.cursor.col) {
							renderedRow += `${cursorStyle}${rowText[c]}${cursorReset}`;
						} else if (isBracketLine && absCol === this.matchedBracket!.col) {
							renderedRow += `${bracketHighlight}${rowText[c]}${bracketReset}`;
						} else {
							renderedRow += rowText[c];
						}
					}
					if (isCursorLine && this.cursor.col === rowOffset + rowText.length && rowIdx === wrappedRows.length - 1) {
						renderedRow += `${cursorStyle} ${cursorReset}`;
					}
					output.push(`${prefix}${renderedRow}`);
				} else {
					output.push(`${prefix}${rowText}`);
				}
			}
		}

		if (isMultiline) {
			output.push(gray("  Alt+Enter: newline | Enter: submit | Ctrl+C: cancel"));
		}
		if (this.completionMgr.isActive && this.completionMgr.currentItems.length > 0) {
			renderCompletionMenu(output, this.completionMgr.currentItems, this.completionMgr.selectedIndex, this.theme);
		}
		return output;
	}

	/** Clear the editor content */
	clear(): void {
		this.pushUndo();
		this.lines = [""];
		this.cursor = { line: 0, col: 0 };
		this.scrollOffset = 0;
		this.matchedBracket = null;
		this.completionMgr.dismiss();
		this.emitChange();
	}

	// ─── Internal ───────────────────────────────────────────────────────

	private get currentLine(): string { return this.lines[this.cursor.line] ?? ""; }

	private pushUndo(): void { this.undoRedoMgr.pushUndo(this.lines, this.cursor); }

	private refreshBracketMatch(): void { this.matchedBracket = updateBracketMatch(this.lines, this.cursor); }

	private navigateHistory(direction: number): void {
		const entry = this.historyMgr.navigate(direction, this.value);
		if (entry === null) return;
		this.lines = entry.split("\n");
		this.cursor = {
			line: this.lines.length - 1,
			col: this.lines[this.lines.length - 1].length,
		};
		this.emitChange();
	}

	private triggerCompletion(): void {
		const found = this.completionMgr.trigger(this.value, { ...this.cursor });
		if (!found) { this.pushUndo(); insertChar(this.lines, this.cursor, "\t"); this.emitChange(); }
	}

	private acceptCompletion(): void {
		const item = this.completionMgr.accept();
		if (!item) return;
		this.pushUndo();
		const { newLine, newCol } = applyCompletion(this.lines, this.cursor.line, this.cursor.col, item);
		this.lines[this.cursor.line] = newLine;
		this.cursor.col = newCol;
		this.emitChange();
	}

	private buildLinePrefix(
		lineIdx: number, rowIdx: number, isMultiline: boolean,
		gutterWidth: number, promptColor: string, lineNumColor: string,
	): string {
		if (lineIdx === 0 && rowIdx === 0) {
			if (isMultiline) {
				const num = String(lineIdx + 1).padStart(gutterWidth);
				return `${promptColor}${this.theme.symbols.prompt}${reset} ${lineNumColor}${num}${reset} `;
			}
			return `${promptColor}${this.theme.symbols.prompt}${reset} `;
		}
		if (rowIdx === 0) {
			const num = String(lineIdx + 1).padStart(gutterWidth);
			return `  ${lineNumColor}${num}${reset} `;
		}
		const wrapIndicator = dim("\u2937 ");
		if (isMultiline) return `  ${" ".repeat(gutterWidth)} ${wrapIndicator}`;
		return `  ${wrapIndicator}`;
	}

	private wrapLine(line: string, maxWidth: number): string[] {
		if (maxWidth <= 0 || line.length <= maxWidth) return [line];
		const rows: string[] = [];
		let pos = 0;
		while (pos < line.length) {
			rows.push(line.slice(pos, pos + maxWidth));
			pos += maxWidth;
		}
		return rows;
	}

	private emitChange(): void {
		const text = this.value;
		for (const handler of this.changeHandlers) handler(text);
	}
}
