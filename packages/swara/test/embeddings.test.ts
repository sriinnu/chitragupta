import { describe, it, expect } from "vitest";
import { EMBEDDING_MODELS, createEmbeddingProvider } from "@chitragupta/swara";
import type { EmbeddingProvider, EmbeddingModel } from "@chitragupta/swara";
import { ProviderError } from "@chitragupta/core";

describe("EMBEDDING_MODELS", () => {
	it("is a non-empty array", () => {
		expect(EMBEDDING_MODELS.length).toBeGreaterThan(0);
	});

	it("contains nomic-embed-text with 768 dimensions", () => {
		const model = EMBEDDING_MODELS.find((m: EmbeddingModel) => m.id === "nomic-embed-text");
		expect(model).toBeDefined();
		expect(model!.dimensions).toBe(768);
	});

	it("contains mxbai-embed-large with 1024 dimensions", () => {
		const model = EMBEDDING_MODELS.find((m: EmbeddingModel) => m.id === "mxbai-embed-large");
		expect(model).toBeDefined();
		expect(model!.dimensions).toBe(1024);
	});

	it("contains text-embedding-3-small with 1536 dimensions", () => {
		const model = EMBEDDING_MODELS.find((m: EmbeddingModel) => m.id === "text-embedding-3-small");
		expect(model).toBeDefined();
		expect(model!.dimensions).toBe(1536);
	});

	it("contains text-embedding-3-large with 3072 dimensions", () => {
		const model = EMBEDDING_MODELS.find((m: EmbeddingModel) => m.id === "text-embedding-3-large");
		expect(model).toBeDefined();
		expect(model!.dimensions).toBe(3072);
	});

	it("all models have positive maxTokens", () => {
		for (const model of EMBEDDING_MODELS) {
			expect(model.maxTokens).toBeGreaterThan(0);
		}
	});
});

describe("createEmbeddingProvider", () => {
	it("returns ollama provider with id 'ollama-embeddings'", () => {
		const provider: EmbeddingProvider = createEmbeddingProvider("ollama");
		expect(provider.id).toBe("ollama-embeddings");
	});

	it("returns openai provider with id 'openai-embeddings'", () => {
		const provider: EmbeddingProvider = createEmbeddingProvider("openai");
		expect(provider.id).toBe("openai-embeddings");
	});

	it("both providers have embed and embedBatch methods", () => {
		const ollama = createEmbeddingProvider("ollama");
		const openai = createEmbeddingProvider("openai");
		expect(typeof ollama.embed).toBe("function");
		expect(typeof ollama.embedBatch).toBe("function");
		expect(typeof openai.embed).toBe("function");
		expect(typeof openai.embedBatch).toBe("function");
	});

	it("both providers have an isConfigured method", () => {
		const ollama = createEmbeddingProvider("ollama");
		const openai = createEmbeddingProvider("openai");
		expect(typeof ollama.isConfigured).toBe("function");
		expect(typeof openai.isConfigured).toBe("function");
	});

	it("throws ProviderError for unknown provider type", () => {
		expect(() => {
			// @ts-expect-error testing invalid type
			createEmbeddingProvider("unknown");
		}).toThrow(ProviderError);
	});

	it("provider models array is non-empty", () => {
		const ollama = createEmbeddingProvider("ollama");
		const openai = createEmbeddingProvider("openai");
		expect(ollama.models.length).toBeGreaterThan(0);
		expect(openai.models.length).toBeGreaterThan(0);
	});
});
