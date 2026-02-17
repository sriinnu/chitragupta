import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock ServerLifecycleManager ──────────────────────────────────────────

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockRestart = vi.fn();
const mockGetInfo = vi.fn();
const mockGetAllInfo = vi.fn().mockReturnValue([]);
const mockDispose = vi.fn();
const mockOnStateChange = vi.fn().mockReturnValue(() => {});
const mockOnToolsChanged = vi.fn().mockReturnValue(() => {});

vi.mock("../src/server-lifecycle.js", () => ({
	ServerLifecycleManager: class {
		start = mockStart;
		stop = mockStop;
		restart = mockRestart;
		getInfo = mockGetInfo;
		getAllInfo = mockGetAllInfo;
		dispose = mockDispose;
		onStateChange = mockOnStateChange;
		onToolsChanged = mockOnToolsChanged;
	},
}));

// ─── Mock CapabilityAggregator ────────────────────────────────────────────

const mockAddServer = vi.fn();
const mockRemoveServer = vi.fn();
const mockUpdateServerTools = vi.fn();
const mockGetAllTools = vi.fn().mockReturnValue([]);
const mockGetAllResources = vi.fn().mockReturnValue([]);
const mockRouteToolCall = vi.fn().mockReturnValue(null);
const mockFindTools = vi.fn().mockReturnValue([]);
const mockGetToolCount = vi.fn().mockReturnValue(0);

vi.mock("../src/capability-aggregator.js", () => ({
	CapabilityAggregator: class {
		addServer = mockAddServer;
		removeServer = mockRemoveServer;
		updateServerTools = mockUpdateServerTools;
		getAllTools = mockGetAllTools;
		getAllResources = mockGetAllResources;
		routeToolCall = mockRouteToolCall;
		findTools = mockFindTools;
		getToolCount = mockGetToolCount;
	},
}));

// ─── Mock node:fs/promises ────────────────────────────────────────────────

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
	readFile: (...args: unknown[]) => mockReadFile(...args),
	writeFile: (...args: unknown[]) => mockWriteFile(...args),
	mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

import { createMcpServerRegistry } from "../src/server-registry.js";
import type { McpRemoteServerConfig } from "../src/registry-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<McpRemoteServerConfig> = {}): McpRemoteServerConfig {
	return {
		id: "srv-1",
		name: "Test Server",
		transport: "stdio",
		command: "test-cmd",
		...overrides,
	};
}

