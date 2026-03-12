import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcRouter } from "../src/rpc-router.js";
import { registerSemanticMethods } from "../src/services-semantic.js";

const inspectConsolidationVectorSync = vi.fn(async () => ({
	scanned: 0,
	missingCount: 0,
	driftCount: 0,
	issues: [],
}));
const inspectRemoteSemanticSync = vi.fn(async () => ({
	enabled: false,
	provider: "disabled",
	configured: false,
	scanned: 0,
	syncedCount: 0,
	missingCount: 0,
	driftCount: 0,
	lastSyncAt: null,
	lastError: null,
	collection: undefined,
	baseUrl: undefined,
	remoteHealth: undefined,
	issues: [],
}));
const repairConsolidationVectorSync = vi.fn(async () => ({
	status: { scanned: 0, missingCount: 0, driftCount: 0, issues: [] },
	reindexed: 0,
}));
const syncRemoteSemanticMirror = vi.fn(async () => ({
	enabled: false,
	provider: "disabled",
	scanned: 0,
	syncedCount: 0,
	missingCount: 0,
	driftCount: 0,
	lastSyncAt: null,
	lastError: null,
	issues: [],
}));
const planSelectiveReembedding = vi.fn(async () => ({
	scanned: 3,
	candidateCount: 1,
	candidates: [{ id: "daily_summary:2026-02-10", score: 2.1, localReasons: ["stale_epoch"] }],
}));
const repairSelectiveReembedding = vi.fn(async () => ({
	plan: { scanned: 3, candidateCount: 1, candidates: [{ id: "daily_summary:2026-02-10", score: 2.1 }] },
	reembedded: 1,
	remoteSynced: 0,
}));

vi.mock("@chitragupta/smriti/consolidation-indexer", () => ({
	inspectConsolidationVectorSync,
	repairConsolidationVectorSync,
}));

vi.mock("@chitragupta/smriti", () => ({
	inspectRemoteSemanticSync,
	syncRemoteSemanticMirror,
	planSelectiveReembedding,
	repairSelectiveReembedding,
}));

describe("services-semantic", () => {
	let router: RpcRouter;

	beforeEach(() => {
		router = new RpcRouter();
		registerSemanticMethods(router);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("plans selective re-embedding candidates through the daemon RPC surface", async () => {
		const result = await router.handle("semantic.reembed_plan", {
			projects: "/repo/project",
			candidateLimit: 15,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed"],
		}, {});

		expect(planSelectiveReembedding).toHaveBeenCalledWith(expect.objectContaining({
			projects: ["/repo/project"],
			candidateLimit: 15,
			reasons: ["stale_epoch", "stale_remote_epoch", "low_mdl", "rejected_packed"],
		}));
		expect(result).toEqual(expect.objectContaining({
			scanned: 3,
			candidateCount: 1,
		}));
	});

	it("repairs selective re-embedding candidates through the daemon RPC surface", async () => {
		const result = await router.handle("semantic.reembed_curated", {
			ids: "daily_summary:2026-02-10",
			candidateLimit: 10,
			resyncRemote: false,
		}, {});

		expect(repairSelectiveReembedding).toHaveBeenCalledWith(expect.objectContaining({
			ids: ["daily_summary:2026-02-10"],
			candidateLimit: 10,
			resyncRemote: false,
		}));
		expect(result).toEqual(expect.objectContaining({
			reembedded: 1,
			remoteSynced: 0,
		}));
	});
});
