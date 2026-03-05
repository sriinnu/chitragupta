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

/** Query temporal patterns — entities by hour-of-day and day-of-week from akasha traces. */
export function queryTemporalPatterns(
	db: TranscendenceDb,
	ts: number,
): TemporalPattern[] {
	const now = new Date(ts);
	const hour = now.getHours();
	const dayOfWeek = now.getDay();

	try {
		const rows = db.prepare(`
			SELECT topic AS entity, agent_id AS session_id,
			       CAST(strftime('%H', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
			       CAST(strftime('%w', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS day_of_week
			FROM akasha_traces
			WHERE CAST(strftime('%H', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) BETWEEN ? AND ?
			  AND CAST(strftime('%w', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) = ?
			ORDER BY created_at DESC
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

/** Query entity co-occurrences from akasha traces within time proximity. */
export function queryCoOccurrences(
	db: TranscendenceDb,
	config: TranscendenceConfig,
): CoOccurrence[] {
	try {
		const rows = db.prepare(`
			SELECT a.topic AS entity_a, b.topic AS entity_b, COUNT(*) AS cnt
			FROM akasha_traces a
			JOIN akasha_traces b ON a.id != b.id
			  AND a.topic != b.topic
			  AND a.created_at BETWEEN b.created_at - 3600000 AND b.created_at + 3600000
			GROUP BY a.topic, b.topic
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
				strength: r.cnt / (entityTotals.get(r.entity_a) ?? r.cnt),
				count: r.cnt,
			}))
			.filter((co) => co.strength >= config.minCoOccurrence);
	} catch {
		return [];
	}
}

/** Query recent akasha trace topics for continuation predictions. */
export function queryRecentMemory(
	db: TranscendenceDb,
	ts: number,
): Array<{ entity: string; last_seen: string }> {
	try {
		return db.prepare(`
			SELECT topic AS entity, MAX(created_at) AS last_seen
			FROM akasha_traces
			WHERE created_at >= ?
			GROUP BY topic
			ORDER BY last_seen DESC
			LIMIT 5
		`).all(ts - 3_600_000) as Array<{
			entity: string;
			last_seen: string;
		}>;
	} catch {
		return [];
	}
}
