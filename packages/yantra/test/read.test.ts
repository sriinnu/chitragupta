import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { readTool } from "../src/read.js";
import type { ToolContext } from "../src/types.js";

// ─── Mock fs ──────────────────────────────────────────────────────────────

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

const mockReadFile = vi.mocked(fs.promises.readFile);

const CTX: ToolContext = {
  sessionId: "s1",
  workingDirectory: "/project",
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe("readTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct definition", () => {
    expect(readTool.definition.name).toBe("read");
    expect(readTool.definition.inputSchema.required).toContain("path");
  });

  it("should return error when path is missing", async () => {
    const result = await readTool.execute({}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("'path' argument is required");
  });

  it("should read a file and return numbered lines", async () => {
    mockReadFile.mockResolvedValue("line1\nline2\nline3");
    const result = await readTool.execute({ path: "/test/file.ts" }, CTX);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("1\tline1");
    expect(result.content).toContain("2\tline2");
    expect(result.content).toContain("3\tline3");
  });

  it("should resolve relative paths against working directory", async () => {
    mockReadFile.mockResolvedValue("content");
    await readTool.execute({ path: "src/file.ts" }, CTX);
    expect(mockReadFile).toHaveBeenCalledWith(
      path.resolve("/project", "src/file.ts"),
      "utf-8",
    );
  });

  it("should use absolute paths directly", async () => {
    mockReadFile.mockResolvedValue("content");
    await readTool.execute({ path: "/absolute/path.ts" }, CTX);
    expect(mockReadFile).toHaveBeenCalledWith("/absolute/path.ts", "utf-8");
  });

  it("should handle startLine and endLine range", async () => {
    mockReadFile.mockResolvedValue("a\nb\nc\nd\ne");
    const result = await readTool.execute({
      path: "/test/file.ts",
      startLine: 2,
      endLine: 4,
    }, CTX);
    expect(result.content).toContain("b");
    expect(result.content).toContain("c");
    expect(result.content).toContain("d");
    expect(result.content).not.toContain("1\ta");
    expect(result.content).not.toContain("5\te");
  });

  it("should handle file not found (ENOENT)", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockReadFile.mockRejectedValue(err);
    const result = await readTool.execute({ path: "/missing.ts" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("File not found");
  });

  it("should handle permission denied (EACCES)", async () => {
    const err = new Error("EACCES") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockReadFile.mockRejectedValue(err);
    const result = await readTool.execute({ path: "/secret.ts" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Permission denied");
  });

  it("should handle directory path (EISDIR)", async () => {
    const err = new Error("EISDIR") as NodeJS.ErrnoException;
    err.code = "EISDIR";
    mockReadFile.mockRejectedValue(err);
    const result = await readTool.execute({ path: "/dir" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("directory, not a file");
  });

  it("should truncate files exceeding MAX_LINES", async () => {
    const lines = Array.from({ length: 15_000 }, (_, i) => `line ${i + 1}`);
    mockReadFile.mockResolvedValue(lines.join("\n"));
    const result = await readTool.execute({ path: "/big.ts" }, CTX);
    expect(result.content).toContain("[Truncated: showing 10000");
    expect(result.metadata?.truncated).toBe(true);
  });

  it("should include metadata with file info", async () => {
    mockReadFile.mockResolvedValue("a\nb\nc");
    const result = await readTool.execute({ path: "/test.ts" }, CTX);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.totalLines).toBe(3);
    expect(result.metadata?.displayedLines).toBe(3);
    expect(result.metadata?.truncated).toBe(false);
  });
});
