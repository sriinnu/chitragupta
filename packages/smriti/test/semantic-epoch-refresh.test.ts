import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedCore = vi.hoisted(() => {
	let home = "/tmp/chitragupta-semantic-epoch-refresh";
	return {
		getChitraguptaHome: () => home,
		setChitraguptaHome: (value: string) => { home = value; },
	};
});

const mockedEmbeddingEpoch = vi.hoisted(() => ({
	current: {
		providerId: "provider-a",
		modelId: "model-a",
		dimensions: 1536,
		strategy: "provider" as const,
		epoch: "provider-a:model-a:1536:provider",
	},
}));

const repairSelectiveReembedding = vi.fn(async () => ({
	plan: { scanned: 8, candidateCount: 3, candidates: [] },
	reembedded: 3,
	remoteSynced: 3,
	qualityDeferred: 0,
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
			epoch: "provider-a:model-a:1536:provider",
		};
		repairSelectiveReembedding.mockClear();
		const { DatabaseManager } = await import("../src/db/database.js");
		const { _resetDbInit } = await import("../src/session-db.js");
		const { _resetEngineEmbeddingRuntimeForTests } = await import("../src/embedding-runtime.js");
		DatabaseManager.reset();
		_resetDbInit();
		_resetEngineEmbeddingRuntimeForTests();
	});

	afterEach(async () => {
		const { DatabaseManager } = await import("../src/db/database.js");
		const { _resetDbInit } = await import("../src/session-db.js");
		const { _resetEngineEmbeddingRuntimeForTests } = await import("../src/embedding-runtime.js");
		DatabaseManager.reset();
		_resetDbInit();
		_resetEngineEmbeddingRuntimeForTests();
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
		expect(result.refreshed).toBe(true);

		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string } | undefined;
		expect(row).toBeDefined();
		const parsed = JSON.parse(String(row?.value_json)) as {
			currentEpoch: string;
			previousEpoch: string | null;
			lastRepair: { reembedded: number; remoteSynced: number };
		};
		expect(parsed.currentEpoch).toBe("provider-a:model-a:1536:provider");
		expect(parsed.previousEpoch).toBeNull();
		expect(parsed.lastRepair.reembedded).toBe(3);
		expect(parsed.lastRepair.remoteSynced).toBe(3);
	});

	it("returns unchanged without a repair when the epoch has not drifted", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.reason).toBe("unchanged");
		expect(result.refreshed).toBe(false);
		expect(repairSelectiveReembedding).not.toHaveBeenCalled();
	});

	it("forces a full repair even when the epoch is unchanged", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();

		const result = await refreshGlobalSemanticEpochDrift({ force: true });

		expect(result.reason).toBe("forced");
		expect(result.completed).toBe(true);
		expect(result.refreshed).toBe(true);
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(1);
	});

	it("repairs when the embedding epoch changes", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		repairSelectiveReembedding.mockClear();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: "provider-b:model-b:3072:provider",
		};

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.reason).toBe("epoch-changed");
		expect(result.completed).toBe(true);
		expect(result.previousEpoch).toBe("provider-a:model-a:1536:provider");
		expect(result.currentEpoch).toBe("provider-b:model-b:3072:provider");
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(1);
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
			epoch: "provider-b:model-b:3072:provider",
		};
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 10, candidateCount: 3, candidates: [] },
			reembedded: 2,
			remoteSynced: 1,
			qualityDeferred: 0,
		});

		const result = await refreshGlobalSemanticEpochDrift();

		expect(result.completed).toBe(false);
		const row = getAgentDb()
			.prepare("SELECT value_json FROM semantic_runtime_state WHERE name = ?")
			.get("curated_embedding_epoch") as { value_json: string };
		const parsed = JSON.parse(row.value_json) as {
			currentEpoch: string;
			lastAttemptEpoch: string;
			lastAttemptStatus: string;
		};
		expect(parsed.currentEpoch).toBe("provider-a:model-a:1536:provider");
		expect(parsed.lastAttemptEpoch).toBe("provider-b:model-b:3072:provider");
		expect(parsed.lastAttemptStatus).toBe("partial");
	});

	it("backs off repeated partial retries for the same epoch", async () => {
		const { refreshGlobalSemanticEpochDrift } = await import("../src/semantic-epoch-refresh.js");

		await refreshGlobalSemanticEpochDrift();
		mockedEmbeddingEpoch.current = {
			providerId: "provider-b",
			modelId: "model-b",
			dimensions: 3072,
			strategy: "provider",
			epoch: "provider-b:model-b:3072:provider",
		};
		repairSelectiveReembedding.mockResolvedValueOnce({
			plan: { scanned: 10, candidateCount: 3, candidates: [] },
			reembedded: 1,
			remoteSynced: 1,
			qualityDeferred: 1,
		});

		const first = await refreshGlobalSemanticEpochDrift();
		const second = await refreshGlobalSemanticEpochDrift();

		expect(first.completed).toBe(false);
		expect(second.reason).toBe("retry-backoff");
		expect(second.refreshed).toBe(false);
		expect(repairSelectiveReembedding).toHaveBeenCalledTimes(2);
	});
});
