/**
 * Network Gossip — Distributed SWIM Protocol over WebSocket Peers.
 *
 * Bridges the local {@link GossipProtocol} (failure detection) with
 * the {@link PeerConnectionManager} (WebSocket transport). Periodically
 * exchanges peer views across the mesh so all nodes converge on a
 * consistent view of the actor population.
 *
 * Also maintains an actor-to-node location map: which node hosts
 * which actors. The {@link MeshRouter} consults this to forward
 * envelopes to the correct remote peer.
 *
 * @module
 */

import type { PeerView } from "./types.js";
import type { GossipProtocol } from "./gossip-protocol.js";
import type { PeerConnectionManager } from "./peer-connection.js";
import type { WsPeerChannel } from "./ws-peer-channel.js";
import type { PeerNetworkEventHandler, PeerNetworkEvent, PeerNodeInfo } from "./peer-types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Maps actorId → nodeId for distributed routing. */
export type ActorLocationMap = ReadonlyMap<string, string>;

/** Configuration for the NetworkGossip layer. */
export interface NetworkGossipConfig {
	/** How often to exchange gossip with peers (ms). Default: 5_000 */
	exchangeIntervalMs?: number;
	/** Max actors per gossip exchange to prevent oversized messages. Default: 500 */
	maxViewSize?: number;
	/** Stale location entries are evicted after this (ms). Default: 120_000 */
	locationTtlMs?: number;
}

/** Events emitted by NetworkGossip. */
export type NetworkGossipEvent =
	| { type: "gossip:sent"; peerId: string; viewSize: number }
	| { type: "gossip:received"; peerId: string; viewSize: number; changedCount: number }
	| { type: "actor:located"; actorId: string; nodeId: string }
	| { type: "actor:relocated"; actorId: string; fromNode: string; toNode: string }
	| { type: "actor:lost"; actorId: string; nodeId: string };

type NetworkGossipEventHandler = (event: NetworkGossipEvent) => void;

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_EXCHANGE_INTERVAL_MS = 5_000;
const DEFAULT_MAX_VIEW_SIZE = 500;
const DEFAULT_LOCATION_TTL_MS = 120_000;

// ─── NetworkGossip ──────────────────────────────────────────────────────────

/**
 * Coordinates gossip exchanges across the P2P mesh.
 *
 * Each tick:
 * 1. Selects random connected peers (fanout)
 * 2. Sends our local gossip view (actor list + status)
 * 3. Receives their views and merges into local gossip
 * 4. Updates the actor-to-node location map
 */
export class NetworkGossip {
	private readonly localNodeId: string;
	private readonly gossip: GossipProtocol;
	private readonly connections: PeerConnectionManager;

	private readonly exchangeIntervalMs: number;
	private readonly maxViewSize: number;
	private readonly locationTtlMs: number;

	/** actorId → { nodeId, lastSeen } */
	private readonly actorLocations = new Map<string, { nodeId: string; lastSeen: number }>();
	/** capability → Set<actorId> for capability-based lookups. */
	private readonly capabilityIndex = new Map<string, Set<string>>();
	private exchangeTimer: ReturnType<typeof setInterval> | null = null;
	private handlers: NetworkGossipEventHandler[] = [];
	private peerEventUnsub: (() => void) | null = null;
	private running = false;

	constructor(
		localNodeId: string,
		gossip: GossipProtocol,
		connections: PeerConnectionManager,
		config?: NetworkGossipConfig,
	) {
		this.localNodeId = localNodeId;
		this.gossip = gossip;
		this.connections = connections;
		this.exchangeIntervalMs = config?.exchangeIntervalMs ?? DEFAULT_EXCHANGE_INTERVAL_MS;
		this.maxViewSize = config?.maxViewSize ?? DEFAULT_MAX_VIEW_SIZE;
		this.locationTtlMs = config?.locationTtlMs ?? DEFAULT_LOCATION_TTL_MS;
	}

	// ─── Public API ─────────────────────────────────────────────────

	/** Subscribe to network gossip events. */
	on(handler: NetworkGossipEventHandler): () => void {
		this.handlers.push(handler);
		return () => {
			const idx = this.handlers.indexOf(handler);
			if (idx >= 0) this.handlers.splice(idx, 1);
		};
	}

	/**
	 * Find which node hosts a given actorId.
	 * Returns undefined if the actor is unknown to the mesh.
	 */
	findNode(actorId: string): string | undefined {
		const entry = this.actorLocations.get(actorId);
		if (!entry) return undefined;
		if (Date.now() - entry.lastSeen > this.locationTtlMs) {
			this.actorLocations.delete(actorId);
			return undefined;
		}
		return entry.nodeId;
	}

	/** Get the full actor location map (read-only snapshot). */
	getLocations(): ActorLocationMap {
		this.evictStaleLocations();
		const result = new Map<string, string>();
		for (const [actorId, { nodeId }] of this.actorLocations) {
			result.set(actorId, nodeId);
		}
		return result;
	}

	/** Number of known actor locations. */
	get locationCount(): number { return this.actorLocations.size; }

	// ─── Lifecycle ──────────────────────────────────────────────────

	/** Start periodic gossip exchanges across the mesh. */
	start(): void {
		if (this.running) return;
		this.running = true;

		// Wire gossip message handling on all peer channels
		this.connections.setGossipHandler((fromNodeId, views) => {
			this.receiveGossip(fromNodeId, views);
		});

		this.peerEventUnsub = this.connections.on((event) => {
			this.handlePeerEvent(event);
		});

		this.exchangeTimer = setInterval(() => {
			this.exchangeRound();
		}, this.exchangeIntervalMs);
	}

