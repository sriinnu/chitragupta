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
	leaseOwner: null,
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
					getLeaseOwner: () => null,
					getCancelReason: () => "test-cleanup",
					getCancelRequestedAt: () => Date.now(),
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

	it("fails closed when daemon heartbeat control state disappears", async () => {
			call.mockResolvedValueOnce({ state: { loopKey: "loop-heartbeat-missing", status: "running" } });
			const mod = await import("../src/chitragupta-nodes-research-interrupt.js");
			const handle = await mod.startResearchLoopInterrupt(scope, council, "loop-heartbeat-missing");

			call.mockResolvedValueOnce(null);
			const result = await mod.heartbeatResearchLoopInterrupt(handle, scope, council, {
				currentRound: 2,
				totalRounds: 4,
				attemptNumber: 1,
				phase: "run",
			});

			expect(result).toEqual({ cancelled: true, reason: "control-plane-lost" });
			expect(handle.isCancelled()).toBe(true);
			expect(handle.getCancelReason()).toBe("control-plane-lost");
		expect(mod.listActiveResearchLoops()).toEqual([
			expect.objectContaining({
				loopKey: "loop-heartbeat-missing",
				cancelReason: "control-plane-lost",
			}),
		]);
	});

	it("forwards an explicit durable lease owner through start, heartbeat, and complete control calls", async () => {
		call.mockResolvedValueOnce({ state: { loopKey: "loop-lease-owner", status: "running" } });
		call.mockResolvedValueOnce({ state: { loopKey: "loop-lease-owner", status: "running" } });
		call.mockResolvedValueOnce({ state: { loopKey: "loop-lease-owner", status: "completed", stopReason: "max-rounds" } });
		const mod = await import("../src/chitragupta-nodes-research-interrupt.js");
		const scoped = {
			...scope,
			leaseOwner: "daemon:research-worker:test-daemon",
		};

		const handle = await mod.startResearchLoopInterrupt(scoped, council, "loop-lease-owner");
		await mod.heartbeatResearchLoopInterrupt(handle, scoped, council, {
			currentRound: 1,
			totalRounds: 4,
			attemptNumber: 1,
			phase: "run",
		});
		await mod.completeResearchLoopInterrupt(handle, "max-rounds");

		expect(call).toHaveBeenNthCalledWith(1, "research.loops.start", expect.objectContaining({
			loopKey: "loop-lease-owner",
			leaseOwner: "daemon:research-worker:test-daemon",
		}));
		expect(call).toHaveBeenNthCalledWith(2, "research.loops.heartbeat", expect.objectContaining({
			loopKey: "loop-lease-owner",
			leaseOwner: "daemon:research-worker:test-daemon",
		}));
		expect(call).toHaveBeenNthCalledWith(3, "research.loops.complete", expect.objectContaining({
			loopKey: "loop-lease-owner",
			leaseOwner: "daemon:research-worker:test-daemon",
		}));
	});

		it("waits for aborted closure work to settle before returning", async () => {
			const { withinRemainingLoopBudget } = await import("../src/chitragupta-nodes-research-overnight-context.js");
			const parent = new AbortController();
			const events: string[] = [];

		const resultPromise = withinRemainingLoopBudget(
			{ ...scope, totalBudgetMs: 60_000 },
			0,
			Date.now(),
			"closure test",
			parent.signal,
			(signal) => new Promise<string>((resolve, reject) => {
				signal.addEventListener("abort", () => {
					events.push("aborted");
					setTimeout(() => {
						events.push("settled");
						reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
					}, 25);
				}, { once: true });
			}),
		);

		setTimeout(() => {
			events.push("cancel-requested");
			parent.abort(new Error("operator-stop"));
		}, 0);

		await expect(resultPromise).rejects.toThrow("operator-stop");
		expect(events).toEqual([
			"cancel-requested",
			"aborted",
			"settled",
		]);
	});
});
