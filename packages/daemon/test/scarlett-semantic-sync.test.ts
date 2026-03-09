import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as scarlettProbes from "../src/scarlett-probes.js";

const mockedSync = vi.hoisted(() => ({
	inspectConsolidationVectorSync: vi.fn(),
	repairConsolidationVectorSync: vi.fn(),
	inspectRemoteSemanticSync: vi.fn(),
	syncRemoteSemanticMirror: vi.fn(),
}));

describe("SemanticSyncProbe", () => {
	beforeEach(() => {
		mockedSync.inspectConsolidationVectorSync.mockReset();
		mockedSync.repairConsolidationVectorSync.mockReset();
		mockedSync.inspectRemoteSemanticSync.mockReset();
		mockedSync.syncRemoteSemanticMirror.mockReset();
		scarlettProbes._setSemanticSyncApiLoaderForTests(async () => ({
			inspectConsolidationVectorSync: mockedSync.inspectConsolidationVectorSync,
			repairConsolidationVectorSync: mockedSync.repairConsolidationVectorSync,
			inspectRemoteSemanticSync: mockedSync.inspectRemoteSemanticSync,
			syncRemoteSemanticMirror: mockedSync.syncRemoteSemanticMirror,
		} as Awaited<ReturnType<typeof scarlettProbes.loadSemanticSyncApi>>));
	});

	afterEach(() => {
		scarlettProbes._setSemanticSyncApiLoaderForTests();
	});

	it("returns ok when no curated artifacts exist yet", async () => {
		mockedSync.inspectConsolidationVectorSync.mockResolvedValue({
			scanned: 0,
			missingCount: 0,
			driftCount: 0,
			issues: [],
		});
		mockedSync.inspectRemoteSemanticSync.mockResolvedValue({
			enabled: false,
			provider: "disabled",
			configured: false,
			scanned: 0,
			syncedCount: 0,
			missingCount: 0,
			driftCount: 0,
			lastSyncAt: null,
			lastError: null,
			issues: [],
		});

		const probe = new scarlettProbes.SemanticSyncProbe();
		const result = await probe.check();
		expect(result.healthy).toBe(true);
		expect(result.severity).toBe("ok");
		expect(result.summary).toContain("no curated consolidation artifacts");
	});

	it("returns warn when the semantic mirror is missing or stale", async () => {
		mockedSync.inspectConsolidationVectorSync.mockResolvedValue({
			scanned: 3,
			missingCount: 1,
			driftCount: 1,
			issues: [
				{ id: "daily_summary:2026-02-10", level: "daily", period: "2026-02-10", reason: "missing_vector" },
				{ id: "monthly_summary:2026-02", level: "monthly", period: "2026-02", project: "/proj", reason: "stale_hash" },
				],
		});
		mockedSync.inspectRemoteSemanticSync.mockResolvedValue({
			enabled: true,
			provider: "qdrant",
			configured: true,
			scanned: 3,
			syncedCount: 1,
			missingCount: 1,
			driftCount: 0,
			lastSyncAt: null,
			lastError: null,
			remoteHealth: { ok: true },
			issues: [
				{ id: "daily_summary:2026-02-10", level: "daily", period: "2026-02-10", reason: "missing_remote" },
			],
		});

		const probe = new scarlettProbes.SemanticSyncProbe();
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("warn");
		expect(result.recoveryAction).toBe("semantic-reindex");
		expect(result.summary).toContain("local 1 missing");
		expect(result.summary).toContain("remote 1 missing");
	});

	it("returns critical when semantic drift is widespread", async () => {
		mockedSync.inspectConsolidationVectorSync.mockResolvedValue({
			scanned: 6,
			missingCount: 2,
			driftCount: 2,
			issues: [],
		});
		mockedSync.inspectRemoteSemanticSync.mockResolvedValue({
			enabled: true,
			provider: "qdrant",
			configured: true,
			scanned: 6,
			syncedCount: 6,
			missingCount: 0,
			driftCount: 0,
			lastSyncAt: null,
			lastError: null,
			remoteHealth: { ok: false, error: "timeout" },
			issues: [],
		});

		const probe = new scarlettProbes.SemanticSyncProbe();
		const result = await probe.check();
		expect(result.healthy).toBe(false);
		expect(result.severity).toBe("critical");
	});

	it("repair reindexes stale semantic artifacts", async () => {
		mockedSync.repairConsolidationVectorSync.mockResolvedValue({
			status: { scanned: 2, missingCount: 1, driftCount: 1, issues: [] },
			reindexed: 2,
		});
		mockedSync.syncRemoteSemanticMirror.mockResolvedValue({
			synced: 2,
			status: {
				enabled: true,
				provider: "qdrant",
				configured: true,
				scanned: 2,
				syncedCount: 2,
				missingCount: 0,
				driftCount: 0,
				lastSyncAt: null,
				lastError: null,
				issues: [],
			},
		});

		const probe = new scarlettProbes.SemanticSyncProbe();
		const recovery = await probe.recover({
			healthy: false,
			severity: "warn",
			probe: "semantic-sync",
			details: {},
			summary: "Semantic mirror drift",
			recoveryAction: "semantic-reindex",
		});
		expect(recovery.ok).toBe(true);
		expect(recovery.detail).toContain("Reindexed 2");
		expect(recovery.detail).toContain("mirrored 2");
	});
});
