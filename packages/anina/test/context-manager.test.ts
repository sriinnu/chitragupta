import { describe, it, expect } from "vitest";
import { ContextManager } from "../src/context-manager.js";
import type { AgentState, AgentMessage, ToolHandler } from "../src/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeMessage(
  role: AgentMessage["role"],
  text: string,
  extra?: Partial<AgentMessage>,
): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content: [{ type: "text", text }],
    timestamp: Date.now(),
    ...extra,
  };
}

function makeToolCallMessage(callId: string, name: string, args: string): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: [{ type: "tool_call", id: callId, name, arguments: args }],
    timestamp: Date.now(),
  };
}

function makeToolResultMessage(callId: string, result: string): AgentMessage {
  return {
    id: crypto.randomUUID(),
    role: "tool_result",
    content: [{ type: "tool_result", toolCallId: callId, content: result }],
    timestamp: Date.now(),
  };
}

function makeTool(name: string): ToolHandler {
  return {
    definition: {
      name,
      description: `The ${name} tool`,
      inputSchema: { type: "object", properties: {} },
    },
    execute: async () => ({ content: "ok" }),
  };
}

function makeState(
  messages: AgentMessage[],
  overrides?: Partial<AgentState>,
): AgentState {
  return {
    messages,
    model: "test-model",
    providerId: "test",
    tools: overrides?.tools ?? [],
    systemPrompt: overrides?.systemPrompt ?? "System prompt.",
    thinkingLevel: "medium",
    isStreaming: false,
    sessionId: "session-1",
    agentProfileId: "test",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("ContextManager", () => {
  describe("buildContext()", () => {
    it("should build a context from agent state", () => {
      const cm = new ContextManager();
      const state = makeState([
        makeMessage("user", "Hello"),
        makeMessage("assistant", "Hi there"),
      ]);
      const ctx = cm.buildContext(state);
      expect(ctx.messages).toHaveLength(2);
      expect(ctx.systemPrompt).toBe("System prompt.");
      expect(ctx.tools).toBeUndefined();
    });

    it("should include tool definitions when tools are present", () => {
      const cm = new ContextManager();
      const state = makeState([], { tools: [makeTool("read"), makeTool("write")] });
      const ctx = cm.buildContext(state);
      expect(ctx.tools).toHaveLength(2);
      expect(ctx.tools![0].name).toBe("read");
    });

    it("should convert tool_result role to user role", () => {
      const cm = new ContextManager();
      const state = makeState([
        makeToolResultMessage("tc1", "result content"),
      ]);
      const ctx = cm.buildContext(state);
      expect(ctx.messages[0].role).toBe("user");
    });

    it("should omit systemPrompt if empty", () => {
      const cm = new ContextManager();
      const state = makeState([], { systemPrompt: "" });
      const ctx = cm.buildContext(state);
      expect(ctx.systemPrompt).toBeUndefined();
    });
  });

  describe("shouldCompact()", () => {
    it("should return false when context is small", () => {
      const cm = new ContextManager();
      const state = makeState([makeMessage("user", "hi")]);
      expect(cm.shouldCompact(state, 100_000)).toBe(false);
    });

    it("should return true when context exceeds threshold", () => {
      const cm = new ContextManager();
      const bigMessage = makeMessage("user", "x".repeat(400_000));
      const state = makeState([bigMessage]);
      // 400_000 chars / 4 chars per token = 100_000 tokens
      // With 100_000 context window and 0.8 threshold = 80_000
      expect(cm.shouldCompact(state, 100_000)).toBe(true);
    });
  });

  describe("getCompactionTier()", () => {
    it("should return 'none' for small contexts", () => {
      const cm = new ContextManager();
      const state = makeState([makeMessage("user", "hi")]);
      expect(cm.getCompactionTier(state, 1_000_000)).toBe("none");
    });

    it("should return 'soft' for 60-75% utilization", () => {
      const cm = new ContextManager();
      // ~65% = need 65_000 tokens from 100_000 context
      // 65_000 tokens * 4 chars = 260_000 chars
      const state = makeState([makeMessage("user", "x".repeat(260_000))]);
      expect(cm.getCompactionTier(state, 100_000)).toBe("soft");
    });

    it("should return 'medium' for 75-90% utilization", () => {
      const cm = new ContextManager();
      const state = makeState([makeMessage("user", "x".repeat(320_000))]);
      expect(cm.getCompactionTier(state, 100_000)).toBe("medium");
    });

    it("should return 'hard' for >90% utilization", () => {
      const cm = new ContextManager();
      const state = makeState([makeMessage("user", "x".repeat(380_000))]);
      expect(cm.getCompactionTier(state, 100_000)).toBe("hard");
    });
  });

  describe("compact()", () => {
    it("should return state unchanged if message count is under threshold", () => {
      const cm = new ContextManager({ keepRecent: 20 });
      const messages = Array.from({ length: 5 }, (_, i) => makeMessage("user", `msg ${i}`));
      const state = makeState(messages);
      const result = cm.compact(state);
      expect(result.messages).toHaveLength(5);
    });

    it("should compact older messages and keep recent ones", () => {
      const cm = new ContextManager({ keepRecent: 5 });
      const messages = Array.from({ length: 10 }, (_, i) => makeMessage("user", `msg ${i}`));
      const state = makeState(messages);
      const result = cm.compact(state);
      // Should have 1 summary + 5 recent = 6
      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[0].content[0].type).toBe("text");
      const text = (result.messages[0].content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("Conversation Summary");
    });
  });

  describe("compactTiered()", () => {
    it("should return state unchanged for 'none' tier", () => {
      const cm = new ContextManager();
      const state = makeState([makeMessage("user", "hi")]);
      const result = cm.compactTiered(state, 1_000_000);
      expect(result).toEqual(state);
    });

    it("should collapse tool details for 'soft' tier", () => {
      const cm = new ContextManager();
      const messages = [
        makeToolCallMessage("tc1", "read", '{"path":"/foo/bar/baz.ts"}'),
        makeToolResultMessage("tc1", "x".repeat(260_000)),
      ];
      const state = makeState(messages);
      const result = cm.compactTiered(state, 100_000);
      // Soft tier collapses tool arguments
      const firstContent = result.messages[0].content[0];
      if (firstContent.type === "tool_call") {
        expect(firstContent.arguments).toBe("{}");
      }
    });
  });
});
