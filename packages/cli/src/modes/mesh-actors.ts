/**
 * Functional Actor Behaviors for System Mesh Actors.
 *
 * Replaces the ping/status stubs in mesh-bootstrap.ts with real handlers
 * that delegate to Chitragupta subsystems: memory (daemon-bridge), skills
 * (SkillRegistry + TVM matching), and sessions (daemon-bridge).
 *
 * Each actor extracts the action `type` from `envelope.payload` and routes
 * to the appropriate subsystem. All handlers are defensive: subsystem
 * unavailability returns a structured error, never crashes the actor.
 *
 * @module
 */

import type {
	ActorBehaviorSpec,
	ActorCtx,
	ActorEnvelope,
	BasePayload,
	MemoryPayload,
	MemoryRecallPayload,
	MemorySearchPayload,
	MemoryStorePayload,
	SessionHandoverPayload,
	SessionListPayload,
	SessionPayload,
	SessionShowPayload,
	SkillFindPayload,
	SkillListPayload,
	SkillPayload,
	SkillRecommendPayload,
	SkillMatchResult,
} from "./mesh-actors-types.js";

export type { ActorBehaviorSpec } from "./mesh-actors-types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract a typed payload from a mesh envelope. Returns null if invalid. */
function extractPayload<T extends BasePayload>(envelope: ActorEnvelope): T | null {
	const p = envelope.payload;
	if (typeof p !== "object" || p === null || Array.isArray(p)) return null;
	const rec = p as Record<string, unknown>;
	if (typeof rec.type !== "string") return null;
	return rec as unknown as T;
}

/** Build a structured error reply. */
function errorReply(actor: string, message: string, code = "ACTOR_ERROR"): Record<string, unknown> {
	return { ok: false, actor, error: message, code };
}

/** Build a structured success reply. */
function successReply(actor: string, data: unknown): Record<string, unknown> {
	return { ok: true, actor, data };
}

/** Handle ping/status messages common to all system actors. Returns true if handled. */
function handleCommon(payload: BasePayload, name: string, ctx: ActorCtx): boolean {
	if (payload.type === "ping") {
		ctx.reply({ type: "pong", actor: ctx.self, name });
		return true;
	}
	if (payload.type === "status") {
		ctx.reply({ type: "status", actor: ctx.self, name, alive: true });
		return true;
	}
	return false;
}

/** Validate that a field is a non-empty string. */
function requireString(payload: Record<string, unknown>, field: string, ctx: ActorCtx): boolean {
	if (typeof payload[field] !== "string" || !(payload[field] as string)) {
		ctx.reply(errorReply(ctx.self, `Missing required field: ${field} (string)`, "INVALID_ARGS"));
		return false;
	}
	return true;
}

// ─── sys:memory Actor ───────────────────────────────────────────────────────

async function handleMemorySearch(p: MemorySearchPayload, ctx: ActorCtx): Promise<void> {
	const bridge = await import("./daemon-bridge.js");
	const limit = Math.min(50, Math.max(1, p.limit ?? 10));
	const results = await bridge.memorySearch(p.query, limit);
	ctx.reply(successReply(ctx.self, { results, count: results.length }));
}

async function handleMemoryRecall(p: MemoryRecallPayload, ctx: ActorCtx): Promise<void> {
	const bridge = await import("./daemon-bridge.js");
	const limit = Math.min(20, Math.max(1, p.limit ?? 5));
	const results = await bridge.memoryRecall(p.query, p.project, limit);
	ctx.reply(successReply(ctx.self, { results, count: results.length }));
}

async function handleMemoryStore(p: MemoryStorePayload, ctx: ActorCtx): Promise<void> {
	const bridge = await import("./daemon-bridge.js");
	const entry = `## ${p.key}\n${p.value}`;
	await bridge.appendMemoryViaDaemon(p.scope, entry, p.scopePath);
	ctx.reply(successReply(ctx.self, { stored: true, key: p.key, scope: p.scope }));
}

