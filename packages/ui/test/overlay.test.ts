/**
 * Tests for the Overlay stack manager, SelectListOverlay, and HelpOverlay.
 */
import { describe, it, expect, vi } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { Overlay, SelectListOverlay, HelpOverlay } from "../src/components/overlay.js";
import type { OverlayPanel } from "../src/components/overlay.js";
import type { KeyEvent } from "../src/keys.js";

/** Helper to create a minimal KeyEvent */
function key(name: string, opts?: Partial<KeyEvent>): KeyEvent {
	return { name, ctrl: false, meta: false, shift: false, sequence: "", ...opts };
}

/** Minimal mock panel for testing the Overlay stack */
function mockPanel(id: string, keyResult: "close" | "handled" | "pass" = "handled"): OverlayPanel {
	return {
		id,
		title: `Panel ${id}`,
		render: (_w: number, _h: number) => [`Content of ${id}`],
		handleKey: vi.fn(() => keyResult),
	};
}

// ─── Overlay (Stack Manager) ─────────────────────────────────────────────────

describe("Overlay", () => {
	describe("stack operations", () => {
		it("starts empty", () => {
			const overlay = new Overlay();
			expect(overlay.isActive()).toBe(false);
			expect(overlay.depth).toBe(0);
			expect(overlay.top).toBeUndefined();
		});

		it("pushes panels onto the stack", () => {
			const overlay = new Overlay();
			const panel = mockPanel("a");
			overlay.push(panel);
			expect(overlay.isActive()).toBe(true);
			expect(overlay.depth).toBe(1);
			expect(overlay.top).toBe(panel);
		});

		it("pops panels from the stack", () => {
			const overlay = new Overlay();
			const p1 = mockPanel("a");
			const p2 = mockPanel("b");
			overlay.push(p1);
			overlay.push(p2);
			const popped = overlay.pop();
			expect(popped).toBe(p2);
			expect(overlay.depth).toBe(1);
			expect(overlay.top).toBe(p1);
		});

		it("pop returns undefined when empty", () => {
			const overlay = new Overlay();
			expect(overlay.pop()).toBeUndefined();
		});
	});

	describe("render", () => {
		it("returns empty array when no overlay active", () => {
			const overlay = new Overlay();
			const result = overlay.render(80, 24);
			expect(result).toHaveLength(0);
		});

		it("renders the top panel in a bordered frame", () => {
			const overlay = new Overlay();
			overlay.push(mockPanel("test"));
			const result = overlay.render(80, 24);
			expect(result.length).toBeGreaterThan(0);
			const stripped = result.map(stripAnsi).join("\n");
			// Should contain border characters
			expect(stripped).toContain("┌");
			expect(stripped).toContain("┘");
			// Should contain panel title
			expect(stripped).toContain("Panel test");
			// Should contain panel content
			expect(stripped).toContain("Content of test");
		});

		it("shows Esc hint in bottom border", () => {
			const overlay = new Overlay();
			overlay.push(mockPanel("help"));
			const result = overlay.render(80, 24);
			const stripped = result.map(stripAnsi).join("\n");
			expect(stripped).toContain("Esc to close");
		});
	});

	describe("handleKey", () => {
		it("returns false when no overlay active", () => {
			const overlay = new Overlay();
			expect(overlay.handleKey(key("escape"))).toBe(false);
		});

		it("routes key to top panel", () => {
			const overlay = new Overlay();
			const panel = mockPanel("a", "handled");
			overlay.push(panel);
			const consumed = overlay.handleKey(key("up"));
			expect(consumed).toBe(true);
			expect(panel.handleKey).toHaveBeenCalled();
		});

		it("pops panel on 'close' result", () => {
			const overlay = new Overlay();
			overlay.push(mockPanel("a", "close"));
			expect(overlay.handleKey(key("escape"))).toBe(true);
			expect(overlay.depth).toBe(0);
		});

		it("returns false on 'pass' result", () => {
			const overlay = new Overlay();
			overlay.push(mockPanel("a", "pass"));
			expect(overlay.handleKey(key("x"))).toBe(false);
		});
	});
});

// ─── SelectListOverlay ───────────────────────────────────────────────────────

