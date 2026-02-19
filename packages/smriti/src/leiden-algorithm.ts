/**
 * @chitragupta/smriti — Leiden Algorithm Core Implementation
 *
 * Internal data structures and phase functions for the Leiden community
 * detection algorithm (Traag, Waltman & van Eck, 2019). Provides:
 * - Xorshift32 deterministic PRNG for reproducible node ordering
 * - AdjacencyGraph representation optimized for modularity computation
 * - Three core phases: local moving, refinement, aggregation
 * - Community compaction for contiguous ID assignment
 *
 * Split from graphrag-leiden.ts for file size compliance (< 450 LOC).
 *
 * @module leiden-algorithm
 */

import type { KnowledgeGraph } from "./types.js";

// ─── Seeded PRNG ────────────────────────────────────────────────────────────

/**
 * Simple xorshift32 PRNG for reproducible node ordering.
 * Not cryptographic — just for shuffle determinism.
 */
export class Xorshift32 {
	private state: number;

	constructor(seed: number) {
		this.state = seed | 0 || 1; // Avoid zero state
	}

	/** Generate next pseudo-random number in [0, 1). */
	next(): number {
		let x = this.state;
		x ^= x << 13;
		x ^= x >> 17;
		x ^= x << 5;
		this.state = x;
		return (x >>> 0) / 0xFFFFFFFF;
	}
}

// ─── Internal Graph Representation ──────────────────────────────────────────

/**
 * Adjacency list optimized for modularity computation.
 * Stores edge weights for fast neighbor lookup.
 */
export class AdjacencyGraph {
	/** nodeIndex -> Map<neighborIndex, weight> */
	readonly adj: Map<number, number>[];
	/** nodeIndex -> weighted degree (sum of edge weights) */
	readonly degree: number[];
	/** Total edge weight (2m). */
	readonly totalWeight: number;
	/** Number of nodes. */
	readonly n: number;
	/** Node ID -> index mapping. */
	readonly idToIndex: Map<string, number>;
	/** Index -> node ID mapping. */
	readonly indexToId: string[];

	constructor(graph: KnowledgeGraph) {
		const nodeIds = graph.nodes.map(n => n.id);
		this.n = nodeIds.length;
		this.idToIndex = new Map(nodeIds.map((id, i) => [id, i]));
		this.indexToId = nodeIds;

		// Initialize adjacency lists
		this.adj = new Array(this.n);
		this.degree = new Array(this.n).fill(0);
		for (let i = 0; i < this.n; i++) {
			this.adj[i] = new Map();
		}

		// Build adjacency (treat directed edges as undirected for community detection)
		let totalW = 0;
		for (const edge of graph.edges) {
			const s = this.idToIndex.get(edge.source);
			const t = this.idToIndex.get(edge.target);
			if (s === undefined || t === undefined) continue;
			if (s === t) continue; // Skip self-loops

			const w = edge.weight ?? 1;
			this.adj[s].set(t, (this.adj[s].get(t) ?? 0) + w);
			this.adj[t].set(s, (this.adj[t].get(s) ?? 0) + w);
			this.degree[s] += w;
			this.degree[t] += w;
			totalW += 2 * w;
		}
		this.totalWeight = totalW; // This is 2m (sum of all node degrees)
	}
}

// ─── Modularity Computation ─────────────────────────────────────────────────

/**
 * Compute modularity Q for a given community assignment.
 *
 * Q = 1/(2m) * Sigma[A_ij - gamma * k_i * k_j / (2m)] * delta(c_i, c_j)
 *
 * Efficient form: Q = Sigma_c [ e_c/(2m) - gamma * (a_c/(2m))^2 ]
 *
 * @param g          - The adjacency graph.
 * @param assignment - Node index -> community ID mapping.
 * @param resolution - Resolution parameter gamma.
 * @returns Modularity score Q in [-0.5, 1].
 */
export function computeModularity(
	g: AdjacencyGraph,
	assignment: number[],
	resolution: number,
): number {
	const twoM = g.totalWeight;
	if (twoM === 0) return 0;

	const internalWeight = new Map<number, number>();
	const communityDegree = new Map<number, number>();

	for (let i = 0; i < g.n; i++) {
		const ci = assignment[i];
		communityDegree.set(ci, (communityDegree.get(ci) ?? 0) + g.degree[i]);
		for (const [j, w] of g.adj[i]) {
			if (assignment[j] === ci && j > i) {
				internalWeight.set(ci, (internalWeight.get(ci) ?? 0) + w);
			}
		}
	}

	let Q = 0;
	for (const c of communityDegree.keys()) {
		const ec = internalWeight.get(c) ?? 0;
		const ac = communityDegree.get(c) ?? 0;
		Q += (2 * ec) / twoM - resolution * (ac / twoM) ** 2;
	}

	return Q;
}

