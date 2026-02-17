import { describe, it, expect } from "vitest";
import { parseKeypress, matchKey } from "../src/keys.js";
import type { KeyEvent } from "../src/keys.js";

describe("parseKeypress", () => {
  describe("arrow keys", () => {
    it("should parse Up arrow", () => {
      const key = parseKeypress(Buffer.from("\x1b[A"));
      expect(key.name).toBe("up");
      expect(key.ctrl).toBe(false);
      expect(key.shift).toBe(false);
    });

    it("should parse Down arrow", () => {
      const key = parseKeypress(Buffer.from("\x1b[B"));
      expect(key.name).toBe("down");
    });

    it("should parse Right arrow", () => {
      const key = parseKeypress(Buffer.from("\x1b[C"));
      expect(key.name).toBe("right");
    });

    it("should parse Left arrow", () => {
      const key = parseKeypress(Buffer.from("\x1b[D"));
      expect(key.name).toBe("left");
    });
  });

  describe("arrow keys with modifiers", () => {
    it("should parse Shift+Up", () => {
      const key = parseKeypress(Buffer.from("\x1b[1;2A"));
      expect(key.name).toBe("up");
      expect(key.shift).toBe(true);
    });

    it("should parse Ctrl+Right", () => {
      const key = parseKeypress(Buffer.from("\x1b[1;5C"));
      expect(key.name).toBe("right");
      expect(key.ctrl).toBe(true);
    });
  });

  describe("special keys", () => {
    it("should parse Enter (CR)", () => {
      const key = parseKeypress(Buffer.from("\r"));
      expect(key.name).toBe("return");
    });

    it("should parse Enter (LF)", () => {
      const key = parseKeypress(Buffer.from("\n"));
      expect(key.name).toBe("return");
    });

    it("should parse Tab", () => {
      const key = parseKeypress(Buffer.from("\t"));
      expect(key.name).toBe("tab");
    });

    it("should parse Backspace (DEL)", () => {
      const key = parseKeypress(Buffer.from([127]));
      expect(key.name).toBe("backspace");
    });

    it("should parse Backspace (BS)", () => {
      const key = parseKeypress(Buffer.from([8]));
      expect(key.name).toBe("backspace");
    });

    it("should parse Escape", () => {
      const key = parseKeypress(Buffer.from("\x1b"));
      expect(key.name).toBe("escape");
    });

    it("should parse Shift+Tab", () => {
      const key = parseKeypress(Buffer.from("\x1b[Z"));
      expect(key.name).toBe("tab");
      expect(key.shift).toBe(true);
    });
  });

  describe("navigation keys", () => {
    it("should parse Home", () => {
      const key = parseKeypress(Buffer.from("\x1b[H"));
      expect(key.name).toBe("home");
    });

    it("should parse End", () => {
      const key = parseKeypress(Buffer.from("\x1b[F"));
      expect(key.name).toBe("end");
    });

    it("should parse PageUp", () => {
      const key = parseKeypress(Buffer.from("\x1b[5~"));
      expect(key.name).toBe("pageup");
    });

    it("should parse PageDown", () => {
      const key = parseKeypress(Buffer.from("\x1b[6~"));
      expect(key.name).toBe("pagedown");
    });

    it("should parse Delete", () => {
      const key = parseKeypress(Buffer.from("\x1b[3~"));
      expect(key.name).toBe("delete");
    });

    it("should parse Insert", () => {
      const key = parseKeypress(Buffer.from("\x1b[2~"));
      expect(key.name).toBe("insert");
    });
  });

  describe("function keys", () => {
    it("should parse F1", () => {
      const key = parseKeypress(Buffer.from("\x1bOP"));
      expect(key.name).toBe("f1");
    });

    it("should parse F5", () => {
      const key = parseKeypress(Buffer.from("\x1b[15~"));
      expect(key.name).toBe("f5");
    });

    it("should parse F12", () => {
      const key = parseKeypress(Buffer.from("\x1b[24~"));
      expect(key.name).toBe("f12");
    });
  });

  describe("Ctrl+key", () => {
    it("should parse Ctrl+A", () => {
      const key = parseKeypress(Buffer.from([1]));
      expect(key.name).toBe("a");
      expect(key.ctrl).toBe(true);
    });

    it("should parse Ctrl+C", () => {
      const key = parseKeypress(Buffer.from([3]));
      expect(key.name).toBe("c");
      expect(key.ctrl).toBe(true);
    });

    it("should parse Ctrl+Z", () => {
      const key = parseKeypress(Buffer.from([26]));
      expect(key.name).toBe("z");
      expect(key.ctrl).toBe(true);
    });
  });

  describe("Alt/Meta+key", () => {
    it("should parse Alt+letter", () => {
      const key = parseKeypress(Buffer.from("\x1ba"));
      expect(key.name).toBe("a");
      expect(key.meta).toBe(true);
    });

    it("should parse Alt+uppercase as meta+shift", () => {
      const key = parseKeypress(Buffer.from("\x1bA"));
      expect(key.name).toBe("a");
      expect(key.meta).toBe(true);
      expect(key.shift).toBe(true);
    });

    it("should parse Alt+Enter", () => {
      const key = parseKeypress(Buffer.from("\x1b\r"));
      expect(key.name).toBe("return");
      expect(key.meta).toBe(true);
    });
  });

  describe("regular characters", () => {
    it("should parse printable characters", () => {
      const key = parseKeypress(Buffer.from("a"));
      expect(key.name).toBe("a");
      expect(key.ctrl).toBe(false);
      expect(key.meta).toBe(false);
    });

    it("should detect shift for uppercase", () => {
      const key = parseKeypress(Buffer.from("A"));
      expect(key.name).toBe("A");
      expect(key.shift).toBe(true);
    });

    it("should parse numbers", () => {
      const key = parseKeypress(Buffer.from("5"));
      expect(key.name).toBe("5");
    });

    it("should parse special characters", () => {
      const key = parseKeypress(Buffer.from("!"));
      expect(key.name).toBe("!");
    });
  });

  describe("empty and unknown", () => {
    it("should handle empty buffer", () => {
      const key = parseKeypress(Buffer.from(""));
      expect(key.name).toBe("unknown");
    });
  });
});

