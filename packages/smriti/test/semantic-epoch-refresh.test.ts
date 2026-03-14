import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEMANTIC_EMBEDDING_POLICY_VERSION } from "../src/embedding-epoch.js";

const mockedCore = vi.hoisted(() => {
	let home = "/tmp/chitragupta-semantic-epoch-refresh";
	return {
		getChitraguptaHome: () => home,
		setChitraguptaHome: (value: string) => { home = value; },
		loadGlobalSettings: () => ({
			remoteSemantic: {
				enabled: true,
				provider: "qdrant",
				url: "http://qdrant.test",
				collection: "chitragupta_memory",
			},
		}),
	};
});

const mockedEmbeddingEpoch = vi.hoisted(() => ({
	current: {
		providerId: "provider-a",
		modelId: "model-a",
		dimensions: 1536,
		strategy: "provider" as const,
		epoch: "",
	},
}));

function epoch(providerId: string, modelId: string, dimensions: number): string {
	return `${providerId}:${modelId}:${dimensions}:provider:${SEMANTIC_EMBEDDING_POLICY_VERSION}`;
}

const repairSelectiveReembedding = vi.fn(async () => ({
	plan: { scanned: 8, candidateCount: 3, candidates: [] },
	reembedded: 3,
	remoteSynced: 3,
	qualityDeferred: 0,
}));
const planSelectiveReembedding = vi.fn(async () => ({
	scanned: 0,
	candidateCount: 0,
	candidates: [],
}));

vi.mock("@chitragupta/core", () => mockedCore);
vi.mock("../src/embedding-service.js", () => ({
	EmbeddingService: class {
		async getEmbeddingEpoch() {
			return mockedEmbeddingEpoch.current;
		}
	},
}));
vi.mock("../src/selective-reembedding.js", () => ({
	repairSelectiveReembedding,
	planSelectiveReembedding,
}));
vi.mock("@chitragupta/swara", () => ({
	createOllamaEmbeddings: () => ({
		id: "provider-a",
		models: [{ id: "model-a" }],
		isConfigured: async () => true,
		embed: async () => ({
			embedding: [0.1, 0.2, 0.3],
			model: mockedEmbeddingEpoch.current.modelId,
			tokens: 1,
		}),
	}),
	createOpenAIEmbeddings: () => ({
		id: "openai",
		models: [{ id: "text-embedding-3-small" }],
		isConfigured: async () => false,
		embed: async () => ({
			embedding: [0.1, 0.2, 0.3],
			model: "text-embedding-3-small",
			tokens: 1,
		}),
	}),
	createOnnxEmbeddings: () => ({
		id: "onnx",
		models: [{ id: "all-MiniLM-L6-v2" }],
		isConfigured: async () => false,
		embed: async () => ({
			embedding: [0.1, 0.2, 0.3],
			model: "all-MiniLM-L6-v2",
			tokens: 1,
		}),
	}),
}));

