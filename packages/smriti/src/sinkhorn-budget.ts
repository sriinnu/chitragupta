/**
 * @chitragupta/smriti — mHC-Style Token Budget Allocation.
 *
 * Allocates token budgets across session chunks using a hierarchical affinity
 * matrix solved by the accelerated Sinkhorn-Knopp algorithm from
 * `sinkhorn-accelerated.ts`.
 *
 * The modified Hierarchical Compaction (mHC) strategy:
 * 1. Groups chunks by topic — chunks sharing a topic form a cluster.
 * 2. Builds a hierarchical affinity matrix using recency, relevance,
 *    importance, and same-topic bonuses.
 * 3. Runs accelerated SK on the affinity matrix.
 * 4. Derives per-chunk budgets from row sums weighted by composite scores.
 */

import { sinkhornAccelerated } from "./sinkhorn-accelerated.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A chunk of session content with multi-dimensional quality scores. */
export interface SessionChunk {
	/** Unique identifier for this chunk. */
	id: string;
	/** Recency score in [0, 1]. 1 = most recent. */
	recency: number;
	/** Relevance score in [0, 1]. 1 = most relevant to current topic. */
	relevance: number;
	/** Importance score in [0, 1]. 1 = most important (decisions, errors). */
	importance: number;
	/** Optional topic label for hierarchical grouping. */
	topic?: string;
	/** Current token count of this chunk. */
	tokenCount: number;
}

// ─── mHC Token Budget Allocation ─────────────────────────────────────────────

/**
 * Allocate token budgets across session chunks using a hierarchical affinity
 * matrix solved by the accelerated Sinkhorn-Knopp algorithm.
 *
 * This implements a modified Hierarchical Compaction (mHC) strategy:
 *
 * 1. **Group chunks by topic** — chunks sharing a topic form a cluster.
 *    Singleton topics form their own cluster.
 *
 * 2. **Build hierarchical affinity matrix** — For each pair of chunks (i, j):
 *
 *        A_ij = w_r * min(recency_i, recency_j)
 *             + w_v * (relevance_i * relevance_j)
 *             + w_m * max(importance_i, importance_j)
 *             + w_t * sameTopicBonus(i, j)
 *
 *    where w_r=0.3, w_v=0.3, w_m=0.25, w_t=0.15.
 *    Same-topic bonus = 0.5 if topics match, 0 otherwise.
 *
 * 3. **Run accelerated SK** on the affinity matrix to get a doubly stochastic
 *    allocation matrix.
 *
 * 4. **Derive per-chunk budgets** from row sums of the allocation matrix,
 *    weighted by each chunk's composite score. The total is normalized to
 *    exactly `totalBudget`.
 *
 * @param chunks - Session chunks with quality scores.
 * @param totalBudget - Total token budget to distribute.
 * @returns Map from chunk ID to allocated token budget.
 */
export function computeTokenBudgetsMHC(
	chunks: SessionChunk[],
	totalBudget: number,
): Map<string, number> {
	const result = new Map<string, number>();
	const n = chunks.length;

	if (n === 0) return result;

	if (n === 1) {
		result.set(chunks[0].id, totalBudget);
		return result;
	}

	// Weight constants for the affinity computation
	const W_RECENCY = 0.30;
	const W_RELEVANCE = 0.30;
	const W_IMPORTANCE = 0.25;
	const W_TOPIC = 0.15;
	const TOPIC_BONUS = 0.5;

	// Build the NxN hierarchical affinity matrix
	const affinity: number[][] = [];
	for (let i = 0; i < n; i++) {
		const row: number[] = new Array(n);
		const ci = chunks[i];
		for (let j = 0; j < n; j++) {
			const cj = chunks[j];
			const recencyAff = Math.min(ci.recency, cj.recency);
			const relevanceAff = ci.relevance * cj.relevance;
			const importanceAff = Math.max(ci.importance, cj.importance);
			const topicBonus =
				ci.topic && cj.topic && ci.topic === cj.topic ? TOPIC_BONUS : 0;

			row[j] =
				W_RECENCY * recencyAff +
				W_RELEVANCE * relevanceAff +
				W_IMPORTANCE * importanceAff +
				W_TOPIC * topicBonus;

			// Ensure strictly positive for SK convergence
			if (row[j] < 1e-6) row[j] = 1e-6;
		}
		affinity.push(row);
	}

	// Run accelerated Sinkhorn-Knopp
	const { result: dsMatrix } = sinkhornAccelerated(affinity, {
		maxIterations: 150,
		epsilon: 1e-6,
	});

	// Compute composite score per chunk
	const composites: number[] = new Array(n);
	for (let i = 0; i < n; i++) {
		const c = chunks[i];
		composites[i] = 0.35 * c.recency + 0.35 * c.relevance + 0.30 * c.importance;
	}

	// Derive budget: row sum of DS matrix * composite score
	const rawBudgets: number[] = new Array(n);
	let rawTotal = 0;
	for (let i = 0; i < n; i++) {
		let rowSum = 0;
		for (let j = 0; j < n; j++) rowSum += dsMatrix[i][j];
		rawBudgets[i] = rowSum * composites[i];
		rawTotal += rawBudgets[i];
	}

	// Normalize to totalBudget with integer token counts
	if (rawTotal === 0) {
		const equal = Math.floor(totalBudget / n);
		for (let i = 0; i < n; i++) result.set(chunks[i].id, equal);
		// Distribute remainder
		let rem = totalBudget - equal * n;
		for (let i = 0; rem > 0; i++, rem--) {
			result.set(chunks[i].id, (result.get(chunks[i].id) ?? 0) + 1);
		}
		return result;
	}

	let allocated = 0;
	for (let i = 0; i < n; i++) {
		const budget = Math.floor((rawBudgets[i] / rawTotal) * totalBudget);
		result.set(chunks[i].id, budget);
		allocated += budget;
	}

	// Distribute integer rounding remainder to highest-composite chunks first
	let remainder = totalBudget - allocated;
	const sortedIndices = composites
		.map((c, i) => ({ composite: c, index: i }))
		.sort((a, b) => b.composite - a.composite)
		.map((x) => x.index);

	for (const idx of sortedIndices) {
		if (remainder <= 0) break;
		const id = chunks[idx].id;
		result.set(id, (result.get(id) ?? 0) + 1);
		remainder--;
	}

	return result;
}
