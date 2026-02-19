/**
 * Tests for editor navigation — cursor movement, word boundaries,
 * text insertion/deletion, and navigation key dispatch.
 */
import { describe, it, expect } from "vitest";
import {
	moveCursorLeft,
	moveCursorRight,
	moveCursorUp,
	moveCursorDown,
	selectWordLeft,
	selectWordRight,
	handleNavigationKey,
	insertChar,
	insertText,
	insertNewline,
	deleteBackward,
	deleteForward,
} from "../src/components/editor-navigation.js";
import type { Position } from "../src/components/editor.js";
import type { KeyEvent } from "../src/keys.js";

/** Helper to create a minimal KeyEvent */
function key(name: string, opts?: Partial<KeyEvent>): KeyEvent {
	return { name, ctrl: false, meta: false, shift: false, sequence: "", ...opts };
}

// ─── Cursor Movement ─────────────────────────────────────────────────────────

describe("moveCursorLeft", () => {
	it("moves left by one column", () => {
		const cursor: Position = { line: 0, col: 5 };
		moveCursorLeft(["hello"], cursor);
		expect(cursor.col).toBe(4);
	});

	it("wraps to end of previous line at col 0", () => {
		const cursor: Position = { line: 1, col: 0 };
		moveCursorLeft(["hello", "world"], cursor);
		expect(cursor.line).toBe(0);
		expect(cursor.col).toBe(5);
	});

	it("does nothing at start of first line", () => {
		const cursor: Position = { line: 0, col: 0 };
		moveCursorLeft(["hello"], cursor);
		expect(cursor).toEqual({ line: 0, col: 0 });
	});

	it("word mode skips to start of word", () => {
		const cursor: Position = { line: 0, col: 10 };
		moveCursorLeft(["hello world"], cursor, true);
		expect(cursor.col).toBe(6); // start of "world"
	});

	it("word mode wraps to previous line", () => {
		const cursor: Position = { line: 1, col: 0 };
		moveCursorLeft(["hello", "world"], cursor, true);
		expect(cursor.line).toBe(0);
		expect(cursor.col).toBe(5);
	});
});

describe("moveCursorRight", () => {
	it("moves right by one column", () => {
		const cursor: Position = { line: 0, col: 2 };
		moveCursorRight(["hello"], cursor);
		expect(cursor.col).toBe(3);
	});

	it("wraps to start of next line at end", () => {
		const cursor: Position = { line: 0, col: 5 };
		moveCursorRight(["hello", "world"], cursor);
		expect(cursor.line).toBe(1);
		expect(cursor.col).toBe(0);
	});

	it("does nothing at end of last line", () => {
		const cursor: Position = { line: 0, col: 5 };
		moveCursorRight(["hello"], cursor);
		expect(cursor).toEqual({ line: 0, col: 5 });
	});

	it("word mode skips to end of word", () => {
		const cursor: Position = { line: 0, col: 0 };
		moveCursorRight(["hello world"], cursor, true);
		expect(cursor.col).toBe(6); // after "hello " (at start of "world")
	});
});

describe("moveCursorUp", () => {
	it("moves up one line", () => {
		const cursor: Position = { line: 1, col: 3 };
		moveCursorUp(["hello", "world"], cursor);
		expect(cursor.line).toBe(0);
		expect(cursor.col).toBe(3);
	});

	it("clamps column to shorter line", () => {
		const cursor: Position = { line: 1, col: 10 };
		moveCursorUp(["hi", "longer line"], cursor);
		expect(cursor.col).toBe(2); // "hi".length
	});

	it("does nothing on first line", () => {
		const cursor: Position = { line: 0, col: 3 };
		moveCursorUp(["hello"], cursor);
		expect(cursor.line).toBe(0);
	});
});

describe("moveCursorDown", () => {
	it("moves down one line", () => {
		const cursor: Position = { line: 0, col: 3 };
		moveCursorDown(["hello", "world"], cursor);
		expect(cursor.line).toBe(1);
		expect(cursor.col).toBe(3);
	});

	it("clamps column to shorter line", () => {
		const cursor: Position = { line: 0, col: 10 };
		moveCursorDown(["longer line", "hi"], cursor);
		expect(cursor.col).toBe(2);
	});

	it("does nothing on last line", () => {
		const cursor: Position = { line: 0, col: 3 };
		moveCursorDown(["hello"], cursor);
		expect(cursor.line).toBe(0);
	});
});

// ─── Word Selection ──────────────────────────────────────────────────────────

describe("selectWordLeft", () => {
	it("moves to start of previous word", () => {
		const cursor: Position = { line: 0, col: 11 };
		selectWordLeft(["hello world"], cursor);
		expect(cursor.col).toBe(6);
	});

	it("wraps to previous line at col 0", () => {
		const cursor: Position = { line: 1, col: 0 };
		selectWordLeft(["abc", "def"], cursor);
		expect(cursor.line).toBe(0);
		expect(cursor.col).toBe(3);
	});
});

describe("selectWordRight", () => {
	it("moves to end of current word", () => {
		const cursor: Position = { line: 0, col: 0 };
		selectWordRight(["hello world"], cursor);
		expect(cursor.col).toBe(6); // past "hello "
	});

	it("wraps to next line at end", () => {
		const cursor: Position = { line: 0, col: 5 };
		selectWordRight(["hello", "world"], cursor);
		expect(cursor.line).toBe(1);
		expect(cursor.col).toBe(0);
	});
});

