/**
 * @chitragupta/sutra — Inter-Agent Communication Protocol types.
 *
 * Defines the core data structures for message passing, shared memory,
 * coordination primitives, and result collection between agents.
 */

// ─── Message Passing ────────────────────────────────────────────────────────

/** A message sent between agents. */
export interface AgentEnvelope {
	id: string;
	from: string;
	to: string | "*";
	topic: string;
	payload: unknown;
	timestamp: number;
	replyTo?: string;
	ttl?: number;
	priority: "high" | "normal" | "low";
}

// ─── Shared Memory ──────────────────────────────────────────────────────────

/** Shared memory region accessible by multiple agents. */
export interface SharedMemoryRegion {
	id: string;
	name: string;
	owner: string;
	data: Record<string, unknown>;
	version: number;
	accessList: string[];
	createdAt: number;
	updatedAt: number;
	maxSize?: number;
	ttl?: number;
}

// ─── Coordination Primitives ────────────────────────────────────────────────

/** Lock for coordinating access to shared resources. */
export interface Lock {
	id: string;
	resource: string;
	holder: string;
	acquiredAt: number;
	expiresAt: number;
	waitQueue: string[];
}

/** A named channel for pub/sub communication. */
export interface Channel {
	topic: string;
	subscribers: Set<string>;
	history: AgentEnvelope[];
	maxHistory: number;
}

/** Coordination barrier — blocks until N agents reach it. */
export interface Barrier {
	id: string;
	name: string;
	required: number;
	arrived: Set<string>;
	resolvers: Array<() => void>;
}

/** Semaphore — limits concurrent access to a resource. */
export interface Semaphore {
	id: string;
	name: string;
	maxPermits: number;
	currentPermits: number;
	waitQueue: Array<{ agentId: string; resolve: () => void }>;
}

// ─── Result Collection ──────────────────────────────────────────────────────

/** Result aggregator — collects results from multiple agents. */
export interface ResultCollector<T = unknown> {
	id: string;
	expected: number;
	results: Map<string, T>;
	errors: Map<string, Error>;
	resolvers: Array<(results: Map<string, T>) => void>;
}

// ─── Hub Configuration ──────────────────────────────────────────────────────

/** Configuration for the communication hub. */
export interface HubConfig {
	maxChannels?: number;
	maxMessageHistory?: number;
	defaultMessageTTL?: number;
	lockTimeout?: number;
	enableLogging?: boolean;
}

/** Runtime statistics for the communication hub. */
export interface HubStats {
	channels: number;
	totalMessages: number;
	activeSubscriptions: number;
	regions: number;
	activeLocks: number;
	barriers: number;
	semaphores: number;
	collectors: number;
}

// ─── Patterns ───────────────────────────────────────────────────────────────

/** A single step in a saga (distributed transaction). */
export interface SagaStep {
	agentId: string;
	topic: string;
	payload: unknown;
	compensate: {
		agentId: string;
		topic: string;
		payload: unknown;
	};
}

// ─── Deadlock Detection ─────────────────────────────────────────────────────

/** Information about a detected deadlock cycle. */
export interface DeadlockInfo {
	cycle: string[];
	resources: string[];
}
