import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs/promises before importing the module under test
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	readdir: vi.fn(),
	stat: vi.fn(),
}));

// Mock node:fs for watch
vi.mock("node:fs", () => ({
	watch: vi.fn(),
}));

import { readFile, readdir, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { ServerDiscovery } from "../src/server-discovery.js";
import type { McpRemoteServerConfig } from "../src/registry-types.js";

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);
const mockWatch = vi.mocked(watch);

// ─── Helpers ──────────────────────────────────────────────────────────────

function validStdioConfig(overrides: Partial<McpRemoteServerConfig> = {}): McpRemoteServerConfig {
	return {
		id: "test-server",
		name: "Test Server",
		transport: "stdio",
		command: "my-cmd",
		...overrides,
	};
}

function validSseConfig(overrides: Partial<McpRemoteServerConfig> = {}): McpRemoteServerConfig {
	return {
		id: "sse-server",
		name: "SSE Server",
		transport: "sse",
		url: "http://localhost:3001",
		...overrides,
	};
}

describe("ServerDiscovery", () => {
	let discovery: ServerDiscovery;

	beforeEach(() => {
		discovery = new ServerDiscovery();
		vi.clearAllMocks();
	});

	afterEach(() => {
		discovery.stopWatching();
	});

	// ─── discoverFromConfig ──────────────────────────────────────────

	describe("discoverFromConfig", () => {
		it("should return empty for missing mcpServers", () => {
			const result = discovery.discoverFromConfig({});
			expect(result).toEqual([]);
		});

		it("should return empty for null mcpServers", () => {
			const result = discovery.discoverFromConfig({ mcpServers: undefined });
			expect(result).toEqual([]);
		});

		it("should return empty for non-array mcpServers", () => {
			const result = discovery.discoverFromConfig({ mcpServers: "bad" as any });
			expect(result).toEqual([]);
		});

		it("should return valid configs only", () => {
			const configs = [
				validStdioConfig({ id: "a", name: "A" }),
				{ id: "", name: "Missing ID", transport: "stdio", command: "x" } as any,
				validSseConfig({ id: "b", name: "B" }),
			];
			const result = discovery.discoverFromConfig({ mcpServers: configs });
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("a");
			expect(result[1].id).toBe("b");
		});

		it("should filter out config missing id", () => {
			const result = discovery.discoverFromConfig({
				mcpServers: [{ id: "", name: "X", transport: "stdio", command: "y" } as any],
			});
			expect(result).toEqual([]);
		});

		it("should filter out config missing name", () => {
			const result = discovery.discoverFromConfig({
				mcpServers: [{ id: "x", name: "", transport: "stdio", command: "y" } as any],
			});
			expect(result).toEqual([]);
		});

		it("should filter out config with invalid transport", () => {
			const result = discovery.discoverFromConfig({
				mcpServers: [{ id: "x", name: "X", transport: "grpc", command: "y" } as any],
			});
			expect(result).toEqual([]);
		});

		it("should filter out stdio config without command", () => {
			const result = discovery.discoverFromConfig({
				mcpServers: [{ id: "x", name: "X", transport: "stdio" } as any],
			});
			expect(result).toEqual([]);
		});

		it("should filter out sse config without url", () => {
			const result = discovery.discoverFromConfig({
				mcpServers: [{ id: "x", name: "X", transport: "sse" } as any],
			});
			expect(result).toEqual([]);
		});

		it("should return all valid configs from array", () => {
			const configs = [
				validStdioConfig({ id: "s1", name: "S1" }),
				validStdioConfig({ id: "s2", name: "S2", command: "other-cmd" }),
				validSseConfig({ id: "s3", name: "S3" }),
			];
			const result = discovery.discoverFromConfig({ mcpServers: configs });
			expect(result).toHaveLength(3);
		});

		it("should accept a valid stdio config", () => {
			const result = discovery.discoverFromConfig({
				mcpServers: [validStdioConfig()],
			});
			expect(result).toHaveLength(1);
			expect(result[0].transport).toBe("stdio");
		});

		it("should accept a valid sse config", () => {
			const result = discovery.discoverFromConfig({
				mcpServers: [validSseConfig()],
			});
			expect(result).toHaveLength(1);
			expect(result[0].transport).toBe("sse");
		});
	});

	// ─── discoverFromDirectory ───────────────────────────────────────

	describe("discoverFromDirectory", () => {
		it("should return empty when directory does not exist", async () => {
			mockReaddir.mockRejectedValue(new Error("ENOENT"));
			const result = await discovery.discoverFromDirectory("/nonexistent");
			expect(result).toEqual([]);
		});

		it("should skip non-json files", async () => {
			mockReaddir.mockResolvedValue(["readme.md", "config.yaml", "notes.txt"] as any);
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toEqual([]);
			expect(mockReadFile).not.toHaveBeenCalled();
		});

		it("should parse valid JSON configs", async () => {
			mockReaddir.mockResolvedValue(["server.json"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify(validStdioConfig()));
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("test-server");
		});

		it("should derive ID from filename if config has no id", async () => {
			mockReaddir.mockResolvedValue(["my-cool-server.json"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "Cool Server",
				transport: "stdio",
				command: "cool-cmd",
			}));
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("my-cool-server");
		});

		it("should skip malformed JSON files", async () => {
			mockReaddir.mockResolvedValue(["bad.json"] as any);
			mockReadFile.mockResolvedValue("{ not valid json !!!");
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toEqual([]);
		});

		it("should skip invalid configs (missing required fields)", async () => {
			mockReaddir.mockResolvedValue(["incomplete.json"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				id: "incomplete",
				name: "Incomplete",
				transport: "grpc",
			}));
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toEqual([]);
		});

		it("should handle multiple files and return only valid ones", async () => {
			mockReaddir.mockResolvedValue(["good.json", "bad.json", "also-good.json"] as any);
			mockReadFile
				.mockResolvedValueOnce(JSON.stringify(validStdioConfig({ id: "good", name: "Good" })))
				.mockResolvedValueOnce("not json")
				.mockResolvedValueOnce(JSON.stringify(validSseConfig({ id: "also-good", name: "Also Good" })));
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toHaveLength(2);
			expect(result.map((c) => c.id).sort()).toEqual(["also-good", "good"]);
		});

		it("should skip files that fail to read", async () => {
			mockReaddir.mockResolvedValue(["unreadable.json"] as any);
			mockReadFile.mockRejectedValue(new Error("EACCES"));
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toEqual([]);
		});

		it("should skip non-object JSON values", async () => {
			mockReaddir.mockResolvedValue(["array.json", "string.json", "null.json"] as any);
			mockReadFile
				.mockResolvedValueOnce(JSON.stringify([1, 2, 3]))
				.mockResolvedValueOnce(JSON.stringify("hello"))
				.mockResolvedValueOnce(JSON.stringify(null));
			const result = await discovery.discoverFromDirectory("/dir");
			expect(result).toEqual([]);
		});
	});

	// ─── discoverFromNodeModules ─────────────────────────────────────

	describe("discoverFromNodeModules", () => {
		it("should return empty when node_modules does not exist", async () => {
			mockReaddir.mockRejectedValue(new Error("ENOENT"));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});

		it("should skip packages without chitragupta-mcp-server keyword", async () => {
			mockReaddir.mockResolvedValue(["some-pkg"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "some-pkg",
				keywords: ["unrelated"],
			}));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});

		it("should skip packages with no keywords", async () => {
			mockReaddir.mockResolvedValue(["some-pkg"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "some-pkg",
			}));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});

		it("should find config from chitraguptaMcpServer field in package.json", async () => {
			mockReaddir.mockResolvedValue(["mcp-tools"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "mcp-tools",
				keywords: ["chitragupta-mcp-server"],
				chitraguptaMcpServer: {
					transport: "stdio",
					command: "mcp-tools-server",
				},
			}));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("mcp-tools");
			expect(result[0].transport).toBe("stdio");
		});

		it("should fall back to chitragupta-mcp.json file", async () => {
			// First readdir for node_modules listing
			mockReaddir.mockResolvedValue(["fallback-pkg"] as any);
			// First readFile: package.json (has keyword but no embedded config)
			mockReadFile
				.mockResolvedValueOnce(JSON.stringify({
					name: "fallback-pkg",
					keywords: ["chitragupta-mcp-server"],
				}))
				// Second readFile: chitragupta-mcp.json
				.mockResolvedValueOnce(JSON.stringify({
					transport: "sse",
					url: "http://localhost:4000",
				}));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("fallback-pkg");
			expect(result[0].transport).toBe("sse");
		});

		it("should handle scoped packages (@scope/pkg)", async () => {
			// First readdir: top-level entries
			mockReaddir
				.mockResolvedValueOnce(["@my-scope"] as any)
				// Second readdir: scoped directory contents
				.mockResolvedValueOnce(["scoped-mcp"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "@my-scope/scoped-mcp",
				keywords: ["chitragupta-mcp-server"],
				chitraguptaMcpServer: {
					transport: "stdio",
					command: "scoped-mcp-srv",
				},
			}));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("@my-scope/scoped-mcp");
		});

		it("should derive ID from package name", async () => {
			mockReaddir.mockResolvedValue(["auto-id-pkg"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "auto-id-pkg",
				keywords: ["chitragupta-mcp-server"],
				chitraguptaMcpServer: {
					transport: "stdio",
					command: "auto-id-srv",
				},
			}));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("auto-id-pkg");
		});

		it("should skip dotfiles in top-level node_modules", async () => {
			mockReaddir.mockResolvedValue([".cache", "real-pkg"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "real-pkg",
				keywords: ["chitragupta-mcp-server"],
				chitraguptaMcpServer: {
					transport: "stdio",
					command: "real-srv",
				},
			}));
			const result = await discovery.discoverFromNodeModules("/project");
			// Only real-pkg should be found (not .cache)
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("real-pkg");
		});

		it("should derive name from id when chitraguptaMcpServer has no name", async () => {
			mockReaddir.mockResolvedValue(["named-pkg"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "named-pkg",
				keywords: ["chitragupta-mcp-server"],
				chitraguptaMcpServer: {
					transport: "stdio",
					command: "named-srv",
				},
			}));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("named-pkg");
		});

		it("should skip packages whose embedded config is invalid", async () => {
			mockReaddir.mockResolvedValue(["invalid-cfg-pkg"] as any);
			mockReadFile
				.mockResolvedValueOnce(JSON.stringify({
					name: "invalid-cfg-pkg",
					keywords: ["chitragupta-mcp-server"],
					chitraguptaMcpServer: {
						transport: "grpc", // invalid transport
					},
				}))
				// chitragupta-mcp.json also invalid
				.mockRejectedValueOnce(new Error("ENOENT"));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});

		it("should skip packages with unreadable package.json", async () => {
			mockReaddir.mockResolvedValue(["broken-pkg"] as any);
			mockReadFile.mockRejectedValue(new Error("ENOENT"));
			const result = await discovery.discoverFromNodeModules("/project");
			expect(result).toEqual([]);
		});
	});

	// ─── discoverAll ─────────────────────────────────────────────────

	describe("discoverAll", () => {
		it("should return empty when no options provided", async () => {
			const result = await discovery.discoverAll({});
			expect(result).toEqual([]);
		});

		it("should combine results from config source", async () => {
			const result = await discovery.discoverAll({
				configs: [
					{ mcpServers: [validStdioConfig({ id: "c1", name: "C1" })] },
					{ mcpServers: [validSseConfig({ id: "c2", name: "C2" })] },
				],
			});
			expect(result).toHaveLength(2);
		});

		it("should deduplicate by server ID (first occurrence wins)", async () => {
			const result = await discovery.discoverAll({
				configs: [
					{
						mcpServers: [
							validStdioConfig({ id: "dup", name: "First" }),
							validSseConfig({ id: "dup", name: "Second" }),
						],
					},
				],
			});
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("First");
		});

		it("should combine results from directories", async () => {
			mockReaddir.mockResolvedValue(["s1.json"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify(validStdioConfig({ id: "dir-s1", name: "Dir S1" })));

			const result = await discovery.discoverAll({
				directories: ["/dir1"],
			});
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("dir-s1");
		});

		it("should combine results from node_modules", async () => {
			mockReaddir.mockResolvedValue(["mcp-pkg"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify({
				name: "mcp-pkg",
				keywords: ["chitragupta-mcp-server"],
				chitraguptaMcpServer: {
					transport: "stdio",
					command: "mcp-srv",
				},
			}));

			const result = await discovery.discoverAll({
				nodeModulesRoots: ["/project"],
			});
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("mcp-pkg");
		});

		it("should deduplicate across all sources (config wins over directory)", async () => {
			// Config source has id "shared"
			// Directory source also has id "shared"
			mockReaddir.mockResolvedValue(["shared.json"] as any);
			mockReadFile.mockResolvedValue(JSON.stringify(
				validStdioConfig({ id: "shared", name: "From Directory" }),
			));

			const result = await discovery.discoverAll({
				configs: [
					{ mcpServers: [validStdioConfig({ id: "shared", name: "From Config" })] },
				],
				directories: ["/dir"],
			});
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("From Config");
		});
	});

	// ─── watchDirectory ──────────────────────────────────────────────

	describe("watchDirectory", () => {
		it("should return a cleanup function", () => {
			const mockWatcher = {
				close: vi.fn(),
			};
			mockWatch.mockReturnValue(mockWatcher as any);

			const cleanup = discovery.watchDirectory("/dir", vi.fn());
			expect(typeof cleanup).toBe("function");
		});

		it("should return no-op cleanup when directory does not exist", () => {
			mockWatch.mockImplementation(() => {
				throw new Error("ENOENT");
			});

			const cleanup = discovery.watchDirectory("/nonexistent", vi.fn());
			expect(typeof cleanup).toBe("function");
			// Should not throw when called
			cleanup();
		});

		it("cleanup should close the watcher", () => {
			const mockWatcher = {
				close: vi.fn(),
			};
			mockWatch.mockReturnValue(mockWatcher as any);

			const cleanup = discovery.watchDirectory("/dir", vi.fn());
			cleanup();
			expect(mockWatcher.close).toHaveBeenCalledOnce();
		});
	});

	// ─── stopWatching ────────────────────────────────────────────────

	describe("stopWatching", () => {
		it("should close all watchers", () => {
			const watcher1 = { close: vi.fn() };
			const watcher2 = { close: vi.fn() };
			mockWatch
				.mockReturnValueOnce(watcher1 as any)
				.mockReturnValueOnce(watcher2 as any);

			discovery.watchDirectory("/dir1", vi.fn());
			discovery.watchDirectory("/dir2", vi.fn());

			discovery.stopWatching();

			expect(watcher1.close).toHaveBeenCalledOnce();
			expect(watcher2.close).toHaveBeenCalledOnce();
		});

		it("should be idempotent (safe to call multiple times)", () => {
			const watcher = { close: vi.fn() };
			mockWatch.mockReturnValue(watcher as any);

			discovery.watchDirectory("/dir", vi.fn());
			discovery.stopWatching();
			discovery.stopWatching(); // second call should not throw
			expect(watcher.close).toHaveBeenCalledOnce();
		});
	});
});
