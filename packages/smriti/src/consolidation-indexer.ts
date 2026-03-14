/**
 * @chitragupta/smriti — Consolidation Indexer
 *
 * Vector-indexes consolidation summaries (daily/monthly/yearly) into vectors.db.
 * This enables hierarchical temporal search: instead of linear scanning all
 * day files, queries search vector-indexed summaries at each time scale.
 *
 * Each summary is stored with source_type = "{level}_summary" in the embeddings
 * table, allowing efficient filtered vector search by consolidation level.
 */

import fs from "node:fs";
import { DatabaseManager } from "./db/database.js";
import { initVectorsSchema } from "./db/schema.js";
import { EmbeddingService, fallbackEmbedding } from "./embedding-service.js";
import { vectorToBlob, blobToVector } from "./recall.js";
import { cosineSimilarity } from "./recall-scoring.js";
import {
	parseConsolidationMetadata,
} from "./consolidation-provenance.js";
import {
	inspectArtifactVectorSync,
	type EmbeddingRow,
} from "./consolidation-indexer-sync.js";
import { getEngineEmbeddingService } from "./embedding-runtime.js";
import {
	buildArtifactContentHash,
	buildArtifactEmbeddingInputHash,
	buildConsolidationEmbeddingId,
	buildConsolidationSourceId,
	extractSummaryText,
	listCuratedConsolidationArtifacts,
	prepareCuratedSummaryCompression,
	type ConsolidationLevel,
	type ConsolidationSummaryIndex,
	type ConsolidationVectorSyncIssue,
	type ConsolidationVectorSyncStatus,
	type CuratedConsolidationArtifact,
	type CuratedConsolidationArtifactQuery,
} from "./consolidation-indexer-artifacts.js";
import {
	ensureSemanticEpochFreshnessOnRead,
	parseSearchMetadata,
	scoreCuratedSearchHit,
} from "./consolidation-indexer-search.js";

export {
	buildConsolidationEmbeddingId,
	buildConsolidationSourceId,
	extractSummaryText,
	listCuratedConsolidationArtifacts,
};
export type {
	ConsolidationLevel,
	ConsolidationSummaryIndex,
	ConsolidationVectorSyncIssue,
	ConsolidationVectorSyncStatus,
	CuratedConsolidationArtifact,
	CuratedConsolidationArtifactQuery,
};

export interface ConsolidationIndexResult {
	indexed: boolean;
	reason?: "too_short" | "write_failed";
}

// ─── Embedding helper ────────────────────────────────────────────────────────

let _embeddingService: EmbeddingService | null = null;

async function getEmbeddingService(): Promise<EmbeddingService> {
	if (!_embeddingService) {
		_embeddingService = await getEngineEmbeddingService();
	}
	return _embeddingService;
}

// ─── DB helper ───────────────────────────────────────────────────────────────

let _vectorsDbInit = false;

function getVectorsDb() {
	const dbm = DatabaseManager.instance();
	if (!_vectorsDbInit) {
		initVectorsSchema(dbm);
		_vectorsDbInit = true;
	}
	return dbm.get("vectors");
}

/** Reset module state (for testing). */
export function _resetConsolidationIndexer(): void {
	_vectorsDbInit = false;
	_embeddingService = null;
}


// ─── Index Consolidation Summary ─────────────────────────────────────────────

/**
 * Vector-index a consolidation summary into vectors.db.
 * Extracts key text, generates embedding, and upserts into the embeddings table.
 */
