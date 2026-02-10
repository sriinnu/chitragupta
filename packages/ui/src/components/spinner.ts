/**
 * @chitragupta/ui — Animated spinner component.
 *
 * Renders an animated spinner with an optional message, driven by the
 * current theme's spinner frames. Manages cursor visibility and cleanup.
 */

import { clearLine, cursorTo, hideCursor, reset, showCursor } from "../ansi.js";
import { DEFAULT_THEME, type Theme, hexToAnsi } from "../theme.js";

// ─── Spinner ────────────────────────────────────────────────────────────────

export class Spinner {
	private theme: Theme;
	private frameIndex = 0;
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private message = "";
	private running = false;
	private intervalMs: number;

	constructor(opts?: { theme?: Theme; interval?: number }) {
		this.theme = opts?.theme ?? DEFAULT_THEME;
		this.intervalMs = opts?.interval ?? 80;
	}

	/** Start the spinner with an optional message */
	start(message?: string): void {
		if (this.running) return;
		this.running = true;
		this.message = message ?? "";
		this.frameIndex = 0;

		process.stdout.write(hideCursor());
		this.drawFrame();

		this.intervalId = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % this.theme.symbols.spinner.length;
			this.drawFrame();
		}, this.intervalMs);
	}

	/** Stop the spinner and optionally display a final message */
	stop(finalMessage?: string): void {
		if (!this.running) return;
		this.running = false;

		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		// Clear the spinner line
		process.stdout.write(cursorTo(1) + clearLine());

		if (finalMessage !== undefined) {
			const color = hexToAnsi(this.theme.colors.success);
			const symbol = this.theme.symbols.success;
			process.stdout.write(`${color}${symbol}${reset} ${finalMessage}\n`);
		}

		process.stdout.write(showCursor());
	}

	/** Update the spinner message while it's running */
	update(message: string): void {
		this.message = message;
		if (this.running) {
			this.drawFrame();
		}
	}

	/** Check if the spinner is currently animating */
	get isRunning(): boolean {
		return this.running;
	}

	/** Stop with an error message */
	fail(message?: string): void {
		if (!this.running) return;
		this.running = false;

		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		process.stdout.write(cursorTo(1) + clearLine());

		if (message !== undefined) {
			const color = hexToAnsi(this.theme.colors.error);
			const symbol = this.theme.symbols.error;
			process.stdout.write(`${color}${symbol}${reset} ${message}\n`);
		}

		process.stdout.write(showCursor());
	}

	/** Stop with a warning message */
	warn(message?: string): void {
		if (!this.running) return;
		this.running = false;

		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		process.stdout.write(cursorTo(1) + clearLine());

		if (message !== undefined) {
			const color = hexToAnsi(this.theme.colors.warning);
			const symbol = this.theme.symbols.warning;
			process.stdout.write(`${color}${symbol}${reset} ${message}\n`);
		}

		process.stdout.write(showCursor());
	}

	private drawFrame(): void {
		const frames = this.theme.symbols.spinner;
		const frame = frames[this.frameIndex % frames.length];
		const color = hexToAnsi(this.theme.colors.primary);
		const line = `${color}${frame}${reset} ${this.message}`;
		process.stdout.write(cursorTo(1) + clearLine() + line);
	}
}
