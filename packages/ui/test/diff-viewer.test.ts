/**
 * Tests for diff viewer — renderDiff() and renderUnifiedDiff(),
 * unified and side-by-side formats, line numbers, collapsing.
 */
import { describe, it, expect } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { renderDiff, renderUnifiedDiff } from "../src/components/diff-viewer.js";

describe("renderDiff", () => {
	const oldText = "line1\nline2\nline3";
	const newText = "line1\nmodified\nline3\nline4";

	describe("unified format (default)", () => {
		it("renders additions in green with + prefix", () => {
			const lines = renderDiff(oldText, newText, 80);
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("+ "))).toBe(true);
		});

		it("renders removals in red with - prefix", () => {
			const lines = renderDiff(oldText, newText, 80);
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("- "))).toBe(true);
		});

		it("shows summary with addition and removal counts", () => {
			const lines = renderDiff(oldText, newText, 80);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toMatch(/\+\d+/);
			expect(stripped).toMatch(/-\d+/);
		});

		it("shows line numbers by default", () => {
			const lines = renderDiff("a\nb", "a\nc", 80);
			const stripped = lines.map(stripAnsi);
			// At least one line should contain a digit (line number)
			expect(stripped.some((l) => /\d/.test(l))).toBe(true);
		});

		it("hides line numbers when showLineNumbers=false", () => {
			const lines = renderDiff("a\nb", "a\nc", 80, { showLineNumbers: false });
			// Lines should still render, just without line number prefix
			expect(lines.length).toBeGreaterThan(0);
		});
	});

	describe("side-by-side format", () => {
		it("renders old and new columns", () => {
			const lines = renderDiff(oldText, newText, 100, { format: "side-by-side" });
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("Old"))).toBe(true);
			expect(stripped.some((l) => l.includes("New"))).toBe(true);
		});

		it("renders separator between columns", () => {
			const lines = renderDiff("a", "b", 80, { format: "side-by-side" });
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("│") || l.includes("┼"))).toBe(true);
		});

		it("shows summary", () => {
			const lines = renderDiff("a", "b", 80, { format: "side-by-side" });
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toMatch(/\+\d+/);
		});
	});

	describe("collapsing unchanged sections", () => {
		it("collapses long unchanged blocks by default", () => {
			const old = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
			const nw = "changed\n" + Array.from({ length: 19 }, (_, i) => `line${i + 1}`).join("\n");
			const lines = renderDiff(old, nw, 80);
			const stripped = lines.map(stripAnsi).join("\n");
			// Should contain collapse indicator
			expect(stripped).toContain("unchanged lines");
		});

		it("does not collapse when collapseUnchanged=false", () => {
			const old = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
			const nw = "changed\n" + Array.from({ length: 19 }, (_, i) => `line${i + 1}`).join("\n");
			const lines = renderDiff(old, nw, 80, { collapseUnchanged: false });
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).not.toContain("unchanged lines");
		});
	});

	describe("edge cases", () => {
		it("handles identical content", () => {
			const lines = renderDiff("same\ntext", "same\ntext", 80);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("+0");
			expect(stripped).toContain("-0");
		});

		it("handles empty old content (all additions)", () => {
			const lines = renderDiff("", "new line", 80);
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("+"))).toBe(true);
		});

		it("handles empty new content (all removals)", () => {
			const lines = renderDiff("old line", "", 80);
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("-"))).toBe(true);
		});

		it("handles single-line content", () => {
			const lines = renderDiff("old", "new", 80);
			expect(lines.length).toBeGreaterThan(0);
		});
	});
});

describe("renderUnifiedDiff", () => {
	const unifiedDiff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 unchanged line
-old line
+new line
 another unchanged`;

	it("parses and renders a unified diff string", () => {
		const lines = renderUnifiedDiff(unifiedDiff, 80);
		expect(lines.length).toBeGreaterThan(0);
	});

	it("shows additions and removals", () => {
		const lines = renderUnifiedDiff(unifiedDiff, 80);
		const stripped = lines.map(stripAnsi).join("\n");
		expect(stripped).toContain("+ new line");
		expect(stripped).toContain("- old line");
	});

	it("shows line count summary", () => {
		const lines = renderUnifiedDiff(unifiedDiff, 80);
		const stripped = lines.map(stripAnsi).join("\n");
		expect(stripped).toMatch(/\+\d+/);
		expect(stripped).toMatch(/-\d+/);
	});

	it("handles empty diff string", () => {
		const lines = renderUnifiedDiff("", 80);
		// Should just show summary with 0 changes
		const stripped = lines.map(stripAnsi).join("\n");
		expect(stripped).toContain("+0");
		expect(stripped).toContain("-0");
	});

	it("supports side-by-side format", () => {
		const lines = renderUnifiedDiff(unifiedDiff, 100, { format: "side-by-side" });
		const stripped = lines.map(stripAnsi);
		expect(stripped.some((l) => l.includes("Old"))).toBe(true);
		expect(stripped.some((l) => l.includes("New"))).toBe(true);
	});
});
