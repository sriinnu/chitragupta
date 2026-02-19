/**
 * @chitragupta/smriti — Incremental PageRank with push-based residual propagation.
 *
 * When a single edge is added or removed, instead of recomputing PageRank
 * from scratch, this module propagates residuals through the graph:
 *
 *     residual[v] += delta
 *     while max(|residual|) > epsilon:
 *         v = argmax(|residual|)
 *         PR[v] += residual[v]
 *         for each neighbor u of v:
 *             residual[u] += d * residual[v] / L(v)
 *         residual[v] = 0
 *
 * Complexity: O(1/epsilon) per edge change, independent of graph size N.
 * This is dramatically faster than O(N * iterations) for full recompute,
 * making it ideal for dynamic knowledge graphs where edges change frequently.
 *
 * Split from graphrag-pagerank-personalized.ts for module size compliance.
 */

import type { KnowledgeGraph } from "./types.js";
import { computePersonalizedPageRank } from "./graphrag-pagerank-personalized.js";

/**
 * Incremental PageRank that efficiently handles single-edge additions and
 * removals without full recomputation.
 *
 * Uses a push-based residual propagation scheme. When an edge is added or
 * removed, a residual is injected at the affected node and propagated along
 * the graph until all residuals fall below epsilon.
 *
 * Complexity: O(1/epsilon) per edge change, independent of graph size N.
 * This is dramatically faster than O(N * iterations) for full recompute,
 * making it ideal for dynamic knowledge graphs where edges change frequently.
 */
export class IncrementalPageRank {
	private ranks = new Map<string, number>();
	private outDegree = new Map<string, number>();
	private inLinks = new Map<string, Set<string>>();
	/** Forward adjacency list: source -> Set<target>. Avoids O(E) reverse lookup in getOutNeighbors(). */
	private outLinks = new Map<string, Set<string>>();
	private nodeSet = new Set<string>();
	private damping: number;
	private epsilon: number;

	constructor(damping: number = 0.85, epsilon: number = 1e-6) {
		this.damping = damping;
		this.epsilon = epsilon;
	}

	/**
	 * Initialize from a knowledge graph. Computes full PageRank once.
	 *
	 * @param graph - Initial knowledge graph.
	 */
	initialize(graph: KnowledgeGraph): void {
		this.nodeSet.clear();
		this.outDegree.clear();
		this.inLinks.clear();
		this.outLinks.clear();

		for (const node of graph.nodes) {
			this.nodeSet.add(node.id);
			this.outDegree.set(node.id, 0);
			this.inLinks.set(node.id, new Set());
			this.outLinks.set(node.id, new Set());
		}

		for (const edge of graph.edges) {
			if (this.nodeSet.has(edge.source) && this.nodeSet.has(edge.target)) {
				this.outDegree.set(edge.source, (this.outDegree.get(edge.source) ?? 0) + 1);
				this.inLinks.get(edge.target)!.add(edge.source);
				this.outLinks.get(edge.source)!.add(edge.target);
			}
		}

		// Full initial computation using Gauss-Seidel
		this.ranks = computePersonalizedPageRank(graph, undefined, {
			damping: this.damping,
			epsilon: this.epsilon,
		});
	}

	/**
	 * Incrementally add an edge and update ranks via residual propagation.
	 *
	 * When edge (u -> v) is added:
	 *   - Old contribution from u to each of its neighbors was PR(u)/L_old(u)
	 *   - New contribution is PR(u)/L_new(u) where L_new = L_old + 1
	 *   - Delta at v = +d * PR(u) / L_new(u)
	 *   - Delta at each old neighbor w = -d * PR(u) * (1/L_new - 1/L_old)
	 *
	 * These deltas are injected as residuals and propagated.
	 *
	 * @param source - Source node ID.
	 * @param target - Target node ID.
	 */
	addEdge(source: string, target: string): void {
		// Ensure both nodes exist
		if (!this.nodeSet.has(source)) {
			this.nodeSet.add(source);
			this.outDegree.set(source, 0);
			this.inLinks.set(source, new Set());
			this.outLinks.set(source, new Set());
			this.ranks.set(source, 1 / this.nodeSet.size);
		}
		if (!this.nodeSet.has(target)) {
			this.nodeSet.add(target);
			this.outDegree.set(target, 0);
			this.inLinks.set(target, new Set());
			this.outLinks.set(target, new Set());
			this.ranks.set(target, 1 / this.nodeSet.size);
		}

		const oldDeg = this.outDegree.get(source) ?? 0;
		const newDeg = oldDeg + 1;
		this.outDegree.set(source, newDeg);
		this.inLinks.get(target)!.add(source);
		this.outLinks.get(source)!.add(target);

		const prU = this.ranks.get(source) ?? 0;
		const residuals = new Map<string, number>();

		// Positive residual at the new target
		residuals.set(target, this.damping * prU / newDeg);

		// Negative residuals at old neighbors (their share decreased)
		if (oldDeg > 0) {
			const shareDelta = prU * (1 / newDeg - 1 / oldDeg);
			for (const neighbor of this.getOutNeighbors(source)) {
				if (neighbor === target) continue; // already handled
				const prev = residuals.get(neighbor) ?? 0;
				residuals.set(neighbor, prev + this.damping * shareDelta);
			}
		}

		this.propagateResiduals(residuals);
	}

