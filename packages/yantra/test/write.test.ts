import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeTool } from "../src/write.js";
import type { ToolContext } from "../src/types.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ size: 42 }),
    },
  };
});

const mockMkdir = vi.mocked(fs.promises.mkdir);
const mockWriteFile = vi.mocked(fs.promises.writeFile);
const mockStat = vi.mocked(fs.promises.stat);

const CTX: ToolContext = {
  sessionId: "s1",
  workingDirectory: "/project",
};

describe("writeTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 42 } as fs.Stats);
  });

  it("should have the correct definition", () => {
    expect(writeTool.definition.name).toBe("write");
    expect(writeTool.definition.inputSchema.required).toContain("path");
    expect(writeTool.definition.inputSchema.required).toContain("content");
  });

  it("should return error when path is missing", async () => {
    const result = await writeTool.execute({ content: "data" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("'path' argument is required");
  });

  it("should return error when content is missing", async () => {
    const result = await writeTool.execute({ path: "/test.ts" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("'content' argument is required");
  });

  it("should create parent directories and write the file", async () => {
    const result = await writeTool.execute({
      path: "/project/src/new/file.ts",
      content: "export const x = 1;",
    }, CTX);
    expect(mockMkdir).toHaveBeenCalledWith(
      path.dirname("/project/src/new/file.ts"),
      { recursive: true },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/src/new/file.ts",
      "export const x = 1;",
      "utf-8",
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("File written");
  });

  it("should resolve relative paths against working directory", async () => {
    await writeTool.execute({
      path: "src/file.ts",
      content: "hello",
    }, CTX);
    const expectedPath = path.resolve("/project", "src/file.ts");
    expect(mockWriteFile).toHaveBeenCalledWith(expectedPath, "hello", "utf-8");
  });

  it("should report file size and line count in output", async () => {
    mockStat.mockResolvedValue({ size: 100 } as fs.Stats);
    const result = await writeTool.execute({
      path: "/test.ts",
      content: "a\nb\nc",
    }, CTX);
    expect(result.content).toContain("100 bytes");
    expect(result.content).toContain("3 lines");
  });

  it("should handle permission denied (EACCES)", async () => {
    const err = new Error("EACCES") as NodeJS.ErrnoException;
    err.code = "EACCES";
    mockWriteFile.mockRejectedValue(err);
    const result = await writeTool.execute({
      path: "/readonly/file.ts",
      content: "data",
    }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Permission denied");
  });

  it("should include metadata in result", async () => {
    mockStat.mockResolvedValue({ size: 50 } as fs.Stats);
    const result = await writeTool.execute({
      path: "/test.ts",
      content: "hello\nworld",
    }, CTX);
    expect(result.metadata?.size).toBe(50);
    expect(result.metadata?.lines).toBe(2);
  });
});
