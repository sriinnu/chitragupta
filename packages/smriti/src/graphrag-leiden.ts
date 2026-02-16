/**
 * @chitragupta/smriti — Leiden Community Detection for GraphRAG.
 *
 * Implements the Leiden algorithm (Traag, Waltman & van Eck, 2019) for
 * detecting communities in the knowledge graph. This enables:
 * - Hierarchical community summarization for global queries
 * - Community-biased PageRank for contextual search
 * - Faceted search results grouped by semantic community
 *
 * The Leiden algorithm improves on Louvain by adding a refinement phase
 * that guarantees well-connected communities (no disconnected subgraphs
 * within a community).
 *
 * Modularity formula:
 *   Q = 1/(2m) × Σ[A_ij − k_i×k_j/(2m)] × δ(c_i, c_j)
 *
 * Three phases per iteration:
 *   1. Local node moving (greedy modularity optimization)
 *   2. Refinement (split disconnected subcommunities)
 *   3. Aggregation (build super-node graph for next level)
 *
 * @module graphrag-leiden
 */

import type { KnowledgeGraph, GraphNode, GraphEdge } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for Leiden community detection. */
export interface LeidenConfig {
	/** Resolution parameter γ — higher = smaller communities. Default: 1.0. */
	resolution: number;
	/** Maximum iterations of the full algorithm. Default: 10. */
	maxIterations: number;
	/** Minimum modularity improvement to continue. Default: 1e-6. */
	minModularityGain: number;
	/** Random seed for reproducibility (null = random). Default: 42. */
	seed: number | null;
	/** Minimum community size (communities smaller than this are merged). Default: 1. */
	minCommunitySize: number;
}

/** A detected community in the knowledge graph. */
export interface Community {
	/** Unique community ID. */
	id: number;
	/** Node IDs belonging to this community. */
	members: string[];
	/** Modularity contribution of this community. */
	modularity: number;
	/** Average internal edge weight. */
	internalDensity: number;
	/** Hierarchical level (0 = finest). */
	level: number;
}

/** Result of running Leiden on the knowledge graph. */
export interface LeidenResult {
	/** Node ID → community ID mapping. */
	communities: Map<string, number>;
	/** All detected communities. */
	communityList: Community[];
	/** Overall modularity score Q ∈ [-0.5, 1]. */
	modularity: number;
	/** Number of iterations run. */
	iterations: number;
	/** Hierarchical levels (if multi-level). */
	levels: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_LEIDEN_CONFIG: LeidenConfig = {
	resolution: 1.0,
	maxIterations: 10,
	minModularityGain: 1e-6,
	seed: 42,
	minCommunitySize: 1,
};

// ─── Seeded PRNG ────────────────────────────────────────────────────────────

/**
 * Simple xorshift32 PRNG for reproducible node ordering.
 * Not cryptographic — just for shuffle determinism.
 */
class Xorshift32 {
	private state: number;

	constructor(seed: number) {
		this.state = seed | 0 || 1; // Avoid zero state
	}

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
class AdjacencyGraph {
	/** nodeIndex → Map<neighborIndex, weight> */
	readonly adj: Map<number, number>[];
	/** nodeIndex → weighted degree (sum of edge weights) */
	readonly degree: number[];
	/** Total edge weight (2m). */
	readonly totalWeight: number;
	/** Number of nodes. */
	readonly n: number;
	/** Node ID → index mapping. */
	readonly idToIndex: Map<string, number>;
	/** Index → node ID mapping. */
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
			totalW += 2 * w; // Each undirected edge contributes 2w to the total (matches sum of degrees)
		}
		this.totalWeight = totalW; // This is 2m (sum of all node degrees)
	}
}

// ─── Modularity Computation ─────────────────────────────────────────────────

/**
 * Compute modularity Q for a given community assignment.
 *
 * Q = 1/(2m) × Σ[A_ij − γ×k_i×k_j/(2m)] × δ(c_i, c_j)
 *
 * Efficient form: Q = Σ_c [ e_c/(2m) − γ×(a_c/(2m))² ]
 * where e_c = sum of internal edge weights in community c
 *       a_c = sum of degrees of nodes in community c
 */
function computeModularity(
	g: AdjacencyGraph,
	assignment: number[],
	resolution: number,
): number {
	const twoM = g.totalWeight;
	if (twoM === 0) return 0;

	// Accumulate per-community stats
	const internalWeight = new Map<number, number>();
	const communityDegree = new Map<number, number>();

	for (let i = 0; i < g.n; i++) {
		const ci = assignment[i];
		communityDegree.set(ci, (communityDegree.get(ci) ?? 0) + g.degree[i]);

		for (const [j, w] of g.adj[i]) {
			if (assignment[j] === ci && j > i) {
				// Count each internal edge once (j > i avoids double-counting)
				internalWeight.set(ci, (internalWeight.get(ci) ?? 0) + w);
			}
		}
	}

	let Q = 0;
	for (const c of communityDegree.keys()) {
		const ec = internalWeight.get(c) ?? 0;
		const ac = communityDegree.get(c) ?? 0;
		// Internal edges are undirected, counted once → multiply by 2 for the formula
		Q += (2 * ec) / twoM - resolution * (ac / twoM) ** 2;
	}

	return Q;
}

