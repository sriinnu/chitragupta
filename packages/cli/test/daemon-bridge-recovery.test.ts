import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let shouldConnect = true;
let instanceCount = 0;
let connectCount = 0;
let callCount = 0;
let lastCall: { method: string; params?: Record<string, unknown> } | null = null;
const instances: Array<{
	emitNotification(method: string, params?: Record<string, unknown>): void;
}> = [];

vi.mock("@chitragupta/daemon", () => {
	class MockHealth {
		on(_event: string, _cb: (...args: unknown[]) => void): void {}
		getSnapshot(): Record<string, unknown> {
			return { state: "HEALTHY" };
		}
	}

	class MockDaemonClient {
		private connected = false;
		readonly health = new MockHealth();
		private readonly notificationHandlers = new Map<string, Set<(params?: Record<string, unknown>) => void>>();

		constructor(_config?: Record<string, unknown>) {
			instanceCount++;
			instances.push(this);
		}

		async connect(): Promise<void> {
			connectCount++;
			if (!shouldConnect) {
				const err = new Error("connect failed") as NodeJS.ErrnoException;
				err.code = "ECONNREFUSED";
				throw err;
			}
			this.connected = true;
		}

		async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
			callCount++;
			lastCall = { method, params };
			if (method === "daemon.ping") return { pong: true };
			if (method === "akasha.query") return { traces: [{ id: "trace-query", topic: String(params?.topic ?? "") }] };
			if (method === "akasha.strongest") return { traces: [{ id: "trace-strongest", topic: "strong" }] };
			if (method === "akasha.leave") return { trace: { id: "trace-leave", topic: String(params?.topic ?? "") } };
			if (method === "akasha.stats") return { totalTraces: 3, activeTraces: 2 };
			return { ok: true };
		}

		isConnected(): boolean {
			return this.connected;
		}

		dispose(): void {
			this.connected = false;
		}

		resetCircuit(): void {}

		onNotification(method: string, handler: (params?: Record<string, unknown>) => void): () => void {
			const handlers = this.notificationHandlers.get(method) ?? new Set();
			handlers.add(handler);
			this.notificationHandlers.set(method, handlers);
			return () => {
				const current = this.notificationHandlers.get(method);
				current?.delete(handler);
				if (current && current.size === 0) this.notificationHandlers.delete(method);
			};
		}

		emitNotification(method: string, params?: Record<string, unknown>): void {
			for (const handler of this.notificationHandlers.get(method) ?? []) {
				handler(params);
			}
		}
	}

	class DaemonUnavailableError extends Error {}

	return {
		DaemonClient: MockDaemonClient,
		DaemonUnavailableError,
	};
});

vi.mock("@chitragupta/daemon/resilience", () => ({
	HealthState: {
		HEALTHY: "HEALTHY",
		DEGRADED: "DEGRADED",
		HEALING: "HEALING",
		DEAD: "DEAD",
	},
}));

