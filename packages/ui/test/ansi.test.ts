import { describe, it, expect } from "vitest";
import {
  reset,
  fg,
  bg,
  rgb,
  bgRgb,
  bold,
  dim,
  italic,
  underline,
  strikethrough,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  stripAnsi,
  visibleLength,
  cursorUp,
  cursorDown,
  cursorForward,
  cursorBack,
  cursorTo,
  saveCursor,
  restoreCursor,
  clearScreen,
  clearLine,
  clearDown,
  hideCursor,
  showCursor,
  alternateScreen,
  mainScreen,
} from "../src/ansi.js";

describe("ANSI utilities", () => {
  describe("reset", () => {
    it("should be the reset escape code", () => {
      expect(reset).toBe("\x1b[0m");
    });
  });

  describe("256-color functions", () => {
    it("fg() should set foreground color", () => {
      expect(fg(196)).toBe("\x1b[38;5;196m");
    });

    it("bg() should set background color", () => {
      expect(bg(196)).toBe("\x1b[48;5;196m");
    });
  });

  describe("true-color functions", () => {
    it("rgb() should set foreground to RGB", () => {
      expect(rgb(255, 128, 0)).toBe("\x1b[38;2;255;128;0m");
    });

    it("bgRgb() should set background to RGB", () => {
      expect(bgRgb(0, 128, 255)).toBe("\x1b[48;2;0;128;255m");
    });
  });

  describe("style wrappers", () => {
    it("bold() should wrap text with bold codes", () => {
      const result = bold("test");
      expect(result).toBe("\x1b[1mtest\x1b[22m");
    });

    it("dim() should wrap text with dim codes", () => {
      const result = dim("test");
      expect(result).toBe("\x1b[2mtest\x1b[22m");
    });

    it("italic() should wrap text with italic codes", () => {
      const result = italic("test");
      expect(result).toBe("\x1b[3mtest\x1b[23m");
    });

    it("underline() should wrap text with underline codes", () => {
      const result = underline("test");
      expect(result).toBe("\x1b[4mtest\x1b[24m");
    });

    it("strikethrough() should wrap text with strikethrough codes", () => {
      const result = strikethrough("test");
      expect(result).toBe("\x1b[9mtest\x1b[29m");
    });
  });

  describe("named color presets", () => {
    it("red() should colorize text", () => {
      const result = red("error");
      expect(result).toContain("\x1b[31m");
      expect(result).toContain("error");
      expect(result).toContain(reset);
    });

    it("green() should colorize text", () => {
      expect(green("ok")).toContain("\x1b[32m");
    });

    it("yellow() should colorize text", () => {
      expect(yellow("warn")).toContain("\x1b[33m");
    });

    it("blue() should colorize text", () => {
      expect(blue("info")).toContain("\x1b[34m");
    });

    it("magenta() should colorize text", () => {
      expect(magenta("special")).toContain("\x1b[35m");
    });

    it("cyan() should colorize text", () => {
      expect(cyan("link")).toContain("\x1b[36m");
    });

    it("white() should colorize text", () => {
      expect(white("bright")).toContain("\x1b[37m");
    });

    it("gray() should colorize text", () => {
      expect(gray("muted")).toContain("\x1b[90m");
    });
  });

  describe("stripAnsi()", () => {
    it("should remove all ANSI codes from a string", () => {
      const styled = bold(red("hello")) + " " + underline("world");
      const plain = stripAnsi(styled);
      expect(plain).toBe("hello world");
    });

    it("should return plain text unchanged", () => {
      expect(stripAnsi("no codes here")).toBe("no codes here");
    });

    it("should handle empty string", () => {
      expect(stripAnsi("")).toBe("");
    });

    it("should strip 256-color codes", () => {
      const styled = fg(196) + "colored" + reset;
      expect(stripAnsi(styled)).toBe("colored");
    });

    it("should strip RGB codes", () => {
      const styled = rgb(255, 0, 0) + "red" + reset;
      expect(stripAnsi(styled)).toBe("red");
    });
  });

  describe("visibleLength()", () => {
    it("should return the length of visible characters only", () => {
      const styled = bold(red("hello"));
      expect(visibleLength(styled)).toBe(5);
    });

    it("should return normal length for plain strings", () => {
      expect(visibleLength("hello")).toBe(5);
    });

    it("should return 0 for empty string", () => {
      expect(visibleLength("")).toBe(0);
    });
  });

  describe("cursor movement", () => {
    it("cursorUp() should move cursor up", () => {
      expect(cursorUp(3)).toBe("\x1b[3A");
      expect(cursorUp()).toBe("\x1b[1A");
    });

    it("cursorDown() should move cursor down", () => {
      expect(cursorDown(2)).toBe("\x1b[2B");
    });

    it("cursorForward() should move cursor right", () => {
      expect(cursorForward(5)).toBe("\x1b[5C");
    });

    it("cursorBack() should move cursor left", () => {
      expect(cursorBack(1)).toBe("\x1b[1D");
    });

    it("cursorTo() with x only should set column", () => {
      expect(cursorTo(10)).toBe("\x1b[10G");
    });

    it("cursorTo() with x,y should set absolute position", () => {
      expect(cursorTo(5, 10)).toBe("\x1b[10;5H");
    });
  });

  describe("cursor save/restore", () => {
    it("saveCursor() should return save sequence", () => {
      expect(saveCursor()).toBe("\x1b[s");
    });

    it("restoreCursor() should return restore sequence", () => {
      expect(restoreCursor()).toBe("\x1b[u");
    });
  });

  describe("screen control", () => {
    it("clearScreen() should clear entire screen", () => {
      expect(clearScreen()).toBe("\x1b[2J\x1b[H");
    });

    it("clearLine() should clear current line", () => {
      expect(clearLine()).toBe("\x1b[2K");
    });

    it("clearDown() should clear from cursor to bottom", () => {
      expect(clearDown()).toBe("\x1b[J");
    });

    it("hideCursor() should hide the cursor", () => {
      expect(hideCursor()).toBe("\x1b[?25l");
    });

    it("showCursor() should show the cursor", () => {
      expect(showCursor()).toBe("\x1b[?25h");
    });

    it("alternateScreen() should switch to alternate buffer", () => {
      expect(alternateScreen()).toBe("\x1b[?1049h");
    });

    it("mainScreen() should switch back to main buffer", () => {
      expect(mainScreen()).toBe("\x1b[?1049l");
    });
  });
});
