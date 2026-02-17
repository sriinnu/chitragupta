/**
 * @chitragupta/smriti — Unified embedding service.
 *
 * Wraps an optional EmbeddingProvider from @chitragupta/swara with
 * LRU caching and a deterministic hash-based fallback. Single source
 * of truth for all embedding generation within smriti.
 */

import type { EmbeddingProvider } from "@chitragupta/swara";

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
	private cache: LRUCache<string, number[]>;
	private providerAvailable: boolean | null = null;

	constructor(provider?: EmbeddingProvider, maxCacheSize?: number) {
		this.provider = provider;
		const bounded = Math.min(maxCacheSize ?? DEFAULT_MAX_CACHE, MAX_CACHE_CEILING);
		this.cache = new LRUCache(bounded);
	}

	async getEmbedding(text: string): Promise<number[]> {
		const cacheKey = fnv1aHash(text);
		const cached = this.cache.get(cacheKey);
		if (cached) return cached;

		let vector: number[];

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
					vector = result.embedding;
				} catch {
					this.providerAvailable = false;
					vector = fallbackEmbedding(text);
				}
			} else {
				vector = fallbackEmbedding(text);
			}
		} else {
			vector = fallbackEmbedding(text);
		}

		this.cache.set(cacheKey, vector);
		return vector;
	}

	resetAvailability(): void {
		this.providerAvailable = null;
	}

	clearCache(): void {
		this.cache.clear();
	}

	/** Current number of cached embeddings. */
	get cacheSize(): number {
		return this.cache.size;
	}
}
