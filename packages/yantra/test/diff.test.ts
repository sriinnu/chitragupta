import { describe, it, expect } from "vitest";
import { computeUnifiedDiff } from "../src/diff.js";

describe("computeUnifiedDiff", () => {
  it("should return empty string for identical content", () => {
    const result = computeUnifiedDiff("hello\nworld", "hello\nworld");
    expect(result).toBe("");
  });

  it("should detect added lines", () => {
    const result = computeUnifiedDiff("a\nb", "a\nb\nc");
    expect(result).toContain("+c");
    expect(result).toContain("---");
    expect(result).toContain("+++");
  });

  it("should detect deleted lines", () => {
    const result = computeUnifiedDiff("a\nb\nc", "a\nc");
    expect(result).toContain("-b");
  });

  it("should detect modified lines", () => {
    const result = computeUnifiedDiff("hello\nworld", "hello\nearth");
    expect(result).toContain("-world");
    expect(result).toContain("+earth");
  });

  it("should include context lines around changes", () => {
    const old = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10";
    const newContent = "1\n2\n3\n4\nFIVE\n6\n7\n8\n9\n10";
    const result = computeUnifiedDiff(old, newContent, "a.txt", "b.txt", 2);
    expect(result).toContain("-5");
    expect(result).toContain("+FIVE");
    // Context lines should be present (lines 3, 4 before and 6, 7 after)
    expect(result).toContain(" 3");
    expect(result).toContain(" 4");
  });

  it("should use custom labels for old and new", () => {
    const result = computeUnifiedDiff("a", "b", "original.ts", "modified.ts");
    expect(result).toContain("--- original.ts");
    expect(result).toContain("+++ modified.ts");
  });

  it("should handle empty old content (all additions)", () => {
    const result = computeUnifiedDiff("", "a\nb\nc");
    expect(result).toContain("+a");
    expect(result).toContain("+b");
    expect(result).toContain("+c");
  });

  it("should handle empty new content (all deletions)", () => {
    const result = computeUnifiedDiff("a\nb\nc", "");
    expect(result).toContain("-a");
    expect(result).toContain("-b");
    expect(result).toContain("-c");
  });

  it("should handle both empty (no diff)", () => {
    const result = computeUnifiedDiff("", "");
    expect(result).toBe("");
  });

  it("should produce hunk headers with @@ markers", () => {
    const result = computeUnifiedDiff("old line", "new line");
    expect(result).toContain("@@");
  });

  it("should handle multi-line changes correctly", () => {
    const old = "line1\nline2\nline3\nline4\nline5";
    const newContent = "line1\nLINE2\nLINE3\nline4\nline5";
    const result = computeUnifiedDiff(old, newContent);
    expect(result).toContain("-line2");
    expect(result).toContain("-line3");
    expect(result).toContain("+LINE2");
    expect(result).toContain("+LINE3");
  });

  it("should handle single-line files", () => {
    const result = computeUnifiedDiff("hello", "goodbye");
    expect(result).toContain("-hello");
    expect(result).toContain("+goodbye");
  });

  it("should respect contextLines parameter", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const newLines = [...lines];
    newLines[10] = "CHANGED";
    const result = computeUnifiedDiff(lines.join("\n"), newLines.join("\n"), "a", "b", 1);
    // With 1 context line, should show fewer surrounding lines
    expect(result).toContain("-line11");
    expect(result).toContain("+CHANGED");
  });
});
