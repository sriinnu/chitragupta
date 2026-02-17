import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Screen } from "../src/screen.js";

// ─── Mock process.stdout ──────────────────────────────────────────────────

const originalStdout = {
  columns: process.stdout.columns,
  rows: process.stdout.rows,
  write: process.stdout.write,
};

describe("Screen", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Set fixed terminal dimensions
    Object.defineProperty(process.stdout, "columns", { value: 40, writable: true, configurable: true });
    Object.defineProperty(process.stdout, "rows", { value: 10, writable: true, configurable: true });
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    Object.defineProperty(process.stdout, "columns", { value: originalStdout.columns, writable: true, configurable: true });
    Object.defineProperty(process.stdout, "rows", { value: originalStdout.rows, writable: true, configurable: true });
  });

  describe("creation", () => {
    it("should create a screen with terminal dimensions", () => {
      const screen = new Screen();
      expect(screen.width).toBe(40);
      expect(screen.height).toBe(10);
      screen.destroy();
    });
  });

  describe("write()", () => {
    it("should write text to the buffer at a position", () => {
      const screen = new Screen();
      screen.write(0, 0, "Hello");
      // Render should produce output since buffer changed
      screen.render();
      expect(writeSpy).toHaveBeenCalled();
      screen.destroy();
    });

    it("should ignore writes outside bounds", () => {
      const screen = new Screen();
      // Writing at y=-1 should be silently ignored
      screen.write(0, -1, "outside");
      // Writing at y=100 (beyond height) should be ignored
      screen.write(0, 100, "outside");
      screen.destroy();
    });
  });

  describe("writeLine()", () => {
    it("should write a full line at a given row", () => {
      const screen = new Screen();
      screen.writeLine(0, "Full line content");
      screen.render();
      expect(writeSpy).toHaveBeenCalled();
      screen.destroy();
    });

    it("should ignore out-of-bounds rows", () => {
      const screen = new Screen();
      screen.writeLine(-1, "negative");
      screen.writeLine(999, "too high");
      // No crash
      screen.destroy();
    });
  });

  describe("writeLines()", () => {
    it("should write multiple lines starting from a row", () => {
      const screen = new Screen();
      screen.writeLines(0, ["line 1", "line 2", "line 3"]);
      screen.render();
      expect(writeSpy).toHaveBeenCalled();
      screen.destroy();
    });
  });

  describe("render()", () => {
    it("should not write when nothing has changed", () => {
      const screen = new Screen();
      screen.render(); // first render - writes initial state
      writeSpy.mockClear();
      screen.render(); // second render - no changes
      // Should not write anything on second render since dirty=false
      expect(writeSpy).not.toHaveBeenCalled();
      screen.destroy();
    });

    it("should only write changed cells (differential)", () => {
      const screen = new Screen();
      screen.render(); // initial render
      writeSpy.mockClear();
      // Write to only one cell
      screen.write(0, 0, "X");
      screen.render();
      // Should have written something (the changed cell)
      expect(writeSpy).toHaveBeenCalled();
      // But the output should be minimal, not full screen
      const output = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
      expect(output).toContain("X");
      screen.destroy();
    });
  });

  describe("clear()", () => {
    it("should mark screen as dirty", () => {
      const screen = new Screen();
      screen.render(); // clear dirty flag
      writeSpy.mockClear();
      screen.clear();
      screen.render();
      // After clear, render should write
      expect(writeSpy).toHaveBeenCalled();
      screen.destroy();
    });
  });

  describe("fullClear()", () => {
    it("should write clear screen sequence", () => {
      const screen = new Screen();
      screen.fullClear();
      expect(writeSpy).toHaveBeenCalled();
      const output = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
      expect(output).toContain("\x1b[2J");
      screen.destroy();
    });
  });

  describe("invalidate()", () => {
    it("should force a full redraw on next render", () => {
      const screen = new Screen();
      screen.render(); // initial render
      writeSpy.mockClear();
      screen.invalidate();
      screen.render();
      // Every cell should be considered changed
      expect(writeSpy).toHaveBeenCalled();
      screen.destroy();
    });
  });

  describe("resize handling", () => {
    it("should register and unregister resize handlers", () => {
      const screen = new Screen();
      const handler = vi.fn();
      screen.onResize(handler);
      screen.offResize(handler);
      screen.destroy();
    });
  });

  describe("cursor visibility", () => {
    it("should toggle cursor visibility", () => {
      const screen = new Screen();
      screen.setCursorVisible(false);
      expect(writeSpy).toHaveBeenCalled();
      const output = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
      expect(output).toContain("\x1b[?25l"); // hide cursor
      screen.setCursorVisible(true);
      screen.destroy();
    });
  });

  describe("destroy()", () => {
    it("should remove resize listener", () => {
      const screen = new Screen();
      const offSpy = vi.spyOn(process.stdout, "off");
      screen.destroy();
      expect(offSpy).toHaveBeenCalledWith("resize", expect.any(Function));
      offSpy.mockRestore();
    });
  });
});
