/**
 * @chitragupta/smriti — Unified embedding service.
 *
 * Wraps an optional EmbeddingProvider from @chitragupta/swara with
 * LRU caching and a deterministic hash-based fallback. Single source
 * of truth for all embedding generation within smriti.
 */

import type { EmbeddingProvider } from "@chitragupta/swara";
import {
	buildEmbeddingEpoch,
	buildFallbackEmbeddingEpoch,
	type EmbeddingEpoch,
	FALLBACK_EMBEDDING_MODEL_ID,
	FALLBACK_EMBEDDING_PROVIDER_ID,
} from "./embedding-epoch.js";

const FALLBACK_DIM = 384;

/** Default maximum cache entries. */
const DEFAULT_MAX_CACHE = 5000;

/** System ceiling for cache size. */
const MAX_CACHE_CEILING = 20_000;

/**
 * FNV-1a 64-bit hash (as two 32-bit halves combined into a hex string).
 * Deterministic, fast, good distribution for cache keys.
 */
function fnv1aHash(text: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193);
		h2 = Math.imul(h2 ^ (c >> 8), 0x01000193);
	}
	return ((h1 >>> 0).toString(16).padStart(8, "0") +
		(h2 >>> 0).toString(16).padStart(8, "0"));
}

/**
 * Hash-based fallback embedding. Produces a 384-dimensional vector.
 * NOT real semantic search, but keeps the system functional without
 * a configured embedding provider.
 */
export function fallbackEmbedding(text: string): number[] {
	const vector = new Array<number>(FALLBACK_DIM).fill(0);
	const lower = text.toLowerCase();

	for (let i = 0; i < lower.length; i++) {
		const code = lower.charCodeAt(i);
		const idx = (code * 7 + i * 13) % FALLBACK_DIM;
		vector[idx] += 1;
	}

	const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
	if (magnitude > 0) {
		for (let i = 0; i < FALLBACK_DIM; i++) {
			vector[i] /= magnitude;
		}
	}

	return vector;
}

export interface EmbeddingVectorRecord {
	embedding: number[];
	model: string;
	providerId: string;
	tokens: number;
	epoch: EmbeddingEpoch;
}

/**
 * LRU cache for embedding vectors.
 * Uses a Map's insertion-order iteration for O(1) eviction of oldest entries.
 * On cache hit, the entry is deleted and re-inserted to move it to the end (most recent).
 */
class LRUCache<K, V> {
	private readonly map = new Map<K, V>();
	private readonly maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	get(key: K): V | undefined {
		const value = this.map.get(key);
		if (value !== undefined) {
			// Move to end (most recently used)
			this.map.delete(key);
			this.map.set(key, value);
		}
		return value;
	}

	set(key: K, value: V): void {
		if (this.map.has(key)) {
			this.map.delete(key);
		} else if (this.map.size >= this.maxSize) {
			// Evict oldest (first key in iteration order)
			const oldest = this.map.keys().next().value;
			if (oldest !== undefined) {
				this.map.delete(oldest);
			}
		}
		this.map.set(key, value);
	}

	get size(): number {
		return this.map.size;
	}

	clear(): void {
		this.map.clear();
	}
}

export class EmbeddingService {
	private provider: EmbeddingProvider | undefined;
	private cache: LRUCache<string, EmbeddingVectorRecord>;
	private providerAvailable: boolean | null = null;
	private lastResolvedEpoch: EmbeddingEpoch | null = null;
	private lastProviderCatalogSignature: string | null = null;

	constructor(provider?: EmbeddingProvider, maxCacheSize?: number) {
		this.provider = provider;
		const bounded = Math.min(maxCacheSize ?? DEFAULT_MAX_CACHE, MAX_CACHE_CEILING);
		this.cache = new LRUCache(bounded);
	}

	async getEmbedding(text: string): Promise<number[]> {
		return (await this.getEmbeddingRecord(text)).embedding;
	}

