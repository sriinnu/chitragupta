/**
 * @chitragupta/smriti — Personalized PageRank with Incremental Updates.
 *
 * Extends the standard power-method PageRank with three key enhancements:
 *
 * 1. **Topic-Biased Teleportation** — Instead of uniform teleportation (1/N),
 *    biases toward nodes related to the current conversation topic:
 *
 *        PR(v) = (1-d) * bias(v) + d * SUM( PR(u) / L(u) )
 *
 *    where bias(v) is proportional to cosine similarity between v's content
 *    and the topic query. This makes contextually relevant nodes rank higher.
 *
 * 2. **Gauss-Seidel Iteration** — Instead of synchronous (Jacobi) updates,
 *    updates ranks in-place as they're computed. Each node immediately uses
 *    the latest available ranks of its neighbors, converging ~2x faster
 *    than the power method for the same number of iterations.
 *
 *    The Gauss-Seidel update rule:
 *
 *        PR_new(v) = (1-d)*bias(v) + d * SUM( PR_current(u) / L(u) )
 *
 *    where PR_current(u) may already be updated in the current sweep.
 *
 * 3. **Push-Based Incremental Updates** — When a single edge changes, don't
 *    recompute from scratch. Instead, propagate residuals:
 *
 *        residual[v] += delta
 *        while max(|residual|) > epsilon:
 *            v = argmax(|residual|)
 *            PR[v] += residual[v]
 *            for each neighbor u of v:
 *                residual[u] += d * residual[v] / L(v)
 *            residual[v] = 0
 *
 *    This is O(1/epsilon) per edge change vs O(N * iterations) for full recompute.
 */

import type { KnowledgeGraph } from "./types.js";

// ─── Personalized PageRank Options ───────────────────────────────────────────

/** Configuration for personalized PageRank. */
export interface PersonalizedPageRankOpts {
	/** Damping factor. Default: 0.85. */
	damping?: number;
	/** Convergence threshold. Default: 1e-6. */
	epsilon?: number;
	/** Maximum iterations. Default: 150. */
	maxIterations?: number;
	/** Use Gauss-Seidel instead of synchronous (Jacobi) updates. Default: true. */
	useGaussSeidel?: boolean;
}

// ─── Topic Bias Construction ─────────────────────────────────────────────────

/**
 * Build a topic-biased teleportation vector from a query and node contents.
 *
 * Uses a lightweight bag-of-words cosine similarity between the topic query
 * and each node's content. The resulting vector is L1-normalized so it sums
 * to 1, forming a valid probability distribution for teleportation.
 *
 * When no topic is provided, returns uniform bias (1/N for each node).
 *
 * @param nodeIds - Array of node IDs.
 * @param nodeContents - Map from node ID to text content.
 * @param topic - Optional topic query string.
 * @returns Map from node ID to teleportation probability.
 */
function buildTopicBias(
	nodeIds: string[],
	nodeContents: Map<string, string>,
	topic?: string,
): Map<string, number> {
	const bias = new Map<string, number>();
	const n = nodeIds.length;

	if (!topic || n === 0) {
		const uniform = 1 / Math.max(n, 1);
		for (const id of nodeIds) bias.set(id, uniform);
		return bias;
	}

	// Build query term frequency vector
	const queryTerms = tokenizeSimple(topic);
	const queryTf = termFrequency(queryTerms);

	let totalSim = 0;
	const similarities: number[] = new Array(n);

	for (let i = 0; i < n; i++) {
		const content = nodeContents.get(nodeIds[i]) ?? "";
		const docTerms = tokenizeSimple(content);
		const docTf = termFrequency(docTerms);
		const sim = tfCosineSimilarity(queryTf, docTf);
		similarities[i] = sim;
		totalSim += sim;
	}

	// If no similarity at all, fall back to uniform
	if (totalSim === 0) {
		const uniform = 1 / n;
		for (const id of nodeIds) bias.set(id, uniform);
		return bias;
	}

	// L1-normalize
	for (let i = 0; i < n; i++) {
		bias.set(nodeIds[i], similarities[i] / totalSim);
	}

	return bias;
}

/** Simple tokenizer for bias computation. */
function tokenizeSimple(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2);
}

/** Build a term frequency map from tokens. */
function termFrequency(tokens: string[]): Map<string, number> {
	const tf = new Map<string, number>();
	for (const t of tokens) {
		tf.set(t, (tf.get(t) ?? 0) + 1);
	}
	return tf;
}

/**
 * Cosine similarity between two term-frequency vectors (sparse).
 *
 *   sim(A, B) = (A . B) / (||A|| * ||B||)
 *
 * where A and B are sparse TF vectors represented as Maps.
 */
function tfCosineSimilarity(
	a: Map<string, number>,
	b: Map<string, number>,
): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (const [term, freqA] of a) {
		normA += freqA * freqA;
		const freqB = b.get(term);
		if (freqB !== undefined) dot += freqA * freqB;
	}
	for (const freqB of b.values()) {
		normB += freqB * freqB;
	}

	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

// ─── Personalized PageRank (Gauss-Seidel) ────────────────────────────────────

/**
 * Compute Personalized PageRank with topic-biased teleportation and
 * Gauss-Seidel iteration.
 *
 * The iterative formula:
 *
 *   PR(v) = (1 - d) * bias(v) + d * SUM_{u -> v}( PR(u) / outDeg(u) )
 *         + d * danglingRank / N
 *
 * Gauss-Seidel updates each node's rank in-place during the sweep, so
 * nodes processed later in the sweep benefit from already-updated neighbors.
 * Convergence is typically 1.5-2x faster than the synchronous power method.
 *
 * @param graph - The knowledge graph.
 * @param topicBias - Optional topic bias vector (node ID -> probability).
 *   If not provided, uses uniform teleportation (standard PageRank).
 * @param opts - Configuration options.
 * @returns Map from node ID to personalized PageRank score.
 */
