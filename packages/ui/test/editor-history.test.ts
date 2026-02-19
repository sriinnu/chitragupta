/**
 * Tests for HistoryManager, UndoRedoManager, bracket matching,
 * and bracket pair constants.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	BRACKET_PAIRS,
	CLOSE_TO_OPEN,
	HistoryManager,
	UndoRedoManager,
	findMatchingBracket,
	updateBracketMatch,
} from "../src/components/editor-history.js";
import type { Position } from "../src/components/editor.js";

// ─── Bracket Pair Constants ──────────────────────────────────────────────────

describe("BRACKET_PAIRS", () => {
	it("maps opening to closing brackets", () => {
		expect(BRACKET_PAIRS["("]).toBe(")");
		expect(BRACKET_PAIRS["["]).toBe("]");
		expect(BRACKET_PAIRS["{"]).toBe("}");
	});
});

describe("CLOSE_TO_OPEN", () => {
	it("maps closing to opening brackets", () => {
		expect(CLOSE_TO_OPEN[")"]).toBe("(");
		expect(CLOSE_TO_OPEN["]"]).toBe("[");
		expect(CLOSE_TO_OPEN["}"]).toBe("{");
	});
});

// ─── HistoryManager ──────────────────────────────────────────────────────────

describe("HistoryManager", () => {
	describe("construction", () => {
		it("starts with no entries", () => {
			const hm = new HistoryManager();
			expect(hm.hasEntries).toBe(false);
			expect(hm.isBrowsing).toBe(false);
			expect(hm.index).toBe(-1);
		});
	});

	describe("addEntry", () => {
		it("adds entries", () => {
			const hm = new HistoryManager();
			hm.addEntry("first");
			hm.addEntry("second");
			expect(hm.hasEntries).toBe(true);
			expect(hm.getEntries()).toEqual(["first", "second"]);
		});

		it("skips empty/whitespace entries", () => {
			const hm = new HistoryManager();
			hm.addEntry("  ");
			hm.addEntry("");
			expect(hm.hasEntries).toBe(false);
		});

		it("skips consecutive duplicates", () => {
			const hm = new HistoryManager();
			hm.addEntry("same");
			hm.addEntry("same");
			expect(hm.getEntries()).toEqual(["same"]);
		});

		it("respects max capacity", () => {
			const hm = new HistoryManager(3);
			hm.addEntry("a");
			hm.addEntry("b");
			hm.addEntry("c");
			hm.addEntry("d");
			expect(hm.getEntries()).toEqual(["b", "c", "d"]);
		});
	});

	describe("navigate", () => {
		it("navigates back to older entries", () => {
			const hm = new HistoryManager();
			hm.addEntry("first");
			hm.addEntry("second");
			const result = hm.navigate(-1, "current");
			expect(result).toBe("second"); // most recent
			expect(hm.isBrowsing).toBe(true);
		});

		it("navigates to oldest entry", () => {
			const hm = new HistoryManager();
			hm.addEntry("first");
			hm.addEntry("second");
			hm.navigate(-1, "current"); // second
			const result = hm.navigate(-1, "current"); // first
			expect(result).toBe("first");
		});

		it("returns null at oldest entry", () => {
			const hm = new HistoryManager();
			hm.addEntry("only");
			hm.navigate(-1, "current"); // only
			const result = hm.navigate(-1, "current"); // already at oldest
			expect(result).toBeNull();
		});

		it("navigates forward to restore draft", () => {
			const hm = new HistoryManager();
			hm.addEntry("old");
			hm.navigate(-1, "my draft"); // go to "old"
			const result = hm.navigate(1, "old"); // go forward = restore draft
			expect(result).toBe("my draft");
			expect(hm.isBrowsing).toBe(false);
		});

		it("returns null navigating forward when not browsing", () => {
			const hm = new HistoryManager();
			hm.addEntry("x");
			expect(hm.navigate(1, "current")).toBeNull();
		});
	});

	describe("resetBrowsing", () => {
		it("resets browsing state", () => {
			const hm = new HistoryManager();
			hm.addEntry("x");
			hm.navigate(-1, "draft");
			expect(hm.isBrowsing).toBe(true);
			hm.resetBrowsing();
			expect(hm.isBrowsing).toBe(false);
		});
	});
});

// ─── UndoRedoManager ─────────────────────────────────────────────────────────

describe("UndoRedoManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("pushUndo / undo", () => {
		it("pushes and undoes a snapshot", () => {
			const ur = new UndoRedoManager();
			const lines = ["hello"];
			const cursor: Position = { line: 0, col: 5 };
			ur.pushUndo(lines, cursor);

			vi.advanceTimersByTime(500); // past debounce

			const snapshot = ur.undo(["modified"], { line: 0, col: 8 });
			expect(snapshot).not.toBeNull();
			expect(snapshot!.lines).toEqual(["hello"]);
			expect(snapshot!.cursor).toEqual({ line: 0, col: 5 });
		});

		it("returns null when undo stack is empty", () => {
			const ur = new UndoRedoManager();
			expect(ur.undo(["text"], { line: 0, col: 0 })).toBeNull();
		});

		it("debounces rapid pushes (300ms)", () => {
			const ur = new UndoRedoManager();
			ur.pushUndo(["a"], { line: 0, col: 1 });
			ur.pushUndo(["b"], { line: 0, col: 1 }); // within 300ms, skipped
			// Only one snapshot on the stack
			const first = ur.undo(["c"], { line: 0, col: 1 });
			expect(first).not.toBeNull();
			const second = ur.undo(["d"], { line: 0, col: 1 });
			expect(second).toBeNull(); // no more snapshots
		});
	});

	describe("redo", () => {
		it("redoes after undo", () => {
			const ur = new UndoRedoManager();
			ur.pushUndo(["original"], { line: 0, col: 0 });
			vi.advanceTimersByTime(500);
			ur.undo(["modified"], { line: 0, col: 8 });
			const snapshot = ur.redo(["original"], { line: 0, col: 0 });
			expect(snapshot).not.toBeNull();
			expect(snapshot!.lines).toEqual(["modified"]);
		});

		it("returns null when redo stack is empty", () => {
			const ur = new UndoRedoManager();
			expect(ur.redo(["text"], { line: 0, col: 0 })).toBeNull();
		});

		it("clears redo stack on new push", () => {
			const ur = new UndoRedoManager();
			ur.pushUndo(["a"], { line: 0, col: 0 });
			vi.advanceTimersByTime(500);
			ur.undo(["b"], { line: 0, col: 0 });
			// Now push new edit — redo should clear
			ur.pushUndo(["c"], { line: 0, col: 0 });
			expect(ur.redo(["c"], { line: 0, col: 0 })).toBeNull();
		});
	});

	describe("capacity", () => {
		it("respects max snapshots", () => {
			const ur = new UndoRedoManager(2);
			ur.pushUndo(["a"], { line: 0, col: 0 });
			vi.advanceTimersByTime(500);
			ur.pushUndo(["b"], { line: 0, col: 0 });
			vi.advanceTimersByTime(500);
			ur.pushUndo(["c"], { line: 0, col: 0 });
			vi.advanceTimersByTime(500);
			// Should only have 2 snapshots
			const s1 = ur.undo(["d"], { line: 0, col: 0 });
			expect(s1).not.toBeNull();
			const s2 = ur.undo(["e"], { line: 0, col: 0 });
			expect(s2).not.toBeNull();
			const s3 = ur.undo(["f"], { line: 0, col: 0 });
			expect(s3).toBeNull();
		});
	});
});

// ─── findMatchingBracket ─────────────────────────────────────────────────────

describe("findMatchingBracket", () => {
	it("finds closing bracket forward", () => {
		const lines = ["(hello)"];
		const result = findMatchingBracket(lines, 0, 0, "(", ")", 1);
		expect(result).toEqual({ line: 0, col: 6 });
	});

	it("finds opening bracket backward", () => {
		const lines = ["(hello)"];
		const result = findMatchingBracket(lines, 0, 6, ")", "(", -1);
		expect(result).toEqual({ line: 0, col: 0 });
	});

	it("handles nested brackets", () => {
		const lines = ["((inner))"];
		const result = findMatchingBracket(lines, 0, 0, "(", ")", 1);
		expect(result).toEqual({ line: 0, col: 8 });
	});

	it("works across multiple lines", () => {
		const lines = ["(", "  hello", ")"];
		const result = findMatchingBracket(lines, 0, 0, "(", ")", 1);
		expect(result).toEqual({ line: 2, col: 0 });
	});

	it("returns null when no match found", () => {
		const lines = ["(unclosed"];
		const result = findMatchingBracket(lines, 0, 0, "(", ")", 1);
		expect(result).toBeNull();
	});
});

// ─── updateBracketMatch ──────────────────────────────────────────────────────

describe("updateBracketMatch", () => {
	it("finds match for opening bracket at cursor", () => {
		const lines = ["(hello)"];
		const result = updateBracketMatch(lines, { line: 0, col: 0 });
		expect(result).toEqual({ line: 0, col: 6 });
	});

	it("finds match for closing bracket at cursor", () => {
		const lines = ["(hello)"];
		const result = updateBracketMatch(lines, { line: 0, col: 6 });
		expect(result).toEqual({ line: 0, col: 0 });
	});

	it("returns null for non-bracket character", () => {
		const lines = ["hello"];
		const result = updateBracketMatch(lines, { line: 0, col: 2 });
		expect(result).toBeNull();
	});

	it("returns null when cursor is past end of line", () => {
		const lines = ["hi"];
		const result = updateBracketMatch(lines, { line: 0, col: 5 });
		expect(result).toBeNull();
	});

	it("matches curly braces", () => {
		const lines = ["{ x }"];
		const result = updateBracketMatch(lines, { line: 0, col: 0 });
		expect(result).toEqual({ line: 0, col: 4 });
	});

	it("matches square brackets", () => {
		const lines = ["[1, 2]"];
		const result = updateBracketMatch(lines, { line: 0, col: 0 });
		expect(result).toEqual({ line: 0, col: 5 });
	});
});
