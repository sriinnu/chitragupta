/**
 * @chitragupta/sutra/mesh — ActorSystem: top-level coordinator.
 *
 * Owns the MeshRouter, GossipProtocol, actor registry, and lifecycle.
 * ActorRef is a lightweight handle that survives restarts.
 */

import { randomUUID } from "node:crypto";
import { Actor } from "./actor.js";
import { GossipProtocol } from "./gossip-protocol.js";
import { MeshRouter } from "./mesh-router.js";
import type {
	ActorBehavior,
	ActorSystemConfig,
	AskOptions,
	MeshEnvelope,
	MeshPriority,
	PeerView,
	SendOptions,
} from "./types.js";
import type { PeerNetworkConfig } from "./peer-types.js";
import type { PeerConnectionManager } from "./peer-connection.js";
import type { NetworkGossip } from "./network-gossip.js";

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS: Required<ActorSystemConfig> = {
	maxMailboxSize: 10_000,
	defaultTTL: 30_000,
	gossipIntervalMs: 1_000,
	gossipFanout: 3,
	suspectTimeoutMs: 5_000,
	deadTimeoutMs: 15_000,
	defaultAskTimeout: 10_000,
};

// ─── Events ─────────────────────────────────────────────────────────────────

type SystemEvent =
	| { type: "actor:spawned"; actorId: string }
	| { type: "actor:stopped"; actorId: string }
	| { type: "message:delivered"; envelope: MeshEnvelope }
	| { type: "message:undeliverable"; envelope: MeshEnvelope; reason: string }
	| { type: "peer:discovered"; peer: PeerView }
	| { type: "peer:suspect"; peer: PeerView }
	| { type: "peer:dead"; peer: PeerView };

type SystemEventHandler = (event: SystemEvent) => void;

// ─── Spawn Options ──────────────────────────────────────────────────────────

export interface SpawnOptions {
	behavior: ActorBehavior;
	expertise?: string[];
	capabilities?: string[];
	mailboxSize?: number;
}

// ─── ActorRef ───────────────────────────────────────────────────────────────

/**
 * A lightweight reference to an actor. Does not hold the Actor object —
 * only its ID and a handle to the router for message sending.
 *
 * Safe to serialize (only the actorId matters), pass across boundaries,
 * and use after actor restarts.
 */
export class ActorRef {
	readonly actorId: string;
	private readonly router: MeshRouter;

	constructor(actorId: string, router: MeshRouter) {
		this.actorId = actorId;
		this.router = router;
	}

	/**
	 * Fire-and-forget send to this actor.
	 */
	tell(from: string, payload: unknown, opts?: SendOptions): void {
		const envelope: MeshEnvelope = {
			id: randomUUID(),
			from,
			to: this.actorId,
			type: "tell",
			topic: opts?.topic,
			payload,
			priority: opts?.priority ?? 1,
			timestamp: Date.now(),
			ttl: opts?.ttl ?? 30_000,
			hops: [from],
		};
		this.router.route(envelope);
	}

	/**
	 * Send and await a reply from this actor.
	 */
	ask(from: string, payload: unknown, opts?: AskOptions): Promise<MeshEnvelope> {
		return this.router.ask(from, this.actorId, payload, opts);
	}

	/**
	 * Identity comparison.
	 */
	equals(other: ActorRef): boolean {
		return this.actorId === other.actorId;
	}

	toString(): string {
		return `ActorRef(${this.actorId})`;
	}
}

// ─── ActorSystem ────────────────────────────────────────────────────────────

/**
 * Top-level coordinator for the P2P actor mesh.
 *
 * @example
 * ```ts
 * const system = new ActorSystem({ maxMailboxSize: 5000 });
 * system.start();
 *
 * const ref = system.spawn("echo", {
 *   behavior: (env, ctx) => ctx.reply(env.payload),
 * });
 *
 * const reply = await ref.ask("caller", "hello");
 * console.log(reply.payload); // "hello"
 *
 * system.shutdown();
 * ```
 */
export class ActorSystem {
	private readonly config: Required<ActorSystemConfig>;
	private readonly router: MeshRouter;
	private readonly gossip: GossipProtocol;
	private readonly actors = new Map<string, Actor>();
	private readonly eventHandlers: SystemEventHandler[] = [];
	private running = false;