/**
 * Compute modularity gain from moving node i to community c_new.
 *
 * DeltaQ = [k_{i,in_new} - gamma * k_i * Sigma_new / (2m)] / m
 *        - [k_{i,in_old} - gamma * k_i * (Sigma_old - k_i) / (2m)] / m
 *
 * @param g               - The adjacency graph.
 * @param i               - Node index to evaluate moving.
 * @param cNew            - Target community ID.
 * @param assignment      - Current community assignments.
 * @param communityDegree - Precomputed community degree sums.
 * @param resolution      - Resolution parameter gamma.
 * @returns The modularity change if node i were moved to cNew.
 */
function modularityGain(
	g: AdjacencyGraph,
	i: number,
	cNew: number,
	assignment: number[],
	communityDegree: Map<number, number>,
	resolution: number,
): number {
	const twoM = g.totalWeight;
	if (twoM === 0) return 0;

	const cOld = assignment[i];
	if (cOld === cNew) return 0;

	const ki = g.degree[i];
	let kInNew = 0;
	let kInOld = 0;
	for (const [j, w] of g.adj[i]) {
		if (assignment[j] === cNew) kInNew += w;
		if (assignment[j] === cOld) kInOld += w;
	}

	const sigmaTotNew = communityDegree.get(cNew) ?? 0;
	const sigmaTotOld = communityDegree.get(cOld) ?? 0;

	const removeGain = -kInOld / twoM + resolution * ki * (sigmaTotOld - ki) / (twoM * twoM);
	const addGain = kInNew / twoM - resolution * ki * sigmaTotNew / (twoM * twoM);

	return removeGain + addGain;
}

// ─── Phase 1: Local Node Moving ─────────────────────────────────────────────

/**
 * Greedy local node moving -- move nodes to neighboring communities for modularity gain.
 *
 * Iterates over nodes in random order, moving each to the neighboring community
 * that yields the maximum modularity improvement. Updates community degree sums
 * incrementally.
 *
 * @param g          - The adjacency graph.
 * @param assignment - Mutable community assignment array (modified in place).
 * @param resolution - Resolution parameter gamma.
 * @param rng        - Seeded PRNG for reproducible shuffle order.
 * @returns True if any node was moved (i.e., improvement found).
 */
export function localNodeMoving(
	g: AdjacencyGraph,
	assignment: number[],
	resolution: number,
	rng: Xorshift32,
): boolean {
	const communityDegree = new Map<number, number>();
	for (let i = 0; i < g.n; i++) {
		const ci = assignment[i];
		communityDegree.set(ci, (communityDegree.get(ci) ?? 0) + g.degree[i]);
	}

	// Shuffle node order for randomized processing
	const order = Array.from({ length: g.n }, (_, i) => i);
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}

	let improved = false;

	for (const i of order) {
		const cOld = assignment[i];
		const ki = g.degree[i];

		const neighborCommunities = new Set<number>();
		for (const [j] of g.adj[i]) {
			neighborCommunities.add(assignment[j]);
		}

		let bestCommunity = cOld;
		let bestGain = 0;
		for (const cNew of neighborCommunities) {
			if (cNew === cOld) continue;
			const gain = modularityGain(g, i, cNew, assignment, communityDegree, resolution);
			if (gain > bestGain) {
				bestGain = gain;
				bestCommunity = cNew;
			}
		}

		if (bestCommunity !== cOld) {
			communityDegree.set(cOld, (communityDegree.get(cOld) ?? 0) - ki);
			communityDegree.set(bestCommunity, (communityDegree.get(bestCommunity) ?? 0) + ki);
			assignment[i] = bestCommunity;
			improved = true;
		}
	}

	return improved;
}

// ─── Phase 2: Refinement ────────────────────────────────────────────────────

/**
 * Refine communities by checking internal connectivity.
 *
 * Leiden's key improvement over Louvain: splits disconnected subcommunities
 * by running BFS within each community and assigning separate components
 * to new community IDs.
 *
 * @param g          - The adjacency graph.
 * @param assignment - Mutable community assignment array (modified in place).
 */
