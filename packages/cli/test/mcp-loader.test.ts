import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
	const mockRegistry = {
		addServer: vi.fn(),
		removeServer: vi.fn(),
		getServer: vi.fn(),
		listServers: vi.fn(),
		startServer: vi.fn(),
		stopServer: vi.fn(),
		restartServer: vi.fn(),
		getAggregatedTools: vi.fn(),
		getAggregatedResources: vi.fn(),
		routeToolCall: vi.fn(),
		findTools: vi.fn(),
		getToolCount: vi.fn(),
		onEvent: vi.fn(),
		saveConfig: vi.fn(),
		loadConfig: vi.fn(),
		dispose: vi.fn(),
	};

	return {
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
		join: vi.fn((...parts: string[]) => parts.join("/")),
		getChitraguptaHome: vi.fn(() => "/home/testuser/.chitragupta"),
		createMcpServerRegistry: vi.fn(() => mockRegistry),
		importRegistryTools: vi.fn(() => []),
		mockRegistry,
	};
});

vi.mock("fs", () => ({
	default: {
		existsSync: mocks.existsSync,
		readFileSync: mocks.readFileSync,
	},
	existsSync: mocks.existsSync,
	readFileSync: mocks.readFileSync,
}));

vi.mock("path", () => ({
	default: {
		join: mocks.join,
	},
	join: mocks.join,
}));

vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: mocks.getChitraguptaHome,
}));

vi.mock("@chitragupta/tantra", () => ({
	createMcpServerRegistry: mocks.createMcpServerRegistry,
	importRegistryTools: mocks.importRegistryTools,
}));

// ─── SUT Import ─────────────────────────────────────────────────────────────

import {
	loadMCPConfig,
	startMCPServers,
	importMCPTools,
	shutdownMCPServers,
	getMCPRegistry,
	getStartedServerIds,
	type MCPServerConfig,
} from "../src/mcp-loader.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
	return {
		id: "test-server",
		name: "Test Server",
		command: "node",
		args: ["server.js"],
		...overrides,
	};
}

