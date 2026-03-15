import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	},
		project: {
			projects: [args.projectPath],
			levels: ["monthly", "yearly"],
			periods: [args.date.slice(0, 7), args.date.slice(0, 4)],
			candidateLimit: args.override?.projectCandidateLimit ?? (args.elevatedSignal ? 6 : 3),
		},
	}));

const repairSelectiveReembedding = vi.fn(async (options?: { levels?: string[] }) => ({
	plan: { candidateCount: options?.levels?.[0] === "daily" ? 2 : 1 },
	reembedded: 1,
	remoteSynced: options?.levels?.[0] === "daily" ? 0 : 1,
	qualityDeferred: 0,
}));
const upsertResearchRefinementBudget = vi.fn(() => undefined);

vi.mock("@chitragupta/smriti", () => ({
	buildImmediateResearchRefinementRequests,
	repairSelectiveReembedding,
	upsertResearchRefinementBudget,
}));

describe("services-research-refinement", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses the shared refinement policy and normalized project path", async () => {
		const { triggerImmediateResearchRefinement } = await import("../src/services-research-refinement.js");
		const result = await triggerImmediateResearchRefinement("/repo/project/", {
			date: "2026-03-13",
			decision: "keep",
		});

		expect(buildImmediateResearchRefinementRequests).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			date: "2026-03-13",
			elevatedSignal: true,
			override: null,
		});
		expect(upsertResearchRefinementBudget).not.toHaveBeenCalled();
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(1, expect.objectContaining({
			levels: ["daily"],
			candidateLimit: 8,
		}));
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(2, expect.objectContaining({
			levels: ["monthly", "yearly"],
			periods: ["2026-03", "2026"],
			candidateLimit: 6,
		}));
		expect(result).toEqual({
			status: "repaired",
			daily: {
				date: "2026-03-13",
				candidates: 2,
				reembedded: 1,
				remoteSynced: 0,
				qualityDeferred: 0,
			},
			project: {
				candidates: 1,
				reembedded: 1,
				remoteSynced: 1,
				qualityDeferred: 0,
			},
		});
	});

	it("keeps non-elevated immediate repair narrower", async () => {
		const { triggerImmediateResearchRefinement } = await import("../src/services-research-refinement.js");
		await triggerImmediateResearchRefinement("/repo/project", {
			date: "2026-03-13",
			decision: "skip",
			status: "completed",
		});

		expect(buildImmediateResearchRefinementRequests).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			date: "2026-03-13",
			elevatedSignal: false,
			override: null,
		});
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(1, expect.objectContaining({
			levels: ["daily"],
			candidateLimit: 4,
		}));
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(2, expect.objectContaining({
			levels: ["monthly", "yearly"],
			periods: ["2026-03", "2026"],
			candidateLimit: 3,
		}));
	});

	it("treats control-plane loss as elevated immediate repair pressure", async () => {
		const { triggerImmediateResearchRefinement } = await import("../src/services-research-refinement.js");
		await triggerImmediateResearchRefinement("/repo/project", {
			date: "2026-03-13",
			decision: "record",
			status: "control-plane-lost",
		});

		expect(buildImmediateResearchRefinementRequests).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			date: "2026-03-13",
			elevatedSignal: true,
			override: null,
		});
	});

	it("persists explicit refinement budgets for the next daemon sweep", async () => {
		const { triggerImmediateResearchRefinement } = await import("../src/services-research-refinement.js");
		await triggerImmediateResearchRefinement("/repo/project/", {
			date: "2026-03-13",
			decision: "keep",
			updateBudgets: {
				refinement: {
					dailyCandidateLimit: 11,
					projectCandidateLimit: 7,
				},
				nidra: {
					maxResearchProjectsPerCycle: 2,
					maxSemanticPressure: 5,
				},
			},
		});

		expect(buildImmediateResearchRefinementRequests).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			date: "2026-03-13",
			elevatedSignal: true,
			override: {
				dailyCandidateLimit: 11,
				projectCandidateLimit: 7,
			},
		});
		expect(upsertResearchRefinementBudget).toHaveBeenCalledWith({
			refinement: {
				dailyCandidateLimit: 11,
				projectCandidateLimit: 7,
			},
			nidra: {
				maxResearchProjectsPerCycle: 2,
				maxSemanticPressure: 5,
			},
			source: "research.outcome.immediate",
		});
	});

		it("persists nidra-only budgets for the next daemon sweep", async () => {
			const { triggerImmediateResearchRefinement } = await import("../src/services-research-refinement.js");
			await triggerImmediateResearchRefinement("/repo/project/", {
			date: "2026-03-13",
			decision: "keep",
			updateBudgets: {
				nidra: {
					maxResearchProjectsPerCycle: 4,
					maxSemanticPressure: 6,
				},
			},
		});

		expect(buildImmediateResearchRefinementRequests).toHaveBeenCalledWith({
			projectPath: "/repo/project",
			date: "2026-03-13",
			elevatedSignal: true,
			override: null,
		});
			expect(upsertResearchRefinementBudget).toHaveBeenCalledWith({
				refinement: null,
				nidra: {
					maxResearchProjectsPerCycle: 4,
					maxSemanticPressure: 6,
				},
				source: "research.outcome.immediate",
			});
		});

		it("reports degraded status when immediate repair still carries quality debt", async () => {
			repairSelectiveReembedding
				.mockResolvedValueOnce({
					plan: { candidateCount: 2 },
					reembedded: 1,
					remoteSynced: 0,
					qualityDeferred: 1,
				})
				.mockResolvedValueOnce({
					plan: { candidateCount: 1 },
					reembedded: 1,
					remoteSynced: 1,
					qualityDeferred: 0,
				});

			const { triggerImmediateResearchRefinement } = await import("../src/services-research-refinement.js");
			const result = await triggerImmediateResearchRefinement("/repo/project/", {
				date: "2026-03-13",
				decision: "keep",
			});

			expect(result.status).toBe("degraded");
			expect(result.daily.qualityDeferred).toBe(1);
			expect(result.project.qualityDeferred).toBe(0);
		});
	});
