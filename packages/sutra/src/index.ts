// @chitragupta/sutra — Inter-Agent Communication Protocol

/** Centralized hub for inter-agent message passing, shared memory, and synchronization primitives. */
export { CommHub } from "./hub.js";
/** Detect and resolve circular-wait deadlocks across agent lock graphs. */
export { detectDeadlocks, resolveDeadlock } from "./deadlock.js";
/** Higher-order communication patterns: fan-out, pipeline, map-reduce, saga, election, gossip. */
export { fanOut, pipeline, mapReduce, saga, election, gossip } from "./patterns.js";
export type {
	AgentEnvelope,
	Barrier,
	Channel,
	DeadlockInfo,
	HubConfig,
	HubStats,
	Lock,
	ResultCollector,
	SagaStep,
	Semaphore,
	SharedMemoryRegion,
} from "./types.js";

/** Banker's algorithm for deadlock prevention via safe-state analysis. */
export { BankersAlgorithm } from "./deadlock-prevention.js";
export type { BankerState, RequestResult } from "./deadlock-prevention.js";

// P2P Actor Mesh
/** Lock-free actor system with priority mailboxes and distributed routing. */
export {
	ActorMailbox,
	Actor,
	MeshRouter,
	GossipProtocol,
	ActorSystem,
	ActorRef,
} from "./mesh/index.js";
export type {
	ActorBehavior,
	ActorContext,
	ActorLearner,
	ActorSystemConfig,
	AskOptions,
	MeshEnvelope,
	MeshPriority,
	MessageReceiver,
	MessageSender,
	PeerChannel,
	PeerView,
	SendOptions,
	SpawnOptions,
} from "./mesh/index.js";

// P2P Actor Mesh — Capability Routing & Networking
/** Content-addressed capability router that scores actors by tool descriptors. */
export { CapabilityRouter } from "./mesh/index.js";
export type { CapabilityQuery, CapabilityStrategy, ScoredPeer } from "./mesh/index.js";
/** Online capability learner that tracks actor tool-call success rates. */
export { CapabilityLearner } from "./mesh/index.js";
export type { CapabilityLearnerConfig } from "./mesh/index.js";
/** SWIM-inspired gossip protocol for peer discovery over real networks. */
export { NetworkGossip, WsPeerChannel, PeerConnectionManager } from "./mesh/index.js";
export type { ActorLocationMap, NetworkGossipConfig, NetworkGossipEvent } from "./mesh/index.js";
/** Peer reputation guard with ban/decay scoring. */
export { PeerGuard } from "./mesh/index.js";
export type { PeerGuardConfig, PeerScore } from "./mesh/index.js";
/** Persistent address book for mesh peer endpoints. */
export { PeerAddrDb } from "./mesh/index.js";
export type { PeerAddr, PeerAddrSource, PeerAddrBucket, PeerAddrDbConfig } from "./mesh/index.js";
export type {
	PeerNodeInfo,
	PeerConnectionState,
	PeerConnectionStats,
	PeerMessage,
	PeerNetworkConfig,
	PeerNetworkEvent,
	PeerNetworkEventHandler,
	VersionInfo,
	CapableActorBehavior,
	MCPToolDescriptor,
} from "./mesh/index.js";
export {
	isCapableBehavior,
	PEER_NETWORK_DEFAULTS,
	MESH_PROTOCOL_VERSION,
	serializePeerMessage,
	deserializePeerMessage,
	validateEnvelope,
	stampOrigin,
	hasVisited,
	signMessage,
	verifySignature,
	generateEnvelopeId,
	createEnvelope,
} from "./mesh/index.js";

/** Pub/sub message bus with topic routing and durable subscriptions. */
export { MessageBus } from "./message-bus.js";
export type { BusMessage, SubscriptionOptions, BusHandler, MessageBusConfig } from "./message-bus.js";

/** Service-discovery registry for agents with capability-based querying. */
export { AgentRegistry } from "./agent-registry.js";
export type { AgentEntry, AgentQuery, AgentRegistryConfig } from "./agent-registry.js";

/** SSE + webhook event manager for real-time agent notifications. */
export { EventManager } from "./event-manager.js";
export type { SSEClient, WebhookConfig, WebhookDelivery, EventManagerConfig } from "./event-manager.js";

/** Input routing layer that classifies and dispatches user messages to agents. */
export { SandeshaRouter } from "./sandesha.js";
export type { InputRequest, InputResponse, SandeshaConfig } from "./sandesha.js";

/** Ambient communication channels for background agent-to-agent coordination. */
export { Samiti } from "./samiti.js";
export type { SamitiMessage, SamitiChannel, SamitiConfig, SamitiStats, ListenOptions } from "./samiti.js";

/** Multi-agent deliberation engine using Nyaya syllogistic reasoning and fallacy detection. */
export { SabhaEngine } from "./sabha.js";
export type {
	NyayaSyllogism,
	HetvabhasaType,
	HetvabhasaDetection,
	SabhaParticipant,
	SabhaVote,
	ChallengeRecord,
	SabhaStatus,
	SabhaRound,
	Sabha,
	SabhaConfig,
} from "./sabha.js";
