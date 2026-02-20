/**
 * Duck-typed interfaces for Phase 3 Collaboration route modules.
 *
 * Avoids hard import dependencies — the actual classes are structurally
 * compatible at runtime.  Shared across collaboration route files.
 *
 * @module routes/collaboration-types
 */

// ─── Samiti ─────────────────────────────────────────────────────────────────

export interface SamitiMessageLike {
	id: string;
	channel: string;
	sender: string;
	severity: string;
	category: string;
	content: string;
	data?: unknown;
	timestamp: number;
	ttl: number;
	references?: string[];
}

export interface SamitiChannelLike {
	name: string;
	description: string;
	maxHistory: number;
	subscribers: Set<string>;
	messages: SamitiMessageLike[];
	createdAt: number;
}

export interface SamitiLike {
	listChannels(): SamitiChannelLike[];
	getChannel(name: string): SamitiChannelLike | undefined;
	listen(channel: string, opts?: {
		since?: number;
		severity?: string;
		limit?: number;
	}): SamitiMessageLike[];
	broadcast(
		channel: string,
		message: {
			sender: string;
			severity: string;
			category: string;
			content: string;
			data?: unknown;
			references?: string[];
			ttl?: number;
		},
	): SamitiMessageLike;
	stats(): { channels: number; totalMessages: number; subscribers: number };
}

// ─── Sabha ──────────────────────────────────────────────────────────────────

export interface SabhaLike {
	id: string;
	topic: string;
	status: string;
	convener: string;
	participants: Array<{ id: string; role: string; expertise: number; credibility: number }>;
	rounds: Array<{
		roundNumber: number;
		proposal: Record<string, string>;
		challenges: unknown[];
		votes: unknown[];
		verdict: string | null;
	}>;
	finalVerdict: string | null;
	createdAt: number;
	concludedAt: number | null;
}

export interface SabhaEngineLike {
	convene(
		topic: string,
		convener: string,
		participants: Array<{ id: string; role: string; expertise: number; credibility: number }>,
	): SabhaLike;
	getSabha(id: string): SabhaLike | undefined;
	listActive(): SabhaLike[];
	propose(sabhaId: string, proposerId: string, syllogism: Record<string, string>): unknown;
	vote(sabhaId: string, participantId: string, position: string, reasoning: string): unknown;
	conclude(sabhaId: string): SabhaLike;
	explain(sabhaId: string): string;
}

// ─── Lokapala ───────────────────────────────────────────────────────────────

export interface FindingLike {
	id: string;
	guardianId: string;
	domain: string;
	severity: string;
	title: string;
	description: string;
	location?: string;
	suggestion?: string;
	confidence: number;
	autoFixable: boolean;
	timestamp: number;
}

export interface GuardianStatsLike {
	scansCompleted: number;
	findingsTotal: number;
	findingsBySeverity: Record<string, number>;
	autoFixesApplied: number;
	lastScanAt: number;
	avgScanDurationMs: number;
}

export interface LokapalaLike {
	allFindings(limit?: number): FindingLike[];
	findingsByDomain(domain: string): FindingLike[];
	criticalFindings(): FindingLike[];
	stats(): Record<string, GuardianStatsLike>;
}

// ─── Akasha ─────────────────────────────────────────────────────────────────

export interface StigmergicTraceLike {
	id: string;
	agentId: string;
	traceType: string;
	topic: string;
	content: string;
	strength: number;
	reinforcements: number;
	metadata: Record<string, unknown>;
	createdAt: number;
	lastReinforcedAt: number;
}

export interface AkashaLike {
	query(
		topic: string,
		opts?: { type?: string; minStrength?: number; limit?: number },
	): StigmergicTraceLike[];
	leave(
		agentId: string,
		type: string,
		topic: string,
		content: string,
		metadata?: Record<string, unknown>,
	): StigmergicTraceLike;
	strongest(limit?: number): StigmergicTraceLike[];
	stats(): {
		totalTraces: number;
		activeTraces: number;
		byType: Record<string, number>;
		avgStrength: number;
		strongestTopic: string | null;
		totalReinforcements: number;
	};
}

// ─── Server ─────────────────────────────────────────────────────────────────

export interface ServerLike {
	route(
		method: string,
		path: string,
		handler: (req: {
			params: Record<string, string>;
			query: Record<string, string>;
			body: unknown;
		}) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>,
	): void;
}

/** Dependency bag for collaboration route modules. */
export interface CollaborationDeps {
	getSamiti: () => SamitiLike | undefined;
	getSabhaEngine: () => SabhaEngineLike | undefined;
	getLokapala: () => LokapalaLike | undefined;
	getAkasha: () => AkashaLike | undefined;
}
