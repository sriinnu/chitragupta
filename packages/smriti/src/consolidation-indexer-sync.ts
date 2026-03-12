import { parseEmbeddingEpoch } from "./embedding-epoch.js";
import type {
	ConsolidationVectorSyncIssue,
	ConsolidationVectorSyncStatus,
	CuratedConsolidationArtifact,
} from "./consolidation-indexer-artifacts.js";
import type { EmbeddingEpoch } from "./embedding-epoch.js";

export interface EmbeddingRow {
	id: string;
	vector: Buffer;
	text: string;
	source_type: string;
	source_id: string;
	metadata: string | null;
}

/** Parse embedding metadata defensively from a vectors row. */
export function parseEmbeddingMetadata(
	row: Pick<EmbeddingRow, "metadata"> | undefined,
): Record<string, unknown> {
	if (!row?.metadata) return {};
	try {
		return JSON.parse(row.metadata) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** Inspect curated artifacts against the local vector mirror for freshness drift. */
export async function inspectArtifactVectorSync(
	artifacts: readonly CuratedConsolidationArtifact[],
	rowsById: Map<string, EmbeddingRow>,
	expectedEpoch: EmbeddingEpoch,
): Promise<ConsolidationVectorSyncStatus> {
	const issues: ConsolidationVectorSyncIssue[] = [];
	let missingCount = 0;
	let driftCount = 0;
	for (const artifact of artifacts) {
		const row = rowsById.get(artifact.id);
		if (!row) {
			missingCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "missing_vector",
			});
			continue;
		}
		const metadata = parseEmbeddingMetadata(row);
		const storedHash = typeof metadata.contentHash === "string" ? metadata.contentHash : "";
		const curated = metadata.curated === true;
		const storedEpoch = parseEmbeddingEpoch(metadata.embeddingEpoch);
		if (!curated) {
			driftCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "legacy_vector",
			});
			continue;
		}
		if (storedHash !== artifact.contentHash) {
			driftCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "stale_hash",
			});
			continue;
		}
		if (!storedEpoch || storedEpoch.epoch !== expectedEpoch.epoch) {
			driftCount++;
			issues.push({
				id: artifact.id,
				level: artifact.level,
				period: artifact.period,
				project: artifact.project,
				reason: "stale_epoch",
			});
		}
	}
	return {
		scanned: artifacts.length,
		missingCount,
		driftCount,
		issues,
	};
}
