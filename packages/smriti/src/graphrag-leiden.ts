/**
 * @chitragupta/smriti — Leiden Community Detection for GraphRAG.
 *
 * Implements the Leiden algorithm (Traag, Waltman & van Eck, 2019) for
 * detecting communities in the knowledge graph. This enables:
 * - Hierarchical community summarization for global queries
 * - Community-biased PageRank for contextual search
 * - Faceted search results grouped by semantic community
 *
 * Algorithm internals (PRNG, adjacency graph, modularity, phases) are in
 * leiden-algorithm.ts for file size compliance.
 *
 * @module graphrag-leiden
 */

import type { KnowledgeGraph, GraphNode } from "./types.js";
import {
	Xorshift32,
	AdjacencyGraph,
	computeModularity,
	localNodeMoving,
	refineCommunities,
	compactCommunities,
} from "./leiden-algorithm.js";

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
	const communityList = buildCommunityList(g, compacted, cfg.resolution);
	communityList.sort((a, b) => b.members.length - a.members.length);

	return {
		communities,
		communityList,
		modularity: finalModularity,
		iterations,
		levels: 1,
	};
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Build the community list with density and modularity contribution. */
function buildCommunityList(
	g: AdjacencyGraph,
	compacted: number[],
	resolution: number,
): Community[] {
	const communityNodes = new Map<number, string[]>();
	for (let i = 0; i < g.n; i++) {
		const c = compacted[i];
		if (!communityNodes.has(c)) communityNodes.set(c, []);
		communityNodes.get(c)!.push(g.indexToId[i]);
	}

	const communityList: Community[] = [];
	for (const [id, members] of communityNodes) {
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

		let ac = 0;
		for (const mi of memberSet) ac += g.degree[mi];
		const twoM = g.totalWeight;
		const communityMod = twoM > 0
			? (2 * internalWeight) / twoM - resolution * (ac / twoM) ** 2
			: 0;

		communityList.push({
			id, members, modularity: communityMod,
			internalDensity: density, level: 0,
		});
	}

	return communityList;
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

	const labels = members
		.filter(n => n.type === "concept" || n.type === "session")
		.slice(0, maxLabels)
		.map(n => n.label);

	return { communityId, labels, nodeTypes: typeCount, size: members.length };
}

/**
 * Filter search results to nodes within a specific community.
 */
export function filterByCommunity(
	nodes: GraphNode[],
	communityId: number,
): GraphNode[] {
	return nodes.filter(n => (n.metadata.communityId as number) === communityId);
}

/**
 * Get nodes that bridge multiple communities (connector nodes).
 * These are nodes with edges to many different communities.
 */
export function findBridgeNodes(
	graph: KnowledgeGraph,
	result: LeidenResult,
	minCommunities: number = 2,
): GraphNode[] {
	const touchedCommunities = new Map<string, Set<number>>();

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
		if (sc === tc) continue;

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
