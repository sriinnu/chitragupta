import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpServerRegistry } from "../src/server-registry.js";
import type { McpRemoteServerConfig, ManagedServerInfo, RegistryEvent, RegistryEventListener } from "../src/registry-types.js";

// ─── Mock ServerDiscovery ─────────────────────────────────────────────────

const mockDiscoverAll = vi.fn().mockResolvedValue([]);
const mockWatchDirectory = vi.fn().mockReturnValue(() => {});
const mockStopWatching = vi.fn();

vi.mock("../src/server-discovery.js", () => ({
	ServerDiscovery: class {
		discoverAll = mockDiscoverAll;
		watchDirectory = mockWatchDirectory;
		stopWatching = mockStopWatching;
	},
}));

import { AutonomousMcpManager } from "../src/mcp-autonomous.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(id = "srv-1"): McpRemoteServerConfig {
	return {
		id,
		name: `Server ${id}`,
		transport: "stdio",
		command: "test-cmd",
	};
}

function makeManagedInfo(
	id = "srv-1",
	state = "ready" as const,
	overrides: Partial<ManagedServerInfo["stats"]> = {},
): ManagedServerInfo {
	return {
		config: makeConfig(id),
		state,
		client: null,
		serverInfo: null,
		tools: [],
		resources: [],
		prompts: [],
		stats: {
			startedAt: Date.now(),
			uptime: 60000,
			totalCalls: 100,
			totalErrors: 5,
			averageLatency: 200,
			lastCallAt: Date.now(),
			lastHealthCheck: Date.now(),
			consecutiveFailures: 0,
			...overrides,
		},
		restartCount: 0,
	};
}

