/**
 * Transcendence — Helper Functions
 *
 * Pure utility functions for the Transcendence predictive context engine.
 * Extracted to keep main engine under 450 LOC.
 *
 * @module transcendence-helpers
 */

import type {
	ContextPrediction,
	TemporalPattern,
	CoOccurrence,
	TranscendenceDb,
	SessionEntityRow,
	CoOccurrenceRow,
	TranscendenceConfig,
} from "./transcendence-types.js";

// ─── Pure Functions ─────────────────────────────────────────────────────────

/** Clamp a value to [0, 1]. */
export function clamp(v: number): number {
	return Math.max(0, Math.min(1, v));
}

/** Deduplicate predictions by entity, keeping highest confidence. */
export function deduplicatePredictions(preds: ContextPrediction[]): ContextPrediction[] {
	const best = new Map<string, ContextPrediction>();
	for (const p of preds) {
		const key = p.entity.toLowerCase();
		const existing = best.get(key);
		if (!existing || p.confidence > existing.confidence) {
			best.set(key, p);
		}
	}
	return [...best.values()];
}

/** Jaccard similarity between two token sets. */
export function jaccardSimilarity(a: string[], b: string[]): number {
	const setA = new Set(a.map((s) => s.toLowerCase()));
	const setB = new Set(b.map((s) => s.toLowerCase()));
	let intersection = 0;
	for (const s of setA) if (setB.has(s)) intersection++;
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

// ─── Database Queries ───────────────────────────────────────────────────────

/** Query temporal patterns — entities by hour-of-day and day-of-week. */
export function queryTemporalPatterns(
	db: TranscendenceDb,
	ts: number,
): TemporalPattern[] {
	const now = new Date(ts);
	const hour = now.getHours();
	const dayOfWeek = now.getDay();

	try {
		const rows = db.prepare(`
			SELECT content AS entity, session_id,
			       CAST(strftime('%H', updated_at) AS INTEGER) AS hour,
			       CAST(strftime('%w', updated_at) AS INTEGER) AS day_of_week
			FROM memory
			WHERE scope = 'project'
			  AND CAST(strftime('%H', updated_at) AS INTEGER) BETWEEN ? AND ?
			  AND CAST(strftime('%w', updated_at) AS INTEGER) = ?
			ORDER BY updated_at DESC
			LIMIT 20
		`).all(Math.max(0, hour - 1), Math.min(23, hour + 1), dayOfWeek) as SessionEntityRow[];

		if (rows.length === 0) return [];

		const entityCounts = new Map<string, number>();
		for (const r of rows) {
			entityCounts.set(r.entity, (entityCounts.get(r.entity) ?? 0) + 1);
		}

		return [{
			hour,
			dayOfWeek,
			entities: [...entityCounts.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([e]) => e),
			observations: rows.length,
		}];
	} catch {
		return [];
	}
}

/** Query entity co-occurrences from session history. */
export function queryCoOccurrences(
	db: TranscendenceDb,
	config: TranscendenceConfig,
): CoOccurrence[] {
	try {
		const rows = db.prepare(`
			SELECT a.content AS entity_a, b.content AS entity_b, COUNT(*) AS cnt
			FROM memory a
			JOIN memory b ON a.scope = b.scope
			  AND a.key != b.key
			  AND a.content != b.content
			  AND a.updated_at BETWEEN datetime(b.updated_at, '-1 hour')
			      AND datetime(b.updated_at, '+1 hour')
			WHERE a.scope = 'project'
			GROUP BY a.content, b.content
			HAVING cnt >= 2
			ORDER BY cnt DESC
			LIMIT 20
		`).all() as CoOccurrenceRow[];

		const entityTotals = new Map<string, number>();
		for (const r of rows) {
			entityTotals.set(r.entity_a, (entityTotals.get(r.entity_a) ?? 0) + r.cnt);
		}

		return rows
			.map((r) => ({
				entityA: r.entity_a,
				entityB: r.entity_b,
				probability: r.cnt / (entityTotals.get(r.entity_a) ?? r.cnt),
				count: r.cnt,
			}))
			.filter((co) => co.probability >= config.minCoOccurrence);
	} catch {
		return [];
	}
}

/** Query recent memory entries for continuation predictions. */
export function queryRecentMemory(
	db: TranscendenceDb,
	ts: number,
): Array<{ entity: string; last_seen: string }> {
	try {
		return db.prepare(`
			SELECT content AS entity, MAX(updated_at) AS last_seen
			FROM memory
			WHERE scope = 'project'
			  AND updated_at >= ?
			GROUP BY content
			ORDER BY last_seen DESC
			LIMIT 5
		`).all(new Date(ts - 3_600_000).toISOString()) as Array<{
			entity: string;
			last_seen: string;
		}>;
	} catch {
		return [];
	}
}
