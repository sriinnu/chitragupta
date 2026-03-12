import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import { registerResearchMethods } from "../src/services-research.js";

const upsertResearchExperiment = vi.fn((input: Record<string, unknown>) => ({ id: "exp-1", ...input }));
const listResearchExperiments = vi.fn(() => [
	{ id: "exp-1", decision: "keep", packedContext: "pakt:abc" },
]);
const upsertResearchLoopSummary = vi.fn((input: Record<string, unknown>) => ({ id: "loop-1", ...input }));
const listResearchLoopSummaries = vi.fn(() => [
	{ id: "loop-1", topic: "optimizer sweep", stopReason: "max-rounds" },
]);
const unpackPackedContextText = vi.fn(async () => "expanded context");
const appendMemory = vi.fn(async () => undefined);
const leave = vi.fn(() => ({ id: "trace-1" }));
const restore = vi.fn();
const persist = vi.fn();
const get = vi.fn(() => ({ kind: "agent-db" }));
const instance = vi.fn(() => ({ get }));
const AkashaField = vi.fn(function AkashaFieldMock(this: Record<string, unknown>) {
	this.restore = restore;
	this.leave = leave;
	this.persist = persist;
});
const DatabaseManager = { instance };

vi.mock("@chitragupta/smriti", () => ({
	upsertResearchExperiment,
	listResearchExperiments,
	upsertResearchLoopSummary,
	listResearchLoopSummaries,
	unpackPackedContextText,
	appendMemory,
	AkashaField,
	DatabaseManager,
}));

