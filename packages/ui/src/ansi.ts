/**
 * @chitragupta/ui — ANSI escape code utilities for terminal rendering.
 *
 * Provides low-level primitives for colors, styles, cursor movement,
 * and screen manipulation using standard ANSI escape sequences.
 */

const ESC = "\x1b[";

// ─── Reset ──────────────────────────────────────────────────────────────────

/** ANSI reset escape sequence -- clears all styles. */
export const reset = `${ESC}0m`;

// ─── 256-Color Functions ────────────────────────────────────────────────────

/**
 * Set foreground to ANSI 256 color.
 * @param color - ANSI 256 color index (0-255).
 * @returns ANSI escape sequence string.
 */
export function fg(color: number): string {
	return `${ESC}38;5;${color}m`;
}

/**
 * Set background to ANSI 256 color.
 * @param color - ANSI 256 color index (0-255).
 * @returns ANSI escape sequence string.
 */
export function bg(color: number): string {
	return `${ESC}48;5;${color}m`;
}

/**
 * Set foreground to true-color RGB.
 * @param r - Red channel (0-255).
 * @param g - Green channel (0-255).
 * @param b - Blue channel (0-255).
 * @returns ANSI escape sequence string.
 */
export function rgb(r: number, g: number, b: number): string {
	return `${ESC}38;2;${r};${g};${b}m`;
}

/**
 * Set background to true-color RGB.
 * @param r - Red channel (0-255).
 * @param g - Green channel (0-255).
 * @param b - Blue channel (0-255).
 * @returns ANSI escape sequence string.
 */
export function bgRgb(r: number, g: number, b: number): string {
	return `${ESC}48;2;${r};${g};${b}m`;
}

// ─── Style Wrappers ─────────────────────────────────────────────────────────

/**
 * Wrap text in bold ANSI style.
 * @param s - Text to make bold.
 * @returns Bold-styled string with proper reset.
 */
export function bold(s: string): string {
	return `${ESC}1m${s}${ESC}22m`;
}

/**
 * Wrap text in dim (faint) ANSI style.
 * @param s - Text to dim.
 * @returns Dim-styled string with proper reset.
 */
export function dim(s: string): string {
	return `${ESC}2m${s}${ESC}22m`;
}

/**
 * Wrap text in italic ANSI style.
 * @param s - Text to italicize.
 * @returns Italic-styled string with proper reset.
 */
export function italic(s: string): string {
	return `${ESC}3m${s}${ESC}23m`;
}

/**
 * Wrap text in underline ANSI style.
 * @param s - Text to underline.
 * @returns Underlined string with proper reset.
 */
export function underline(s: string): string {
	return `${ESC}4m${s}${ESC}24m`;
}

/**
 * Wrap text in strikethrough ANSI style.
 * @param s - Text to strike through.
 * @returns Strikethrough string with proper reset.
 */
export function strikethrough(s: string): string {
	return `${ESC}9m${s}${ESC}29m`;
}

// ─── Named Color Presets ────────────────────────────────────────────────────

/** Wrap text in red foreground color. @param s - Text to colorize. */
export function red(s: string): string {
	return `${ESC}31m${s}${reset}`;
}

/** Wrap text in green foreground color. @param s - Text to colorize. */
export function green(s: string): string {
	return `${ESC}32m${s}${reset}`;
}

/** Wrap text in yellow foreground color. @param s - Text to colorize. */
export function yellow(s: string): string {
	return `${ESC}33m${s}${reset}`;
}

/** Wrap text in blue foreground color. @param s - Text to colorize. */
export function blue(s: string): string {
	return `${ESC}34m${s}${reset}`;
}

/** Wrap text in magenta foreground color. @param s - Text to colorize. */
export function magenta(s: string): string {
	return `${ESC}35m${s}${reset}`;
}

/** Wrap text in cyan foreground color. @param s - Text to colorize. */
export function cyan(s: string): string {
	return `${ESC}36m${s}${reset}`;
}

/** Wrap text in white foreground color. @param s - Text to colorize. */
export function white(s: string): string {
	return `${ESC}37m${s}${reset}`;
}

/** Wrap text in gray (bright black) foreground color. @param s - Text to colorize. */
export function gray(s: string): string {
	return `${ESC}90m${s}${reset}`;
}

// ─── ANSI Stripping ─────────────────────────────────────────────────────────

// biome-ignore lint: complex regex needed for full ANSI stripping
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

/** Remove all ANSI escape sequences from a string */
export function stripAnsi(s: string): string {
	return s.replace(ANSI_RE, "");
}

/** Get visible length of a string (excluding ANSI codes) */
export function visibleLength(s: string): number {
	return stripAnsi(s).length;
}

// ─── Cursor Movement ────────────────────────────────────────────────────────

/**
 * Move cursor up by n rows.
 * @param n - Number of rows to move (default 1).
 */
export function cursorUp(n = 1): string {
	return `${ESC}${n}A`;
}

/**
 * Move cursor down by n rows.
 * @param n - Number of rows to move (default 1).
 */
export function cursorDown(n = 1): string {
	return `${ESC}${n}B`;
}

/**
 * Move cursor forward (right) by n columns.
 * @param n - Number of columns to move (default 1).
 */
export function cursorForward(n = 1): string {
	return `${ESC}${n}C`;
}

/**
 * Move cursor backward (left) by n columns.
 * @param n - Number of columns to move (default 1).
 */
export function cursorBack(n = 1): string {
	return `${ESC}${n}D`;
}

/** Move cursor to absolute position (1-based) */
export function cursorTo(x: number, y?: number): string {
	if (y === undefined) {
		return `${ESC}${x}G`;
	}
	return `${ESC}${y};${x}H`;
}

/** Save the current cursor position. */
export function saveCursor(): string {
	return `${ESC}s`;
}

/** Restore the previously saved cursor position. */
export function restoreCursor(): string {
	return `${ESC}u`;
}

// ─── Screen Control ─────────────────────────────────────────────────────────

/** Clear the entire screen and move cursor to home position. */
export function clearScreen(): string {
	return `${ESC}2J${ESC}H`;
}

/** Clear the entire current line. */
export function clearLine(): string {
	return `${ESC}2K`;
}

/** Clear from cursor position to the bottom of the screen. */
export function clearDown(): string {
	return `${ESC}J`;
}

/** Hide the terminal cursor. */
export function hideCursor(): string {
	return `${ESC}?25l`;
}

/** Show the terminal cursor. */
export function showCursor(): string {
	return `${ESC}?25h`;
}

/** Switch to the alternate screen buffer. */
export function alternateScreen(): string {
	return `${ESC}?1049h`;
}

/** Switch back to the main screen buffer. */
export function mainScreen(): string {
	return `${ESC}?1049l`;
}