// ─── Navigation Key Dispatch ─────────────────────────────────────────────────

describe("handleNavigationKey", () => {
	it("handles left arrow", () => {
		const cursor: Position = { line: 0, col: 3 };
		expect(handleNavigationKey(key("left"), ["hello"], cursor)).toBe(true);
		expect(cursor.col).toBe(2);
	});

	it("handles right arrow", () => {
		const cursor: Position = { line: 0, col: 2 };
		expect(handleNavigationKey(key("right"), ["hello"], cursor)).toBe(true);
		expect(cursor.col).toBe(3);
	});

	it("handles home key", () => {
		const cursor: Position = { line: 0, col: 5 };
		expect(handleNavigationKey(key("home"), ["hello"], cursor)).toBe(true);
		expect(cursor.col).toBe(0);
	});

	it("handles end key", () => {
		const cursor: Position = { line: 0, col: 0 };
		expect(handleNavigationKey(key("end"), ["hello"], cursor)).toBe(true);
		expect(cursor.col).toBe(5);
	});

	it("handles pageup (jump to first line)", () => {
		const cursor: Position = { line: 2, col: 3 };
		expect(handleNavigationKey(key("pageup"), ["ab", "cd", "ef"], cursor)).toBe(true);
		expect(cursor.line).toBe(0);
		expect(cursor.col).toBe(2); // clamped to "ab".length
	});

	it("handles pagedown (jump to last line)", () => {
		const cursor: Position = { line: 0, col: 3 };
		expect(handleNavigationKey(key("pagedown"), ["abcde", "fg"], cursor)).toBe(true);
		expect(cursor.line).toBe(1);
		expect(cursor.col).toBe(2); // clamped to "fg".length
	});

	it("returns false for unhandled keys", () => {
		const cursor: Position = { line: 0, col: 0 };
		expect(handleNavigationKey(key("a"), ["text"], cursor)).toBe(false);
	});

	it("handles ctrl+shift+left for word select", () => {
		const cursor: Position = { line: 0, col: 11 };
		expect(handleNavigationKey(key("left", { ctrl: true, shift: true }), ["hello world"], cursor)).toBe(true);
		expect(cursor.col).toBe(6);
	});
});

// ─── Text Mutations ──────────────────────────────────────────────────────────

describe("insertChar", () => {
	it("inserts character at cursor", () => {
		const lines = ["helo"];
		const cursor: Position = { line: 0, col: 3 };
		insertChar(lines, cursor, "l");
		expect(lines[0]).toBe("hello");
		expect(cursor.col).toBe(4);
	});

	it("inserts at start of line", () => {
		const lines = ["world"];
		const cursor: Position = { line: 0, col: 0 };
		insertChar(lines, cursor, ">");
		expect(lines[0]).toBe(">world");
	});
});

describe("insertText", () => {
	it("inserts single-line text", () => {
		const lines = ["ab"];
		const cursor: Position = { line: 0, col: 1 };
		insertText(lines, cursor, "X");
		expect(lines[0]).toBe("aXb");
	});

	it("inserts multi-line text", () => {
		const lines = ["hello world"];
		const cursor: Position = { line: 0, col: 5 };
		insertText(lines, cursor, "\nbeautiful\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe("hello");
		expect(lines[1]).toBe("beautiful");
		expect(cursor.line).toBe(2);
	});
});

describe("insertNewline", () => {
	it("splits line at cursor", () => {
		const lines = ["hello world"];
		const cursor: Position = { line: 0, col: 5 };
		insertNewline(lines, cursor);
		expect(lines).toEqual(["hello", " world"]);
		expect(cursor.line).toBe(1);
		expect(cursor.col).toBe(0);
	});

	it("creates empty line when at end", () => {
		const lines = ["hello"];
		const cursor: Position = { line: 0, col: 5 };
		insertNewline(lines, cursor);
		expect(lines).toEqual(["hello", ""]);
	});
});

describe("deleteBackward", () => {
	it("deletes character before cursor", () => {
		const lines = ["hello"];
		const cursor: Position = { line: 0, col: 3 };
		deleteBackward(lines, cursor);
		expect(lines[0]).toBe("helo");
		expect(cursor.col).toBe(2);
	});

	it("merges with previous line at col 0", () => {
		const lines = ["hello", "world"];
		const cursor: Position = { line: 1, col: 0 };
		deleteBackward(lines, cursor);
		expect(lines).toEqual(["helloworld"]);
		expect(cursor.line).toBe(0);
		expect(cursor.col).toBe(5);
	});

	it("does nothing at start of first line", () => {
		const lines = ["hello"];
		const cursor: Position = { line: 0, col: 0 };
		deleteBackward(lines, cursor);
		expect(lines[0]).toBe("hello");
	});
});

describe("deleteForward", () => {
	it("deletes character at cursor", () => {
		const lines = ["hello"];
		const cursor: Position = { line: 0, col: 2 };
		deleteForward(lines, cursor);
		expect(lines[0]).toBe("helo");
		expect(cursor.col).toBe(2);
	});

	it("merges with next line at end of line", () => {
		const lines = ["hello", "world"];
		const cursor: Position = { line: 0, col: 5 };
		deleteForward(lines, cursor);
		expect(lines).toEqual(["helloworld"]);
	});

	it("does nothing at end of last line", () => {
		const lines = ["hello"];
		const cursor: Position = { line: 0, col: 5 };
		deleteForward(lines, cursor);
		expect(lines[0]).toBe("hello");
	});
});
