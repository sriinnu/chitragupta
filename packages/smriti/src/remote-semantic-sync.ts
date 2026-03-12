import { DatabaseManager } from "./db/database.js";
import { initAgentSchema, initVectorsSchema } from "./db/schema.js";
import { type CuratedConsolidationArtifact, type CuratedConsolidationArtifactQuery, listCuratedConsolidationArtifacts, repairConsolidationVectorSync } from "./consolidation-indexer.js";
import { getEngineEmbeddingService } from "./embedding-runtime.js";
import { parseEmbeddingEpoch } from "./embedding-epoch.js";
import { blobToVector } from "./recall.js";
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

interface RemoteSemanticSyncRow {
	artifact_id: string;
	level: string;
	period: string;
	project: string | null;
	content_hash: string;
	embedding_epoch: string | null;
	remote_id: string | null;
	last_synced_at: number | null;
	last_error: string | null;
	updated_at: number;
}

type RemoteSemanticSyncOptions = CuratedConsolidationArtifactQuery & {
	repairLocal?: boolean;
};

interface EmbeddingRow {
	id: string;
	vector: Buffer;
	text: string;
	metadata: string | null;
}

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
		`SELECT artifact_id, level, period, project, content_hash, embedding_epoch, remote_id, last_synced_at, last_error, updated_at
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
	getAgentDb().prepare(
		`INSERT INTO remote_semantic_sync (
			target, artifact_id, level, period, project, content_hash, embedding_epoch, remote_id, last_synced_at, last_error, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
		ON CONFLICT(target, artifact_id) DO UPDATE SET
			level = excluded.level,
			period = excluded.period,
			project = excluded.project,
			content_hash = excluded.content_hash,
			embedding_epoch = excluded.embedding_epoch,
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
	getAgentDb().prepare(
		`INSERT INTO remote_semantic_sync (
			target, artifact_id, level, period, project, content_hash, embedding_epoch, remote_id, last_synced_at, last_error, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
		ON CONFLICT(target, artifact_id) DO UPDATE SET
			level = excluded.level,
			period = excluded.period,
			project = excluded.project,
			content_hash = excluded.content_hash,
			embedding_epoch = excluded.embedding_epoch,
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
		error,
		now,
	);
}


function parseEmbeddingMetadata(row: EmbeddingRow | undefined): Record<string, unknown> {
	if (!row?.metadata) return {};
	try {
		return JSON.parse(row.metadata) as Record<string, unknown>;
	} catch {
		return {};
	}
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
		packedSummary: artifact.packedSummaryText ?? metadata.packedSummaryText ?? null,
		compression: artifact.compression ?? metadata.compression ?? null,
		embeddingEpoch: metadata.embeddingEpoch ?? null,
		mdlMetrics: artifact.mdlMetrics ?? metadata.mdlMetrics ?? null,
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

function buildStatusFromRows(
	artifacts: readonly CuratedConsolidationArtifact[],
	rowsById: Map<string, RemoteSemanticSyncRow>,
	embeddingRowsById: Map<string, EmbeddingRow>,
	config: RemoteSemanticMirrorConfig | null,
	remoteHealth?: RemoteSemanticSyncStatus["remoteHealth"],
): RemoteSemanticSyncStatus {
	const issues: RemoteSemanticSyncIssue[] = [];
	let syncedCount = 0;
	let missingCount = 0;
	let driftCount = 0;
	let lastSyncAt: string | null = null;
	let lastError: string | null = null;

	for (const row of rowsById.values()) {
		if (row.last_synced_at && (!lastSyncAt || row.last_synced_at > Date.parse(lastSyncAt))) {
			lastSyncAt = new Date(row.last_synced_at).toISOString();
		}
		if (row.last_error && !lastError) lastError = row.last_error;
	}

	for (const artifact of artifacts) {
		const row = rowsById.get(artifact.id);
		const embeddingMetadata = parseEmbeddingMetadata(embeddingRowsById.get(artifact.id));
		const currentEpoch = parseEmbeddingEpoch(embeddingMetadata.embeddingEpoch)?.epoch ?? null;
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
		enabled: Boolean(config),
		provider: config ? "qdrant" : "disabled",
		configured: Boolean(config),
		scanned: artifacts.length,
		syncedCount,
		missingCount,
		driftCount,
		lastSyncAt,
		lastError,
		collection: config?.collection,
		baseUrl: config?.baseUrl,
		remoteHealth,
		issues,
	};
}

export async function inspectRemoteSemanticSync(
	options: CuratedConsolidationArtifactQuery = {},
): Promise<RemoteSemanticSyncStatus> {
	const artifacts = await listCuratedConsolidationArtifacts(options);
	const config = resolveRemoteSemanticMirrorConfig();
	const health = config ? await checkRemoteSemanticHealth(config) : undefined;
	const rowsById = selectRemoteSyncRows();
	return buildStatusFromRows(artifacts, rowsById, selectEmbeddingRows(), config, health);
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
			if (!storedHash || storedHash !== artifact.contentHash) {
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
