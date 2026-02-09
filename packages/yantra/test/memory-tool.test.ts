import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { memoryTool } from "../src/memory-tool.js";
import type { ToolContext } from "../src/types.js";

vi.mock("node:fs", () => {
	const mockStat = vi.fn();
	const mockReadFile = vi.fn();
	const mockWriteFile = vi.fn();
	const mockMkdir = vi.fn();
	const mockReaddir = vi.fn();
	return {
		default: {
			promises: {
				stat: mockStat,
				readFile: mockReadFile,
				writeFile: mockWriteFile,
				mkdir: mockMkdir,
				readdir: mockReaddir,
			},
		},
		promises: {
			stat: mockStat,
			readFile: mockReadFile,
			writeFile: mockWriteFile,
			mkdir: mockMkdir,
			readdir: mockReaddir,
		},
	};
});

vi.mock("node:os", () => ({
	default: { homedir: vi.fn().mockReturnValue("/home/test") },
	homedir: vi.fn().mockReturnValue("/home/test"),
}));

const mockStat = vi.mocked(fs.promises.stat);
const mockReadFile = vi.mocked(fs.promises.readFile);
const mockWriteFile = vi.mocked(fs.promises.writeFile);
const mockMkdir = vi.mocked(fs.promises.mkdir);
const mockReaddir = vi.mocked(fs.promises.readdir);

const CTX: ToolContext = {
	sessionId: "agent-session-42",
	workingDirectory: "/project/myapp",
	signal: undefined,
};

