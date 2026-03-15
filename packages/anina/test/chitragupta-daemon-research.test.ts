import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function buildDefaultLoopSummaries() {
	return [
		{
			id: "loop-1",
			projectPath: "/repo/project",
			loopKey: "loop-a",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			stopReason: "no-improvement",
			roundsRequested: 6,
			roundsCompleted: 4,
			bestMetric: 0.991,
			bestRoundNumber: 2,
			keptRounds: 1,
			revertedRounds: 3,
			totalDurationMs: 240000,
			totalBudgetMs: 300000,
			councilVerdict: "accepted",
			plannerRouteClass: "coding.deep-reasoning",
			executionRouteClass: "tool.use.flex",
			sessionId: "sess-1",
			sabhaId: "sabha-1",
			record: {
				policyFingerprint: "policy-abc",
				primaryObjectiveId: "metric-improvement",
				primaryStopConditionId: "pareto-halt",
				primaryStopConditionKind: "pareto-stagnation",
				frontier: [{ roundNumber: 2, optimizerScore: 0.78, objectiveScores: [] }],
			},
		},
	];
}

function buildDefaultResearchExperiments() {
	return [
		{
			id: "exp-1",
			projectPath: "/repo/project",
			experimentKey: "optimizer-sweep",
			loopKey: "loop-a",
			topic: "optimizer sweep",
			metricName: "val_bpb",
			objective: "minimize",
			decision: "keep",
			status: "completed",
			baselineMetric: 0.9979,
			observedMetric: 0.991,
			delta: 0.0069,
			roundNumber: 2,
			totalRounds: 6,
			plannerRouteClass: "coding.deep-reasoning",
			executionRouteClass: "tool.use.flex",
			packedRuntime: "pakt-core",
			packedSource: "daemon",
			sessionId: "sess-1",
			sabhaId: "sabha-1",
			record: {
				policyFingerprint: "policy-abc",
				primaryObjectiveId: "metric-improvement",
				primaryStopConditionId: "pareto-halt",
				primaryStopConditionKind: "pareto-stagnation",
				objectiveScores: [{ id: "metric-improvement", label: "Metric", metric: "metric-improvement", score: 1 }],
				optimizerScore: 0.78,
			},
		},
	];
}

const appendMemory = vi.fn(async () => undefined);
const akashaRestore = vi.fn();
const akashaLeave = vi.fn(() => ({ id: "aks-research-digest" }));
const akashaPersist = vi.fn();
const agentDb = {};
const listResearchLoopSummaries = vi.fn(buildDefaultLoopSummaries);
const listResearchExperiments = vi.fn(buildDefaultResearchExperiments);

vi.mock("@chitragupta/smriti", () => ({
	appendMemory,
	AkashaField: class {
		restore(db: unknown) {
			akashaRestore(db);
		}

		leave(
			agentId: string,
			type: string,
			topic: string,
			content: string,
			metadata?: Record<string, unknown>,
		) {
			return akashaLeave(agentId, type, topic, content, metadata);
		}

		persist(db: unknown) {
			akashaPersist(db);
		}
	},
	DatabaseManager: {
		instance: () => ({
			get: (name: string) => {
				expect(name).toBe("agent");
				return agentDb;
			},
		}),
	},
	listResearchLoopSummaries,
	listResearchExperiments,
}));

