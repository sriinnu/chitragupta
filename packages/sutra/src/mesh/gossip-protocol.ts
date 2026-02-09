/**
 * @chitragupta/sutra/mesh — SWIM-inspired gossip protocol for failure detection.
 *
 * Implements a lightweight membership protocol inspired by SWIM
 * (Scalable Weakly-consistent Infection-style Process Group Membership).
 * Each node maintains a local view of all peers. Periodic sweeps
 * transition peers through alive -> suspect -> dead based on the time
 * since their last heartbeat. Views are merged via Lamport generation
 * counters — higher generation always wins.
 *
 * Random target selection uses Fisher-Yates partial shuffle to avoid
 * bias while limiting work to exactly `fanout` iterations.
 *
 * Like the Nakshatras (stars) in Jyotish, each peer is a point of
 * light whose visibility waxes and wanes across the gossip network.
 */

import type { PeerView, ActorSystemConfig } from "./types.js";

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_GOSSIP_INTERVAL = 1_000;
const DEFAULT_GOSSIP_FANOUT = 3;
const DEFAULT_SUSPECT_TIMEOUT = 5_000;
const DEFAULT_DEAD_TIMEOUT = 15_000;

// ─── Event types ────────────────────────────────────────────────────────────

type GossipEvent =
	| { type: "peer:discovered"; peer: PeerView }
	| { type: "peer:suspect"; peer: PeerView }
	| { type: "peer:dead"; peer: PeerView };

type GossipEventHandler = (event: GossipEvent) => void;

// ─── GossipProtocol ─────────────────────────────────────────────────────────

/**
 * SWIM-inspired membership and failure detection protocol.
 *
 * Call `register` to add a peer, `merge` to incorporate remote views,
 * and `sweep` (or `start`) to detect failures via timeout transitions.
 */
export class GossipProtocol {
	private readonly peers = new Map<string, PeerView>();
	private generation = 0;
	private readonly suspectTimeoutMs: number;
	private readonly deadTimeoutMs: number;
	private readonly gossipFanout: number;
	private readonly gossipIntervalMs: number;
	private sweepTimer: ReturnType<typeof setInterval> | null = null;
	private readonly handlers: GossipEventHandler[] = [];

	constructor(config?: ActorSystemConfig) {
		this.suspectTimeoutMs = config?.suspectTimeoutMs ?? DEFAULT_SUSPECT_TIMEOUT;
		this.deadTimeoutMs = config?.deadTimeoutMs ?? DEFAULT_DEAD_TIMEOUT;
		this.gossipFanout = config?.gossipFanout ?? DEFAULT_GOSSIP_FANOUT;
		this.gossipIntervalMs = config?.gossipIntervalMs ?? DEFAULT_GOSSIP_INTERVAL;
	}

	// ─── Events ────────────────────────────────────────────────────

	on(handler: GossipEventHandler): () => void {
		this.handlers.push(handler);
		return () => {
			const idx = this.handlers.indexOf(handler);
			if (idx >= 0) this.handlers.splice(idx, 1);
		};
	}

	private emit(event: GossipEvent): void {
		for (const h of this.handlers) {
			try { h(event); } catch { /* observer failures are non-fatal */ }
		}
	}

	// ─── Registration ──────────────────────────────────────────────

	/**
	 * Register a new peer (or refresh an existing one) in the local view.
	 */
	register(
		actorId: string,
		expertise?: string[],
		capabilities?: string[],
	): void {
		this.generation++;
		const existing = this.peers.get(actorId);

		const view: PeerView = {
			actorId,
			expertise,
			capabilities,
			status: "alive",
			generation: this.generation,
			lastSeen: Date.now(),
		};

		this.peers.set(actorId, view);

		if (!existing) {
			this.emit({ type: "peer:discovered", peer: view });
		}
	}

	/**
	 * Remove a peer from the local view.
	 */
	unregister(actorId: string): void {
		this.peers.delete(actorId);
	}

	// ─── View merging ──────────────────────────────────────────────