	async getEmbeddingRecord(text: string): Promise<EmbeddingVectorRecord> {
		this.refreshProviderCatalogState();
		const cacheKey = fnv1aHash(text);
		const cached = this.cache.get(cacheKey);
		if (cached) return cached;

		let record: EmbeddingVectorRecord;

		if (this.provider) {
			if (this.providerAvailable === null) {
				try {
					this.providerAvailable = await this.provider.isConfigured();
				} catch {
					this.providerAvailable = false;
				}
			}

			if (this.providerAvailable) {
				try {
					const result = await this.provider.embed(text);
					record = {
						embedding: result.embedding,
						model: result.model,
						providerId: this.provider.id,
						tokens: result.tokens,
						epoch: buildEmbeddingEpoch({
							providerId: this.provider.id,
							modelId: result.model,
							dimensions: result.embedding.length,
							strategy: "provider",
						}),
					};
					this.lastResolvedEpoch = record.epoch;
				} catch {
					// A transient embed failure should not permanently poison the
					// process into fallback mode. Keep the fallback record honest,
					// but force the next call to re-probe provider availability.
					this.providerAvailable = null;
					record = this.buildFallbackRecord(text, { preserveResolvedEpoch: true });
				}
			} else {
				record = this.buildFallbackRecord(text);
			}
		} else {
			record = this.buildFallbackRecord(text);
		}

		this.cache.set(cacheKey, record);
		return record;
	}

	async getEmbeddingEpoch(): Promise<EmbeddingEpoch> {
		this.refreshProviderCatalogState();
		if (this.lastResolvedEpoch) {
			return this.lastResolvedEpoch;
		}
		if (this.provider) {
			if (this.providerAvailable === null) {
				try {
					this.providerAvailable = await this.provider.isConfigured();
				} catch {
					this.providerAvailable = false;
				}
			}
			if (this.providerAvailable) {
				return this.resolveProviderEpoch();
			}
		}
		return buildFallbackEmbeddingEpoch(FALLBACK_DIM);
	}

	resetAvailability(): void {
		this.providerAvailable = null;
	}

	clearCache(): void {
		this.cache.clear();
		this.lastResolvedEpoch = null;
		this.lastProviderCatalogSignature = null;
	}

	/** Current number of cached embeddings. */
	get cacheSize(): number {
		return this.cache.size;
	}

	private buildFallbackRecord(
		text: string,
		options: { preserveResolvedEpoch?: boolean } = {},
	): EmbeddingVectorRecord {
		const embedding = fallbackEmbedding(text);
		const record = {
			embedding,
			model: FALLBACK_EMBEDDING_MODEL_ID,
			providerId: FALLBACK_EMBEDDING_PROVIDER_ID,
			tokens: 0,
			epoch: buildFallbackEmbeddingEpoch(embedding.length),
		};
		if (options.preserveResolvedEpoch !== true) {
			this.lastResolvedEpoch = record.epoch;
		}
		return record;
	}

	private refreshProviderCatalogState(): void {
		if (!this.provider) return;
		const signature = buildProviderCatalogSignature(this.provider);
		if (this.lastProviderCatalogSignature === null) {
			this.lastProviderCatalogSignature = signature;
			return;
		}
		if (this.lastProviderCatalogSignature !== signature) {
			this.cache.clear();
			this.lastResolvedEpoch = null;
			this.providerAvailable = null;
			this.lastProviderCatalogSignature = signature;
		}
	}

	/**
	 * Resolve the provider epoch from a real embedding call once, then cache it.
	 *
	 * Provider model catalogues are advisory and can drift from the actual model
	 * returned by the backend. A one-time probe keeps stale-epoch detection tied
	 * to the embedding path that is actually serving vectors.
	 */
	private async resolveProviderEpoch(): Promise<EmbeddingEpoch> {
		if (!this.provider) {
			return buildFallbackEmbeddingEpoch(FALLBACK_DIM);
		}
		try {
			const result = await this.provider.embed("__chitragupta_embedding_epoch_probe__");
			const epoch = buildEmbeddingEpoch({
				providerId: this.provider.id,
				modelId: result.model,
				dimensions: result.embedding.length,
				strategy: "provider",
			});
			this.lastResolvedEpoch = epoch;
			this.lastProviderCatalogSignature = buildProviderCatalogSignature(this.provider);
			return epoch;
		} catch {
			this.providerAvailable = null;
			return this.lastResolvedEpoch ?? buildFallbackEmbeddingEpoch(FALLBACK_DIM);
		}
	}
}

function buildProviderCatalogSignature(provider: EmbeddingProvider): string {
	return JSON.stringify({
		id: provider.id,
		models: provider.models.map((model) => ({
			id: model.id,
			dimensions: model.dimensions,
			maxTokens: model.maxTokens,
		})),
	});
}
