/**
 * @chitragupta/smriti — GraphRAG PageRank algorithm.
 *
 * Iterative power-method PageRank with configurable damping factor,
 * convergence threshold, and dangling node redistribution.
 */

import type { KnowledgeGraph } from "./types.js";

// ─── PageRank Parameters ────────────────────────────────────────────────────

/** Damping factor for PageRank. Standard value from the original paper. */
const PAGERANK_DAMPING = 0.85;
/** Convergence threshold. Iteration stops when max rank change < this value. */
const PAGERANK_EPSILON = 0.0001;
/** Maximum number of PageRank iterations. */
const PAGERANK_MAX_ITERATIONS = 100;

// ─── PageRank Algorithm ─────────────────────────────────────────────────────

/**
 * Compute PageRank scores for all nodes in the knowledge graph.
 *
 * Uses the iterative power-method PageRank algorithm:
 *   PR(v) = (1 - d) / N + d * sum(PR(u) / L(u)) for all u linking to v
 *
 * where d = damping factor (0.85), N = total nodes, L(u) = out-degree of u.
 *
 * Iterates until convergence (max delta < epsilon) or max iterations reached.
 *
 * @param graph - The knowledge graph to compute PageRank for.
 * @returns A map of node IDs to their PageRank scores.
 */
export function computePageRank(graph: KnowledgeGraph): Map<string, number> {
  const N = graph.nodes.length;
  if (N === 0) return new Map();

  // Initialize all ranks to 1/N
  const ranks = new Map<string, number>();
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    ranks.set(node.id, 1 / N);
    nodeIds.add(node.id);
  }

  // Build adjacency: outLinks[source] = set of targets, inLinks[target] = set of sources
  const outDegree = new Map<string, number>();
  const inLinks = new Map<string, string[]>();

  for (const node of graph.nodes) {
    outDegree.set(node.id, 0);
    inLinks.set(node.id, []);
  }

  for (const edge of graph.edges) {
    // Only count edges where both endpoints exist in the graph
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
      inLinks.get(edge.target)!.push(edge.source);
    }
  }

  // Iterative PageRank
  const baseFactor = (1 - PAGERANK_DAMPING) / N;

  for (let iteration = 0; iteration < PAGERANK_MAX_ITERATIONS; iteration++) {
    const newRanks = new Map<string, number>();
    let maxDelta = 0;

    // Collect dangling node rank (nodes with no outgoing edges)
    let danglingRank = 0;
    for (const node of graph.nodes) {
      if ((outDegree.get(node.id) ?? 0) === 0) {
        danglingRank += ranks.get(node.id) ?? 0;
      }
    }

    for (const node of graph.nodes) {
      let incomingRank = 0;

      // Sum contributions from all nodes linking to this one
      const sources = inLinks.get(node.id) ?? [];
      for (const source of sources) {
        const sourceRank = ranks.get(source) ?? 0;
        const sourceOut = outDegree.get(source) ?? 1;
        incomingRank += sourceRank / sourceOut;
      }

      // Distribute dangling rank evenly across all nodes
      const rank = baseFactor + PAGERANK_DAMPING * (incomingRank + danglingRank / N);
      newRanks.set(node.id, rank);

      const delta = Math.abs(rank - (ranks.get(node.id) ?? 0));
      if (delta > maxDelta) maxDelta = delta;
    }

    // Update ranks
    for (const [id, rank] of newRanks) {
      ranks.set(id, rank);
    }

    // Check for convergence
    if (maxDelta < PAGERANK_EPSILON) break;
  }

  return ranks;
}

/**
 * Get the PageRank score for a specific node from a precomputed scores map.
 * Returns 0 if no PageRank has been computed or the node is not found.
 */
export function getPageRank(scores: Map<string, number>, nodeId: string): number {
  return scores.get(nodeId) ?? 0;
}
