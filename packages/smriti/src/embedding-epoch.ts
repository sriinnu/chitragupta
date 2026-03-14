import { MDL_COMPACTION_POLICY_VERSION } from "./mdl-compaction.js";

/**
 * Version stamp for a semantic embedding regime.
 *
 * I treat an embedding epoch as the minimum stable identity needed to decide
 * whether a stored vector must be refreshed after a provider/model change.
 */
export interface EmbeddingEpoch {
	providerId: string;
	modelId: string;
	dimensions: number;
	strategy: "provider" | "fallback";
	policyVersion: string;
	epoch: string;
}

/** Canonical provider id used when semantic vectors fall back to hash-based embeddings. */
export const FALLBACK_EMBEDDING_PROVIDER_ID = "fallback-embeddings";
/** Canonical model id used when semantic vectors fall back to hash-based embeddings. */
export const FALLBACK_EMBEDDING_MODEL_ID = "hash-fallback-v1";
/** Stable sentinel for persisted rows whose provider identity was missing. */
export const UNKNOWN_EMBEDDING_PROVIDER_ID = "unknown-provider";
/** Stable sentinel for persisted rows whose model identity was missing. */
export const UNKNOWN_EMBEDDING_MODEL_ID = "unknown-model";
/** Active semantic embedding policy version for epoch drift and self-heal checks. */
export const SEMANTIC_EMBEDDING_POLICY_VERSION = `semantic-v2-${MDL_COMPACTION_POLICY_VERSION}`;

/**
 * Build a normalized embedding epoch identifier.
 *
 * The builder is intentionally stricter than a raw string concatenation: it
 * normalizes empty identifiers to stable sentinels so the produced object
 * always remains parseable and comparable later on.
 */
export function buildEmbeddingEpoch(parts: {
	providerId: string;
	modelId: string;
	dimensions: number;
	strategy: "provider" | "fallback";
	policyVersion?: string;
}): EmbeddingEpoch {
	const providerId = parts.providerId.trim() || UNKNOWN_EMBEDDING_PROVIDER_ID;
	const modelId = parts.modelId.trim() || UNKNOWN_EMBEDDING_MODEL_ID;
	const dimensions = Math.max(1, Math.trunc(parts.dimensions));
	const policyVersion = parts.policyVersion?.trim() || SEMANTIC_EMBEDDING_POLICY_VERSION;
	return {
		providerId,
		modelId,
		dimensions,
		strategy: parts.strategy,
		policyVersion,
		epoch: `${providerId}:${modelId}:${dimensions}:${parts.strategy}:${policyVersion}`,
	};
}

/** Build the canonical fallback epoch used by hash-based embeddings. */
export function buildFallbackEmbeddingEpoch(dimensions: number): EmbeddingEpoch {
	return buildEmbeddingEpoch({
		providerId: FALLBACK_EMBEDDING_PROVIDER_ID,
		modelId: FALLBACK_EMBEDDING_MODEL_ID,
		dimensions,
		strategy: "fallback",
	});
}

/**
 * Parse and validate an embedding epoch payload from persisted metadata.
 *
 * I rebuild the normalized epoch string and require it to match exactly so
 * stale or malformed payloads fail closed.
 */
export function parseEmbeddingEpoch(value: unknown): EmbeddingEpoch | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	const providerId = typeof candidate.providerId === "string" ? candidate.providerId.trim() : "";
	const modelId = typeof candidate.modelId === "string" ? candidate.modelId.trim() : "";
	const dimensions = typeof candidate.dimensions === "number" && Number.isFinite(candidate.dimensions)
		? Math.trunc(candidate.dimensions)
		: NaN;
	const strategy = candidate.strategy === "provider" || candidate.strategy === "fallback"
		? candidate.strategy
		: null;
	const policyVersion = typeof candidate.policyVersion === "string" ? candidate.policyVersion.trim() : "";
	const epoch = typeof candidate.epoch === "string" ? candidate.epoch.trim() : "";
	if (!providerId || !modelId || !strategy || !Number.isFinite(dimensions) || dimensions <= 0) return null;
	const rebuilt = buildEmbeddingEpoch({
		providerId,
		modelId,
		dimensions,
		strategy,
		policyVersion: policyVersion || undefined,
	});
	if (epoch && epoch !== rebuilt.epoch) return null;
	return rebuilt;
}
