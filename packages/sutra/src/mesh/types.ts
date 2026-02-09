/**
 * @chitragupta/sutra/mesh — P2P Actor Mesh type definitions.
 *
 * Defines the data structures for a lock-free actor model inspired by
 * Kaala-Brahma's lifecycle architecture. Actors communicate through
 * prioritised message envelopes, discover peers via gossip, and route
 * messages through a distributed mesh.
 *
 * Naming follows Vedic convention:
 *   Sutra (thread) — the medium through which actors weave computation.
 */

// ─── Priority ───────────────────────────────────────────────────────────────

/** Message priority lane: 0 = low, 1 = normal, 2 = high, 3 = critical. */
export type MeshPriority = 0 | 1 | 2 | 3;

// ─── Envelope ───────────────────────────────────────────────────────────────

/** A message travelling through the actor mesh. */
export interface MeshEnvelope {
	id: string;
	from: string;
	to: string;
	type: "tell" | "ask" | "reply" | "signal";
	topic?: string;
	correlationId?: string;
	payload: unknown;
	priority: MeshPriority;
	timestamp: number;
	/** Time-to-live in milliseconds. Discarded after expiry. */
	ttl: number;
	/** Actor IDs this envelope has traversed — prevents routing loops. */
	hops: string[];
}

// ─── Behavior & Context ─────────────────────────────────────────────────────

/** A function that defines how an actor processes a single envelope. */
export type ActorBehavior = (
	envelope: MeshEnvelope,
	ctx: ActorContext,
) => void | Promise<void>;

/** Contextual handle provided to an actor during message processing. */
export interface ActorContext {
	/** This actor's ID. */
	self: string;
	/** Reply to the current envelope's sender. */
	reply(payload: unknown): void;
	/** Fire-and-forget send. */
	send(to: string, payload: unknown, opts?: SendOptions): void;
	/** Send and await a reply (request-reply). */
	ask(to: string, payload: unknown, opts?: AskOptions): Promise<MeshEnvelope>;
	/** Hot-swap the actor's behavior (Erlang-style become). */
	become(behavior: ActorBehavior): void;
	/** Stop this actor. */
	stop(): void;
}

// ─── Options ────────────────────────────────────────────────────────────────

export interface SendOptions {
	priority?: MeshPriority;
	topic?: string;
	ttl?: number;
}

export interface AskOptions extends SendOptions {
	/** Timeout in ms for the ask (default determined by system config). */
	timeout?: number;
}

// ─── Routing Contracts ──────────────────────────────────────────────────────

/** Any entity that can receive a MeshEnvelope (actor, channel, proxy). */
export interface MessageReceiver {
	readonly actorId: string;
	receive(envelope: MeshEnvelope): void;
}

/** Any entity that can route a MeshEnvelope to a destination. */
export interface MessageSender {
	route(envelope: MeshEnvelope): void;
}

/** A channel to a peer (remote router, bridge, etc.). */
export interface PeerChannel extends MessageReceiver {
	readonly peerId: string;
}

// ─── Gossip ─────────────────────────────────────────────────────────────────

/** A snapshot of a peer's liveness as seen by the gossip protocol. */
export interface PeerView {
	actorId: string;
	expertise?: string[];
	capabilities?: string[];
	status: "alive" | "suspect" | "dead";
	/** Lamport generation counter — higher generation wins during merge. */
	generation: number;
	lastSeen: number;
}

// ─── System Configuration ───────────────────────────────────────────────────

export interface ActorSystemConfig {
	maxMailboxSize?: number;
	defaultTTL?: number;
	gossipIntervalMs?: number;
	gossipFanout?: number;
	suspectTimeoutMs?: number;
	deadTimeoutMs?: number;
	/** Default ask timeout in ms. */
	defaultAskTimeout?: number;
}
