/**
 * @chitragupta/smriti — Session L1 LRU Cache.
 *
 * In-process LRU cache for parsed Session objects:
 *   - Up to 500 entries or ~25 MB (whichever limit hits first)
 *   - Map insertion order provides LRU eviction (oldest first)
 *   - On access, entry is moved to tail (most recent)
 *
 * Used by session-store.ts for fast loadSession() hits (<0.01ms).
 */

import type { Session } from "./types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max sessions to cache in-process (hard cap). */
const SESSION_CACHE_MAX = 500;

/** Byte budget for the L1 cache (~25 MB). */
const SESSION_CACHE_MAX_BYTES = 25 * 1024 * 1024;

// ─── Internal State ─────────────────────────────────────────────────────────

/**
 * Simple LRU cache backed by Map insertion order.
 * On access, delete + re-insert to move entry to tail (most recent).
 * Tracks rough byte usage and evicts when exceeding either count or byte budget.
 */
const sessionCache = new Map<string, Session>();
const sessionCacheSizes = new Map<string, number>();
let sessionCacheBytes = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Rough byte estimate for a session (metadata overhead + turn content).
 *
 * @param session - The session to estimate size for.
 * @returns Estimated byte count.
 */
function estimateSessionBytes(session: Session): number {
	let bytes = 200; // metadata overhead estimate
	for (const turn of session.turns) {
		bytes += Buffer.byteLength(turn.content, "utf-8") + 50; // per-turn overhead
	}
	return bytes;
}

/**
 * Build a composite cache key from session ID and project path.
 *
 * @param id - Session ID.
 * @param project - Project path.
 * @returns Composite key string.
 */
function cacheKey(id: string, project: string): string {
	return `${id}:${project}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Retrieve a session from the L1 cache.
 * Moves the entry to the tail (most recent) on hit.
 *
 * @param id - Session ID to look up.
 * @param project - Project path for the session.
 * @returns The cached Session, or undefined on miss.
 */
export function cacheGet(id: string, project: string): Session | undefined {
	const key = cacheKey(id, project);
	const entry = sessionCache.get(key);
	if (!entry) return undefined;
	// Move to tail (most recent) — preserve size tracking
	const size = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCache.set(key, entry);
	sessionCacheSizes.set(key, size);
	return entry;
}

/**
 * Insert or update a session in the L1 cache.
 * Evicts oldest entries if count or byte budget is exceeded.
 *
 * @param id - Session ID to cache.
 * @param project - Project path for the session.
 * @param session - The parsed Session to store.
 */
export function cachePut(id: string, project: string, session: Session): void {
	const key = cacheKey(id, project);
	// Remove existing entry first (refresh position + update byte tracking)
	const existingSize = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCacheBytes -= existingSize;

	const newSize = estimateSessionBytes(session);

	// Evict oldest entries while over count or byte budget
	while (
		(sessionCache.size >= SESSION_CACHE_MAX || sessionCacheBytes + newSize > SESSION_CACHE_MAX_BYTES)
		&& sessionCache.size > 0
	) {
		const oldest = sessionCache.keys().next().value;
		if (oldest === undefined) break;
		const evictedSize = sessionCacheSizes.get(oldest) ?? 0;
		sessionCache.delete(oldest);
		sessionCacheSizes.delete(oldest);
		sessionCacheBytes -= evictedSize;
	}

	sessionCache.set(key, session);
	sessionCacheSizes.set(key, newSize);
	sessionCacheBytes += newSize;
}

/**
 * Remove a session from the L1 cache.
 *
 * @param id - Session ID to invalidate.
 * @param project - Project path for the session.
 */
export function cacheInvalidate(id: string, project: string): void {
	const key = cacheKey(id, project);
	const size = sessionCacheSizes.get(key) ?? 0;
	sessionCache.delete(key);
	sessionCacheSizes.delete(key);
	sessionCacheBytes -= size;
}

/**
 * Reset L1 session cache (for testing).
 * Clears all cached sessions and resets byte tracking.
 */
export function _resetSessionCache(): void {
	sessionCache.clear();
	sessionCacheSizes.clear();
	sessionCacheBytes = 0;
}
