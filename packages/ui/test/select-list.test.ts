/**
 * Tests for SelectList — keyboard-navigable list with search/filter,
 * selection handlers, and scrolling.
 */
import { describe, it, expect, vi } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { SelectList } from "../src/components/select-list.js";
import type { SelectItem } from "../src/components/select-list.js";
import type { KeyEvent } from "../src/keys.js";

/** Helper to create a minimal KeyEvent */
function key(name: string, opts?: Partial<KeyEvent>): KeyEvent {
	return { name, ctrl: false, meta: false, shift: false, sequence: name.length === 1 ? name : "", ...opts };
}

const ITEMS: SelectItem<string>[] = [
	{ label: "Apple", value: "apple", description: "A fruit" },
	{ label: "Banana", value: "banana", description: "Yellow fruit" },
	{ label: "Cherry", value: "cherry" },
	{ label: "Date", value: "date" },
	{ label: "Elderberry", value: "elderberry" },
];

describe("SelectList", () => {
	describe("construction", () => {
		it("creates with items and defaults", () => {
			const list = new SelectList(ITEMS);
			expect(list.selectedIndex).toBe(0);
			expect(list.selected?.value).toBe("apple");
		});

		it("accepts title option", () => {
			const list = new SelectList(ITEMS, { title: "Pick a fruit" });
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi);
			expect(stripped.some((l) => l.includes("Pick a fruit"))).toBe(true);
		});
	});

	describe("navigation", () => {
		it("moves down on down key", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("down"));
			expect(list.selectedIndex).toBe(1);
			expect(list.selected?.value).toBe("banana");
		});

		it("moves up on up key", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("down"));
			list.handleKey(key("up"));
			expect(list.selectedIndex).toBe(0);
		});

		it("wraps to bottom on up from first item", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("up"));
			expect(list.selectedIndex).toBe(ITEMS.length - 1);
		});

		it("wraps to top on down from last item", () => {
			const list = new SelectList(ITEMS);
			for (let i = 0; i < ITEMS.length; i++) list.handleKey(key("down"));
			expect(list.selectedIndex).toBe(0);
		});

		it("jumps to start on home", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("down"));
			list.handleKey(key("down"));
			list.handleKey(key("home"));
			expect(list.selectedIndex).toBe(0);
		});

		it("jumps to end on end key", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("end"));
			expect(list.selectedIndex).toBe(ITEMS.length - 1);
		});

		it("supports pagedown for large jumps", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("pagedown"));
			expect(list.selectedIndex).toBeGreaterThan(0);
		});
	});

	describe("selection handlers", () => {
		it("calls onSelect handler on Enter", () => {
			const list = new SelectList(ITEMS);
			const handler = vi.fn();
			list.onSelect(handler);
			list.handleKey(key("return"));
			expect(handler).toHaveBeenCalledWith(ITEMS[0]);
		});

		it("calls onCancel handler on Escape", () => {
			const list = new SelectList(ITEMS);
			const handler = vi.fn();
			list.onCancel(handler);
			list.handleKey(key("escape"));
			expect(handler).toHaveBeenCalled();
		});

		it("calls onCancel on Ctrl+C", () => {
			const list = new SelectList(ITEMS);
			const handler = vi.fn();
			list.onCancel(handler);
			list.handleKey(key("c", { ctrl: true }));
			expect(handler).toHaveBeenCalled();
		});
	});

	describe("filtering", () => {
		it("filters items by typed characters", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("b", { sequence: "b" }));
			list.handleKey(key("a", { sequence: "a" }));
			expect(list.searchQuery).toBe("ba");
			// Only "Banana" should match
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Banana");
			expect(stripped).not.toContain("Apple");
		});

		it("backspace removes last filter char", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("x", { sequence: "x" }));
			expect(list.searchQuery).toBe("x");
			list.handleKey(key("backspace"));
			expect(list.searchQuery).toBe("");
		});

		it("tab clears filter", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("c", { sequence: "c" }));
			list.handleKey(key("tab"));
			expect(list.searchQuery).toBe("");
		});

		it("shows 'no matching items' when filter has no results", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("z", { sequence: "z" }));
			list.handleKey(key("z", { sequence: "z" }));
			list.handleKey(key("z", { sequence: "z" }));
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("No matching items");
		});

		it("filters by description too", () => {
			const list = new SelectList(ITEMS);
			// "Yellow" only in Banana's description
			list.handleKey(key("y", { sequence: "y" }));
			list.handleKey(key("e", { sequence: "e" }));
			list.handleKey(key("l", { sequence: "l" }));
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Banana");
		});
	});

	describe("render", () => {
		it("renders all items", () => {
			const list = new SelectList(ITEMS);
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			for (const item of ITEMS) {
				expect(stripped).toContain(item.label);
			}
		});

		it("shows item count footer", () => {
			const list = new SelectList(ITEMS);
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain(`${ITEMS.length} items`);
		});

		it("highlights selected item with pointer", () => {
			const list = new SelectList(ITEMS);
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi);
			// First item should have the pointer character ❯
			expect(stripped.some((l) => l.includes("❯"))).toBe(true);
		});

		it("renders descriptions for items that have them", () => {
			const list = new SelectList(ITEMS);
			const lines = list.render(60, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("A fruit");
		});
	});

	describe("setItems", () => {
		it("replaces the item list", () => {
			const list = new SelectList(ITEMS);
			const newItems: SelectItem<string>[] = [
				{ label: "One", value: "1" },
				{ label: "Two", value: "2" },
			];
			list.setItems(newItems);
			expect(list.items).toEqual(newItems);
		});

		it("resets selection when items shrink", () => {
			const list = new SelectList(ITEMS);
			list.handleKey(key("end")); // go to last
			list.setItems([{ label: "Only", value: "only" }]);
			expect(list.selectedIndex).toBe(0);
		});
	});

	describe("empty list", () => {
		it("handles empty items array", () => {
			const list = new SelectList<string>([]);
			const lines = list.render(40, 20);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("No matching items");
		});
	});
});