describe("services-research", () => {
	let router: RpcRouter;

	beforeEach(() => {
		router = new RpcRouter();
		registerResearchMethods(router);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("records bounded research experiments into the canonical ledger", async () => {
		const result = await router.handle("research.experiments.record", {
			projectPath: "/repo/project",
			experimentKey: "exp-key-1",
			attemptKey: "exp-key-1#attempt:1",
			loopKey: "loop-1",
			roundNumber: 2,
			totalRounds: 6,
			attemptNumber: 1,
			budgetMs: 300000,
			topic: "optimizer sweep",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			status: "completed",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
			plannerRouteClass: "coding.deep-reasoning",
			plannerSelectedCapabilityId: "engine.planner",
			plannerSelectedModelId: "planner-model",
			plannerSelectedProviderId: "planner-provider",
			record: { delta: 0.01 },
		}, {});

		expect(upsertResearchExperiment).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			experimentKey: "exp-key-1",
			attemptKey: "exp-key-1#attempt:1",
			loopKey: "loop-1",
			roundNumber: 2,
			totalRounds: 6,
			attemptNumber: 1,
			budgetMs: 300000,
			topic: "optimizer sweep",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			status: "completed",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
			plannerRouteClass: "coding.deep-reasoning",
			plannerSelectedCapabilityId: "engine.planner",
			plannerSelectedModelId: "planner-model",
			plannerSelectedProviderId: "planner-provider",
		}));
		expect(result).toEqual({
			experiment: expect.objectContaining({ id: "exp-1", decision: "keep" }),
		});
	});

	it("records research outcomes atomically through memory, akasha, and the ledger", async () => {
		const result = await router.handle("research.outcome.record", {
			projectPath: "/repo/../repo/project",
			experimentKey: "exp-key-2",
			attemptKey: "exp-key-2#attempt:1",
			loopKey: "loop-2",
			roundNumber: 1,
			totalRounds: 4,
			attemptNumber: 1,
			budgetMs: 300000,
			topic: "optimizer sweep",
			hypothesis: "adamw warmup beats cosine",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			status: "completed",
			agentId: "prana:autoresearch",
			entry: "## experiment",
			traceContent: "decision trace",
			traceMetadata: { phase: "night" },
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-2",
			plannerRouteClass: "coding.deep-reasoning",
			plannerSelectedCapabilityId: "engine.planner",
			plannerSelectedModelId: "planner-model",
			plannerSelectedProviderId: "planner-provider",
			record: { delta: 0.01 },
		}, {});

		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			"## experiment",
			{ dedupe: false },
		);
		expect(AkashaField).toHaveBeenCalled();
		expect(restore).toHaveBeenCalledWith({ kind: "agent-db" });
		expect(leave).toHaveBeenCalledWith(
			"prana:autoresearch",
			"pattern",
			"optimizer sweep",
			"decision trace",
			{ phase: "night" },
		);
		expect(persist).toHaveBeenCalledWith({ kind: "agent-db" });
		expect(upsertResearchExperiment).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			experimentKey: "exp-key-2",
			attemptKey: "exp-key-2#attempt:1",
			loopKey: "loop-2",
			roundNumber: 1,
			totalRounds: 4,
			attemptNumber: 1,
			budgetMs: 300000,
			topic: "optimizer sweep",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-2",
			plannerRouteClass: "coding.deep-reasoning",
			plannerSelectedCapabilityId: "engine.planner",
			plannerSelectedModelId: "planner-model",
			plannerSelectedProviderId: "planner-provider",
			status: "completed",
		}));
		expect(result).toEqual({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-1",
			experimentId: "exp-1",
			experiment: expect.objectContaining({ id: "exp-1", decision: "keep" }),
		});
	});

	it("lists experiments and expands packed context on demand", async () => {
		const result = await router.handle("research.experiments.list", {
			projectPath: "/repo/project",
			decision: "keep",
			limit: 20,
			expandPackedContext: true,
		}, {});

		expect(listResearchExperiments).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			sessionId: undefined,
			decision: "keep",
			limit: 20,
		});
		expect(unpackPackedContextText).toHaveBeenCalledWith("pakt:abc");
		expect(result).toEqual({
			experiments: [
				expect.objectContaining({
					id: "exp-1",
					expandedPackedContext: "expanded context",
				}),
			],
		});
	});

	it("does not claim expanded packed context when unpack is a no-op", async () => {
		unpackPackedContextText.mockResolvedValueOnce("pakt:abc");

		const result = await router.handle("research.experiments.list", {
			projectPath: "/repo/project",
			expandPackedContext: true,
		}, {});

		expect(result).toEqual({
			experiments: [
				expect.not.objectContaining({
					expandedPackedContext: expect.anything(),
				}),
			],
		});
	});

	it("records overnight research loop summaries into the canonical ledger", async () => {
		const result = await router.handle("research.loops.record", {
			projectPath: "/repo/project",
			loopKey: "loop-a",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
			councilVerdict: "accepted",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			roundsRequested: 6,
			roundsCompleted: 4,
			stopReason: "no-improvement",
			bestMetric: 0.991,
			bestRoundNumber: 2,
			noImprovementStreak: 2,
			totalDurationMs: 240000,
			totalBudgetMs: 300000,
			keptRounds: 1,
			revertedRounds: 3,
			plannerRouteClass: "coding.deep-reasoning",
			executionRouteClass: "tool.use.flex",
			record: { summary: true },
		}, {});

		expect(upsertResearchLoopSummary).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-a",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
			councilVerdict: "accepted",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			roundsRequested: 6,
			roundsCompleted: 4,
			stopReason: "no-improvement",
			bestMetric: 0.991,
			bestRoundNumber: 2,
			noImprovementStreak: 2,
			totalDurationMs: 240000,
			totalBudgetMs: 300000,
			keptRounds: 1,
			revertedRounds: 3,
			plannerRouteClass: "coding.deep-reasoning",
			executionRouteClass: "tool.use.flex",
		}));
		expect(result).toEqual({ summary: expect.objectContaining({ id: "loop-1" }) });
	});

	it("lists overnight research loop summaries", async () => {
		const result = await router.handle("research.loops.list", {
			projectPath: "/repo/project",
			sessionId: "sess-1",
			loopKey: "loop-a",
			updatedAfter: 100,
			updatedBefore: 200,
			limit: 25,
		}, {});

		expect(listResearchLoopSummaries).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			sessionId: "sess-1",
			loopKey: "loop-a",
			updatedAfter: 100,
			updatedBefore: 200,
			limit: 25,
		});
		expect(result).toEqual({
			summaries: [expect.objectContaining({ id: "loop-1", topic: "optimizer sweep" })],
		});
	});

	it("tracks active overnight research loop control state and cancellation", async () => {
		const started = await router.handle("research.loops.start", {
			loopKey: "loop-control-1",
			projectPath: "/repo/project",
			topic: "optimizer sweep",
			sessionId: "sess-1",
			sabhaId: "sabha-1",
			workflowId: "autoresearch-overnight",
			totalRounds: 6,
			currentRound: 1,
			attemptNumber: 1,
			phase: "start",
		}, {});

		expect(started).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-control-1",
				projectPath: "/repo/project",
				status: "running",
				totalRounds: 6,
				currentRound: 1,
				attemptNumber: 1,
				phase: "start",
				cancelRequestedAt: null,
			}),
		});

		const heartbeat = await router.handle("research.loops.heartbeat", {
			loopKey: "loop-control-1",
			currentRound: 2,
			attemptNumber: 2,
			phase: "run",
		}, {});

		expect(heartbeat).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-control-1",
				status: "running",
				currentRound: 2,
				attemptNumber: 2,
				phase: "run",
			}),
		});

		const cancelled = await router.handle("research.loops.cancel", {
			loopKey: "loop-control-1",
			reason: "operator-stop",
			requestedBy: "tester",
		}, {});

		expect(cancelled).toEqual({
			cancelled: true,
			state: expect.objectContaining({
				loopKey: "loop-control-1",
				status: "cancelling",
				cancelReason: "operator-stop",
				requestedBy: "tester",
				cancelRequestedAt: expect.any(Number),
			}),
		});

		const got = await router.handle("research.loops.get", {
			loopKey: "loop-control-1",
		}, {});

		expect(got).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-control-1",
				status: "cancelling",
				cancelReason: "operator-stop",
			}),
		});

		const completed = await router.handle("research.loops.complete", {
			loopKey: "loop-control-1",
			stopReason: "cancelled",
		}, {});

			expect(completed).toEqual({
				state: expect.objectContaining({
					loopKey: "loop-control-1",
					status: "cancelled",
					stopReason: "cancelled",
					phase: "complete",
					finishedAt: expect.any(Number),
				}),
			});

			const lateHeartbeat = await router.handle("research.loops.heartbeat", {
				loopKey: "loop-control-1",
				currentRound: 3,
				attemptNumber: 9,
				phase: "run",
			}, {});

			expect(lateHeartbeat).toEqual({
				state: expect.objectContaining({
					loopKey: "loop-control-1",
					status: "cancelled",
					stopReason: "cancelled",
					phase: "complete",
					currentRound: 2,
					attemptNumber: 2,
				}),
			});
		});

		it("marks abnormal terminal outcomes as failed in loop control state", async () => {
			await router.handle("research.loops.start", {
				loopKey: "loop-failed-1",
				projectPath: "/repo/project",
				phase: "run",
			}, {});

			const completed = await router.handle("research.loops.complete", {
				loopKey: "loop-failed-1",
				stopReason: "closure-failed",
			}, {});

			expect(completed).toEqual({
				state: expect.objectContaining({
					loopKey: "loop-failed-1",
					status: "failed",
					stopReason: "closure-failed",
					phase: "complete",
					finishedAt: expect.any(Number),
				}),
			});

			const got = await router.handle("research.loops.get", {
				loopKey: "loop-failed-1",
			}, {});

			expect(got).toEqual({
				state: expect.objectContaining({
					loopKey: "loop-failed-1",
					status: "failed",
					stopReason: "closure-failed",
				}),
			});
		});

		it("rejects reusing a completed loop key", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-reuse-1",
			projectPath: "/repo/project",
			phase: "start",
		}, {});
		await router.handle("research.loops.cancel", {
			loopKey: "loop-reuse-1",
			reason: "operator-stop",
			requestedBy: "tester",
		}, {});
		await router.handle("research.loops.complete", {
			loopKey: "loop-reuse-1",
			stopReason: "cancelled",
		}, {});

		await expect(router.handle("research.loops.start", {
			loopKey: "loop-reuse-1",
			projectPath: "/repo/project",
			topic: "fresh run",
			totalRounds: 4,
			currentRound: 1,
			attemptNumber: 1,
			phase: "start",
		}, {})).rejects.toThrow("already completed");
		});

		it("rejects reusing an active loop key", async () => {
			await router.handle("research.loops.start", {
				loopKey: "loop-active-1",
				projectPath: "/repo/project",
				phase: "start",
			}, {});

			await expect(router.handle("research.loops.start", {
				loopKey: "loop-active-1",
				projectPath: "/repo/project",
				phase: "start",
			}, {})).rejects.toThrow("already active");
		});

	it("rejects reusing a completed loop key even without explicit counters", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-reuse-2",
			projectPath: "/repo/project",
			totalRounds: 6,
			currentRound: 4,
			attemptNumber: 2,
			phase: "run",
		}, {});
		await router.handle("research.loops.complete", {
			loopKey: "loop-reuse-2",
			stopReason: "max-rounds",
		}, {});

		await expect(router.handle("research.loops.start", {
			loopKey: "loop-reuse-2",
			projectPath: "/repo/project",
			topic: "fresh run",
		}, {})).rejects.toThrow("already completed");
	});

	it("prefers cancellation when completion arrives after a cancel request", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-cancel-precedence",
			projectPath: "/repo/project",
			totalRounds: 5,
			currentRound: 5,
			attemptNumber: 1,
			phase: "finalize",
		}, {});
		await router.handle("research.loops.cancel", {
			loopKey: "loop-cancel-precedence",
			reason: "operator-stop",
			requestedBy: "tester",
		}, {});

		const completed = await router.handle("research.loops.complete", {
			loopKey: "loop-cancel-precedence",
			stopReason: "max-rounds",
		}, {});

		expect(completed).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-cancel-precedence",
				status: "cancelled",
				stopReason: "cancelled",
				cancelReason: "operator-stop",
				cancelRequestedAt: expect.any(Number),
			}),
		});
	});
	});
