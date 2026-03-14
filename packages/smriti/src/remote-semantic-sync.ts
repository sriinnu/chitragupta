import { DatabaseManager } from "./db/database.js";
import { initAgentSchema, initVectorsSchema } from "./db/schema.js";
import { type CuratedConsolidationArtifact, type CuratedConsolidationArtifactQuery, listCuratedConsolidationArtifacts, repairConsolidationVectorSync } from "./consolidation-indexer.js";
import { getEngineEmbeddingService } from "./embedding-runtime.js";
import { parseEmbeddingEpoch } from "./embedding-epoch.js";
import { blobToVector } from "./recall.js";
import {
	buildArtifactQualityHash,
	getRemoteSemanticPromotionDecision,
} from "./remote-semantic-sync-quality.js";
import {
	buildRemoteSemanticSyncStatus,
	parseEmbeddingMetadata,
	type EmbeddingRow,
	type RemoteSemanticSyncRow,
} from "./remote-semantic-sync-helpers.js";
import {
	checkRemoteSemanticHealth,
	ensureRemoteSemanticCollection,
	normalizeQdrantId,
	requestRemoteSemantic,
	resolveRemoteSemanticMirrorConfig,
} from "./remote-semantic-sync-client.js";
import type {
	RemoteSemanticMirrorConfig,
	RemoteSemanticSyncIssue,
	RemoteSemanticSyncResult,
	RemoteSemanticSyncStatus,
} from "./remote-semantic-sync-types.js";

export type {
	RemoteSemanticMirrorConfig,
	RemoteSemanticSyncIssue,
	RemoteSemanticSyncResult,
	RemoteSemanticSyncStatus,
} from "./remote-semantic-sync-types.js";

type RemoteSemanticSyncOptions = CuratedConsolidationArtifactQuery & {
	repairLocal?: boolean;
};

function getAgentDb() {
	const dbm = DatabaseManager.instance();
	initAgentSchema(dbm);
	return dbm.get("agent");
}

function getVectorsDb() {
	const dbm = DatabaseManager.instance();
	initVectorsSchema(dbm);
	return dbm.get("vectors");
}

function selectRemoteSyncRows(): Map<string, RemoteSemanticSyncRow> {
	const db = getAgentDb();
	const rows = db.prepare(
			`SELECT artifact_id, level, period, project, content_hash, embedding_epoch, quality_hash, remote_id, last_synced_at, last_error, updated_at
			 FROM remote_semantic_sync
			 WHERE target = ?`,
	).all("qdrant") as RemoteSemanticSyncRow[];
	return new Map(rows.map((row) => [row.artifact_id, row]));
}

function upsertRemoteSyncSuccess(
	artifact: CuratedConsolidationArtifact,
	remoteId: string,
	embeddingEpoch: string | null,
): void {
	const now = Date.now();
	const qualityHash = buildArtifactQualityHash(artifact);
	getAgentDb().prepare(
			`INSERT INTO remote_semantic_sync (
				target, artifact_id, level, period, project, content_hash, embedding_epoch, quality_hash, remote_id, last_synced_at, last_error, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
			ON CONFLICT(target, artifact_id) DO UPDATE SET
				level = excluded.level,
				period = excluded.period,
				project = excluded.project,
				content_hash = excluded.content_hash,
				embedding_epoch = excluded.embedding_epoch,
				quality_hash = excluded.quality_hash,
				remote_id = excluded.remote_id,
				last_synced_at = excluded.last_synced_at,
				last_error = NULL,
				updated_at = excluded.updated_at`,
		).run(
		"qdrant",
		artifact.id,
		artifact.level,
		artifact.period,
			artifact.project ?? null,
			artifact.contentHash,
			embeddingEpoch,
			qualityHash,
			remoteId,
			now,
			now,
		);
}

