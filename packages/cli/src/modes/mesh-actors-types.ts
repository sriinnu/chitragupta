/**
 * Payload type definitions for system mesh actors.
 *
 * Defines the message shapes that sys:memory, sys:skills, and sys:session
 * actors accept via `envelope.payload`. Each payload has a discriminating
 * `type` field for routing within the actor handler.
 *
 * @module
 */

// ─── Base ───────────────────────────────────────────────────────────────────

/** Base message payload with a discriminating `type` field. */
export interface BasePayload {
	type: string;
}

// ─── Memory Payloads ────────────────────────────────────────────────────────

/** Memory search request. */
export interface MemorySearchPayload extends BasePayload {
	type: "search";
	query: string;
	limit?: number;
}

/** Memory recall (unified search) request. */
export interface MemoryRecallPayload extends BasePayload {
	type: "recall";
	query: string;
	project?: string;
	limit?: number;
}

/** Memory store request. */
export interface MemoryStorePayload extends BasePayload {
	type: "store";
	key: string;
	value: string;
	scope: "global" | "project";
	scopePath?: string;
}

/** Union of all memory actor payloads. */
export type MemoryPayload = MemorySearchPayload | MemoryRecallPayload | MemoryStorePayload | BasePayload;

// ─── Skill Payloads ─────────────────────────────────────────────────────────

/** Skill find request. */
export interface SkillFindPayload extends BasePayload {
	type: "find";
	query: string;
	limit?: number;
	tags?: string[];
}

/** Skill recommend request. */
export interface SkillRecommendPayload extends BasePayload {
	type: "recommend";
	task: string;
}

/** Skill list request. */
export interface SkillListPayload extends BasePayload {
	type: "list";
	tag?: string;
	verb?: string;
	limit?: number;
}

/** Union of all skill actor payloads. */
export type SkillPayload = SkillFindPayload | SkillRecommendPayload | SkillListPayload | BasePayload;

// ─── Session Payloads ───────────────────────────────────────────────────────

/** Session list request. */
export interface SessionListPayload extends BasePayload {
	type: "list";
	limit?: number;
	project?: string;
}

/** Session show request. */
export interface SessionShowPayload extends BasePayload {
	type: "show";
	sessionId: string;
	project?: string;
}

/** Session handover request. */
export interface SessionHandoverPayload extends BasePayload {
	type: "handover";
	sessionId?: string;
	project?: string;
}

/** Union of all session actor payloads. */
export type SessionPayload = SessionListPayload | SessionShowPayload | SessionHandoverPayload | BasePayload;

// ─── Actor Context Types (duck-typed) ───────────────────────────────────────

/** Minimal envelope shape the actors receive. */
export interface ActorEnvelope {
	payload: unknown;
	type: string;
}

/** Minimal context shape the actors use. */
export interface ActorCtx {
	self: string;
	reply: (payload: unknown) => void;
}

/** Self-declaring actor behavior with capabilities and expertise. */
export interface ActorBehaviorSpec {
	capabilities: string[];
	expertise: string[];
	handle: (envelope: ActorEnvelope, ctx: ActorCtx) => Promise<void>;
}

/** Duck-typed skill match result. */
export interface SkillMatchResult {
	skill: { name: string; description?: string; tags?: string[] };
	score: number;
}
