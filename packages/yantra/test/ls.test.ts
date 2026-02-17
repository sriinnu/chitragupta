import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { lsTool } from "../src/ls.js";
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

describe("lsTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("definition", () => {
		it("has name ls", () => {
			expect(lsTool.definition.name).toBe("ls");
		});

		it("has a non-empty description", () => {
			expect(lsTool.definition.description).toBeTruthy();
		});

		it("has inputSchema with path, recursive, maxDepth", () => {
			const props = lsTool.definition.inputSchema.properties as Record<string, unknown>;
			expect(props).toHaveProperty("path");
			expect(props).toHaveProperty("recursive");
			expect(props).toHaveProperty("maxDepth");
		});

		it("has no required fields", () => {
			expect(lsTool.definition.inputSchema.required).toBeUndefined();
		});
	});

	describe("validation errors", () => {
		it("returns error when path not found", async () => {
			const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			mockStat.mockRejectedValueOnce(err);

			const result = await lsTool.execute({ path: "/nonexistent" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("not found");
		});

		it("returns error when path is not a directory", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => false } as any);

			const result = await lsTool.execute({ path: "/project/file.txt" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("not a directory");
		});

		it("returns error with message for other stat errors", async () => {
			const err = Object.assign(new Error("Permission denied"), { code: "EACCES" });
			mockStat.mockRejectedValueOnce(err);

			const result = await lsTool.execute({ path: "/restricted" }, CTX);
			expect(result.isError).toBe(true);
			expect(result.content).toContain("Permission denied");
		});
	});

	function setupDir(entries: Array<{ name: string; isDir: boolean; size?: number }>) {
		mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);

		const dirents = entries.map((e) => ({
			name: e.name,
			isDirectory: () => e.isDir,
			isFile: () => !e.isDir,
			isSymbolicLink: () => false,
		}));
		mockReaddir.mockResolvedValueOnce(dirents as any);

		for (const e of entries) {
			if (!e.isDir) {
				mockStat.mockResolvedValueOnce({ size: e.size ?? 0 } as any);
			}
		}
	}

	describe("non-recursive listing", () => {
		it("lists files in a directory", async () => {
			setupDir([
				{ name: "readme.md", isDir: false, size: 1024 },
				{ name: "index.ts", isDir: false, size: 256 },
			]);

			const result = await lsTool.execute({}, CTX);
			expect(result.isError).toBeUndefined();
			expect(result.content).toContain("index.ts");
			expect(result.content).toContain("readme.md");
		});

		it("sorts directories first, then files alphabetically", async () => {
			setupDir([
				{ name: "zebra.ts", isDir: false, size: 100 },
				{ name: "alpha", isDir: true },
				{ name: "beta.ts", isDir: false, size: 200 },
				{ name: "delta", isDir: true },
			]);

			const result = await lsTool.execute({}, CTX);
			const lines = result.content.split("\n").filter((l) => l.trim().length > 0);
			const alphaIdx = lines.findIndex((l) => l.includes("alpha"));
			const deltaIdx = lines.findIndex((l) => l.includes("delta"));
			const betaIdx = lines.findIndex((l) => l.includes("beta.ts"));
			const zebraIdx = lines.findIndex((l) => l.includes("zebra.ts"));

			expect(alphaIdx).toBeLessThan(betaIdx);
			expect(deltaIdx).toBeLessThan(betaIdx);
			expect(alphaIdx).toBeLessThan(zebraIdx);
		});

		it("shows directory indicator /", async () => {
			setupDir([{ name: "src", isDir: true }]);

			const result = await lsTool.execute({}, CTX);
			expect(result.content).toContain("src/");
		});

		it("includes file sizes", async () => {
			setupDir([{ name: "big.bin", isDir: false, size: 2048 }]);

			const result = await lsTool.execute({}, CTX);
			expect(result.content).toContain("2.0 KB");
		});
	});

	describe("formatSize via ls output", () => {
		it("displays bytes for small files", async () => {
			setupDir([{ name: "tiny.txt", isDir: false, size: 42 }]);
			const result = await lsTool.execute({}, CTX);
			expect(result.content).toContain("42 B");
		});

		it("displays KB for kilobyte-range files", async () => {
			setupDir([{ name: "mid.txt", isDir: false, size: 1536 }]);
			const result = await lsTool.execute({}, CTX);
			expect(result.content).toContain("1.5 KB");
		});

		it("displays MB for megabyte-range files", async () => {
			setupDir([{ name: "big.dat", isDir: false, size: 2 * 1024 * 1024 }]);
			const result = await lsTool.execute({}, CTX);
			expect(result.content).toContain("2.0 MB");
		});

		it("displays GB for gigabyte-range files", async () => {
			setupDir([{ name: "huge.img", isDir: false, size: 3 * 1024 * 1024 * 1024 }]);
			const result = await lsTool.execute({}, CTX);
			expect(result.content).toContain("3.0 GB");
		});
	});

	describe("recursive listing", () => {
		it("lists nested directories when recursive is true", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);

			mockReaddir.mockResolvedValueOnce([
				{ name: "src", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
				{ name: "index.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
			] as any);
			mockStat.mockResolvedValueOnce({ size: 100 } as any);

			mockReaddir.mockResolvedValueOnce([
				{ name: "app.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
			] as any);
			mockStat.mockResolvedValueOnce({ size: 200 } as any);

			const result = await lsTool.execute({ recursive: true, maxDepth: 2 }, CTX);
			expect(result.content).toContain("src");
			expect(result.content).toContain("index.ts");
			expect(result.content).toContain("app.ts");
		});
	});

	describe("empty directory", () => {
		it("returns message for empty directory", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([] as any);

			const result = await lsTool.execute({}, CTX);
			expect(result.content).toContain("empty");
			expect(result.metadata?.entryCount).toBe(0);
		});
	});

	describe("MAX_ENTRIES cap", () => {
		it("caps at MAX_ENTRIES (2000)", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);

			const entries = Array.from({ length: 2100 }, (_, i) => ({
				name: `file${i}.ts`,
				isDirectory: () => false,
				isFile: () => true,
				isSymbolicLink: () => false,
			}));
			mockReaddir.mockResolvedValueOnce(entries as any);

			for (let i = 0; i < 2100; i++) {
				mockStat.mockResolvedValueOnce({ size: 100 } as any);
			}

			const result = await lsTool.execute({}, CTX);
			expect(result.metadata?.capped).toBe(true);
			expect(result.content).toContain("capped at 2000");
		});
	});

	describe("path resolution", () => {
		it("resolves relative path from working directory", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([] as any);

			await lsTool.execute({ path: "src" }, CTX);
			expect(mockStat).toHaveBeenCalledWith(path.resolve("/project", "src"));
		});

		it("uses working directory when no path given", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([] as any);

			await lsTool.execute({}, CTX);
			expect(mockStat).toHaveBeenCalledWith("/project");
		});

		it("uses absolute path as-is", async () => {
			mockStat.mockResolvedValueOnce({ isDirectory: () => true } as any);
			mockReaddir.mockResolvedValueOnce([] as any);

			await lsTool.execute({ path: "/absolute/path" }, CTX);
			expect(mockStat).toHaveBeenCalledWith("/absolute/path");
		});
	});
});