	/**
	 * Merge incoming peer views with the local view.
	 *
	 * For each incoming entry, the higher generation wins. If the
	 * incoming entry is newer, it replaces the local view. New peers
	 * are discovered and emit `peer:discovered`.
	 *
	 * @returns The entries that caused a local change (for further propagation).
	 */
	merge(incoming: PeerView[]): PeerView[] {
		const changed: PeerView[] = [];

		for (const remote of incoming) {
			const local = this.peers.get(remote.actorId);

			if (!local) {
				// New peer discovered
				this.peers.set(remote.actorId, { ...remote });
				changed.push(remote);
				this.emit({ type: "peer:discovered", peer: remote });
				continue;
			}

			// Higher generation wins
			if (remote.generation > local.generation) {
				this.peers.set(remote.actorId, { ...remote });
				changed.push(remote);
			}
		}

		return changed;
	}

	// ─── Queries ───────────────────────────────────────────────────

	/**
	 * Return the full local view for sharing with peers.
	 */
	getView(): PeerView[] {
		return Array.from(this.peers.values());
	}

	/**
	 * Select random gossip targets (Fisher-Yates partial shuffle).
	 *
	 * @param exclude - Actor IDs to exclude (e.g. the sender).
	 * @returns A random subset of alive peers, limited by gossipFanout.
	 */
	selectTargets(exclude?: string[]): PeerView[] {
		const candidates = this.findAlive().filter(
			(p) => !exclude?.includes(p.actorId),
		);

		const count = Math.min(this.gossipFanout, candidates.length);
		// Fisher-Yates partial shuffle — only shuffle `count` positions
		for (let i = candidates.length - 1; i > candidates.length - 1 - count && i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
		}

		return candidates.slice(candidates.length - count);
	}

	/**
	 * Find alive peers that list the given expertise.
	 */
	findByExpertise(expertise: string): PeerView[] {
		const results: PeerView[] = [];
		for (const peer of this.peers.values()) {
			if (peer.status !== "alive") continue;
			if (peer.expertise?.includes(expertise)) {
				results.push(peer);
			}
		}
		return results;
	}

	/**
	 * Return all alive peers.
	 */
	findAlive(): PeerView[] {
		const results: PeerView[] = [];
		for (const peer of this.peers.values()) {
			if (peer.status === "alive") results.push(peer);
		}
		return results;
	}

	// ─── Failure detection ─────────────────────────────────────────

	/**
	 * Sweep all peers for timeout-based status transitions:
	 *   alive -> suspect (after suspectTimeoutMs without heartbeat)
	 *   suspect -> dead   (after deadTimeoutMs without heartbeat)
	 */
	sweep(): void {
		const now = Date.now();

		for (const peer of this.peers.values()) {
			const elapsed = now - peer.lastSeen;

			if (peer.status === "alive" && elapsed > this.suspectTimeoutMs) {
				peer.status = "suspect";
				peer.generation++;
				this.emit({ type: "peer:suspect", peer });
			} else if (peer.status === "suspect" && elapsed > this.deadTimeoutMs) {
				peer.status = "dead";
				peer.generation++;
				this.emit({ type: "peer:dead", peer });
			}
		}
	}

	// ─── Lifecycle ─────────────────────────────────────────────────

	/**
	 * Start periodic sweeping.
	 *
	 * Idempotent: clears any existing timer before starting a new one,
	 * preventing leaked intervals when start() is called without a
	 * matching stop() (e.g. during partial initialization recovery).
	 */
	start(): void {
		if (this.sweepTimer !== null) {
			clearInterval(this.sweepTimer);
		}
		this.sweepTimer = setInterval(() => this.sweep(), this.gossipIntervalMs);
	}

	/**
	 * Stop periodic sweeping and clear all state.
	 */
	stop(): void {
		if (this.sweepTimer !== null) {
			clearInterval(this.sweepTimer);
			this.sweepTimer = null;
		}
		this.handlers.length = 0;
	}

	/**
	 * Alias for stop(). Ensures cleanup even when callers only have a
	 * destroy() convention (e.g. resource managers, finally blocks).
	 */
	destroy(): void {
		this.stop();
	}

	/**
	 * Stop sweeping but preserve peer state.
	 */
	pause(): void {
		if (this.sweepTimer !== null) {
			clearInterval(this.sweepTimer);
			this.sweepTimer = null;
		}
	}
}