describe("SelectListOverlay", () => {
	const items = [
		{ label: "Option A", value: "a", description: "First" },
		{ label: "Option B", value: "b", description: "Second" },
		{ label: "Option C", value: "c" },
	];

	describe("construction", () => {
		it("creates with id, title, items, and callback", () => {
			const cb = vi.fn();
			const slo = new SelectListOverlay("test", "Pick one", items, cb);
			expect(slo.id).toBe("test");
			expect(slo.title).toBe("Pick one");
			expect(slo.currentIndex).toBe(0);
		});
	});

	describe("navigation", () => {
		it("moves down on down arrow", () => {
			const slo = new SelectListOverlay("t", "T", items, vi.fn());
			slo.handleKey(key("down"));
			expect(slo.currentIndex).toBe(1);
		});

		it("moves up on up arrow", () => {
			const slo = new SelectListOverlay("t", "T", items, vi.fn());
			slo.handleKey(key("down"));
			slo.handleKey(key("up"));
			expect(slo.currentIndex).toBe(0);
		});

		it("wraps around when going past last", () => {
			const slo = new SelectListOverlay("t", "T", items, vi.fn());
			slo.handleKey(key("down"));
			slo.handleKey(key("down"));
			slo.handleKey(key("down")); // wrap
			expect(slo.currentIndex).toBe(0);
		});

		it("wraps around when going before first", () => {
			const slo = new SelectListOverlay("t", "T", items, vi.fn());
			slo.handleKey(key("up")); // wrap to last
			expect(slo.currentIndex).toBe(items.length - 1);
		});
	});

	describe("selection", () => {
		it("calls onSelect and returns close on Enter", () => {
			const cb = vi.fn();
			const slo = new SelectListOverlay("t", "T", items, cb);
			slo.handleKey(key("down")); // select "b"
			const result = slo.handleKey(key("return"));
			expect(cb).toHaveBeenCalledWith("b");
			expect(result).toBe("close");
		});

		it("returns close on Escape without calling onSelect", () => {
			const cb = vi.fn();
			const slo = new SelectListOverlay("t", "T", items, cb);
			const result = slo.handleKey(key("escape"));
			expect(result).toBe("close");
			expect(cb).not.toHaveBeenCalled();
		});

		it("returns pass for unhandled keys", () => {
			const slo = new SelectListOverlay("t", "T", items, vi.fn());
			expect(slo.handleKey(key("a"))).toBe("pass");
		});
	});

	describe("render", () => {
		it("renders items with pointer on selected", () => {
			const slo = new SelectListOverlay("t", "T", items, vi.fn());
			const lines = slo.render(40, 10);
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("❯"))).toBe(true);
			expect(stripped.some((l) => l.includes("Option A"))).toBe(true);
		});

		it("shows 'No items' for empty list", () => {
			const slo = new SelectListOverlay("t", "T", [], vi.fn());
			const lines = slo.render(40, 10);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("No items");
		});
	});
});

// ─── HelpOverlay ─────────────────────────────────────────────────────────────

describe("HelpOverlay", () => {
	describe("construction", () => {
		it("creates with content string", () => {
			const help = new HelpOverlay("Line 1\nLine 2\nLine 3");
			expect(help.id).toBe("help");
			expect(help.title).toBe("Help");
		});
	});

	describe("render", () => {
		it("renders content lines", () => {
			const help = new HelpOverlay("Hello\nWorld");
			const lines = help.render(40, 10);
			expect(lines.some((l) => l.includes("Hello"))).toBe(true);
			expect(lines.some((l) => l.includes("World"))).toBe(true);
		});

		it("pads output to fill height", () => {
			const help = new HelpOverlay("Short");
			const lines = help.render(40, 10);
			expect(lines).toHaveLength(10);
		});
	});

	describe("scrolling", () => {
		it("scrolls down on down key", () => {
			const longContent = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n");
			const help = new HelpOverlay(longContent);
			help.render(40, 5); // initial render
			help.handleKey(key("down"));
			const lines = help.render(40, 5);
			// After scrolling down, line 0 might not be "Line 0"
			expect(lines[0]).toContain("Line 1");
		});

		it("scrolls up on up key", () => {
			const longContent = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join("\n");
			const help = new HelpOverlay(longContent);
			help.render(40, 5);
			help.handleKey(key("down"));
			help.handleKey(key("down"));
			help.handleKey(key("up"));
			const lines = help.render(40, 5);
			expect(lines[0]).toContain("Line 1");
		});

		it("supports pagedown", () => {
			const longContent = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\n");
			const help = new HelpOverlay(longContent);
			help.render(40, 5);
			const result = help.handleKey(key("pagedown"));
			expect(result).toBe("handled");
		});

		it("supports pageup", () => {
			const longContent = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\n");
			const help = new HelpOverlay(longContent);
			help.render(40, 5);
			help.handleKey(key("pagedown"));
			const result = help.handleKey(key("pageup"));
			expect(result).toBe("handled");
		});
	});

	describe("key handling", () => {
		it("returns close on Escape", () => {
			const help = new HelpOverlay("content");
			expect(help.handleKey(key("escape"))).toBe("close");
		});

		it("returns pass for unhandled keys", () => {
			const help = new HelpOverlay("content");
			expect(help.handleKey(key("a"))).toBe("pass");
		});
	});
});
