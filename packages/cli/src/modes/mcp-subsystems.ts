/**
 * MCP Subsystem Duck Types & Lazy Singletons.
 *
 * Duck-typed interfaces for collective-intelligence subsystems and lazily
 * initialised singletons. We avoid importing heavy classes at module load
 * time — they are resolved via dynamic `import()` on first access.
 *
 * @module
 */

// ─── Duck-Typed Interfaces ──────────────────────────────────────────────────

/** Duck-typed Samiti (ambient channels). */
export interface SamitiLike {
	listChannels(): Array<{
		name: string;
		description: string;
		messages: Array<{ id: string; sender: string; severity: string; content: string; timestamp: number }>;
		subscribers: Set<string>;
	}>;
	listen(channel: string, opts?: { limit?: number }): Array<{
		id: string; sender: string; severity: string; category: string;
		content: string; timestamp: number;
	}>;
	broadcast(
		channel: string,
		message: { sender: string; severity: "info" | "warning" | "critical"; category: string; content: string },
	): { id: string };
}

/** Duck-typed SabhaEngine (multi-agent deliberation). */
export interface SabhaEngineLike {
	convene(
		topic: string,
		convener: string,
		participants: Array<{ id: string; role: string; expertise: number; credibility: number }>,
	): { id: string };
	propose(sabhaId: string, proposerId: string, syllogism: {
		pratijna: string; hetu: string; udaharana: string; upanaya: string; nigamana: string;
	}): unknown;
	vote(sabhaId: string, participantId: string, position: "support" | "oppose" | "abstain", reasoning: string): unknown;
	conclude(sabhaId: string): { finalVerdict: string | null; topic: string };
	explain(sabhaId: string): string;
}

/** Duck-typed AkashaField (shared knowledge traces). */
export interface AkashaFieldLike {
	query(topic: string, opts?: { type?: string; limit?: number }): Array<{
		id: string; agentId: string; traceType: string; topic: string;
		content: string; strength: number; reinforcements: number;
	}>;
	leave(agentId: string, type: string, topic: string, content: string): { id: string };
}

/** Duck-typed VasanaEngine (behavioral tendencies). */
export interface VasanaEngineLike {
	getVasanas(project: string, topK?: number): Array<{
		id: string; tendency: string; description: string;
		strength: number; stability: number; valence: string;
		reinforcementCount: number; predictiveAccuracy: number;
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
}

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
		id: string; name: string;
		archetype: { name: string; traits: string[]; strengths: string[] };
		purpose: string; learnedTraits: string[];
		confidenceModel: Map<string, number>;
		values: string[];
	}>;
	get(agentId: string): {
		id: string; name: string;
		archetype: { name: string; traits: string[]; strengths: string[] };
		purpose: string; learnedTraits: string[];
		confidenceModel: Map<string, number>;
		values: string[];
	} | undefined;
}

/** Duck-typed ActorSystem (P2P mesh). */
export interface ActorSystemLike {
	readonly actorCount: number;
	readonly isRunning: boolean;
	spawn(id: string, behavior: unknown, opts?: Record<string, unknown>): unknown;
	tell(from: string, to: string, payload: unknown, opts?: Record<string, unknown>): void;
	ask(from: string, to: string, payload: unknown, opts?: Record<string, unknown>): Promise<unknown>;
	start(): void;
	shutdown(): Promise<void>;
	getRouter(): unknown;
	getGossipProtocol(): {
		getView(): Array<{ actorId: string; status: string; expertise?: string[]; capabilities?: string[]; generation: number; lastSeen: number; originNodeId?: string }>;
		findByCapability(cap: string): Array<{ actorId: string; status: string; capabilities?: string[]; originNodeId?: string; lastSeen: number; generation: number }>;
		findByExpertise(exp: string): Array<{ actorId: string; status: string; expertise?: string[]; originNodeId?: string; lastSeen: number }>;
		findAlive(): Array<{ actorId: string; status: string; capabilities?: string[]; expertise?: string[]; originNodeId?: string; lastSeen: number }>;
	} | null;
	getConnectionManager(): {
		readonly nodeId: string;
		readonly connectedCount: number;
		readonly peerCount: number;
		getPeers(): Array<{ peerId: string; endpoint: string; state: string; outbound: boolean }>;
	} | null;
	getCapabilityRouter(): {
		resolve(query: { capabilities: string[]; strategy?: string }): { actorId: string; status: string; capabilities?: string[]; originNodeId?: string } | undefined;
		findMatchingAll(caps: string[]): Array<{ actorId: string; status: string; capabilities?: string[]; originNodeId?: string }>;
	} | null;
	getNetworkGossip(): { readonly locationCount: number; getLocations(): ReadonlyMap<string, string> } | null;
}

