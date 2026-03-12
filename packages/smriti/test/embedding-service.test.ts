import { describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "@chitragupta/swara";
import {
	EmbeddingService,
} from "../src/embedding-service.js";
import {
	buildEmbeddingEpoch,
	parseEmbeddingEpoch,
	UNKNOWN_EMBEDDING_MODEL_ID,
	UNKNOWN_EMBEDDING_PROVIDER_ID,
} from "../src/embedding-epoch.js";

describe("EmbeddingService", () => {
	it("resolves embedding epochs from the actual embed result, not provider.models[0]", async () => {
		const provider: EmbeddingProvider = {
			id: "mock-provider",
			models: [
				{ id: "catalog-model", name: "Catalog Model", dimensions: 128, maxTokens: 8192 },
			],
			embed: async () => ({
				embedding: [0.1, 0.2, 0.3, 0.4],
				model: "runtime-model",
				tokens: 4,
			}),
			embedBatch: async () => [],
			isConfigured: async () => true,
		};
		const service = new EmbeddingService(provider);

		const epoch = await service.getEmbeddingEpoch();

		expect(epoch).toEqual(buildEmbeddingEpoch({
			providerId: "mock-provider",
			modelId: "runtime-model",
			dimensions: 4,
			strategy: "provider",
		}));
	});

	it("invalidates cached epoch state when the provider catalog changes", async () => {
		const provider: EmbeddingProvider = {
			id: "mock-provider",
			models: [
				{ id: "catalog-model-a", name: "Catalog Model A", dimensions: 4, maxTokens: 8192 },
			],
			embed: async () => ({
				embedding: [0.1, 0.2, 0.3, 0.4],
				model: provider.models[0]?.id ?? "missing",
				tokens: 4,
			}),
			embedBatch: async () => [],
			isConfigured: async () => true,
		};
		const service = new EmbeddingService(provider);

		const initial = await service.getEmbeddingEpoch();
		expect(initial.modelId).toBe("catalog-model-a");

		provider.models = [
			{ id: "catalog-model-b", name: "Catalog Model B", dimensions: 6, maxTokens: 8192 },
		];
		provider.embed = async () => ({
			embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
			model: "catalog-model-b",
			tokens: 6,
		});

		const refreshed = await service.getEmbeddingEpoch();
		expect(refreshed.modelId).toBe("catalog-model-b");
		expect(refreshed.dimensions).toBe(6);
	});
});

describe("embedding epochs", () => {
	it("normalizes empty identifiers into stable parseable sentinels", () => {
		const epoch = buildEmbeddingEpoch({
			providerId: "   ",
			modelId: " ",
			dimensions: 0,
			strategy: "provider",
		});

		expect(epoch.providerId).toBe(UNKNOWN_EMBEDDING_PROVIDER_ID);
		expect(epoch.modelId).toBe(UNKNOWN_EMBEDDING_MODEL_ID);
		expect(epoch.dimensions).toBe(1);
		expect(parseEmbeddingEpoch(epoch)).toEqual(epoch);
	});
});
