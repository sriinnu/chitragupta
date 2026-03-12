import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appendMemory = vi.fn(async () => undefined);
const listResearchLoopSummaries = vi.fn(() => [
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
	},
]);
const listResearchExperiments = vi.fn(() => [
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
	},
]);

vi.mock("@chitragupta/smriti", () => ({
	appendMemory,
	listResearchLoopSummaries,
	listResearchExperiments,
}));

describe("chitragupta-daemon research consolidation helper", () => {
	beforeEach(() => {
		vi.resetModules();
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
		});
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("## Overnight Research Loop [loop-1]"),
			{ dedupe: true },
		);
		expect(result).toEqual({ processed: 1, projects: 1, projectPaths: ["/repo/project"] });
	});

	it("renders experiment outcomes into project memory", async () => {
		const { consolidateResearchExperimentsForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchExperimentsForDate("2026-03-10");

		expect(listResearchExperiments).toHaveBeenCalledWith({
			updatedAfter: expect.any(Number),
			updatedBefore: expect.any(Number),
			limit: 500,
		});
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("## Research Experiment [exp-1]"),
			{ dedupe: true },
		);
		expect(result).toEqual({ processed: 1, projects: 1, projectPaths: ["/repo/project"] });
	});

	it("renders one refinement digest per project from loop and experiment outcomes", async () => {
		const { consolidateResearchRefinementDigestsForDate } = await import("../src/chitragupta-daemon-research.js");
		const result = await consolidateResearchRefinementDigestsForDate("2026-03-10");

		expect(listResearchLoopSummaries).toHaveBeenCalledWith({
			updatedAfter: expect.any(Number),
			updatedBefore: expect.any(Number),
			limit: 500,
		});
		expect(listResearchExperiments).toHaveBeenCalledWith({
			updatedAfter: expect.any(Number),
			updatedBefore: expect.any(Number),
			limit: 500,
		});
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("## Research Refinement Digest [2026-03-10]"),
			{ dedupe: true },
		);
		expect(appendMemory).toHaveBeenCalledWith(
			{ type: "project", path: "/repo/project" },
			expect.stringContaining("### Next Steps"),
			{ dedupe: true },
		);
		expect(result).toEqual({ processed: 1, projects: 1, projectPaths: ["/repo/project"] });
	});
});
