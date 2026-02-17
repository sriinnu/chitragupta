import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { findTool } from "../src/find.js";
import type { ToolContext } from "../src/types.js";

vi.mock("node:fs", () => {
	const mockReaddir = vi.fn();
	const mockStat = vi.fn();
	return {
		default: { promises: { readdir: mockReaddir, stat: mockStat } },
		promises: { readdir: mockReaddir, stat: mockStat },
	};
});

const mockReaddir = vi.mocked(fs.promises.readdir);
const mockStat = vi.mocked(fs.promises.stat);

const CTX: ToolContext = {
	sessionId: "test-session",
	workingDirectory: "/project",
	signal: undefined,
};

describe("findTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("definition", () => {
		it("has name find", () => {
			expect(findTool.definition.name).toBe("find");
		});

		it("has a non-empty description", () => {
			expect(findTool.definition.description).toBeTruthy();
			expect(typeof findTool.definition.description).toBe("string");
		});

		it("has inputSchema with patterns as required", () => {
			const schema = findTool.definition.inputSchema;
			expect(schema.type).toBe("object");
			expect(schema.required).toContain("patterns");
		});

		it("defines patterns, path, maxResults in properties", () => {
			const props = findTool.definition.inputSchema.properties as Record<string, unknown>;
			expect(props).toHaveProperty("patterns");
			expect(props).toHaveProperty("path");
			expect(props).toHaveProperty("maxResults");
		});
	});

	describe("validation errors", () => {
		it("returns error when patterns is undefined", async () => {
			const result = await findTool.execute({}, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("patterns");
		});

		it("returns error when patterns is empty array", async () => {
			const result = await findTool.execute({ patterns: [] }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("patterns");
		});

		it("returns error when patterns is not an array", async () => {
			const result = await findTool.execute({ patterns: "*.ts" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("patterns");
		});

		it("returns error when path does not exist", async () => {
			const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			mockStat.mockRejectedValueOnce(err);

			const result = await findTool.execute({ patterns: ["*.ts"], path: "/nonexistent" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("not found");
		});

		it("returns error when path is not a directory", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => false } as any);

			const result = await findTool.execute({ patterns: ["*.ts"], path: "/project/file.txt" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("not a directory");
		});
	});

	function setupTree(files: string[]) {
		mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
		const dirents = files.map((f) => ({
			name: f,
			isDirectory: () => false,
			isFile: () => true,
			isSymbolicLink: () => false,
		}));
		mockReaddir.mockResolvedValueOnce(dirents as any);
	}

	describe("glob matching", () => {
		it("matches *.ts pattern", async () => {
			setupTree(["app.ts", "app.js", "utils.ts", "readme.md"]);

			const result = await findTool.execute({ patterns: ["*.ts"] }, CTX);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("app.ts");
			expect(result.content).toContain("utils.ts");
			expect(result.content).not.toContain("app.js");
			expect(result.content).not.toContain("readme.md");
		});

		it("matches **/*.ts recursive pattern", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([
				{ name: "src", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
				{ name: "index.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
			] as any);
			mockReaddir.mockResolvedValueOnce([
				{ name: "app.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
				{ name: "app.js", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
			] as any);

			const result = await findTool.execute({ patterns: ["**/*.ts"] }, CTX);
			expect(result.content).toContain("app.ts");
			expect(result.content).toContain("index.ts");
			expect(result.content).not.toContain("app.js");
		});

		it("matches brace expansion {ts,tsx}", async () => {
			setupTree(["app.ts", "comp.tsx", "style.css", "main.js"]);

			const result = await findTool.execute({ patterns: ["*.{ts,tsx}"] }, CTX);
			expect(result.content).toContain("app.ts");
			expect(result.content).toContain("comp.tsx");
			expect(result.content).not.toContain("style.css");
			expect(result.content).not.toContain("main.js");
		});

		it("combines multiple patterns with OR logic", async () => {
			setupTree(["app.ts", "style.css", "index.html", "main.js"]);

			const result = await findTool.execute({ patterns: ["*.ts", "*.css"] }, CTX);
			expect(result.content).toContain("app.ts");
			expect(result.content).toContain("style.css");
			expect(result.content).not.toContain("index.html");
		});

		it("matches ? single-character wildcard", async () => {
			setupTree(["a.ts", "ab.ts", "abc.ts"]);

			const result = await findTool.execute({ patterns: ["?.ts"] }, CTX);
			expect(result.content).toContain("a.ts");
			expect(result.content).not.toContain("ab.ts");
			expect(result.content).not.toContain("abc.ts");
		});
	});

	describe("maxResults", () => {
		it("caps results at maxResults", async () => {
			const files = Array.from({ length: 50 }, (_, i) => `file${i}.ts`);
			setupTree(files);

			const result = await findTool.execute({ patterns: ["*.ts"], maxResults: 5 }, CTX);
			const lines = result.content.split("\n").filter((l) => l.includes(".ts"));
			expect(lines.length).toBeLessThanOrEqual(5);
			expect(result.content).toContain("capped at 5");
		});

		it("defaults to 200 maxResults", async () => {
			setupTree(["a.ts"]);
			const result = await findTool.execute({ patterns: ["*.ts"] }, CTX);
			expect(result.metadata?.matchCount).toBe(1);
		});

		it("includes capped metadata when results are capped", async () => {
			const files = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
			setupTree(files);

			const result = await findTool.execute({ patterns: ["*.ts"], maxResults: 3 }, CTX);
			expect(result.metadata?.capped).toBe(true);
		});
	});

	describe("SKIP_DIRS", () => {
		it("skips node_modules directory", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([
				{ name: "node_modules", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
				{ name: "src", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
			] as any);
			mockReaddir.mockResolvedValueOnce([
				{ name: "app.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
			] as any);

			const result = await findTool.execute({ patterns: ["**/*.ts"] }, CTX);
			expect(mockReaddir).toHaveBeenCalledTimes(2);
			expect(result.content).toContain("app.ts");
		});

		it("skips .git directory", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([
				{ name: ".git", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
				{ name: "app.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
			] as any);

			const result = await findTool.execute({ patterns: ["**/*.ts"] }, CTX);
			expect(mockReaddir).toHaveBeenCalledTimes(1);
			expect(result.content).toContain("app.ts");
		});
	});

	describe("empty results", () => {
		it("returns informative message when no files match", async () => {
			setupTree(["readme.md", "license.txt"]);

			const result = await findTool.execute({ patterns: ["*.ts"] }, CTX);
			expect(result.content).toContain("No files found");
			expect(result.metadata?.matchCount).toBe(0);
		});

		it("returns informative message for empty directory", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([] as any);

			const result = await findTool.execute({ patterns: ["*.ts"] }, CTX);
			expect(result.content).toContain("No files found");
		});
	});

	describe("path resolution", () => {
		it("resolves relative path from working directory", async () => {
			setupTree(["a.ts"]);

			await findTool.execute({ patterns: ["*.ts"], path: "src" }, CTX);
			expect(mockStat).toHaveBeenCalledWith(path.resolve("/project", "src"));
		});

		it("uses absolute path as-is", async () => {
			setupTree(["a.ts"]);

			await findTool.execute({ patterns: ["*.ts"], path: "/absolute/dir" }, CTX);
			expect(mockStat).toHaveBeenCalledWith("/absolute/dir");
		});
	});
});
