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
		const { _setResearchDispatchRuntimeLoaderForTests, setResearchDispatchControlPlane } = await import("../src/chitragupta-daemon-research-scheduler.js");
		_setResearchDispatchRuntimeLoaderForTests(null);
		setResearchDispatchControlPlane(null);
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
			expect(listResearchLoopSchedules).toHaveBeenCalledWith({
				runnableOnly: true,
				limit: 25,
			});
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
		completeResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-2",
			finishedAt: Date.now(),
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
		expect(claimResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-2",
			phase: "resident-dispatch",
		}));
		expect(completeResearchLoopSchedule).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			loopKey: "loop-2",
			leaseOwner: expect.stringContaining("daemon:research-worker:"),
			stopReason: "dispatch-failed",
		});
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			type: "error",
			phase: "research-dispatch",
			detail: expect.stringContaining("missing workflowContext"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("reclaims an expired leased schedule before dispatching resident work", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-expired-lease",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				status: "leased",
				leaseOwner: "daemon:research-worker:old",
				leaseExpiresAt: Date.now() - 1_000,
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
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
		expect(claimResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-expired-lease",
			phase: "resident-dispatch",
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("short-circuits cancelling queued rows before resident execution starts", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-cancelling",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				status: "cancelling",
				cancelRequestedAt: Date.now() - 2_000,
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
			},
		]);
		claimResearchLoopSchedule.mockReturnValueOnce({
			claimed: true,
			schedule: {
				projectPath: "/repo/project",
				loopKey: "loop-cancelling",
				status: "cancelling",
				cancelRequestedAt: Date.now() - 2_000,
				leaseOwner: "daemon:research-worker:test",
				finishedAt: null,
			},
		});
		getResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-cancelling",
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
		expect(executeWorkflow).not.toHaveBeenCalled();
		expect(completeResearchLoopSchedule).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			loopKey: "loop-cancelling",
			leaseOwner: "daemon:research-worker:test",
			stopReason: "cancelled",
		});
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			phase: "research-dispatch",
			detail: expect.stringContaining("skipped loop-cancelling"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("keeps boolean terminal reconciliation semantics when daemon control-plane failDispatch cannot complete", async () => {
		const emit = vi.fn();
		const { dispatchNextQueuedResearchLoop, setResearchDispatchControlPlane, _setResearchDispatchRuntimeLoaderForTests } = await import("../src/chitragupta-daemon-research-scheduler.js");
		setResearchDispatchControlPlane({
			claimNextDispatch: vi.fn().mockResolvedValue({
				projectPath: "/repo/project",
				loopKey: "loop-cancelling-control-plane",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				status: "cancelling",
				cancelRequestedAt: Date.now() - 1_000,
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
				leaseOwner: "daemon:research-worker:test",
			}),
			requeueDispatch: vi.fn().mockResolvedValue(undefined),
			failDispatch: vi.fn().mockResolvedValue(false),
		});
		_setResearchDispatchRuntimeLoaderForTests(async () => ({
			WorkflowExecutor: class {
				execute = executeWorkflow;
			},
			getChitraguptaWorkflow,
		}));

		const dispatched = await dispatchNextQueuedResearchLoop(emit);

		expect(dispatched).toBe(true);
		expect(executeWorkflow).not.toHaveBeenCalled();
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			type: "error",
			phase: "research-dispatch",
			detail: expect.stringContaining("durable terminal reconciliation lost the lease"),
		}));
		setResearchDispatchControlPlane(null);
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
		completeResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-3",
			finishedAt: Date.now(),
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
			leaseOwner: expect.stringContaining("daemon:research-worker:"),
			stopReason: "dispatch-failed",
		});
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			type: "error",
			phase: "research-dispatch",
			detail: expect.stringContaining("non-success status failed"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

	it("reports when durable terminal reconciliation loses the resident lease", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-failed-lease-moved",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
				attemptNumber: 1,
			},
		]);
		claimResearchLoopSchedule.mockReturnValueOnce({
			claimed: true,
			schedule: {
				projectPath: "/repo/project",
				loopKey: "loop-failed-lease-moved",
				leaseOwner: "daemon:research-worker:test",
				finishedAt: null,
			},
		});
		getResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-failed-lease-moved",
			finishedAt: null,
		});
		completeResearchLoopSchedule.mockReturnValueOnce(null);
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
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			phase: "research-dispatch",
			detail: expect.stringContaining("durable lease had already moved"),
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
		claimResearchLoopSchedule.mockReturnValueOnce({
			claimed: true,
			schedule: {
				projectPath: "/repo/project",
				loopKey: "loop-4",
				leaseOwner: "daemon:research-worker:test",
				finishedAt: null,
				attemptNumber: 2,
			},
		});
			getResearchLoopSchedule.mockReturnValueOnce({
				projectPath: "/repo/project",
				loopKey: "loop-4",
				status: "leased",
				phase: "resident-dispatch",
				finishedAt: null,
				leaseOwner: "daemon:research-worker:test",
				leaseExpiresAt: Date.now() + 30_000,
			});
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

	it("reconciles cancellation instead of requeueing when cancel wins before dispatch retry", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-requeue-cancelled",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
				attemptNumber: 2,
			},
		]);
		claimResearchLoopSchedule.mockReturnValueOnce({
			claimed: true,
			schedule: {
				projectPath: "/repo/project",
				loopKey: "loop-requeue-cancelled",
				leaseOwner: "daemon:research-worker:test",
				finishedAt: null,
				attemptNumber: 2,
			},
		});
		const cancellingSchedule = {
			projectPath: "/repo/project",
			loopKey: "loop-requeue-cancelled",
			status: "cancelling",
			phase: "resident-dispatch",
			finishedAt: null,
			cancelRequestedAt: Date.now() - 1_000,
			leaseOwner: "daemon:research-worker:test",
			leaseExpiresAt: Date.now() + 30_000,
		};
		getResearchLoopSchedule.mockReturnValueOnce(cancellingSchedule);
		getResearchLoopSchedule.mockReturnValueOnce(cancellingSchedule);
		completeResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-requeue-cancelled",
			status: "cancelled",
			finishedAt: Date.now(),
		});
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
		expect(upsertResearchLoopSchedule).not.toHaveBeenCalled();
		expect(completeResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-requeue-cancelled",
			leaseOwner: "daemon:research-worker:test",
			stopReason: "cancelled",
		}));
		expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
			type: "progress",
			phase: "research-dispatch",
			detail: expect.stringContaining("cancellation was reconciled before dispatch retry"),
		}));
		_setResearchDispatchRuntimeLoaderForTests(null);
	});

		it("refuses to requeue a transient dispatch failure when another worker now owns the lease", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-requeue-lease-moved",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
				parentSessionId: null,
				sessionLineageKey: null,
				attemptNumber: 2,
			},
		]);
		claimResearchLoopSchedule.mockReturnValueOnce({
			claimed: true,
			schedule: {
				projectPath: "/repo/project",
				loopKey: "loop-requeue-lease-moved",
				leaseOwner: "daemon:research-worker:test",
				finishedAt: null,
				attemptNumber: 2,
			},
		});
		getResearchLoopSchedule.mockReturnValueOnce({
			projectPath: "/repo/project",
			loopKey: "loop-requeue-lease-moved",
			finishedAt: null,
			leaseOwner: "daemon:research-worker:other",
			leaseExpiresAt: Date.now() + 30_000,
		});
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
		expect(upsertResearchLoopSchedule).not.toHaveBeenCalled();
			expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
				type: "error",
				phase: "research-dispatch",
				detail: expect.stringContaining("lost its durable lease before dispatch retry could be recorded"),
			}));
			_setResearchDispatchRuntimeLoaderForTests(null);
		});

		it("refuses to rewind a transient dispatch failure after the loop already advanced under the same lease", async () => {
			listResearchLoopSchedules.mockReturnValueOnce([
				{
					projectPath: "/repo/project",
					loopKey: "loop-requeue-phase-advanced",
					topic: "optimizer sweep",
					hypothesis: "adamw wins",
					workflowId: "autoresearch-overnight",
					workflowContext: { researchTopic: "optimizer sweep" },
					parentSessionId: null,
					sessionLineageKey: null,
					attemptNumber: 2,
				},
			]);
			claimResearchLoopSchedule.mockReturnValueOnce({
				claimed: true,
				schedule: {
					projectPath: "/repo/project",
					loopKey: "loop-requeue-phase-advanced",
					leaseOwner: "daemon:research-worker:test",
					finishedAt: null,
					attemptNumber: 2,
					phase: "resident-dispatch",
				},
			});
			getResearchLoopSchedule.mockReturnValueOnce({
				projectPath: "/repo/project",
				loopKey: "loop-requeue-phase-advanced",
				status: "running",
				phase: "round-2",
				finishedAt: null,
				leaseOwner: "daemon:research-worker:test",
				leaseExpiresAt: Date.now() + 30_000,
			});
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
			expect(upsertResearchLoopSchedule).not.toHaveBeenCalled();
			expect(emit).toHaveBeenCalledWith("consolidation", expect.objectContaining({
				type: "error",
				phase: "research-dispatch",
				detail: expect.stringContaining("advanced to phase round-2 before dispatch retry could be recorded"),
			}));
			_setResearchDispatchRuntimeLoaderForTests(null);
		});

		it("replays the queued optimizer registry and update budgets from the durable schedule row", async () => {
		listResearchLoopSchedules.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				loopKey: "loop-6",
				topic: "optimizer sweep",
				hypothesis: "adamw wins",
					workflowId: "autoresearch-overnight",
					objectives: [{ id: "metric-improvement", weight: 2 }],
					stopConditions: [{ id: "pareto-halt", kind: "pareto-stagnation", patience: 2 }],
					updateBudgets: {
						refinement: { dailyCandidateLimit: 7 },
						nidra: { maxResearchProjectsPerCycle: 3 },
					},
					policyFingerprint: "policy-loop-6",
					primaryObjectiveId: "metric-improvement",
					primaryStopConditionId: "pareto-halt",
					workflowContext: {
						researchTopic: "stale topic",
						researchObjectives: [{ id: "stale-objective", weight: 1 }],
					},
				parentSessionId: null,
				sessionLineageKey: null,
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
			expect(executeWorkflow).toHaveBeenCalledWith(expect.objectContaining({
				context: expect.objectContaining({
					projectPath: "/repo/project",
				researchObjectives: [{ id: "metric-improvement", weight: 2 }],
				researchStopConditions: [{ id: "pareto-halt", kind: "pareto-stagnation", patience: 2 }],
				researchUpdateBudgets: {
					refinement: { dailyCandidateLimit: 7 },
					nidra: { maxResearchProjectsPerCycle: 3 },
				},
				researchPolicyFingerprint: "policy-loop-6",
				researchPrimaryObjectiveId: "metric-improvement",
				researchPrimaryStopConditionId: "pareto-halt",
				}),
			}));
			_setResearchDispatchRuntimeLoaderForTests(null);
		});

		it("skips a contended runnable row and dispatches the next durable lease winner", async () => {
			listResearchLoopSchedules.mockReturnValueOnce([
				{
					projectPath: "/repo/project",
					loopKey: "loop-contended",
					topic: "optimizer sweep",
					hypothesis: null,
					workflowId: "autoresearch-overnight",
					workflowContext: { researchTopic: "optimizer sweep" },
					parentSessionId: null,
					sessionLineageKey: null,
				},
				{
					projectPath: "/repo/project",
					loopKey: "loop-dispatchable",
					topic: "optimizer sweep",
					hypothesis: "adamw wins",
					workflowId: "autoresearch-overnight",
					workflowContext: { researchTopic: "optimizer sweep" },
					parentSessionId: null,
					sessionLineageKey: null,
				},
			]);
			claimResearchLoopSchedule
				.mockReturnValueOnce({ claimed: false, schedule: null })
				.mockReturnValueOnce({
					claimed: true,
					schedule: {
						projectPath: "/repo/project",
						loopKey: "loop-dispatchable",
						leaseOwner: "daemon:research-worker:test",
						finishedAt: null,
						phase: "resident-dispatch",
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

			expect(dispatched).toBe(true);
			expect(listResearchLoopSchedules).toHaveBeenCalledWith({
				runnableOnly: true,
				limit: 25,
			});
			expect(claimResearchLoopSchedule).toHaveBeenNthCalledWith(1, expect.objectContaining({
				projectPath: "/repo/project",
				loopKey: "loop-contended",
			}));
			expect(claimResearchLoopSchedule).toHaveBeenNthCalledWith(2, expect.objectContaining({
				projectPath: "/repo/project",
				loopKey: "loop-dispatchable",
			}));
			expect(executeWorkflow).toHaveBeenCalledWith(expect.objectContaining({
				context: expect.objectContaining({
					researchLoopKey: "loop-dispatchable",
				}),
			}));
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
		_setResearchDispatchRuntimeLoaderForTests(null);
	});
});