function makeConfigFile(servers: MCPServerConfig[]): string {
	return JSON.stringify({ mcpServers: servers });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MCP Loader", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Reset module-level state by calling shutdown
		await shutdownMCPServers();
		// Reset the mock registry dispose after shutdown used it
		mocks.mockRegistry.dispose.mockReset();
		mocks.mockRegistry.addServer.mockResolvedValue({
			config: {},
			state: "ready",
			stats: {},
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// loadMCPConfig
	// ═══════════════════════════════════════════════════════════════════════

	describe("loadMCPConfig", () => {
		it("should return empty array when no config files exist", () => {
			mocks.existsSync.mockReturnValue(false);

			const result = loadMCPConfig();
			expect(result).toEqual([]);
		});

		it("should read global config from ~/.chitragupta/mcp.json", () => {
			const server = makeConfig({ id: "global-1", name: "Global Server" });

			mocks.existsSync.mockImplementation((p: string) => {
				return p.includes(".chitragupta") && p.includes("mcp.json") && !p.includes(process.cwd());
			});
			mocks.readFileSync.mockReturnValue(makeConfigFile([server]));

			const result = loadMCPConfig();
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("global-1");
			expect(result[0].name).toBe("Global Server");
		});

		it("should read project config from .chitragupta/mcp.json", () => {
			const server = makeConfig({ id: "project-1", name: "Project Server" });

			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue(makeConfigFile([server]));

			const result = loadMCPConfig();
			// Both global and project paths return same data; result dedupes by id
			expect(result.length).toBeGreaterThanOrEqual(1);
			expect(result.some((c: MCPServerConfig) => c.id === "project-1")).toBe(true);
		});

		it("should merge configs with project overriding global by ID", () => {
			const globalServer = makeConfig({
				id: "shared",
				name: "Global Version",
				command: "global-cmd",
			});
			const projectServer = makeConfig({
				id: "shared",
				name: "Project Version",
				command: "project-cmd",
			});

			let callCount = 0;
			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockImplementation(() => {
				callCount++;
				if (callCount === 1) return makeConfigFile([globalServer]);
				return makeConfigFile([projectServer]);
			});

			const result = loadMCPConfig();
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("Project Version");
			expect(result[0].command).toBe("project-cmd");
		});

		it("should filter out disabled servers (enabled === false)", () => {
			const enabled = makeConfig({ id: "enabled-1", name: "Enabled" });
			const disabled = makeConfig({
				id: "disabled-1",
				name: "Disabled",
				enabled: false,
			});

			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue(makeConfigFile([enabled, disabled]));

			const result = loadMCPConfig();
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("enabled-1");
		});

		it("should include servers with enabled === true", () => {
			const server = makeConfig({ id: "s1", name: "Server", enabled: true });

			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue(makeConfigFile([server]));

			const result = loadMCPConfig();
			expect(result.some((c: MCPServerConfig) => c.id === "s1")).toBe(true);
		});

		it("should include servers without an enabled field (defaults to true)", () => {
			const server = makeConfig({ id: "s2", name: "NoEnabledField" });

			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue(makeConfigFile([server]));

			const result = loadMCPConfig();
			expect(result.some((c: MCPServerConfig) => c.id === "s2")).toBe(true);
		});

		it("should handle malformed JSON gracefully", () => {
			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue("not valid json {{{");

			const result = loadMCPConfig();
			expect(result).toEqual([]);
		});

		it("should return empty when mcpServers is not an array", () => {
			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue(
				JSON.stringify({ mcpServers: "not-an-array" }),
			);

			const result = loadMCPConfig();
			expect(result).toEqual([]);
		});

		it("should return empty when mcpServers key is missing", () => {
			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue(JSON.stringify({ other: "data" }));

			const result = loadMCPConfig();
			expect(result).toEqual([]);
		});

		it("should validate entries need id, name, and command", () => {
			const valid = makeConfig({ id: "valid", name: "Valid", command: "cmd" });
			const noId = { name: "NoId", command: "cmd" };
			const noName = { id: "no-name", command: "cmd" };
			const noCommand = { id: "no-cmd", name: "NoCmd" };
			const emptyId = { id: "", name: "EmptyId", command: "cmd" };
			const emptyName = { id: "empty-name", name: "", command: "cmd" };
			const emptyCommand = { id: "empty-cmd", name: "EmptyCmd", command: "" };

			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockReturnValue(
				JSON.stringify({
					mcpServers: [valid, noId, noName, noCommand, emptyId, emptyName, emptyCommand],
				}),
			);

			const result = loadMCPConfig();
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("valid");
		});

		it("should handle readFileSync throwing an error", () => {
			mocks.existsSync.mockReturnValue(true);
			mocks.readFileSync.mockImplementation(() => {
				throw new Error("EACCES: permission denied");
			});

			const result = loadMCPConfig();
			expect(result).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// startMCPServers
	// ═══════════════════════════════════════════════════════════════════════

	describe("startMCPServers", () => {
		it("should create registry on first call", async () => {
			const configs = [makeConfig({ id: "s1" })];

			await startMCPServers(configs);

			expect(mocks.createMcpServerRegistry).toHaveBeenCalledOnce();
		});

		it("should reuse the singleton registry on subsequent calls", async () => {
			const configs1 = [makeConfig({ id: "s1" })];
			const configs2 = [makeConfig({ id: "s2" })];

			await startMCPServers(configs1);
			await startMCPServers(configs2);

			expect(mocks.createMcpServerRegistry).toHaveBeenCalledOnce();
		});

		it("should convert config format to McpRemoteServerConfig", async () => {
			const config = makeConfig({
				id: "converter-test",
				name: "Converter Test",
				command: "npx",
				args: ["-y", "mcp-server"],
				env: { FOO: "bar" },
			});

			await startMCPServers([config]);

			expect(mocks.mockRegistry.addServer).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "converter-test",
					name: "Converter Test",
					transport: "stdio",
					command: "npx",
					args: ["-y", "mcp-server"],
					env: { FOO: "bar" },
					autoRestart: true,
					maxRestarts: 3,
				}),
				true,
			);
		});

		it("should handle server start failures gracefully with stderr warning", async () => {
			mocks.mockRegistry.addServer.mockRejectedValueOnce(
				new Error("Connection refused"),
			);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

			const config = makeConfig({ id: "failing", name: "Failing Server" });
			const registry = await startMCPServers([config]);

			// Should not throw — returns registry despite failure
			expect(registry).toBeDefined();
			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failing Server"),
			);
			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("Connection refused"),
			);

			stderrSpy.mockRestore();
		});

		it("should track started IDs", async () => {
			const configs = [
				makeConfig({ id: "track-1" }),
				makeConfig({ id: "track-2" }),
			];

			await startMCPServers(configs);

			const ids = getStartedServerIds();
			expect(ids.has("track-1")).toBe(true);
			expect(ids.has("track-2")).toBe(true);
		});

		it("should track IDs even when server start fails", async () => {
			mocks.mockRegistry.addServer.mockRejectedValueOnce(new Error("fail"));
			const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

			await startMCPServers([makeConfig({ id: "failed-but-tracked" })]);

			const ids = getStartedServerIds();
			expect(ids.has("failed-but-tracked")).toBe(true);

			stderrSpy.mockRestore();
		});

		it("should return the registry instance", async () => {
			const registry = await startMCPServers([makeConfig()]);
			expect(registry).toBe(mocks.mockRegistry);
		});

		it("should start multiple servers in parallel", async () => {
			const configs = [
				makeConfig({ id: "parallel-1" }),
				makeConfig({ id: "parallel-2" }),
				makeConfig({ id: "parallel-3" }),
			];

			await startMCPServers(configs);

			expect(mocks.mockRegistry.addServer).toHaveBeenCalledTimes(3);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// importMCPTools
	// ═══════════════════════════════════════════════════════════════════════

	describe("importMCPTools", () => {
		it("should delegate to tantra importRegistryTools", () => {
			const fakeTools = [
				{
					definition: { name: "tool1", description: "A tool", inputSchema: {} },
					execute: vi.fn(),
				},
			];
			mocks.importRegistryTools.mockReturnValue(fakeTools as any);

			const result = importMCPTools(mocks.mockRegistry as any);

			expect(mocks.importRegistryTools).toHaveBeenCalledWith(mocks.mockRegistry);
			expect(result).toBe(fakeTools);
		});

		it("should return empty array when no tools available", () => {
			mocks.importRegistryTools.mockReturnValue([]);

			const result = importMCPTools(mocks.mockRegistry as any);
			expect(result).toEqual([]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// shutdownMCPServers
	// ═══════════════════════════════════════════════════════════════════════

	describe("shutdownMCPServers", () => {
		it("should dispose the registry", async () => {
			await startMCPServers([makeConfig()]);
			mocks.mockRegistry.dispose.mockResolvedValue(undefined);

			await shutdownMCPServers();

			expect(mocks.mockRegistry.dispose).toHaveBeenCalledOnce();
		});

		it("should clear started IDs after shutdown", async () => {
			await startMCPServers([makeConfig({ id: "will-clear" })]);
			expect(getStartedServerIds().has("will-clear")).toBe(true);

			await shutdownMCPServers();

			expect(getStartedServerIds().size).toBe(0);
		});

		it("should be idempotent — second call is a no-op", async () => {
			await startMCPServers([makeConfig()]);
			mocks.mockRegistry.dispose.mockResolvedValue(undefined);

			await shutdownMCPServers();
			await shutdownMCPServers();

			// dispose only called once (second call has no registry)
			expect(mocks.mockRegistry.dispose).toHaveBeenCalledOnce();
		});

		it("should be a no-op when no registry exists", async () => {
			// No startMCPServers called — registry is null
			await expect(shutdownMCPServers()).resolves.toBeUndefined();
		});

		it("should handle dispose throwing an error gracefully", async () => {
			await startMCPServers([makeConfig()]);
			mocks.mockRegistry.dispose.mockRejectedValue(new Error("dispose failed"));

			// Should not throw
			await expect(shutdownMCPServers()).resolves.toBeUndefined();
			// State should still be cleared even after error
			expect(getMCPRegistry()).toBeNull();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// getMCPRegistry
	// ═══════════════════════════════════════════════════════════════════════

	describe("getMCPRegistry", () => {
		it("should return null initially", () => {
			expect(getMCPRegistry()).toBeNull();
		});

		it("should return the registry after startMCPServers", async () => {
			await startMCPServers([makeConfig()]);
			expect(getMCPRegistry()).toBe(mocks.mockRegistry);
		});

		it("should return null after shutdown", async () => {
			await startMCPServers([makeConfig()]);
			expect(getMCPRegistry()).not.toBeNull();

			await shutdownMCPServers();
			expect(getMCPRegistry()).toBeNull();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// getStartedServerIds
	// ═══════════════════════════════════════════════════════════════════════

	describe("getStartedServerIds", () => {
		it("should return empty Set initially", () => {
			const ids = getStartedServerIds();
			expect(ids.size).toBe(0);
		});

		it("should track IDs after startMCPServers", async () => {
			await startMCPServers([
				makeConfig({ id: "alpha" }),
				makeConfig({ id: "beta" }),
			]);

			const ids = getStartedServerIds();
			expect(ids.size).toBe(2);
			expect(ids.has("alpha")).toBe(true);
			expect(ids.has("beta")).toBe(true);
		});

		it("should accumulate IDs across multiple startMCPServers calls", async () => {
			await startMCPServers([makeConfig({ id: "first" })]);
			await startMCPServers([makeConfig({ id: "second" })]);

			const ids = getStartedServerIds();
			expect(ids.has("first")).toBe(true);
			expect(ids.has("second")).toBe(true);
		});

		it("should be empty after shutdown", async () => {
			await startMCPServers([makeConfig({ id: "temp" })]);
			await shutdownMCPServers();

			expect(getStartedServerIds().size).toBe(0);
		});
	});
});