function upsertRemoteSyncError(
	artifact: CuratedConsolidationArtifact,
	error: string,
	embeddingEpoch: string | null,
): void {
	const now = Date.now();
	const qualityHash = buildArtifactQualityHash(artifact);
	getAgentDb().prepare(
			`INSERT INTO remote_semantic_sync (
				target, artifact_id, level, period, project, content_hash, embedding_epoch, quality_hash, remote_id, last_synced_at, last_error, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
			ON CONFLICT(target, artifact_id) DO UPDATE SET
				level = excluded.level,
				period = excluded.period,
				project = excluded.project,
				content_hash = excluded.content_hash,
				embedding_epoch = excluded.embedding_epoch,
				quality_hash = excluded.quality_hash,
				last_error = excluded.last_error,
				updated_at = excluded.updated_at`,
		).run(
		"qdrant",
		artifact.id,
		artifact.level,
		artifact.period,
			artifact.project ?? null,
			artifact.contentHash,
			embeddingEpoch,
			qualityHash,
			error,
			now,
		);
}

function selectEmbeddingRows(): Map<string, EmbeddingRow> {
	const rows = getVectorsDb().prepare(
		`SELECT id, vector, text, metadata
		 FROM embeddings
		 WHERE source_type IN ('daily_summary', 'monthly_summary', 'yearly_summary')`,
	).all() as EmbeddingRow[];
	return new Map(rows.map((row) => [row.id, row]));
}

function buildRemotePayload(artifact: CuratedConsolidationArtifact, row: EmbeddingRow): Record<string, unknown> {
	const metadata = parseEmbeddingMetadata(row);
	return {
		originalId: artifact.id,
		summary: artifact.summaryText,
		packedSummary: artifact.packedSummaryText ?? null,
		compression: artifact.compression ?? null,
		embeddingInputHash: artifact.embeddingInputHash,
		embeddingEpoch: metadata.embeddingEpoch ?? null,
		mdlMetrics: artifact.mdlMetrics,
		compactionDecision: artifact.compactionDecision,
		packedDecision: artifact.packedDecision ?? null,
		level: artifact.level,
		period: artifact.period,
		project: artifact.project ?? null,
		contentHash: artifact.contentHash,
		curated: true,
		sourceKind: artifact.provenance.kind,
		generatedAt: artifact.provenance.generatedAt,
		sourceSessionIds: metadata.sourceSessionIds ?? artifact.provenance.sourceSessionIds ?? [],
		sourcePeriods: metadata.sourcePeriods ?? ("sourcePeriods" in artifact.provenance ? artifact.provenance.sourcePeriods : []),
	};
}

export async function inspectRemoteSemanticSync(
	options: CuratedConsolidationArtifactQuery = {},
): Promise<RemoteSemanticSyncStatus> {
	const artifacts = await listCuratedConsolidationArtifacts(options);
	const config = resolveRemoteSemanticMirrorConfig();
	const health = config ? await checkRemoteSemanticHealth(config) : undefined;
	const rowsById = selectRemoteSyncRows();
	let currentEmbeddingEpoch: string | null = null;
	try {
		currentEmbeddingEpoch = (await (await getEngineEmbeddingService()).getEmbeddingEpoch()).epoch;
	} catch {
		currentEmbeddingEpoch = null;
	}
	return buildRemoteSemanticSyncStatus(
		artifacts,
		rowsById,
		selectEmbeddingRows(),
		config,
		currentEmbeddingEpoch,
		health,
	);
}