export async function indexConsolidationSummary(
	level: ConsolidationLevel,
	period: string,
	markdown: string,
	project?: string,
): Promise<ConsolidationIndexResult> {
	const extractedSummaryText = extractSummaryText(markdown, level);
	const compressionDecision = await prepareCuratedSummaryCompression(markdown, extractedSummaryText);
	const summaryText = compressionDecision.summaryText;
	if (!summaryText || summaryText.length < 10) {
		return { indexed: false, reason: "too_short" };
	}
	const embeddingInputText =
		compressionDecision.packedSummaryText && compressionDecision.packedDecision?.accepted
			? compressionDecision.packedSummaryText
			: summaryText;
	const embeddingInputMode =
		embeddingInputText === summaryText ? "summary" : "packed";
	const provenance = parseConsolidationMetadata(markdown);
	const contentHash = buildArtifactContentHash(summaryText);
	const embeddingInputHash = compressionDecision.embeddingInputHash
		|| buildArtifactEmbeddingInputHash(embeddingInputText);
	const sourceSessionIds =
		provenance && "sourceSessionIds" in provenance ? provenance.sourceSessionIds : [];
	const sourcePeriods =
		provenance && "sourcePeriods" in provenance ? provenance.sourcePeriods : [];

	// Generate embedding
	let embedding: number[];
	const embeddingService = await getEmbeddingService();
	let embeddingEpoch = await embeddingService.getEmbeddingEpoch();
	try {
		const record = await embeddingService.getEmbeddingRecord(embeddingInputText);
		embedding = record.embedding;
		embeddingEpoch = record.epoch;
	} catch {
		embedding = fallbackEmbedding(embeddingInputText);
		embeddingEpoch = await embeddingService.getEmbeddingEpoch();
	}

	const id = buildConsolidationEmbeddingId(level, period, project);
	const sourceType = `${level}_summary`;
	const sourceId = buildConsolidationSourceId(period, project);

	try {
		const db = getVectorsDb();
		db.prepare(`
			INSERT OR REPLACE INTO embeddings (id, vector, text, source_type, source_id, dimensions, metadata, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			id,
				vectorToBlob(embedding),
				summaryText.slice(0, 5000),
				sourceType,
				sourceId,
				embedding.length,
				JSON.stringify({
					level,
					period,
						project: project ?? null,
							curated: provenance !== null,
							contentHash,
							embeddingInputHash,
							embeddingEpoch,
							embeddingInputMode,
						summarySelection: compressionDecision.summarySelection,
						packedSummaryText: compressionDecision.packedSummaryText ?? null,
						compression: compressionDecision.compression ?? null,
						compactionDecision: compressionDecision.compactionDecision,
						packedDecision: compressionDecision.packedDecision,
						mdlMetrics: compressionDecision.mdlMetrics,
						generatedAt: provenance?.generatedAt ?? null,
						sourceSessionIds,
						sourcePeriods,
					}),
				Date.now(),
			);
			return { indexed: true };
		} catch {
			// Best-effort — don't break consolidation if vector indexing fails
			return { indexed: false, reason: "write_failed" };
		}
}

// ─── Search Consolidation Summaries ──────────────────────────────────────────

/**
 * Search vector-indexed consolidation summaries by level.
 * Returns ranked results with period, score, and snippet.
 */
export async function searchConsolidationSummaries(
	query: string,
	level: ConsolidationLevel,
	options?: { limit?: number; project?: string },
): Promise<Array<{ period: string; score: number; snippet: string; project?: string }>> {
	const limit = options?.limit ?? 5;
	await ensureSemanticEpochFreshnessOnRead();

	// Generate query embedding
	let queryEmbedding: number[];
	let expectedEpoch: string | null = null;
	try {
		const svc = await getEmbeddingService();
		queryEmbedding = await svc.getEmbedding(query);
		expectedEpoch = (await svc.getEmbeddingEpoch()).epoch;
	} catch {
		queryEmbedding = fallbackEmbedding(query);
	}

	const sourceType = `${level}_summary`;

	try {
		const db = getVectorsDb();
		const rows = db.prepare(
			`SELECT id, vector, text, source_type, source_id, metadata
			 FROM embeddings WHERE source_type = ?`,
		).all(sourceType) as EmbeddingRow[];

		const scored: Array<{ period: string; score: number; snippet: string; project?: string }> = [];

		for (const row of rows) {
			const meta = parseSearchMetadata(row, expectedEpoch);

			// Filter by project if specified
			if (options?.project && meta.project && meta.project !== options.project) continue;

			const vector = blobToVector(row.vector);
			const baseScore = cosineSimilarity(queryEmbedding, vector);
			const score = scoreCuratedSearchHit(baseScore, meta);

			if (baseScore > 0.1) {
				scored.push({
					period: meta.period,
					score,
					snippet: row.text.slice(0, 300),
					project: meta.project,
				});
			}
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit);
	} catch {
		return [];
	}
}

/**
 * Inspect recent curated consolidation artifacts and compare them against the
 * semantic/vector mirror in vectors.db.
 */
export async function inspectConsolidationVectorSync(
	options: CuratedConsolidationArtifactQuery = {},
): Promise<ConsolidationVectorSyncStatus> {
	try {
		const artifacts = await listCuratedConsolidationArtifacts(options);
		if (artifacts.length === 0) {
			return { scanned: 0, missingCount: 0, driftCount: 0, issues: [] };
		}
		const db = getVectorsDb();
		const rows = db.prepare(
			`SELECT id, vector, text, source_type, source_id, metadata
			 FROM embeddings
			 WHERE source_type IN ('daily_summary', 'monthly_summary', 'yearly_summary')`,
		).all() as EmbeddingRow[];
		const expectedEpoch = await (await getEmbeddingService()).getEmbeddingEpoch();
		return await inspectArtifactVectorSync(artifacts, new Map(rows.map((row) => [row.id, row])), expectedEpoch);
	} catch {
		return { scanned: 0, missingCount: 0, driftCount: 0, issues: [] };
	}
}

/**
 * Re-index recent curated consolidation artifacts that are missing or stale in
 * the semantic/vector mirror.
 */
export async function repairConsolidationVectorSync(
	options: CuratedConsolidationArtifactQuery = {},
): Promise<{ status: ConsolidationVectorSyncStatus; reindexed: number }> {
	const artifacts = await listCuratedConsolidationArtifacts(options);
	if (artifacts.length === 0) {
		return {
			status: { scanned: 0, missingCount: 0, driftCount: 0, issues: [] },
			reindexed: 0,
		};
	}
	const db = getVectorsDb();
	const rows = db.prepare(
		`SELECT id, vector, text, source_type, source_id, metadata
		 FROM embeddings
		 WHERE source_type IN ('daily_summary', 'monthly_summary', 'yearly_summary')`,
	).all() as EmbeddingRow[];
	const expectedEpoch = await (await getEmbeddingService()).getEmbeddingEpoch();
	const status = await inspectArtifactVectorSync(artifacts, new Map(rows.map((row) => [row.id, row])), expectedEpoch);
	if (status.issues.length === 0) return { status, reindexed: 0 };

	const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
	let reindexed = 0;
	for (const issue of status.issues) {
		const artifact = artifactsById.get(issue.id);
		if (!artifact) continue;
		const reindex = await indexConsolidationSummary(
			artifact.level,
			artifact.period,
			artifact.markdown,
			artifact.project,
		);
		if (reindex.indexed) {
			reindexed += 1;
		}
	}
	const repairedStatus = await inspectConsolidationVectorSync(options);
	return { status: repairedStatus, reindexed };
}

// ─── Backfill ────────────────────────────────────────────────────────────────

/**
 * Backfill vector indices for existing consolidation files that aren't indexed yet.
 * Scans day files and periodic reports, indexes any missing ones.
 */
export async function backfillConsolidationIndices(): Promise<{ daily: number; monthly: number; yearly: number }> {
	const counts = { daily: 0, monthly: 0, yearly: 0 };

	try {
		const db = getVectorsDb();

		// Get already-indexed IDs
		const existing = new Set(
			(db.prepare("SELECT id FROM embeddings WHERE source_type IN ('daily_summary', 'monthly_summary', 'yearly_summary')").all() as Array<{ id: string }>)
				.map((r) => r.id),
		);

			// Backfill day files
				try {
					const { listDayFiles, getDayFilePath } = await import("./day-consolidation.js");
					const dayFiles = listDayFiles();

					for (const date of dayFiles) {
						const id = buildConsolidationEmbeddingId("daily", date);
						if (existing.has(id)) continue;

					const dayPath = getDayFilePath(date);
					if (!fs.existsSync(dayPath)) continue;
						const content = fs.readFileSync(dayPath, "utf-8");
						const provenance = parseConsolidationMetadata(content);
						if (content && content.length > 20 && provenance?.kind === "day") {
							await indexConsolidationSummary("daily", date, content);
							counts.daily++;
					}
			}
		} catch {
			// Day files unavailable
		}

		// Backfill periodic reports
		try {
			const { PeriodicConsolidation } = await import("./periodic-consolidation.js");
			const { listSessionProjects } = await import("./session-store.js");
			const projectEntries = listSessionProjects();

			for (const entry of projectEntries) {
				const project = entry.project;
				const pc = new PeriodicConsolidation({ project });
				const reports = pc.listReports();

					for (const report of reports) {
						const level: ConsolidationLevel = report.type === "monthly" ? "monthly" : "yearly";
						const id = buildConsolidationEmbeddingId(level, report.period, project);
						if (existing.has(id)) continue;

					try {
						const fs = await import("node:fs");
							const content = fs.readFileSync(report.path, "utf-8");
							const provenance = parseConsolidationMetadata(content);
							if (content && content.length > 20 && provenance?.kind === report.type) {
								await indexConsolidationSummary(level, report.period, content, project);
								if (level === "monthly") counts.monthly++;
								else counts.yearly++;
						}
					} catch {
						// Skip unreadable reports
					}
				}
			}
		} catch {
			// Periodic consolidation unavailable
		}
	} catch {
		// DB unavailable — return zeros
	}

	return counts;
}
