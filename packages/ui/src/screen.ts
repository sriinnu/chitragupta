/**
 * @chitragupta/ui — Differential rendering engine.
 *
 * Maintains a double-buffered character grid and only writes changed cells
 * to stdout, minimizing terminal output for smooth, flicker-free rendering.
 */

import { clearScreen, cursorTo, hideCursor, showCursor } from "./ansi.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type ResizeHandler = (width: number, height: number) => void;

interface Cell {
	char: string;
	style: string;
}

// ─── Screen ─────────────────────────────────────────────────────────────────

/**
 * Double-buffered terminal rendering engine.
 *
 * Maintains two character grids (current and previous) and only writes
 * changed cells to stdout on each `render()` call, minimizing terminal
 * output for smooth, flicker-free rendering.
 *
 * @example
 * ```ts
 * const screen = new Screen();
 * screen.write(0, 0, "Hello");
 * screen.render();
 * screen.destroy();
 * ```
 */
export class Screen {
	private current: Cell[][];
	private previous: Cell[][];
	private resizeHandlers: ResizeHandler[] = [];
	private resizeListener: (() => void) | null = null;
	private _width: number;
	private _height: number;
	private dirty = true;
	private cursorVisible = true;

	constructor() {
		this._width = process.stdout.columns || 80;
		this._height = process.stdout.rows || 24;
		this.current = this.createGrid();
		this.previous = this.createGrid();
		this.setupResizeListener();
	}

	/** Terminal width in columns */
	get width(): number {
		return this._width;
	}

	/** Terminal height in rows */
	get height(): number {
		return this._height;
	}

	/** Write a string at position (x, y) into the current buffer */
	write(x: number, y: number, text: string): void {
		if (y < 0 || y >= this._height) return;

		// Parse text to separate style codes from visible characters
		const segments = this.parseStyledText(text);
		let col = x;
		let activeStyle = "";

		for (const segment of segments) {
			if (segment.isStyle) {
				activeStyle = segment.text;
			} else {
				for (const char of segment.text) {
					if (col >= 0 && col < this._width) {
						this.current[y][col] = { char, style: activeStyle };
					}
					col++;
				}
			}
		}
		this.dirty = true;
	}

	/** Write a full pre-styled line at a given row, handling ANSI codes correctly */
	writeLine(y: number, text: string): void {
		if (y < 0 || y >= this._height) return;

		// Clear the row first
		for (let x = 0; x < this._width; x++) {
			this.current[y][x] = { char: " ", style: "" };
		}

		const segments = this.parseStyledText(text);
		let col = 0;
		let activeStyle = "";

		for (const segment of segments) {
			if (segment.isStyle) {
				activeStyle = segment.text;
			} else {
				for (const char of segment.text) {
					if (col >= 0 && col < this._width) {
						this.current[y][col] = { char, style: activeStyle };
					}
					col++;
				}
			}
		}
		this.dirty = true;
	}

	/** Write multiple lines starting from row y */
	writeLines(y: number, lines: string[]): void {
		for (let i = 0; i < lines.length; i++) {
			this.writeLine(y + i, lines[i]);
		}
	}

	/** Flush changes to the terminal, only writing diff */
	render(): void {
		if (!this.dirty) return;

		const output: string[] = [];

		if (this.cursorVisible) {
			output.push(hideCursor());
		}

		for (let y = 0; y < this._height; y++) {
			let lineChanged = false;

			// Check if this line has any changes
			for (let x = 0; x < this._width; x++) {
				const curr = this.current[y][x];
				const prev = this.previous[y][x];
				if (curr.char !== prev.char || curr.style !== prev.style) {
					lineChanged = true;
					break;
				}
			}

			if (!lineChanged) continue;

			// Find the first and last changed column for minimal writes
			let firstChanged = -1;
			let lastChanged = -1;

			for (let x = 0; x < this._width; x++) {
				const curr = this.current[y][x];
				const prev = this.previous[y][x];
				if (curr.char !== prev.char || curr.style !== prev.style) {
					if (firstChanged === -1) firstChanged = x;
					lastChanged = x;
				}
			}

			if (firstChanged === -1) continue;

			// Move cursor to the start of changes on this line
			output.push(cursorTo(firstChanged + 1, y + 1));

			// Write from first to last changed character
			let lastStyle = "";
			for (let x = firstChanged; x <= lastChanged; x++) {
				const cell = this.current[y][x];
				if (cell.style !== lastStyle) {
					output.push("\x1b[0m"); // reset
					if (cell.style) {
						output.push(cell.style);
					}
					lastStyle = cell.style;
				}
				output.push(cell.char);
			}

			// Reset style at end of line segment
			if (lastStyle) {
				output.push("\x1b[0m");
			}
		}

		if (this.cursorVisible) {
			output.push(showCursor());
		}

		// Write all at once for minimal flicker
		if (output.length > 0) {
			process.stdout.write(output.join(""));
		}

		// Swap buffers: copy current to previous
		for (let y = 0; y < this._height; y++) {
			for (let x = 0; x < this._width; x++) {
				this.previous[y][x] = { ...this.current[y][x] };
			}
		}

		this.dirty = false;
	}