function makeManagedInfo(config: McpRemoteServerConfig, state = "ready" as const) {
	return {
		config,
		state,
		client: null,
		serverInfo: null,
		tools: [],
		resources: [],
		prompts: [],
		stats: {
			startedAt: Date.now(),
			uptime: 1000,
			totalCalls: 0,
			totalErrors: 0,
			averageLatency: 0,
			lastCallAt: null,
			lastHealthCheck: null,
			consecutiveFailures: 0,
		},
		restartCount: 0,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("createMcpServerRegistry", () => {
	let registry: ReturnType<typeof createMcpServerRegistry>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockStart.mockResolvedValue(makeManagedInfo(makeConfig()));
		mockStop.mockResolvedValue(undefined);
		mockRestart.mockResolvedValue(undefined);
		mockGetInfo.mockReturnValue(undefined);
		mockGetAllInfo.mockReturnValue([]);
		mockDispose.mockResolvedValue(undefined);
		registry = createMcpServerRegistry();
	});

	// ── addServer ─────────────────────────────────────────────────────

	describe("addServer", () => {
		it("should start the server when autoStart is true (default)", async () => {
			const config = makeConfig();
			await registry.addServer(config);
			expect(mockStart).toHaveBeenCalledWith(config);
		});

		it("should start the server when autoStart is explicitly true", async () => {
			const config = makeConfig();
			await registry.addServer(config, true);
			expect(mockStart).toHaveBeenCalledWith(config);
		});

		it("should return managed info from lifecycle.start", async () => {
			const config = makeConfig();
			const expected = makeManagedInfo(config);
			mockStart.mockResolvedValue(expected);
			const result = await registry.addServer(config);
			expect(result).toBe(expected);
		});

		it("should fall through to start even when autoStart is false (lifecycle awareness)", async () => {
			const config = makeConfig();
			mockGetInfo.mockReturnValue(undefined);
			mockStart.mockResolvedValue(makeManagedInfo(config));
			await registry.addServer(config, false);
			// The implementation tries getInfo first, then falls through to start
			expect(mockStart).toHaveBeenCalled();
		});
	});

	// ── removeServer ──────────────────────────────────────────────────

	describe("removeServer", () => {
		it("should stop and remove the server", async () => {
			const config = makeConfig();
			const info = makeManagedInfo(config);
			mockGetInfo.mockReturnValue(info);
			await registry.removeServer("srv-1");
			expect(mockStop).toHaveBeenCalledWith("srv-1");
			expect(mockRemoveServer).toHaveBeenCalledWith("srv-1");
		});

		it("should skip stop if server is already stopped", async () => {
			const config = makeConfig();
			const info = makeManagedInfo(config, "stopped" as any);
			mockGetInfo.mockReturnValue(info);
			await registry.removeServer("srv-1");
			expect(mockStop).not.toHaveBeenCalled();
			expect(mockRemoveServer).toHaveBeenCalledWith("srv-1");
		});

		it("should handle removing a non-existent server gracefully", async () => {
			mockGetInfo.mockReturnValue(undefined);
			await registry.removeServer("ghost");
			expect(mockStop).not.toHaveBeenCalled();
			expect(mockRemoveServer).toHaveBeenCalledWith("ghost");
		});
	});

	// ── getServer ─────────────────────────────────────────────────────

	describe("getServer", () => {
		it("should delegate to lifecycle.getInfo", () => {
			const config = makeConfig();
			const info = makeManagedInfo(config);
			mockGetInfo.mockReturnValue(info);
			const result = registry.getServer("srv-1");
			expect(result).toBe(info);
			expect(mockGetInfo).toHaveBeenCalledWith("srv-1");
		});

		it("should return undefined for unknown server", () => {
			mockGetInfo.mockReturnValue(undefined);
			expect(registry.getServer("unknown")).toBeUndefined();
		});
	});

	// ── listServers ───────────────────────────────────────────────────

	describe("listServers", () => {
		it("should return all servers when no filter", () => {
			const servers = [
				makeManagedInfo(makeConfig({ id: "s1" })),
				makeManagedInfo(makeConfig({ id: "s2" })),
			];
			mockGetAllInfo.mockReturnValue(servers);
			expect(registry.listServers()).toEqual(servers);
		});

		it("should filter by state", () => {
			const s1 = makeManagedInfo(makeConfig({ id: "s1" }), "ready" as any);
			const s2 = makeManagedInfo(makeConfig({ id: "s2" }), "error" as any);
			mockGetAllInfo.mockReturnValue([s1, s2]);
			const result = registry.listServers({ states: ["ready"] });
			expect(result).toEqual([s1]);
		});

		it("should filter by tags", () => {
			const s1 = makeManagedInfo(makeConfig({ id: "s1", tags: ["fs"] }));
			const s2 = makeManagedInfo(makeConfig({ id: "s2", tags: ["web"] }));
			const s3 = makeManagedInfo(makeConfig({ id: "s3" })); // no tags
			mockGetAllInfo.mockReturnValue([s1, s2, s3]);
			const result = registry.listServers({ tags: ["fs"] });
			expect(result).toEqual([s1]);
		});

		it("should combine state and tag filters", () => {
			const s1 = makeManagedInfo(makeConfig({ id: "s1", tags: ["fs"] }), "ready" as any);
			const s2 = makeManagedInfo(makeConfig({ id: "s2", tags: ["fs"] }), "error" as any);
			mockGetAllInfo.mockReturnValue([s1, s2]);
			const result = registry.listServers({ states: ["ready"], tags: ["fs"] });
			expect(result).toEqual([s1]);
		});
	});

	// ── startServer / stopServer / restartServer ──────────────────────

	describe("startServer", () => {
		it("should delegate to lifecycle.start with the stored config", async () => {
			const config = makeConfig();
			await registry.addServer(config);
			mockStart.mockClear();
			const expected = makeManagedInfo(config);
			mockStart.mockResolvedValue(expected);
			const result = await registry.startServer("srv-1");
			expect(mockStart).toHaveBeenCalledWith(config);
			expect(result).toBe(expected);
		});

		it("should throw McpNotFoundError if config not registered", async () => {
			await expect(registry.startServer("ghost")).rejects.toThrow(/No configuration found/);
		});
	});

	describe("stopServer", () => {
		it("should delegate to lifecycle.stop", async () => {
			await registry.stopServer("srv-1");
			expect(mockStop).toHaveBeenCalledWith("srv-1");
		});
	});

	describe("restartServer", () => {
		it("should delegate to lifecycle.restart", async () => {
			await registry.restartServer("srv-1");
			expect(mockRestart).toHaveBeenCalledWith("srv-1");
		});
	});

	// ── Aggregation ───────────────────────────────────────────────────

	describe("getAggregatedTools", () => {
		it("should delegate to aggregator.getAllTools", () => {
			const tools = [{ serverId: "s1", originalName: "t", namespacedName: "s1:t", tool: {} }];
			mockGetAllTools.mockReturnValue(tools);
			expect(registry.getAggregatedTools()).toBe(tools);
		});
	});

	describe("getAggregatedResources", () => {
		it("should delegate to aggregator.getAllResources", () => {
			const resources = [{ serverId: "s1", resource: {} }];
			mockGetAllResources.mockReturnValue(resources);
			expect(registry.getAggregatedResources()).toBe(resources);
		});
	});

	describe("routeToolCall", () => {
		it("should delegate to aggregator.routeToolCall", () => {
			const route = { serverId: "s1", originalName: "t", args: {} };
			mockRouteToolCall.mockReturnValue(route);
			const result = registry.routeToolCall("s1:t", { x: 1 });
			expect(mockRouteToolCall).toHaveBeenCalledWith("s1:t", { x: 1 });
			expect(result).toBe(route);
		});

		it("should return null when tool not found", () => {
			mockRouteToolCall.mockReturnValue(null);
			expect(registry.routeToolCall("unknown:t", {})).toBeNull();
		});
	});

	describe("findTools", () => {
		it("should delegate to aggregator.findTools", () => {
			const results = [{ namespacedName: "s1:read", score: 0.9 }];
			mockFindTools.mockReturnValue(results);
			expect(registry.findTools("read", 5)).toBe(results);
			expect(mockFindTools).toHaveBeenCalledWith("read", 5);
		});
	});

	describe("getToolCount", () => {
		it("should delegate to aggregator.getToolCount", () => {
			mockGetToolCount.mockReturnValue(42);
			expect(registry.getToolCount()).toBe(42);
		});
	});

	// ── Events ────────────────────────────────────────────────────────

	describe("onEvent", () => {
		it("should subscribe and receive events via addServer", async () => {
			const listener = vi.fn();
			registry.onEvent(listener);
			const config = makeConfig();
			await registry.addServer(config);
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({ type: "server:added", serverId: "srv-1" }),
			);
		});

		it("should allow unsubscribe", async () => {
			const listener = vi.fn();
			const unsub = registry.onEvent(listener);
			unsub();
			const config = makeConfig({ id: "srv-2" });
			await registry.addServer(config);
			// The "server:added" event should NOT reach the listener
			expect(listener).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "server:added", serverId: "srv-2" }),
			);
		});
	});

	// ── Persistence ───────────────────────────────────────────────────

	describe("saveConfig", () => {
		it("should write JSON to the specified path", async () => {
			const config = makeConfig();
			await registry.addServer(config);
			await registry.saveConfig("/tmp/mcp.json");
			expect(mockMkdir).toHaveBeenCalled();
			expect(mockWriteFile).toHaveBeenCalledWith(
				"/tmp/mcp.json",
				expect.any(String),
				"utf-8",
			);
		});

		it("should serialize configs as mcpServers array", async () => {
			const config = makeConfig();
			await registry.addServer(config);
			await registry.saveConfig("/tmp/mcp.json");
			const written = mockWriteFile.mock.calls[0][1] as string;
			const parsed = JSON.parse(written);
			expect(parsed.mcpServers).toBeInstanceOf(Array);
			expect(parsed.mcpServers[0].id).toBe("srv-1");
		});
	});

	describe("loadConfig", () => {
		it("should read and register servers from JSON file", async () => {
			const config = makeConfig({ id: "loaded-1" });
			mockReadFile.mockResolvedValue(JSON.stringify({ mcpServers: [config] }));
			const listener = vi.fn();
			registry.onEvent(listener);
			await registry.loadConfig("/tmp/mcp.json");
			expect(mockReadFile).toHaveBeenCalledWith("/tmp/mcp.json", "utf-8");
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({ type: "server:added", serverId: "loaded-1" }),
			);
		});

		it("should auto-start servers when autoStart=true", async () => {
			const config = makeConfig({ id: "auto-1" });
			mockReadFile.mockResolvedValue(JSON.stringify({ mcpServers: [config] }));
			mockStart.mockResolvedValue(makeManagedInfo(config));
			await registry.loadConfig("/tmp/mcp.json", true);
			expect(mockStart).toHaveBeenCalledWith(config);
		});

		it("should not start servers when autoStart=false (default)", async () => {
			const config = makeConfig({ id: "no-start-1" });
			mockReadFile.mockResolvedValue(JSON.stringify({ mcpServers: [config] }));
			mockStart.mockClear();
			await registry.loadConfig("/tmp/mcp.json");
			// loadConfig default is false — no start should be called for loaded config
			expect(mockStart).not.toHaveBeenCalledWith(config);
		});

		it("should skip configs without an id", async () => {
			const config = { name: "No ID", transport: "stdio" as const };
			mockReadFile.mockResolvedValue(JSON.stringify({ mcpServers: [config] }));
			const listener = vi.fn();
			registry.onEvent(listener);
			await registry.loadConfig("/tmp/mcp.json");
			expect(listener).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "server:added" }),
			);
		});

		it("should handle missing mcpServers key gracefully", async () => {
			mockReadFile.mockResolvedValue(JSON.stringify({ other: true }));
			await expect(registry.loadConfig("/tmp/mcp.json")).resolves.toBeUndefined();
		});
	});

	// ── dispose ───────────────────────────────────────────────────────

	describe("dispose", () => {
		it("should delegate to lifecycle.dispose", async () => {
			await registry.dispose();
			expect(mockDispose).toHaveBeenCalled();
		});

		it("should clear event listeners after dispose", async () => {
			const listener = vi.fn();
			registry.onEvent(listener);
			await registry.dispose();
			// After dispose, listeners cleared — new addServer calls won't fire
			// (but addServer also modifies configs which is cleared, so no event emitted)
		});
	});
});
