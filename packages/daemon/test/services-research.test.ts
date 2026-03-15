import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import { registerResearchMethods } from "../src/services-research.js";
import { registerResearchCheckpointMethods } from "../src/services-research-checkpoints.js";
import {
	failDurableResearchLoopDispatch,
	requeueDurableResearchLoopDispatch,
} from "../src/services-research-scheduler.js";
import { clearResearchLoopStates } from "../src/services-research-loop-state.js";

const upsertResearchExperiment = vi.fn((input: Record<string, unknown>) => ({ id: "exp-1", ...input }));
const listResearchExperiments = vi.fn(() => [
	{ id: "exp-1", decision: "keep", packedContext: "pakt:abc" },
]);
const upsertResearchLoopSummary = vi.fn((input: Record<string, unknown>) => ({ id: "loop-1", ...input }));
const listResearchLoopSummaries = vi.fn(() => [
	{ id: "loop-1", topic: "optimizer sweep", stopReason: "max-rounds" },
]);
const upsertResearchLoopCheckpoint = vi.fn((input: Record<string, unknown>) => ({
	id: "checkpoint-1",
	projectPath: String(input.projectPath),
	loopKey: String(input.loopKey),
	phase: String(input.phase),
	status: String(input.status),
	checkpoint: input.checkpoint,
}));
const listResearchLoopCheckpoints = vi.fn(() => [
	{
		id: "checkpoint-1",
		projectPath: "/repo/project",
		loopKey: "loop-a",
		topic: "optimizer sweep",
		hypothesis: "adamw beats cosine",
		phase: "closure-record",
		status: "active",
		currentRound: 1,
		nextRoundNumber: 2,
		totalRounds: 6,
		checkpoint: {
			version: 1,
			phase: "closure-record",
			progress: {
				bestMetric: 0.991,
				bestRoundNumber: 1,
				noImprovementStreak: 1,
			},
		},
	},
]);
const getResearchLoopCheckpoint = vi.fn(() => ({
	id: "checkpoint-1",
	projectPath: "/repo/project",
	loopKey: "loop-a",
	topic: "optimizer sweep",
	hypothesis: "adamw beats cosine",
	phase: "closure-record",
	status: "active",
	currentRound: 1,
	nextRoundNumber: 2,
	totalRounds: 6,
	checkpoint: {
		version: 1,
		phase: "closure-record",
		progress: {
			bestMetric: 0.991,
			bestRoundNumber: 1,
			noImprovementStreak: 1,
		},
	},
}));
const clearResearchLoopCheckpoint = vi.fn(() => true);
const unpackPackedContextText = vi.fn(async () => "expanded context");
const appendMemory = vi.fn(async () => undefined);
const upsertResearchRefinementQueue = vi.fn(() => 1);
const researchLoopSchedules = new Map<string, Record<string, unknown>>();
const scheduleKey = (projectPath: string, loopKey: string) => `${projectPath}::${loopKey}`;
const buildImmediateResearchRefinementRequests = vi.fn((args: {
	projectPath: string;
	date: string;
	elevatedSignal: boolean;
	override?: {
		dailyCandidateLimit?: number;
		projectCandidateLimit?: number;
	} | null;
}) => ({
	daily: {
		dates: [args.date],
		levels: ["daily"],
		candidateLimit: args.override?.dailyCandidateLimit ?? (args.elevatedSignal ? 8 : 4),
		reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "low_retention", "low_reduction", "rejected_packed"],
	},
	project: {
		projects: [args.projectPath],
		levels: ["monthly", "yearly"],
		periods: [args.date.slice(0, 7), args.date.slice(0, 4)],
		candidateLimit: args.override?.projectCandidateLimit ?? (args.elevatedSignal ? 6 : 3),
		reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "low_retention", "low_reduction", "rejected_packed"],
	},
}));
const upsertResearchRefinementBudget = vi.fn(() => undefined);
const repairSelectiveReembedding = vi.fn(async (input: Record<string, unknown>) => ({
	plan: { scanned: 1, candidateCount: Array.isArray(input.levels) && input.levels.includes("daily") ? 2 : 1, candidates: [] },
	reembedded: Array.isArray(input.levels) && input.levels.includes("daily") ? 2 : 1,
	remoteSynced: Array.isArray(input.levels) && input.levels.includes("daily") ? 1 : 0,
	qualityDeferred: 0,
}));
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
const isTerminalScheduleStatus = (status: unknown) =>
	status === "cancelled" || status === "completed" || status === "failed";
