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
	CapableActorBehavior,
	MCPToolDescriptor,
	MeshEnvelope,
	MeshPriority,
	MessageReceiver,
	MessageSender,
	PeerChannel,
	PeerView,
	SendOptions,
} from "./types.js";
export { isCapableBehavior } from "./types.js";

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

// Capability Routing
export { CapabilityRouter } from "./capability-router.js";
export type { CapabilityQuery, CapabilityStrategy, ScoredPeer } from "./capability-router.js";

// P2P Network Transport
export { NetworkGossip } from "./network-gossip.js";
export type { ActorLocationMap, NetworkGossipConfig, NetworkGossipEvent } from "./network-gossip.js";
export { WsPeerChannel } from "./ws-peer-channel.js";
export { PeerConnectionManager } from "./peer-connection.js";
export { PeerGuard } from "./peer-guard.js";
export type { PeerGuardConfig, PeerScore } from "./peer-guard.js";
export { PeerAddrDb } from "./peer-addr-db.js";
export type { PeerAddr, PeerAddrSource, PeerAddrBucket, PeerAddrDbConfig } from "./peer-addr-db.js";
export type {
	PeerNodeInfo,
	PeerConnectionState,
	PeerConnectionStats,
	PeerMessage,
	PeerNetworkConfig,
	PeerNetworkEvent,
	PeerNetworkEventHandler,
	VersionInfo,
} from "./peer-types.js";
export { PEER_NETWORK_DEFAULTS, MESH_PROTOCOL_VERSION } from "./peer-types.js";
export {
	serializePeerMessage,
	deserializePeerMessage,
	validateEnvelope,
	stampOrigin,
	hasVisited,
	signMessage,
	verifySignature,
	generateEnvelopeId,
	createEnvelope,
} from "./peer-envelope.js";