	/** Clear the current buffer (fill with spaces) */
	clear(): void {
		for (let y = 0; y < this._height; y++) {
			for (let x = 0; x < this._width; x++) {
				this.current[y][x] = { char: " ", style: "" };
			}
		}
		this.dirty = true;
	}

	/** Full clear — wipes the screen and resets both buffers */
	fullClear(): void {
		process.stdout.write(clearScreen());
		this.current = this.createGrid();
		this.previous = this.createGrid();
		this.dirty = true;
	}

	/** Register a resize handler */
	onResize(handler: ResizeHandler): void {
		this.resizeHandlers.push(handler);
	}

	/** Remove a resize handler */
	offResize(handler: ResizeHandler): void {
		const idx = this.resizeHandlers.indexOf(handler);
		if (idx !== -1) {
			this.resizeHandlers.splice(idx, 1);
		}
	}

	/** Set cursor visibility for render operations */
	setCursorVisible(visible: boolean): void {
		this.cursorVisible = visible;
		process.stdout.write(visible ? showCursor() : hideCursor());
	}

	/** Force a full redraw on next render() */
	invalidate(): void {
		// Reset previous buffer so every cell is considered changed
		for (let y = 0; y < this._height; y++) {
			for (let x = 0; x < this._width; x++) {
				this.previous[y][x] = { char: "\0", style: "\0" };
			}
		}
		this.dirty = true;
	}

	/** Clean up event listeners */
	destroy(): void {
		if (this.resizeListener) {
			process.stdout.off("resize", this.resizeListener);
			this.resizeListener = null;
		}
		this.resizeHandlers = [];
	}

	// ─── Internals ────────────────────────────────────────────────────────

	private createGrid(): Cell[][] {
		const grid: Cell[][] = [];
		for (let y = 0; y < this._height; y++) {
			const row: Cell[] = [];
			for (let x = 0; x < this._width; x++) {
				row.push({ char: " ", style: "" });
			}
			grid.push(row);
		}
		return grid;
	}

	private setupResizeListener(): void {
		this.resizeListener = () => {
			const newWidth = process.stdout.columns || 80;
			const newHeight = process.stdout.rows || 24;

			if (newWidth !== this._width || newHeight !== this._height) {
				this._width = newWidth;
				this._height = newHeight;
				this.current = this.createGrid();
				this.previous = this.createGrid();
				this.dirty = true;

				for (const handler of this.resizeHandlers) {
					handler(this._width, this._height);
				}
			}
		};
		process.stdout.on("resize", this.resizeListener);
	}

	/** Parse a string into segments of styled codes and visible text */
	private parseStyledText(text: string): Array<{ text: string; isStyle: boolean }> {
		const segments: Array<{ text: string; isStyle: boolean }> = [];
		// biome-ignore lint: complex regex needed for full ANSI parsing
		const re = /(\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\))/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		match = re.exec(text);
		while (match !== null) {
			// Text before this escape
			if (match.index > lastIndex) {
				segments.push({ text: text.slice(lastIndex, match.index), isStyle: false });
			}
			// The escape sequence itself
			segments.push({ text: match[0], isStyle: true });
			lastIndex = re.lastIndex;
			match = re.exec(text);
		}

		// Remaining text
		if (lastIndex < text.length) {
			segments.push({ text: text.slice(lastIndex), isStyle: false });
		}

		return segments;
	}
}