describe("semantic epoch refresh", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chitragupta-semantic-epoch-"));
		mockedCore.setChitraguptaHome(tmpDir);
		mockedEmbeddingEpoch.current = {
			providerId: "provider-a",
			modelId: "model-a",
			dimensions: 1536,
			strategy: "provider",
			epoch: epoch("provider-a", "model-a", 1536),
		};
		repairSelectiveReembedding.mockClear();
		planSelectiveReembedding.mockClear();
		const { DatabaseManager } = await import("../src/db/database.js");
		const { _resetDbInit } = await import("../src/session-db.js");
		const { _resetEngineEmbeddingRuntimeForTests } = await import("../src/embedding-runtime.js");
		const { _resetSemanticEpochRefreshStateForTests } = await import("../src/semantic-epoch-refresh.js");
		DatabaseManager.reset();
		_resetDbInit();
		_resetEngineEmbeddingRuntimeForTests();
		_resetSemanticEpochRefreshStateForTests();
	});

	afterEach(async () => {
		const { DatabaseManager } = await import("../src/db/database.js");
		const { _resetDbInit } = await import("../src/session-db.js");
		const { _resetEngineEmbeddingRuntimeForTests } = await import("../src/embedding-runtime.js");
		const { _resetSemanticEpochRefreshStateForTests } = await import("../src/semantic-epoch-refresh.js");
		DatabaseManager.reset();
		_resetDbInit();
		_resetEngineEmbeddingRuntimeForTests();
		_resetSemanticEpochRefreshStateForTests();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("bootstraps state and repairs the curated semantic mirror on first run", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");

		const result = await refreshGlobalSemanticEpochDrift();

		expect(repairSelectiveReembedding).toHaveBeenCalledWith({
			scanAll: true,
			reasons: [
				"missing_vector",
				"legacy_vector",
				"stale_hash",
				"stale_epoch",
				"stale_remote_epoch",
				"missing_remote",
				"stale_remote",
				"remote_error",
			],
			resyncRemote: true,
			minMdlScore: 0,
			minSourceSessionCount: 0,
			minPriorityScore: 0,
		});
		expect(result.reason).toBe("bootstrap");
		expect(result.completed).toBe(true);
		expect(result.freshnessCompleted).toBe(true);
		expect(result.refreshed).toBe(true);
		expect(result.qualityDebtCount).toBe(0);

		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string } | undefined;
		expect(row).toBeDefined();
		const parsed = JSON.parse(String(row?.value_json)) as {
			currentEpoch: string;
			previousEpoch: string | null;
			lastRepair: { reembedded: number; remoteSynced: number };
		};
		expect(parsed.currentEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(parsed.previousEpoch).toBeNull();
		expect(parsed.lastRepair.reembedded).toBe(3);
		expect(parsed.lastRepair.remoteSynced).toBe(3);
	});

	it("returns unchanged without a repair when the epoch has not drifted", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();
		planSelectiveReembedding.mockClear();

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.reason).toBe("unchanged");
		expect(result.refreshed).toBe(false);
		expect(repairSelectiveReembedding).not.toHaveBeenCalled();
		expect(planSelectiveReembedding).not.toHaveBeenCalled();
	});

	it("repairs discovered quality debt even when the embedding epoch is unchanged", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();
		planSelectiveReembedding.mockClear();

		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			lastAttemptEpoch: string;
			lastAttemptAt: number;
			lastAttemptStatus: string;
			previousEpoch: string | null;
			lastRepair: { qualityDeferred: number };
		};
		parsed.lastAttemptAt -= (31 * 60 * 1000);
		parsed.lastAttemptStatus = "success";
		parsed.lastRepair.qualityDeferred = 0;
		getAgentDb()
			.prepare("UPDATE semantic_runtime_state SET value_json = ?, updated_at = ? WHERE name = ?")
			.run(JSON.stringify(parsed), Date.now(), "curated_embedding_epoch");

		planSelectiveReembedding
			.mockResolvedValueOnce({
				scanned: 4,
				candidateCount: 2,
				candidates: [{ id: "quality-1" }, { id: "quality-2" }],
			})
			.mockResolvedValueOnce({
				scanned: 4,
				candidateCount: 0,
				candidates: [],
			});
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 4, candidateCount: 2, candidates: [] },
			reembedded: 2,
			remoteSynced: 2,
			qualityDeferred: 0,
		});

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.reason).toBe("quality-debt");
		expect(result.completed).toBe(true);
		expect(result.freshnessCompleted).toBe(true);
		expect(result.refreshed).toBe(true);
		expect(result.qualityDebtCount).toBe(0);
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(1);
		expect(planSelectiveReembedding).toHaveBeenCalledTimes(2);
	});

	it("reuses the active research refinement budget for same-epoch quality-debt repair", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");
		const { upsertResearchRefinementBudget } = await import("../src/research-refinement-budget.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();
		planSelectiveReembedding.mockClear();
		upsertResearchRefinementBudget({
			refinement: {
				dailyCandidateLimit: 11,
				projectCandidateLimit: 7,
				dailyMinMdlScore: 0.44,
				projectMinMdlScore: 0.58,
				dailyMinPriorityScore: 1.05,
				projectMinPriorityScore: 1.6,
				dailyMinSourceSessionCount: 1,
				projectMinSourceSessionCount: 2,
			},
			source: "test",
		});

		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			lastAttemptEpoch: string;
			lastAttemptAt: number;
			lastAttemptStatus: string;
			previousEpoch: string | null;
			lastRepair: { qualityDeferred: number };
		};
		parsed.lastAttemptAt -= (31 * 60 * 1000);
		parsed.lastAttemptStatus = "success";
		parsed.lastRepair.qualityDeferred = 5;
		getAgentDb()
			.prepare("UPDATE semantic_runtime_state SET value_json = ?, updated_at = ? WHERE name = ?")
			.run(JSON.stringify(parsed), Date.now(), "curated_embedding_epoch");

		planSelectiveReembedding
			.mockResolvedValueOnce({
				scanned: 12,
				candidateCount: 1,
				candidates: [{ id: "quality-1" }],
			})
			.mockResolvedValueOnce({
				scanned: 12,
				candidateCount: 0,
				candidates: [],
			});
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 12, candidateCount: 1, candidates: [] },
			reembedded: 1,
			remoteSynced: 1,
			qualityDeferred: 0,
		});

		await refreshGlobalSemanticEpochDrift();

		expect(repairSelectiveReembedding).toHaveBeenCalledWith({
			scanAll: true,
			candidateLimit: 23,
			reasons: ["low_mdl", "low_retention", "low_reduction", "rejected_packed", "stale_remote_quality"],
			resyncRemote: true,
			minMdlScore: 0.45,
			minSourceSessionCount: 1,
			minPriorityScore: 0.85,
		});
	});

	it("forces a full repair even when the epoch is unchanged", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();
		planSelectiveReembedding.mockClear();

		const result = await refreshGlobalSemanticEpochDrift({ force: true });

		expect(result.reason).toBe("forced");
		expect(result.completed).toBe(true);
		expect(result.freshnessCompleted).toBe(true);
		expect(result.refreshed).toBe(true);
		expect(result.qualityDebtCount).toBe(0);
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(1);
		expect(planSelectiveReembedding).toHaveBeenCalledTimes(2);
	});

	it("repairs when the embedding epoch changes", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();
		planSelectiveReembedding.mockClear();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: epoch("provider-b", "model-b", 3072),
		};

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.reason).toBe("epoch-changed");
		expect(result.completed).toBe(true);
		expect(result.freshnessCompleted).toBe(true);
		expect(result.previousEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(result.currentEpoch).toBe(epoch("provider-b", "model-b", 3072));
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(1);
		expect(planSelectiveReembedding).toHaveBeenCalledTimes(2);
	});

	it("does not advance the healed epoch when the repair is partial", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");

		await refreshGlobalSemanticEpochDrift();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: epoch("provider-b", "model-b", 3072),
		};
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 10, candidateCount: 3, candidates: [] },
			reembedded: 2,
			remoteSynced: 1,
			qualityDeferred: 0,
		});
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 2,
			candidateCount: 2,
			candidates: [
				{ id: "day-1" },
				{ id: "day-2" },
			],
		});
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 0,
			candidateCount: 0,
			candidates: [],
		});

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.completed).toBe(false);
		expect(result.freshnessCompleted).toBe(false);
		expect(result.qualityDebtCount).toBe(0);
		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			lastAttemptEpoch: string;
			lastAttemptStatus: string;
		};
		expect(parsed.currentEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(parsed.lastAttemptEpoch).toBe(epoch("provider-b", "model-b", 3072));
		expect(parsed.lastAttemptStatus).toBe("partial");
	});

	it("advances the healed epoch when only quality-deferred artifacts remain", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");

		await refreshGlobalSemanticEpochDrift();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: epoch("provider-b", "model-b", 3072),
		};
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 10, candidateCount: 3, candidates: [] },
			reembedded: 2,
			remoteSynced: 0,
			qualityDeferred: 2,
		});
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 0,
			candidateCount: 0,
			candidates: [],
		});
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 0,
			candidateCount: 2,
			candidates: [{ id: "quality-1" }, { id: "quality-2" }],
		});

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.completed).toBe(true);
		expect(result.freshnessCompleted).toBe(true);
		expect(result.qualityDebtCount).toBe(2);
		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			lastAttemptStatus: string;
		};
		expect(parsed.currentEpoch).toBe(epoch("provider-b", "model-b", 3072));
		expect(parsed.lastAttemptStatus).toBe("success");
	});

	it("backs off repeated partial retries for the same epoch", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: epoch("provider-b", "model-b", 3072),
		};
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 10, candidateCount: 3, candidates: [] },
			reembedded: 1,
			remoteSynced: 1,
			qualityDeferred: 1,
		});
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 1,
			candidateCount: 1,
			candidates: [{ id: "still-stale" }],
		});
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 1,
			candidateCount: 1,
			candidates: [{ id: "quality-debt" }],
		});

		const first = await refreshGlobalSemanticEpochDrift();
		const second = await refreshGlobalSemanticEpochDrift();

		expect(first.completed).toBe(false);
		expect(first.freshnessCompleted).toBe(false);
		expect(second.reason).toBe("retry-backoff");
		expect(second.refreshed).toBe(false);
		expect(second.freshnessCompleted).toBe(false);
		expect(second.qualityDebtCount).toBe(1);
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(2);
	});

	it("coalesces concurrent refresh requests into one repair pass", async () => {
		let releaseRepair: (() => void) | null = null;
		repairSelectiveReembedding.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseRepair = () =>
						resolve({
							plan: { scanned: 8, candidateCount: 3, candidates: [] },
							reembedded: 3,
							remoteSynced: 3,
							qualityDeferred: 0,
						});
				}),
		);
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");
		const [firstPromise, secondPromise] = [
			refreshGlobalSemanticEpochDrift({ force: true }),
			refreshGlobalSemanticEpochDrift({ force: true }),
		];
		await vi.waitFor(() => {
			expect(repairSelectiveReembedding).toHaveBeenCalledTimes(1);
		});
		releaseRepair?.();
		const [first, second] = await Promise.all([firstPromise, secondPromise]);
		expect(first.currentEpoch).toBe(second.currentEpoch);
		expect(first.completed).toBe(true);
		expect(second.completed).toBe(true);
		expect(first.freshnessCompleted).toBe(true);
		expect(second.freshnessCompleted).toBe(true);
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(1);
	});

	it("reports degraded persisted runtime state instead of pretending it is healthy", async () => {
		const { getAgentDb } = await import("../src/session-db.js");
		const { getSemanticEpochRefreshStatus } = await import("../src/semantic-epoch-refresh.js");

		getAgentDb()
			.prepare(`
				INSERT INTO semantic_runtime_state (name, value_json, updated_at)
				VALUES (?, ?, ?)
				ON CONFLICT(name) DO UPDATE SET
					value_json = excluded.value_json,
					updated_at = excluded.updated_at
			`)
			.run("curated_embedding_epoch", "{not-valid-json", Date.now());

		const status = await getSemanticEpochRefreshStatus();

		expect(status.persistedStateValid).toBe(false);
		expect(status.degradedReason).toContain("JSON");
		expect(status.lastAttemptStatus).toBe("partial");
		expect(status.lastRepair).toEqual(expect.objectContaining({
			reembedded: 0,
			remoteSynced: 0,
			qualityDeferred: 0,
		}));
	});

	it("treats remote-only drift as blocking for epoch convergence", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");

		await refreshGlobalSemanticEpochDrift();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: epoch("provider-b", "model-b", 3072),
		};
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 4, candidateCount: 1, candidates: [] },
			reembedded: 1,
			remoteSynced: 0,
			qualityDeferred: 0,
		});
		planSelectiveReembedding.mockImplementationOnce(async (options?: { reasons?: string[] }) => ({
			scanned: 1,
			candidateCount: options?.reasons?.includes("stale_remote_epoch") ? 1 : 0,
			candidates: options?.reasons?.includes("stale_remote_epoch")
				? [{ id: "remote-only", localReasons: [], remoteReasons: ["stale_remote_epoch"] }]
				: [],
		}));

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.completed).toBe(false);
		expect(result.freshnessCompleted).toBe(false);
		expect(result.currentEpoch).toBe(epoch("provider-b", "model-b", 3072));
		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			lastAttemptEpoch: string;
			lastAttemptStatus: string;
		};
		expect(parsed.currentEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(parsed.lastAttemptEpoch).toBe(epoch("provider-b", "model-b", 3072));
		expect(parsed.lastAttemptStatus).toBe("partial");
	});

	it("persists manual repair state for daemon-visible epoch healing", async () => {
		const { refreshGlobalSemanticEpochDrift, persistSemanticEpochRepairState } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");

		await refreshGlobalSemanticEpochDrift();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: epoch("provider-b", "model-b", 3072),
		};
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 0,
			candidateCount: 0,
			candidates: [],
		});

		const result = await persistSemanticEpochRepairState({
			plan: { scanned: 5, candidateCount: 2, candidates: [] },
			reembedded: 2,
			remoteSynced: 2,
			qualityDeferred: 0,
		});

		expect(result.completed).toBe(true);
		expect(result.freshnessCompleted).toBe(true);
		expect(result.previousEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(result.currentEpoch).toBe(epoch("provider-b", "model-b", 3072));

		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			previousEpoch: string | null;
			lastAttemptStatus: string;
			lastRepair: { reembedded: number; remoteSynced: number };
		};
		expect(parsed.currentEpoch).toBe(epoch("provider-b", "model-b", 3072));
		expect(parsed.previousEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(parsed.lastAttemptStatus).toBe("success");
		expect(parsed.lastRepair).toEqual(expect.objectContaining({ reembedded: 2, remoteSynced: 2 }));
	});

	it("preserves the last healed epoch when a manual repair remains partial", async () => {
		const { refreshGlobalSemanticEpochDrift, persistSemanticEpochRepairState } = await import("../src/semantic-epoch-refresh.js");
		const { getAgentDb } = await import("../src/session-db.js");

		await refreshGlobalSemanticEpochDrift();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: epoch("provider-b", "model-b", 3072),
		};
		planSelectiveReembedding.mockResolvedValueOnce({
			scanned: 2,
			candidateCount: 1,
			candidates: [{ id: "day-1" }],
		});

		const result = await persistSemanticEpochRepairState({
			plan: { scanned: 5, candidateCount: 1, candidates: [] },
			reembedded: 1,
			remoteSynced: 0,
			qualityDeferred: 1,
		});

		expect(result.completed).toBe(false);
		expect(result.freshnessCompleted).toBe(false);
		expect(result.previousEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(result.currentEpoch).toBe(epoch("provider-b", "model-b", 3072));

		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			previousEpoch: string | null;
			lastAttemptStatus: string;
		};
		expect(parsed.currentEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(parsed.previousEpoch).toBe(epoch("provider-a", "model-a", 1536));
		expect(parsed.lastAttemptStatus).toBe("partial");
	});
});