/** Duck-typed SkillRegistry (vidhya-skills). */
export interface SkillRegistryLike {
	readonly size: number;
	register(manifest: Record<string, unknown>): void;
	getByName(name: string): Record<string, unknown> | undefined;
	getByTag(tag: string): Array<Record<string, unknown>>;
	getByVerb(verb: string): Array<Record<string, unknown>>;
	getAll(): Array<Record<string, unknown>>;
}

// ─── Lazy Singletons ────────────────────────────────────────────────────────

let _samiti: SamitiLike | undefined;
let _sabha: SabhaEngineLike | undefined;
let _akasha: AkashaFieldLike | undefined;
let _vasana: VasanaEngineLike | undefined;
let _triguna: TrigunaLike | undefined;
let _chetana: ChetanaControllerLike | undefined;
let _soulManager: SoulManagerLike | undefined;
let _actorSystem: ActorSystemLike | undefined;
let _skillRegistry: SkillRegistryLike | undefined;

/** Lazily create or return the Samiti singleton. */
export async function getSamiti(): Promise<SamitiLike> {
	if (!_samiti) {
		const { Samiti } = await import("@chitragupta/sutra");
		_samiti = new Samiti() as unknown as SamitiLike;
	}
	return _samiti;
}

/** Lazily create or return the SabhaEngine singleton. */
export async function getSabha(): Promise<SabhaEngineLike> {
	if (!_sabha) {
		const { SabhaEngine } = await import("@chitragupta/sutra");
		_sabha = new SabhaEngine() as unknown as SabhaEngineLike;
	}
	return _sabha;
}

/** Lazily create or return the AkashaField singleton. */
export async function getAkasha(): Promise<AkashaFieldLike> {
	if (!_akasha) {
		const { AkashaField } = await import("@chitragupta/smriti");
		_akasha = new AkashaField() as unknown as AkashaFieldLike;
	}
	return _akasha;
}

/** Lazily create or return the VasanaEngine singleton. */
export async function getVasana(): Promise<VasanaEngineLike> {
	if (!_vasana) {
		const { VasanaEngine } = await import("@chitragupta/smriti");
		_vasana = new VasanaEngine() as unknown as VasanaEngineLike;
	}
	return _vasana;
}

/** Lazily create or return the Triguna singleton. */
export async function getTriguna(): Promise<TrigunaLike> {
	if (!_triguna) {
		const { Triguna } = await import("@chitragupta/anina");
		_triguna = new Triguna() as unknown as TrigunaLike;
	}
	return _triguna;
}

/** Lazily create or return the ChetanaController singleton. */
export async function getChetana(): Promise<ChetanaControllerLike> {
	if (!_chetana) {
		const { ChetanaController } = await import("@chitragupta/anina");
		_chetana = new ChetanaController() as unknown as ChetanaControllerLike;
	}
	return _chetana;
}

/** Lazily create or return the SoulManager singleton (loads persisted souls from disk). */
export async function getSoulManager(): Promise<SoulManagerLike> {
	if (!_soulManager) {
		const { SoulManager } = await import("@chitragupta/anina");
		_soulManager = new SoulManager({ persist: true }) as unknown as SoulManagerLike;
	}
	return _soulManager;
}

/** Lazily create or return the ActorSystem singleton (local-only, P2P optional). */
export async function getActorSystem(): Promise<ActorSystemLike> {
	if (!_actorSystem) {
		const { ActorSystem } = await import("@chitragupta/sutra");
		const sys = new ActorSystem();
		sys.start();
		_actorSystem = sys as unknown as ActorSystemLike;
	}
	return _actorSystem;
}

/** Lazily create or return the SkillRegistry singleton. */
export async function getSkillRegistry(): Promise<SkillRegistryLike> {
	if (!_skillRegistry) {
		const { SkillRegistry } = await import("@chitragupta/vidhya-skills");
		_skillRegistry = new SkillRegistry() as unknown as SkillRegistryLike;
	}
	return _skillRegistry;
}
