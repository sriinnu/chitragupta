import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consolidateResearchLoopSummariesForDate = vi.fn(async () => ({
	processed: 2,
	projects: 1,
	projectPaths: ["/repo/project"],
}));
const consolidateResearchExperimentsForDate = vi.fn(async () => ({
	processed: 3,
	projects: 2,
	projectPaths: ["/repo/project", "/repo/other"],
}));
const consolidateResearchRefinementDigestsForDate = vi.fn(async () => ({
	processed: 2,
	projects: 2,
	projectPaths: ["/repo/project", "/repo/other"],
	scopes: [
		{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
		{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
	],
}));
const repairSelectiveReembeddingForDate = vi.fn(async () => ({
	candidates: 3,
	reembedded: 2,
	remoteSynced: 0,
	qualityDeferred: 0,
	scopes: [
		{ level: "daily", period: "2026-03-10", candidates: 2, reembedded: 1, remoteSynced: 0, qualityDeferred: 0 },
		{ level: "monthly", period: "2026-03", candidates: 1, reembedded: 1, remoteSynced: 0, qualityDeferred: 0 },
		{ level: "yearly", period: "2026", candidates: 0, reembedded: 0, remoteSynced: 0, qualityDeferred: 0 },
	],
}));
const repairSelectiveReembeddingForResearchScopes = vi.fn(async () => ({
	label: "2026-03-10",
	candidates: 2,
	reembedded: 1,
	remoteSynced: 1,
	qualityDeferred: 0,
	scopes: [
		{
			projectPath: "/repo/project",
			dailyDates: ["2026-03-10"],
			candidates: 2,
			reembedded: 1,
			remoteSynced: 1,
			qualityDeferred: 0,
		},
	],
}));
const drainQueuedResearchRefinementScopes = vi.fn(async () => ({
	drained: 1,
	repaired: 1,
	deferred: 0,
	remainingDue: 0,
	remoteSynced: 1,
	qualityDeferred: 0,
}));
const refreshGlobalSemanticEpochDrift = vi.fn(async () => ({
	currentEpoch: "provider:model:1536:provider:1",
	previousEpoch: null,
	reason: "bootstrap",
	completed: true,
	freshnessCompleted: true,
	refreshed: true,
	qualityDebtCount: 0,
	repair: {
		plan: { scanned: 0, candidateCount: 0 },
		reembedded: 0,
		remoteSynced: 0,
		qualityDeferred: 0,
	},
}));
const syncRemoteSemanticMirror = vi.fn(async (options?: { levels?: string[] }) => ({
	status: { enabled: true },
	synced: options?.levels?.[0] === "daily" ? 4 : options?.levels?.[0] === "monthly" ? 2 : 1,
}));

vi.mock("../src/chitragupta-daemon-research.js", () => ({
	consolidateResearchLoopSummariesForDate,
	consolidateResearchExperimentsForDate,
	consolidateResearchRefinementDigestsForDate,
}));

vi.mock("../src/chitragupta-daemon-semantic.js", () => ({
	repairSelectiveReembeddingForDate,
	repairSelectiveReembeddingForResearchScopes,
	refreshGlobalSemanticEpochDrift,
}));

vi.mock("../src/chitragupta-daemon-semantic-queue.js", () => ({
	drainQueuedResearchRefinementScopes,
}));

const appendMemory = vi.fn(async () => undefined);
const clearResearchRefinementBudget = vi.fn(() => undefined);
const countQueuedResearchRefinementScopes = vi.fn(() => 0);
const readActiveResearchRefinementBudget = vi.fn(() => null);
const upsertResearchRefinementQueue = vi.fn(() => 0);
const upsertResearchRefinementBudget = vi.fn(() => undefined);
vi.mock("@chitragupta/smriti", () => ({
	syncRemoteSemanticMirror,
	appendMemory,
	clearResearchRefinementBudget,
	countQueuedResearchRefinementScopes,
	readActiveResearchRefinementBudget,
	upsertResearchRefinementQueue,
	upsertResearchRefinementBudget,
}));

describe("chitragupta-daemon daily postprocess helper", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("runs research summary consolidation, semantic repair, and remote sync in order", async () => {
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");
		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(consolidateResearchLoopSummariesForDate).toHaveBeenCalledWith("2026-03-10");
		expect(consolidateResearchExperimentsForDate).toHaveBeenCalledWith("2026-03-10");
		expect(consolidateResearchRefinementDigestsForDate).toHaveBeenCalledWith("2026-03-10");
		expect(upsertResearchRefinementBudget).toHaveBeenCalledWith({
			refinement: {
				dailyCandidateLimit: 12,
				projectCandidateLimit: 5,
				dailyMinMdlScore: 0.45,
				projectMinMdlScore: 0.51,
				dailyMinPriorityScore: 0.9,
				projectMinPriorityScore: 1.1,
				dailyMinSourceSessionCount: 1,
				projectMinSourceSessionCount: 1,
			},
			nidra: {
				maxResearchProjectsPerCycle: 2,
				maxSemanticPressure: 8,
			},
			source: "nidra.postprocess",
		});
		expect(repairSelectiveReembeddingForDate).toHaveBeenCalledWith("2026-03-10", {
			researchSignalCount: 7.5,
		});
		expect(drainQueuedResearchRefinementScopes).toHaveBeenCalledWith({
			label: "2026-03-10",
			excludeScopes: [
				{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
				{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
			],
			limit: 0,
		});
		expect(syncRemoteSemanticMirror).toHaveBeenNthCalledWith(1, {
			levels: ["daily"],
			dates: ["2026-03-10"],
		});
		expect(syncRemoteSemanticMirror).toHaveBeenNthCalledWith(2, {
			levels: ["monthly"],
			periods: ["2026-03"],
		});
		expect(syncRemoteSemanticMirror).toHaveBeenNthCalledWith(3, {
			levels: ["yearly"],
			periods: ["2026"],
		});
		expect(clearResearchRefinementBudget).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			governor: {
				phases: ["date-repair", "research-repair", "queued-repair", "epoch-refresh"],
				effectiveBudget: {
					refinement: {
						dailyCandidateLimit: 12,
						projectCandidateLimit: 5,
						dailyMinMdlScore: 0.45,
						projectMinMdlScore: 0.51,
						dailyMinPriorityScore: 0.9,
						projectMinPriorityScore: 1.1,
						dailyMinSourceSessionCount: 1,
						projectMinSourceSessionCount: 1,
					},
					nidra: {
						maxResearchProjectsPerCycle: 2,
						maxSemanticPressure: 8,
					},
				},
				researchSignalCount: 7.5,
				queuedDrainLimit: 0,
				remoteHoldReasons: [],
			},
			research: {
				loops: { processed: 2, projects: 1, projectPaths: ["/repo/project"] },
				experiments: { processed: 3, projects: 2, projectPaths: ["/repo/project", "/repo/other"] },
					refinements: {
						processed: 2,
						projects: 2,
						projectPaths: ["/repo/project", "/repo/other"],
						scopes: [
							{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
							{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
						],
						deferredScopes: [],
					},
				processed: 7,
				projects: 2,
				projectPaths: ["/repo/project", "/repo/other"],
			},
			semantic: {
				candidates: 3,
				reembedded: 2,
				remoteSynced: 0,
				qualityDeferred: 0,
				scopes: [
					{ level: "daily", period: "2026-03-10", candidates: 2, reembedded: 1, remoteSynced: 0, qualityDeferred: 0 },
					{ level: "monthly", period: "2026-03", candidates: 1, reembedded: 1, remoteSynced: 0, qualityDeferred: 0 },
					{ level: "yearly", period: "2026", candidates: 0, reembedded: 0, remoteSynced: 0, qualityDeferred: 0 },
				],
				researchScoped: {
					label: "2026-03-10",
					candidates: 2,
					reembedded: 1,
					remoteSynced: 1,
					qualityDeferred: 0,
					scopes: [
						{
							projectPath: "/repo/project",
							dailyDates: ["2026-03-10"],
							candidates: 2,
							reembedded: 1,
							remoteSynced: 1,
							qualityDeferred: 0,
						},
					],
				},
						queuedResearch: {
							drained: 1,
							repaired: 1,
							deferred: 0,
							remainingDue: 0,
							carriedForward: 0,
							remoteSynced: 1,
							qualityDeferred: 0,
					},
				epochRefresh: {
					currentEpoch: "provider:model:1536:provider:1",
					previousEpoch: null,
					reason: "bootstrap",
					completed: true,
					freshnessCompleted: true,
					refreshed: true,
					qualityDebtCount: 0,
					repair: {
						plan: { scanned: 0, candidateCount: 0 },
						reembedded: 0,
						remoteSynced: 0,
						qualityDeferred: 0,
					},
				},
			},
				remote: {
					enabled: true,
					synced: 9,
					skippedDueToOutstandingRepair: false,
					sources: {
					dailyRepair: 0,
					researchRepair: 1,
					queuedResearch: 1,
					epochRefresh: 0,
					postprocessSync: 7,
				},
			},
		});
	});

	it("replays deferred queue work without widening the shared repair budget when only queued backlog remains", async () => {
		consolidateResearchLoopSummariesForDate.mockResolvedValueOnce({
			processed: 0,
			projects: 0,
			projectPaths: [],
		});
		consolidateResearchExperimentsForDate.mockResolvedValueOnce({
			processed: 0,
			projects: 0,
			projectPaths: [],
		});
		consolidateResearchRefinementDigestsForDate.mockResolvedValueOnce({
			processed: 0,
			projects: 0,
			projectPaths: [],
			scopes: [],
		});
		countQueuedResearchRefinementScopes.mockReturnValueOnce(3);

		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");
		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(upsertResearchRefinementBudget).not.toHaveBeenCalled();
		expect(drainQueuedResearchRefinementScopes).toHaveBeenCalledWith({
			label: "2026-03-10",
			excludeScopes: [],
			limit: 3,
		});
		expect(result.governor.effectiveBudget).toBeNull();
		expect(result.governor.queuedDrainLimit).toBe(3);
	});

	it("skips remote sync when semantic repair still has deferred-quality artifacts", async () => {
		repairSelectiveReembeddingForDate.mockResolvedValueOnce({
			candidates: 2,
			reembedded: 1,
			remoteSynced: 0,
			qualityDeferred: 1,
			scopes: [
				{ level: "daily", period: "2026-03-10", candidates: 2, reembedded: 1, remoteSynced: 0, qualityDeferred: 1 },
			],
		});
		repairSelectiveReembeddingForResearchScopes.mockResolvedValueOnce({
			label: "2026-03-10",
			candidates: 0,
			reembedded: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
			scopes: [],
		});
		drainQueuedResearchRefinementScopes.mockResolvedValueOnce({
			drained: 1,
			repaired: 0,
			deferred: 1,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 1,
		});
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(syncRemoteSemanticMirror).not.toHaveBeenCalled();
		expect(clearResearchRefinementBudget).not.toHaveBeenCalled();
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "global" },
			expect.stringContaining("scope: research-queue"),
			{ dedupe: true },
		);
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "global" },
			expect.stringContaining("queuedQualityDebt: 1"),
			{ dedupe: true },
		);
		expect(result.governor.remoteHoldReasons).toEqual([
			"daily-quality-debt",
			"queued-deferred",
			"queued-quality-debt",
		]);
		expect(result.remote).toEqual({
			enabled: false,
			synced: 0,
			skippedDueToOutstandingRepair: true,
			sources: {
				dailyRepair: 0,
				researchRepair: 0,
				queuedResearch: 0,
				epochRefresh: 0,
				postprocessSync: 0,
			},
		});
	});

	it("queues research-scoped quality debt for durable replay", async () => {
		upsertResearchRefinementQueue.mockReturnValueOnce(1);
		repairSelectiveReembeddingForResearchScopes.mockResolvedValueOnce({
			label: "2026-03-10",
			candidates: 2,
			reembedded: 1,
			remoteSynced: 0,
			qualityDeferred: 1,
			scopes: [
				{
					projectPath: "/repo/project",
					dailyDates: ["2026-03-10"],
					candidates: 2,
					reembedded: 1,
					remoteSynced: 0,
					qualityDeferred: 1,
				},
			],
		});
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(upsertResearchRefinementQueue).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					label: "2026-03-10",
					projectPath: "/repo/project",
					sessionIds: ["sess-1"],
				}),
			]),
			expect.objectContaining({
				lastError: "quality-deferred:nidra-postprocess:1",
			}),
		);
		expect(result.semantic.queuedResearch.carriedForward).toBe(1);
	});

	it("holds remote sync when queued due backlog remains even though this cycle could not drain it", async () => {
		drainQueuedResearchRefinementScopes.mockResolvedValueOnce({
			drained: 0,
			repaired: 0,
			deferred: 0,
			remainingDue: 2,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(syncRemoteSemanticMirror).not.toHaveBeenCalled();
		expect(result.governor.remoteHoldReasons).toEqual(["queued-deferred"]);
		expect(result.semantic.queuedResearch.remainingDue).toBe(2);
		expect(result.remote.skippedDueToOutstandingRepair).toBe(true);
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "global" },
			expect.stringContaining("queuedRemainingDue: 2"),
			{ dedupe: true },
		);
	});

	it("keeps remote sync blocked when the shared queue cap is exhausted before queue drain can inspect due rows", async () => {
		countQueuedResearchRefinementScopes
			.mockReturnValueOnce(3)
			.mockReturnValueOnce(3);
		readActiveResearchRefinementBudget.mockReturnValueOnce({
			refinement: {},
			nidra: {
				maxResearchProjectsPerCycle: 2,
				maxSemanticPressure: 8,
			},
			source: "test",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		});
		drainQueuedResearchRefinementScopes.mockResolvedValueOnce({
			drained: 0,
			repaired: 0,
			deferred: 0,
			remainingDue: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		});

		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");
		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(drainQueuedResearchRefinementScopes).toHaveBeenCalledWith({
			label: "2026-03-10",
			excludeScopes: [
				{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
				{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
			],
			limit: 0,
		});
		expect(syncRemoteSemanticMirror).not.toHaveBeenCalled();
		expect(result.governor.queuedDrainLimit).toBe(0);
		expect(result.governor.remoteHoldReasons).toEqual(["queued-deferred"]);
		expect(result.semantic.queuedResearch.remainingDue).toBe(3);
		expect(result.remote.skippedDueToOutstandingRepair).toBe(true);
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "global" },
			expect.stringContaining("queuedRemainingDue: 3"),
			{ dedupe: true },
		);
	});

	it("persists a global semantic debt note when only epoch quality debt remains", async () => {
		repairSelectiveReembeddingForResearchScopes.mockResolvedValueOnce({
			label: "2026-03-10",
			candidates: 0,
			reembedded: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
			scopes: [],
		});
		refreshGlobalSemanticEpochDrift.mockResolvedValueOnce({
			currentEpoch: "provider:model:1536:provider:2",
			previousEpoch: "provider:model:1536:provider:1",
			reason: "quality-debt",
			completed: false,
			freshnessCompleted: true,
			refreshed: false,
			qualityDebtCount: 3,
			repair: {
				plan: { scanned: 8, candidateCount: 3 },
				reembedded: 0,
				remoteSynced: 0,
				qualityDeferred: 3,
			},
		});
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		await runDailyDaemonPostprocess("2026-03-10");

		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "global" },
			expect.stringContaining("globalEpochDebt: 3"),
			{ dedupe: true },
		);
	});

	it("holds remote sync until epoch refresh is fully complete and fresh", async () => {
		refreshGlobalSemanticEpochDrift.mockResolvedValueOnce({
			currentEpoch: "provider:model:1536:provider:2",
			previousEpoch: "provider:model:1536:provider:1",
			reason: "epoch-changed",
			completed: false,
			freshnessCompleted: false,
			refreshed: false,
			qualityDebtCount: 0,
			repair: {
				plan: { scanned: 8, candidateCount: 0 },
				reembedded: 0,
				remoteSynced: 0,
				qualityDeferred: 0,
			},
		});
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(syncRemoteSemanticMirror).not.toHaveBeenCalled();
		expect(clearResearchRefinementBudget).not.toHaveBeenCalled();
		expect(result.governor.remoteHoldReasons).toEqual([
			"epoch-incomplete",
			"epoch-freshness-incomplete",
		]);
		expect(result.remote.skippedDueToOutstandingRepair).toBe(true);
	});

	it("excludes already-repaired research scopes from queued refinement drain", async () => {
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		await runDailyDaemonPostprocess("2026-03-10");

		expect(drainQueuedResearchRefinementScopes).toHaveBeenCalledWith({
			label: "2026-03-10",
			excludeScopes: [
				{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
				{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
			],
			limit: 0,
		});
	});

	it("preserves the wider derived repair envelope instead of tightening it back to the active Nidra budget", async () => {
		upsertResearchRefinementQueue.mockReturnValueOnce(1);
		readActiveResearchRefinementBudget.mockReturnValueOnce({
			refinement: {},
			nidra: {
				maxResearchProjectsPerCycle: 1,
				maxSemanticPressure: 3,
			},
			source: "test",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		});
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");
		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(repairSelectiveReembeddingForDate).toHaveBeenCalledWith("2026-03-10", {
			researchSignalCount: 7.5,
		});
		expect(drainQueuedResearchRefinementScopes).toHaveBeenCalledWith({
			label: "2026-03-10",
			excludeScopes: [
				{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
				{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
			],
			limit: 0,
		});
		expect(upsertResearchRefinementQueue).not.toHaveBeenCalled();
		expect(syncRemoteSemanticMirror).toHaveBeenCalled();
		expect(result.governor.queuedDrainLimit).toBe(0);
		expect(result.governor.remoteHoldReasons).toEqual([]);
		expect(result.semantic.queuedResearch.carriedForward).toBe(0);
		expect(result.remote.skippedDueToOutstandingRepair).toBe(false);
		expect(result.research.refinements.projects).toBe(2);
		expect(result.research.refinements.projectPaths).toEqual(["/repo/project", "/repo/other"]);
		expect(result.research.refinements.scopes).toEqual([
			{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
			{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
		]);
		expect(result.research.refinements.deferredScopes).toEqual([]);
	});

	it("keeps higher-pressure research scopes first in the selected refinement order", async () => {
		consolidateResearchRefinementDigestsForDate.mockResolvedValueOnce({
			processed: 2,
			projects: 2,
			projectPaths: ["/repo/project", "/repo/other"],
			scopes: [
				{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
				{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
			],
		});
		readActiveResearchRefinementBudget.mockReturnValueOnce({
			refinement: {},
			nidra: {
				maxResearchProjectsPerCycle: 1,
				maxSemanticPressure: 8,
			},
			source: "test",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		});
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(result.research.refinements.scopes).toEqual([
			{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
			{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
		]);
	});

	it("keeps deferred refinement projects visible even when the digest summary project list is incomplete", async () => {
		consolidateResearchRefinementDigestsForDate.mockResolvedValueOnce({
			processed: 2,
			projects: 1,
			projectPaths: ["/repo/project"],
			scopes: [
				{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
				{ projectPath: "/repo/other", sessionIds: ["sess-2"], sessionLineageKeys: [], priorityScore: 1.1 },
			],
		});
		readActiveResearchRefinementBudget.mockReturnValueOnce({
			refinement: {},
			nidra: {
				maxResearchProjectsPerCycle: 1,
				maxSemanticPressure: 8,
			},
			source: "test",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		});
		upsertResearchRefinementQueue.mockReturnValueOnce(1);
		const { runDailyDaemonPostprocess } = await import("../src/chitragupta-daemon-postprocess.js");

		const result = await runDailyDaemonPostprocess("2026-03-10");

		expect(result.research.refinements.projectPaths).toEqual(["/repo/project", "/repo/other"]);
		expect(result.research.refinements.scopes).toEqual(
			expect.arrayContaining([
				{ projectPath: "/repo/project", sessionIds: ["sess-1"], sessionLineageKeys: [], priorityScore: 3.4 },
			]),
		);
		expect(result.research.projectPaths).toEqual(["/repo/project", "/repo/other"]);
	});
});