	/**
	 * Incrementally remove an edge and update ranks via residual propagation.
	 *
	 * @param source - Source node ID.
	 * @param target - Target node ID.
	 */
	removeEdge(source: string, target: string): void {
		if (!this.nodeSet.has(source) || !this.nodeSet.has(target)) return;

		const inSet = this.inLinks.get(target);
		if (!inSet || !inSet.has(source)) return;

		const oldDeg = this.outDegree.get(source) ?? 0;
		if (oldDeg <= 0) return;

		const newDeg = oldDeg - 1;
		this.outDegree.set(source, newDeg);
		inSet.delete(source);
		this.outLinks.get(source)?.delete(target);

		const prU = this.ranks.get(source) ?? 0;
		const residuals = new Map<string, number>();

		// Negative residual at the removed target (lost its share)
		residuals.set(target, -this.damping * prU / oldDeg);

		// Positive residuals at remaining neighbors (their share increased)
		if (newDeg > 0) {
			const shareDelta = prU * (1 / newDeg - 1 / oldDeg);
			for (const neighbor of this.getOutNeighbors(source)) {
				const prev = residuals.get(neighbor) ?? 0;
				residuals.set(neighbor, prev + this.damping * shareDelta);
			}
		}

		this.propagateResiduals(residuals);
	}

	/** Get current rank scores. */
	getRanks(): Map<string, number> {
		return new Map(this.ranks);
	}

	// --- Private ---------------------------------------------------------

	/**
	 * Propagate residuals through the graph until all are below epsilon.
	 *
	 * Push-forward scheme: the node with largest absolute residual pushes
	 * its residual to its rank and propagates damped fractions to neighbors.
	 *
	 * Convergence: guaranteed for damping < 1, with total work O(1/epsilon).
	 */
	private propagateResiduals(residuals: Map<string, number>): void {
		const maxPropagations = this.nodeSet.size * 20; // safety limit
		let propagations = 0;

		while (propagations < maxPropagations) {
			// Find node with maximum absolute residual
			let maxNode: string | null = null;
			let maxResidual = 0;

			for (const [node, res] of residuals) {
				const absRes = Math.abs(res);
				if (absRes > maxResidual) {
					maxResidual = absRes;
					maxNode = node;
				}
			}

			if (maxNode === null || maxResidual < this.epsilon) break;

			const res = residuals.get(maxNode)!;
			// Apply residual to rank
			this.ranks.set(maxNode, (this.ranks.get(maxNode) ?? 0) + res);
			residuals.delete(maxNode);

			// Propagate to neighbors
			const outDeg = this.outDegree.get(maxNode) ?? 0;
			if (outDeg > 0) {
				const propagated = this.damping * res / outDeg;
				for (const neighbor of this.getOutNeighbors(maxNode)) {
					const prevRes = residuals.get(neighbor) ?? 0;
					residuals.set(neighbor, prevRes + propagated);
				}
			}

			propagations++;
		}
	}

	/**
	 * Get outgoing neighbors of a node.
	 * Uses forward adjacency list for O(degree) lookup instead of O(E).
	 */
	private getOutNeighbors(nodeId: string): string[] {
		return [...(this.outLinks.get(nodeId) ?? [])];
	}
}
