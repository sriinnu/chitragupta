/**
 * Tests for CompletionManager, renderCompletionMenu, and applyCompletion.
 */
import { describe, it, expect } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { DEFAULT_THEME } from "../src/theme.js";
import {
	CompletionManager,
	renderCompletionMenu,
	applyCompletion,
} from "../src/components/editor-completion.js";
import type { CompletionProvider, CompletionItem, Position } from "../src/components/editor.js";

/** Helper provider that returns fixed completions */
function fixedProvider(items: CompletionItem[]): CompletionProvider {
	return { provide: () => [...items] };
}

/** Empty provider */
function emptyProvider(): CompletionProvider {
	return { provide: () => [] };
}

// ─── CompletionManager ───────────────────────────────────────────────────────

describe("CompletionManager", () => {
	describe("construction and state", () => {
		it("starts inactive with no items", () => {
			const cm = new CompletionManager();
			expect(cm.isActive).toBe(false);
			expect(cm.currentItems).toEqual([]);
			expect(cm.selectedIndex).toBe(-1);
		});
	});

	describe("provider registration", () => {
		it("registers and uses a provider", () => {
			const cm = new CompletionManager();
			const items: CompletionItem[] = [{ label: "foo", insertText: "foo" }];
			cm.registerProvider(fixedProvider(items));
			const found = cm.trigger("f", { line: 0, col: 1 });
			expect(found).toBe(true);
			expect(cm.isActive).toBe(true);
			expect(cm.currentItems).toHaveLength(1);
		});

		it("unregisters a provider", () => {
			const cm = new CompletionManager();
			const provider = fixedProvider([{ label: "a", insertText: "a" }]);
			cm.registerProvider(provider);
			cm.unregisterProvider(provider);
			const found = cm.trigger("a", { line: 0, col: 1 });
			expect(found).toBe(false);
		});

		it("collects items from multiple providers", () => {
			const cm = new CompletionManager();
			cm.registerProvider(fixedProvider([{ label: "a", insertText: "a" }]));
			cm.registerProvider(fixedProvider([{ label: "b", insertText: "b" }]));
			cm.trigger("text", { line: 0, col: 4 });
			expect(cm.currentItems).toHaveLength(2);
		});
	});

	describe("trigger", () => {
		it("returns false when no providers give results", () => {
			const cm = new CompletionManager();
			cm.registerProvider(emptyProvider());
			expect(cm.trigger("x", { line: 0, col: 1 })).toBe(false);
			expect(cm.isActive).toBe(false);
		});

		it("selects first item on trigger", () => {
			const cm = new CompletionManager();
			cm.registerProvider(fixedProvider([
				{ label: "alpha", insertText: "alpha" },
				{ label: "beta", insertText: "beta" },
			]));
			cm.trigger("a", { line: 0, col: 1 });
			expect(cm.selectedIndex).toBe(0);
		});
	});

	describe("cycling", () => {
		it("cycles forward through items", () => {
			const cm = new CompletionManager();
			cm.registerProvider(fixedProvider([
				{ label: "a", insertText: "a" },
				{ label: "b", insertText: "b" },
				{ label: "c", insertText: "c" },
			]));
			cm.trigger("x", { line: 0, col: 1 });
			expect(cm.selectedIndex).toBe(0);
			cm.cycleForward();
			expect(cm.selectedIndex).toBe(1);
			cm.cycleForward();
			expect(cm.selectedIndex).toBe(2);
			cm.cycleForward();
			expect(cm.selectedIndex).toBe(0); // wrap
		});

		it("cycles backward through items", () => {
			const cm = new CompletionManager();
			cm.registerProvider(fixedProvider([
				{ label: "a", insertText: "a" },
				{ label: "b", insertText: "b" },
			]));
			cm.trigger("x", { line: 0, col: 1 });
			cm.cycleBackward();
			expect(cm.selectedIndex).toBe(1); // wrap from 0 to last
		});

		it("does nothing when not active", () => {
			const cm = new CompletionManager();
			cm.cycleForward();
			expect(cm.selectedIndex).toBe(-1);
		});
	});

	describe("accept", () => {
		it("returns selected item and dismisses", () => {
			const cm = new CompletionManager();
			cm.registerProvider(fixedProvider([
				{ label: "hello", insertText: "hello" },
			]));
			cm.trigger("h", { line: 0, col: 1 });
			const item = cm.accept();
			expect(item).not.toBeNull();
			expect(item!.label).toBe("hello");
			expect(cm.isActive).toBe(false);
		});

		it("returns null when not active", () => {
			const cm = new CompletionManager();
			expect(cm.accept()).toBeNull();
		});
	});

	describe("dismiss", () => {
		it("clears state and deactivates", () => {
			const cm = new CompletionManager();
			cm.registerProvider(fixedProvider([{ label: "x", insertText: "x" }]));
			cm.trigger("x", { line: 0, col: 1 });
			cm.dismiss();
			expect(cm.isActive).toBe(false);
			expect(cm.currentItems).toEqual([]);
			expect(cm.selectedIndex).toBe(-1);
		});
	});
});

// ─── renderCompletionMenu ────────────────────────────────────────────────────

describe("renderCompletionMenu", () => {
	it("renders items into output array", () => {
		const output: string[] = [];
		const items: CompletionItem[] = [
			{ label: "foo", insertText: "foo" },
			{ label: "bar", insertText: "bar", description: "a helper" },
		];
		renderCompletionMenu(output, items, 0, DEFAULT_THEME);
		expect(output.length).toBeGreaterThan(0);
		const stripped = output.map(stripAnsi).join("\n");
		expect(stripped).toContain("foo");
		expect(stripped).toContain("bar");
		expect(stripped).toContain("completions");
	});

	it("highlights selected item with pointer", () => {
		const output: string[] = [];
		const items: CompletionItem[] = [
			{ label: "a", insertText: "a" },
			{ label: "b", insertText: "b" },
		];
		renderCompletionMenu(output, items, 1, DEFAULT_THEME);
		const stripped = output.map(stripAnsi);
		// Selected item (index 1 = "b") should have pointer ❯
		expect(stripped.some((l) => l.includes("❯"))).toBe(true);
	});

	it("shows footer with usage hints", () => {
		const output: string[] = [];
		renderCompletionMenu(output, [{ label: "x", insertText: "x" }], 0, DEFAULT_THEME);
		const stripped = output.map(stripAnsi).join("\n");
		expect(stripped).toContain("Tab: cycle");
		expect(stripped).toContain("Enter: accept");
		expect(stripped).toContain("Esc: dismiss");
	});
});

// ─── applyCompletion ─────────────────────────────────────────────────────────

describe("applyCompletion", () => {
	it("replaces word at cursor", () => {
		const lines = ["hello wor"];
		const result = applyCompletion(lines, 0, 9, { label: "world", insertText: "world" });
		expect(result.newLine).toBe("hello world");
		expect(result.newCol).toBe(11);
	});

	it("handles cursor at start of line", () => {
		const lines = ["text"];
		const result = applyCompletion(lines, 0, 4, { label: "textual", insertText: "textual" });
		expect(result.newLine).toBe("textual");
		expect(result.newCol).toBe(7);
	});

	it("handles empty line", () => {
		const lines = [""];
		const result = applyCompletion(lines, 0, 0, { label: "foo", insertText: "foo" });
		expect(result.newLine).toBe("foo");
		expect(result.newCol).toBe(3);
	});

	it("preserves text after cursor", () => {
		const lines = ["he world"];
		const result = applyCompletion(lines, 0, 2, { label: "hello", insertText: "hello" });
		expect(result.newLine).toBe("hello world");
	});
});
