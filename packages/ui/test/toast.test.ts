/**
 * Tests for the ToastManager notification system — creation, dismissal,
 * stacking, expiry, and rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripAnsi } from "../src/ansi.js";
import { ToastManager } from "../src/components/toast.js";
import type { ToastType } from "../src/components/toast.js";

describe("ToastManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("construction", () => {
		it("creates with default options", () => {
			const tm = new ToastManager();
			expect(tm.count).toBe(0);
		});

		it("accepts custom timeout and max toasts", () => {
			const tm = new ToastManager({ defaultTimeout: 5000, maxToasts: 3 });
			expect(tm.count).toBe(0);
		});
	});

	describe("show", () => {
		it("adds a toast and returns an id", () => {
			const tm = new ToastManager();
			const id = tm.show("Hello");
			expect(typeof id).toBe("number");
			expect(tm.count).toBe(1);
		});

		it("defaults to info type", () => {
			const tm = new ToastManager();
			tm.show("Info message");
			const lines = tm.renderLines(50);
			expect(lines.length).toBeGreaterThan(0);
		});

		it("limits stack to maxToasts", () => {
			const tm = new ToastManager({ maxToasts: 2 });
			tm.show("first");
			tm.show("second");
			tm.show("third");
			expect(tm.count).toBe(2);
		});

		it("assigns incremental ids", () => {
			const tm = new ToastManager();
			const id1 = tm.show("a");
			const id2 = tm.show("b");
			expect(id2).toBeGreaterThan(id1);
		});
	});

	describe("convenience methods", () => {
		it("success() creates a success toast", () => {
			const tm = new ToastManager();
			const id = tm.success("Saved!");
			expect(typeof id).toBe("number");
			expect(tm.count).toBe(1);
		});

		it("error() creates an error toast", () => {
			const tm = new ToastManager();
			const id = tm.error("Failed!");
			expect(typeof id).toBe("number");
			expect(tm.count).toBe(1);
		});

		it("warning() creates a warning toast", () => {
			const tm = new ToastManager();
			const id = tm.warning("Caution!");
			expect(typeof id).toBe("number");
			expect(tm.count).toBe(1);
		});

		it("info() creates an info toast", () => {
			const tm = new ToastManager();
			const id = tm.info("FYI");
			expect(typeof id).toBe("number");
			expect(tm.count).toBe(1);
		});

		it("convenience methods accept custom timeout", () => {
			const tm = new ToastManager();
			tm.success("msg", 1000);
			expect(tm.count).toBe(1);
			vi.advanceTimersByTime(1001);
			tm.renderLines(50); // triggers pruning
			expect(tm.count).toBe(0);
		});
	});

	describe("dismiss", () => {
		it("removes a toast by id", () => {
			const tm = new ToastManager();
			const id = tm.show("removable");
			expect(tm.count).toBe(1);
			tm.dismiss(id);
			expect(tm.count).toBe(0);
		});

		it("ignores unknown ids", () => {
			const tm = new ToastManager();
			tm.show("keep");
			tm.dismiss(999);
			expect(tm.count).toBe(1);
		});
	});

	describe("dismissAll", () => {
		it("clears all toasts", () => {
			const tm = new ToastManager();
			tm.show("a");
			tm.show("b");
			tm.show("c");
			tm.dismissAll();
			expect(tm.count).toBe(0);
		});
	});

	describe("expiry", () => {
		it("prunes expired toasts on render", () => {
			const tm = new ToastManager({ defaultTimeout: 1000 });
			tm.show("ephemeral");
			expect(tm.count).toBe(1);
			vi.advanceTimersByTime(1001);
			tm.renderLines(50); // triggers pruneExpired
			expect(tm.count).toBe(0);
		});

		it("keeps toasts that have not expired", () => {
			const tm = new ToastManager({ defaultTimeout: 5000 });
			tm.show("lasting");
			vi.advanceTimersByTime(2000);
			tm.renderLines(50);
			expect(tm.count).toBe(1);
		});
	});

	describe("render", () => {
		it("returns positioned overlay lines", () => {
			const tm = new ToastManager();
			tm.show("Test toast");
			const result = tm.render(80, 24);
			expect(result.length).toBeGreaterThan(0);
			// Each toast produces 3 lines (top border, content, bottom border)
			expect(result).toHaveLength(3);
			expect(result[0]).toHaveProperty("y");
			expect(result[0]).toHaveProperty("line");
		});

		it("stacks multiple toasts vertically", () => {
			const tm = new ToastManager();
			tm.show("first");
			tm.show("second");
			const result = tm.render(80, 24);
			// 2 toasts * 3 lines each = 6 positioned lines
			expect(result).toHaveLength(6);
			// Second toast starts at higher y
			expect(result[3].y).toBeGreaterThan(result[0].y);
		});

		it("returns empty array when no toasts", () => {
			const tm = new ToastManager();
			const result = tm.render(80, 24);
			expect(result).toHaveLength(0);
		});
	});

	describe("renderLines", () => {
		it("returns flat line array for each toast", () => {
			const tm = new ToastManager();
			tm.show("Hello");
			const lines = tm.renderLines(50);
			// 1 toast = 3 lines (top border, content, bottom border)
			expect(lines).toHaveLength(3);
		});

		it("contains the message text", () => {
			const tm = new ToastManager();
			tm.show("Important message");
			const lines = tm.renderLines(50);
			const stripped = lines.map(stripAnsi).join("\n");
			expect(stripped).toContain("Important message");
		});

		it("uses rounded border characters", () => {
			const tm = new ToastManager();
			tm.show("bordered");
			const lines = tm.renderLines(50);
			const stripped = lines.map(stripAnsi);
			expect(stripped[0]).toContain("╭");
			expect(stripped[0]).toContain("╮");
			expect(stripped[2]).toContain("╰");
			expect(stripped[2]).toContain("╯");
		});

		it("truncates long messages", () => {
			const tm = new ToastManager();
			tm.show("a".repeat(100));
			const lines = tm.renderLines(40);
			const content = stripAnsi(lines[1]);
			expect(content).toContain("…");
		});

		it("returns empty array when no toasts", () => {
			const tm = new ToastManager();
			const lines = tm.renderLines(50);
			expect(lines).toHaveLength(0);
		});
	});
});
