/**
 * @chitragupta/sutra/mesh — CapabilityRouter: decentralized capability-aware routing.
 *
 * Enables messages to be routed by declared capability rather than specific
 * actorId. Uses gossip-propagated capability data with multi-factor scoring
 * (capability match × reliability × recency × load) to select the best peer.
 *
 * Three selection strategies:
 *   - best: highest composite score (default)
 *   - weighted-random: probabilistic selection weighted by score
 *   - round-robin: fair cycling through qualifying peers
 *
 * Innovation: fully decentralized capability matching with zero external
 * infrastructure — reuses gossip protocol for discovery and PeerGuard
 * for trust scoring.
 *
 * Like Chitragupta who matches karma to consequence, this router matches
 * capability queries to the most fitting peer.
 *
 * @module
 */

import type { PeerView } from "./types.js";
import type { GossipProtocol } from "./gossip-protocol.js";
import type { PeerGuard } from "./peer-guard.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Selection strategy for choosing among matching peers. */
export type CapabilityStrategy = "best" | "weighted-random" | "round-robin";

/** Query describing desired capabilities and selection strategy. */
export interface CapabilityQuery {
	/** Required capabilities — peer must declare ALL of these. */
	capabilities: string[];
	/** Selection strategy when multiple peers qualify. Default: "best". */
	strategy?: CapabilityStrategy;
}

/** Scored peer result from capability resolution. */
export interface ScoredPeer {
	peer: PeerView;
	score: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max hours before recency factor drops to minimum. */
const RECENCY_HORIZON_HOURS = 24;
/** Minimum recency factor (never fully zero). */
const MIN_RECENCY = 0.1;
/** Actor count divisor for load factor calculation. */
const LOAD_DIVISOR = 100;

// ─── CapabilityRouter ───────────────────────────────────────────────────────

/**
 * Routes messages to peers based on declared capabilities.
 *
 * Delegates to {@link GossipProtocol.findByCapability} for alive-peer queries.
 * Optionally integrates with {@link PeerGuard} for reliability-aware scoring.
 *
 * @example
 * ```ts
 * const router = new CapabilityRouter(gossip, guard);
 * const peer = router.resolve({ capabilities: ["code-review", "typescript"] });
 * if (peer) channel.send(peer.originNodeId, envelope);
 * ```
 */
export class CapabilityRouter {
	private readonly gossip: GossipProtocol;
	private readonly guard: PeerGuard | undefined;

	/** nodeId → actor count for load-aware scoring. */
	private readonly loadMap = new Map<string, number>();
	/** capabilityKey → last selected index for round-robin. */
	private readonly roundRobinState = new Map<string, number>();

	constructor(gossip: GossipProtocol, guard?: PeerGuard) {
		this.gossip = gossip;
		this.guard = guard;
	}

	// ─── Resolution ─────────────────────────────────────────────────

	/**
	 * Resolve the best peer for given capabilities.
	 *
	 * @returns The selected PeerView, or undefined if no peer matches.
	 */
	resolve(query: CapabilityQuery): PeerView | undefined {
		const { capabilities, strategy = "best" } = query;
		if (capabilities.length === 0) return undefined;

		const candidates = this.findMatchingAll(capabilities);
		if (candidates.length === 0) return undefined;

		const scored = candidates.map((peer) => ({
			peer,
			score: this.score(peer, capabilities),
		}));

		return this.select(scored, strategy, capabilities);
	}

	// ─── Matching ───────────────────────────────────────────────────

	/**
	 * Find all alive peers declaring a given capability.
	 */
	findMatching(capability: string): PeerView[] {
		return this.gossip.findByCapability(capability);
	}

	/**
	 * Find peers matching ALL given capabilities (intersection).
	 *
	 * For each capability, queries the gossip layer, then intersects
	 * by actorId to find peers declaring every required capability.
	 */
	findMatchingAll(capabilities: string[]): PeerView[] {
		if (capabilities.length === 0) return [];
		if (capabilities.length === 1) return this.findMatching(capabilities[0]);

		// Start with peers matching the first capability
		let result = this.findMatching(capabilities[0]);

		// Intersect with each subsequent capability
		for (let i = 1; i < capabilities.length; i++) {
			const matchIds = new Set(
				this.findMatching(capabilities[i]).map((p) => p.actorId),
			);
			result = result.filter((p) => matchIds.has(p.actorId));
			if (result.length === 0) return [];
		}

		return result;
	}

	// ─── Scoring ────────────────────────────────────────────────────

	/**
	 * Multi-factor score for a peer against required capabilities.
	 *
	 * Formula: capabilityMatch × reliability × recency × loadFactor
	 *
	 * @param peer - The peer to score.
	 * @param requiredCaps - Capabilities the peer must match.
	 * @returns Score in range (0, 1].
	 */
	score(peer: PeerView, requiredCaps: string[]): number {
		const capMatch = this.capabilityMatchFactor(peer, requiredCaps);
		const reliability = this.reliabilityFactor(peer);
		const recency = this.recencyFactor(peer);
		const load = this.loadFactor(peer);

		return capMatch * reliability * recency * load;
	}