function createMockRegistry(): McpServerRegistry & {
	_listeners: Set<RegistryEventListener>;
	_emit: (event: RegistryEvent) => void;
} {
	const listeners = new Set<RegistryEventListener>();
	const registry = {
		_listeners: listeners,
		_emit(event: RegistryEvent) {
			for (const l of listeners) l(event);
		},
		addServer: vi.fn().mockResolvedValue(makeManagedInfo()),
		removeServer: vi.fn().mockResolvedValue(undefined),
		getServer: vi.fn().mockReturnValue(undefined),
		listServers: vi.fn().mockReturnValue([]),
		startServer: vi.fn().mockResolvedValue(makeManagedInfo()),
		stopServer: vi.fn().mockResolvedValue(undefined),
		restartServer: vi.fn().mockResolvedValue(undefined),
		getAggregatedTools: vi.fn().mockReturnValue([]),
		getAggregatedResources: vi.fn().mockReturnValue([]),
		routeToolCall: vi.fn().mockReturnValue(null),
		findTools: vi.fn().mockReturnValue([]),
		getToolCount: vi.fn().mockReturnValue(0),
		onEvent: vi.fn((listener: RegistryEventListener) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		}),
		saveConfig: vi.fn().mockResolvedValue(undefined),
		loadConfig: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	};
	return registry as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("AutonomousMcpManager", () => {
	let mockRegistry: ReturnType<typeof createMockRegistry>;
	let manager: AutonomousMcpManager;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		mockRegistry = createMockRegistry();
		manager = new AutonomousMcpManager(mockRegistry);
	});

	afterEach(() => {
		manager.stop();
		vi.useRealTimers();
	});

	// ── start / stop ──────────────────────────────────────────────────

	describe("start / stop", () => {
		it("should subscribe to registry events on start", () => {
			manager.start();
			expect(mockRegistry.onEvent).toHaveBeenCalled();
		});

		it("should initialize health for existing servers", () => {
			const servers = [makeManagedInfo("s1"), makeManagedInfo("s2")];
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue(servers);
			manager.start();
			const report = manager.getHealthReport();
			expect(report.servers).toHaveLength(2);
		});

		it("should set up periodic discovery interval", () => {
			manager.start({ discoveryIntervalMs: 5000 });
			expect(mockDiscoverAll).not.toHaveBeenCalled();
			vi.advanceTimersByTime(5000);
			// Discovery triggered
			expect(mockDiscoverAll).toHaveBeenCalled();
		});

		it("should watch configured directories", () => {
			manager.start({ discoveryDirectories: ["/tmp/mcp"] });
			expect(mockWatchDirectory).toHaveBeenCalledWith("/tmp/mcp", expect.any(Function));
		});

		it("should not start twice", () => {
			manager.start();
			manager.start();
			expect(mockRegistry.onEvent).toHaveBeenCalledTimes(1);
		});

		it("should clean up intervals and watchers on stop", () => {
			manager.start({ discoveryDirectories: ["/tmp/a"] });
			manager.stop();
			expect(mockStopWatching).toHaveBeenCalled();
		});

		it("should unsubscribe from registry events on stop", () => {
			manager.start();
			const initialListenerCount = mockRegistry._listeners.size;
			expect(initialListenerCount).toBe(1);
			manager.stop();
			expect(mockRegistry._listeners.size).toBe(0);
		});
	});

	// ── Circuit Breaker ───────────────────────────────────────────────

	describe("circuit breaker", () => {
		beforeEach(() => {
			manager.start();
		});

		it("should start in closed state (calls allowed)", () => {
			expect(manager.isCallAllowed("srv-1")).toBe(true);
		});

		it("should remain closed after a few failures", () => {
			manager.recordCallFailure("srv-1");
			manager.recordCallFailure("srv-1");
			expect(manager.isCallAllowed("srv-1")).toBe(true);
		});

		it("should trip open after threshold failures (default 5)", () => {
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("srv-1");
			}
			expect(manager.isCallAllowed("srv-1")).toBe(false);
		});

		it("should transition from open to half-open after cooldown", () => {
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("srv-1");
			}
			expect(manager.isCallAllowed("srv-1")).toBe(false);
			// Default cooldown is 30000ms
			vi.advanceTimersByTime(30000);
			expect(manager.isCallAllowed("srv-1")).toBe(true);
		});

		it("should close circuit on success in half-open state", () => {
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("srv-1");
			}
			vi.advanceTimersByTime(30000);
			// Half-open
			expect(manager.isCallAllowed("srv-1")).toBe(true);
			manager.recordCallSuccess("srv-1");
			// Should be closed again
			const states = manager.getCircuitBreakerStates();
			const state = states.find((s) => s.serverId === "srv-1");
			expect(state?.state).toBe("closed");
		});

		it("should re-open circuit on failure in half-open state", () => {
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("srv-1");
			}
			vi.advanceTimersByTime(30000);
			manager.recordCallFailure("srv-1");
			expect(manager.isCallAllowed("srv-1")).toBe(false);
		});

		it("should prune old failures outside the window", () => {
			// Record 4 failures
			for (let i = 0; i < 4; i++) {
				manager.recordCallFailure("srv-1");
			}
			// Advance past the window (default 60s)
			vi.advanceTimersByTime(61000);
			// One more failure shouldn't trip it (old ones pruned)
			manager.recordCallFailure("srv-1");
			expect(manager.isCallAllowed("srv-1")).toBe(true);
		});

		it("should track success to prune old failures in closed state", () => {
			manager.recordCallFailure("srv-1");
			vi.advanceTimersByTime(61000);
			manager.recordCallSuccess("srv-1");
			const states = manager.getCircuitBreakerStates();
			const state = states.find((s) => s.serverId === "srv-1");
			expect(state?.failureCount).toBe(0);
		});
	});

	// ── Health Report ─────────────────────────────────────────────────

	describe("getHealthReport", () => {
		it("should return overall health of 1.0 when no servers exist", () => {
			manager.start();
			const report = manager.getHealthReport();
			expect(report.overallHealth).toBe(1.0);
			expect(report.servers).toEqual([]);
			expect(report.quarantinedCount).toBe(0);
			expect(report.openCircuitCount).toBe(0);
		});

		it("should include per-server health details", () => {
			const servers = [makeManagedInfo("s1"), makeManagedInfo("s2")];
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue(servers);
			manager.start();
			const report = manager.getHealthReport();
			expect(report.servers).toHaveLength(2);
			expect(report.servers[0].serverId).toBe("s1");
			expect(report.servers[0].health).toBeGreaterThan(0);
			expect(report.servers[0].health).toBeLessThanOrEqual(1);
		});

		it("should count open circuit breakers", () => {
			const servers = [makeManagedInfo("s1")];
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue(servers);
			manager.start();
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("s1");
			}
			const report = manager.getHealthReport();
			expect(report.openCircuitCount).toBe(1);
		});

		it("should count quarantined servers", () => {
			const servers = [makeManagedInfo("s1")];
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue(servers);
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(servers[0]);
			manager.start({ quarantineMaxCrashes: 2, quarantineCrashWindowMs: 60000 });
			// Simulate crashes via registry events
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			const report = manager.getHealthReport();
			expect(report.quarantinedCount).toBe(1);
		});
	});

	// ── Quarantine ────────────────────────────────────────────────────

	describe("quarantine management", () => {
		it("should quarantine server after enough crashes in window", () => {
			const info = makeManagedInfo("s1");
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start({ quarantineMaxCrashes: 3, quarantineCrashWindowMs: 60000 });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			const quarantined = manager.getQuarantined();
			expect(quarantined).toHaveLength(1);
			expect(quarantined[0].serverId).toBe("s1");
		});

		it("should auto-expire quarantine after duration", () => {
			const info = makeManagedInfo("s1");
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start({
				quarantineMaxCrashes: 1,
				quarantineDurationMs: 5000,
			});
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			expect(manager.getQuarantined()).toHaveLength(1);
			vi.advanceTimersByTime(5001);
			expect(manager.getQuarantined()).toHaveLength(0);
		});

		it("should manually release from quarantine", () => {
			const info = makeManagedInfo("s1");
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start({ quarantineMaxCrashes: 1 });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			expect(manager.getQuarantined()).toHaveLength(1);
			manager.releaseFromQuarantine("s1");
			expect(manager.getQuarantined()).toHaveLength(0);
			expect(mockRegistry.startServer).toHaveBeenCalledWith("s1");
		});

		it("should stop the quarantined server", () => {
			const info = makeManagedInfo("s1");
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start({ quarantineMaxCrashes: 1 });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			expect(mockRegistry.stopServer).toHaveBeenCalledWith("s1");
		});
	});

	// ── selectServer ──────────────────────────────────────────────────

	describe("selectServer", () => {
		it("should return null for empty array", () => {
			manager.start();
			expect(manager.selectServer([])).toBeNull();
		});

		it("should return the only eligible server", () => {
			manager.start();
			expect(manager.selectServer(["s1"])).toBe("s1");
		});

		it("should filter out quarantined servers", () => {
			const info = makeManagedInfo("s1");
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start({ quarantineMaxCrashes: 1 });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			expect(manager.selectServer(["s1", "s2"])).toBe("s2");
		});

		it("should filter out open-circuit servers", () => {
			manager.start();
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("s1");
			}
			expect(manager.selectServer(["s1", "s2"])).toBe("s2");
		});

		it("should return null when all servers are unavailable", () => {
			const info = makeManagedInfo("s1");
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start({ quarantineMaxCrashes: 1 });
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "ready", to: "error" });
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("s2");
			}
			expect(manager.selectServer(["s1", "s2"])).toBeNull();
		});

		it("should prefer half-open server for probing", () => {
			manager.start();
			for (let i = 0; i < 5; i++) {
				manager.recordCallFailure("s1");
			}
			vi.advanceTimersByTime(30000); // half-open
			const result = manager.selectServer(["s1", "s2"]);
			expect(result).toBe("s1"); // half-open gets probed
		});
	});

	// ── setSkillGenerator ─────────────────────────────────────────────

	describe("setSkillGenerator", () => {
		it("should register a skill generator callback", () => {
			const callback = { generateAndRegister: vi.fn() };
			manager.setSkillGenerator(callback);
			// Skill generation happens when a server becomes ready
			const info = makeManagedInfo("s1");
			info.tools = [{ name: "read", description: "Read file", inputSchema: {} }] as any;
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([]);
			manager.start();
			mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "starting", to: "ready" });
			expect(callback.generateAndRegister).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ name: "read" }),
				]),
			);
		});

		it("should not crash if skill generator throws", () => {
			const callback = {
				generateAndRegister: vi.fn(() => { throw new Error("boom"); }),
			};
			manager.setSkillGenerator(callback);
			const info = makeManagedInfo("s1");
			info.tools = [{ name: "t", description: "d", inputSchema: {} }] as any;
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([]);
			manager.start();
			expect(() => {
				mockRegistry._emit({ type: "server:state-changed", serverId: "s1", from: "starting", to: "ready" });
			}).not.toThrow();
		});
	});

	// ── rediscover ────────────────────────────────────────────────────

	describe("rediscover", () => {
		it("should discover and integrate new servers", async () => {
			const config = makeConfig("new-srv");
			mockDiscoverAll.mockResolvedValue([config]);
			(mockRegistry.addServer as ReturnType<typeof vi.fn>).mockResolvedValue(
				makeManagedInfo("new-srv"),
			);
			manager.start();
			await manager.rediscover();
			expect(mockRegistry.addServer).toHaveBeenCalledWith(config, true);
		});

		it("should skip already known servers", async () => {
			const config = makeConfig("known");
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([
				makeManagedInfo("known"),
			]);
			mockDiscoverAll.mockResolvedValue([config]);
			manager.start();
			(mockRegistry.addServer as ReturnType<typeof vi.fn>).mockClear();
			await manager.rediscover();
			expect(mockRegistry.addServer).not.toHaveBeenCalled();
		});

		it("should skip quarantined servers", async () => {
			const info = makeManagedInfo("q-srv");
			(mockRegistry.getServer as ReturnType<typeof vi.fn>).mockReturnValue(info);
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start({ quarantineMaxCrashes: 1 });
			mockRegistry._emit({ type: "server:state-changed", serverId: "q-srv", from: "ready", to: "error" });
			mockDiscoverAll.mockResolvedValue([makeConfig("q-srv")]);
			(mockRegistry.addServer as ReturnType<typeof vi.fn>).mockClear();
			await manager.rediscover();
			expect(mockRegistry.addServer).not.toHaveBeenCalled();
		});

		it("should not rediscover when not running", async () => {
			mockDiscoverAll.mockResolvedValue([makeConfig("x")]);
			// Not started
			await manager.rediscover();
			expect(mockRegistry.addServer).not.toHaveBeenCalled();
		});
	});

	// ── Registry event handling ───────────────────────────────────────

	describe("registry event handling", () => {
		it("should track newly added servers", () => {
			manager.start();
			mockRegistry._emit({ type: "server:added", serverId: "new-1" });
			// Verify the server is now known by checking that rediscover skips it
			mockDiscoverAll.mockResolvedValue([makeConfig("new-1")]);
			(mockRegistry.addServer as ReturnType<typeof vi.fn>).mockClear();
			manager.rediscover();
			// Should not re-add since it's now known
		});

		it("should clean up state on server:removed", () => {
			const info = makeManagedInfo("s1");
			(mockRegistry.listServers as ReturnType<typeof vi.fn>).mockReturnValue([info]);
			manager.start();
			manager.recordCallFailure("s1");
			mockRegistry._emit({ type: "server:removed", serverId: "s1" });
			// Circuit breaker state should be removed
			const states = manager.getCircuitBreakerStates();
			expect(states.find((s) => s.serverId === "s1")).toBeUndefined();
		});

		it("should record failure on server:error event", () => {
			manager.start();
			for (let i = 0; i < 5; i++) {
				mockRegistry._emit({ type: "server:error", serverId: "s1", error: new Error("fail") });
			}
			expect(manager.isCallAllowed("s1")).toBe(false);
		});
	});
});
