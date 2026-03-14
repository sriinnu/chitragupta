import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEMANTIC_EMBEDDING_POLICY_VERSION } from "../../smriti/src/embedding-epoch.js";

function epoch(providerId = "provider-a", modelId = "model-a", dimensions = 1536): string {
	return `${providerId}:${modelId}:${dimensions}:provider:${SEMANTIC_EMBEDDING_POLICY_VERSION}`;
}

const repairSelectiveReembedding = vi.fn(async (options?: { levels?: string[]; periods?: string[]; dates?: string[] }) => ({
	plan: { candidateCount: options?.levels?.[0] === "daily" ? 2 : options?.levels?.[0] === "monthly" ? 1 : 0 },
	reembedded: options?.levels?.[0] === "yearly" ? 0 : 1,
	remoteSynced: 0,
	qualityDeferred: 0,
}));

const refreshGlobalSemanticEpochDrift = vi.fn(async (options?: { force?: boolean }) => ({
	currentEpoch: epoch(),
	previousEpoch: options?.force ? epoch() : null,
	reason: options?.force ? "forced" : "bootstrap",
	completed: true,
	freshnessCompleted: true,
	refreshed: true,
	qualityDebtCount: 0,
	repair: {
		plan: { scanned: 5, candidateCount: 2 },
		reembedded: 2,
		remoteSynced: 1,
		qualityDeferred: 0,
	},
}));

function buildTemporalSelectiveReembeddingRequest(args: {
	level: "daily" | "monthly" | "yearly";
	date: string;
	researchSignalCount?: number;
	projects?: string[];
	periods?: string[];
	override?: {
		dailyCandidateLimit?: number;
		projectCandidateLimit?: number;
		dailyMinMdlScore?: number;
		projectMinMdlScore?: number;
		dailyMinPriorityScore?: number;
		projectMinPriorityScore?: number;
		dailyMinSourceSessionCount?: number;
		projectMinSourceSessionCount?: number;
	} | null;
}) {
	const qualityPressure = (args.researchSignalCount ?? 0) > 0;
	const override = args.override ?? null;
	const candidateLimitOverride = args.level === "daily"
		? override?.dailyCandidateLimit
		: override?.projectCandidateLimit;
	const minMdlScoreOverride = args.level === "daily"
		? override?.dailyMinMdlScore
		: override?.projectMinMdlScore;
	const minPriorityScoreOverride = args.level === "daily"
		? override?.dailyMinPriorityScore
		: override?.projectMinPriorityScore;
	const minSourceSessionCountOverride = args.level === "daily"
		? override?.dailyMinSourceSessionCount
		: override?.projectMinSourceSessionCount;
	const request: Record<string, unknown> = {
		levels: [args.level],
		candidateLimit: candidateLimitOverride ?? (
			args.level === "daily"
				? 12 + (qualityPressure ? Math.min(args.researchSignalCount ?? 0, 6) : 0)
				: args.level === "monthly"
					? 6 + (qualityPressure ? Math.min(args.researchSignalCount ?? 0, 2) : 0)
					: 3 + (qualityPressure ? Math.min(args.researchSignalCount ?? 0, 2) : 0)
		),
		reasons:
			args.level === "daily" || qualityPressure
				? ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"]
				: ["stale_epoch", "stale_remote_epoch"],
		minMdlScore: minMdlScoreOverride ?? (
			args.level === "daily"
				? qualityPressure ? 0.45 : 0.55
				: args.level === "monthly"
					? qualityPressure ? 0.55 : 0.6
					: qualityPressure ? 0.6 : 0.65
		),
		minSourceSessionCount: minSourceSessionCountOverride ?? (args.level === "daily" ? 1 : args.level === "monthly" ? 2 : 4),
		minPriorityScore: minPriorityScoreOverride ?? (
			args.level === "daily"
				? qualityPressure ? 1.35 : 1.65
				: args.level === "monthly"
					? qualityPressure ? 1.6 : 1.9
					: qualityPressure ? 1.85 : 2.15
		),
		resyncRemote: qualityPressure,
	};
	if (args.projects?.length) request.projects = [...args.projects];
	if (args.level === "daily") {
		request.dates = [args.date];
		return request;
	}
	request.periods = [...(args.periods ?? [args.level === "monthly" ? args.date.slice(0, 7) : args.date.slice(0, 4)])];
	return request;
}

