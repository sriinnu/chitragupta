import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({
	ollamaConfigured: true,
	openaiConfigured: true,
	onnxConfigured: true,
}));

vi.mock("@chitragupta/swara", () => ({
	createOllamaEmbeddings: () => ({
		id: "ollama",
		models: [{ id: "nomic-embed-text" }],
		isConfigured: async () => providerState.ollamaConfigured,
		embed: async () => ({ embedding: [0.1, 0.2, 0.3], model: "nomic-embed-text", tokens: 1 }),
	}),
	createOpenAIEmbeddings: () => ({
		id: "openai",
		models: [{ id: "text-embedding-3-small" }],
		isConfigured: async () => providerState.openaiConfigured,
		embed: async () => ({ embedding: [0.1, 0.2, 0.3], model: "text-embedding-3-small", tokens: 1 }),
	}),
	createOnnxEmbeddings: () => ({
		id: "onnx",
		models: [{ id: "all-MiniLM-L6-v2" }],
		isConfigured: async () => providerState.onnxConfigured,
		embed: async () => ({ embedding: [0.1, 0.2, 0.3], model: "all-MiniLM-L6-v2", tokens: 1 }),
	}),
}));

describe("embedding-runtime", () => {
	beforeEach(() => {
		providerState.ollamaConfigured = true;
		providerState.openaiConfigured = true;
		providerState.onnxConfigured = true;
		delete process.env.CHITRAGUPTA_EMBEDDING_PROVIDER;
	});

	afterEach(async () => {
		const mod = await import("../src/embedding-runtime.js");
		mod._resetEngineEmbeddingRuntimeForTests();
		delete process.env.CHITRAGUPTA_EMBEDDING_PROVIDER;
	});

	it("prefers the configured operator-selected embedding provider", async () => {
		process.env.CHITRAGUPTA_EMBEDDING_PROVIDER = "openai";
		const mod = await import("../src/embedding-runtime.js");

		const provider = await mod.resolveEngineEmbeddingProvider();

		expect(provider?.id).toBe("openai");
	});

	it("falls back through the canonical order when the preferred provider is unavailable", async () => {
		process.env.CHITRAGUPTA_EMBEDDING_PROVIDER = "openai";
		providerState.openaiConfigured = false;
		const mod = await import("../src/embedding-runtime.js");

		const provider = await mod.resolveEngineEmbeddingProvider();

		expect(provider?.id).toBe("ollama");
	});
});
