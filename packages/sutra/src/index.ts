// @chitragupta/sutra — Inter-Agent Communication Protocol
export { CommHub } from "./hub.js";
export { detectDeadlocks, resolveDeadlock } from "./deadlock.js";
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

// Deadlock prevention (Banker's Algorithm)
export { BankersAlgorithm } from "./deadlock-prevention.js";
export type { BankerState, RequestResult } from "./deadlock-prevention.js";

// P2P Actor Mesh
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

// Message Bus (Sandesh)
export { MessageBus } from "./message-bus.js";
export type { BusMessage, SubscriptionOptions, BusHandler, MessageBusConfig } from "./message-bus.js";

// Agent Registry (Parichaya)
export { AgentRegistry } from "./agent-registry.js";
export type { AgentEntry, AgentQuery, AgentRegistryConfig } from "./agent-registry.js";

// Event Manager (Vaarta)
export { EventManager } from "./event-manager.js";
export type { SSEClient, WebhookConfig, WebhookDelivery, EventManagerConfig } from "./event-manager.js";

// Sandesha (Input Routing)
export { SandeshaRouter } from "./sandesha.js";
export type { InputRequest, InputResponse, SandeshaConfig } from "./sandesha.js";

// Samiti (Ambient Communication Channels)
export { Samiti } from "./samiti.js";
export type { SamitiMessage, SamitiChannel, SamitiConfig, SamitiStats, ListenOptions } from "./samiti.js";

// Sabha (Multi-Agent Deliberation Protocol)
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
