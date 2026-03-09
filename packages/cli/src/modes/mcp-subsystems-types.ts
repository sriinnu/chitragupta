/**
 * Duck-Typed Interfaces for MCP Subsystems.
 *
 * Lightweight interfaces that mirror the real classes from @chitragupta/sutra,
 * @chitragupta/smriti, and @chitragupta/anina. Used by the lazy singletons in
 * mcp-subsystems.ts so heavy modules are only loaded on first access.
 *
 * @module
 */

// ─── Collective Intelligence ────────────────────────────────────────────────

/** Duck-typed Samiti (ambient channels). */
export interface SamitiLike {
	listChannels(): Array<{
		name: string;
		description: string;
		messages: Array<{ id: string; sender: string; severity: string; content: string; timestamp: number }>;
		subscribers: Set<string>;
	}>;
	listen(
		channel: string,
		opts?: { limit?: number },
	): Array<{
		id: string;
		sender: string;
		severity: string;
		category: string;
		content: string;
		timestamp: number;
	}>;
	broadcast(
		channel: string,
		message: { sender: string; severity: "info" | "warning" | "critical"; category: string; content: string },
	): { id: string };
}

/** Duck-typed SabhaEngine (multi-agent deliberation). */
type MaybePromise<T> = T | Promise<T>;

/** Duck-typed SabhaEngine (multi-agent deliberation). */
export interface SabhaEngineLike {
	convene(
		topic: string,
		convener: string,
		participants: Array<{ id: string; role: string; expertise: number; credibility: number }>,
	): MaybePromise<{ id: string }>;
	propose(
		sabhaId: string,
		proposerId: string,
		syllogism: {
			pratijna: string;
			hetu: string;
			udaharana: string;
			upanaya: string;
			nigamana: string;
		},
	): MaybePromise<unknown>;
	vote(
		sabhaId: string,
		participantId: string,
		position: "support" | "oppose" | "abstain",
		reasoning: string,
	): MaybePromise<unknown>;
	conclude(sabhaId: string): MaybePromise<{ finalVerdict: string | null; topic: string }>;
	explain(sabhaId: string): MaybePromise<string>;
}

/** Duck-typed AkashaField (shared knowledge traces). */
export interface AkashaFieldLike {
	query(
		topic: string,
		opts?: { type?: string; limit?: number },
	): Array<{
		id: string;
		agentId: string;
		traceType: string;
		topic: string;
		content: string;
		strength: number;
		reinforcements: number;
	}> | Promise<Array<{
		id: string;
		agentId: string;
		traceType: string;
		topic: string;
		content: string;
		strength: number;
		reinforcements: number;
	}>>;
	leave(
		agentId: string,
		type: string,
		topic: string,
		content: string,
		metadata?: Record<string, unknown>,
	): { id: string } | Promise<{ id: string }>;
	strongest?(limit?: number): Array<Record<string, unknown>> | Promise<Array<Record<string, unknown>>>;
	stats?(): Record<string, unknown> | Promise<Record<string, unknown>>;
	setOnEvent?(handler: (event: { type: string; trace?: unknown }) => void): void;
}

// ─── Behavioral & Health ────────────────────────────────────────────────────

/** Duck-typed VasanaEngine (behavioral tendencies). */
export interface VasanaEngineLike {
	getVasanas(
		project: string,
		topK?: number,
	): Array<{
		id: string;
		tendency: string;
		description: string;
		strength: number;
		stability: number;
		valence: string;
		reinforcementCount: number;
		predictiveAccuracy: number;
	}>;
}

/** Duck-typed Triguna (system health). */
export interface TrigunaLike {
	getState(): { sattva: number; rajas: number; tamas: number };
	getDominant(): string;
	getTrend(): { sattva: string; rajas: string; tamas: string };
	getHistory(limit?: number): Array<{
		state: { sattva: number; rajas: number; tamas: number };
		timestamp: number;
		dominant: string;
	}>;
	update(obs: {
		errorRate: number;
		tokenVelocity: number;
		loopCount: number;
		latency: number;
		successRate: number;
		userSatisfaction: number;
	}): { sattva: number; rajas: number; tamas: number };
}

// ─── Consciousness & Identity ───────────────────────────────────────────────