export async function syncRemoteSemanticMirror(
	options: RemoteSemanticSyncOptions = {},
): Promise<RemoteSemanticSyncResult> {
	const config = resolveRemoteSemanticMirrorConfig();
	if (!config) {
		return {
			synced: 0,
			status: await inspectRemoteSemanticSync(options),
		};
	}

	if (options.repairLocal !== false) {
		await repairConsolidationVectorSync(options);
	}
	const artifacts = await listCuratedConsolidationArtifacts(options);
	if (artifacts.length === 0) {
		return {
			synced: 0,
			status: await inspectRemoteSemanticSync(options),
		};
	}

	const rowsById = selectEmbeddingRows();
	let expectedVectorSize = 0;
	let synced = 0;
	let currentEmbeddingEpoch: string | null = null;
	try {
		currentEmbeddingEpoch = (await (await getEngineEmbeddingService()).getEmbeddingEpoch()).epoch;
	} catch {
		currentEmbeddingEpoch = null;
	}

	for (let i = 0; i < artifacts.length; i += config.batchSize) {
		const batch = artifacts.slice(i, i + config.batchSize);
		const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];
		for (const artifact of batch) {
			const promotion = getRemoteSemanticPromotionDecision(artifact);
			if (!promotion.eligible) continue;
			const row = rowsById.get(artifact.id);
			const metadata = parseEmbeddingMetadata(row);
			const embeddingEpoch = parseEmbeddingEpoch(metadata.embeddingEpoch)?.epoch ?? null;
			if (!row) {
				upsertRemoteSyncError(artifact, "local semantic mirror missing curated embedding", embeddingEpoch);
				continue;
			}
			if (metadata.curated !== true) {
				upsertRemoteSyncError(artifact, "local semantic mirror requires curated reindex before remote sync", embeddingEpoch);
				continue;
				}
				const storedHash = typeof metadata.contentHash === "string" ? metadata.contentHash : null;
				const storedEmbeddingInputHash = typeof metadata.embeddingInputHash === "string"
					? metadata.embeddingInputHash
					: storedHash;
				if (
					!storedHash
					|| storedHash !== artifact.contentHash
					|| storedEmbeddingInputHash !== artifact.embeddingInputHash
				) {
					upsertRemoteSyncError(artifact, "local semantic mirror content hash is stale; repair required", embeddingEpoch);
					continue;
				}
			if (!embeddingEpoch || (currentEmbeddingEpoch && embeddingEpoch !== currentEmbeddingEpoch)) {
				upsertRemoteSyncError(artifact, "local semantic mirror embedding epoch is stale; repair required", embeddingEpoch);
				continue;
			}
			const vector = blobToVector(row.vector);
			if (!Array.isArray(vector) || vector.length === 0) {
				upsertRemoteSyncError(artifact, "local semantic mirror returned empty vector", embeddingEpoch);
				continue;
			}
			if (expectedVectorSize === 0) {
				expectedVectorSize = vector.length;
				await ensureRemoteSemanticCollection(config, expectedVectorSize);
			}
			if (vector.length !== expectedVectorSize) {
				upsertRemoteSyncError(
					artifact,
					`vector dimension mismatch: expected ${expectedVectorSize}, got ${vector.length}`,
					embeddingEpoch,
				);
				continue;
			}
			points.push({
				id: normalizeQdrantId(artifact.id),
				vector,
				payload: buildRemotePayload(artifact, row),
			});
		}

		if (points.length === 0) continue;

			try {
				await requestRemoteSemantic({
					url: `${config.baseUrl}/collections/${config.collection}/points`,
					method: "PUT",
					apiKey: config.apiKey,
				timeoutMs: config.timeoutMs,
				body: { points },
				});
					for (const point of points) {
						const originalId =
							typeof point.payload.originalId === "string" ? point.payload.originalId : null;
						if (!originalId) continue;
						const artifact = batch.find((candidate) => candidate.id === originalId);
						if (!artifact) continue;
						const pointEpoch =
							typeof point.payload.embeddingEpoch === "object" && point.payload.embeddingEpoch
								? parseEmbeddingEpoch(point.payload.embeddingEpoch)?.epoch ?? null
								: null;
						upsertRemoteSyncSuccess(artifact, normalizeQdrantId(artifact.id), pointEpoch);
						synced += 1;
					}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				for (const artifact of batch) {
					const row = rowsById.get(artifact.id);
					const embeddingEpoch = parseEmbeddingEpoch(parseEmbeddingMetadata(row).embeddingEpoch)?.epoch ?? null;
					upsertRemoteSyncError(artifact, message, embeddingEpoch);
				}
				break;
			}
	}

	return {
		synced,
		status: await inspectRemoteSemanticSync(options),
	};
}