const isActiveScheduleLease = (
	entry: Record<string, unknown> | undefined,
	now: number,
	leaseOwner?: string | null,
) => Boolean(
	entry
	&& typeof entry.leaseOwner === "string"
	&& entry.leaseOwner
	&& typeof entry.leaseExpiresAt === "number"
	&& entry.leaseExpiresAt > now
	&& (!leaseOwner || entry.leaseOwner !== leaseOwner),
);
const upsertResearchLoopSchedule = vi.fn((input: Record<string, unknown>) => {
	const now = Date.now();
	const key = scheduleKey(String(input.projectPath), String(input.loopKey));
	const existing = researchLoopSchedules.get(key);
	const status = typeof input.status === "string" ? input.status : existing?.status ?? "queued";
	const record = {
		projectPath: String(input.projectPath),
		loopKey: String(input.loopKey),
		topic: typeof input.topic === "string" ? input.topic : existing?.topic ?? null,
		hypothesis: typeof input.hypothesis === "string" ? input.hypothesis : existing?.hypothesis ?? null,
		sessionId: typeof input.sessionId === "string" ? input.sessionId : existing?.sessionId ?? null,
		parentSessionId: typeof input.parentSessionId === "string" ? input.parentSessionId : existing?.parentSessionId ?? null,
		sessionLineageKey: typeof input.sessionLineageKey === "string" ? input.sessionLineageKey : existing?.sessionLineageKey ?? null,
		sabhaId: typeof input.sabhaId === "string" ? input.sabhaId : existing?.sabhaId ?? null,
		workflowId: typeof input.workflowId === "string" ? input.workflowId : existing?.workflowId ?? null,
		status,
		queuedAt: existing?.queuedAt ?? now,
		availableAt: typeof input.availableAt === "number" ? input.availableAt : existing?.availableAt ?? now,
		updatedAt: now,
		leaseOwner: status === "queued" ? null : existing?.leaseOwner ?? null,
		leaseExpiresAt: status === "queued" ? null : existing?.leaseExpiresAt ?? null,
		leaseHeartbeatAt: status === "queued" ? null : existing?.leaseHeartbeatAt ?? null,
		currentRound: typeof input.currentRound === "number" ? input.currentRound : existing?.currentRound ?? null,
		totalRounds: typeof input.totalRounds === "number" ? input.totalRounds : existing?.totalRounds ?? null,
		attemptNumber: typeof input.attemptNumber === "number" ? input.attemptNumber : existing?.attemptNumber ?? null,
		phase: typeof input.phase === "string" ? input.phase : existing?.phase ?? null,
		cancelRequestedAt: existing?.cancelRequestedAt ?? null,
		cancelReason: existing?.cancelReason ?? null,
		requestedBy: existing?.requestedBy ?? null,
			stopReason: existing?.stopReason ?? null,
			finishedAt: existing?.finishedAt ?? null,
			objectives: Array.isArray(input.objectives) ? input.objectives : existing?.objectives ?? [],
			stopConditions: Array.isArray(input.stopConditions) ? input.stopConditions : existing?.stopConditions ?? [],
			updateBudgets: input.updateBudgets && typeof input.updateBudgets === "object" ? input.updateBudgets : existing?.updateBudgets ?? null,
			policyFingerprint: typeof input.policyFingerprint === "string" ? input.policyFingerprint : existing?.policyFingerprint ?? null,
			primaryObjectiveId: typeof input.primaryObjectiveId === "string" ? input.primaryObjectiveId : existing?.primaryObjectiveId ?? null,
			primaryStopConditionId: typeof input.primaryStopConditionId === "string" ? input.primaryStopConditionId : existing?.primaryStopConditionId ?? null,
			workflowContext: input.workflowContext && typeof input.workflowContext === "object" ? input.workflowContext : existing?.workflowContext ?? null,
		};
	researchLoopSchedules.set(key, record);
	return record;
});
const getResearchLoopSchedule = vi.fn((projectPath: string, loopKey: string) => (
	researchLoopSchedules.get(scheduleKey(projectPath, loopKey)) ?? null
));
const listResearchLoopSchedules = vi.fn((options?: {
	projectPath?: string;
	runnableOnly?: boolean;
	limit?: number;
}) => {
	let values = [...researchLoopSchedules.values()];
	if (options?.projectPath) {
		values = values.filter((entry) => entry.projectPath === options.projectPath);
	}
	if (options?.runnableOnly) {
		const now = Date.now();
		values = values.filter((entry) => (
			(entry.status === "queued" || entry.status === "leased" || entry.status === "cancelling")
			&& !isTerminalScheduleStatus(entry.status)
			&& (typeof entry.availableAt !== "number" || entry.availableAt <= now)
			&& (entry.status === "queued" || !isActiveScheduleLease(entry, now))
		));
	}
	return values.slice(0, options?.limit ?? values.length);
});
const claimResearchLoopSchedule = vi.fn((input: Record<string, unknown>) => {
	const key = scheduleKey(String(input.projectPath), String(input.loopKey));
	const existing = researchLoopSchedules.get(key);
	if (!existing) return { claimed: false, schedule: null };
	const now = typeof input.now === "number" ? input.now : Date.now();
	if (isTerminalScheduleStatus(existing.status)) {
		return { claimed: false, schedule: existing };
	}
	if (
		(existing.status === "queued" || existing.status === "cancelling")
		&& typeof existing.availableAt === "number"
		&& existing.availableAt > now
	) {
		return { claimed: false, schedule: existing };
	}
	if (
		typeof input.leaseOwner === "string"
		&& input.leaseOwner
		&& existing.leaseOwner === input.leaseOwner
		&& typeof existing.leaseExpiresAt === "number"
		&& existing.leaseExpiresAt > now
	) {
		const claimed = {
			...existing,
			status: existing.cancelRequestedAt ? "cancelling" : "leased",
			leaseHeartbeatAt: now,
			leaseExpiresAt: now + (typeof input.leaseTtlMs === "number" ? input.leaseTtlMs : 90_000),
			currentRound: typeof input.currentRound === "number" ? input.currentRound : existing.currentRound,
			totalRounds: typeof input.totalRounds === "number" ? input.totalRounds : existing.totalRounds,
			attemptNumber: typeof input.attemptNumber === "number" ? input.attemptNumber : existing.attemptNumber,
			phase: typeof input.phase === "string" ? input.phase : existing.phase,
			updatedAt: now,
		};
		researchLoopSchedules.set(key, claimed);
		return { claimed: true, schedule: claimed };
	}
	if (
		!isActiveScheduleLease(existing, now, typeof input.leaseOwner === "string" ? input.leaseOwner : null)
		&& isActiveScheduleLease(existing, now)
	) {
		return { claimed: false, schedule: existing };
	}
	const claimed = {
		...existing,
		status: existing.cancelRequestedAt ? "cancelling" : "leased",
		leaseOwner: String(input.leaseOwner),
		leaseHeartbeatAt: now,
		leaseExpiresAt: now + (typeof input.leaseTtlMs === "number" ? input.leaseTtlMs : 90_000),
		currentRound: typeof input.currentRound === "number" ? input.currentRound : existing.currentRound,
		totalRounds: typeof input.totalRounds === "number" ? input.totalRounds : existing.totalRounds,
		attemptNumber: typeof input.attemptNumber === "number" ? input.attemptNumber : existing.attemptNumber,
		phase: typeof input.phase === "string" ? input.phase : existing.phase,
		updatedAt: now,
	};
	researchLoopSchedules.set(key, claimed);
	return { claimed: true, schedule: claimed };
});
const heartbeatResearchLoopSchedule = vi.fn((input: Record<string, unknown>) => {
	const claimed = claimResearchLoopSchedule(input);
	return claimed.claimed ? claimed.schedule : null;
});
const cancelResearchLoopSchedule = vi.fn((input: Record<string, unknown>) => {
	const key = scheduleKey(String(input.projectPath), String(input.loopKey));
	const existing = researchLoopSchedules.get(key);
	if (!existing) return null;
	const cancelled = {
		...existing,
		status: "cancelling",
		cancelRequestedAt: existing.cancelRequestedAt ?? Date.now(),
		cancelReason: typeof input.reason === "string" ? input.reason : "operator-interrupt",
		requestedBy: typeof input.requestedBy === "string" ? input.requestedBy : null,
		updatedAt: Date.now(),
	};
	researchLoopSchedules.set(key, cancelled);
	return cancelled;
});
const completeResearchLoopSchedule = vi.fn((input: Record<string, unknown>) => {
	const key = scheduleKey(String(input.projectPath), String(input.loopKey));
	const existing = researchLoopSchedules.get(key);
	if (!existing) return null;
	const now = typeof input.now === "number" ? input.now : Date.now();
	if (
		isActiveScheduleLease(
			existing,
			now,
			typeof input.leaseOwner === "string" ? input.leaseOwner : null,
		)
	) {
		return null;
	}
	const stopReason = typeof input.stopReason === "string" ? input.stopReason : null;
	const completed = {
		...existing,
		status:
			stopReason === "cancelled"
				? "cancelled"
				: stopReason === "closure-failed"
					|| stopReason === "round-failed"
					|| stopReason === "unsafe-discard"
					|| stopReason === "control-plane-lost"
					|| stopReason === "dispatch-failed"
					? "failed"
					: "completed",
		stopReason,
		leaseOwner: null,
		leaseExpiresAt: null,
		leaseHeartbeatAt: null,
		finishedAt: now,
		updatedAt: now,
	};
	researchLoopSchedules.set(key, completed);
	return completed;
});

vi.mock("@chitragupta/smriti", () => ({
	upsertResearchExperiment,
	listResearchExperiments,
	upsertResearchLoopSummary,
	listResearchLoopSummaries,
	upsertResearchLoopCheckpoint,
	listResearchLoopCheckpoints,
	getResearchLoopCheckpoint,
	clearResearchLoopCheckpoint,
	unpackPackedContextText,
	appendMemory,
	upsertResearchRefinementQueue,
	upsertResearchLoopSchedule,
	getResearchLoopSchedule,
	listResearchLoopSchedules,
	claimResearchLoopSchedule,
	heartbeatResearchLoopSchedule,
	cancelResearchLoopSchedule,
	completeResearchLoopSchedule,
	buildImmediateResearchRefinementRequests,
	upsertResearchRefinementBudget,
	repairSelectiveReembedding,
	AkashaField,
	DatabaseManager,
}));

