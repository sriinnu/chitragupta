/**
 * @chitragupta/ui — Keyboard input handler.
 *
 * Wraps process.stdin in raw mode and emits parsed KeyEvent objects.
 * Handles bracketed paste mode for multi-character paste detection.
 */

import { type KeyEvent, parseKeypress } from "./keys.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type KeyHandler = (key: KeyEvent) => void;
type LineHandler = (line: string) => void;

// ─── Bracketed Paste Markers ────────────────────────────────────────────────

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const ENABLE_BRACKETED_PASTE = "\x1b[?2004h";
const DISABLE_BRACKETED_PASTE = "\x1b[?2004l";

// ─── InputHandler ───────────────────────────────────────────────────────────

/**
 * Keyboard input handler for raw terminal mode.
 *
 * Wraps `process.stdin` in raw mode, parses incoming bytes into
 * {@link KeyEvent} objects, and supports bracketed paste detection.
 *
 * @example
 * ```ts
 * const input = new InputHandler();
 * input.onKey((key) => console.log(key.name));
 * input.start();
 * // ... later
 * input.stop();
 * ```
 */
export class InputHandler {
	private keyHandlers: KeyHandler[] = [];
	private lineHandlers: LineHandler[] = [];
	private running = false;
	private dataListener: ((data: Buffer) => void) | null = null;
	private pasteBuffer: string | null = null;
	private lineBuffer = "";

	/** Register a handler for individual key events */
	onKey(handler: KeyHandler): void {
		this.keyHandlers.push(handler);
	}

	/** Register a handler for complete line input (accumulates until Enter) */
	onLine(handler: LineHandler): void {
		this.lineHandlers.push(handler);
	}

	/** Remove a key handler */
	offKey(handler: KeyHandler): void {
		const idx = this.keyHandlers.indexOf(handler);
		if (idx !== -1) {
			this.keyHandlers.splice(idx, 1);
		}
	}

	/** Remove a line handler */
	offLine(handler: LineHandler): void {
		const idx = this.lineHandlers.indexOf(handler);
		if (idx !== -1) {
			this.lineHandlers.splice(idx, 1);
		}
	}

	/** Start listening to stdin in raw mode */
	start(): void {
		if (this.running) return;
		this.running = true;

		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();

		// Enable bracketed paste
		process.stdout.write(ENABLE_BRACKETED_PASTE);

		this.dataListener = (data: Buffer) => {
			this.handleData(data);
		};
		process.stdin.on("data", this.dataListener);
	}

	/** Stop listening and restore terminal */
	stop(): void {
		if (!this.running) return;
		this.running = false;

		// Disable bracketed paste
		process.stdout.write(DISABLE_BRACKETED_PASTE);

		if (this.dataListener) {
			process.stdin.off("data", this.dataListener);
			this.dataListener = null;
		}

		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		process.stdin.pause();
	}

	/** Whether the handler is currently active */
	get isRunning(): boolean {
		return this.running;
	}

	/** Clear all registered handlers */
	removeAllHandlers(): void {
		this.keyHandlers = [];
		this.lineHandlers = [];
	}

	private handleData(data: Buffer): void {
		const raw = data.toString("utf-8");

		// Check for paste start
		if (raw.includes(PASTE_START)) {
			this.pasteBuffer = "";
			const afterStart = raw.split(PASTE_START)[1] ?? "";
			if (afterStart.includes(PASTE_END)) {
				// Complete paste in single chunk
				this.pasteBuffer = afterStart.split(PASTE_END)[0] ?? "";
				this.emitPaste(this.pasteBuffer);
				this.pasteBuffer = null;
			} else {
				this.pasteBuffer = afterStart;
			}
			return;
		}

		// Accumulating paste data
		if (this.pasteBuffer !== null) {
			if (raw.includes(PASTE_END)) {
				this.pasteBuffer += raw.split(PASTE_END)[0] ?? "";
				this.emitPaste(this.pasteBuffer);
				this.pasteBuffer = null;
			} else {
				this.pasteBuffer += raw;
			}
			return;
		}

		// Normal key input — parse each byte/sequence
		const key = parseKeypress(data);
		this.emitKey(key);

		// Line buffer handling
		if (key.name === "return" && !key.ctrl && !key.meta) {
			if (this.lineBuffer.length > 0) {
				this.emitLine(this.lineBuffer);
				this.lineBuffer = "";
			}
		} else if (key.name === "backspace") {
			this.lineBuffer = this.lineBuffer.slice(0, -1);
		} else if (!key.ctrl && !key.meta && key.name.length === 1 && key.sequence.charCodeAt(0) >= 32) {
			this.lineBuffer += key.sequence;
		}
	}

	private emitKey(key: KeyEvent): void {
		for (const handler of this.keyHandlers) {
			handler(key);
		}
	}

	private emitLine(line: string): void {
		for (const handler of this.lineHandlers) {
			handler(line);
		}
	}

	private emitPaste(text: string): void {
		// Emit pasted content as a sequence of key events for each character,
		// or as a single "paste" meta-event
		const pasteKey: KeyEvent = {
			name: "paste",
			ctrl: false,
			meta: false,
			shift: false,
			sequence: text,
		};
		this.emitKey(pasteKey);

		// Also emit lines if the paste contains newlines
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.length > 0) {
				this.lineBuffer += line;
			}
		}
	}
}