describe("matchKey", () => {
  function makeKey(overrides: Partial<KeyEvent>): KeyEvent {
    return {
      name: "",
      ctrl: false,
      meta: false,
      shift: false,
      sequence: "",
      ...overrides,
    };
  }

  it("should match simple key name", () => {
    expect(matchKey(makeKey({ name: "a" }), "a")).toBe(true);
    expect(matchKey(makeKey({ name: "b" }), "a")).toBe(false);
  });

  it("should match Ctrl+key", () => {
    expect(matchKey(makeKey({ name: "c", ctrl: true }), "ctrl+c")).toBe(true);
    expect(matchKey(makeKey({ name: "c", ctrl: false }), "ctrl+c")).toBe(false);
  });

  it("should match Alt+key", () => {
    expect(matchKey(makeKey({ name: "a", meta: true }), "alt+a")).toBe(true);
    expect(matchKey(makeKey({ name: "a", meta: true }), "meta+a")).toBe(true);
  });

  it("should match Shift+key", () => {
    expect(matchKey(makeKey({ name: "tab", shift: true }), "shift+tab")).toBe(true);
    expect(matchKey(makeKey({ name: "tab", shift: false }), "shift+tab")).toBe(false);
  });

  it("should normalize 'enter' to 'return'", () => {
    expect(matchKey(makeKey({ name: "return" }), "enter")).toBe(true);
  });

  it("should match compound modifiers", () => {
    expect(
      matchKey(makeKey({ name: "z", ctrl: true, shift: true }), "ctrl+shift+z"),
    ).toBe(true);
  });

  it("should be case-insensitive for combo string", () => {
    expect(matchKey(makeKey({ name: "c", ctrl: true }), "Ctrl+C")).toBe(true);
  });

  it("should not match when modifier is absent", () => {
    expect(
      matchKey(makeKey({ name: "c", ctrl: true, shift: false }), "ctrl+shift+c"),
    ).toBe(false);
  });
});