describe("services-research", () => {
	let router: RpcRouter;

	beforeEach(() => {
		clearResearchLoopStates();
		researchLoopSchedules.clear();
		upsertResearchExperiment.mockImplementation((input: Record<string, unknown>) => ({ id: "exp-1", ...input }));
		listResearchExperiments.mockImplementation(() => [
			{ id: "exp-1", decision: "keep", packedContext: "pakt:abc" },
		]);
		upsertResearchLoopSummary.mockImplementation((input: Record<string, unknown>) => ({ id: "loop-1", ...input }));
		listResearchLoopSummaries.mockImplementation(() => [
			{ id: "loop-1", topic: "optimizer sweep", stopReason: "max-rounds" },
		]);
		upsertResearchLoopCheckpoint.mockImplementation((input: Record<string, unknown>) => ({
			id: "checkpoint-1",
			projectPath: String(input.projectPath),
			loopKey: String(input.loopKey),
			phase: String(input.phase),
			status: String(input.status),
			checkpoint: input.checkpoint,
		}));
		listResearchLoopCheckpoints.mockImplementation(() => [
			{
				id: "checkpoint-1",
				projectPath: "/repo/project",
				loopKey: "loop-a",
				topic: "optimizer sweep",
				hypothesis: "adamw beats cosine",
				phase: "closure-record",
				status: "active",
				currentRound: 1,
				nextRoundNumber: 2,
				totalRounds: 6,
				checkpoint: {
					version: 1,
					phase: "closure-record",
					progress: {
						bestMetric: 0.991,
						bestRoundNumber: 1,
						noImprovementStreak: 1,
					},
				},
			},
		]);
		getResearchLoopCheckpoint.mockImplementation(() => ({
			id: "checkpoint-1",
			projectPath: "/repo/project",
			loopKey: "loop-a",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			phase: "closure-record",
			status: "active",
			currentRound: 1,
			nextRoundNumber: 2,
			totalRounds: 6,
			checkpoint: {
				version: 1,
				phase: "closure-record",
				progress: {
					bestMetric: 0.991,
					bestRoundNumber: 1,
					noImprovementStreak: 1,
				},
			},
		}));
			clearResearchLoopCheckpoint.mockImplementation(() => true);
			unpackPackedContextText.mockImplementation(async () => "expanded context");
		appendMemory.mockImplementation(async () => undefined);
		upsertResearchRefinementQueue.mockImplementation(() => 1);
		upsertResearchLoopSchedule.mockClear();
		getResearchLoopSchedule.mockClear();
		listResearchLoopSchedules.mockClear();
		claimResearchLoopSchedule.mockClear();
		heartbeatResearchLoopSchedule.mockClear();
		cancelResearchLoopSchedule.mockClear();
		completeResearchLoopSchedule.mockClear();
			buildImmediateResearchRefinementRequests.mockImplementation((args: {
				projectPath: string;
				date: string;
				elevatedSignal: boolean;
				override?: {
					dailyCandidateLimit?: number;
					projectCandidateLimit?: number;
				} | null;
			}) => ({
				daily: {
					dates: [args.date],
					levels: ["daily"],
					candidateLimit: args.override?.dailyCandidateLimit ?? (args.elevatedSignal ? 8 : 4),
					reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "low_retention", "low_reduction", "rejected_packed"],
				},
				project: {
					projects: [args.projectPath],
					levels: ["monthly", "yearly"],
					periods: [args.date.slice(0, 7), args.date.slice(0, 4)],
					candidateLimit: args.override?.projectCandidateLimit ?? (args.elevatedSignal ? 6 : 3),
					reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "low_retention", "low_reduction", "rejected_packed"],
				},
			}));
			upsertResearchRefinementBudget.mockImplementation(() => undefined);
			repairSelectiveReembedding.mockImplementation(async (input: Record<string, unknown>) => ({
			plan: { scanned: 1, candidateCount: Array.isArray(input.levels) && input.levels.includes("daily") ? 2 : 1, candidates: [] },
			reembedded: Array.isArray(input.levels) && input.levels.includes("daily") ? 2 : 1,
			remoteSynced: Array.isArray(input.levels) && input.levels.includes("daily") ? 1 : 0,
			qualityDeferred: 0,
		}));
		leave.mockImplementation(() => ({ id: "trace-1" }));
		get.mockImplementation(() => ({ kind: "agent-db" }));
		instance.mockImplementation(() => ({ get }));
		router = new RpcRouter();
		registerResearchMethods(router);
		registerResearchCheckpointMethods(router);
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
		const recordedAt = new Date("2026-03-13T02:03:04.000Z").getTime();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(recordedAt);
		try {
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
			{ dedupe: true },
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
			semanticRepair: expect.objectContaining({
				status: "repaired",
				daily: expect.objectContaining({
					date: "2026-03-13",
					candidates: 2,
					reembedded: 2,
				}),
				project: expect.objectContaining({
					candidates: 1,
					reembedded: 1,
				}),
			}),
			queuedSemanticRefinement: false,
			});
			expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(1, expect.objectContaining({
			dates: ["2026-03-13"],
			levels: ["daily"],
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "low_retention", "low_reduction", "rejected_packed"],
			}));
			expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(2, expect.objectContaining({
			projects: ["/repo/project"],
			levels: ["monthly", "yearly"],
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "low_retention", "low_reduction", "rejected_packed"],
			}));
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("treats repeated research outcome recording as an idempotent no-op when a trace already exists", async () => {
		upsertResearchExperiment
			.mockReturnValueOnce({
				id: "exp-existing",
				record: {
					traceId: "trace-existing",
					semanticRepairRecorded: true,
					semanticRepair: { status: "repaired" },
					queuedSemanticRefinement: false,
				},
			} as Record<string, unknown>)
			.mockReturnValue({
				id: "exp-existing",
				record: {
					traceId: "trace-existing",
					semanticRepairRecorded: true,
					semanticRepair: { status: "repaired" },
					queuedSemanticRefinement: false,
				},
			} as Record<string, unknown>);

		const result = await router.handle("research.outcome.record", {
			projectPath: "/repo/project",
			experimentKey: "exp-key-existing",
			attemptKey: "exp-key-existing#attempt:1",
			topic: "optimizer sweep",
			hypothesis: "existing attempt should not duplicate side effects",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			entry: "## experiment",
			traceContent: "decision trace",
			record: { delta: 0.01, traceId: "trace-existing" },
		}, {});

		expect(appendMemory).not.toHaveBeenCalled();
		expect(AkashaField).not.toHaveBeenCalled();
		expect(result).toEqual({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-existing",
			experimentId: "exp-existing",
			experiment: expect.objectContaining({ id: "exp-existing" }),
			semanticRepair: { status: "repaired" },
			queuedSemanticRefinement: false,
		});
		expect(repairSelectiveReembedding).not.toHaveBeenCalled();
	});

	it("reuses an existing trace id but still completes semantic repair when prior recording stopped early", async () => {
		upsertResearchExperiment
			.mockReturnValueOnce({
				id: "exp-existing",
				projectPath: "/repo/project",
				decision: "keep",
				record: { traceId: "trace-existing", memoryEntryRecorded: true, recordedAt: Date.parse("2026-03-13T02:03:04.000Z") },
			} as Record<string, unknown>)
			.mockReturnValueOnce({
				id: "exp-existing",
				projectPath: "/repo/project",
				decision: "keep",
				record: {
					traceId: "trace-existing",
					memoryEntryRecorded: true,
					recordedAt: Date.parse("2026-03-13T02:03:04.000Z"),
					semanticRepairRecorded: true,
				},
			} as Record<string, unknown>);

		const result = await router.handle("research.outcome.record", {
			projectPath: "/repo/project",
			experimentKey: "exp-key-existing",
			attemptKey: "exp-key-existing#attempt:1",
			topic: "optimizer sweep",
			hypothesis: "resume missing repair work",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			status: "completed",
			entry: "## experiment",
			traceContent: "decision trace",
			record: { delta: 0.01, traceId: "trace-existing" },
		}, {});

		expect(appendMemory).not.toHaveBeenCalled();
		expect(AkashaField).not.toHaveBeenCalled();
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(2);
		expect(upsertResearchExperiment).toHaveBeenCalledTimes(2);
		expect(result).toEqual({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-existing",
			experimentId: "exp-existing",
			experiment: expect.objectContaining({ id: "exp-existing" }),
			semanticRepair: expect.objectContaining({
				status: "repaired",
				daily: expect.objectContaining({ candidates: 2 }),
				project: expect.objectContaining({ candidates: 1 }),
			}),
			queuedSemanticRefinement: false,
		});
	});

	it("degrades immediate semantic repair without failing canonical outcome recording", async () => {
		repairSelectiveReembedding.mockRejectedValueOnce(new Error("semantic down"));

		const result = await router.handle("research.outcome.record", {
			projectPath: "/repo/project",
			experimentKey: "exp-key-degraded",
			attemptKey: "exp-key-degraded#attempt:1",
			topic: "optimizer sweep",
			hypothesis: "retry path should still persist",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "discard",
			status: "completed",
			entry: "## experiment",
			traceContent: "decision trace",
			record: { delta: -0.01 },
		}, {});

		expect(result).toEqual({
			recorded: true,
			memoryScope: "project",
			traceId: "trace-1",
			experimentId: "exp-1",
			experiment: expect.objectContaining({ id: "exp-1", decision: "discard" }),
			semanticRepair: expect.objectContaining({
				status: "degraded",
				error: "semantic down",
			}),
			queuedSemanticRefinement: true,
			});
		const today = new Date().toISOString().slice(0, 10);
		expect(upsertResearchRefinementQueue).toHaveBeenCalledWith([
			expect.objectContaining({
				projectPath: "/repo/project",
				repairIntent: expect.objectContaining({
					daily: expect.objectContaining({
						dates: [today],
						levels: ["daily"],
					}),
					project: expect.objectContaining({
						projects: ["/repo/project"],
						levels: ["monthly", "yearly"],
						periods: [today.slice(0, 7), today.slice(0, 4)],
					}),
				}),
			}),
		], expect.any(Object));
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

	it("persists and reloads research loop checkpoints", async () => {
		const saved = await router.handle("research.loops.checkpoint.save", {
			projectPath: "/repo/../repo/project",
			loopKey: "loop-a",
			sessionId: "sess-1",
			parentSessionId: "parent-1",
			sessionLineageKey: "lineage-a",
			sabhaId: "sabha-1",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			status: "active",
			phase: "closure-record",
			currentRound: 1,
			nextRoundNumber: 2,
			totalRounds: 6,
			checkpoint: { version: 1, phase: "closure-record" },
		}, {});

		expect(upsertResearchLoopCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-a",
			phase: "closure-record",
			status: "active",
			currentRound: 1,
			nextRoundNumber: 2,
			totalRounds: 6,
		}));
		expect(saved).toEqual({
			checkpoint: expect.objectContaining({
				id: "checkpoint-1",
				loopKey: "loop-a",
			}),
		});

		const loaded = await router.handle("research.loops.checkpoint.get", {
			projectPath: "/repo/project",
			loopKey: "loop-a",
		}, {});
		expect(loaded).toEqual({
			checkpoint: expect.objectContaining({
				id: "checkpoint-1",
				loopKey: "loop-a",
			}),
			resumeContext: expect.stringContaining("Durable research resume context:"),
		});

		const listed = await router.handle("research.loops.checkpoint.list", {
			projectPath: "/repo/project",
			limit: 10,
		}, {});
		expect(listResearchLoopCheckpoints).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			limit: 10,
		});
		expect(listed).toEqual({
			checkpoints: [
				expect.objectContaining({
					id: "checkpoint-1",
					loopKey: "loop-a",
					resumeContext: expect.stringContaining("durable checkpoint phase: closure-record"),
				}),
			],
		});

		const cleared = await router.handle("research.loops.checkpoint.clear", {
			projectPath: "/repo/project",
			loopKey: "loop-a",
		}, {});
		expect(clearResearchLoopCheckpoint).toHaveBeenCalledWith("/repo/project", "loop-a");
		expect(cleared).toEqual({ cleared: true });
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

		it("queues a durable research schedule with objective and stop registries", async () => {
			const result = await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-queued-1",
				topic: "optimizer sweep",
				objectives: [{ id: "metric-improvement", weight: 1.6 }],
				stopConditions: [{ id: "budget-exhausted", kind: "budget-exhausted" }],
				updateBudgets: { nidra: { maxResearchProjectsPerCycle: 3 } },
				policyFingerprint: "policy-loop-queued-1",
				primaryObjectiveId: "metric-improvement",
				primaryStopConditionId: "budget-exhausted",
				workflowContext: {
					researchTopic: "optimizer sweep",
					researchBudgetMs: 300_000,
				},
			}, {});

			expect(upsertResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
				projectPath: "/repo/project",
				loopKey: "loop-queued-1",
					status: "queued",
					objectives: [{ id: "metric-improvement", weight: 1.6 }],
					stopConditions: [{ id: "budget-exhausted", kind: "budget-exhausted" }],
					updateBudgets: { nidra: { maxResearchProjectsPerCycle: 3 } },
					policyFingerprint: "policy-loop-queued-1",
					primaryObjectiveId: "metric-improvement",
					primaryStopConditionId: "budget-exhausted",
					workflowContext: {
						researchTopic: "optimizer sweep",
						researchBudgetMs: 300_000,
					},
				}));
			expect(result).toEqual({
				schedule: expect.objectContaining({
						loopKey: "loop-queued-1",
						status: "queued",
						objectives: [{ id: "metric-improvement", weight: 1.6 }],
						policyFingerprint: "policy-loop-queued-1",
						primaryObjectiveId: "metric-improvement",
						primaryStopConditionId: "budget-exhausted",
						workflowContext: {
							researchTopic: "optimizer sweep",
							researchBudgetMs: 300_000,
						},
				}),
			});
		});

		it("fails closed on project-less durable schedule lookup when loop keys collide across projects", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project-a",
				loopKey: "loop-schedule-shared",
				topic: "optimizer sweep",
			}, {});
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project-b",
				loopKey: "loop-schedule-shared",
				topic: "optimizer sweep",
			}, {});

			const result = await router.handle("research.loops.schedule.get", {
				loopKey: "loop-schedule-shared",
			}, {});

			expect(result).toEqual({ schedule: null });
		});

		it("lists queued or expired-lease schedules for daemon dispatch", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-1",
				topic: "optimizer sweep",
			}, {});

			const result = await router.handle("research.loops.dispatchable", {
				projectPath: "/repo/project",
				limit: 10,
			}, {});

			expect(listResearchLoopSchedules).toHaveBeenCalledWith({
				projectPath: "/repo/project",
				runnableOnly: true,
				limit: 10,
			});
			expect(result).toEqual({
				schedules: [expect.objectContaining({ loopKey: "loop-dispatch-1", status: "queued" })],
			});
		});

		it("claims exactly one runnable schedule for resident daemon dispatch", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-next-1",
				topic: "optimizer sweep",
				workflowContext: { researchTopic: "optimizer sweep" },
			}, {});

			const result = await router.handle("research.loops.dispatch.next", {
				projectPath: "/repo/project",
				leaseOwner: "daemon:research-worker:test",
				leaseTtlMs: 30_000,
			}, {});

			expect(claimResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-next-1",
				leaseOwner: "daemon:research-worker:test",
				phase: "resident-dispatch",
			}));
			expect(result).toEqual({
				dispatch: expect.objectContaining({
					schedule: expect.objectContaining({
						loopKey: "loop-dispatch-next-1",
						projectPath: "/repo/project",
						leaseOwner: "daemon:research-worker:test",
					}),
				}),
			});
		});

		it("preserves the durable workflow envelope when dispatch retry requeues a leased loop", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-retry-preserve",
				topic: "optimizer sweep",
				hypothesis: "adamw beats cosine",
				sessionId: "sess-1",
				parentSessionId: "parent-1",
				sessionLineageKey: "lineage-1",
				sabhaId: "sabha-1",
				workflowId: "autoresearch-overnight",
				currentRound: 2,
				totalRounds: 6,
				attemptNumber: 1,
				objectives: [{ id: "metric-improvement", weight: 1.4 }],
				stopConditions: [{ id: "budget-exhausted", kind: "budget-exhausted" }],
				updateBudgets: { nidra: { maxResearchProjectsPerCycle: 3 } },
				workflowContext: {
					researchTopic: "optimizer sweep",
					researchBudgetMs: 300_000,
				},
			}, {});

			const key = scheduleKey("/repo/project", "loop-dispatch-retry-preserve");
			const existing = researchLoopSchedules.get(key);
			researchLoopSchedules.set(key, {
				...existing,
				status: "leased",
				leaseOwner: "daemon:research-worker:test",
				leaseExpiresAt: Date.now() + 30_000,
			});

			await requeueDurableResearchLoopDispatch({
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-retry-preserve",
				leaseOwner: "daemon:research-worker:test",
				availableAt: 123_456,
				attemptNumber: 2,
				phase: "dispatch-retry",
			});

		expect(researchLoopSchedules.get(key)).toEqual(expect.objectContaining({
			projectPath: "/repo/project",
			loopKey: "loop-dispatch-retry-preserve",
				status: "queued",
				availableAt: 123_456,
				attemptNumber: 2,
				phase: "dispatch-retry",
				workflowId: "autoresearch-overnight",
				sessionId: "sess-1",
				parentSessionId: "parent-1",
				sessionLineageKey: "lineage-1",
				sabhaId: "sabha-1",
				objectives: [{ id: "metric-improvement", weight: 1.4 }],
				stopConditions: [{ id: "budget-exhausted", kind: "budget-exhausted" }],
				updateBudgets: { nidra: { maxResearchProjectsPerCycle: 3 } },
				workflowContext: {
					researchTopic: "optimizer sweep",
					researchBudgetMs: 300_000,
				},
			}));
		});

			it("refuses to overwrite a queued row when another worker still owns the durable lease", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-retry-conflict",
				topic: "optimizer sweep",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
			}, {});

			const key = scheduleKey("/repo/project", "loop-dispatch-retry-conflict");
			const existing = researchLoopSchedules.get(key);
			researchLoopSchedules.set(key, {
				...existing,
				status: "leased",
				leaseOwner: "daemon:research-worker:new",
				leaseExpiresAt: Date.now() + 30_000,
			});

				const retry = await requeueDurableResearchLoopDispatch({
					projectPath: "/repo/project",
					loopKey: "loop-dispatch-retry-conflict",
					leaseOwner: "daemon:research-worker:old",
					availableAt: 456_789,
					attemptNumber: 3,
					phase: "dispatch-retry",
				});

				expect(retry.outcome).toBe("lease-lost");
				expect(researchLoopSchedules.get(key)).toEqual(expect.objectContaining({
					status: "leased",
					leaseOwner: "daemon:research-worker:new",
					leaseExpiresAt: expect.any(Number),
					availableAt: existing?.availableAt,
				}));
			});

			it("refuses to rewind a running row back to dispatch-retry under the same lease", async () => {
				await router.handle("research.loops.enqueue", {
					projectPath: "/repo/project",
					loopKey: "loop-dispatch-retry-phase-advanced",
					topic: "optimizer sweep",
					workflowId: "autoresearch-overnight",
					workflowContext: { researchTopic: "optimizer sweep" },
				}, {});

				const key = scheduleKey("/repo/project", "loop-dispatch-retry-phase-advanced");
				const existing = researchLoopSchedules.get(key);
				researchLoopSchedules.set(key, {
					...existing,
					status: "running",
					phase: "round-2",
					leaseOwner: "daemon:research-worker:test",
					leaseExpiresAt: Date.now() + 30_000,
				});

				const retry = await requeueDurableResearchLoopDispatch({
					projectPath: "/repo/project",
					loopKey: "loop-dispatch-retry-phase-advanced",
					leaseOwner: "daemon:research-worker:test",
					availableAt: 456_789,
					attemptNumber: 3,
					phase: "dispatch-retry",
				});

				expect(retry.outcome).toBe("phase-advanced");
				expect(researchLoopSchedules.get(key)).toEqual(expect.objectContaining({
					status: "running",
					phase: "round-2",
					leaseOwner: "daemon:research-worker:test",
					availableAt: existing?.availableAt,
				}));
			});

			it("returns cancelled instead of requeueing when operator cancellation won before dispatch retry", async () => {
				await router.handle("research.loops.enqueue", {
					projectPath: "/repo/project",
					loopKey: "loop-dispatch-retry-cancelled",
					topic: "optimizer sweep",
					workflowId: "autoresearch-overnight",
					workflowContext: { researchTopic: "optimizer sweep" },
				}, {});

				const key = scheduleKey("/repo/project", "loop-dispatch-retry-cancelled");
				const existing = researchLoopSchedules.get(key);
				researchLoopSchedules.set(key, {
					...existing,
					status: "cancelling",
					cancelRequestedAt: Date.now() - 1_000,
					phase: "resident-dispatch",
					leaseOwner: "daemon:research-worker:test",
					leaseExpiresAt: Date.now() + 30_000,
				});

				const retry = await requeueDurableResearchLoopDispatch({
					projectPath: "/repo/project",
					loopKey: "loop-dispatch-retry-cancelled",
					leaseOwner: "daemon:research-worker:test",
					availableAt: 456_789,
					attemptNumber: 3,
					phase: "dispatch-retry",
				});

				expect(retry.outcome).toBe("cancelled");
				expect(researchLoopSchedules.get(key)).toEqual(expect.objectContaining({
					status: "cancelling",
					cancelRequestedAt: expect.any(Number),
					phase: "resident-dispatch",
					leaseOwner: "daemon:research-worker:test",
				}));
			});

			it("reports durable dispatch completion loss when the worker lease already moved", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-fail-conflict",
				topic: "optimizer sweep",
				workflowId: "autoresearch-overnight",
				workflowContext: { researchTopic: "optimizer sweep" },
			}, {});

			const key = scheduleKey("/repo/project", "loop-dispatch-fail-conflict");
			const existing = researchLoopSchedules.get(key);
			researchLoopSchedules.set(key, {
				...existing,
				status: "leased",
				leaseOwner: "daemon:research-worker:new",
				leaseExpiresAt: Date.now() + 30_000,
			});

			const completed = await failDurableResearchLoopDispatch({
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-fail-conflict",
				leaseOwner: "daemon:research-worker:old",
				stopReason: "dispatch-failed",
			});

			expect(completed).toBe(false);
			expect(researchLoopSchedules.get(key)).toEqual(expect.objectContaining({
				status: "leased",
				leaseOwner: "daemon:research-worker:new",
				stopReason: null,
			}));
		});

			it("reclaims an expired leased schedule for resident daemon dispatch", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-expired-lease",
				topic: "optimizer sweep",
				workflowContext: { researchTopic: "optimizer sweep" },
			}, {});
			const key = scheduleKey("/repo/project", "loop-dispatch-expired-lease");
			const existing = researchLoopSchedules.get(key);
			researchLoopSchedules.set(key, {
				...existing,
				status: "leased",
				leaseOwner: "daemon:research-worker:old",
				leaseExpiresAt: Date.now() - 1_000,
			});

			const result = await router.handle("research.loops.dispatch.next", {
				projectPath: "/repo/project",
				leaseOwner: "daemon:research-worker:new",
				leaseTtlMs: 30_000,
			}, {});

			expect(result).toEqual({
				dispatch: expect.objectContaining({
					schedule: expect.objectContaining({
						loopKey: "loop-dispatch-expired-lease",
						leaseOwner: "daemon:research-worker:new",
					}),
				}),
			});
		});

		it("reclaims an expired cancelling schedule for resident daemon dispatch", async () => {
			await router.handle("research.loops.enqueue", {
				projectPath: "/repo/project",
				loopKey: "loop-dispatch-expired-cancel",
				topic: "optimizer sweep",
				workflowContext: { researchTopic: "optimizer sweep" },
			}, {});
			const key = scheduleKey("/repo/project", "loop-dispatch-expired-cancel");
			const existing = researchLoopSchedules.get(key);
			researchLoopSchedules.set(key, {
				...existing,
				status: "cancelling",
				cancelRequestedAt: Date.now() - 2_000,
				leaseOwner: "daemon:research-worker:old",
				leaseExpiresAt: Date.now() - 1_000,
			});

			const result = await router.handle("research.loops.dispatch.next", {
				projectPath: "/repo/project",
				leaseOwner: "daemon:research-worker:new",
				leaseTtlMs: 30_000,
			}, {});

			expect(result).toEqual({
				dispatch: expect.objectContaining({
					schedule: expect.objectContaining({
						loopKey: "loop-dispatch-expired-cancel",
						status: "cancelling",
						leaseOwner: "daemon:research-worker:new",
					}),
				}),
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
				expect(claimResearchLoopSchedule).toHaveBeenCalledWith(expect.objectContaining({
					projectPath: "/repo/project",
					loopKey: "loop-control-1",
				}));

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
				checkpointOnly: false,
				resumeContext: expect.stringContaining("Durable research resume context:"),
				resumePlan: expect.objectContaining({
					loopKey: "loop-control-1",
				status: "cancelling",
				nextAction: "resume-rounds",
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
					leaseOwner: null,
					leaseExpiresAt: null,
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

			it("rejects completion after another worker reclaimed the durable lease", async () => {
				await router.handle("research.loops.start", {
					loopKey: "loop-lease-mismatch",
					projectPath: "/repo/project",
					topic: "optimizer sweep",
					phase: "run",
					leaseOwner: "worker-a",
				}, {});

				claimResearchLoopSchedule({
					projectPath: "/repo/project",
					loopKey: "loop-lease-mismatch",
					leaseOwner: "worker-b",
					leaseTtlMs: 90_000,
					now: Date.now() + 120_000,
					phase: "resident-dispatch",
				});

				await expect(router.handle("research.loops.complete", {
					loopKey: "loop-lease-mismatch",
					projectPath: "/repo/project",
					leaseOwner: "worker-a",
					stopReason: "max-rounds",
				}, {})).rejects.toThrow("lost its durable worker lease before completion");
			});

			it("rejects ownerless completion when the active durable lease belongs to a different worker", async () => {
				await router.handle("research.loops.start", {
					loopKey: "loop-missing-owner",
					projectPath: "/repo/project",
					topic: "optimizer sweep",
					phase: "run",
					leaseOwner: "worker-a",
				}, {});

				await expect(router.handle("research.loops.complete", {
					loopKey: "loop-missing-owner",
					projectPath: "/repo/project",
					stopReason: "max-rounds",
				}, {})).rejects.toThrow("lost its durable worker lease before completion");
			});

			it("fails closed when a heartbeat arrives for a missing loop", async () => {
			await expect(router.handle("research.loops.heartbeat", {
				loopKey: "loop-missing-1",
				projectPath: "/repo/project",
				phase: "run",
			}, {})).rejects.toThrow("Research loop loop-missing-1 is not active");
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
				checkpointOnly: false,
				resumeContext: expect.stringContaining("Durable research resume context:"),
				resumePlan: expect.objectContaining({
					loopKey: "loop-failed-1",
					status: "failed",
					nextAction: "inspect-failure",
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

	it("keeps live control state isolated across projects that reuse the same loop key", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-shared-1",
			projectPath: "/repo/project-a",
			phase: "run",
			currentRound: 1,
		}, {});
		await router.handle("research.loops.start", {
			loopKey: "loop-shared-1",
			projectPath: "/repo/project-b",
			phase: "run",
			currentRound: 4,
		}, {});

		await router.handle("research.loops.cancel", {
			loopKey: "loop-shared-1",
			projectPath: "/repo/project-a",
			reason: "operator-stop",
		}, {});

		const gotA = await router.handle("research.loops.get", {
			loopKey: "loop-shared-1",
			projectPath: "/repo/project-a",
		}, {});
		const gotB = await router.handle("research.loops.get", {
			loopKey: "loop-shared-1",
			projectPath: "/repo/project-b",
		}, {});
		const active = await router.handle("research.loops.active", {}, {});

		expect(gotA).toEqual(expect.objectContaining({
			state: expect.objectContaining({
				loopKey: "loop-shared-1",
				projectPath: "/repo/project-a",
				status: "cancelling",
				currentRound: 1,
			}),
		}));
		expect(gotB).toEqual(expect.objectContaining({
			state: expect.objectContaining({
				loopKey: "loop-shared-1",
				projectPath: "/repo/project-b",
				status: "running",
				currentRound: 4,
			}),
		}));
		expect(active).toEqual({
			states: expect.arrayContaining([
				expect.objectContaining({
					loopKey: "loop-shared-1",
					projectPath: "/repo/project-a",
					status: "cancelling",
				}),
				expect.objectContaining({
					loopKey: "loop-shared-1",
					projectPath: "/repo/project-b",
					status: "running",
				}),
			]),
		});
	});

	it("fails closed on project-less loop inspection when live loop keys collide across projects", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-shared-inspect",
			projectPath: "/repo/project-a",
			phase: "run",
		}, {});
		await router.handle("research.loops.start", {
			loopKey: "loop-shared-inspect",
			projectPath: "/repo/project-b",
			phase: "run",
		}, {});
		listResearchLoopCheckpoints.mockImplementation(() => [
			{
				id: "checkpoint-shared-inspect",
				projectPath: "/repo/project-c",
				loopKey: "loop-shared-inspect",
				phase: "run",
				status: "active",
				createdAt: 1_000,
				updatedAt: 2_000,
				checkpoint: { version: 1, phase: "run" },
			},
		]);

		await expect(router.handle("research.loops.get", {
			loopKey: "loop-shared-inspect",
		}, {})).rejects.toThrow("requires projectPath for safe inspect");
	});

	it("fails closed on project-less loop resume when live loop keys collide across projects", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-shared-resume",
			projectPath: "/repo/project-a",
			phase: "run",
		}, {});
		await router.handle("research.loops.start", {
			loopKey: "loop-shared-resume",
			projectPath: "/repo/project-b",
			phase: "run",
		}, {});
		listResearchLoopCheckpoints.mockImplementation(() => [
			{
				id: "checkpoint-shared-resume",
				projectPath: "/repo/project-c",
				loopKey: "loop-shared-resume",
				phase: "closure-record",
				status: "active",
				createdAt: 1_000,
				updatedAt: 2_000,
				checkpoint: { version: 1, phase: "closure-record" },
			},
		]);

		await expect(router.handle("research.loops.resume", {
			loopKey: "loop-shared-resume",
			phase: "resume",
		}, {})).rejects.toThrow("requires projectPath for safe resume");
	});

	it("preserves project identity when completion relies on durable state only", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-complete-durable-1",
			projectPath: "/repo/project-a",
			phase: "run",
		}, {});
		clearResearchLoopStates();

		const completed = await router.handle("research.loops.complete", {
			loopKey: "loop-complete-durable-1",
			projectPath: "/repo/project-a",
			stopReason: "max-rounds",
		}, {});

		expect(completed).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-complete-durable-1",
				projectPath: "/repo/project-a",
				status: "completed",
				stopReason: "max-rounds",
			}),
		});
	});

	it("fails closed when durable-only completion omits projectPath for an ambiguous loop key", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-complete-ambiguous",
			projectPath: "/repo/project-a",
			phase: "run",
		}, {});
		await router.handle("research.loops.start", {
			loopKey: "loop-complete-ambiguous",
			projectPath: "/repo/project-b",
			phase: "run",
		}, {});
		clearResearchLoopStates();

		await expect(router.handle("research.loops.complete", {
			loopKey: "loop-complete-ambiguous",
			stopReason: "max-rounds",
		}, {})).rejects.toThrow("requires projectPath for safe completion");
	});

	it("rejects resuming a loop whose heartbeat is still fresh", async () => {
		const now = vi.spyOn(Date, "now");
		now.mockReturnValueOnce(1_000);
		await router.handle("research.loops.start", {
			loopKey: "loop-resume-guard-1",
			projectPath: "/repo/project",
			phase: "run",
		}, {});
		now.mockReturnValueOnce(2_000);
		await expect(router.handle("research.loops.resume", {
			loopKey: "loop-resume-guard-1",
			projectPath: "/repo/project",
			phase: "resume",
		}, {})).rejects.toThrow("still active");
		now.mockRestore();
	});

		it("allows resuming a loop after its heartbeat is stale", async () => {
			const now = vi.spyOn(Date, "now");
			now.mockReturnValueOnce(1_000);
		await router.handle("research.loops.start", {
			loopKey: "loop-resume-stale-1",
			projectPath: "/repo/project",
			phase: "run",
		}, {});
		now.mockReturnValueOnce(8_000);
		const resumed = await router.handle("research.loops.resume", {
			loopKey: "loop-resume-stale-1",
			projectPath: "/repo/project",
			phase: "resume",
		}, {});
		expect(resumed).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-resume-stale-1",
				status: "running",
				phase: "resume",
			}),
			});
			now.mockRestore();
		});

		it("surfaces the durable worker lease in live loop control state", async () => {
			await router.handle("research.loops.start", {
				loopKey: "loop-lease-surface",
				projectPath: "/repo/project",
				phase: "run",
				leaseOwner: "worker-a",
				leaseTtlMs: 30_000,
			}, {});

			const got = await router.handle("research.loops.get", {
				loopKey: "loop-lease-surface",
				projectPath: "/repo/project",
			}, {});

			expect(got).toEqual({
				state: expect.objectContaining({
					loopKey: "loop-lease-surface",
					projectPath: "/repo/project",
					status: "running",
					leaseOwner: "worker-a",
					leaseExpiresAt: expect.any(Number),
				}),
				checkpointOnly: false,
				resumeContext: expect.stringContaining("Durable research resume context:"),
				resumePlan: expect.objectContaining({
					loopKey: "loop-lease-surface",
					status: "running",
				}),
			});
		});

		it("keeps stale live state non-resumable while another durable worker lease is still active", async () => {
			const now = vi.spyOn(Date, "now");
			now.mockReturnValueOnce(1_000);
		await router.handle("research.loops.start", {
			loopKey: "loop-resume-durable-lease",
			projectPath: "/repo/project",
			phase: "run",
			leaseOwner: "worker-a",
		}, {});
		now.mockReturnValueOnce(7_001);
		const active = await router.handle("research.loops.active", {
			projectPath: "/repo/project",
		}, {});

		expect(active).toEqual({
			states: expect.arrayContaining([
					expect.objectContaining({
						loopKey: "loop-resume-durable-lease",
						projectPath: "/repo/project",
						status: "running",
						leaseOwner: "worker-a",
						leaseExpiresAt: expect.any(Number),
						resumable: false,
					}),
				]),
		});
		now.mockRestore();
	});

	it("rejects resume while another durable worker lease is still active", async () => {
		const now = vi.spyOn(Date, "now");
		now.mockReturnValueOnce(1_000);
		await router.handle("research.loops.start", {
			loopKey: "loop-resume-active-lease",
			projectPath: "/repo/project",
			phase: "run",
			leaseOwner: "worker-a",
		}, {});
		now.mockReturnValueOnce(7_001);
		await expect(router.handle("research.loops.resume", {
			loopKey: "loop-resume-active-lease",
			projectPath: "/repo/project",
			phase: "resume",
			leaseOwner: "worker-b",
		}, {})).rejects.toThrow("still active");
		now.mockRestore();
	});

	it("rejects resuming a terminal loop key", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-resume-terminal",
			projectPath: "/repo/project",
			phase: "run",
		}, {});
		await router.handle("research.loops.complete", {
			loopKey: "loop-resume-terminal",
			stopReason: "max-rounds",
		}, {});

		await expect(router.handle("research.loops.resume", {
			loopKey: "loop-resume-terminal",
			projectPath: "/repo/project",
			phase: "resume",
		}, {})).rejects.toThrow("cannot be resumed");
	});

	it("rejects reusing a loop key that already has durable checkpoint state", async () => {
		clearResearchLoopStates();
		getResearchLoopCheckpoint.mockImplementation(() => ({
			id: "checkpoint-reuse-1",
			projectPath: "/repo/project",
			loopKey: "loop-durable-reuse",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			phase: "closure-record",
			status: "active",
			currentRound: 2,
			nextRoundNumber: 3,
			totalRounds: 6,
			checkpoint: {
				version: 1,
				phase: "closure-record",
				progress: {
					bestMetric: 0.991,
					bestRoundNumber: 2,
					noImprovementStreak: 1,
				},
			},
			createdAt: 1_000,
			updatedAt: 2_000,
		}));

		await expect(router.handle("research.loops.start", {
			loopKey: "loop-durable-reuse",
			projectPath: "/repo/project",
			phase: "start",
		}, {})).rejects.toThrow("durable checkpoint state; use resume");
	});

		it("lists active loop control state with resumable takeover hints", async () => {
			const now = vi.spyOn(Date, "now");
		now.mockReturnValueOnce(1_000);
		await router.handle("research.loops.start", {
			loopKey: "loop-active-list",
			projectPath: "/repo/project",
			phase: "run",
		}, {});
		now.mockReturnValueOnce(8_000);
		await router.handle("research.loops.heartbeat", {
			loopKey: "loop-active-list",
			projectPath: "/repo/project",
			phase: "run",
		}, {});
		now.mockReturnValueOnce(8_001);
		const active = await router.handle("research.loops.active", {
			projectPath: "/repo/project",
		}, {});

		expect(active).toEqual({
			states: expect.arrayContaining([
				expect.objectContaining({
					loopKey: "loop-active-list",
					projectPath: "/repo/project",
					status: "running",
					resumable: false,
					resumeContext: expect.stringContaining("Durable research resume context:"),
				}),
			]),
			});
			now.mockRestore();
		});

		it("surfaces checkpoint-only loop state when daemon control state is missing", async () => {
			listResearchLoopCheckpoints.mockImplementation(() => [
				{
					id: "checkpoint-only-1",
					projectPath: "/repo/project",
					loopKey: "loop-checkpoint-only",
					topic: "optimizer sweep",
					hypothesis: "adamw beats cosine",
					phase: "closure-record",
					status: "active",
					currentRound: 2,
					nextRoundNumber: 3,
					totalRounds: 6,
					createdAt: 1_000,
					updatedAt: 2_000,
					checkpoint: {
						version: 1,
						phase: "closure-record",
						progress: {
							bestMetric: 0.991,
							bestRoundNumber: 2,
							noImprovementStreak: 1,
						},
					},
				},
			]);
			getResearchLoopCheckpoint.mockImplementation(() => null);

			const got = await router.handle("research.loops.get", {
				loopKey: "loop-checkpoint-only",
			}, {});

			expect(got).toEqual({
				state: expect.objectContaining({
					loopKey: "loop-checkpoint-only",
					projectPath: "/repo/project",
					status: "failed",
					stopReason: "control-plane-lost",
					phase: "closure-record",
					currentRound: 2,
				}),
				checkpointOnly: true,
				resumeContext: expect.stringContaining("Durable research resume context:"),
				resumePlan: expect.objectContaining({
					loopKey: "loop-checkpoint-only",
					status: "failed",
					nextAction: "resume-rounds",
				}),
			});
		});

		it("includes checkpoint-only loops in the active listing", async () => {
			listResearchLoopCheckpoints.mockImplementation(() => [
				{
					id: "checkpoint-only-2",
					projectPath: "/repo/project",
					loopKey: "loop-checkpoint-only-active",
					topic: "optimizer sweep",
					hypothesis: "adamw beats cosine",
					phase: "run",
					status: "active",
					currentRound: 1,
					nextRoundNumber: 2,
					totalRounds: 6,
					createdAt: 1_000,
					updatedAt: 2_000,
					checkpoint: {
						version: 1,
						phase: "run",
						progress: {
							bestMetric: 0.991,
							bestRoundNumber: 1,
							noImprovementStreak: 0,
						},
					},
				},
			]);
			getResearchLoopCheckpoint.mockImplementation(() => null);

			const active = await router.handle("research.loops.active", {
				projectPath: "/repo/project",
			}, {});

			expect(active).toEqual({
				states: expect.arrayContaining([
					expect.objectContaining({
						loopKey: "loop-checkpoint-only-active",
						projectPath: "/repo/project",
						checkpointOnly: true,
						resumable: true,
						status: "failed",
						stopReason: "control-plane-lost",
					}),
				]),
			});
		});

		it("keeps checkpoint-only state visible when another project reuses the same loop key", async () => {
			await router.handle("research.loops.start", {
				loopKey: "loop-checkpoint-shared",
				projectPath: "/repo/project-a",
				phase: "run",
			}, {});
			listResearchLoopCheckpoints.mockImplementation(() => [
				{
					id: "checkpoint-shared-1",
					projectPath: "/repo/project-b",
					loopKey: "loop-checkpoint-shared",
					topic: "optimizer sweep",
					hypothesis: "adamw beats cosine",
					phase: "run",
					status: "active",
					currentRound: 2,
					nextRoundNumber: 3,
					totalRounds: 6,
					createdAt: 1_000,
					updatedAt: 2_000,
					checkpoint: {
						version: 1,
						phase: "run",
						progress: {
							bestMetric: 0.991,
							bestRoundNumber: 2,
							noImprovementStreak: 0,
						},
					},
				},
			]);
			getResearchLoopCheckpoint.mockImplementation((projectPath: string, loopKey: string) => {
				if (projectPath === "/repo/project-a" && loopKey === "loop-checkpoint-shared") {
					return null;
				}
				if (projectPath === "/repo/project-b" && loopKey === "loop-checkpoint-shared") {
					return {
						id: "checkpoint-shared-1",
						projectPath,
						loopKey,
						phase: "run",
						status: "active",
						currentRound: 2,
						nextRoundNumber: 3,
						totalRounds: 6,
						createdAt: 1_000,
						updatedAt: 2_000,
						checkpoint: {
							version: 1,
							phase: "run",
							progress: {
								bestMetric: 0.991,
								bestRoundNumber: 2,
								noImprovementStreak: 0,
							},
						},
					};
				}
				return null;
			});

			const active = await router.handle("research.loops.active", {}, {});

			expect(active).toEqual({
				states: expect.arrayContaining([
					expect.objectContaining({
						loopKey: "loop-checkpoint-shared",
						projectPath: "/repo/project-a",
						checkpointOnly: false,
						status: "running",
					}),
					expect.objectContaining({
						loopKey: "loop-checkpoint-shared",
						projectPath: "/repo/project-b",
						checkpointOnly: true,
						status: "failed",
					}),
				]),
			});
		});

		it("preserves complete-pending checkpoint-only loops as resumable completion work", async () => {
			listResearchLoopCheckpoints.mockImplementation(() => [
				{
					id: "checkpoint-complete-pending-1",
					projectPath: "/repo/project",
					loopKey: "loop-complete-pending",
					topic: "optimizer sweep",
					hypothesis: "adamw beats cosine",
					phase: "complete-pending",
					status: "active",
					currentRound: 4,
					nextRoundNumber: 5,
					totalRounds: 6,
					createdAt: 1_000,
					updatedAt: 2_000,
					checkpoint: {
						version: 1,
						phase: "complete-pending",
						terminalSummary: {
							loopKey: "loop-complete-pending",
							stopReason: "max-rounds",
						},
					},
				},
			]);
			getResearchLoopCheckpoint.mockImplementation(() => null);

			const got = await router.handle("research.loops.get", {
				loopKey: "loop-complete-pending",
			}, {});

		expect(got).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-complete-pending",
					projectPath: "/repo/project",
					status: "running",
					stopReason: "max-rounds",
					phase: "complete-pending",
					finishedAt: null,
				}),
				checkpointOnly: true,
				resumeContext: expect.stringContaining("Durable research resume context:"),
				resumePlan: expect.objectContaining({
					loopKey: "loop-complete-pending",
					status: "running",
					phase: "complete-pending",
					nextAction: "complete-pending",
				}),
			});
		});

		it("allows immediate resume of checkpoint-only complete-pending work", async () => {
			clearResearchLoopStates();
			getResearchLoopCheckpoint.mockImplementation(() => ({
				id: "checkpoint-complete-pending-resume",
				projectPath: "/repo/project",
				loopKey: "loop-complete-pending-resume",
				topic: "optimizer sweep",
				hypothesis: "adamw beats cosine",
				phase: "complete-pending",
				status: "active",
				currentRound: 4,
				nextRoundNumber: 5,
				totalRounds: 6,
				createdAt: 1_000,
				updatedAt: 2_000,
				checkpoint: {
					version: 1,
					phase: "complete-pending",
					terminalSummary: {
						loopKey: "loop-complete-pending-resume",
						stopReason: "max-rounds",
					},
				},
			}));

			const resumed = await router.handle("research.loops.resume", {
				loopKey: "loop-complete-pending-resume",
				projectPath: "/repo/project",
				phase: "attach",
				leaseOwner: "worker-attach",
			}, {});

			expect(resumed).toEqual({
				state: expect.objectContaining({
					loopKey: "loop-complete-pending-resume",
					projectPath: "/repo/project",
					status: "running",
					phase: "attach",
					stopReason: null,
					leaseOwner: "worker-attach",
				}),
			});
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

	it("preserves durable cancellation truth when completion happens after live state is lost", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-cancel-durable-only",
			projectPath: "/repo/project",
			totalRounds: 5,
			currentRound: 4,
			attemptNumber: 2,
			phase: "finalize",
			leaseOwner: "worker-a",
		}, {});
		await router.handle("research.loops.cancel", {
			loopKey: "loop-cancel-durable-only",
			reason: "operator-stop",
			requestedBy: "tester",
		}, {});
		clearResearchLoopStates();

		const completed = await router.handle("research.loops.complete", {
			loopKey: "loop-cancel-durable-only",
			projectPath: "/repo/project",
			leaseOwner: "worker-a",
			stopReason: "max-rounds",
		}, {});

		expect(completed).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-cancel-durable-only",
				projectPath: "/repo/project",
				status: "cancelled",
				stopReason: "cancelled",
				cancelReason: "operator-stop",
				requestedBy: "tester",
				cancelRequestedAt: expect.any(Number),
				currentRound: 4,
				attemptNumber: 2,
			}),
		});
	});

	it("preserves failure stop reasons when completion follows a cancel request", async () => {
		await router.handle("research.loops.start", {
			loopKey: "loop-cancel-failure",
			projectPath: "/repo/project",
			totalRounds: 5,
			currentRound: 2,
			attemptNumber: 1,
			phase: "finalize",
		}, {});
		await router.handle("research.loops.cancel", {
			loopKey: "loop-cancel-failure",
			reason: "operator-stop",
			requestedBy: "tester",
		}, {});

		const completed = await router.handle("research.loops.complete", {
			loopKey: "loop-cancel-failure",
			stopReason: "closure-failed",
		}, {});

		expect(completed).toEqual({
			state: expect.objectContaining({
				loopKey: "loop-cancel-failure",
				status: "failed",
				stopReason: "closure-failed",
				cancelReason: "operator-stop",
				cancelRequestedAt: expect.any(Number),
			}),
		});
	});
		});
