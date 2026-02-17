import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { editTool } from "../src/edit.js";
import type { ToolContext } from "../src/types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const mockReadFile = vi.mocked(fs.promises.readFile);
const mockWriteFile = vi.mocked(fs.promises.writeFile);

const CTX: ToolContext = {
  sessionId: "s1",
  workingDirectory: "/project",
};

describe("editTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct definition", () => {
    expect(editTool.definition.name).toBe("edit");
  });

  it("should return error when path is missing", async () => {
    const result = await editTool.execute({ edits: [] }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("'path' argument is required");
  });

  it("should return error when edits is empty", async () => {
    const result = await editTool.execute({ path: "/test.ts", edits: [] }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("non-empty array");
  });

  it("should return error when edits is not an array", async () => {
    const result = await editTool.execute({ path: "/test.ts", edits: "bad" }, CTX);
    expect(result.isError).toBe(true);
  });

  it("should perform a simple search and replace", async () => {
    mockReadFile.mockResolvedValue("const x = 1;\nconst y = 2;");
    const result = await editTool.execute({
      path: "/test.ts",
      edits: [{ oldText: "const x = 1;", newText: "const x = 42;" }],
    }, CTX);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("Applied 1 edit(s)");
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/test.ts",
      "const x = 42;\nconst y = 2;",
      "utf-8",
    );
  });

  it("should apply multiple edits in sequence", async () => {
    mockReadFile.mockResolvedValue("aaa bbb ccc");
    const result = await editTool.execute({
      path: "/test.ts",
      edits: [
        { oldText: "aaa", newText: "AAA" },
        { oldText: "ccc", newText: "CCC" },
      ],
    }, CTX);
    expect(result.content).toContain("Applied 2 edit(s)");
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/test.ts",
      "AAA bbb CCC",
      "utf-8",
    );
  });

  it("should return error if oldText is not found", async () => {
    mockReadFile.mockResolvedValue("hello world");
    const result = await editTool.execute({
      path: "/test.ts",
      edits: [{ oldText: "missing text", newText: "replaced" }],
    }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("oldText not found");
  });

  it("should return error if oldText appears multiple times (ambiguous)", async () => {
    mockReadFile.mockResolvedValue("foo bar foo baz");
    const result = await editTool.execute({
      path: "/test.ts",
      edits: [{ oldText: "foo", newText: "qux" }],
    }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("multiple times");
  });

  it("should handle file not found (ENOENT)", async () => {
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockReadFile.mockRejectedValue(err);
    const result = await editTool.execute({
      path: "/missing.ts",
      edits: [{ oldText: "a", newText: "b" }],
    }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("File not found");
  });

  it("should include diff output in successful result", async () => {
    mockReadFile.mockResolvedValue("old line");
    const result = await editTool.execute({
      path: "/test.ts",
      edits: [{ oldText: "old line", newText: "new line" }],
    }, CTX);
    expect(result.content).toContain("- old line");
    expect(result.content).toContain("+ new line");
  });

  it("should return error for edit with missing oldText property", async () => {
    mockReadFile.mockResolvedValue("content");
    const result = await editTool.execute({
      path: "/test.ts",
      edits: [{ newText: "new" }],
    }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("missing 'oldText'");
  });
});
