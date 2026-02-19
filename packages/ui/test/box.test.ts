/**
 * Tests for box layout primitives: box(), horizontalLayout(), center(), truncate(), padRight(), padLeft().
 */
import { describe, it, expect } from "vitest";
import { stripAnsi, visibleLength } from "../src/ansi.js";
import {
	box,
	horizontalLayout,
	center,
	truncate,
	padRight,
	padLeft,
} from "../src/components/box.js";

// ─── box() ───────────────────────────────────────────────────────────────────

describe("box", () => {
	describe("rendering", () => {
		it("renders bordered box with content", () => {
			const result = box(["hello"], 20);
			expect(result).toHaveLength(3); // top border + content + bottom border
			const stripped = result.map(stripAnsi);
			expect(stripped[0]).toContain("┌");
			expect(stripped[0]).toContain("┐");
			expect(stripped[1]).toContain("│");
			expect(stripped[1]).toContain("hello");
			expect(stripped[2]).toContain("└");
			expect(stripped[2]).toContain("┘");
		});

		it("renders box without border when border=false", () => {
			const result = box(["hello"], 20, { border: false });
			expect(result).toHaveLength(1);
			expect(stripAnsi(result[0])).toBe("hello");
		});

		it("applies padding inside borders", () => {
			const result = box(["text"], 20, { padding: 1 });
			// top border, 1 padding line, content, 1 padding line, bottom border
			expect(result).toHaveLength(5);
			const stripped = result.map(stripAnsi);
			// Padding lines are empty between borders
			expect(stripped[1]).toMatch(/│\s+│/);
			expect(stripped[3]).toMatch(/│\s+│/);
		});

		it("renders title in top border", () => {
			const result = box(["content"], 30, { title: "Title" });
			const topStripped = stripAnsi(result[0]);
			expect(topStripped).toContain("Title");
			expect(topStripped).toContain("┌");
			expect(topStripped).toContain("┐");
		});

		it("uses double border style", () => {
			const result = box(["text"], 20, { borderStyle: "double" });
			const stripped = result.map(stripAnsi);
			expect(stripped[0]).toContain("╔");
			expect(stripped[0]).toContain("╗");
			expect(stripped[1]).toContain("║");
			expect(stripped[2]).toContain("╚");
			expect(stripped[2]).toContain("╝");
		});

		it("uses rounded border style", () => {
			const result = box(["text"], 20, { borderStyle: "rounded" });
			const stripped = result.map(stripAnsi);
			expect(stripped[0]).toContain("╭");
			expect(stripped[0]).toContain("╮");
			expect(stripped[2]).toContain("╰");
			expect(stripped[2]).toContain("╯");
		});

		it("uses heavy border style", () => {
			const result = box(["text"], 20, { borderStyle: "heavy" });
			const stripped = result.map(stripAnsi);
			expect(stripped[0]).toContain("┏");
			expect(stripped[0]).toContain("┓");
			expect(stripped[2]).toContain("┗");
			expect(stripped[2]).toContain("┛");
		});
	});

	describe("edge cases", () => {
		it("handles empty content array", () => {
			const result = box([], 20);
			// Just top and bottom border
			expect(result).toHaveLength(2);
		});

		it("handles multiple content lines", () => {
			const result = box(["line1", "line2", "line3"], 20);
			expect(result).toHaveLength(5); // top + 3 content + bottom
		});

		it("handles no-border no-padding pass-through", () => {
			const result = box(["short", "longer text here"], 40, { border: false, padding: 0 });
			expect(result).toHaveLength(2);
			expect(result[0]).toBe("short");
			expect(result[1]).toBe("longer text here");
		});

		it("truncates content exceeding width without borders", () => {
			const longLine = "a".repeat(50);
			const result = box([longLine], 20, { border: false, padding: 0 });
			expect(visibleLength(result[0])).toBeLessThanOrEqual(20);
		});
	});
});

// ─── horizontalLayout() ──────────────────────────────────────────────────────

describe("horizontalLayout", () => {
	it("renders two columns side by side", () => {
		const result = horizontalLayout(["left"], ["right"], 40);
		expect(result).toHaveLength(1);
		const stripped = stripAnsi(result[0]);
		expect(stripped).toContain("left");
		expect(stripped).toContain("right");
	});

	it("pads shorter column with empty lines", () => {
		const result = horizontalLayout(["a", "b", "c"], ["x"], 40);
		expect(result).toHaveLength(3);
	});

	it("respects custom gap", () => {
		const result = horizontalLayout(["Left col"], ["Right col"], 40, { gap: 4 });
		expect(result).toHaveLength(1);
		const stripped = stripAnsi(result[0]);
		expect(stripped).toContain("Left col");
		expect(stripped).toContain("Right col");
	});

	it("handles empty arrays", () => {
		const result = horizontalLayout([], ["right"], 40);
		expect(result).toHaveLength(1);
	});
});

// ─── center() ────────────────────────────────────────────────────────────────

describe("center", () => {
	it("centers text with equal padding", () => {
		const result = center("hi", 10);
		expect(visibleLength(result)).toBe(10);
		expect(result).toContain("hi");
		// "hi" is 2 chars, 10 - 2 = 8, leftPad = 4, rightPad = 4
		expect(result).toBe("    hi    ");
	});

	it("centers text with odd remaining space", () => {
		const result = center("hi", 9);
		expect(visibleLength(result)).toBe(9);
		// 9 - 2 = 7, leftPad = 3, rightPad = 4
		expect(result).toBe("   hi    ");
	});

	it("truncates text wider than width", () => {
		const result = center("a".repeat(20), 10);
		expect(visibleLength(result)).toBeLessThanOrEqual(10);
	});
});

// ─── truncate() ──────────────────────────────────────────────────────────────

describe("truncate", () => {
	it("returns text unchanged if shorter than maxWidth", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	it("truncates long text with ellipsis", () => {
		const result = truncate("hello world", 8);
		const stripped = stripAnsi(result);
		expect(stripped.length).toBeLessThanOrEqual(8);
		expect(stripped).toContain("…");
	});

	it("returns empty string for maxWidth 0", () => {
		expect(truncate("hello", 0)).toBe("");
	});

	it("returns ellipsis for maxWidth 1", () => {
		expect(truncate("hello", 1)).toBe("…");
	});

	it("preserves ANSI codes during truncation", () => {
		const colored = "\x1b[31mhello world\x1b[0m";
		const result = truncate(colored, 8);
		// Should contain the ANSI start code
		expect(result).toContain("\x1b[31m");
		// Visible text should be truncated
		expect(visibleLength(result)).toBeLessThanOrEqual(8);
	});

	it("handles text exactly at maxWidth", () => {
		expect(truncate("hello", 5)).toBe("hello");
	});
});

// ─── padRight() ──────────────────────────────────────────────────────────────

describe("padRight", () => {
	it("pads text to target width", () => {
		const result = padRight("hi", 10);
		expect(visibleLength(result)).toBe(10);
		expect(result).toBe("hi        ");
	});

	it("returns text unchanged if already wider", () => {
		expect(padRight("hello world", 5)).toBe("hello world");
	});
});

// ─── padLeft() ───────────────────────────────────────────────────────────────

describe("padLeft", () => {
	it("pads text to target width on the left", () => {
		const result = padLeft("hi", 10);
		expect(visibleLength(result)).toBe(10);
		expect(result).toBe("        hi");
	});

	it("returns text unchanged if already wider", () => {
		expect(padLeft("hello world", 5)).toBe("hello world");
	});
});