/** Create the sys:memory actor behavior. Handles: search, recall, store, ping, status. */
export function createMemoryActorBehavior(): ActorBehaviorSpec {
	return {
		capabilities: ["memory-search", "memory-recall", "memory-store", "memory-query", "memory-status"],
		expertise: ["memory", "recall", "search", "knowledge"],
		handle: async (envelope: ActorEnvelope, ctx: ActorCtx): Promise<void> => {
			const payload = extractPayload<MemoryPayload>(envelope);
			if (!payload) {
				ctx.reply(errorReply(ctx.self, "Invalid payload: expected object with 'type' field", "INVALID_PAYLOAD"));
				return;
			}
			if (handleCommon(payload, "memory-agent", ctx)) return;
			try {
				switch (payload.type) {
					case "search":
						if (!requireString(payload as unknown as Record<string, unknown>, "query", ctx)) return;
						await handleMemorySearch(payload as MemorySearchPayload, ctx);
						break;
					case "recall":
						if (!requireString(payload as unknown as Record<string, unknown>, "query", ctx)) return;
						await handleMemoryRecall(payload as MemoryRecallPayload, ctx);
						break;
					case "store": {
						const sp = payload as MemoryStorePayload;
						const rec = sp as unknown as Record<string, unknown>;
						if (!requireString(rec, "key", ctx) || !requireString(rec, "value", ctx)) return;
						if (sp.scope !== "global" && sp.scope !== "project") {
							ctx.reply(errorReply(ctx.self, "scope must be 'global' or 'project'", "INVALID_ARGS"));
							return;
						}
						await handleMemoryStore(sp, ctx);
						break;
					}
					default:
						ctx.reply(errorReply(ctx.self, `Unknown message type: ${payload.type}`, "UNKNOWN_TYPE"));
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.reply(errorReply(ctx.self, `Memory operation failed: ${msg}`, "SUBSYSTEM_ERROR"));
			}
		},
	};
}

// ─── sys:skills Actor ───────────────────────────────────────────────────────

async function handleSkillFind(p: SkillFindPayload, ctx: ActorCtx): Promise<void> {
	const { matchSkills } = await import("@chitragupta/vidhya-skills");
	const { getSkillRegistry } = await import("./mcp-subsystems.js");
	const registry = await getSkillRegistry();
	const allSkills = registry.getAll();
	if (allSkills.length === 0) {
		ctx.reply(successReply(ctx.self, { matches: [], count: 0, message: "No skills registered" }));
		return;
	}
	const limit = Math.min(20, Math.max(1, p.limit ?? 5));
	const matches = matchSkills({ text: p.query, tags: p.tags }, allSkills as never[]) as unknown as SkillMatchResult[];
	const top = matches.slice(0, limit).map((m) => ({
		name: m.skill.name, description: m.skill.description ?? null, tags: m.skill.tags ?? [], score: m.score,
	}));
	ctx.reply(successReply(ctx.self, { matches: top, count: top.length }));
}

async function handleSkillRecommend(p: SkillRecommendPayload, ctx: ActorCtx): Promise<void> {
	const { matchSkills } = await import("@chitragupta/vidhya-skills");
	const { getSkillRegistry } = await import("./mcp-subsystems.js");
	const registry = await getSkillRegistry();
	const allSkills = registry.getAll();
	if (allSkills.length === 0) {
		ctx.reply(successReply(ctx.self, { recommendation: null, message: "No skills registered" }));
		return;
	}
	const matches = matchSkills({ text: p.task }, allSkills as never[]) as unknown as SkillMatchResult[];
	if (matches.length === 0) {
		ctx.reply(successReply(ctx.self, { recommendation: null, message: "No matching skills" }));
		return;
	}
	const best = matches[0];
	ctx.reply(successReply(ctx.self, {
		recommendation: { name: best.skill.name, description: best.skill.description ?? null, tags: best.skill.tags ?? [], score: best.score },
		alternativeCount: matches.length - 1,
	}));
}

async function handleSkillList(p: SkillListPayload, ctx: ActorCtx): Promise<void> {
	const { getSkillRegistry } = await import("./mcp-subsystems.js");
	const registry = await getSkillRegistry();
	const limit = Math.min(100, Math.max(1, p.limit ?? 20));
	let skills: Array<Record<string, unknown>>;
	if (p.tag) skills = registry.getByTag(p.tag);
	else if (p.verb) skills = registry.getByVerb(p.verb);
	else skills = registry.getAll();
	const limited = skills.slice(0, limit).map((s) => ({
		name: s.name ?? "(unnamed)", description: s.description ?? null, tags: (s.tags ?? []) as string[],
	}));
	ctx.reply(successReply(ctx.self, { skills: limited, count: limited.length, total: registry.size }));
}

/** Create the sys:skills actor behavior. Handles: find, recommend, list, ping, status. */
export function createSkillsActorBehavior(): ActorBehaviorSpec {
	return {
		capabilities: ["skill-find", "skill-recommend", "skill-list", "skill-query", "skill-status"],
		expertise: ["skills", "discovery", "matching", "recommendation"],
		handle: async (envelope: ActorEnvelope, ctx: ActorCtx): Promise<void> => {
			const payload = extractPayload<SkillPayload>(envelope);
			if (!payload) {
				ctx.reply(errorReply(ctx.self, "Invalid payload: expected object with 'type' field", "INVALID_PAYLOAD"));
				return;
			}
			if (handleCommon(payload, "skill-agent", ctx)) return;
			try {
				switch (payload.type) {
					case "find":
						if (!requireString(payload as unknown as Record<string, unknown>, "query", ctx)) return;
						await handleSkillFind(payload as SkillFindPayload, ctx);
						break;
					case "recommend":
						if (!requireString(payload as unknown as Record<string, unknown>, "task", ctx)) return;
						await handleSkillRecommend(payload as SkillRecommendPayload, ctx);
						break;
					case "list":
						await handleSkillList(payload as SkillListPayload, ctx);
						break;
					default:
						ctx.reply(errorReply(ctx.self, `Unknown message type: ${payload.type}`, "UNKNOWN_TYPE"));
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.reply(errorReply(ctx.self, `Skill operation failed: ${msg}`, "SUBSYSTEM_ERROR"));
			}
		},
	};
}

// ─── sys:session Actor ──────────────────────────────────────────────────────

async function handleSessionList(p: SessionListPayload, ctx: ActorCtx): Promise<void> {
	const bridge = await import("./daemon-bridge.js");
	const allSessions = await bridge.listSessions(p.project);
	const limit = Math.min(50, Math.max(1, p.limit ?? 10));
	const sessions = allSessions.slice(0, limit).map((s) => ({
		id: s.id, title: s.title ?? null, model: s.model ?? null, created: s.created ?? s.createdAt ?? null,
	}));
	ctx.reply(successReply(ctx.self, { sessions, count: sessions.length }));
}

async function handleSessionShow(p: SessionShowPayload, ctx: ActorCtx): Promise<void> {
	const bridge = await import("./daemon-bridge.js");
	const project = p.project ?? process.cwd();
	const session = await bridge.showSession(p.sessionId, project);
	ctx.reply(successReply(ctx.self, session));
}

async function handleSessionHandover(p: SessionHandoverPayload, ctx: ActorCtx): Promise<void> {
	const bridge = await import("./daemon-bridge.js");
	const project = p.project ?? process.cwd();
	let sessionId = p.sessionId;
	if (!sessionId) {
		const sessions = await bridge.listSessions(project);
		if (sessions.length === 0) {
			ctx.reply(successReply(ctx.self, { handover: null, message: "No sessions found" }));
			return;
		}
		sessionId = String(sessions[0].id);
	}
	const session = await bridge.showSession(sessionId, project) as {
		meta: Record<string, unknown>;
		turns: Array<{ turnNumber: number; role: string; content: string }>;
	};
	const recentAssistant = session.turns.filter((t) => t.role === "assistant").slice(-3);
	ctx.reply(successReply(ctx.self, {
		sessionId, title: session.meta.title, turnCount: session.turns.length,
		recentContext: recentAssistant.map((t) => ({ turn: t.turnNumber, preview: t.content.slice(0, 200) })),
	}));
}

/** Create the sys:session actor behavior. Handles: list, show, handover, ping, status. */
export function createSessionActorBehavior(): ActorBehaviorSpec {
	return {
		capabilities: ["session-list", "session-show", "session-handover", "session-query", "session-status"],
		expertise: ["sessions", "handover", "context", "continuity"],
		handle: async (envelope: ActorEnvelope, ctx: ActorCtx): Promise<void> => {
			const payload = extractPayload<SessionPayload>(envelope);
			if (!payload) {
				ctx.reply(errorReply(ctx.self, "Invalid payload: expected object with 'type' field", "INVALID_PAYLOAD"));
				return;
			}
			if (handleCommon(payload, "session-agent", ctx)) return;
			try {
				switch (payload.type) {
					case "list":
						await handleSessionList(payload as SessionListPayload, ctx);
						break;
					case "show":
						if (!requireString(payload as unknown as Record<string, unknown>, "sessionId", ctx)) return;
						await handleSessionShow(payload as SessionShowPayload, ctx);
						break;
					case "handover":
						await handleSessionHandover(payload as SessionHandoverPayload, ctx);
						break;
					default:
						ctx.reply(errorReply(ctx.self, `Unknown message type: ${payload.type}`, "UNKNOWN_TYPE"));
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.reply(errorReply(ctx.self, `Session operation failed: ${msg}`, "SUBSYSTEM_ERROR"));
			}
		},
	};
}
