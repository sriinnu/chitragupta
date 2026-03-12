import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	createClient,
	disconnect,
	call,
} = vi.hoisted(() => {
	const disconnect = vi.fn();
	const call = vi.fn();
	const createClient = vi.fn(async () => ({
		call,
		disconnect,
	}));
	return { createClient, disconnect, call };
});

vi.mock("@chitragupta/daemon", () => ({
	createClient,
}));

const scope = {
	hypothesis: "bounded research loop",
	topic: "Interrupt control",
	command: "uv",
	commandArgs: ["run", "train.py"],
	projectPath: "/repo/project",
	cwd: "/repo/project",
	parentSessionId: null,
	sessionLineageKey: null,
	targetFiles: ["train.py"],
	immutableFiles: ["prepare.py"],
	metricName: "val_bpb",
	metricPattern: "val_bpb\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?)",
	objective: "minimize" as const,
	budgetMs: 60_000,
	totalBudgetMs: 120_000,
	allowDirtyWorkspace: false,
	plannerRouteClass: "coding.deep-reasoning",
	plannerCapability: null,
	executionRouteClass: "tool.use.flex",
	executionCapability: null,
	maxRounds: 4,
	agentCount: 2,
	stopAfterNoImprovementRounds: 2,
	loopKey: "loop-control-test",
	roundNumber: null,
	totalRounds: null,
	attemptNumber: null,
};

const council = {
	sabhaId: "sabha-1",
	sessionId: "sess-1",
	topic: "Interrupt control",
	participantCount: 2,
	participants: [],
	finalVerdict: "accepted",
	rounds: 1,
	councilSummary: [],
	lucy: {
		hitEntity: null,
		predictionCount: 0,
		criticalSignalCount: 0,
		recommendation: "support" as const,
	},
	route: null,
	plannerRoute: null,
	executionRoute: null,
	source: "daemon" as const,
};

describe("research interrupt control", () => {
	beforeEach(() => {
		vi.resetModules();
		call.mockReset();
		disconnect.mockReset();
		createClient.mockReset();
		createClient.mockResolvedValue({
			call,
			disconnect,
		});
	});

	afterEach(async () => {
		const mod = await import("../src/chitragupta-nodes-research-interrupt.js");
		for (const active of mod.listActiveResearchLoops()) {
			mod.cancelResearchLoop(active.loopKey, "test-cleanup");
			call.mockResolvedValueOnce({
				state: { loopKey: active.loopKey, stopReason: "cancelled" },
			});
			await mod.completeResearchLoopInterrupt({
				loopKey: active.loopKey,
				signal: new AbortController().signal,
				getCancelReason: () => "test-cleanup",
				isCancelled: () => true,
			}, "cancelled");
		}
	});

	it("fails closed when daemon loop control cannot start", async () => {
		createClient.mockRejectedValueOnce(new Error("daemon unavailable"));
		const mod = await import("../src/chitragupta-nodes-research-interrupt.js");

		await expect(
			mod.startResearchLoopInterrupt(scope, council, "loop-start-fail"),
		).rejects.toThrow("Research loop control daemon unavailable");
		expect(mod.listActiveResearchLoops()).toEqual([]);
	});

	it("keeps local loop state until daemon completion succeeds", async () => {
		call.mockResolvedValueOnce({ state: { loopKey: "loop-complete-retry", status: "running" } });
		const mod = await import("../src/chitragupta-nodes-research-interrupt.js");
		const handle = await mod.startResearchLoopInterrupt(scope, council, "loop-complete-retry");

		expect(mod.listActiveResearchLoops()).toEqual([
			expect.objectContaining({ loopKey: "loop-complete-retry", cancelReason: null }),
		]);

		call.mockRejectedValueOnce(new Error("socket closed"));
		const failed = await mod.completeResearchLoopInterrupt(handle, "max-rounds");
		expect(failed).toBeNull();
		expect(mod.listActiveResearchLoops()).toEqual([
			expect.objectContaining({ loopKey: "loop-complete-retry", cancelReason: null }),
		]);

		call.mockResolvedValueOnce({
			state: { loopKey: "loop-complete-retry", status: "completed", stopReason: "max-rounds" },
		});
		const completed = await mod.completeResearchLoopInterrupt(handle, "max-rounds");
		expect(completed).toEqual(
			expect.objectContaining({ loopKey: "loop-complete-retry", stopReason: "max-rounds" }),
		);
		expect(mod.listActiveResearchLoops()).toEqual([]);
	});
});