	constructor(config?: ActorSystemConfig) {
		this.config = { ...DEFAULTS, ...config };
		this.router = new MeshRouter(this.config.defaultTTL, this.config.defaultAskTimeout);
		this.gossip = new GossipProtocol(this.config);

		// Wire router events to system events
		this.router.on((event) => {
			if (event.type === "delivered") {
				this.emit({ type: "message:delivered", envelope: event.envelope });
			} else if (event.type === "undeliverable") {
				this.emit({
					type: "message:undeliverable",
					envelope: event.envelope,
					reason: event.reason,
				});
			}
		});

		// Wire gossip events to system events
		this.gossip.on((event) => {
			this.emit(event);
		});
	}

	// ─── Event subscription ────────────────────────────────────────

	on(handler: SystemEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const idx = this.eventHandlers.indexOf(handler);
			if (idx >= 0) this.eventHandlers.splice(idx, 1);
		};
	}

	private emit(event: SystemEvent): void {
		for (const h of this.eventHandlers) {
			try { h(event); } catch { /* observer failures are non-fatal */ }
		}
	}

	// ─── Actor lifecycle ───────────────────────────────────────────

	/**
	 * Spawn a new actor in the mesh.
	 *
	 * @param id - Unique actor identifier.
	 * @param options - Behavior, expertise, capabilities, and mailbox size.
	 * @returns An ActorRef for communicating with the actor.
	 * @throws If an actor with the same ID already exists.
	 */
	spawn(id: string, options: SpawnOptions): ActorRef {
		if (this.actors.has(id)) {
			throw new Error(`Actor "${id}" already exists in this system.`);
		}

		const mailboxSize = options.mailboxSize ?? this.config.maxMailboxSize;
		const actor = new Actor(id, options.behavior, this.router, mailboxSize);

		this.actors.set(id, actor);
		this.router.addActor(actor);
		this.gossip.register(id, options.expertise, options.capabilities);

		this.emit({ type: "actor:spawned", actorId: id });

		return new ActorRef(id, this.router);
	}

	/**
	 * Stop and remove an actor from the mesh.
	 *
	 * @returns `true` if the actor was found and stopped.
	 */
	stop(actorId: string): boolean {
		const actor = this.actors.get(actorId);
		if (!actor) return false;

		actor.kill();
		this.actors.delete(actorId);
		this.router.removeActor(actorId);
		this.gossip.unregister(actorId);

		this.emit({ type: "actor:stopped", actorId });

		return true;
	}

	/**
	 * Get an ActorRef for an existing actor.
	 *
	 * @returns The ref, or `undefined` if the actor does not exist.
	 */
	ref(actorId: string): ActorRef | undefined {
		if (!this.actors.has(actorId)) return undefined;
		return new ActorRef(actorId, this.router);
	}

	// ─── Messaging (convenience) ───────────────────────────────────

	/**
	 * Fire-and-forget message from one actor to another.
	 */
	tell(from: string, to: string, payload: unknown, opts?: SendOptions): void {
		const envelope: MeshEnvelope = {
			id: randomUUID(),
			from,
			to,
			type: "tell",
			topic: opts?.topic,
			payload,
			priority: opts?.priority ?? 1,
			timestamp: Date.now(),
			ttl: opts?.ttl ?? this.config.defaultTTL,
			hops: [from],
		};
		this.router.route(envelope);
	}

	/**
	 * Request-reply from one actor to another.
	 */
	ask(
		from: string,
		to: string,
		payload: unknown,
		opts?: AskOptions,
	): Promise<MeshEnvelope> {
		return this.router.ask(from, to, payload, opts);
	}

	/**
	 * Broadcast a message to all actors.
	 */
	broadcast(from: string, payload: unknown, opts?: SendOptions): void {
		const envelope: MeshEnvelope = {
			id: randomUUID(),
			from,
			to: "*",
			type: "tell",
			topic: opts?.topic,
			payload,
			priority: opts?.priority ?? 1,
			timestamp: Date.now(),
			ttl: opts?.ttl ?? this.config.defaultTTL,
			hops: [from],
		};
		this.router.route(envelope);
	}

	// ─── Pub/sub ───────────────────────────────────────────────────

	subscribe(actorId: string, topic: string): void {
		this.router.subscribe(actorId, topic);
	}

	unsubscribe(actorId: string, topic: string): void {
		this.router.unsubscribe(actorId, topic);
	}

	// ─── Peer discovery ────────────────────────────────────────────

	/**
	 * Find alive peers with the given expertise.
	 */
	findByExpertise(expertise: string): PeerView[] {
		return this.gossip.findByExpertise(expertise);
	}

	/**
	 * Return all alive peers in the mesh.
	 */
	findAlive(): PeerView[] {
		return this.gossip.findAlive();
	}

	// ─── P2P Network ──────────────────────────────────────────────

	private connectionManager: PeerConnectionManager | null = null;
	private networkGossip: NetworkGossip | null = null;

	/**
	 * Bootstrap real P2P mesh networking on this actor system.
	 *
	 * Creates a WebSocket listener for incoming peers, connects to
	 * configured static peers, and starts network gossip so all nodes
	 * converge on a shared view of the actor population.
	 *
	 * @returns The port the mesh listener is bound to.
	 */
	async bootstrapP2P(networkConfig: PeerNetworkConfig): Promise<number> {
		const { PeerConnectionManager: ConnMgr } = await import("./peer-connection.js");
		const { NetworkGossip: NetGossip } = await import("./network-gossip.js");

		this.connectionManager = new ConnMgr(networkConfig);
		this.connectionManager.setRouter(this.router);

		this.networkGossip = new NetGossip(
			this.connectionManager.nodeId,
			this.gossip,
			this.connectionManager,
			{ exchangeIntervalMs: networkConfig.gossipIntervalMs },
		);

		// P2P mesh resolver: actorId → gossip location → peer channel
		this.router.setPeerChannelResolver((actorId) => {
			const nodeId = this.networkGossip?.findNode(actorId);
			if (!nodeId) return undefined;
			const channels = this.connectionManager!.getConnectedChannels();
			return channels.find((ch) =>
				ch.peerId === nodeId || ch.remoteNodeInfo?.nodeId === nodeId,
			);
		});

		// Start gossip before connections so handler is wired for first connect
		this.networkGossip.start();
		const port = await this.connectionManager.start();

		this.connectionManager.on((event) => {
			if (event.type === "peer:connected") {
				// Register channel with router for broadcast support
				const ch = this.connectionManager!.getConnectedChannels()
					.find((c) => c.peerId === event.peerId);
				if (ch) this.router.addChannel(ch);
				this.emit({ type: "peer:discovered", peer: {
					actorId: event.peerId,
					status: "alive",
					generation: 0,
					lastSeen: Date.now(),
				}});
			}
			if (event.type === "peer:disconnected" || event.type === "peer:dead") {
				this.router.removeChannel(event.peerId);
			}
		});

		return port;
	}

	/** Get the network gossip layer (null if P2P not bootstrapped). */
	getNetworkGossip(): NetworkGossip | null { return this.networkGossip; }

	/** Get the connection manager (null if P2P not bootstrapped). */
	getConnectionManager(): PeerConnectionManager | null { return this.connectionManager; }

	/** Expose the internal router for advanced use (e.g., PeerChannel wiring). */
	getRouter(): MeshRouter { return this.router; }

	/** Expose the internal gossip protocol. */
	getGossipProtocol(): GossipProtocol { return this.gossip; }

	// ─── Lifecycle ─────────────────────────────────────────────────

	/**
	 * Start the actor system (begins gossip sweep timer).
	 */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.gossip.start();
	}

	/**
	 * Gracefully shut down the actor system.
	 *
	 * Stops all actors, clears the router, halts gossip, and
	 * disconnects all P2P peers.
	 */
	async shutdown(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		if (this.networkGossip) {
			this.networkGossip.destroy();
			this.networkGossip = null;
		}
		if (this.connectionManager) {
			await this.connectionManager.stop();
			this.connectionManager = null;
		}

		for (const [id, actor] of this.actors) {
			actor.kill();
			this.emit({ type: "actor:stopped", actorId: id });
		}
		this.actors.clear();

		this.gossip.stop();
		this.router.destroy();
		this.eventHandlers.length = 0;
	}

	/**
	 * Whether the system is currently running.
	 */
	get isRunning(): boolean {
		return this.running;
	}

	/**
	 * Number of live actors in the system.
	 */
	get actorCount(): number {
		return this.actors.size;
	}
}