	/**
	 * Ratio of matched capabilities to required capabilities.
	 * Returns 0..1 where 1 means all required capabilities are present.
	 */
	private capabilityMatchFactor(peer: PeerView, requiredCaps: string[]): number {
		if (requiredCaps.length === 0) return 1;
		const peerCaps = peer.capabilities ?? [];
		let matched = 0;
		for (const cap of requiredCaps) {
			if (peerCaps.includes(cap)) matched++;
		}
		return matched / requiredCaps.length;
	}

	/**
	 * Reliability factor from PeerGuard scoring.
	 * Degrades gracefully to 0.5 if no PeerGuard is available.
	 */
	private reliabilityFactor(peer: PeerView): number {
		if (!this.guard || !peer.originNodeId) return 0.5;
		const scores = this.guard.getScores();
		const peerScore = scores.get(peer.originNodeId);
		if (!peerScore) return 0.5;

		const total = peerScore.successes + peerScore.failures;
		if (total === 0) return 0.5;
		return peerScore.successes / total;
	}

	/**
	 * Recency factor: recent peers score higher.
	 * Linear decay from 1.0 to MIN_RECENCY over RECENCY_HORIZON_HOURS.
	 */
	private recencyFactor(peer: PeerView): number {
		const ageHours = (Date.now() - peer.lastSeen) / 3_600_000;
		return Math.max(MIN_RECENCY, 1 - ageHours / RECENCY_HORIZON_HOURS);
	}

	/**
	 * Load factor: peers with fewer actors score higher.
	 * Formula: 1 / (1 + actorCount / LOAD_DIVISOR)
	 */
	private loadFactor(peer: PeerView): number {
		const nodeId = peer.originNodeId;
		if (!nodeId) return 1;
		const actorCount = this.loadMap.get(nodeId) ?? 0;
		return 1 / (1 + actorCount / LOAD_DIVISOR);
	}

	// ─── Selection Strategies ───────────────────────────────────────

	/**
	 * Select a peer from scored candidates using the given strategy.
	 */
	private select(
		scored: ScoredPeer[],
		strategy: CapabilityStrategy,
		capabilities: string[],
	): PeerView | undefined {
		if (scored.length === 0) return undefined;

		switch (strategy) {
			case "best":
				return this.selectBest(scored);
			case "weighted-random":
				return this.selectWeightedRandom(scored);
			case "round-robin":
				return this.selectRoundRobin(scored, capabilities);
			default:
				return this.selectBest(scored);
		}
	}

	/** Select the peer with the highest score. */
	private selectBest(scored: ScoredPeer[]): PeerView {
		let best = scored[0];
		for (let i = 1; i < scored.length; i++) {
			if (scored[i].score > best.score) best = scored[i];
		}
		return best.peer;
	}

	/**
	 * Weighted-random: probability proportional to normalized score.
	 * Uses cumulative distribution for O(n) selection.
	 */
	private selectWeightedRandom(scored: ScoredPeer[]): PeerView {
		const totalScore = scored.reduce((sum, s) => sum + s.score, 0);
		if (totalScore === 0) return scored[0].peer;

		const rand = Math.random() * totalScore;
		let cumulative = 0;
		for (const entry of scored) {
			cumulative += entry.score;
			if (rand <= cumulative) return entry.peer;
		}
		return scored[scored.length - 1].peer;
	}

	/**
	 * Round-robin: cycles through qualifying peers in stable order.
	 * Sorts by actorId for deterministic ordering.
	 */
	private selectRoundRobin(
		scored: ScoredPeer[],
		capabilities: string[],
	): PeerView {
		const key = [...capabilities].sort().join(",");
		const lastIdx = this.roundRobinState.get(key) ?? -1;

		// Sort by actorId for stable ordering
		const sorted = [...scored].sort((a, b) =>
			a.peer.actorId.localeCompare(b.peer.actorId),
		);

		const nextIdx = (lastIdx + 1) % sorted.length;
		this.roundRobinState.set(key, nextIdx);
		return sorted[nextIdx].peer;
	}

	// ─── Load Tracking ──────────────────────────────────────────────

	/**
	 * Update actor count for a node (used for load-aware scoring).
	 *
	 * @param nodeId - The node to update.
	 * @param actorCount - Current actor count on that node.
	 */
	updateLoad(nodeId: string, actorCount: number): void {
		this.loadMap.set(nodeId, actorCount);
	}

	/** Clear load tracking data. */
	clearLoad(): void {
		this.loadMap.clear();
	}

	/** Clear round-robin state. */
	clearRoundRobinState(): void {
		this.roundRobinState.clear();
	}
}