export function computePersonalizedPageRank(
	graph: KnowledgeGraph,
	topicBias?: Map<string, number> | string,
	opts?: PersonalizedPageRankOpts,
): Map<string, number> {
	const damping = opts?.damping ?? 0.85;
	const epsilon = opts?.epsilon ?? 1e-6;
	const maxIter = opts?.maxIterations ?? 150;
	const useGS = opts?.useGaussSeidel ?? true;

	const N = graph.nodes.length;
	if (N === 0) return new Map();

	// Build adjacency structures
	const nodeIds = graph.nodes.map((n) => n.id);
	const nodeIdSet = new Set(nodeIds);
	const outDegree = new Map<string, number>();
	const inLinks = new Map<string, string[]>();

	for (const id of nodeIds) {
		outDegree.set(id, 0);
		inLinks.set(id, []);
	}

	for (const edge of graph.edges) {
		if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
			outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
			inLinks.get(edge.target)!.push(edge.source);
		}
	}

	// Build topic bias
	let bias: Map<string, number>;
	if (typeof topicBias === "string") {
		// Topic string: compute bias from node contents
		const nodeContents = new Map<string, string>();
		for (const node of graph.nodes) {
			nodeContents.set(node.id, node.content);
		}
		bias = buildTopicBias(nodeIds, nodeContents, topicBias);
	} else if (topicBias instanceof Map) {
		bias = topicBias;
	} else {
		const uniform = 1 / N;
		bias = new Map(nodeIds.map((id) => [id, uniform]));
	}

	// Initialize ranks uniformly
	const ranks = new Map<string, number>();
	for (const id of nodeIds) {
		ranks.set(id, 1 / N);
	}

	// Identify dangling nodes (no outgoing edges)
	const danglingNodes: string[] = [];
	for (const id of nodeIds) {
		if ((outDegree.get(id) ?? 0) === 0) danglingNodes.push(id);
	}

	for (let iter = 0; iter < maxIter; iter++) {
		// Compute dangling rank sum
		let danglingSum = 0;
		for (const id of danglingNodes) {
			danglingSum += ranks.get(id) ?? 0;
		}
		const danglingContrib = damping * danglingSum / N;

		let maxDelta = 0;

		if (useGS) {
			// Gauss-Seidel: update in-place, immediately using new values
			for (const id of nodeIds) {
				const biasVal = bias.get(id) ?? (1 / N);
				let incomingSum = 0;
				for (const src of (inLinks.get(id) ?? [])) {
					const srcRank = ranks.get(src) ?? 0;
					const srcOut = outDegree.get(src) ?? 1;
					incomingSum += srcRank / srcOut;
				}

				const newRank = (1 - damping) * biasVal + damping * incomingSum + danglingContrib;
				const oldRank = ranks.get(id) ?? 0;
				const delta = Math.abs(newRank - oldRank);
				if (delta > maxDelta) maxDelta = delta;
				ranks.set(id, newRank);
			}
		} else {
			// Jacobi (synchronous) update
			const newRanks = new Map<string, number>();
			for (const id of nodeIds) {
				const biasVal = bias.get(id) ?? (1 / N);
				let incomingSum = 0;
				for (const src of (inLinks.get(id) ?? [])) {
					const srcRank = ranks.get(src) ?? 0;
					const srcOut = outDegree.get(src) ?? 1;
					incomingSum += srcRank / srcOut;
				}
				const newRank = (1 - damping) * biasVal + damping * incomingSum + danglingContrib;
				newRanks.set(id, newRank);

				const delta = Math.abs(newRank - (ranks.get(id) ?? 0));
				if (delta > maxDelta) maxDelta = delta;
			}
			for (const [id, rank] of newRanks) ranks.set(id, rank);
		}

		if (maxDelta < epsilon) break;
	}

	return ranks;
}

// ─── Incremental PageRank ────────────────────────────────────────────────────

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

		for (const node of graph.nodes) {
			this.nodeSet.add(node.id);
			this.outDegree.set(node.id, 0);
			this.inLinks.set(node.id, new Set());
		}

		for (const edge of graph.edges) {
			if (this.nodeSet.has(edge.source) && this.nodeSet.has(edge.target)) {
				this.outDegree.set(edge.source, (this.outDegree.get(edge.source) ?? 0) + 1);
				this.inLinks.get(edge.target)!.add(edge.source);
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
			this.ranks.set(source, 1 / this.nodeSet.size);
		}
		if (!this.nodeSet.has(target)) {
			this.nodeSet.add(target);
			this.outDegree.set(target, 0);
			this.inLinks.set(target, new Set());
			this.ranks.set(target, 1 / this.nodeSet.size);
		}

		const oldDeg = this.outDegree.get(source) ?? 0;
		const newDeg = oldDeg + 1;
		this.outDegree.set(source, newDeg);
		this.inLinks.get(target)!.add(source);

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

	// ─── Private ──────────────────────────────────────────────────────

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
	 * Reconstructed from inLinks (reverse lookup).
	 */
	private getOutNeighbors(nodeId: string): string[] {
		const neighbors: string[] = [];
		for (const [target, sources] of this.inLinks) {
			if (sources.has(nodeId)) neighbors.push(target);
		}
		return neighbors;
	}
}
