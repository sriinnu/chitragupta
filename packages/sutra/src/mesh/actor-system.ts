/**
 * @chitragupta/sutra/mesh — ActorSystem: top-level coordinator.
 *
 * The ActorSystem is the Brahma of the mesh — it creates, manages,
 * and destroys actors, wires them to the router and gossip protocol,
 * and exposes a high-level API for inter-actor communication.
 *
 * It owns:
 *   - A MeshRouter for message delivery
 *   - A GossipProtocol for membership and failure detection
 *   - A registry of spawned Actor instances
 *   - Lifecycle management (start/shutdown)
 *
 * ActorRef is a lightweight handle to a remote actor — it does not
 * hold a reference to the Actor itself, only to the router. This
 * decoupling allows ActorRefs to survive actor restarts and be safely
 * passed across boundaries.
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
	 * Stops all actors, clears the router, and halts gossip.
	 */
	shutdown(): void {
		if (!this.running) return;
		this.running = false;

		// Stop all actors
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
