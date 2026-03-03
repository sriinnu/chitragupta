/**
 * Tests for functional mesh actor behaviors (mesh-actors.ts).
 *
 * Validates that sys:memory, sys:skills, and sys:session actors
 * correctly dispatch to subsystems, handle errors gracefully,
 * and reply with structured responses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock daemon-bridge ─────────────────────────────────────────────────────

const mockMemorySearch = vi.fn();
const mockMemoryRecall = vi.fn();
const mockAppendMemory = vi.fn();
const mockListSessions = vi.fn();
const mockShowSession = vi.fn();

vi.mock("../src/modes/daemon-bridge.js", () => ({
	memorySearch: (...args: unknown[]) => mockMemorySearch(...args),
	memoryRecall: (...args: unknown[]) => mockMemoryRecall(...args),
	appendMemoryViaDaemon: (...args: unknown[]) => mockAppendMemory(...args),
	listSessions: (...args: unknown[]) => mockListSessions(...args),
	showSession: (...args: unknown[]) => mockShowSession(...args),
}));

// ─── Mock vidhya-skills ─────────────────────────────────────────────────────

const mockMatchSkills = vi.fn();

vi.mock("@chitragupta/vidhya-skills", () => ({
	matchSkills: (...args: unknown[]) => mockMatchSkills(...args),
}));

// ─── Mock mcp-subsystems ────────────────────────────────────────────────────

const mockGetAll = vi.fn();
const mockGetByTag = vi.fn();
const mockGetByVerb = vi.fn();

vi.mock("../src/modes/mcp-subsystems.js", () => ({
	getSkillRegistry: vi.fn().mockResolvedValue({
		getAll: () => mockGetAll(),
		getByTag: (tag: string) => mockGetByTag(tag),
		getByVerb: (verb: string) => mockGetByVerb(verb),
		size: 5,
	}),
}));

import {
	createMemoryActorBehavior,
	createSkillsActorBehavior,
	createSessionActorBehavior,
} from "../src/modes/mesh-actors.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeEnvelope(payload: unknown) {
	return { payload, type: "ask" as const };
}

function makeCtx(actorId = "sys:test") {
	const replies: unknown[] = [];
	return {
		self: actorId,
		reply: (payload: unknown) => replies.push(payload),
		replies,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// sys:memory Actor
// ═══════════════════════════════════════════════════════════════════════════

describe("createMemoryActorBehavior", () => {
	const behavior = createMemoryActorBehavior();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should have correct capabilities and expertise", () => {
		expect(behavior.capabilities).toContain("memory-search");
		expect(behavior.capabilities).toContain("memory-recall");
		expect(behavior.capabilities).toContain("memory-store");
		expect(behavior.expertise).toContain("memory");
	});

	it("should handle ping messages", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "ping" }), ctx);
		expect(ctx.replies).toHaveLength(1);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.type).toBe("pong");
		expect(reply.name).toBe("memory-agent");
	});

	it("should handle status messages", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "status" }), ctx);
		expect(ctx.replies).toHaveLength(1);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.type).toBe("status");
		expect(reply.alive).toBe(true);
	});

	it("should handle search with valid query", async () => {
		mockMemorySearch.mockResolvedValue([{ id: "r1", content: "test" }]);
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "search", query: "test query" }), ctx);
		expect(mockMemorySearch).toHaveBeenCalledWith("test query", 10);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.count).toBe(1);
	});

	it("should handle search with custom limit", async () => {
		mockMemorySearch.mockResolvedValue([]);
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "search", query: "q", limit: 3 }), ctx);
		expect(mockMemorySearch).toHaveBeenCalledWith("q", 3);
	});

	it("should reject search without query", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "search" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("INVALID_ARGS");
	});

	it("should handle recall with valid query", async () => {
		mockMemoryRecall.mockResolvedValue([{ id: "r1" }]);
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "recall", query: "auth system" }), ctx);
		expect(mockMemoryRecall).toHaveBeenCalledWith("auth system", undefined, 5);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
	});

	it("should handle store with valid args", async () => {
		mockAppendMemory.mockResolvedValue(undefined);
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({
			type: "store", key: "test-key", value: "test-value", scope: "global",
		}), ctx);
		expect(mockAppendMemory).toHaveBeenCalledWith("global", "## test-key\ntest-value", undefined);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.stored).toBe(true);
	});

	it("should reject store with invalid scope", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({
			type: "store", key: "k", value: "v", scope: "agent",
		}), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("INVALID_ARGS");
	});

	it("should reject store with missing key", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({
			type: "store", value: "v", scope: "global",
		}), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
	});

	it("should handle unknown message type", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "explode" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("UNKNOWN_TYPE");
	});

	it("should handle invalid payload (not an object)", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope("not-an-object"), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("INVALID_PAYLOAD");
	});

	it("should handle invalid payload (no type field)", async () => {
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ query: "test" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("INVALID_PAYLOAD");
	});

	it("should catch subsystem errors gracefully", async () => {
		mockMemorySearch.mockRejectedValue(new Error("Daemon down"));
		const ctx = makeCtx("sys:memory");
		await behavior.handle(makeEnvelope({ type: "search", query: "test" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("SUBSYSTEM_ERROR");
		expect(reply.error).toContain("Daemon down");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// sys:skills Actor
// ═══════════════════════════════════════════════════════════════════════════

describe("createSkillsActorBehavior", () => {
	const behavior = createSkillsActorBehavior();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should have correct capabilities", () => {
		expect(behavior.capabilities).toContain("skill-find");
		expect(behavior.capabilities).toContain("skill-recommend");
		expect(behavior.capabilities).toContain("skill-list");
	});

	it("should handle ping", async () => {
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "ping" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.type).toBe("pong");
		expect(reply.name).toBe("skill-agent");
	});

	it("should handle find with valid query", async () => {
		mockGetAll.mockReturnValue([{ name: "bash", tags: ["shell"] }]);
		mockMatchSkills.mockReturnValue([{
			skill: { name: "bash", description: "Run commands", tags: ["shell"] },
			score: 0.95,
		}]);
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "find", query: "run shell" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.count).toBe(1);
	});

	it("should handle find with empty registry", async () => {
		mockGetAll.mockReturnValue([]);
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "find", query: "test" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.count).toBe(0);
		expect(data.message).toBe("No skills registered");
	});

	it("should reject find without query", async () => {
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "find" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("INVALID_ARGS");
	});

	it("should handle recommend with valid task", async () => {
		mockGetAll.mockReturnValue([{ name: "deploy" }]);
		mockMatchSkills.mockReturnValue([{
			skill: { name: "deploy", description: "Deploy app", tags: ["cloud"] },
			score: 0.88,
		}]);
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "recommend", task: "deploy to AWS" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.recommendation).toBeTruthy();
	});

	it("should handle list with no filter", async () => {
		mockGetAll.mockReturnValue([
			{ name: "bash", description: "Shell", tags: ["shell"] },
			{ name: "read", description: "Read file", tags: ["fs"] },
		]);
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "list" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.count).toBe(2);
	});

	it("should handle list with tag filter", async () => {
		mockGetByTag.mockReturnValue([{ name: "bash", tags: ["shell"] }]);
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "list", tag: "shell" }), ctx);
		expect(mockGetByTag).toHaveBeenCalledWith("shell");
	});

	it("should handle list with verb filter", async () => {
		mockGetByVerb.mockReturnValue([{ name: "read_file", tags: ["fs"] }]);
		const ctx = makeCtx("sys:skills");
		await behavior.handle(makeEnvelope({ type: "list", verb: "read" }), ctx);
		expect(mockGetByVerb).toHaveBeenCalledWith("read");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// sys:session Actor
// ═══════════════════════════════════════════════════════════════════════════

describe("createSessionActorBehavior", () => {
	const behavior = createSessionActorBehavior();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should have correct capabilities", () => {
		expect(behavior.capabilities).toContain("session-list");
		expect(behavior.capabilities).toContain("session-show");
		expect(behavior.capabilities).toContain("session-handover");
	});

	it("should handle ping", async () => {
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "ping" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.type).toBe("pong");
		expect(reply.name).toBe("session-agent");
	});

	it("should handle list with sessions", async () => {
		mockListSessions.mockResolvedValue([
			{ id: "s1", title: "Session 1", model: "claude", created: "2026-03-01" },
			{ id: "s2", title: "Session 2", model: "gpt4", created: "2026-03-02" },
		]);
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "list" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.count).toBe(2);
	});

	it("should handle list with custom limit", async () => {
		mockListSessions.mockResolvedValue([
			{ id: "s1" }, { id: "s2" }, { id: "s3" },
		]);
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "list", limit: 2 }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.count).toBe(2);
	});

	it("should handle show with valid sessionId", async () => {
		mockShowSession.mockResolvedValue({
			meta: { id: "s1", title: "Test" },
			turns: [{ turnNumber: 1, role: "user", content: "hello" }],
		});
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "show", sessionId: "s1" }), ctx);
		expect(mockShowSession).toHaveBeenCalledWith("s1", expect.any(String));
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
	});

	it("should reject show without sessionId", async () => {
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "show" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("INVALID_ARGS");
	});

	it("should handle handover with explicit sessionId", async () => {
		mockShowSession.mockResolvedValue({
			meta: { id: "s1", title: "Work session" },
			turns: [
				{ turnNumber: 1, role: "user", content: "fix the bug" },
				{ turnNumber: 2, role: "assistant", content: "I fixed the bug in auth.ts" },
			],
		});
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "handover", sessionId: "s1" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.sessionId).toBe("s1");
		expect(data.turnCount).toBe(2);
	});

	it("should handle handover with auto-detected sessionId", async () => {
		mockListSessions.mockResolvedValue([{ id: "latest-session" }]);
		mockShowSession.mockResolvedValue({
			meta: { id: "latest-session", title: "Latest" },
			turns: [],
		});
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "handover" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.sessionId).toBe("latest-session");
	});

	it("should handle handover with no sessions", async () => {
		mockListSessions.mockResolvedValue([]);
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "handover" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(true);
		const data = reply.data as Record<string, unknown>;
		expect(data.handover).toBeNull();
	});

	it("should catch subsystem errors gracefully", async () => {
		mockListSessions.mockRejectedValue(new Error("Connection refused"));
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "list" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("SUBSYSTEM_ERROR");
		expect(reply.error).toContain("Connection refused");
	});

	it("should handle unknown message type", async () => {
		const ctx = makeCtx("sys:session");
		await behavior.handle(makeEnvelope({ type: "delete" }), ctx);
		const reply = ctx.replies[0] as Record<string, unknown>;
		expect(reply.ok).toBe(false);
		expect(reply.code).toBe("UNKNOWN_TYPE");
	});
});
