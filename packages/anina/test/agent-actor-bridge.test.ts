/**
 * Tests for the Agent-Actor Bridge (Setu).
 *
 * Verifies that createAgentBehavior correctly translates mesh messages
 * into Agent method calls and produces appropriate replies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentBehavior, isAgentMeshMessage } from "../src/agent-actor-bridge.js";
import type { AgentMeshMessage, AgentMeshReply } from "../src/agent-actor-bridge.js";
import type { MeshEnvelopeCompat, MeshActorContextCompat } from "../src/types.js";

// ─── Mock Agent ─────────────────────────────────────────────────────────────

function createMockAgent(overrides: Partial<{
	id: string;
	status: string;
	messages: unknown[];
	promptResult: unknown;
	delegateResult: unknown;
}> = {}) {
	return {
		id: overrides.id ?? "test-agent-123",
		prompt: vi.fn().mockResolvedValue(overrides.promptResult ?? {
			content: [{ type: "text", text: "Hello from agent" }],
		}),
		steer: vi.fn(),
		abort: vi.fn(),
		getStatus: vi.fn().mockReturnValue(overrides.status ?? "idle"),
		getMessages: vi.fn().mockReturnValue(overrides.messages ?? []),
		delegate: vi.fn().mockResolvedValue(overrides.delegateResult ?? {
			agentId: "child-1",
			response: { content: [{ type: "text", text: "Delegated result" }] },
			status: "completed",
		}),
	} as unknown as import("../src/agent.js").Agent;
}

// ─── Mock Context ───────────────────────────────────────────────────────────

function createMockEnvelope(payload: AgentMeshMessage, type: "tell" | "ask" = "ask"): MeshEnvelopeCompat {
	return {
		id: "env-1",
		from: "caller-agent",
		to: "agent:test-agent-123",
		type,
		payload,
		priority: 1,
		timestamp: Date.now(),
		ttl: 30_000,
		hops: ["caller-agent"],
	};
}

function createMockCtx(): MeshActorContextCompat & { replies: unknown[] } {
	const replies: unknown[] = [];
	return {
		self: "agent:test-agent-123",
		reply: vi.fn((payload: unknown) => { replies.push(payload); }),
		send: vi.fn(),
		ask: vi.fn(),
		become: vi.fn(),
		stop: vi.fn(),
		replies,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("agent-actor-bridge", () => {
	describe("createAgentBehavior", () => {
		let agent: ReturnType<typeof createMockAgent>;
		let behavior: ReturnType<typeof createAgentBehavior>;
		let ctx: ReturnType<typeof createMockCtx>;

		beforeEach(() => {
			agent = createMockAgent();
			behavior = createAgentBehavior(agent);
			ctx = createMockCtx();
		});

		it("should handle prompt messages", async () => {
			const envelope = createMockEnvelope({ type: "prompt", text: "Hello" });
			await behavior(envelope, ctx);

			expect(agent.prompt).toHaveBeenCalledWith("Hello");
			expect(ctx.reply).toHaveBeenCalledOnce();
			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({
				type: "prompt:result",
				agentId: "test-agent-123",
				text: "Hello from agent",
			});
		});

		it("should handle steer messages (ask → replies)", async () => {
			const envelope = createMockEnvelope({ type: "steer", text: "focus on tests" }, "ask");
			await behavior(envelope, ctx);

			expect(agent.steer).toHaveBeenCalledWith("focus on tests");
			expect(ctx.reply).toHaveBeenCalledOnce();
		});

		it("should handle steer messages (tell → no reply)", async () => {
			const envelope = createMockEnvelope({ type: "steer", text: "focus on tests" }, "tell");
			await behavior(envelope, ctx);

			expect(agent.steer).toHaveBeenCalledWith("focus on tests");
			expect(ctx.reply).not.toHaveBeenCalled();
		});

		it("should handle abort messages", async () => {
			const envelope = createMockEnvelope({ type: "abort" }, "ask");
			await behavior(envelope, ctx);

			expect(agent.abort).toHaveBeenCalledOnce();
			expect(ctx.reply).toHaveBeenCalledOnce();
			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({ type: "status:result", status: "aborted" });
		});

		it("should handle status messages", async () => {
			const envelope = createMockEnvelope({ type: "status" });
			await behavior(envelope, ctx);

			expect(agent.getStatus).toHaveBeenCalledOnce();
			expect(agent.getMessages).toHaveBeenCalledOnce();
			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({
				type: "status:result",
				agentId: "test-agent-123",
				status: "idle",
			});
		});

		it("should handle delegate messages", async () => {
			const envelope = createMockEnvelope({ type: "delegate", purpose: "test-runner", text: "run tests" });
			await behavior(envelope, ctx);

			expect(agent.delegate).toHaveBeenCalledWith({ purpose: "test-runner" }, "run tests");
			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({
				type: "delegate:result",
				childId: "child-1",
				text: "Delegated result",
				status: "completed",
			});
		});

		it("should handle ping messages", async () => {
			const envelope = createMockEnvelope({ type: "ping" });
			await behavior(envelope, ctx);

			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({
				type: "pong",
				agentId: "test-agent-123",
			});
			expect((reply as { timestamp: number }).timestamp).toBeGreaterThan(0);
		});

		it("should handle prompt errors gracefully", async () => {
			agent = createMockAgent();
			(agent.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM timeout"));
			behavior = createAgentBehavior(agent);

			const envelope = createMockEnvelope({ type: "prompt", text: "Hello" });
			await behavior(envelope, ctx);

			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({
				type: "prompt:error",
				error: "LLM timeout",
			});
		});

		it("should handle delegate errors gracefully", async () => {
			agent = createMockAgent();
			(agent.delegate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("spawn limit"));
			behavior = createAgentBehavior(agent);

			const envelope = createMockEnvelope({ type: "delegate", purpose: "x", text: "y" });
			await behavior(envelope, ctx);

			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({
				type: "delegate:error",
				error: "spawn limit",
			});
		});

		it("should reject invalid payloads", async () => {
			const envelope = createMockEnvelope("not an object" as unknown as AgentMeshMessage);
			await behavior(envelope, ctx);

			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({
				type: "error",
				error: "Invalid message format",
			});
		});

		it("should reject unknown message types", async () => {
			const envelope = createMockEnvelope({ type: "unknown" } as unknown as AgentMeshMessage);
			await behavior(envelope, ctx);

			const reply = ctx.replies[0] as AgentMeshReply;
			expect(reply).toMatchObject({ type: "error" });
		});
	});

	describe("isAgentMeshMessage", () => {
		it("should return true for valid message types", () => {
			expect(isAgentMeshMessage({ type: "prompt", text: "hi" })).toBe(true);
			expect(isAgentMeshMessage({ type: "steer", text: "go" })).toBe(true);
			expect(isAgentMeshMessage({ type: "abort" })).toBe(true);
			expect(isAgentMeshMessage({ type: "status" })).toBe(true);
			expect(isAgentMeshMessage({ type: "delegate", purpose: "x", text: "y" })).toBe(true);
			expect(isAgentMeshMessage({ type: "ping" })).toBe(true);
		});

		it("should return false for invalid payloads", () => {
			expect(isAgentMeshMessage(null)).toBe(false);
			expect(isAgentMeshMessage(undefined)).toBe(false);
			expect(isAgentMeshMessage("string")).toBe(false);
			expect(isAgentMeshMessage(42)).toBe(false);
			expect(isAgentMeshMessage({})).toBe(false);
			expect(isAgentMeshMessage({ type: "unknown" })).toBe(false);
		});
	});
});