/** Duck-typed ChetanaController (consciousness layer). */
export interface ChetanaControllerLike {
	getCognitiveReport(): {
		affect: { valence: number; arousal: number; confidence: number; frustration: number };
		topConcepts: Array<{ concept: string; weight: number }>;
		topTools: Array<{ tool: string; weight: number }>;
		selfSummary: {
			calibration: number;
			learningVelocity: number;
			topTools: Array<{ tool: string; mastery: { successRate: number } }>;
			limitations: string[];
			style: Map<string, unknown>;
		};
		intentions: unknown[];
	};
}

/** Duck-typed SoulManager (agent identity). */
export interface SoulManagerLike {
	getAll(): Array<{
		id: string;
		name: string;
		archetype: { name: string; traits: string[]; strengths: string[] };
		purpose: string;
		learnedTraits: string[];
		confidenceModel: Map<string, number>;
		values: string[];
	}>;
	get(agentId: string):
		| {
				id: string;
				name: string;
				archetype: { name: string; traits: string[]; strengths: string[] };
				purpose: string;
				learnedTraits: string[];
				confidenceModel: Map<string, number>;
				values: string[];
		  }
		| undefined;
}

// ─── P2P Mesh ───────────────────────────────────────────────────────────────

/** Duck-typed ActorSystem (P2P mesh). */
export interface ActorSystemLike {
	readonly actorCount: number;
	readonly isRunning: boolean;
	spawn(id: string, options: {
		behavior: unknown;
		expertise?: string[];
		capabilities?: string[];
		mailboxSize?: number;
	}): unknown;
	tell(from: string, to: string, payload: unknown, opts?: Record<string, unknown>): void;
	ask(from: string, to: string, payload: unknown, opts?: Record<string, unknown>): Promise<unknown>;
	start(): void;
	shutdown(): Promise<void>;
	getRouter(): unknown;
	getGossipProtocol(): {
		getView(): Array<{
			actorId: string;
			status: string;
			expertise?: string[];
			capabilities?: string[];
			generation: number;
			lastSeen: number;
			originNodeId?: string;
		}>;
		findByCapability(cap: string): Array<{
			actorId: string;
			status: string;
			capabilities?: string[];
			originNodeId?: string;
			lastSeen: number;
			generation: number;
		}>;
		findByExpertise(
			exp: string,
		): Array<{ actorId: string; status: string; expertise?: string[]; originNodeId?: string; lastSeen: number }>;
		findAlive(): Array<{
			actorId: string;
			status: string;
			capabilities?: string[];
			expertise?: string[];
			originNodeId?: string;
			lastSeen: number;
		}>;
	} | null;
	getConnectionManager(): {
		readonly nodeId: string;
		readonly connectedCount: number;
		readonly peerCount: number;
		getPeers(): Array<{ peerId: string; endpoint: string; state: string; outbound: boolean }>;
	} | null;
	getCapabilityRouter(): {
		resolve(query: {
			capabilities: string[];
			strategy?: string;
		}): { actorId: string; status: string; capabilities?: string[]; originNodeId?: string } | undefined;
		findMatchingAll(
			caps: string[],
		): Array<{ actorId: string; status: string; capabilities?: string[]; originNodeId?: string }>;
	} | null;
	getNetworkGossip(): { readonly locationCount: number; getLocations(): ReadonlyMap<string, string> } | null;
}

// ─── Skills ─────────────────────────────────────────────────────────────────

/** Duck-typed SkillRegistry (vidhya-skills). */
export interface SkillRegistryLike {
	readonly size: number;
	register(manifest: Record<string, unknown>): void;
	getByName(name: string): Record<string, unknown> | undefined;
	getByTag(tag: string): Array<Record<string, unknown>>;
	getByVerb(verb: string): Array<Record<string, unknown>>;
	getAll(): Array<Record<string, unknown>>;
}

/** Duck-typed SkillDiscovery (vidhya-skills). */
export interface SkillDiscoveryLike {
	discoverFromDirectory(path: string): Promise<Array<Record<string, unknown>>>;
}

/** Duck-typed UI extension registry used by MCP plugin tools. */
export interface UIExtensionRegistryLike {
	register(extension: {
		skillName: string;
		version: string;
		widgets: Array<Record<string, unknown>>;
		keybinds: Array<Record<string, unknown>>;
		panels: Array<Record<string, unknown>>;
		registeredAt: number;
	}): void;
}