export function refineCommunities(
	g: AdjacencyGraph,
	assignment: number[],
): void {
	const communityNodes = new Map<number, number[]>();
	for (let i = 0; i < g.n; i++) {
		const c = assignment[i];
		if (!communityNodes.has(c)) communityNodes.set(c, []);
		communityNodes.get(c)!.push(i);
	}

	let nextCommunityId = Math.max(...assignment) + 1;

	for (const [_communityId, nodes] of communityNodes) {
		if (nodes.length <= 1) continue;

		const nodeSet = new Set(nodes);
		const visited = new Set<number>();
		const components: number[][] = [];

		for (const start of nodes) {
			if (visited.has(start)) continue;
			const component: number[] = [];
			const queue = [start];
			visited.add(start);

			while (queue.length > 0) {
				const node = queue.shift()!;
				component.push(node);
				for (const [neighbor] of g.adj[node]) {
					if (nodeSet.has(neighbor) && !visited.has(neighbor)) {
						visited.add(neighbor);
						queue.push(neighbor);
					}
				}
			}
			components.push(component);
		}

		if (components.length > 1) {
			components.sort((a, b) => b.length - a.length);
			for (let k = 1; k < components.length; k++) {
				const newId = nextCommunityId++;
				for (const node of components[k]) {
					assignment[node] = newId;
				}
			}
		}
	}
}

// ─── Phase 3: Aggregation ───────────────────────────────────────────────────

/** Aggregation result for building super-node graph. */
export interface AggregateResult {
	/** Super-node adjacency: aggNodeIndex -> Map<aggNeighborIndex, weight> */
	aggAdj: Map<number, number>[];
	/** Super-node weighted degree sums. */
	aggDegree: number[];
	/** Original community ID -> aggregated node index mapping. */
	communityMap: Map<number, number>;
	/** Number of super-nodes. */
	n: number;
	/** Total edge weight in aggregated graph. */
	totalWeight: number;
}

/**
 * Build an aggregated super-node graph where each community becomes a node.
 *
 * Inter-community edge weights are summed to form super-edges.
 * Intra-community edges are discarded (they become internal to the super-node).
 *
 * @param g          - The adjacency graph.
 * @param assignment - Current community assignments.
 * @returns Aggregated graph structure for the next level.
 */
export function aggregateGraph(
	g: AdjacencyGraph,
	assignment: number[],
): AggregateResult {
	const uniqueCommunities = [...new Set(assignment)];
	const communityMap = new Map(uniqueCommunities.map((c, i) => [c, i]));
	const n = uniqueCommunities.length;

	const aggAdj: Map<number, number>[] = new Array(n);
	const aggDegree = new Array(n).fill(0);
	for (let i = 0; i < n; i++) {
		aggAdj[i] = new Map();
	}

	let totalWeight = 0;
	for (let i = 0; i < g.n; i++) {
		const ci = communityMap.get(assignment[i])!;
		for (const [j, w] of g.adj[i]) {
			if (j <= i) continue;
			const cj = communityMap.get(assignment[j])!;
			if (ci === cj) continue;

			aggAdj[ci].set(cj, (aggAdj[ci].get(cj) ?? 0) + w);
			aggAdj[cj].set(ci, (aggAdj[cj].get(ci) ?? 0) + w);
			aggDegree[ci] += w;
			aggDegree[cj] += w;
			totalWeight += w;
		}
	}

	return { aggAdj, aggDegree, communityMap, n, totalWeight };
}

// ─── Compact Communities ────────────────────────────────────────────────────

/**
 * Renumber communities to be contiguous 0..k-1 and merge small communities.
 *
 * Communities smaller than `minSize` are absorbed into the largest community.
 *
 * @param assignment - Node index -> community ID mapping.
 * @param minSize    - Minimum community size; smaller ones are merged.
 * @returns New assignment array with contiguous community IDs.
 */
export function compactCommunities(
	assignment: number[],
	minSize: number,
): number[] {
	const sizes = new Map<number, number>();
	for (const c of assignment) {
		sizes.set(c, (sizes.get(c) ?? 0) + 1);
	}

	let largestCommunity = 0;
	let largestSize = 0;
	for (const [c, s] of sizes) {
		if (s > largestSize) {
			largestSize = s;
			largestCommunity = c;
		}
	}

	const remap = new Map<number, number>();
	let nextId = 0;

	for (const [c, s] of sizes) {
		if (s < minSize) {
			remap.set(c, remap.get(largestCommunity) ?? nextId);
			if (!remap.has(largestCommunity)) {
				remap.set(largestCommunity, nextId++);
			}
		} else {
			if (!remap.has(c)) {
				remap.set(c, nextId++);
			}
		}
	}

	return assignment.map(c => remap.get(c) ?? 0);
}
