/**
 * @chitragupta/ui — Key matching utilities for raw stdin parsing.
 *
 * Converts raw terminal input buffers into structured KeyEvent objects,
 * handling special keys, modifiers, and escape sequences.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Structured representation of a parsed key press.
 *
 * @example
 * ```ts
 * const key: KeyEvent = {
 *   name: "c",
 *   ctrl: true,
 *   meta: false,
 *   shift: false,
 *   sequence: "\x03",
 * };
 * ```
 */
export interface KeyEvent {
	/** Normalized key name (e.g. "a", "return", "up", "f1"). */
	name: string;
	/** Whether the Ctrl modifier was held. */
	ctrl: boolean;
	/** Whether the Alt/Meta modifier was held. */
	meta: boolean;
	/** Whether the Shift modifier was held. */
	shift: boolean;
	/** Raw byte sequence from stdin. */
	sequence: string;
}

// ─── Special Key Escape Sequences ───────────────────────────────────────────

const ESCAPE_SEQUENCES: Record<string, Partial<KeyEvent>> = {
	// Arrow keys
	"\x1b[A": { name: "up" },
	"\x1b[B": { name: "down" },
	"\x1b[C": { name: "right" },
	"\x1b[D": { name: "left" },

	// Arrow keys with modifiers (shift)
	"\x1b[1;2A": { name: "up", shift: true },
	"\x1b[1;2B": { name: "down", shift: true },
	"\x1b[1;2C": { name: "right", shift: true },
	"\x1b[1;2D": { name: "left", shift: true },

	// Arrow keys with ctrl
	"\x1b[1;5A": { name: "up", ctrl: true },
	"\x1b[1;5B": { name: "down", ctrl: true },
	"\x1b[1;5C": { name: "right", ctrl: true },
	"\x1b[1;5D": { name: "left", ctrl: true },

	// Navigation
	"\x1b[H": { name: "home" },
	"\x1b[F": { name: "end" },
	"\x1b[1~": { name: "home" },
	"\x1b[4~": { name: "end" },
	"\x1b[5~": { name: "pageup" },
	"\x1b[6~": { name: "pagedown" },

	// Editing
	"\x1b[2~": { name: "insert" },
	"\x1b[3~": { name: "delete" },

	// Function keys
	"\x1bOP": { name: "f1" },
	"\x1bOQ": { name: "f2" },
	"\x1bOR": { name: "f3" },
	"\x1bOS": { name: "f4" },
	"\x1b[15~": { name: "f5" },
	"\x1b[17~": { name: "f6" },
	"\x1b[18~": { name: "f7" },
	"\x1b[19~": { name: "f8" },
	"\x1b[20~": { name: "f9" },
	"\x1b[21~": { name: "f10" },
	"\x1b[23~": { name: "f11" },
	"\x1b[24~": { name: "f12" },
};

// ─── Ctrl Key Mapping ───────────────────────────────────────────────────────

/** Maps control character codes (0-31) to key names */
function ctrlKeyName(code: number): string {
	// Ctrl+A through Ctrl+Z map to 1-26
	if (code >= 1 && code <= 26) {
		return String.fromCharCode(code + 96); // 'a' through 'z'
	}
	return String.fromCharCode(code);
}

// ─── Parse ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw stdin buffer into a structured KeyEvent.
 *
 * Handles arrow keys, function keys, navigation keys, Ctrl/Alt/Shift
 * modifiers, and regular printable characters.
 *
 * @param data - Raw buffer from process.stdin.
 * @returns Parsed KeyEvent with name and modifier flags.
 */
export function parseKeypress(data: Buffer): KeyEvent {
	const sequence = data.toString("utf-8");
	const base: KeyEvent = {
		name: "",
		ctrl: false,
		meta: false,
		shift: false,
		sequence,
	};

	// Empty buffer
	if (sequence.length === 0) {
		return { ...base, name: "unknown" };
	}

	// Check known escape sequences first
	const known = ESCAPE_SEQUENCES[sequence];
	if (known) {
		return { ...base, ...known, name: known.name ?? "unknown" };
	}

	// Single character analysis
	const code = sequence.charCodeAt(0);

	// Enter (CR or LF)
	if (code === 13 || code === 10) {
		return { ...base, name: "return" };
	}

	// Tab
	if (code === 9) {
		return { ...base, name: "tab" };
	}

	// Backspace (127 = DEL in most terminals, 8 = BS)
	if (code === 127 || code === 8) {
		return { ...base, name: "backspace" };
	}

	// Escape key (bare ESC, single byte 0x1b)
	if (code === 0x1b && sequence.length === 1) {
		return { ...base, name: "escape" };
	}

	// Alt/Meta + key (ESC followed by a single character)
	if (code === 0x1b && sequence.length === 2) {
		const ch = sequence[1];
		const charCode = sequence.charCodeAt(1);

		// Alt+Enter
		if (charCode === 13) {
			return { ...base, name: "return", meta: true };
		}

		// Alt+letter
		if (ch >= "a" && ch <= "z") {
			return { ...base, name: ch, meta: true };
		}
		if (ch >= "A" && ch <= "Z") {
			return { ...base, name: ch.toLowerCase(), meta: true, shift: true };
		}

		return { ...base, name: ch, meta: true };
	}

	// Ctrl+key (control characters 0-31, excluding handled ones)
	if (code < 32 && code !== 0x1b) {
		const name = ctrlKeyName(code);
		return { ...base, name, ctrl: true };
	}

	// Shift+Tab (CSI Z)
	if (sequence === "\x1b[Z") {
		return { ...base, name: "tab", shift: true };
	}

	// Regular printable character
	if (sequence.length === 1 && code >= 32) {
		const ch = sequence;
		const isUpper = ch >= "A" && ch <= "Z";
		return {
			...base,
			name: ch,
			shift: isUpper,
		};
	}

	// Multi-byte UTF-8 character (emoji, etc.)
	if (code >= 128) {
		return { ...base, name: sequence };
	}

	// Unknown escape sequence
	return { ...base, name: "unknown" };
}

/**
 * Check if a KeyEvent matches a key combo string.
 *
 * Combo format: modifier parts joined with `+`, e.g. `"ctrl+c"`, `"shift+tab"`,
 * `"alt+a"`, `"ctrl+shift+z"`. Case-insensitive. `"enter"` is normalized to `"return"`.
 *
 * @param key - The KeyEvent to test.
 * @param combo - The key combination string to match against.
 * @returns True if the key event matches the combo.
 *
 * @example
 * ```ts
 * matchKey(key, "ctrl+c");     // Ctrl+C
 * matchKey(key, "shift+tab");  // Shift+Tab
 * matchKey(key, "enter");      // Enter key
 * ```
 */
export function matchKey(key: KeyEvent, combo: string): boolean {
	const parts = combo.toLowerCase().split("+");
	const keyName = parts.pop() ?? "";
	const wantCtrl = parts.includes("ctrl");
	const wantMeta = parts.includes("alt") || parts.includes("meta");
	const wantShift = parts.includes("shift");

	// Normalize key names
	const normalizedName = keyName === "enter" ? "return" : keyName;

	return (
		key.name === normalizedName &&
		key.ctrl === wantCtrl &&
		key.meta === wantMeta &&
		key.shift === wantShift
	);
}