describe("chitragupta-daemon research consolidation helper", () => {
	beforeEach(() => {
		vi.resetModules();
		appendMemory.mockReset();
		appendMemory.mockImplementation(async () => undefined);
		akashaRestore.mockReset();
		akashaLeave.mockReset();
		akashaLeave.mockImplementation(() => ({ id: "aks-research-digest" }));
		akashaPersist.mockReset();
		listResearchLoopSummaries.mockReset();
		listResearchLoopSummaries.mockImplementation(buildDefaultLoopSummaries);
		listResearchExperiments.mockReset();
		listResearchExperiments.mockImplementation(buildDefaultResearchExperiments);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("renders overnight loop summaries into project memory", async () => {
		const { consolidateResearchLoopSummariesForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchLoopSummariesForDate("2026-03-10");

		expect(listResearchLoopSummaries).toHaveBeenCalledWith({
			updatedAfter: expect.any(Number),
			updatedBefore: expect.any(Number),
			limit: 500,
			offset: 0,
		});
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("## Overnight Research Loop [loop-1]"),
			{ dedupe: true },
		);
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("- policyFingerprint: policy-abc"),
			{ dedupe: true },
		);
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("- primaryStopConditionKind: pareto-stagnation"),
			{ dedupe: true },
		);
		expect(result).toEqual({
			processed: 1,
			projects: 1,
			projectPaths: ["/repo/project"],
		});
	});

	it("pages through more than one daily summary batch", async () => {
		const firstBatch = Array.from({ length: 500 }, (_, index) => ({
			id: `loop-${index}`,
			projectPath: "/repo/project",
			loopKey: `loop-${index}`,
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			stopReason: "no-improvement",
			roundsRequested: 6,
			roundsCompleted: 4,
			record: {},
		}));
		const secondBatch = [{
			id: "loop-500",
			projectPath: "/repo/project",
			loopKey: "loop-500",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			stopReason: "no-improvement",
			roundsRequested: 6,
			roundsCompleted: 4,
			record: {},
		}];
		listResearchLoopSummaries
			.mockReturnValueOnce(firstBatch)
			.mockReturnValueOnce(secondBatch)
			.mockReturnValueOnce([]);

		const { consolidateResearchLoopSummariesForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchLoopSummariesForDate("2026-03-10");

		expect(listResearchLoopSummaries).toHaveBeenNthCalledWith(1, expect.objectContaining({
			limit: 500,
			offset: 0,
		}));
		expect(listResearchLoopSummaries).toHaveBeenNthCalledWith(2, expect.objectContaining({
			limit: 500,
			offset: 500,
		}));
		expect(result.processed).toBe(501);
	});

	it("renders experiment outcomes into project memory", async () => {
		const { consolidateResearchExperimentsForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchExperimentsForDate("2026-03-10");

		expect(listResearchExperiments).toHaveBeenCalledWith({
			updatedAfter: expect.any(Number),
			updatedBefore: expect.any(Number),
			limit: 500,
			offset: 0,
		});
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("## Research Experiment [exp-1]"),
			{ dedupe: true },
		);
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("- policyFingerprint: policy-abc"),
			{ dedupe: true },
		);
		expect(result).toEqual({
			processed: 1,
			projects: 1,
			projectPaths: ["/repo/project"],
		});
	});

	it("renders one refinement digest per project from loop and experiment outcomes", async () => {
		const { consolidateResearchRefinementDigestsForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchRefinementDigestsForDate("2026-03-10");

		expect(listResearchLoopSummaries).toHaveBeenCalledWith({
			updatedAfter: expect.any(Number),
			updatedBefore: expect.any(Number),
			limit: 500,
			offset: 0,
		});
		expect(listResearchExperiments).toHaveBeenCalledWith({
			updatedAfter: expect.any(Number),
			updatedBefore: expect.any(Number),
			limit: 500,
			offset: 0,
		});
			expect(appendMemory).toHaveBeenCalledWith(
				{ type: "project", path: "/repo/project" },
				expect.stringContaining("## Research Refinement Digest [2026-03-10]"),
				{ dedupe: true },
			);
			expect(appendMemory).toHaveBeenCalledWith(
				{ type: "project", path: "/repo/project" },
				expect.stringContaining("- policyFingerprints: policy-abc"),
				{ dedupe: true },
			);
			expect(appendMemory).toHaveBeenCalledWith(
				{ type: "project", path: "/repo/project" },
				expect.stringContaining("### Next Steps"),
				{ dedupe: true },
		);
		expect(akashaRestore).toHaveBeenCalledWith(agentDb);
		expect(akashaLeave).toHaveBeenCalledWith(
			"anina:research-postprocess",
			"pattern",
			"research refinement /repo/project",
			expect.stringContaining("## Research Refinement Digest [2026-03-10]"),
			expect.objectContaining({
				source: "research-refinement-digest",
				label: "2026-03-10",
				projectPath: "/repo/project",
				loopCount: 1,
				experimentCount: 1,
				nextSteps: expect.arrayContaining([
					expect.stringContaining("Promote the kept optimizer sweep experiment"),
				]),
			}),
		);
		expect(akashaPersist).toHaveBeenCalledWith(agentDb);
		expect(result).toEqual({
			processed: 1,
			projects: 1,
			projectPaths: ["/repo/project"],
			scopes: [
					{
						projectPath: "/repo/project",
						sessionIds: ["sess-1"],
						sessionLineageKeys: [],
						priorityScore: 4.4,
						policyFingerprints: ["policy-abc"],
						primaryObjectiveIds: ["metric-improvement"],
						primaryStopConditionIds: ["pareto-halt"],
						primaryStopConditionKinds: ["pareto-stagnation"],
						frontierBestScore: 0.78,
						refinementBudget: null,
						nidraBudget: null,
					},
				],
			});
		});

	it("keeps optimizer policy metadata in refinement digests even when only experiments survived", async () => {
		listResearchLoopSummaries.mockReturnValueOnce([]);
		listResearchExperiments.mockReturnValueOnce([
			{
				id: "exp-optimizer-only",
				projectPath: "/repo/project",
				experimentKey: "optimizer-only",
				loopKey: "loop-z",
				topic: "optimizer-only",
				metricName: "val_bpb",
				objective: "minimize",
				decision: "record",
				status: "completed",
				baselineMetric: 1,
				observedMetric: 0.998,
				delta: 0.002,
				roundNumber: 1,
				totalRounds: 3,
				sessionId: "sess-1",
				record: {
					policyFingerprint: "policy-exp-only",
					primaryObjectiveId: "metric-improvement",
					primaryStopConditionId: "pareto-halt",
					primaryStopConditionKind: "pareto-stagnation",
					objectiveScores: [{ id: "metric-improvement", label: "Metric", metric: "metric-improvement", score: 0.8 }],
					optimizerScore: 0.66,
				},
			},
		]);

		const { consolidateResearchRefinementDigestsForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchRefinementDigestsForDate("2026-03-10");

		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("- policyFingerprints: policy-exp-only"),
			{ dedupe: true },
		);
		expect(result.scopes).toEqual([
			expect.objectContaining({
				projectPath: "/repo/project",
				policyFingerprints: ["policy-exp-only"],
				primaryObjectiveIds: ["metric-improvement"],
				primaryStopConditionIds: ["pareto-halt"],
				primaryStopConditionKinds: ["pareto-stagnation"],
				frontierBestScore: 0.66,
			}),
		]);
	});

	it("reconstructs legacy experiment stop-condition metadata from stop-condition hits", async () => {
		listResearchLoopSummaries.mockReturnValueOnce([]);
		listResearchExperiments.mockReturnValueOnce([
			{
				id: "exp-legacy-stop-hit",
				projectPath: "/repo/project",
				experimentKey: "legacy-stop-hit",
				loopKey: "loop-legacy-stop-hit",
				topic: "legacy-stop-hit",
				metricName: "val_bpb",
				objective: "minimize",
				decision: "record",
				status: "completed",
				baselineMetric: 1,
				observedMetric: 0.997,
				delta: 0.003,
				roundNumber: 2,
				totalRounds: 4,
				sessionId: "sess-1",
				record: {
					policyFingerprint: "policy-legacy-stop-hit",
					primaryObjectiveId: "metric-improvement",
					stopConditionHits: [
						{
							id: "pareto-halt",
							kind: "pareto-stagnation",
							triggered: true,
							reason: "Dominated frontier stalled for three rounds.",
						},
					],
					objectiveScores: [{ id: "metric-improvement", label: "Metric", metric: "metric-improvement", score: 0.8 }],
					optimizerScore: 0.74,
				},
			},
		]);

		const { consolidateResearchRefinementDigestsForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchRefinementDigestsForDate("2026-03-10");

		expect(result.scopes).toEqual([
			expect.objectContaining({
				projectPath: "/repo/project",
				policyFingerprints: ["policy-legacy-stop-hit"],
				primaryObjectiveIds: ["metric-improvement"],
				primaryStopConditionIds: [],
				primaryStopConditionKinds: ["pareto-stagnation"],
				frontierBestScore: 0.74,
			}),
		]);
	});

	it("reconstructs frontier and stop-condition pressure from legacy loop round metadata", async () => {
		listResearchLoopSummaries.mockReturnValueOnce([
			{
				id: "loop-legacy-rounds",
				projectPath: "/repo/project",
				sessionId: "sess-1",
				parentSessionId: null,
				loopKey: "loop-legacy-rounds",
				topic: "legacy optimizer sweep",
				hypothesis: "legacy metadata still carries optimizer truth",
				stopReason: "pareto-stagnation",
				roundsRequested: 4,
				roundsCompleted: 4,
				bestMetric: 0.991,
				bestRoundNumber: 2,
				keptRounds: 1,
				revertedRounds: 1,
				record: {
					policy: {
						fingerprint: "policy-legacy-summary",
						primaryObjectiveId: "metric-improvement",
						primaryStopConditionId: "pareto-halt",
					},
					stopConditionHits: [
						{ id: "pareto-halt", kind: "pareto-stagnation", triggered: true },
					],
					rounds: [
						{
							roundNumber: 1,
							optimizerScore: 0.62,
							objectiveScores: [{ id: "metric-improvement", label: "Metric", metric: "metric-improvement", score: 0.62 }],
							paretoDominated: true,
						},
						{
							roundNumber: 2,
							optimizerScore: 0.74,
							objectiveScores: [{ id: "metric-improvement", label: "Metric", metric: "metric-improvement", score: 0.74 }],
							paretoDominated: false,
						},
					],
				},
			},
		]);
		listResearchExperiments.mockReturnValueOnce([]);

		const { consolidateResearchRefinementDigestsForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchRefinementDigestsForDate("2026-03-10");

		expect(result.scopes).toEqual([
			expect.objectContaining({
				projectPath: "/repo/project",
				policyFingerprints: ["policy-legacy-summary"],
				primaryObjectiveIds: ["metric-improvement"],
				primaryStopConditionIds: ["pareto-halt"],
				primaryStopConditionKinds: ["pareto-stagnation"],
				frontierBestScore: 0.74,
			}),
		]);
		expect(akashaLeave).toHaveBeenCalledWith(
			"anina:research-postprocess",
			"pattern",
			"research refinement /repo/project",
			expect.stringContaining("## Research Refinement Digest [2026-03-10]"),
			expect.objectContaining({
				stopReasons: ["pareto-stagnation"],
			}),
		);
	});

	it("renders a deep-sleep refinement digest only for touched project sessions", async () => {
		const { consolidateResearchRefinementDigestsForProjects } = await import("../src/chitragupta-daemon-research.js");
		listResearchLoopSummaries.mockReturnValueOnce([
			{
				id: "loop-1",
				projectPath: "/repo/project",
				sessionId: "sess-1",
				parentSessionId: null,
				loopKey: "loop-a",
				topic: "optimizer sweep",
				hypothesis: "adamw beats cosine",
				stopReason: "no-improvement",
				roundsRequested: 6,
				roundsCompleted: 4,
				bestMetric: 0.991,
				bestRoundNumber: 2,
				keptRounds: 1,
				revertedRounds: 3,
			},
			{
				id: "loop-2",
				projectPath: "/repo/project",
				sessionId: "sess-2",
				parentSessionId: null,
				loopKey: "loop-b",
				topic: "unrelated sweep",
				hypothesis: null,
				stopReason: "budget-exhausted",
				roundsRequested: 3,
				roundsCompleted: 3,
				bestMetric: 1.1,
				bestRoundNumber: 1,
				keptRounds: 0,
				revertedRounds: 0,
			},
		]);
		listResearchExperiments.mockReturnValueOnce([
			{
				id: "exp-1",
				projectPath: "/repo/project",
				sessionId: "sess-1",
				parentSessionId: null,
				experimentKey: "optimizer-sweep",
				loopKey: "loop-a",
				topic: "optimizer sweep",
				hypothesis: "adamw beats cosine",
				metricName: "val_bpb",
				objective: "minimize",
				decision: "keep",
				status: "completed",
				baselineMetric: 0.9979,
				observedMetric: 0.991,
				delta: 0.0069,
				roundNumber: 2,
				totalRounds: 6,
			},
		]);

		const result = await consolidateResearchRefinementDigestsForProjects("deep-sleep", [
			{ projectPath: "/repo/project", sessionIds: ["sess-1"] },
		]);

		expect(listResearchLoopSummaries).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			limit: 400,
			offset: 0,
		});
		expect(listResearchExperiments).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			limit: 400,
			offset: 0,
		});

		const digestEntry = appendMemory.mock.calls.at(-1)?.[1];
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("## Research Refinement Digest [deep-sleep]"),
			{ dedupe: true },
		);
		expect(akashaLeave).toHaveBeenCalledWith(
			"anina:research-postprocess",
			"pattern",
			"research refinement /repo/project",
			expect.stringContaining("## Research Refinement Digest [deep-sleep]"),
			expect.objectContaining({
				source: "research-refinement-digest",
				label: "deep-sleep",
				projectPath: "/repo/project",
				loopCount: 1,
				experimentCount: 1,
			}),
		);
		expect(typeof digestEntry).toBe("string");
		expect(digestEntry).not.toContain("unrelated sweep");
		expect(result).toEqual({
			processed: 1,
			projects: 1,
			projectPaths: ["/repo/project"],
			scopes: [
				expect.objectContaining({
					projectPath: "/repo/project",
					sessionIds: ["sess-1"],
					priorityScore: expect.any(Number),
				}),
			],
		});
	});

	it("pages through more than one project-scoped batch for deep-sleep digests", async () => {
		const { consolidateResearchRefinementDigestsForProjects } = await import("../src/chitragupta-daemon-research.js");
		const firstLoopBatch = Array.from({ length: 400 }, (_, index) => ({
			id: `loop-page-${index}`,
			projectPath: "/repo/project",
			sessionId: index === 0 ? "sess-1" : `other-${index}`,
			parentSessionId: null,
			sessionLineageKey: null,
			loopKey: `loop-page-${index}`,
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			stopReason: "no-improvement",
			roundsRequested: 3,
			roundsCompleted: 3,
			bestMetric: 1.1,
			bestRoundNumber: 1,
			keptRounds: 0,
			revertedRounds: 0,
			record: {},
		}));
		const secondLoopBatch = [{
			id: "loop-page-400",
			projectPath: "/repo/project",
			sessionId: "sess-1",
			parentSessionId: null,
			sessionLineageKey: null,
			loopKey: "loop-page-400",
			topic: "optimizer sweep",
			hypothesis: "adamw beats cosine",
			stopReason: "budget-exhausted",
			roundsRequested: 3,
			roundsCompleted: 3,
			bestMetric: 1,
			bestRoundNumber: 2,
			keptRounds: 1,
			revertedRounds: 0,
			record: {},
		}];
		listResearchLoopSummaries
			.mockReturnValueOnce(firstLoopBatch)
			.mockReturnValueOnce(secondLoopBatch)
			.mockReturnValueOnce([]);
		listResearchExperiments
			.mockReturnValueOnce([])
			.mockReturnValueOnce([]);

		const result = await consolidateResearchRefinementDigestsForProjects("deep-sleep", [
			{ projectPath: "/repo/project", sessionIds: ["sess-1"] },
		]);

		expect(listResearchLoopSummaries).toHaveBeenNthCalledWith(1, {
			projectPath: "/repo/project",
			limit: 400,
			offset: 0,
		});
		expect(listResearchLoopSummaries).toHaveBeenNthCalledWith(2, {
			projectPath: "/repo/project",
			limit: 400,
			offset: 400,
		});
		expect(result).toEqual({
			processed: 1,
			projects: 1,
			projectPaths: ["/repo/project"],
			scopes: [
				expect.objectContaining({
					projectPath: "/repo/project",
					sessionIds: ["sess-1"],
				}),
			],
		});
	});
});
