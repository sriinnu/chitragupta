import { parseEmbeddingEpoch } from "./embedding-epoch.js";
import type { CuratedConsolidationArtifact } from "./consolidation-indexer.js";
import {
	buildArtifactQualityHash,
	getRemoteSemanticPromotionDecision,
} from "./remote-semantic-sync-quality.js";
import type {
	RemoteSemanticMirrorConfig,
	RemoteSemanticSyncStatus,
} from "./remote-semantic-sync-types.js";

/**
 * Persisted remote semantic mirror row.
 *
 * This is the daemon's local bookkeeping for one mirrored curated artifact, so
 * I keep the schema explicit for drift classification and repair planning.
 */
export interface RemoteSemanticSyncRow {
	artifact_id: string;
	level: string;
	period: string;
	project: string | null;
	content_hash: string;
	embedding_epoch: string | null;
	quality_hash: string | null;
	remote_id: string | null;
	last_synced_at: number | null;
	last_error: string | null;
	updated_at: number;
}

/**
 * Canonical local embedding row shape used during curated mirror inspection.
 *
 * Only the fields needed for semantic sync are modeled here so helper logic
 * can stay decoupled from the full vectors schema.
 */
export interface EmbeddingRow {
	id: string;
	vector: Buffer;
	text: string;
	metadata: string | null;
}

/**
 * Parse best-effort embedding metadata from a vectors row.
 *
 * Invalid or missing JSON degrades to an empty object so inspection remains
 * resilient and can still classify the row as stale.
 */
export function parseEmbeddingMetadata(row: EmbeddingRow | undefined): Record<string, unknown> {
	if (!row?.metadata) return {};
	try {
		return JSON.parse(row.metadata) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/**
 * Summarize the remote semantic mirror from the current curated artifact set
 * plus the persisted sync rows.
 */
export function buildRemoteSemanticSyncStatus(
	artifacts: readonly CuratedConsolidationArtifact[],
	rowsById: Map<string, RemoteSemanticSyncRow>,
	embeddingRowsById: Map<string, EmbeddingRow>,
	config: RemoteSemanticMirrorConfig | null,
	activeEmbeddingEpoch: string | null,
	remoteHealth?: RemoteSemanticSyncStatus["remoteHealth"],
): RemoteSemanticSyncStatus {
	if (!config) {
		return {
			enabled: false,
			provider: "disabled",
			configured: false,
			scanned: artifacts.length,
			syncedCount: 0,
			missingCount: 0,
			driftCount: 0,
			qualityDeferredCount: 0,
			lastSyncAt: null,
			lastError: null,
			collection: undefined,
			baseUrl: undefined,
			remoteHealth,
			issues: [],
		};
	}

	const issues: RemoteSemanticSyncStatus["issues"] = [];
	let syncedCount = 0;
	let missingCount = 0;
	let driftCount = 0;
	let qualityDeferredCount = 0;
	let lastSyncAt: string | null = null;
	let lastError: string | null = null;

	for (const row of rowsById.values()) {
		if (row.last_synced_at && (!lastSyncAt || row.last_synced_at > Date.parse(lastSyncAt))) {
			lastSyncAt = new Date(row.last_synced_at).toISOString();
		}
		if (row.last_error && !lastError) lastError = row.last_error;
	}

	for (const artifact of artifacts) {
		const promotion = getRemoteSemanticPromotionDecision(artifact);
		if (!promotion.eligible) {
			qualityDeferredCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "deferred_quality",
			});
			continue;
		}

		const row = rowsById.get(artifact.id);
		const embeddingMetadata = parseEmbeddingMetadata(embeddingRowsById.get(artifact.id));
		const currentEpoch = activeEmbeddingEpoch
			?? parseEmbeddingEpoch(embeddingMetadata.embeddingEpoch)?.epoch
			?? null;
		if (!row) {
			missingCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "missing_remote",
			});
			continue;
		}
		if (row.last_error) {
			driftCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "remote_error",
				error: row.last_error,
			});
			continue;
		}
		if (!row.last_synced_at) {
			missingCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "missing_remote",
			});
			continue;
		}
		if (row.content_hash !== artifact.contentHash) {
			driftCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "stale_remote",
			});
			continue;
		}
		if (!row.quality_hash || row.quality_hash !== buildArtifactQualityHash(artifact)) {
			driftCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "stale_remote_quality",
			});
			continue;
		}
		if (!row.embedding_epoch || !currentEpoch || row.embedding_epoch !== currentEpoch) {
			driftCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "stale_remote_epoch",
			});
			continue;
		}
		syncedCount++;
	}

	return {
		enabled: true,
		provider: "qdrant",
		configured: true,
		scanned: artifacts.length,
		syncedCount,
		missingCount,
		driftCount,
		qualityDeferredCount,
		lastSyncAt,
		lastError,
		collection: config.collection,
		baseUrl: config.baseUrl,
		remoteHealth,
		issues,
	};
}
