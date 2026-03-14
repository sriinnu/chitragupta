import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listResearchLoopSchedules = vi.fn(() => []);
const claimResearchLoopSchedule = vi.fn(() => ({ claimed: true, schedule: { finishedAt: null } }));
const getResearchLoopSchedule = vi.fn(() => null);
const completeResearchLoopSchedule = vi.fn(() => null);
const upsertResearchLoopSchedule = vi.fn(() => null);
const executeWorkflow = vi.fn(async () => ({ status: "completed" }));
const getChitraguptaWorkflow = vi.fn(() => ({
	id: "autoresearch-overnight",
	nodes: [],
	edges: [],
	context: { source: "catalog" },
}));

vi.mock("@chitragupta/smriti", () => ({
	listResearchLoopSchedules,
	claimResearchLoopSchedule,
	getResearchLoopSchedule,
	completeResearchLoopSchedule,
	upsertResearchLoopSchedule,
}));

describe("resident research scheduler helper", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(async () => {
		const { _setResearchDispatchRuntimeLoaderForTests } = await import("../src/chitragupta-daemon-research-scheduler.js");
		_setResearchDispatchRuntimeLoaderForTests(null);
		vi.clearAllMocks();
	});

	it("dispatches one queued research workflow using the persisted workflow context envelope", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-1",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				workflowId: "autoresearch-overnight",
				workflowContext: {
					researchTopic: "context topic",
					existing: true,
				},
				parentSessionId: "sess-parent",
				sessionLineageKey: "lineage-1",
			},
		]);
		const emit = vi.fn();
		const { dispatchNextQueuedResearchLoop, _setResearchDispatchRuntimeLoaderForTests } = await import("../src/chitragupta-daemon-research-scheduler.js");
		_setResearchDispatchRuntimeLoaderForTests(async () => ({
			WorkflowExecutor: class {
				execute = executeWorkflow;
			},
			getChitraguptaWorkflow,
		}));

		const dispatched = await dispatchNextQueuedResearchLoop(emit);

		expect(dispatched).toBe(true);
		expect(getChitraguptaWorkflow).toHaveBeenCalledWith("autoresearch-overnight");
		expect(claimResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-1",
			leaseOwner: expect.stringContaining("daemon:research-worker:"),
			phase: "resident-dispatch",
		}));
		expect(claimResearchLoopSchedule.mock.invocationCallOrder[0]).toBeLessThan(executeWorkflow.mock.invocationCallOrder[0]);
		expect(executeWorkflow).toHaveBeenCalledWith(expect.objectContaining({
			id: "autoresearch-overnight",
			context: expect.objectContaining({
				source: "catalog",
				existing: true,
				researchLoopKey: "loop-1",
				researchTopic: "optimizer sweep",
				researchHypothesis: "adamw wins",
				researchParentSessionId: "sess-parent",
				researchSessionLineageKey: "lineage-1",
				researchLeaseOwner: expect.stringContaining("daemon:research-worker:"),
			}),
		}));
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			phase: "research-dispatch",
			detail: expect.stringContaining("dispatching loop-1"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("fails closed and marks the schedule dispatch-failed when durable workflow context is missing", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-2",
				topic: "optimizer sweep",
				hypothesis: null,
				workflowId: "autoresearch-overnight",
				workflowContext: null,
				parentSessionId: null,
				sessionLineageKey: null,
			},
		]);
		getResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-2",
			finishedAt: null,
		});
		const emit = vi.fn();
		const { dispatchNextQueuedResearchLoop, _setResearchDispatchRuntimeLoaderForTests } = await import("../src/chitragupta-daemon-research-scheduler.js");
		_setResearchDispatchRuntimeLoaderForTests(async () => ({
			WorkflowExecutor: class {
				execute = executeWorkflow;
			},
			getChitraguptaWorkflow,
		}));

		const dispatched = await dispatchNextQueuedResearchLoop(emit);

		expect(dispatched).toBe(true);
		expect(claimResearchLoopSchedule).not.toHaveBeenCalled();
		expect(completeResearchLoopSchedule).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			loopKey: "loop-2",
			stopReason: "dispatch-failed",
		});
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			type: "error",
			phase: "research-dispatch",
			detail: expect.stringContaining("missing workflowContext"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("marks non-success workflow execution as a failed dispatch instead of treating it as success", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-3",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
				attemptNumber: 1,
			},
		]);
		getResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-3",
			finishedAt: null,
		});
		executeWorkflow.mockResolvedValueOnce({ status: "failed" });
		const emit = vi.fn();
		const { dispatchNextQueuedResearchLoop, _setResearchDispatchRuntimeLoaderForTests } = await import("../src/chitragupta-daemon-research-scheduler.js");
		_setResearchDispatchRuntimeLoaderForTests(async () => ({
			WorkflowExecutor: class {
				execute = executeWorkflow;
			},
			getChitraguptaWorkflow,
		}));

		const dispatched = await dispatchNextQueuedResearchLoop(emit);

		expect(dispatched).toBe(true);
		expect(completeResearchLoopSchedule).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			loopKey: "loop-3",
			stopReason: "dispatch-failed",
		});
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			type: "error",
			phase: "research-dispatch",
			detail: expect.stringContaining("non-success status failed"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("requeues transient dispatch failures instead of burning the durable queue row", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-4",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
				attemptNumber: 2,
			},
		]);
		executeWorkflow.mockRejectedValueOnce(new Error("worker bootstrap failed"));
		const emit = vi.fn();
		const { dispatchNextQueuedResearchLoop, _setResearchDispatchRuntimeLoaderForTests } = await import("../src/chitragupta-daemon-research-scheduler.js");
		_setResearchDispatchRuntimeLoaderForTests(async () => ({
			WorkflowExecutor: class {
				execute = executeWorkflow;
			},
			getChitraguptaWorkflow,
		}));

		const dispatched = await dispatchNextQueuedResearchLoop(emit);

		expect(dispatched).toBe(true);
		expect(upsertResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-4",
			status: "queued",
			attemptNumber: 3,
			phase: "dispatch-retry",
			availableAt: expect.any(Number),
		}));
		expect(completeResearchLoopSchedule).not.toHaveBeenCalled();
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("does not execute a queued loop when another daemon already claimed the durable lease", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-5",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
				attemptNumber: 0,
			},
		]);
		claimResearchLoopSchedule.mockReturnValueOnce({
			claimed: false,
			schedule: {
				projectPath: "/repo/project",
				loopKey: "loop-5",
				leaseOwner: "daemon:research-worker:other",
				leaseExpiresAt: Date.now() + 60_000,
			},
		});
		const emit = vi.fn();
		const { dispatchNextQueuedResearchLoop, _setResearchDispatchRuntimeLoaderForTests } = await import("../src/chitragupta-daemon-research-scheduler.js");
		_setResearchDispatchRuntimeLoaderForTests(async () => ({
			WorkflowExecutor: class {
				execute = executeWorkflow;
			},
			getChitraguptaWorkflow,
		}));

		const dispatched = await dispatchNextQueuedResearchLoop(emit);

		expect(dispatched).toBe(false);
		expect(executeWorkflow).not.toHaveBeenCalled();
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			phase: "research-dispatch",
			detail: expect.stringContaining("another worker already holds the durable lease"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});
});