describe("memoryTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("definition", () => {
		it("has name memory", () => {
			expect(memoryTool.definition.name).toBe("memory");
		});

		it("has a non-empty description", () => {
			expect(memoryTool.definition.description).toBeTruthy();
		});

		it("requires action and scope", () => {
			const required = memoryTool.definition.inputSchema.required as string[];
			expect(required).toContain("action");
			expect(required).toContain("scope");
		});

		it("defines action, scope, content, query in properties", () => {
			const props = memoryTool.definition.inputSchema.properties as Record<string, unknown>;
			expect(props).toHaveProperty("action");
			expect(props).toHaveProperty("scope");
			expect(props).toHaveProperty("content");
			expect(props).toHaveProperty("query");
		});
	});

	describe("validation errors", () => {
		it("returns error when action is missing", async () => {
			const result = await memoryTool.execute({ scope: "global" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("action");
		});

		it("returns error when scope is missing", async () => {
			const result = await memoryTool.execute({ action: "read" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("scope");
		});

		it("returns error for invalid action", async () => {
			const result = await memoryTool.execute({ action: "delete", scope: "global" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("Invalid action");
		});

		it("returns error for invalid scope", async () => {
			const result = await memoryTool.execute({ action: "read", scope: "universe" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("Invalid scope");
		});
	});

	describe("read action", () => {
		it("reads existing global memory file", async () => {
			mockReadFile.mockResolvedValueOnce("# Global Notes\nSome content" as any);

			const result = await memoryTool.execute({ action: "read", scope: "global" }, CTX);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("Global Notes");
			expect(result.metadata?.scope).toBe("global");
		});

		it("reads existing project memory file", async () => {
			mockReadFile.mockResolvedValueOnce("Project data" as any);

			const result = await memoryTool.execute({ action: "read", scope: "project" }, CTX);
			expect(result.content).toBe("Project data");
			expect(result.metadata?.scope).toBe("project");
		});

		it("reads existing agent memory file", async () => {
			mockReadFile.mockResolvedValueOnce("Agent state" as any);

			const result = await memoryTool.execute({ action: "read", scope: "agent" }, CTX);
			expect(result.content).toBe("Agent state");
			expect(result.metadata?.scope).toBe("agent");
		});

		it("returns friendly message for ENOENT", async () => {
			const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			mockReadFile.mockRejectedValueOnce(err);

			const result = await memoryTool.execute({ action: "read", scope: "global" }, CTX);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("No memory found");
			expect(result.metadata?.exists).toBe(false);
		});

		it("returns (empty memory file) for empty content", async () => {
			mockReadFile.mockResolvedValueOnce("" as any);

			const result = await memoryTool.execute({ action: "read", scope: "global" }, CTX);
			expect(result.content).toContain("(empty memory file)");
		});

		it("returns error for non-ENOENT read errors", async () => {
			const err = Object.assign(new Error("Permission denied"), { code: "EACCES" });
			mockReadFile.mockRejectedValueOnce(err);

			const result = await memoryTool.execute({ action: "read", scope: "global" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("Permission denied");
		});
	});

	describe("write action", () => {
		it("writes content to memory file", async () => {
			mockMkdir.mockResolvedValueOnce(undefined as any);
			mockWriteFile.mockResolvedValueOnce(undefined as any);

			const result = await memoryTool.execute(
				{ action: "write", scope: "global", content: "New content" },
				CTX,
			);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("Memory written");
			expect(result.content).toContain("global");
			expect(result.metadata?.size).toBe(11);
		});

		it("creates parent directories", async () => {
			mockMkdir.mockResolvedValueOnce(undefined as any);
			mockWriteFile.mockResolvedValueOnce(undefined as any);

			await memoryTool.execute(
				{ action: "write", scope: "project", content: "data" },
				CTX,
			);

			expect(mockMkdir).toHaveBeenCalledWith(
				expect.stringContaining("memory"),
				{ recursive: true },
			);
		});

		it("returns error when content is missing", async () => {
			const result = await memoryTool.execute(
				{ action: "write", scope: "global" },
				CTX,
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("content");
		});

		it("returns error on write failure", async () => {
			mockMkdir.mockResolvedValueOnce(undefined as any);
			mockWriteFile.mockRejectedValueOnce(new Error("Disk full"));

			const result = await memoryTool.execute(
				{ action: "write", scope: "global", content: "data" },
				CTX,
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("Disk full");
		});
	});

	describe("append action", () => {
		it("appends to existing file", async () => {
			mockMkdir.mockResolvedValueOnce(undefined as any);
			mockReadFile.mockResolvedValueOnce("Existing content" as any);
			mockWriteFile.mockResolvedValueOnce(undefined as any);

			const result = await memoryTool.execute(
				{ action: "append", scope: "global", content: "\nNew line" },
				CTX,
			);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("appended");
		});

		it("creates new file when it does not exist", async () => {
			mockMkdir.mockResolvedValueOnce(undefined as any);
			mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
			mockWriteFile.mockResolvedValueOnce(undefined as any);

			const result = await memoryTool.execute(
				{ action: "append", scope: "global", content: "First entry" },
				CTX,
			);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("appended");
		});

		it("adds newline separator when existing file does not end with newline", async () => {
			mockMkdir.mockResolvedValueOnce(undefined as any);
			mockReadFile.mockResolvedValueOnce("no trailing newline" as any);
			mockWriteFile.mockResolvedValueOnce(undefined as any);

			await memoryTool.execute(
				{ action: "append", scope: "global", content: "more" },
				CTX,
			);

			expect(mockWriteFile).toHaveBeenCalledWith(
				expect.any(String),
				"no trailing newline\nmore",
				"utf-8",
			);
		});

		it("returns error when content is missing for append", async () => {
			const result = await memoryTool.execute(
				{ action: "append", scope: "global" },
				CTX,
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("content");
		});
	});

	describe("search action", () => {
		it("returns matching lines from memory files", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce(["global.md"] as any);
			mockStat.mockResolvedValueOnce({ isFile: () => true } as any);
			mockReadFile.mockResolvedValueOnce("line one\ntarget line\nline three" as any);

			const result = await memoryTool.execute(
				{ action: "search", scope: "global", query: "target" },
				CTX,
			);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("target line");
			expect(result.metadata?.matchCount).toBe(1);
		});

		it("returns no-matches message when nothing found", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce(["global.md"] as any);
			mockStat.mockResolvedValueOnce({ isFile: () => true } as any);
			mockReadFile.mockResolvedValueOnce("no relevant content here" as any);

			const result = await memoryTool.execute(
				{ action: "search", scope: "global", query: "zzzzz" },
				CTX,
			);
			expect(result.content).toContain("No matches");
			expect(result.metadata?.matchCount).toBe(0);
		});

		it("returns error when query is missing", async () => {
			const result = await memoryTool.execute(
				{ action: "search", scope: "global" },
				CTX,
			);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("query");
		});

		it("returns empty results when search directory does not exist", async () => {
			mockStat.mockRejectedValueOnce(new Error("ENOENT"));

			const result = await memoryTool.execute(
				{ action: "search", scope: "project", query: "test" },
				CTX,
			);
			expect(result.content).toContain("No matches");
		});

		it("is case-insensitive", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce(["notes.md"] as any);
			mockStat.mockResolvedValueOnce({ isFile: () => true } as any);
			mockReadFile.mockResolvedValueOnce("HELLO World\nhello world" as any);

			const result = await memoryTool.execute(
				{ action: "search", scope: "global", query: "HELLO" },
				CTX,
			);
			expect(result.metadata?.matchCount).toBe(2);
		});
	});

	describe("scope path resolution", () => {
		it("global scope resolves to ~/.chitragupta/memory/global.md", async () => {
			mockReadFile.mockResolvedValueOnce("data" as any);

			await memoryTool.execute({ action: "read", scope: "global" }, CTX);

			expect(mockReadFile).toHaveBeenCalledWith(
				path.join("/home/test", ".chitragupta", "memory", "global.md"),
				"utf-8",
			);
		});

		it("project scope uses project directory basename", async () => {
			mockReadFile.mockResolvedValueOnce("data" as any);

			await memoryTool.execute({ action: "read", scope: "project" }, CTX);

			expect(mockReadFile).toHaveBeenCalledWith(
				path.join("/home/test", ".chitragupta", "memory", "projects", "myapp.md"),
				"utf-8",
			);
		});

		it("agent scope uses sessionId", async () => {
			mockReadFile.mockResolvedValueOnce("data" as any);

			await memoryTool.execute({ action: "read", scope: "agent" }, CTX);

			expect(mockReadFile).toHaveBeenCalledWith(
				path.join("/home/test", ".chitragupta", "memory", "agents", "agent-session-42.md"),
				"utf-8",
			);
		});
	});
});
