/**
 * @chitragupta/netra — PageRank Algorithm.
 *
 * Simple iterative PageRank implementation for ranking files by importance
 * in an import graph. Files imported by many other files score higher.
 *
 * Based on the original PageRank paper by Brin & Page (1998).
 * Used by Aider and proven effective by ContextBench (ArXiv 2602.05892).
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Options for the PageRank algorithm. */
export interface PageRankOptions {
	/** Damping factor (probability of following a link). Default: 0.85. */
	dampingFactor?: number;
	/** Number of iterations. Default: 20. */
	iterations?: number;
	/** Convergence threshold — stop early if max rank change < this. Default: 1e-6. */
	convergenceThreshold?: number;
}

/** Result of PageRank computation. */
export interface PageRankResult {
	/** Map of node → PageRank score (normalized to sum to 1). */
	scores: Map<string, number>;
	/** Number of iterations actually performed. */
	iterationsRun: number;
	/** Whether the algorithm converged before max iterations. */
	converged: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DAMPING = 0.85;
const DEFAULT_ITERATIONS = 20;
const DEFAULT_CONVERGENCE = 1e-6;

// ─── Algorithm ──────────────────────────────────────────────────────────────

/**
 * Compute PageRank scores for nodes in a directed graph.
 *
 * The graph is represented as an adjacency list: each node maps to the
 * list of nodes it points to (outbound edges). In the import graph context,
 * this means "file A imports files [B, C, D]".
 *
 * Files imported by many others will rank higher because they receive
 * more "votes" from their importers.
 *
 * @param graph - Adjacency list: node → outbound neighbors.
 * @param options - Algorithm parameters.
 * @returns PageRank scores and convergence info.
 */
export function computePageRank(
	graph: Map<string, string[]>,
	options?: PageRankOptions,
): PageRankResult {
	const damping = options?.dampingFactor ?? DEFAULT_DAMPING;
	const maxIter = options?.iterations ?? DEFAULT_ITERATIONS;
	const threshold = options?.convergenceThreshold ?? DEFAULT_CONVERGENCE;

	const nodes = [...graph.keys()];
	const n = nodes.length;

	if (n === 0) {
		return { scores: new Map(), iterationsRun: 0, converged: true };
	}

	// Initialize uniform scores
	const scores = new Map<string, number>();
	const initialScore = 1 / n;
	for (const node of nodes) {
		scores.set(node, initialScore);
	}

	// Build reverse adjacency (inbound edges) for efficient iteration
	const inbound = new Map<string, string[]>();
	for (const node of nodes) {
		inbound.set(node, []);
	}
	for (const [source, targets] of graph) {
		for (const target of targets) {
			const ins = inbound.get(target);
			if (ins) {
				ins.push(source);
			}
		}
	}

	// Precompute outbound degree for each node
	const outDegree = new Map<string, number>();
	for (const [node, targets] of graph) {
		outDegree.set(node, targets.length);
	}

	// Iterative PageRank
	const basePortion = (1 - damping) / n;
	let converged = false;
	let iter = 0;

	for (iter = 0; iter < maxIter; iter++) {
		let maxDelta = 0;

		// Collect dangling node rank (nodes with no outbound edges)
		let danglingSum = 0;
		for (const node of nodes) {
			if ((outDegree.get(node) ?? 0) === 0) {
				danglingSum += scores.get(node) ?? 0;
			}
		}
		const danglingContribution = damping * danglingSum / n;

		const newScores = new Map<string, number>();
		for (const node of nodes) {
			let inboundSum = 0;
			const importers = inbound.get(node) ?? [];
			for (const importer of importers) {
				const importerScore = scores.get(importer) ?? 0;
				const importerOut = outDegree.get(importer) ?? 1;
				inboundSum += importerScore / importerOut;
			}

			const newScore = basePortion + damping * inboundSum + danglingContribution;
			newScores.set(node, newScore);

			const delta = Math.abs(newScore - (scores.get(node) ?? 0));
			if (delta > maxDelta) maxDelta = delta;
		}

		// Update scores
		for (const [node, score] of newScores) {
			scores.set(node, score);
		}

		if (maxDelta < threshold) {
			converged = true;
			iter++;
			break;
		}
	}

	return { scores, iterationsRun: iter, converged };
}

/**
 * Normalize PageRank scores to [0, 1] range based on min/max.
 *
 * Useful for display and for combining with other ranking signals.
 *
 * @param scores - Raw PageRank scores.
 * @returns Normalized scores where highest = 1.0, lowest = 0.0.
 */
export function normalizeScores(scores: Map<string, number>): Map<string, number> {
	if (scores.size === 0) return new Map();

	let min = Infinity;
	let max = -Infinity;
	for (const score of scores.values()) {
		if (score < min) min = score;
		if (score > max) max = score;
	}

	const range = max - min;
	const normalized = new Map<string, number>();
	for (const [node, score] of scores) {
		normalized.set(node, range > 0 ? (score - min) / range : 0.5);
	}
	return normalized;
}
