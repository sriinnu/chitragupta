/**
 * Structural mesh/actor types compatible with @chitragupta/sutra.
 *
 * Defined here to avoid a circular dependency (anina builds before sutra).
 * TypeScript's structural typing ensures real Sutra objects satisfy these.
 *
 * @module types-mesh
 */

/** Structural interface for an actor reference (compatible with sutra ActorRef). */
export interface MeshActorRef {
	readonly actorId: string;
	tell(from: string, payload: unknown, opts?: { priority?: number; topic?: string; ttl?: number }): void;
	ask(from: string, payload: unknown, opts?: { priority?: number; topic?: string; ttl?: number; timeout?: number }): Promise<{ payload: unknown }>;
}

/** The behavior function an actor executes per message. */
export type MeshActorBehavior = (
	envelope: MeshEnvelopeCompat,
	ctx: MeshActorContextCompat,
) => void | Promise<void>;

/** Structural interface for a mesh envelope (compatible with sutra MeshEnvelope). */
export interface MeshEnvelopeCompat {
	id: string;
	from: string;
	to: string;
	type: "tell" | "ask" | "reply" | "signal";
	topic?: string;
	correlationId?: string;
	payload: unknown;
	priority: number;
	timestamp: number;
	ttl: number;
	hops: string[];
}

/** Structural interface for actor context (compatible with sutra ActorContext). */
export interface MeshActorContextCompat {
	self: string;
	reply(payload: unknown): void;
	send(to: string, payload: unknown, opts?: { priority?: number; topic?: string; ttl?: number }): void;
	ask(to: string, payload: unknown, opts?: { priority?: number; topic?: string; ttl?: number; timeout?: number }): Promise<{ payload: unknown }>;
	become(behavior: MeshActorBehavior): void;
	stop(): void;
}

/** Structural interface for an actor system (compatible with sutra ActorSystem). */
export interface MeshActorSystem {
	spawn(id: string, options: {
		behavior: MeshActorBehavior;
		expertise?: string[];
		capabilities?: string[];
		mailboxSize?: number;
	}): MeshActorRef;
	stop(actorId: string): boolean;
	tell(from: string, to: string, payload: unknown, opts?: { priority?: number; topic?: string; ttl?: number }): void;
	ask(from: string, to: string, payload: unknown, opts?: { priority?: number; topic?: string; ttl?: number; timeout?: number }): Promise<{ payload: unknown }>;
}

/** Structural interface for ambient channels (compatible with sutra Samiti). */
export interface MeshSamiti {
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: "info" | "warning" | "critical";
			category: string;
			content: string;
			data?: unknown;
			ttl?: number;
		},
	): unknown;
}

/** Finding from a Lokapala guardian scan. */
export interface LokapalaFinding {
	id: string;
	guardianId: string;
	domain: "security" | "performance" | "correctness";
	severity: "info" | "warning" | "critical";
	title: string;
	description: string;
	location?: string;
	suggestion?: string;
	confidence: number;
	autoFixable: boolean;
	timestamp: number;
}

/** Structural interface for Lokapala guardians (compatible with anina LokapalaController). */
export interface LokapalaGuardians {
	afterToolExecution(
		toolName: string,
		args: Record<string, unknown>,
		output: string,
		durationMs: number,
	): LokapalaFinding[];
}

/** Heartbeat data for KaalaBrahma agent lifecycle tracking. */
export interface KaalaHeartbeat {
	agentId: string;
	lastBeat: number;
	startedAt: number;
	turnCount: number;
	tokenUsage: number;
	status: "alive" | "stale" | "dead" | "killed" | "completed" | "error";
	parentId: string | null;
	depth: number;
	purpose: string;
	tokenBudget: number;
}

/** Status change callback for KaalaBrahma lifecycle events. */
export type KaalaStatusChangeCallback = (agentId: string, oldStatus: string, newStatus: string) => void;

/** Structural interface for KaalaBrahma (agent lifecycle manager). */
export interface KaalaLifecycle {
	registerAgent(heartbeat: KaalaHeartbeat): void;
	recordHeartbeat(agentId: string, data?: Partial<KaalaHeartbeat>): void;
	markCompleted(agentId: string): void;
	markError(agentId: string): void;
	/** Start periodic monitoring (healTree every heartbeatInterval). */
	startMonitoring(): void;
	/** Stop periodic monitoring. */
	stopMonitoring(): void;
	/** Subscribe to agent status changes. Returns unsubscribe function. */
	onStatusChange(cb: KaalaStatusChangeCallback): () => void;
	/** Detect and heal stale/dead agents, reap orphans. */
	healTree(): unknown;
	/** Get full tree health snapshot. */
	getTreeHealth(): unknown;
}
