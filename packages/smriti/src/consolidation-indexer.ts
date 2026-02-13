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

import { DatabaseManager } from "./db/database.js";
import { initVectorsSchema } from "./db/schema.js";
import { EmbeddingService, fallbackEmbedding } from "./embedding-service.js";
import { vectorToBlob, blobToVector } from "./recall.js";
import { cosineSimilarity } from "./recall-scoring.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConsolidationLevel = "daily" | "monthly" | "yearly";

export interface ConsolidationSummaryIndex {
	level: ConsolidationLevel;
	period: string;         // "YYYY-MM-DD" | "YYYY-MM" | "YYYY"
	project?: string;       // undefined for cross-project day files
	embedding: number[];
	summaryText: string;
}

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

/** Build a stable ID for a consolidation summary embedding. */
function buildEmbeddingId(level: ConsolidationLevel, period: string, project?: string): string {
	const suffix = project ? `-${fnvHash4(project)}` : "";
	return `${level}_summary:${period}${suffix}`;
}

/** FNV-1a 4-char hex hash (same as periodic-consolidation.ts). */
function fnvHash4(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	return (h >>> 0).toString(16).slice(0, 4);
}

// ─── Extract Summary Text ────────────────────────────────────────────────────

/**
 * Extract high-signal text from consolidation markdown for embedding.
 * Strips formatting, focuses on semantic content per level.
 */
export function extractSummaryText(markdown: string, level: ConsolidationLevel): string {
	const lines = markdown.split("\n");
	const parts: string[] = [];

	if (level === "daily") {
		// Daily: header + facts + topics + decisions (skip raw tool lists)
		for (const line of lines) {
			const trimmed = line.trim();
			// Strip leading "- " for bullet points
			const stripped = trimmed.replace(/^-\s*/, "");
			// Keep headers, facts, decisions, topics, errors, prefs
			if (trimmed.startsWith("# ") || trimmed.startsWith("## ")) {
				parts.push(trimmed.replace(/^#+\s*/, ""));
			} else if (stripped.startsWith("**Fact**:") || stripped.startsWith("**Decision**:") ||
				stripped.startsWith("**Pref**:") || stripped.startsWith("**Error**:") ||
				stripped.startsWith("**Topic**:") || stripped.startsWith("**Q**:")) {
				parts.push(stripped.replace(/\*\*/g, ""));
			} else if (trimmed.startsWith("- [") && trimmed.includes("]")) {
				// Fact lines like "- [preference] user prefers..."
				parts.push(stripped);
			} else if (trimmed.startsWith("**Topics**:")) {
				parts.push(trimmed.replace(/\*\*/g, ""));
			} else if (trimmed.startsWith(">") && !trimmed.includes("sessions |")) {
				// Narrative summaries (skip stats line)
				parts.push(trimmed.replace(/^>\s*/, ""));
			}
		}
	} else if (level === "monthly") {
		// Monthly: header + key metrics + vasana names + recommendations
		let inRecommendations = false;
		let inVasanas = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("# ")) {
				parts.push(trimmed.replace(/^#+\s*/, ""));
			} else if (trimmed.startsWith("- **Sessions**:") || trimmed.startsWith("- **Turns**:") ||
				trimmed.startsWith("- **Estimated Cost**:")) {
				parts.push(trimmed.replace(/^-\s*/, "").replace(/\*\*/g, ""));
			}
			if (trimmed === "## Recommendations") inRecommendations = true;
			else if (trimmed.startsWith("## ") && inRecommendations) inRecommendations = false;
			if (inRecommendations && trimmed.startsWith("- ")) {
				parts.push(trimmed.replace(/^-\s*/, ""));
			}
			if (trimmed === "## Vasanas Crystallized") inVasanas = true;
			else if (trimmed.startsWith("## ") && trimmed !== "## Vasanas Crystallized") inVasanas = false;
			if (inVasanas && trimmed.startsWith("|") && !trimmed.startsWith("|--") && !trimmed.startsWith("| Tendency")) {
				const cells = trimmed.split("|").filter(Boolean).map((c) => c.trim());
				if (cells[0]) parts.push(`Vasana: ${cells[0]}`);
			}
		}
	} else {
		// Yearly: header + annual summary + trends + top decisions
		let inTrends = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith("# ") || trimmed.startsWith("## Annual Summary")) {
				parts.push(trimmed.replace(/^#+\s*/, ""));
			} else if (trimmed.startsWith("- **Sessions**:") || trimmed.startsWith("- **Vasanas Crystallized**:")) {
				parts.push(trimmed.replace(/^-\s*/, "").replace(/\*\*/g, ""));
			}
			if (trimmed === "## Trends") inTrends = true;
			else if (trimmed.startsWith("## ") && trimmed !== "## Trends") inTrends = false;
			if (inTrends && trimmed.startsWith("- ")) {
				parts.push(trimmed.replace(/^-\s*/, ""));
			}
		}
	}

	return parts.join(" ").slice(0, 2000);
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

	// Generate embedding
	let embedding: number[];
	try {
		const svc = getEmbeddingService();
		embedding = await svc.getEmbedding(summaryText);
	} catch {
		embedding = fallbackEmbedding(summaryText);
	}

	const id = buildEmbeddingId(level, period, project);
	const sourceType = `${level}_summary`;
	const sourceId = project ? `${period}-${fnvHash4(project)}` : period;

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
			JSON.stringify({ level, period, project: project ?? null }),
			Date.now(),
		);
	} catch {
		// Best-effort — don't break consolidation if vector indexing fails
	}
}

// ─── Search Consolidation Summaries ──────────────────────────────────────────

interface EmbeddingRow {
	id: string;
	vector: Buffer;
	text: string;
	source_type: string;
	source_id: string;
	metadata: string | null;
}

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
			const { listDayFiles, readDayFile } = await import("./day-consolidation.js");
			const dayFiles = listDayFiles();

			for (const date of dayFiles) {
				const id = buildEmbeddingId("daily", date);
				if (existing.has(id)) continue;

				const content = readDayFile(date);
				if (content && content.length > 20) {
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
					const id = buildEmbeddingId(level, report.period, project);
					if (existing.has(id)) continue;

					try {
						const fs = await import("node:fs");
						const content = fs.readFileSync(report.path, "utf-8");
						if (content && content.length > 20) {
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
