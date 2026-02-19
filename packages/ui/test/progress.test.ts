/**
 * Tests for ProgressBar and MultiProgress components.
 */
import { describe, it, expect } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { ProgressBar, MultiProgress } from "../src/components/progress.js";

// ─── ProgressBar ─────────────────────────────────────────────────────────────

describe("ProgressBar", () => {
	describe("construction", () => {
		it("creates with default options", () => {
			const bar = new ProgressBar();
			expect(bar.percentage).toBe(0);
			expect(bar.isComplete).toBe(false);
		});

		it("accepts custom total and label", () => {
			const bar = new ProgressBar({ total: 50, label: "Downloading" });
			expect(bar.percentage).toBe(0);
		});
	});

	describe("update", () => {
		it("updates progress value", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.update(50);
			expect(bar.percentage).toBe(50);
		});

		it("clamps value to total", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.update(150);
			expect(bar.percentage).toBe(100);
		});

		it("updates label when provided", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.update(25, "Quarter done");
			const rendered = stripAnsi(bar.render());
			expect(rendered).toContain("Quarter done");
		});
	});

	describe("increment", () => {
		it("increments by 1 by default", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.increment();
			expect(bar.percentage).toBe(1);
		});

		it("increments by custom amount", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.increment(25);
			expect(bar.percentage).toBe(25);
		});
	});

	describe("setTotal", () => {
		it("changes the total value", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.update(50);
			expect(bar.percentage).toBe(50);
			bar.setTotal(200);
			expect(bar.percentage).toBe(25);
		});
	});

	describe("finish", () => {
		it("marks bar as complete", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.finish();
			expect(bar.isComplete).toBe(true);
			expect(bar.percentage).toBe(100);
		});

		it("sets final label", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.finish("All done");
			const rendered = stripAnsi(bar.render());
			expect(rendered).toContain("All done");
		});
	});

	describe("isComplete", () => {
		it("returns true when current equals total", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.update(100);
			expect(bar.isComplete).toBe(true);
		});

		it("returns false when below total", () => {
			const bar = new ProgressBar({ total: 100 });
			bar.update(99);
			expect(bar.isComplete).toBe(false);
		});
	});

	describe("percentage", () => {
		it("returns 0 for zero total", () => {
			const bar = new ProgressBar({ total: 0 });
			expect(bar.percentage).toBe(0);
		});

		it("rounds to nearest integer", () => {
			const bar = new ProgressBar({ total: 3 });
			bar.update(1);
			expect(bar.percentage).toBe(33);
		});
	});

	describe("eta", () => {
		it("returns null for indeterminate mode", () => {
			const bar = new ProgressBar({ indeterminate: true });
			expect(bar.eta).toBeNull();
		});

		it("returns null with no rate history", () => {
			const bar = new ProgressBar({ total: 100 });
			expect(bar.eta).toBeNull();
		});
	});

	describe("render", () => {
		it("renders a progress bar string", () => {
			const bar = new ProgressBar({ total: 100, width: 20 });
			bar.update(50);
			const rendered = stripAnsi(bar.render());
			expect(rendered).toContain("50%");
			expect(rendered).toContain("[");
			expect(rendered).toContain("]");
		});

		it("renders 0% bar", () => {
			const bar = new ProgressBar({ total: 100, width: 20 });
			const rendered = stripAnsi(bar.render());
			expect(rendered).toContain("0%");
		});

		it("renders 100% bar with success marker", () => {
			const bar = new ProgressBar({ total: 100, width: 20 });
			bar.finish();
			const rendered = stripAnsi(bar.render());
			expect(rendered).toContain("100%");
		});

		it("renders indeterminate mode with animation", () => {
			const bar = new ProgressBar({ indeterminate: true, width: 20 });
			bar.tick();
			const rendered = stripAnsi(bar.render());
			expect(rendered).toContain("...");
		});

		it("respects width override in render()", () => {
			const bar = new ProgressBar({ width: 10 });
			bar.update(50);
			const narrow = stripAnsi(bar.render(10));
			const wide = stripAnsi(bar.render(40));
			expect(wide.length).toBeGreaterThan(narrow.length);
		});
	});

	describe("renderLines", () => {
		it("returns array with single line", () => {
			const bar = new ProgressBar();
			const lines = bar.renderLines();
			expect(lines).toHaveLength(1);
		});
	});

	describe("tick", () => {
		it("advances animation frame", () => {
			const bar = new ProgressBar({ indeterminate: true, width: 20 });
			const before = stripAnsi(bar.render());
			bar.tick();
			bar.tick();
			bar.tick();
			const after = stripAnsi(bar.render());
			// Animation pattern should differ after ticks
			expect(after).not.toBe(before);
		});
	});
});

// ─── MultiProgress ───────────────────────────────────────────────────────────

describe("MultiProgress", () => {
	describe("add/get/remove", () => {
		it("adds and retrieves bars by key", () => {
			const mp = new MultiProgress();
			const bar = mp.add("download", { total: 100, label: "Downloading" });
			expect(bar).toBeInstanceOf(ProgressBar);
			expect(mp.get("download")).toBe(bar);
		});

		it("removes a bar by key", () => {
			const mp = new MultiProgress();
			mp.add("task1");
			mp.remove("task1");
			expect(mp.get("task1")).toBeUndefined();
			expect(mp.count).toBe(0);
		});

		it("returns undefined for missing key", () => {
			const mp = new MultiProgress();
			expect(mp.get("nonexistent")).toBeUndefined();
		});
	});

	describe("count", () => {
		it("tracks number of active bars", () => {
			const mp = new MultiProgress();
			expect(mp.count).toBe(0);
			mp.add("a");
			mp.add("b");
			expect(mp.count).toBe(2);
		});
	});

	describe("allComplete", () => {
		it("returns true when all bars are complete", () => {
			const mp = new MultiProgress();
			const a = mp.add("a", { total: 10 });
			const b = mp.add("b", { total: 10 });
			a.finish();
			b.finish();
			expect(mp.allComplete).toBe(true);
		});

		it("returns false when any bar is incomplete", () => {
			const mp = new MultiProgress();
			const a = mp.add("a", { total: 10 });
			mp.add("b", { total: 10 });
			a.finish();
			expect(mp.allComplete).toBe(false);
		});

		it("returns true for empty set", () => {
			const mp = new MultiProgress();
			expect(mp.allComplete).toBe(true);
		});
	});

	describe("pruneComplete", () => {
		it("removes completed bars", () => {
			const mp = new MultiProgress();
			const a = mp.add("a", { total: 10 });
			mp.add("b", { total: 10 });
			a.finish();
			mp.pruneComplete();
			expect(mp.count).toBe(1);
			expect(mp.get("a")).toBeUndefined();
		});
	});

	describe("render", () => {
		it("renders all bars in order", () => {
			const mp = new MultiProgress();
			mp.add("first", { label: "First" });
			mp.add("second", { label: "Second" });
			const lines = mp.render();
			expect(lines).toHaveLength(2);
		});

		it("shows placeholder when empty", () => {
			const mp = new MultiProgress();
			const lines = mp.render();
			expect(lines).toHaveLength(1);
			expect(stripAnsi(lines[0])).toContain("No active tasks");
		});
	});

	describe("tick", () => {
		it("advances all bars", () => {
			const mp = new MultiProgress();
			mp.add("a", { indeterminate: true });
			mp.add("b", { indeterminate: true });
			const before = mp.render().map(stripAnsi);
			mp.tick();
			mp.tick();
			mp.tick();
			const after = mp.render().map(stripAnsi);
			expect(after).not.toEqual(before);
		});
	});
});
