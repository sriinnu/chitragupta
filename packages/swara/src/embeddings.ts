/**
 * @chitragupta/swara — Embedding provider abstraction.
 *
 * Provides a unified interface for generating text embeddings across
 * multiple backends (Ollama local, OpenAI cloud). Used by the
 * GraphRAG and vector search layers in @chitragupta/smriti.
 */

import { ProviderError } from "@chitragupta/core";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Definition of an embedding model with its dimensional properties. */
export interface EmbeddingModel {
	id: string;
	name: string;
	/** Dimensionality of the output embedding vector. */
	dimensions: number;
	/** Maximum input tokens the model accepts. */
	maxTokens: number;
}

/** Result of a single embedding operation. */
export interface EmbeddingResult {
	embedding: number[];
	model: string;
	tokens: number;
}

/** Unified interface for embedding providers. */
export interface EmbeddingProvider {
	id: string;
	embed(text: string): Promise<EmbeddingResult>;
	embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
	isConfigured(): Promise<boolean>;
	models: EmbeddingModel[];
}

// ─── Known Models ───────────────────────────────────────────────────────────

/** Catalogue of well-known embedding models and their properties. */
export const EMBEDDING_MODELS: readonly EmbeddingModel[] = [
	// ── Local (Ollama) ──
	{ id: "nomic-embed-text", name: "Nomic Embed Text", dimensions: 768, maxTokens: 8192 },
	{ id: "mxbai-embed-large", name: "MxBai Embed Large", dimensions: 1024, maxTokens: 512 },
	{ id: "bge-m3", name: "BGE-M3 (BAAI)", dimensions: 1024, maxTokens: 8192 },
	// ── Cloud (OpenAI) ──
	{ id: "text-embedding-3-small", name: "OpenAI Embed Small", dimensions: 1536, maxTokens: 8191 },
	{ id: "text-embedding-3-large", name: "OpenAI Embed Large", dimensions: 3072, maxTokens: 8191 },
] as const;

/** Look up a known embedding model by ID. */
function findModel(id: string): EmbeddingModel | undefined {
	return EMBEDDING_MODELS.find((m) => m.id === id);
}

// ─── Ollama Embeddings ──────────────────────────────────────────────────────

/** Options for the Ollama embedding provider. */
export interface OllamaEmbeddingOptions {
	baseUrl?: string;
	model?: string;
}

/**
 * Create an embedding provider backed by a local Ollama instance.
 *
 * Uses the `/api/embed` endpoint. Falls back to sequential calls
 * for batch operations since Ollama handles array input natively.
 */
export function createOllamaEmbeddings(options?: OllamaEmbeddingOptions): EmbeddingProvider {
	const baseUrl = (options?.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
	const modelId = options?.model ?? "nomic-embed-text";
	const knownModel = findModel(modelId);

	const models: EmbeddingModel[] = [
		knownModel ?? { id: modelId, name: modelId, dimensions: 768, maxTokens: 8192 },
	];

	async function embed(text: string): Promise<EmbeddingResult> {
		const response = await fetch(`${baseUrl}/api/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: modelId, input: text }),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new ProviderError(
				`Ollama embedding error ${response.status}: ${body}`,
				"ollama",
				response.status,
			);
		}

		const data = await response.json() as Record<string, unknown>;
		const embeddings = data.embeddings as number[][] | undefined;

		if (!embeddings || embeddings.length === 0) {
			throw new ProviderError(
				"Ollama returned no embeddings",
				"ollama",
			);
		}

		return {
			embedding: embeddings[0],
			model: modelId,
			tokens: (data.prompt_eval_count as number) ?? 0,
		};
	}

	async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
		// Ollama /api/embed supports array input — try batch first
		const response = await fetch(`${baseUrl}/api/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: modelId, input: texts }),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new ProviderError(
				`Ollama batch embedding error ${response.status}: ${body}`,
				"ollama",
				response.status,
			);
		}

		const data = await response.json() as Record<string, unknown>;
		const embeddings = data.embeddings as number[][] | undefined;

		if (!embeddings || embeddings.length === 0) {
			throw new ProviderError(
				"Ollama returned no embeddings for batch",
				"ollama",
			);
		}

		return embeddings.map((vec) => ({
			embedding: vec,
			model: modelId,
			tokens: 0, // Ollama does not report per-item token counts in batch
		}));
	}

	async function isConfigured(): Promise<boolean> {
		try {
			const response = await fetch(`${baseUrl}/api/tags`);
			return response.ok;
		} catch {
			return false;
		}
	}

	return { id: "ollama-embeddings", embed, embedBatch, isConfigured, models };
}