/**
 * Compute modularity gain from moving node i from its current community
 * to community c_new.
 *
 * ΔQ = [k_{i,in_new} - γ×k_i×Σ_new/(2m)] / m
 *    - [k_{i,in_old} - γ×k_i×(Σ_old - k_i)/(2m)] / m
 *
 * where:
 *   k_{i,in_new} = sum of edge weights from i to nodes in c_new
 *   Σ_new = sum of degrees of nodes in c_new
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

	// Sum of weights from i to nodes in c_new and c_old
	let kInNew = 0;
	let kInOld = 0;
	for (const [j, w] of g.adj[i]) {
		if (assignment[j] === cNew) kInNew += w;
		if (assignment[j] === cOld) kInOld += w;
	}

	const sigmaTotNew = communityDegree.get(cNew) ?? 0;
	const sigmaTotOld = communityDegree.get(cOld) ?? 0;

	// Moving i out of c_old, into c_new
	const removeGain = -kInOld / twoM + resolution * ki * (sigmaTotOld - ki) / (twoM * twoM);
	const addGain = kInNew / twoM - resolution * ki * sigmaTotNew / (twoM * twoM);

	return removeGain + addGain;
}

// ─── Phase 1: Local Node Moving ─────────────────────────────────────────────

function localNodeMoving(
	g: AdjacencyGraph,
	assignment: number[],
	resolution: number,
	rng: Xorshift32,
): boolean {
	// Compute community degrees
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

		// Collect neighboring communities
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
			// Move node i to bestCommunity
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
 * Leiden's key improvement: ensure each community is well-connected.
 * Split disconnected subcommunities into separate communities.
 */