describe("daemon-bridge recovery", () => {
	beforeEach(() => {
		shouldConnect = true;
		instanceCount = 0;
		connectCount = 0;
		callCount = 0;
		lastCall = null;
		instances.length = 0;
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("serializes concurrent lazy init to one client connect", async () => {
		const bridge = await import("../src/modes/daemon-bridge.js");

		await Promise.all([
			bridge.getDaemonClient(),
			bridge.getDaemonClient(),
			bridge.getDaemonClient(),
		]);

		expect(instanceCount).toBe(1);
		expect(connectCount).toBe(1);
	});

		it("re-probes daemon in direct mode and auto-recovers", async () => {
			const nowSpy = vi.spyOn(Date, "now");
			nowSpy.mockReturnValue(1_000);

		shouldConnect = false;
		const bridge = await import("../src/modes/daemon-bridge.js");

		// First ping fails connect and enters direct fallback mode.
		const first = await bridge.ping();
		expect(first).toBe(false);

		// Make daemon available again and advance probe window.
		shouldConnect = true;
		nowSpy.mockReturnValue(12_000);

		const second = await bridge.ping();
			expect(second).toBe(true);
			expect(connectCount).toBeGreaterThanOrEqual(2);
			expect(callCount).toBeGreaterThan(0);
		});

		it("fails closed when daemon is unavailable and local fallback is disabled", async () => {
			vi.stubEnv("NODE_ENV", "production");
			vi.stubEnv("CHITRAGUPTA_ALLOW_LOCAL_RUNTIME_FALLBACK", "0");
			shouldConnect = false;
			const bridge = await import("../src/modes/daemon-bridge.js");

			await expect(bridge.listSessions("/tmp/project")).rejects.toThrow(
				/local runtime fallback is disabled/i,
			);
		});

		it("injects an MCP clientKey into session.create metadata", async () => {
			vi.stubEnv("CHITRAGUPTA_CLIENT_KEY", "");
		vi.stubEnv("CODEX_THREAD_ID", "");
		vi.stubEnv("CLAUDE_CODE_SESSION_ID", "");
		vi.stubEnv("CLAUDE_SESSION_ID", "");
		vi.stubEnv("PATH", "/home/sriinnu/.codex/tmp/arg0/codex-argTEST:/usr/bin");
		const bridge = await import("../src/modes/daemon-bridge.js");

		await bridge.createSession({
			project: "/tmp/project",
			agent: "mcp",
			model: "mcp-client",
			title: "MCP session",
		});

		expect(lastCall?.method).toBe("session.create");
		const metadata = (lastCall?.params?.metadata ?? null) as {
			clientKey?: string;
			sessionLineageKey?: string;
			sessionReusePolicy?: string;
			surface?: string;
			channel?: string;
		} | null;
		expect(metadata?.clientKey).toBe("codex-argTEST");
		expect(metadata?.sessionLineageKey).toBe("codex-argTEST");
		expect(metadata?.sessionReusePolicy).toBe("same_day");
		expect(metadata?.surface).toBe("mcp");
		expect(metadata?.channel).toBe("mcp");
	});

	it("rebinds daemon-push notification handlers after reconnect", async () => {
		const bridge = await import("../src/modes/daemon-bridge.js");
		const handler = vi.fn();

		await bridge.onDaemonNotification("heal_reported", handler);
		expect(instances).toHaveLength(1);
		instances[0]?.emitNotification("heal_reported", { outcome: "success", entity: "smriti" });
		expect(handler).toHaveBeenCalledTimes(1);

		bridge.disconnectDaemon();
		await bridge.getDaemonClient();
		expect(instances).toHaveLength(2);
		instances[1]?.emitNotification("heal_reported", { outcome: "success", entity: "smriti" });
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("routes new daemon-backed Akasha, Buddhi, and Nidra helpers through RPC", async () => {
		const bridge = await import("../src/modes/daemon-bridge.js");

		await bridge.leaveAkashaViaDaemon({
			agentId: "lucy-bridge",
			type: "solution",
			topic: "auth",
			content: "Use daemon-backed Akasha",
		});
		expect(lastCall).toMatchObject({
			method: "akasha.leave",
			params: expect.objectContaining({ agentId: "lucy-bridge", topic: "auth" }),
		});

		await bridge.recordBuddhiDecisionViaDaemon({
			sessionId: "sess-1",
			project: "/tmp/project",
			category: "tool-selection",
			description: "Use bash",
			confidence: 0.8,
			reasoning: {
				thesis: "bash is correct",
				reason: "tool exists",
				example: "shell search is fast",
				application: "repo search is needed",
				conclusion: "use bash",
			},
		});
		expect(lastCall).toMatchObject({
			method: "buddhi.record",
			params: expect.objectContaining({ sessionId: "sess-1", category: "tool-selection" }),
		});

		await bridge.notifyNidraSessionViaDaemon("serve-chat:test");
		expect(lastCall).toMatchObject({
			method: "nidra.notify_session",
			params: { sessionId: "serve-chat:test" },
		});
	});

	it("keeps daemon-backed Akasha notifications alive across reconnects", async () => {
		const bridge = await import("../src/modes/daemon-bridge.js");
		const { createDaemonAkashaProxy } = await import("../src/runtime-daemon-proxies.js");
		const akasha = createDaemonAkashaProxy();
		const onEvent = vi.fn();

		akasha.setOnEvent(onEvent);
		await new Promise((resolve) => setTimeout(resolve, 0));

		await akasha.query("auth", { limit: 3 });
		expect(lastCall).toMatchObject({
			method: "akasha.query",
			params: { topic: "auth", type: undefined, limit: 3 },
		});

		instances.at(-1)?.emitNotification("akasha.trace_added", {
			type: "trace_added",
			trace: { id: "trace-1" },
		});
		expect(onEvent).toHaveBeenCalledWith({
			type: "trace_added",
			trace: { id: "trace-1" },
		});

		bridge.disconnectDaemon();
		await bridge.getDaemonClient();
		instances.at(-1)?.emitNotification("akasha.trace_added", {
			type: "trace_added",
			trace: { id: "trace-2" },
		});
		expect(onEvent).toHaveBeenCalledWith({
			type: "trace_added",
			trace: { id: "trace-2" },
		});
	});
});
