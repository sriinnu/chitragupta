import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let shouldConnect = true;
let instanceCount = 0;
let connectCount = 0;
let callCount = 0;
let lastCall: { method: string; params?: Record<string, unknown> } | null = null;

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

		constructor(_config?: Record<string, unknown>) {
			instanceCount++;
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
			return { ok: true };
		}

		isConnected(): boolean {
			return this.connected;
		}

		dispose(): void {
			this.connected = false;
		}

		resetCircuit(): void {}
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
		const metadata = (lastCall?.params?.metadata ?? null) as { clientKey?: string } | null;
		expect(metadata?.clientKey).toBe("codex-argTEST");
	});
});