	/** Stop gossip exchanges. */
	stop(): void {
		this.running = false;
		if (this.exchangeTimer) {
			clearInterval(this.exchangeTimer);
			this.exchangeTimer = null;
		}
		if (this.peerEventUnsub) {
			this.peerEventUnsub();
			this.peerEventUnsub = null;
		}
	}

	/** Stop and clear all state. */
	destroy(): void {
		this.stop();
		this.actorLocations.clear();
		this.handlers.length = 0;
	}

	// ─── Gossip Exchange ────────────────────────────────────────────

	/** Run one gossip exchange round with connected peers. */
	private exchangeRound(): void {
		const channels = this.connections.getConnectedChannels();
		if (channels.length === 0) return;

		const localView = this.gossip.getView().slice(0, this.maxViewSize);
		// Stamp originNodeId for transitive gossip location tracking
		const stamped = localView.map((v) => ({
			...v,
			originNodeId: v.originNodeId ?? this.localNodeId,
		}));
		const targets = this.selectGossipTargets(channels);

		for (const channel of targets) {
			channel.sendGossip(stamped);
			this.emit({ type: "gossip:sent", peerId: channel.peerId, viewSize: stamped.length });
		}
	}

	/**
	 * Handle an incoming gossip view from a remote peer.
	 * Merges into local gossip protocol and updates location map.
	 */
	receiveGossip(fromNodeId: string, views: PeerView[]): void {
		const changed = this.gossip.merge(views);

		for (const view of views) {
			// Use originNodeId for correct location even through transitive gossip
			this.updateLocation(view.actorId, view.originNodeId ?? fromNodeId);
			this.updateCapabilityIndex(view);
		}

		this.emit({
			type: "gossip:received",
			peerId: fromNodeId,
			viewSize: views.length,
			changedCount: changed.length,
		});
	}

	// ─── Location Map ───────────────────────────────────────────────

	private updateLocation(actorId: string, nodeId: string): void {
		const existing = this.actorLocations.get(actorId);
		if (!existing) {
			this.actorLocations.set(actorId, { nodeId, lastSeen: Date.now() });
			this.emit({ type: "actor:located", actorId, nodeId });
		} else if (existing.nodeId !== nodeId) {
			const fromNode = existing.nodeId;
			this.actorLocations.set(actorId, { nodeId, lastSeen: Date.now() });
			this.emit({ type: "actor:relocated", actorId, fromNode, toNode: nodeId });
		} else {
			existing.lastSeen = Date.now();
		}
	}

	/** Update the capability reverse-index for a gossip view. */
	private updateCapabilityIndex(view: PeerView): void {
		// Clear old entries for this actor
		for (const [, actors] of this.capabilityIndex) actors.delete(view.actorId);
		if (view.status !== "alive" || !view.capabilities) return;
		for (const cap of view.capabilities) {
			let set = this.capabilityIndex.get(cap);
			if (!set) { set = new Set(); this.capabilityIndex.set(cap, set); }
			set.add(view.actorId);
		}
	}

	/** Find nodeIds hosting actors with the given capability. */
	findNodesByCapability(capability: string): string[] {
		const actors = this.capabilityIndex.get(capability);
		if (!actors) return [];
		const nodes: string[] = [];
		for (const actorId of actors) {
			const nodeId = this.findNode(actorId);
			if (nodeId && !nodes.includes(nodeId)) nodes.push(nodeId);
		}
		return nodes;
	}

	private evictStaleLocations(): void {
		const cutoff = Date.now() - this.locationTtlMs;
		for (const [actorId, entry] of this.actorLocations) {
			if (entry.lastSeen < cutoff) {
				this.actorLocations.delete(actorId);
				this.emit({ type: "actor:lost", actorId, nodeId: entry.nodeId });
			}
		}
	}

	// ─── Target Selection ───────────────────────────────────────────

	/**
	 * Select a random subset of connected peers for gossip (fanout=3).
	 */
	private selectGossipTargets(channels: WsPeerChannel[]): WsPeerChannel[] {
		const fanout = Math.min(3, channels.length);
		const shuffled = [...channels];
		for (let i = shuffled.length - 1; i > shuffled.length - 1 - fanout && i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled.slice(shuffled.length - fanout);
	}

	// ─── Peer Events ────────────────────────────────────────────────

	private handlePeerEvent(event: PeerNetworkEvent): void {
		if (event.type === "peer:connected") {
			const localView = this.gossip.getView().slice(0, this.maxViewSize);
			const stamped = localView.map((v) => ({
				...v,
				originNodeId: v.originNodeId ?? this.localNodeId,
			}));
			const channels = this.connections.getConnectedChannels();
			const channel = channels.find((c) => c.peerId === event.peerId);
			if (channel && stamped.length > 0) {
				channel.sendGossip(stamped);
			}
		}
		if (event.type === "peer:dead" || event.type === "peer:disconnected") {
			for (const [actorId, entry] of this.actorLocations) {
				if (entry.nodeId === event.peerId) {
					this.actorLocations.delete(actorId);
					this.emit({ type: "actor:lost", actorId, nodeId: event.peerId });
				}
			}
		}
		if (event.type === "message:received") {
			// Gossip messages are dispatched from WsPeerChannel to here
		}
	}

	// ─── Helpers ────────────────────────────────────────────────────

	private emit(event: NetworkGossipEvent): void {
		for (const handler of this.handlers) {
			try { handler(event); } catch { /* non-fatal */ }
		}
	}
}
