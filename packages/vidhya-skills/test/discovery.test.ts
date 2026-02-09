import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockClose = vi.fn();

vi.mock("node:fs", () => ({
	accessSync: vi.fn(),
	watch: vi.fn(() => ({
		close: mockClose,
	})),
	promises: {
		readFile: vi.fn(),
		readdir: vi.fn(),
	},
}));

vi.mock("../src/parser.js", () => ({
	parseSkillMarkdown: vi.fn(),
}));

import * as fs from "node:fs";
import { parseSkillMarkdown } from "../src/parser.js";
import { SkillDiscovery } from "../src/discovery.js";
import type { SkillManifest } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeManifest(name: string): SkillManifest {
	return {
		name,
		version: "1.0.0",
		description: `The ${name} skill`,
		capabilities: [{ verb: "do", object: "thing", description: "does thing" }],
		tags: ["test"],
		source: { type: "manual", filePath: `/skills/${name}/skill.md` },
		updatedAt: new Date().toISOString(),
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SkillDiscovery", () => {
	let discovery: SkillDiscovery;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClose.mockClear();
		discovery = new SkillDiscovery();
	});

	// ── discoverFromDirectory ────────────────────────────────────────────

	describe("discoverFromDirectory", () => {
		it("should return empty array for nonexistent directory", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {
				throw new Error("ENOENT");
			});

			const result = await discovery.discoverFromDirectory("/nonexistent");
			expect(result).toEqual([]);
		});

		it("should find and parse skill.md files recursively", async () => {
			// accessSync succeeds (directory exists)
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			// Simulate directory tree: /skills/ contains a subdir with skill.md
			vi.mocked(fs.promises.readdir)
				.mockResolvedValueOnce([
					{ name: "sub", isDirectory: () => true, isFile: () => false },
				] as any)
				.mockResolvedValueOnce([
					{ name: "skill.md", isDirectory: () => false, isFile: () => true },
				] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("---\nname: test\n---\n");
			vi.mocked(parseSkillMarkdown).mockReturnValue(makeManifest("test"));

			const result = await discovery.discoverFromDirectory("/skills");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("test");
		});

		it("should find SKILL.md files (uppercase) via case-insensitive match", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: "SKILL.md", isDirectory: () => false, isFile: () => true },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("---\nname: upper\n---\n");
			vi.mocked(parseSkillMarkdown).mockReturnValue(makeManifest("upper"));

			const result = await discovery.discoverFromDirectory("/skills");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("upper");
		});

		it("should skip files that are not named skill.md", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: "readme.md", isDirectory: () => false, isFile: () => true },
				{ name: "skill.md", isDirectory: () => false, isFile: () => true },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("content");
			vi.mocked(parseSkillMarkdown).mockReturnValue(makeManifest("found"));

			const result = await discovery.discoverFromDirectory("/skills");
			expect(result).toHaveLength(1);
			expect(fs.promises.readFile).toHaveBeenCalledTimes(1);
		});

		it("should skip unparseable files without throwing", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: "skill.md", isDirectory: () => false, isFile: () => true },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("bad content");
			vi.mocked(parseSkillMarkdown).mockImplementation(() => {
				throw new Error("Parse error");
			});

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const result = await discovery.discoverFromDirectory("/skills");
			expect(result).toEqual([]);
			warnSpy.mockRestore();
		});

		it("should skip node_modules directories", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: "node_modules", isDirectory: () => true, isFile: () => false },
				{ name: "skill.md", isDirectory: () => false, isFile: () => true },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("content");
			vi.mocked(parseSkillMarkdown).mockReturnValue(makeManifest("root"));

			const result = await discovery.discoverFromDirectory("/project");
			expect(result).toHaveLength(1);
			// readdir should only be called once (for root), not for node_modules
			expect(fs.promises.readdir).toHaveBeenCalledTimes(1);
		});

		it("should skip hidden directories", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: ".git", isDirectory: () => true, isFile: () => false },
				{ name: "skill.md", isDirectory: () => false, isFile: () => true },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("content");
			vi.mocked(parseSkillMarkdown).mockReturnValue(makeManifest("root"));

			const result = await discovery.discoverFromDirectory("/project");
			expect(result).toHaveLength(1);
		});
	});

	// ── discoverFromNodeModules ──────────────────────────────────────────

	describe("discoverFromNodeModules", () => {
		it("should return empty when node_modules does not exist", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {
				throw new Error("ENOENT");
			});

			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});

		it("should find packages with 'chitragupta-skill' keyword", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {}); // everything exists
			vi.mocked(fs.promises.readdir)
				.mockResolvedValueOnce([
					{ name: "my-skill-pkg", isDirectory: () => true, isFile: () => false },
				] as any)
				.mockResolvedValueOnce(["package.json", "skill.md"] as any); // findSkillMdInDir readdir
			vi.mocked(fs.promises.readFile)
				.mockResolvedValueOnce(JSON.stringify({ keywords: ["chitragupta-skill"] })) // package.json
				.mockResolvedValueOnce("---\nname: pkg-skill\n---\n"); // skill.md
			vi.mocked(parseSkillMarkdown).mockReturnValue(makeManifest("pkg-skill"));

			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("pkg-skill");
		});

		it("should skip packages without 'chitragupta-skill' keyword", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: "other-pkg", isDirectory: () => true, isFile: () => false },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValueOnce(
				JSON.stringify({ keywords: ["unrelated"] }),
			);

			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});

		it("should handle scoped packages", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir)
				.mockResolvedValueOnce([
					{ name: "@scope", isDirectory: () => true, isFile: () => false },
				] as any)
				.mockResolvedValueOnce([
					{ name: "skill-pkg", isDirectory: () => true, isFile: () => false },
				] as any)
				.mockResolvedValueOnce(["package.json", "SKILL.md"] as any); // findSkillMdInDir readdir (uppercase)
			vi.mocked(fs.promises.readFile)
				.mockResolvedValueOnce(JSON.stringify({ keywords: ["chitragupta-skill"] }))
				.mockResolvedValueOnce("skill content");
			vi.mocked(parseSkillMarkdown).mockReturnValue(makeManifest("scoped-skill"));

			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("scoped-skill");
		});

		it("should skip packages without skill.md even with keyword", async () => {
			vi.mocked(fs.accessSync).mockImplementation((p: any) => {
				const pathStr = typeof p === "string" ? p : p.toString();
				if (pathStr.endsWith("skill.md")) {
					throw new Error("ENOENT");
				}
			});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: "keyword-only", isDirectory: () => true, isFile: () => false },
			] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValueOnce(
				JSON.stringify({ keywords: ["chitragupta-skill"] }),
			);

			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});

		it("should skip non-directory entries in node_modules", async () => {
			vi.mocked(fs.accessSync).mockImplementation(() => {});
			vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
				{ name: ".package-lock.json", isDirectory: () => false, isFile: () => true },
			] as any);

			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});
	});

	// ── discoverAll ──────────────────────────────────────────────────────

	describe("discoverAll", () => {
		it("should combine results from directory and npm scans", async () => {
			// Mock: first path has 1 dir skill, no npm; second path same
			vi.mocked(fs.accessSync).mockImplementation((p: any) => {
				const pathStr = typeof p === "string" ? p : p.toString();
				if (pathStr.includes("node_modules")) {
					throw new Error("ENOENT");
				}
			});
			vi.mocked(fs.promises.readdir)
				.mockResolvedValueOnce([
					{ name: "skill.md", isDirectory: () => false, isFile: () => true },
				] as any)
				.mockResolvedValueOnce([
					{ name: "skill.md", isDirectory: () => false, isFile: () => true },
				] as any);
			vi.mocked(fs.promises.readFile).mockResolvedValue("content");
			vi.mocked(parseSkillMarkdown)
				.mockReturnValueOnce(makeManifest("skill-a"))
				.mockReturnValueOnce(makeManifest("skill-b"));

			const result = await discovery.discoverAll(["/path-a", "/path-b"]);
			expect(result).toHaveLength(2);
		});

		it("should return empty when no paths provided", async () => {
			const result = await discovery.discoverAll([]);
			expect(result).toEqual([]);
		});
	});

	// ── watchDirectory ───────────────────────────────────────────────────

	describe("watchDirectory", () => {
		it("should call fs.watch with recursive option", () => {
			const onChange = vi.fn();
			discovery.watchDirectory("/skills", onChange);
			expect(fs.watch).toHaveBeenCalledWith(
				"/skills",
				{ recursive: true },
				expect.any(Function),
			);
		});

		it("should return a cleanup function", () => {
			const onChange = vi.fn();
			const cleanup = discovery.watchDirectory("/skills", onChange);
			expect(typeof cleanup).toBe("function");
		});

		it("cleanup function should close the watcher", () => {
			const onChange = vi.fn();
			const cleanup = discovery.watchDirectory("/skills", onChange);
			cleanup();
			expect(mockClose).toHaveBeenCalled();
		});

		it("should return no-op cleanup when watch fails", () => {
			vi.mocked(fs.watch).mockImplementationOnce(() => {
				throw new Error("ENOENT");
			});
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const onChange = vi.fn();
			const cleanup = discovery.watchDirectory("/nonexistent", onChange);
			expect(typeof cleanup).toBe("function");
			cleanup(); // should not throw
			warnSpy.mockRestore();
		});
	});

	// ── stopWatching ─────────────────────────────────────────────────────

	describe("stopWatching", () => {
		it("should close all active watchers", () => {
			const onChange = vi.fn();
			discovery.watchDirectory("/skills-a", onChange);
			discovery.watchDirectory("/skills-b", onChange);

			discovery.stopWatching();
			expect(mockClose).toHaveBeenCalledTimes(2);
		});

		it("should do nothing when no watchers exist", () => {
			discovery.stopWatching();
			expect(mockClose).not.toHaveBeenCalled();
		});
	});
});
