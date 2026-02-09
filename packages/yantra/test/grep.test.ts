import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { grepTool } from "../src/grep.js";
import type { ToolContext } from "../src/types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      readFile: vi.fn(),
      readdir: vi.fn(),
    },
    createReadStream: vi.fn(),
  };
});

const mockStat = vi.mocked(fs.promises.stat);
const mockReadFile = vi.mocked(fs.promises.readFile);
const mockReaddir = vi.mocked(fs.promises.readdir);

const CTX: ToolContext = {
  sessionId: "s1",
  workingDirectory: "/project",
};

describe("grepTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct definition", () => {
    expect(grepTool.definition.name).toBe("grep");
    expect(grepTool.definition.inputSchema.required).toContain("pattern");
  });

  it("should return error when pattern is missing", async () => {
    const result = await grepTool.execute({}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("'pattern' argument is required");
  });

  it("should return error for invalid regex", async () => {
    const result = await grepTool.execute({ pattern: "[invalid" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid regex pattern");
  });

  it("should search a single file for pattern matches", async () => {
    mockStat.mockResolvedValue({ isFile: () => true, isDirectory: () => false, size: 100 } as any);
    mockReadFile.mockResolvedValue("foo bar\nbaz qux\nfoo baz\n");
    const result = await grepTool.execute({
      pattern: "foo",
      path: "/project/file.ts",
    }, CTX);
    expect(result.content).toContain("foo bar");
    expect(result.content).toContain("foo baz");
    expect(result.metadata?.matchCount).toBe(2);
  });

  it("should return no matches message when nothing matches", async () => {
    mockStat.mockResolvedValue({ isFile: () => true, isDirectory: () => false, size: 100 } as any);
    mockReadFile.mockResolvedValue("nothing here");
    const result = await grepTool.execute({
      pattern: "zzz",
      path: "/project/file.ts",
    }, CTX);
    expect(result.content).toContain("No matches found");
  });

  it("should handle ENOENT for search path", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockStat.mockRejectedValue(err);
    const result = await grepTool.execute({
      pattern: "test",
      path: "/missing/path",
    }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Path not found");
  });

  it("should search a directory recursively", async () => {
    // Directory stat
    mockStat.mockImplementation(async (p: fs.PathLike) => {
      const pathStr = String(p);
      if (pathStr === "/project") {
        return { isFile: () => false, isDirectory: () => true } as any;
      }
      // File stats for size check
      return { isFile: () => true, isDirectory: () => false, size: 50 } as any;
    });
    // readdir returns one file
    mockReaddir.mockResolvedValue([
      { name: "test.ts", isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false } as any,
    ]);
    mockReadFile.mockResolvedValue("const hello = 'world';");

    const result = await grepTool.execute({
      pattern: "hello",
    }, CTX);
    expect(result.content).toContain("hello");
  });

  it("should respect maxResults limit", async () => {
    mockStat.mockResolvedValue({ isFile: () => true, isDirectory: () => false, size: 100 } as any);
    // 100 lines that all match
    const lines = Array.from({ length: 100 }, (_, i) => `match ${i}`);
    mockReadFile.mockResolvedValue(lines.join("\n"));
    const result = await grepTool.execute({
      pattern: "match",
      path: "/project/big.ts",
      maxResults: 5,
    }, CTX);
    expect(result.metadata?.matchCount).toBe(5);
    expect(result.content).toContain("Results capped at 5");
  });

  it("should support inverted matching", async () => {
    mockStat.mockResolvedValue({ isFile: () => true, isDirectory: () => false, size: 100 } as any);
    mockReadFile.mockResolvedValue("aaa\nbbb\naaa\nccc");
    const result = await grepTool.execute({
      pattern: "aaa",
      path: "/project/file.ts",
      invert: true,
    }, CTX);
    expect(result.content).toContain("bbb");
    expect(result.content).toContain("ccc");
    expect(result.metadata?.matchCount).toBe(2);
  });
});
