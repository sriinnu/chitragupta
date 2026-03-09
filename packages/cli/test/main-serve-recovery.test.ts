import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
	openSession: vi.fn(),
	getNidraStatusViaDaemon: vi.fn(),
	listBuddhiDecisionsViaDaemon: vi.fn(),
	getAkashaStatsViaDaemon: vi.fn(),
	touchNidraViaDaemon: vi.fn(),
	notifyNidraSessionViaDaemon: vi.fn(),
	wakeNidraViaDaemon: vi.fn(),
	recordBuddhiDecisionViaDaemon: vi.fn(),
	getBuddhiDecisionViaDaemon: vi.fn(),
	explainBuddhiDecisionViaDaemon: vi.fn(),
	queryAkashaViaDaemon: vi.fn(),
	strongestAkashaViaDaemon: vi.fn(),
	leaveAkashaViaDaemon: vi.fn(),
	onDaemonNotification: vi.fn(),
}));

const getAkashaMock = vi.hoisted(() => vi.fn());

vi.mock("../src/modes/daemon-bridge.js", () => bridgeMocks);
vi.mock("../src/modes/mcp-subsystems.js", () => ({
	getAkasha: getAkashaMock,
}));

// Keep this test focused on daemon continuity wiring.
vi.mock("@chitragupta/niyanta", () => {
	throw new Error("skip niyanta in recovery wiring test");
});
vi.mock("@chitragupta/vidhya-skills", () => {
	throw new Error("skip vidhya-skills in recovery wiring test");
});

describe("serve-mode daemon continuity wiring", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllEnvs();

		bridgeMocks.getNidraStatusViaDaemon.mockReset();
		bridgeMocks.listBuddhiDecisionsViaDaemon.mockReset();
		bridgeMocks.getAkashaStatsViaDaemon.mockReset();
		bridgeMocks.touchNidraViaDaemon.mockReset();
		bridgeMocks.openSession.mockReset();
		bridgeMocks.notifyNidraSessionViaDaemon.mockReset();
		bridgeMocks.wakeNidraViaDaemon.mockReset();
		bridgeMocks.recordBuddhiDecisionViaDaemon.mockReset();
		bridgeMocks.getBuddhiDecisionViaDaemon.mockReset();
		bridgeMocks.explainBuddhiDecisionViaDaemon.mockReset();
		bridgeMocks.queryAkashaViaDaemon.mockReset();
		bridgeMocks.strongestAkashaViaDaemon.mockReset();
		bridgeMocks.leaveAkashaViaDaemon.mockReset();
		bridgeMocks.onDaemonNotification.mockReset();
		getAkashaMock.mockReset();

		bridgeMocks.touchNidraViaDaemon.mockResolvedValue(undefined);
		bridgeMocks.openSession.mockResolvedValue({
			session: {
				meta: { id: "serve-session-1", title: "Serve Session", created: "", updated: "", agent: "serve", model: "mock", project: "/tmp/project", parent: null, branch: null, tags: [], totalCost: 0, totalTokens: 0 },
				turns: [],
			},
			created: true,
		});
		bridgeMocks.notifyNidraSessionViaDaemon.mockResolvedValue(undefined);
		bridgeMocks.wakeNidraViaDaemon.mockResolvedValue(undefined);
		bridgeMocks.recordBuddhiDecisionViaDaemon.mockResolvedValue({ id: "dec-1" });
		bridgeMocks.getBuddhiDecisionViaDaemon.mockResolvedValue({ id: "dec-1" });
		bridgeMocks.explainBuddhiDecisionViaDaemon.mockResolvedValue("explanation");
		bridgeMocks.queryAkashaViaDaemon.mockResolvedValue([{ id: "trace-1" }]);
		bridgeMocks.strongestAkashaViaDaemon.mockResolvedValue([{ id: "trace-strongest" }]);
		bridgeMocks.leaveAkashaViaDaemon.mockResolvedValue({ id: "trace-leave" });
		bridgeMocks.onDaemonNotification.mockResolvedValue(() => {});
	});

	it("keeps deferred daemon proxies when startup probes fail and fallback is disabled", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("CHITRAGUPTA_ALLOW_LOCAL_RUNTIME_FALLBACK", "0");

		bridgeMocks.getNidraStatusViaDaemon.mockRejectedValueOnce(new Error("daemon down"));
		bridgeMocks.listBuddhiDecisionsViaDaemon
			.mockRejectedValueOnce(new Error("daemon down"))
			.mockResolvedValue([]);
		bridgeMocks.getAkashaStatsViaDaemon
			.mockRejectedValueOnce(new Error("daemon down"))
			.mockResolvedValue({ totalTraces: 1, activeTraces: 1 });

		const { wireServePhaseModules } = await import("../src/main-serve-helpers.js");
		const { modules } = await wireServePhaseModules("/tmp/project");

		expect(modules.servNidraDaemon).toBeTruthy();
		expect(modules.servBuddhi).toBeTruthy();
		expect(modules.servAkasha).toBeTruthy();
		expect(getAkashaMock).not.toHaveBeenCalled();

		await (modules.servNidraDaemon as { touch(): Promise<void> }).touch();
		await (modules.servNidraDaemon as { notifySession(id: string): Promise<void> }).notifySession("serve-chat:test");
		await (modules.servBuddhi as { listDecisions(opts: Record<string, unknown>): Promise<unknown> }).listDecisions({ limit: 1 });
		await (modules.servAkasha as { stats(): Promise<unknown> }).stats();

		expect(bridgeMocks.touchNidraViaDaemon).toHaveBeenCalledTimes(1);
		expect(bridgeMocks.notifyNidraSessionViaDaemon).toHaveBeenCalledWith("serve-chat:test");
		expect(bridgeMocks.listBuddhiDecisionsViaDaemon).toHaveBeenCalled();
		expect(bridgeMocks.getAkashaStatsViaDaemon).toHaveBeenCalledTimes(2);
	});
});
