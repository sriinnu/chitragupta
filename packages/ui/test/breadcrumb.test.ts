/**
 * Tests for Breadcrumb — navigation trail with push/pop,
 * keyboard navigation, and truncation for long paths.
 */
import { describe, it, expect, vi } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { Breadcrumb } from "../src/components/breadcrumb.js";
import type { BreadcrumbItem } from "../src/components/breadcrumb.js";
import type { KeyEvent } from "../src/keys.js";

/** Helper to create a minimal KeyEvent */
function key(name: string, opts?: Partial<KeyEvent>): KeyEvent {
	return { name, ctrl: false, meta: false, shift: false, sequence: "", ...opts };
}

describe("Breadcrumb", () => {
	describe("construction", () => {
		it("creates with default options", () => {
			const bc = new Breadcrumb();
			expect(bc.path).toEqual([]);
		});

		it("creates with initial items", () => {
			const items: BreadcrumbItem[] = [
				{ label: "Home" },
				{ label: "Projects" },
				{ label: "App" },
			];
			const bc = new Breadcrumb({ items });
			expect(bc.path).toHaveLength(3);
			// Default selection is the last item
			expect(bc.selected?.label).toBe("App");
		});
	});

	describe("push/pop", () => {
		it("pushes items onto the trail", () => {
			const bc = new Breadcrumb();
			bc.push({ label: "Home" });
			bc.push({ label: "Docs" });
			expect(bc.path).toHaveLength(2);
			expect(bc.selected?.label).toBe("Docs");
		});

		it("pops the last item", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }] });
			const popped = bc.pop();
			expect(popped?.label).toBe("B");
			expect(bc.path).toHaveLength(1);
			expect(bc.selected?.label).toBe("A");
		});

		it("pop returns undefined on empty breadcrumb", () => {
			const bc = new Breadcrumb();
			expect(bc.pop()).toBeUndefined();
		});
	});

	describe("setItems", () => {
		it("replaces items", () => {
			const bc = new Breadcrumb({ items: [{ label: "Old" }] });
			bc.setItems([{ label: "New1" }, { label: "New2" }]);
			expect(bc.path).toHaveLength(2);
		});

		it("clamps selected index if items shrink", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }, { label: "C" }] });
			// selection at 2 (last), shrink to 1 item
			bc.setItems([{ label: "Only" }]);
			expect(bc.selected?.label).toBe("Only");
		});
	});

	describe("keyboard navigation", () => {
		it("moves left on left arrow", () => {
			const items: BreadcrumbItem[] = [{ label: "A" }, { label: "B" }, { label: "C" }];
			const bc = new Breadcrumb({ items });
			// Selected starts at last (C)
			bc.handleKey(key("left"));
			expect(bc.selected?.label).toBe("B");
		});

		it("moves right on right arrow", () => {
			const items: BreadcrumbItem[] = [{ label: "A" }, { label: "B" }, { label: "C" }];
			const bc = new Breadcrumb({ items });
			bc.handleKey(key("left")); // B
			bc.handleKey(key("right")); // C
			expect(bc.selected?.label).toBe("C");
		});

		it("does not go past the first item on left", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }] });
			bc.handleKey(key("left")); // A
			bc.handleKey(key("left")); // still A (clamped)
			expect(bc.selected?.label).toBe("A");
		});

		it("does not go past the last item on right", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }] });
			bc.handleKey(key("right")); // already at B, stays
			expect(bc.selected?.label).toBe("B");
		});

		it("home jumps to first", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }, { label: "C" }] });
			bc.handleKey(key("home"));
			expect(bc.selected?.label).toBe("A");
		});

		it("end jumps to last", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }, { label: "C" }] });
			bc.handleKey(key("home"));
			bc.handleKey(key("end"));
			expect(bc.selected?.label).toBe("C");
		});

		it("ignores keys when not interactive", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }], interactive: false });
			bc.handleKey(key("left"));
			// Should still be at default position
			expect(bc.selected?.label).toBe("B");
		});
	});

	describe("onNavigate", () => {
		it("calls handler on Enter", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }, { label: "B" }] });
			const handler = vi.fn();
			bc.onNavigate(handler);
			bc.handleKey(key("return"));
			expect(handler).toHaveBeenCalledWith({ label: "B" }, 1);
		});
	});

	describe("render", () => {
		it("renders items with separator", () => {
			const bc = new Breadcrumb({ items: [{ label: "Home" }, { label: "Docs" }] });
			const rendered = stripAnsi(bc.render(60));
			expect(rendered).toContain("Home");
			expect(rendered).toContain("Docs");
			expect(rendered).toContain("›");
		});

		it("renders empty string for no items", () => {
			const bc = new Breadcrumb();
			expect(bc.render(60)).toBe("");
		});

		it("supports custom separator", () => {
			const bc = new Breadcrumb({
				items: [{ label: "A" }, { label: "B" }],
				separator: " / ",
			});
			const rendered = stripAnsi(bc.render(60));
			expect(rendered).toContain("/");
		});

		it("truncates when path is too long for width", () => {
			const items: BreadcrumbItem[] = Array.from({ length: 10 }, (_, i) => ({
				label: `Segment${i}`,
			}));
			const bc = new Breadcrumb({ items });
			const rendered = stripAnsi(bc.render(30));
			// Should contain ellipsis for truncated parts
			expect(rendered).toContain("…");
		});

		it("renderLines returns single-element array", () => {
			const bc = new Breadcrumb({ items: [{ label: "A" }] });
			const lines = bc.renderLines(60);
			expect(lines).toHaveLength(1);
		});
	});
});
