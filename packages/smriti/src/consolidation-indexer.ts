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
import { packCuratedSummaryText } from "./pakt-compression.js";
import { vectorToBlob, blobToVector } from "./recall.js";
import { cosineSimilarity } from "./recall-scoring.js";
import {
	parseConsolidationMetadata,
} from "./consolidation-provenance.js";
import {
	buildArtifactContentHash,
	buildConsolidationEmbeddingId,
	buildConsolidationSourceId,
	extractSummaryText,
	listCuratedConsolidationArtifacts,
	type ConsolidationLevel,
	type ConsolidationSummaryIndex,
	type ConsolidationVectorSyncIssue,
	type ConsolidationVectorSyncStatus,
	type CuratedConsolidationArtifact,
	type CuratedConsolidationArtifactQuery,
} from "./consolidation-indexer-artifacts.js";

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

// ─── Embedding helper ────────────────────────────────────────────────────────

let _embeddingService: EmbeddingService | null = null;

function getEmbeddingService(): EmbeddingService {
	if (!_embeddingService) {
		_embeddingService = new EmbeddingService();
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

interface EmbeddingRow {
	id: string;
	vector: Buffer;
	text: string;
	source_type: string;
	source_id: string;
	metadata: string | null;
}

function parseEmbeddingMetadata(
	row: Pick<EmbeddingRow, "metadata"> | undefined,
): Record<string, unknown> {
	if (!row?.metadata) return {};
	try {
		return JSON.parse(row.metadata) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function inspectArtifacts(
	artifacts: readonly CuratedConsolidationArtifact[],
	rowsById: Map<string, EmbeddingRow>,
): ConsolidationVectorSyncStatus {
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
		}
	}
	return {
		scanned: artifacts.length,
		missingCount,
		driftCount,
		issues,
	};
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
): Promise<void> {
	const summaryText = extractSummaryText(markdown, level);
	if (!summaryText || summaryText.length < 10) return;
	const compression = await packCuratedSummaryText(summaryText);
	const packedSummaryText = compression?.packedText;
	const provenance = parseConsolidationMetadata(markdown);
	const contentHash = buildArtifactContentHash(summaryText);
	const sourceSessionIds =
		provenance && "sourceSessionIds" in provenance ? provenance.sourceSessionIds : [];
	const sourcePeriods =
		provenance && "sourcePeriods" in provenance ? provenance.sourcePeriods : [];

	// Generate embedding
	let embedding: number[];
	try {
		const svc = getEmbeddingService();
		embedding = await svc.getEmbedding(summaryText);
	} catch {
		embedding = fallbackEmbedding(summaryText);
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
						packedSummaryText: packedSummaryText ?? null,
						compression: compression ?? null,
						generatedAt: provenance?.generatedAt ?? null,
						sourceSessionIds,
						sourcePeriods,
					}),
				Date.now(),
			);
		} catch {
			// Best-effort — don't break consolidation if vector indexing fails
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

	// Generate query embedding
	let queryEmbedding: number[];
	try {
		const svc = getEmbeddingService();
		queryEmbedding = await svc.getEmbedding(query);
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
			// Parse metadata for project filtering
			let meta: { level?: string; period?: string; project?: string | null } = {};
			try { meta = JSON.parse(row.metadata ?? "{}"); } catch { /* skip */ }

			// Filter by project if specified
			if (options?.project && meta.project && meta.project !== options.project) continue;

			const vector = blobToVector(row.vector);
			const score = cosineSimilarity(queryEmbedding, vector);

			if (score > 0.1) {
				scored.push({
					period: meta.period ?? row.source_id,
					score,
					snippet: row.text.slice(0, 300),
					project: meta.project ?? undefined,
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
		return inspectArtifacts(artifacts, new Map(rows.map((row) => [row.id, row])));
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
	const status = inspectArtifacts(artifacts, new Map(rows.map((row) => [row.id, row])));
	if (status.issues.length === 0) return { status, reindexed: 0 };

	const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
	let reindexed = 0;
	for (const issue of status.issues) {
		const artifact = artifactsById.get(issue.id);
		if (!artifact) continue;
		await indexConsolidationSummary(
			artifact.level,
			artifact.period,
			artifact.markdown,
			artifact.project,
		);
	}
	const repairedStatus = await inspectConsolidationVectorSync(options);
	reindexed = Math.max(0, status.issues.length - repairedStatus.issues.length);
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
