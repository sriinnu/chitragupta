import {
	createOllamaEmbeddings,
	createOnnxEmbeddings,
	createOpenAIEmbeddings,
	type EmbeddingProvider,
} from "@chitragupta/swara";
import { EmbeddingService } from "./embedding-service.js";

let resolvedEmbeddingProviderPromise: Promise<EmbeddingProvider | undefined> | null = null;
let globalEmbeddingServicePromise: Promise<EmbeddingService> | null = null;

type EmbeddingProviderFactory = {
	id: "ollama" | "openai" | "onnx";
	create: () => EmbeddingProvider;
};

async function probeProvider(
	factory: () => EmbeddingProvider,
): Promise<EmbeddingProvider | undefined> {
	try {
		const provider = factory();
		return (await provider.isConfigured()) ? provider : undefined;
	} catch {
		return undefined;
	}
}

function providerFactories(): EmbeddingProviderFactory[] {
	return [
		{ id: "ollama", create: () => createOllamaEmbeddings() },
		{ id: "openai", create: () => createOpenAIEmbeddings() },
		{ id: "onnx", create: () => createOnnxEmbeddings() },
	];
}

function preferredEmbeddingProviderId(): EmbeddingProviderFactory["id"] | null {
	const raw = process.env.CHITRAGUPTA_EMBEDDING_PROVIDER?.trim().toLowerCase();
	switch (raw) {
		case "ollama":
		case "openai":
		case "onnx":
			return raw;
		default:
			return null;
	}
}

function orderedProviderFactories(): EmbeddingProviderFactory[] {
	const preferred = preferredEmbeddingProviderId();
	if (!preferred) return providerFactories();
	const ordered = providerFactories();
	ordered.sort((left, right) => {
		if (left.id === preferred) return -1;
		if (right.id === preferred) return 1;
		return 0;
	});
	return ordered;
}

/**
 * Resolve the canonical embedding provider for engine-owned semantic work.
 *
 * I keep this local to Smriti so daemon-side semantic repair, indexing, and
 * remote mirroring all agree on one provider-resolution rule without creating
 * a CLI -> daemon dependency. Operators can pin the preferred embedding lane
 * with `CHITRAGUPTA_EMBEDDING_PROVIDER`, but if that lane is unavailable I
 * still fall back through the canonical order.
 */
export async function resolveEngineEmbeddingProvider(): Promise<EmbeddingProvider | undefined> {
	if (!resolvedEmbeddingProviderPromise) {
		resolvedEmbeddingProviderPromise = (async () => {
			const providers = await Promise.all(
				orderedProviderFactories().map((factory) => probeProvider(factory.create)),
			);
			return providers.find((provider): provider is EmbeddingProvider => provider !== undefined);
		})();
	}
	return resolvedEmbeddingProviderPromise;
}

/**
 * Return the canonical embedding service for the curated semantic layer.
 */
export async function getEngineEmbeddingService(): Promise<EmbeddingService> {
	if (!globalEmbeddingServicePromise) {
		globalEmbeddingServicePromise = resolveEngineEmbeddingProvider().then(
			(provider) => new EmbeddingService(provider),
		);
	}
	return globalEmbeddingServicePromise;
}

/**
 * Reset global embedding-runtime caches for tests.
 */
export function _resetEngineEmbeddingRuntimeForTests(): void {
	resolvedEmbeddingProviderPromise = null;
	globalEmbeddingServicePromise = null;
}