const listResearchLoopSummaries = vi.fn(() => []);
const listResearchExperiments = vi.fn(() => []);
const readActiveResearchRefinementBudget = vi.fn(() => null);

vi.mock("@chitragupta/smriti", () => ({
	repairSelectiveReembedding,
	refreshGlobalSemanticEpochDrift,
	listResearchLoopSummaries,
	listResearchExperiments,
	buildTemporalSelectiveReembeddingRequest,
	readActiveResearchRefinementBudget,
}));

describe("chitragupta-daemon semantic refinement helper", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("repairs stale temporal artifacts with bounded epoch-focused policy", async () => {
		const { repairSelectiveReembeddingForDate } = await import("../src/chitragupta-daemon-semantic.js");
		const result = await repairSelectiveReembeddingForDate("2026-03-10");

		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(1, {
			dates: ["2026-03-10"],
			levels: ["daily"],
			candidateLimit: 12,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
			minMdlScore: 0.55,
			minSourceSessionCount: 1,
			minPriorityScore: 1.65,
			resyncRemote: false,
		});
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(2, {
			periods: ["2026-03"],
			levels: ["monthly"],
			candidateLimit: 6,
			reasons: ["stale_epoch", "stale_remote_epoch"],
			minMdlScore: 0.6,
			minSourceSessionCount: 2,
			minPriorityScore: 1.9,
			resyncRemote: false,
		});
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(3, {
			periods: ["2026"],
			levels: ["yearly"],
			candidateLimit: 3,
			reasons: ["stale_epoch", "stale_remote_epoch"],
			minMdlScore: 0.65,
			minSourceSessionCount: 4,
			minPriorityScore: 2.15,
			resyncRemote: false,
		});
		expect(result).toEqual({
			candidates: 3,
			reembedded: 2,
			remoteSynced: 0,
			qualityDeferred: 0,
			scopes: [
				{ level: "daily", period: "2026-03-10", candidates: 2, reembedded: 1, remoteSynced: 0, qualityDeferred: 0 },
				{ level: "monthly", period: "2026-03", candidates: 1, reembedded: 1, remoteSynced: 0, qualityDeferred: 0 },
				{ level: "yearly", period: "2026", candidates: 0, reembedded: 0, remoteSynced: 0, qualityDeferred: 0 },
			],
		});
	});

	it("delegates global semantic epoch refresh into Smriti", async () => {
		const { refreshGlobalSemanticEpochDrift: refresh } = await import("../src/chitragupta-daemon-semantic.js");

		const result = await refresh(true);

		expect(refreshGlobalSemanticEpochDrift).toHaveBeenCalledWith({ force: true });
		expect(result).toEqual({
			currentEpoch: epoch(),
			previousEpoch: epoch(),
			reason: "forced",
			completed: true,
			freshnessCompleted: true,
			refreshed: true,
			qualityDebtCount: 0,
			repair: {
				plan: { scanned: 5, candidateCount: 2 },
				reembedded: 2,
				remoteSynced: 1,
				qualityDeferred: 0,
			},
		});
	});

	it("uses research outcomes to widen project-scoped semantic repair during deep sleep", async () => {
		listResearchLoopSummaries.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				sessionId: "session-1",
				parentSessionId: null,
				stopReason: "closure-failed",
				updatedAt: new Date("2026-03-12T09:00:00.000Z").getTime(),
			},
		]);
		listResearchExperiments.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				sessionId: "session-1",
				parentSessionId: null,
				decision: "keep",
				delta: 0.004,
				updatedAt: new Date("2026-03-12T09:30:00.000Z").getTime(),
			},
		]);
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { candidateCount: 2 },
			reembedded: 1,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { candidateCount: 3 },
			reembedded: 2,
			remoteSynced: 2,
			qualityDeferred: 0,
		});

		const { repairSelectiveReembeddingForResearchScopes } = await import("../src/chitragupta-daemon-semantic.js");
		const result = await repairSelectiveReembeddingForResearchScopes("2026-03-12", [
			{ projectPath: "/repo/project", sessionIds: ["session-1"] },
		]);

		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(1, {
			dates: ["2026-03-12"],
			levels: ["daily"],
			projects: ["/repo/project"],
			candidateLimit: 14,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
			minMdlScore: 0.45,
			minSourceSessionCount: 1,
			minPriorityScore: 1.35,
			resyncRemote: true,
		});
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(2, {
			periods: ["2026-03"],
			levels: ["monthly"],
			projects: ["/repo/project"],
			candidateLimit: 8,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
			minMdlScore: 0.55,
			minSourceSessionCount: 2,
			minPriorityScore: 1.6,
			resyncRemote: true,
		});
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(3, {
			periods: ["2026"],
			levels: ["yearly"],
			projects: ["/repo/project"],
			candidateLimit: 5,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed", "low_retention", "low_reduction"],
			minMdlScore: 0.6,
			minSourceSessionCount: 4,
			minPriorityScore: 1.85,
			resyncRemote: true,
		});
		expect(result).toEqual({
			label: "2026-03-12",
			candidates: 5,
			reembedded: 3,
			remoteSynced: 2,
			qualityDeferred: 0,
			scopes: [{
				projectPath: "/repo/project",
				dailyDates: ["2026-03-12"],
				candidates: 5,
				reembedded: 3,
				remoteSynced: 2,
				qualityDeferred: 0,
			}],
		});
	});

	it("reuses the active persisted refinement budget during daemon sweeps", async () => {
		readActiveResearchRefinementBudget.mockReturnValueOnce({
			refinement: {
				dailyCandidateLimit: 20,
				projectCandidateLimit: 9,
				dailyMinMdlScore: 0.42,
				projectMinMdlScore: 0.5,
				dailyMinPriorityScore: 1.05,
				projectMinPriorityScore: 1.35,
			},
			source: "research.outcome.immediate",
			expiresAt: Date.now() + 60_000,
			updatedAt: Date.now(),
			parseError: null,
		});

		const { repairSelectiveReembeddingForDate } = await import("../src/chitragupta-daemon-semantic.js");
		await repairSelectiveReembeddingForDate("2026-03-10", { researchSignalCount: 3 });

		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(1, expect.objectContaining({
			levels: ["daily"],
			candidateLimit: 20,
			minMdlScore: 0.42,
			minPriorityScore: 1.05,
		}));
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(2, expect.objectContaining({
			levels: ["monthly"],
			candidateLimit: 9,
			minMdlScore: 0.5,
			minPriorityScore: 1.35,
		}));
		expect(repairSelectiveReembedding).toHaveBeenNthCalledWith(3, expect.objectContaining({
			levels: ["yearly"],
			candidateLimit: 9,
			minMdlScore: 0.5,
			minPriorityScore: 1.35,
		}));
	});

	it("merges repeated project scopes by lineage and session id before repair", async () => {
		listResearchLoopSummaries.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				sessionId: "session-1",
				parentSessionId: null,
				sessionLineageKey: "lineage-a",
				stopReason: "closure-failed",
				updatedAt: new Date("2026-03-12T09:00:00.000Z").getTime(),
			},
		]);
		listResearchExperiments.mockReturnValueOnce([
			{
				projectPath: "/repo/project",
				sessionId: "session-2",
				parentSessionId: null,
				sessionLineageKey: "lineage-a",
				decision: "keep",
				delta: 0.004,
				updatedAt: new Date("2026-03-12T09:30:00.000Z").getTime(),
			},
		]);
		repairSelectiveReembedding.mockResolvedValue({
			plan: { candidateCount: 1 },
			reembedded: 1,
			remoteSynced: 0,
			qualityDeferred: 0,
		});

		const { repairSelectiveReembeddingForResearchScopes } = await import("../src/chitragupta-daemon-semantic.js");
		await repairSelectiveReembeddingForResearchScopes("2026-03-12", [
			{ projectPath: "/repo/project", sessionIds: ["session-1"] },
			{ projectPath: "/repo/project", sessionIds: ["session-2"], sessionLineageKeys: ["lineage-a"] },
		]);

		expect(listResearchLoopSummaries).toHaveBeenCalledTimes(1);
		expect(listResearchExperiments).toHaveBeenCalledTimes(1);
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(3);
	});
});
