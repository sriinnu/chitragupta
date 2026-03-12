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
}));
const repairSelectiveReembeddingForDate = vi.fn(async () => ({
	candidates: 3,
	reembedded: 2,
	scopes: [
		{ level: "daily", period: "2026-03-10", candidates: 2, reembedded: 1 },
		{ level: "monthly", period: "2026-03", candidates: 1, reembedded: 1 },
		{ level: "yearly", period: "2026", candidates: 0, reembedded: 0 },
	],
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
}));

vi.mock("@chitragupta/smriti", () => ({
	syncRemoteSemanticMirror,
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
		expect(repairSelectiveReembeddingForDate).toHaveBeenCalledWith("2026-03-10");
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
		expect(result).toEqual({
			research: {
				loops: { processed: 2, projects: 1, projectPaths: ["/repo/project"] },
				experiments: { processed: 3, projects: 2, projectPaths: ["/repo/project", "/repo/other"] },
				refinements: { processed: 2, projects: 2, projectPaths: ["/repo/project", "/repo/other"] },
				processed: 7,
				projects: 2,
			},
			semantic: {
				candidates: 3,
				reembedded: 2,
				scopes: [
					{ level: "daily", period: "2026-03-10", candidates: 2, reembedded: 1 },
					{ level: "monthly", period: "2026-03", candidates: 1, reembedded: 1 },
					{ level: "yearly", period: "2026", candidates: 0, reembedded: 0 },
				],
			},
			remote: { enabled: true, synced: 7 },
		});
	});
});
