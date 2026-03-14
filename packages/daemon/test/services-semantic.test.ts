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
const persistSemanticEpochRepairState = vi.fn(async () => ({
	currentEpoch: "epoch:provider:model:v2",
	previousEpoch: "epoch:provider:model:v1",
	reason: "forced",
	completed: true,
	freshnessCompleted: true,
	refreshed: true,
	qualityDebtCount: 0,
	repair: {
		plan: { scanned: 3, candidateCount: 1, candidates: [] },
		reembedded: 1,
		remoteSynced: 0,
		qualityDeferred: 0,
	},
}));
const getSemanticEpochRefreshStatus = vi.fn(async () => ({
	currentEpoch: "epoch:provider:model:v2",
	persistedEpoch: "epoch:provider:model:v1",
	previousEpoch: "epoch:provider:model:v1",
	lastAttemptEpoch: "epoch:provider:model:v2",
	lastAttemptAt: 1_700_000_000_000,
	lastAttemptStatus: "partial",
	inFlight: false,
	lastRepair: {
		plan: { scanned: 10, candidateCount: 2, candidates: [] },
		reembedded: 1,
		remoteSynced: 1,
		qualityDeferred: 1,
	},
}));
const refreshGlobalSemanticEpochDrift = vi.fn(async (_options?: { force?: boolean }) => ({
	currentEpoch: "epoch:provider:model:v2",
	previousEpoch: "epoch:provider:model:v1",
	reason: "forced",
	completed: true,
	refreshed: true,
	repair: {
		plan: { scanned: 10, candidateCount: 2, candidates: [] },
		reembedded: 2,
		remoteSynced: 2,
		qualityDeferred: 0,
	},
}));

vi.mock("@chitragupta/smriti", () => ({
	inspectConsolidationVectorSync,
	inspectRemoteSemanticSync,
	syncRemoteSemanticMirror,
	planSelectiveReembedding,
	repairSelectiveReembedding,
	persistSemanticEpochRepairState,
	getSemanticEpochRefreshStatus,
	refreshGlobalSemanticEpochDrift,
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
		expect(persistSemanticEpochRepairState).toHaveBeenCalledWith(expect.objectContaining({
			reembedded: 1,
			remoteSynced: 0,
		}));
		expect(result).toEqual(expect.objectContaining({
			reembedded: 1,
			remoteSynced: 0,
		}));
	});

	it("routes semantic.sync_curated through selective re-embedding repair", async () => {
		const result = await router.handle("semantic.sync_curated", {
			projects: "/repo/project",
			levels: ["daily"],
		}, {});

		expect(repairSelectiveReembedding).toHaveBeenCalledWith(expect.objectContaining({
			projects: ["/repo/project"],
			levels: ["daily"],
			scanAll: false,
			resyncRemote: true,
		}));
		expect(persistSemanticEpochRepairState).toHaveBeenCalledWith(expect.objectContaining({
			reembedded: 1,
			remoteSynced: 0,
		}));
		expect(result).toEqual(expect.objectContaining({
			repair: expect.objectContaining({
				reembedded: 1,
				remoteSynced: 0,
			}),
			local: expect.any(Object),
			remote: expect.any(Object),
		}));
	});

	it("reports semantic epoch refresh status through the daemon RPC surface", async () => {
		const result = await router.handle("semantic.epoch_status", {}, {});

		expect(getSemanticEpochRefreshStatus).toHaveBeenCalledTimes(1);
		expect(result).toEqual(expect.objectContaining({
			currentEpoch: "epoch:provider:model:v2",
			persistedEpoch: "epoch:provider:model:v1",
			lastAttemptStatus: "partial",
			inFlight: false,
		}));
	});

	it("forces semantic epoch refresh through the daemon RPC surface", async () => {
		const result = await router.handle("semantic.epoch_refresh", { force: true }, {});

		expect(refreshGlobalSemanticEpochDrift).toHaveBeenCalledWith({ force: true });
		expect(result).toEqual(expect.objectContaining({
			currentEpoch: "epoch:provider:model:v2",
			reason: "forced",
			completed: true,
		}));
	});
});
