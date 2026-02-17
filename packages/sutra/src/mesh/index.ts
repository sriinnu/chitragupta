/**
 * @chitragupta/sutra/mesh — P2P Actor Mesh module.
 *
 * Lock-free actor model with priority mailboxes, distributed routing,
 * SWIM-inspired gossip failure detection, and a top-level ActorSystem
 * coordinator. Extends @chitragupta/sutra with fine-grained concurrency.
 */

// Types
export type {
	ActorBehavior,
	ActorContext,
	ActorSystemConfig,
	AskOptions,
	MeshEnvelope,
	MeshPriority,
	MessageReceiver,
	MessageSender,
	PeerChannel,
	PeerView,
	SendOptions,
} from "./types.js";

// Mailbox
export { ActorMailbox } from "./actor-mailbox.js";

// Actor
export { Actor } from "./actor.js";

// Router
export { MeshRouter } from "./mesh-router.js";

// Gossip
export { GossipProtocol } from "./gossip-protocol.js";

// System
export { ActorSystem, ActorRef } from "./actor-system.js";
export type { SpawnOptions } from "./actor-system.js";
