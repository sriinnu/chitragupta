import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repairSelectiveReembedding = vi.fn(async (options?: { levels?: string[]; periods?: string[]; dates?: string[] }) => ({
	plan: { candidateCount: options?.levels?.[0] === "daily" ? 2 : options?.levels?.[0] === "monthly" ? 1 : 0 },
	reembedded: options?.levels?.[0] === "yearly" ? 0 : 1,
	remoteSynced: 0,
}));

const refreshGlobalSemanticEpochDrift = vi.fn(async (options?: { force?: boolean }) => ({
	currentEpoch: "provider-a:model-a:1536:provider",
	previousEpoch: options?.force ? "provider-a:model-a:1536:provider" : null,
	reason: options?.force ? "forced" : "bootstrap",
	refreshed: true,
	repair: {
		plan: { scanned: 5, candidateCount: 2 },
		reembedded: 2,
		remoteSynced: 1,
		qualityDeferred: 0,
	},
}));

vi.mock("@chitragupta/smriti", () => ({
	repairSelectiveReembedding,
	refreshGlobalSemanticEpochDrift,
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
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed"],
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
			scopes: [
				{ level: "daily", period: "2026-03-10", candidates: 2, reembedded: 1 },
				{ level: "monthly", period: "2026-03", candidates: 1, reembedded: 1 },
				{ level: "yearly", period: "2026", candidates: 0, reembedded: 0 },
			],
		});
	});

	it("delegates global semantic epoch refresh into Smriti", async () => {
		const { refreshGlobalSemanticEpochDrift: refresh } = await import("../src/chitragupta-daemon-semantic.js");

		const result = await refresh(true);

		expect(refreshGlobalSemanticEpochDrift).toHaveBeenCalledWith({ force: true });
		expect(result).toEqual({
			currentEpoch: "provider-a:model-a:1536:provider",
			previousEpoch: "provider-a:model-a:1536:provider",
			reason: "forced",
			refreshed: true,
			repair: {
				plan: { scanned: 5, candidateCount: 2 },
				reembedded: 2,
				remoteSynced: 1,
				qualityDeferred: 0,
			},
		});
	});
});
