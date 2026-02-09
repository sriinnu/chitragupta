import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
	return {
		readdir: vi.fn(),
		stat: vi.fn(),
		join: vi.fn((...parts: string[]) => parts.join("/")),
		pathToFileURL: vi.fn((p: string) => ({ href: `file://${p}` })),
	};
});

vi.mock("node:fs/promises", () => ({
	readdir: mocks.readdir,
	stat: mocks.stat,
}));

vi.mock("node:path", () => ({
	join: mocks.join,
}));

vi.mock("node:url", () => ({
	pathToFileURL: mocks.pathToFileURL,
}));

// ─── SUT Import ─────────────────────────────────────────────────────────────

import {
	loadPlugins,
	listInstalledPlugins,
	getPluginDir,
} from "../src/plugin-loader.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

interface MockDirent {
	name: string;
	isFile: () => boolean;
	isDirectory: () => boolean;
}

function makeDirent(name: string, type: "file" | "dir"): MockDirent {
	return {
		name,
		isFile: () => type === "file",
		isDirectory: () => type === "dir",
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Plugin Loader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// getPluginDir
	// ═══════════════════════════════════════════════════════════════════════

	describe("getPluginDir", () => {
		it("should return a path containing .chitragupta and plugins", () => {
			const dir = getPluginDir();
			// PLUGIN_DIR is constructed at module init time using the mocked join.
			expect(dir).toContain(".chitragupta");
			expect(dir).toContain("plugins");
		});

		it("should return a string", () => {
			const dir = getPluginDir();
			expect(typeof dir).toBe("string");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// loadPlugins
	// ═══════════════════════════════════════════════════════════════════════

	describe("loadPlugins", () => {
		it("should return empty registry when plugin dir does not exist", async () => {
			mocks.stat.mockRejectedValue(new Error("ENOENT: no such file"));

			const registry = await loadPlugins();

			expect(registry.plugins).toEqual([]);
			expect(registry.tools).toEqual([]);
			expect(registry.commands).toEqual([]);
		});

		it("should return empty registry when plugin dir is not a directory", async () => {
			mocks.stat.mockResolvedValue({
				isDirectory: () => false,
			});

			const registry = await loadPlugins();

			expect(registry.plugins).toEqual([]);
			expect(registry.tools).toEqual([]);
			expect(registry.commands).toEqual([]);
		});

		it("should attempt to load .js file plugins via dynamic import", async () => {
			mocks.stat.mockResolvedValue({ isDirectory: () => true });
			mocks.readdir.mockResolvedValue([
				makeDirent("my-plugin.js", "file"),
			]);

			// Dynamic import() will fail (module not found) — SUT catches silently
			const registry = await loadPlugins();

			// Verify pathToFileURL was called to build the import URL
			expect(mocks.pathToFileURL).toHaveBeenCalled();
			// Plugin load failed (no real module), so plugins should be empty
			expect(registry.plugins).toEqual([]);
		});

		it("should attempt to load directory plugins with index.js", async () => {
			mocks.stat
				.mockResolvedValueOnce({ isDirectory: () => true }) // plugin dir
				.mockResolvedValueOnce({ isFile: () => true }); // index.js exists

			mocks.readdir.mockResolvedValue([
				makeDirent("my-dir-plugin", "dir"),
			]);

			// Dynamic import() will fail (module not found) — SUT catches silently
			const registry = await loadPlugins();

			// pathToFileURL should have been called for the dir plugin's index.js
			expect(mocks.pathToFileURL).toHaveBeenCalled();
			expect(registry.plugins).toEqual([]);
		});

		it("should skip directories without index.js", async () => {
			mocks.stat
				.mockResolvedValueOnce({ isDirectory: () => true }) // plugin dir
				.mockRejectedValueOnce(new Error("ENOENT")); // index.js stat fails

			mocks.readdir.mockResolvedValue([
				makeDirent("my-dir-plugin", "dir"),
			]);

			const registry = await loadPlugins();

			// pathToFileURL should NOT have been called (skipped before import)
			expect(mocks.pathToFileURL).not.toHaveBeenCalled();
			expect(registry.plugins).toEqual([]);
		});

		it("should skip non-.js files entirely", async () => {
			mocks.stat.mockResolvedValue({ isDirectory: () => true });
			mocks.readdir.mockResolvedValue([
				makeDirent("readme.md", "file"),
				makeDirent("config.yaml", "file"),
				makeDirent("notes.txt", "file"),
			]);

			const registry = await loadPlugins();

			// No import attempts for non-.js files
			expect(mocks.pathToFileURL).not.toHaveBeenCalled();
			expect(registry.plugins).toEqual([]);
		});

		it("should handle plugin load errors gracefully without crashing", async () => {
			mocks.stat.mockResolvedValue({ isDirectory: () => true });
			mocks.readdir.mockResolvedValue([
				makeDirent("broken-plugin.js", "file"),
			]);

			// dynamic import() will fail since the module doesn't exist
			// The SUT catches this silently — no throw expected
			await expect(loadPlugins()).resolves.toBeDefined();
		});

		it("should return empty registry when readdir returns empty array", async () => {
			mocks.stat.mockResolvedValue({ isDirectory: () => true });
			mocks.readdir.mockResolvedValue([]);

			const registry = await loadPlugins();

			expect(registry.plugins).toEqual([]);
			expect(registry.tools).toEqual([]);
			expect(registry.commands).toEqual([]);
		});

		it("should handle mixed entries: .js files, dirs, and non-.js files", async () => {
			mocks.stat
				.mockResolvedValueOnce({ isDirectory: () => true }) // plugin dir stat
				.mockRejectedValueOnce(new Error("ENOENT")); // dir-plugin/index.js

			mocks.readdir.mockResolvedValue([
				makeDirent("good-plugin.js", "file"),
				makeDirent("dir-plugin", "dir"),
				makeDirent("notes.txt", "file"),
				makeDirent("image.png", "file"),
			]);

			const registry = await loadPlugins();

			// .js file triggers pathToFileURL, dir skipped (no index.js), others skipped
			expect(mocks.pathToFileURL).toHaveBeenCalledTimes(1);
			expect(registry.plugins).toEqual([]);
		});

		it("should return a registry object with plugins, tools, and commands arrays", async () => {
			mocks.stat.mockRejectedValue(new Error("ENOENT"));

			const registry = await loadPlugins();

			expect(registry).toHaveProperty("plugins");
			expect(registry).toHaveProperty("tools");
			expect(registry).toHaveProperty("commands");
			expect(Array.isArray(registry.plugins)).toBe(true);
			expect(Array.isArray(registry.tools)).toBe(true);
			expect(Array.isArray(registry.commands)).toBe(true);
		});

		it("should call stat on the plugin directory path", async () => {
			mocks.stat.mockRejectedValue(new Error("ENOENT"));

			await loadPlugins();

			expect(mocks.stat).toHaveBeenCalledWith(getPluginDir());
		});

		it("should call readdir with withFileTypes option after confirming dir exists", async () => {
			mocks.stat.mockResolvedValue({ isDirectory: () => true });
			mocks.readdir.mockResolvedValue([]);

			await loadPlugins();

			expect(mocks.readdir).toHaveBeenCalledWith(
				getPluginDir(),
				{ withFileTypes: true },
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// listInstalledPlugins
	// ═══════════════════════════════════════════════════════════════════════

	describe("listInstalledPlugins", () => {
		it("should return empty array when plugin dir does not exist", async () => {
			mocks.readdir.mockRejectedValue(new Error("ENOENT"));

			const result = await listInstalledPlugins();
			expect(result).toEqual([]);
		});

		it("should return .js file names", async () => {
			mocks.readdir.mockResolvedValue([
				makeDirent("plugin-a.js", "file"),
				makeDirent("plugin-b.js", "file"),
			]);

			const result = await listInstalledPlugins();
			expect(result).toEqual(["plugin-a.js", "plugin-b.js"]);
		});

		it("should return directory names", async () => {
			mocks.readdir.mockResolvedValue([
				makeDirent("my-complex-plugin", "dir"),
				makeDirent("another-plugin", "dir"),
			]);

			const result = await listInstalledPlugins();
			expect(result).toEqual(["my-complex-plugin", "another-plugin"]);
		});

		it("should filter out non-.js non-directory entries", async () => {
			mocks.readdir.mockResolvedValue([
				makeDirent("plugin.js", "file"),
				makeDirent("readme.md", "file"),
				makeDirent("dir-plugin", "dir"),
				makeDirent("config.yaml", "file"),
				makeDirent("notes.txt", "file"),
			]);

			const result = await listInstalledPlugins();
			expect(result).toEqual(["plugin.js", "dir-plugin"]);
		});

		it("should return empty array when readdir returns only non-matching entries", async () => {
			mocks.readdir.mockResolvedValue([
				makeDirent("readme.md", "file"),
				makeDirent("config.yaml", "file"),
			]);

			const result = await listInstalledPlugins();
			expect(result).toEqual([]);
		});

		it("should return empty array when readdir returns empty", async () => {
			mocks.readdir.mockResolvedValue([]);

			const result = await listInstalledPlugins();
			expect(result).toEqual([]);
		});

		it("should handle readdir throwing an unexpected error", async () => {
			mocks.readdir.mockRejectedValue(new Error("Permission denied"));

			const result = await listInstalledPlugins();
			expect(result).toEqual([]);
		});

		it("should include both .js files and directories in order", async () => {
			mocks.readdir.mockResolvedValue([
				makeDirent("alpha.js", "file"),
				makeDirent("beta-dir", "dir"),
				makeDirent("gamma.js", "file"),
			]);

			const result = await listInstalledPlugins();
			expect(result).toEqual(["alpha.js", "beta-dir", "gamma.js"]);
		});
	});
});