// ─── OpenAI Embeddings ──────────────────────────────────────────────────────

/** Options for the OpenAI embedding provider. */
export interface OpenAIEmbeddingOptions {
	apiKey?: string;
	baseUrl?: string;
	model?: string;
}

/**
 * Create an embedding provider backed by the OpenAI Embeddings API.
 *
 * Supports true batch embedding via the `input: string[]` parameter.
 * Also works with any OpenAI-compatible embedding endpoint.
 */
export function createOpenAIEmbeddings(options?: OpenAIEmbeddingOptions): EmbeddingProvider {
	const baseUrl = (options?.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
	const modelId = options?.model ?? "text-embedding-3-small";
	const knownModel = findModel(modelId);

	const models: EmbeddingModel[] = [
		knownModel ?? { id: modelId, name: modelId, dimensions: 1536, maxTokens: 8191 },
	];

	function getApiKey(): string {
		const key = options?.apiKey ?? process.env.OPENAI_API_KEY;
		if (!key) {
			throw new ProviderError(
				"OPENAI_API_KEY is not set and no apiKey was provided",
				"openai",
			);
		}
		return key;
	}

	async function callEmbeddings(input: string | string[]): Promise<Record<string, unknown>> {
		const apiKey = getApiKey();
		const response = await fetch(`${baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ model: modelId, input }),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new ProviderError(
				`OpenAI embedding error ${response.status}: ${body}`,
				"openai",
				response.status,
			);
		}

		return await response.json() as Record<string, unknown>;
	}

	async function embed(text: string): Promise<EmbeddingResult> {
		const data = await callEmbeddings(text);
		const items = data.data as Array<{ embedding: number[]; index: number }> | undefined;
		const usage = data.usage as { prompt_tokens?: number; total_tokens?: number } | undefined;

		if (!items || items.length === 0) {
			throw new ProviderError("OpenAI returned no embedding data", "openai");
		}

		return {
			embedding: items[0].embedding,
			model: modelId,
			tokens: usage?.prompt_tokens ?? 0,
		};
	}

	async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
		const data = await callEmbeddings(texts);
		const items = data.data as Array<{ embedding: number[]; index: number }> | undefined;
		const usage = data.usage as { prompt_tokens?: number; total_tokens?: number } | undefined;

		if (!items || items.length === 0) {
			throw new ProviderError("OpenAI returned no embedding data for batch", "openai");
		}

		// Sort by index to maintain input order
		const sorted = [...items].sort((a, b) => a.index - b.index);
		const tokensPerItem = Math.floor((usage?.prompt_tokens ?? 0) / texts.length);

		return sorted.map((item) => ({
			embedding: item.embedding,
			model: modelId,
			tokens: tokensPerItem,
		}));
	}

	async function isConfigured(): Promise<boolean> {
		try {
			const key = options?.apiKey ?? process.env.OPENAI_API_KEY;
			return key !== undefined && key.length > 0;
		} catch {
			return false;
		}
	}

	return { id: "openai-embeddings", embed, embedBatch, isConfigured, models };
}

// ─── Factory Dispatcher ─────────────────────────────────────────────────────

/**
 * Create an embedding provider by type.
 *
 * @param type - "ollama" for local Ollama or "openai" for OpenAI-compatible APIs.
 * @param options - Provider-specific options (baseUrl, model, apiKey).
 */
export function createEmbeddingProvider(
	type: "ollama" | "openai",
	options?: OllamaEmbeddingOptions & OpenAIEmbeddingOptions,
): EmbeddingProvider {
	switch (type) {
		case "ollama":
			return createOllamaEmbeddings(options);
		case "openai":
			return createOpenAIEmbeddings(options);
		default:
			throw new ProviderError(
				`Unknown embedding provider type: ${type as string}`,
				"embeddings",
			);
	}
}
