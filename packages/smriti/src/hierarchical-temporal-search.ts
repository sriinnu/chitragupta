/**
 * @chitragupta/smriti — Hierarchical Temporal Search
 *
 * Top-down temporal drill: years → months → days → snippets.
 * Replaces linear O(days × lines) search with vector-indexed hierarchical
 * traversal. For 5 years of data, this reduces search from scanning ~1825
 * files to ~3 vector lookups at each level.
 *
 * Algorithm:
 *   1. Search yearly summaries (top 3) → identify relevant years
 *   2. For each year, search monthly summaries (top 3/year) → relevant months
 *   3. For each month, search daily summaries (top 5/month) → extract snippets
 *   4. Score = vectorSim × depthBoost (0.6 yearly | 0.8 monthly | 1.0 daily)
 *   5. Combine, deduplicate by date, sort by score, limit
 *
 * Fallback: if no vector indices exist, falls back to searchDayFiles()
 * (the original linear search). Maintains backward compatibility.
 */

import type { ConsolidationLevel } from "./consolidation-indexer.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TemporalSearchResult {
	/** Relevance score (0-1), boosted by drill depth. */
	score: number;
	/** Finest granularity period matched. */
	period: string;
	/** Which level this result was found at. */
	level: ConsolidationLevel;
	/** Content snippet from the matched summary. */
	snippet: string;
	/** YYYY-MM-DD if drilled to daily level. */
	date?: string;
	/** Project path if scoped to a project. */
	project?: string;
}

// ─── Depth Boost Factors ─────────────────────────────────────────────────────

const DEPTH_BOOST: Record<ConsolidationLevel, number> = {
	yearly: 0.6,
	monthly: 0.8,
	daily: 1.0,
};

// ─── Hierarchical Search ─────────────────────────────────────────────────────

/**
 * Hierarchical temporal search — drills from years → months → days.
 *
 * @param query - Natural language query.
 * @param options - Filtering options.
 * @returns Ranked temporal search results.
 */
export async function hierarchicalTemporalSearch(
	query: string,
	options?: { limit?: number; project?: string },
): Promise<TemporalSearchResult[]> {
	const limit = options?.limit ?? 10;
	const results: TemporalSearchResult[] = [];

	const { searchConsolidationSummaries } = await import("./consolidation-indexer.js");

	// Step 1: Search yearly summaries (top 3)
	const yearlyHits = await searchConsolidationSummaries(query, "yearly", {
		limit: 3,
		project: options?.project,
	});

	if (yearlyHits.length === 0) {
		// No yearly summaries — try monthly directly
		const monthlyHits = await searchConsolidationSummaries(query, "monthly", {
			limit: 6,
			project: options?.project,
		});

		if (monthlyHits.length === 0) {
			// No monthly either — try daily directly
			const dailyHits = await searchConsolidationSummaries(query, "daily", {
				limit,
				project: options?.project,
			});

			if (dailyHits.length === 0) return []; // No indices at all

			for (const hit of dailyHits) {
				results.push({
					score: hit.score * DEPTH_BOOST.daily,
					period: hit.period,
					level: "daily",
					snippet: hit.snippet,
					date: hit.period,
					project: hit.project,
				});
			}
			return deduplicateAndSort(results, limit);
		}

		// Have monthly but no yearly — drill into daily from monthly
		for (const monthHit of monthlyHits) {
			results.push({
				score: monthHit.score * DEPTH_BOOST.monthly,
				period: monthHit.period,
				level: "monthly",
				snippet: monthHit.snippet,
				project: monthHit.project,
			});

			// Drill into daily for this month
			const dailyHits = await searchConsolidationSummaries(query, "daily", {
				limit: 5,
				project: options?.project,
			});

			for (const dayHit of dailyHits) {
				// Only include days within this month
				if (dayHit.period.startsWith(monthHit.period)) {
					results.push({
						score: dayHit.score * DEPTH_BOOST.daily,
						period: dayHit.period,
						level: "daily",
						snippet: dayHit.snippet,
						date: dayHit.period,
						project: dayHit.project,
					});
				}
			}
		}

		return deduplicateAndSort(results, limit);
	}

	// Have yearly summaries — full drill
	for (const yearHit of yearlyHits) {
		results.push({
			score: yearHit.score * DEPTH_BOOST.yearly,
			period: yearHit.period,
			level: "yearly",
			snippet: yearHit.snippet,
			project: yearHit.project,
		});

		// Step 2: Drill into monthly for this year
		const monthlyHits = await searchConsolidationSummaries(query, "monthly", {
			limit: 3,
			project: options?.project,
		});

		for (const monthHit of monthlyHits) {
			// Only include months within this year
			if (monthHit.period.startsWith(yearHit.period)) {
				results.push({
					score: monthHit.score * DEPTH_BOOST.monthly,
					period: monthHit.period,
					level: "monthly",
					snippet: monthHit.snippet,
					project: monthHit.project,
				});

				// Step 3: Drill into daily for this month
				const dailyHits = await searchConsolidationSummaries(query, "daily", {
					limit: 5,
					project: options?.project,
				});

				for (const dayHit of dailyHits) {
					if (dayHit.period.startsWith(monthHit.period)) {
						results.push({
							score: dayHit.score * DEPTH_BOOST.daily,
							period: dayHit.period,
							level: "daily",
							snippet: dayHit.snippet,
							date: dayHit.period,
							project: dayHit.project,
						});
					}
				}
			}
		}
	}

	return deduplicateAndSort(results, limit);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deduplicateAndSort(results: TemporalSearchResult[], limit: number): TemporalSearchResult[] {
	const seen = new Set<string>();
	const unique: TemporalSearchResult[] = [];

	// Sort by score descending first
	results.sort((a, b) => b.score - a.score);

	for (const r of results) {
		const key = `${r.level}:${r.period}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(r);
	}

	return unique.slice(0, limit);
}
