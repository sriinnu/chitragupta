import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "../src/components/editor.js";
import type { KeyEvent } from "../src/keys.js";
import type { CompletionProvider } from "../src/components/editor.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function key(name: string, mods?: Partial<KeyEvent>): KeyEvent {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: name.length === 1 ? name : "",
    ...mods,
  };
}

function charKey(ch: string): KeyEvent {
  return {
    name: ch,
    ctrl: false,
    meta: false,
    shift: ch >= "A" && ch <= "Z",
    sequence: ch,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("Editor", () => {
  describe("creation", () => {
    it("should create an empty editor", () => {
      const editor = new Editor();
      expect(editor.value).toBe("");
      expect(editor.isEmpty).toBe(true);
    });

    it("should accept initial value", () => {
      const editor = new Editor({ initialValue: "hello\nworld" });
      expect(editor.value).toBe("hello\nworld");
      expect(editor.isEmpty).toBe(false);
    });

    it("should position cursor at end of initial value", () => {
      const editor = new Editor({ initialValue: "abc" });
      expect(editor.cursorPos).toEqual({ line: 0, col: 3 });
    });
  });

  describe("text input", () => {
    it("should insert characters at cursor position", () => {
      const editor = new Editor();
      editor.handleKey(charKey("H"));
      editor.handleKey(charKey("i"));
      expect(editor.value).toBe("Hi");
      expect(editor.cursorPos.col).toBe(2);
    });

    it("should handle backspace", () => {
      const editor = new Editor({ initialValue: "abc" });
      editor.handleKey(key("backspace"));
      expect(editor.value).toBe("ab");
    });

    it("should handle delete (forward)", () => {
      const editor = new Editor({ initialValue: "abc" });
      // Move cursor to beginning
      editor.handleKey(key("home"));
      editor.handleKey(key("delete"));
      expect(editor.value).toBe("bc");
    });

    it("should merge lines on backspace at line start", () => {
      const editor = new Editor({ initialValue: "hello\nworld" });
      // Move to start of second line
      editor.handleKey(key("home"));
      editor.handleKey(key("backspace"));
      expect(editor.value).toBe("helloworld");
    });
  });

  describe("newlines", () => {
    it("should insert newline on Shift+Enter", () => {
      const editor = new Editor();
      editor.handleKey(charKey("a"));
      editor.handleKey(key("return", { shift: true }));
      editor.handleKey(charKey("b"));
      expect(editor.value).toBe("a\nb");
    });

    it("should insert newline on Alt+Enter", () => {
      const editor = new Editor();
      editor.handleKey(charKey("x"));
      editor.handleKey(key("return", { meta: true }));
      editor.handleKey(charKey("y"));
      expect(editor.value).toBe("x\ny");
    });
  });

  describe("submit", () => {
    it("should call submit handlers on Enter", () => {
      const editor = new Editor();
      const handler = vi.fn();
      editor.onSubmit(handler);
      editor.handleKey(charKey("h"));
      editor.handleKey(charKey("i"));
      editor.handleKey(key("return"));
      expect(handler).toHaveBeenCalledWith("hi");
    });
  });

  describe("cancel", () => {
    it("should call cancel handlers on Ctrl+C", () => {
      const editor = new Editor();
      const handler = vi.fn();
      editor.onCancel(handler);
      editor.handleKey(key("c", { ctrl: true }));
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("navigation", () => {
    it("should move cursor left", () => {
      const editor = new Editor({ initialValue: "abc" });
      editor.handleKey(key("left"));
      expect(editor.cursorPos.col).toBe(2);
    });

    it("should move cursor right from beginning", () => {
      const editor = new Editor({ initialValue: "abc" });
      editor.handleKey(key("home"));
      editor.handleKey(key("right"));
      expect(editor.cursorPos.col).toBe(1);
    });

    it("should move cursor up in multi-line", () => {
      const editor = new Editor({ initialValue: "line1\nline2" });
      expect(editor.cursorPos.line).toBe(1);
      editor.handleKey(key("up"));
      expect(editor.cursorPos.line).toBe(0);
    });

    it("should move cursor down", () => {
      const editor = new Editor({ initialValue: "line1\nline2" });
      editor.handleKey(key("home"));
      editor.handleKey(key("up"));
      editor.handleKey(key("down"));
      expect(editor.cursorPos.line).toBe(1);
    });

    it("should handle Home key", () => {
      const editor = new Editor({ initialValue: "hello" });
      editor.handleKey(key("home"));
      expect(editor.cursorPos.col).toBe(0);
    });

    it("should handle End key", () => {
      const editor = new Editor({ initialValue: "hello" });
      editor.handleKey(key("home"));
      editor.handleKey(key("end"));
      expect(editor.cursorPos.col).toBe(5);
    });

    it("should handle Ctrl+A (beginning of all)", () => {
      const editor = new Editor({ initialValue: "line1\nline2" });
      editor.handleKey(key("a", { ctrl: true }));
      expect(editor.cursorPos).toEqual({ line: 0, col: 0 });
    });

    it("should handle Ctrl+E (end of line)", () => {
      const editor = new Editor({ initialValue: "hello" });
      editor.handleKey(key("home"));
      editor.handleKey(key("e", { ctrl: true }));
      expect(editor.cursorPos.col).toBe(5);
    });

    it("should handle word movement (Ctrl+Left)", () => {
      const editor = new Editor({ initialValue: "hello world" });
      // Cursor at end (col 11)
      editor.handleKey(key("left", { ctrl: true }));
      // Should jump to start of "world" (col 6)
      expect(editor.cursorPos.col).toBe(6);
    });
  });

  describe("history", () => {
    it("should add entries to history", () => {
      const editor = new Editor();
      editor.addHistory("first command");
      editor.addHistory("second command");
      expect(editor.getHistory()).toEqual(["first command", "second command"]);
    });

    it("should skip empty entries", () => {
      const editor = new Editor();
      editor.addHistory("");
      editor.addHistory("   ");
      expect(editor.getHistory()).toHaveLength(0);
    });

    it("should skip consecutive duplicates", () => {
      const editor = new Editor();
      editor.addHistory("same");
      editor.addHistory("same");
      expect(editor.getHistory()).toHaveLength(1);
    });

    it("should navigate history with Up arrow on single line", () => {
      const editor = new Editor();
      editor.addHistory("old command");
      // Up arrow on empty single line should load history
      editor.handleKey(key("up"));
      expect(editor.value).toBe("old command");
    });

    it("should navigate back with Down arrow", () => {
      const editor = new Editor();
      editor.addHistory("cmd1");
      editor.addHistory("cmd2");
      editor.handleKey(key("up")); // cmd2
      editor.handleKey(key("up")); // cmd1
      editor.handleKey(key("down")); // back to cmd2
      expect(editor.value).toBe("cmd2");
    });
  });

  describe("tab completion", () => {
    it("should trigger completion on Tab", () => {
      const provider: CompletionProvider = {
        provide: () => [
          { label: "/help", insertText: "/help", description: "Show help" },
          { label: "/clear", insertText: "/clear", description: "Clear screen" },
        ],
      };
      const editor = new Editor();
      editor.registerCompletion(provider);
      editor.handleKey(charKey("/"));
      editor.handleKey(key("tab"));
      expect(editor.isCompletionActive).toBe(true);
      expect(editor.completions).toHaveLength(2);
    });

    it("should cycle completions with Tab", () => {
      const provider: CompletionProvider = {
        provide: () => [
          { label: "a", insertText: "a" },
          { label: "b", insertText: "b" },
        ],
      };
      const editor = new Editor();
      editor.registerCompletion(provider);
      editor.handleKey(key("tab")); // trigger
      expect(editor.completionSelectedIndex).toBe(0);
      editor.handleKey(key("tab")); // cycle forward
      expect(editor.completionSelectedIndex).toBe(1);
      editor.handleKey(key("tab")); // cycle wraps
      expect(editor.completionSelectedIndex).toBe(0);
    });

    it("should dismiss completion on Escape", () => {
      const provider: CompletionProvider = {
        provide: () => [{ label: "x", insertText: "x" }],
      };
      const editor = new Editor();
      editor.registerCompletion(provider);
      editor.handleKey(key("tab"));
      expect(editor.isCompletionActive).toBe(true);
      editor.handleKey(key("escape"));
      expect(editor.isCompletionActive).toBe(false);
    });

    it("should insert tab character if no completions available", () => {
      const editor = new Editor();
      editor.handleKey(key("tab"));
      expect(editor.value).toBe("\t");
    });
  });

  describe("undo/redo", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should undo last change with Ctrl+Z", () => {
      const editor = new Editor();
      editor.handleKey(charKey("a"));
      // Wait for debounce
      vi.advanceTimersByTime(400);
      editor.handleKey(charKey("b"));
      vi.advanceTimersByTime(400);
      editor.undo();
      // Should undo the last typed character(s)
      expect(editor.value.length).toBeLessThan(2);
    });

    it("should redo with Ctrl+Shift+Z", () => {
      const editor = new Editor();
      editor.handleKey(charKey("x"));
      vi.advanceTimersByTime(400);
      const valueBeforeUndo = editor.value;
      editor.undo();
      editor.redo();
      expect(editor.value).toBe(valueBeforeUndo);
    });

    it("should not crash when undoing with empty stack", () => {
      const editor = new Editor();
      editor.undo();
      expect(editor.value).toBe("");
    });

    it("should not crash when redoing with empty stack", () => {
      const editor = new Editor();
      editor.redo();
      expect(editor.value).toBe("");
    });
  });

  describe("Ctrl+K (delete to end of line)", () => {
    it("should delete from cursor to end of line", () => {
      const editor = new Editor({ initialValue: "hello world" });
      editor.handleKey(key("home"));
      editor.handleKey(key("right"));
      editor.handleKey(key("right"));
      editor.handleKey(key("right"));
      editor.handleKey(key("right"));
      editor.handleKey(key("right")); // cursor at col 5
      editor.handleKey(key("k", { ctrl: true }));
      expect(editor.value).toBe("hello");
    });
  });

  describe("Ctrl+U (delete to beginning of line)", () => {
    it("should delete from cursor to beginning of line", () => {
      const editor = new Editor({ initialValue: "hello world" });
      // Cursor at end (col 11)
      editor.handleKey(key("left"));
      editor.handleKey(key("left"));
      editor.handleKey(key("left"));
      editor.handleKey(key("left"));
      editor.handleKey(key("left")); // cursor at col 6
      editor.handleKey(key("u", { ctrl: true }));
      expect(editor.value).toBe("world");
    });
  });

  describe("value setter", () => {
    it("should set editor content programmatically", () => {
      const editor = new Editor();
      editor.value = "new content";
      expect(editor.value).toBe("new content");
    });

    it("should trigger change handler", () => {
      const editor = new Editor();
      const handler = vi.fn();
      editor.onChange(handler);
      editor.value = "changed";
      expect(handler).toHaveBeenCalledWith("changed");
    });
  });

  describe("clear()", () => {
    it("should clear editor content", () => {
      const editor = new Editor({ initialValue: "stuff" });
      editor.clear();
      expect(editor.value).toBe("");
      expect(editor.isEmpty).toBe(true);
      expect(editor.cursorPos).toEqual({ line: 0, col: 0 });
    });
  });

  describe("render()", () => {
    it("should produce an array of display lines", () => {
      const editor = new Editor({ initialValue: "hello" });
      const lines = editor.render(80);
      expect(lines.length).toBeGreaterThan(0);
    });

    it("should show placeholder when empty", () => {
      const editor = new Editor({ placeholder: "Type here..." });
      const lines = editor.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("Type here...");
    });

    it("should show line numbers for multi-line content", () => {
      const editor = new Editor({ initialValue: "line1\nline2\nline3" });
      const lines = editor.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("1");
      expect(joined).toContain("2");
      expect(joined).toContain("3");
    });
  });
});