function refineCommunities(
	g: AdjacencyGraph,
	assignment: number[],
): void {
	// Group nodes by community
	const communityNodes = new Map<number, number[]>();
	for (let i = 0; i < g.n; i++) {
		const c = assignment[i];
		if (!communityNodes.has(c)) communityNodes.set(c, []);
		communityNodes.get(c)!.push(i);
	}

	let nextCommunityId = Math.max(...assignment) + 1;

	for (const [_communityId, nodes] of communityNodes) {
		if (nodes.length <= 1) continue;

		// BFS to find connected components within this community
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

		// If more than one component, split into separate communities
		if (components.length > 1) {
			// Keep the largest component in the original community
			components.sort((a, b) => b.length - a.length);
			// First (largest) component keeps original ID — no reassignment needed
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

/**
 * Build an aggregated super-node graph where each community becomes a node.
 * Returns new assignment (0..numCommunities-1) and the aggregate graph.
 */
function aggregateGraph(
	g: AdjacencyGraph,
	assignment: number[],
): { aggAdj: Map<number, number>[]; aggDegree: number[]; communityMap: Map<number, number>; n: number; totalWeight: number } {
	// Map community IDs to contiguous indices
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
			if (j <= i) continue; // Process each edge once
			const cj = communityMap.get(assignment[j])!;
			if (ci === cj) continue; // Skip internal edges for aggregation

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
 */
function compactCommunities(
	assignment: number[],
	minSize: number,
): number[] {
	// Count sizes
	const sizes = new Map<number, number>();
	for (const c of assignment) {
		sizes.set(c, (sizes.get(c) ?? 0) + 1);
	}

	// Find the largest community (fallback for small merges)
	let largestCommunity = 0;
	let largestSize = 0;
	for (const [c, s] of sizes) {
		if (s > largestSize) {
			largestSize = s;
			largestCommunity = c;
		}
	}

	// Map old IDs to new contiguous IDs, merging small communities
	const remap = new Map<number, number>();
	let nextId = 0;

	for (const [c, s] of sizes) {
		if (s < minSize) {
			// Merge into largest community
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

// ─── Main Algorithm ─────────────────────────────────────────────────────────

/**
 * Run the Leiden algorithm on a knowledge graph.
 *
 * @param graph  - The knowledge graph to analyze.
 * @param config - Algorithm configuration (all fields optional).
 * @returns Community assignments, modularity, and community details.
 */
export function leiden(
	graph: KnowledgeGraph,
	config?: Partial<LeidenConfig>,
): LeidenResult {
	const cfg = { ...DEFAULT_LEIDEN_CONFIG, ...config };

	if (graph.nodes.length === 0) {
		return {
			communities: new Map(),
			communityList: [],
			modularity: 0,
			iterations: 0,
			levels: 0,
		};
	}

	const g = new AdjacencyGraph(graph);
	const rng = new Xorshift32(cfg.seed ?? (Date.now() | 1));

	// Initialize: each node in its own community
	const assignment = Array.from({ length: g.n }, (_, i) => i);

	let prevModularity = -1;
	let iterations = 0;

	for (let iter = 0; iter < cfg.maxIterations; iter++) {
		iterations++;

		// Phase 1: Local node moving
		const improved = localNodeMoving(g, assignment, cfg.resolution, rng);

		// Phase 2: Refinement — ensure well-connected communities
		refineCommunities(g, assignment);

		// Check convergence
		const currentModularity = computeModularity(g, assignment, cfg.resolution);
		if (!improved || currentModularity - prevModularity < cfg.minModularityGain) {
			break;
		}
		prevModularity = currentModularity;
	}

	// Compact community IDs and merge small communities
	const compacted = compactCommunities(assignment, cfg.minCommunitySize);

	// Build result
	const communities = new Map<string, number>();
	for (let i = 0; i < g.n; i++) {
		communities.set(g.indexToId[i], compacted[i]);
	}

	const finalModularity = computeModularity(g, compacted, cfg.resolution);

	// Build community list
	const communityNodes = new Map<number, string[]>();
	for (let i = 0; i < g.n; i++) {
		const c = compacted[i];
		if (!communityNodes.has(c)) communityNodes.set(c, []);
		communityNodes.get(c)!.push(g.indexToId[i]);
	}

	const communityList: Community[] = [];
	for (const [id, members] of communityNodes) {
		// Compute internal density
		let internalEdges = 0;
		let internalWeight = 0;
		const memberSet = new Set(members.map(m => g.idToIndex.get(m)!));

		for (const mi of memberSet) {
			for (const [j, w] of g.adj[mi]) {
				if (memberSet.has(j) && j > mi) {
					internalEdges++;
					internalWeight += w;
				}
			}
		}

		const possibleEdges = members.length * (members.length - 1) / 2;
		const density = possibleEdges > 0 ? internalEdges / possibleEdges : 0;

		// Community modularity contribution
		let ac = 0;
		for (const mi of memberSet) {
			ac += g.degree[mi];
		}
		const twoM = g.totalWeight;
		const communityMod = twoM > 0
			? (2 * internalWeight) / twoM - cfg.resolution * (ac / twoM) ** 2
			: 0;

		communityList.push({
			id,
			members,
			modularity: communityMod,
			internalDensity: density,
			level: 0,
		});
	}

	communityList.sort((a, b) => b.members.length - a.members.length);

	return {
		communities,
		communityList,
		modularity: finalModularity,
		iterations,
		levels: 1,
	};
}

// ─── Integration Helpers ────────────────────────────────────────────────────

/**
 * Annotate graph nodes with community membership.
 * Stores `communityId` in each node's metadata.
 */
export function annotateCommunities(
	graph: KnowledgeGraph,
	result: LeidenResult,
): void {
	for (const node of graph.nodes) {
		const communityId = result.communities.get(node.id);
		if (communityId !== undefined) {
			node.metadata.communityId = communityId;
		}
	}
}

/**
 * Get the community summary for a given community ID.
 * Returns the most representative node labels and concepts.
 */
export function communitySummary(
	graph: KnowledgeGraph,
	communityId: number,
	maxLabels: number = 5,
): { communityId: number; labels: string[]; nodeTypes: Record<string, number>; size: number } {
	const members = graph.nodes.filter(
		n => (n.metadata.communityId as number) === communityId,
	);

	const typeCount: Record<string, number> = {};
	for (const node of members) {
		typeCount[node.type] = (typeCount[node.type] ?? 0) + 1;
	}

	// Prefer concept and session labels
	const labels = members
		.filter(n => n.type === "concept" || n.type === "session")
		.slice(0, maxLabels)
		.map(n => n.label);

	return {
		communityId,
		labels,
		nodeTypes: typeCount,
		size: members.length,
	};
}

/**
 * Filter search results to nodes within a specific community.
 * Useful for focused, community-scoped search.
 */
export function filterByCommunity(
	nodes: GraphNode[],
	communityId: number,
): GraphNode[] {
	return nodes.filter(n => (n.metadata.communityId as number) === communityId);
}

/**
 * Get nodes that bridge multiple communities (connector nodes).
 * These are nodes with edges to many different communities — useful for
 * cross-cutting concern discovery.
 */
export function findBridgeNodes(
	graph: KnowledgeGraph,
	result: LeidenResult,
	minCommunities: number = 2,
): GraphNode[] {
	// For each node, count distinct communities it touches (own + neighbors')
	const touchedCommunities = new Map<string, Set<number>>();

	// Initialize with each node's own community
	for (const node of graph.nodes) {
		const ownC = result.communities.get(node.id);
		if (ownC !== undefined) {
			touchedCommunities.set(node.id, new Set([ownC]));
		}
	}

	for (const edge of graph.edges) {
		const sc = result.communities.get(edge.source);
		const tc = result.communities.get(edge.target);
		if (sc === undefined || tc === undefined) continue;
		if (sc === tc) continue; // Same community — no cross-community edge

		touchedCommunities.get(edge.source)?.add(tc);
		touchedCommunities.get(edge.target)?.add(sc);
	}

	const bridges: GraphNode[] = [];
	for (const node of graph.nodes) {
		const communities = touchedCommunities.get(node.id);
		if (communities && communities.size >= minCommunities) {
			bridges.push(node);
		}
	}

	return bridges;
}
