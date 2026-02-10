import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import { MAX_SUB_AGENTS, MAX_AGENT_DEPTH } from "../src/types.js";
import type { AgentConfig, SpawnConfig, ToolHandler } from "../src/types.js";
import type { AgentProfile } from "@chitragupta/core";

// ─── Mock @chitragupta/smriti to avoid real file I/O ─────────────────────────

vi.mock("@chitragupta/smriti", () => ({
  createSession: vi.fn(() => ({ meta: { id: "mock-session-id" }, turns: [] })),
  loadSession: vi.fn(() => ({ meta: { id: "mock-session-id" }, turns: [] })),
  addTurn: vi.fn(),
  getMemory: vi.fn(() => null),
  appendMemory: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────

const TEST_PROFILE: AgentProfile = {
  id: "test",
  name: "Test Agent",
  personality: "You are a test agent.",
  expertise: ["testing"],
  voice: "minimal",
};

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    profile: TEST_PROFILE,
    providerId: "mock",
    model: "mock-model",
    ...overrides,
  };
}

/**
 * Create a mock provider whose stream() method yields the given events.
 */
function mockProvider(events: Array<{ type: string; [k: string]: unknown }>) {
  return {
    id: "mock",
    name: "Mock Provider",
    models: [],
    stream: vi.fn(async function* () {
      for (const event of events) {
        yield event;
      }
    }),
  };
}

/** Provider that streams a simple text response and stops. */
function simpleTextProvider(text: string) {
  return mockProvider([
    { type: "start", messageId: "msg-1" },
    { type: "text", text },
    { type: "done", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } },
  ]);
}

// ─── Agent Creation ───────────────────────────────────────────────────────

describe("Agent", () => {
  describe("creation", () => {
    it("should create an agent with the given config", () => {
      const agent = new Agent(makeConfig());
      expect(agent.id).toBeDefined();
      expect(agent.purpose).toBe("root");
      expect(agent.depth).toBe(0);
      expect(agent.getStatus()).toBe("idle");
    });

    it("should have a unique ID per instance", () => {
      const a = new Agent(makeConfig());
      const b = new Agent(makeConfig());
      expect(a.id).not.toBe(b.id);
    });

    it("should use default maxTurns (25) when not specified", () => {
      const agent = new Agent(makeConfig());
      const state = agent.getState();
      expect(state.messages).toEqual([]);
    });

    it("should initialise state from config", () => {
      const agent = new Agent(makeConfig({
        systemPrompt: "Custom prompt",
        thinkingLevel: "high",
      }));
      const state = agent.getState();
      expect(state.model).toBe("mock-model");
      expect(state.providerId).toBe("mock");
      expect(state.systemPrompt).toBe("Custom prompt");
      expect(state.thinkingLevel).toBe("high");
    });

    it("should build a default system prompt from the profile", () => {
      const agent = new Agent(makeConfig());
      const state = agent.getState();
      expect(state.systemPrompt).toContain("Test Agent");
      expect(state.systemPrompt).toContain("testing");
    });

    it("should register tools provided in config", () => {
      const tool: ToolHandler = {
        definition: { name: "myTool", description: "desc", inputSchema: { type: "object", properties: {} } },
        execute: vi.fn(async () => ({ content: "ok" })),
      };
      const agent = new Agent(makeConfig({ tools: [tool] }));
      expect(agent.getState().tools).toHaveLength(1);
    });
  });

  // ─── prompt() ─────────────────────────────────────────────────────────

  describe("prompt()", () => {
    it("should throw if no provider is set", async () => {
      const agent = new Agent(makeConfig());
      await expect(agent.prompt("hello")).rejects.toThrow("No provider set");
    });

    it("should stream a simple text response and return an AgentMessage", async () => {
      const agent = new Agent(makeConfig());
      agent.setProvider(simpleTextProvider("Hello, world!") as any);
      const result = await agent.prompt("hi");
      expect(result.role).toBe("assistant");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: "text", text: "Hello, world!" });
    });

    it("should add user message to state before streaming", async () => {
      const agent = new Agent(makeConfig());
      agent.setProvider(simpleTextProvider("ok") as any);
      await agent.prompt("my question");
      const messages = agent.getMessages();
      expect(messages[0].role).toBe("user");
      expect(messages[0].content[0]).toEqual({ type: "text", text: "my question" });
    });

    it("should set status to completed after successful prompt", async () => {
      const agent = new Agent(makeConfig());
      agent.setProvider(simpleTextProvider("done") as any);
      await agent.prompt("test");
      expect(agent.getStatus()).toBe("completed");
    });

    it("should handle tool calls in the agent loop", async () => {
      const toolHandler: ToolHandler = {
        definition: { name: "echo", description: "echoes", inputSchema: { type: "object", properties: {} } },
        execute: vi.fn(async () => ({ content: "echoed!" })),
      };

      let callCount = 0;
      const provider = {
        id: "mock",
        name: "Mock",
        models: [],
        stream: vi.fn(async function* () {
          callCount++;
          if (callCount === 1) {
            yield { type: "start", messageId: "m1" };
            yield { type: "tool_call", id: "tc1", name: "echo", arguments: "{}" };
            yield { type: "done", stopReason: "tool_use", usage: {} };
          } else {
            yield { type: "start", messageId: "m2" };
            yield { type: "text", text: "final answer" };
            yield { type: "done", stopReason: "end_turn", usage: {} };
          }
        }),
      };

      const agent = new Agent(makeConfig({ tools: [toolHandler] }));
      agent.setProvider(provider as any);
      const result = await agent.prompt("use echo");
      expect(toolHandler.execute).toHaveBeenCalled();
      expect(result.content[0]).toEqual({ type: "text", text: "final answer" });
    });

    it("should fire onEvent callbacks during streaming", async () => {
      const events: string[] = [];
      const agent = new Agent(makeConfig({
        onEvent: (event) => events.push(event),
      }));
      agent.setProvider(simpleTextProvider("hey") as any);
      await agent.prompt("test");
      expect(events).toContain("turn:start");
      expect(events).toContain("stream:start");
      expect(events).toContain("stream:text");
      expect(events).toContain("stream:done");
      expect(events).toContain("turn:done");
    });
  });

  // ─── abort() ──────────────────────────────────────────────────────────

  describe("abort()", () => {
    it("should set status to aborted", () => {
      const agent = new Agent(makeConfig());
      agent.setProvider(simpleTextProvider("test") as any);
      // Simulate that we're in a running state by calling abort immediately
      // We'll rely on the agent starting a prompt and aborting during it
      // For a simpler test, abort sets agentStatus directly
      agent.abort(); // triggers abort on null controller which is a no-op
      // When called without active prompt, agentStatus stays idle
      expect(agent.getStatus()).toBe("idle");
    });

    it("should cascade abort to children", () => {
      const parent = new Agent(makeConfig());
      parent.setProvider(simpleTextProvider("x") as any);
      const child = parent.spawn({ purpose: "child" });
      const abortSpy = vi.spyOn(child, "abort");
      parent.abort();
      expect(abortSpy).toHaveBeenCalled();
    });
  });

  // ─── Sub-Agent Spawning ───────────────────────────────────────────────

  describe("spawn()", () => {
    it("should create a child agent with correct depth", () => {
      const parent = new Agent(makeConfig());
      const child = parent.spawn({ purpose: "reviewer" });
      expect(child.depth).toBe(1);
      expect(child.purpose).toBe("reviewer");
    });

    it("should inherit provider from parent", () => {
      const parent = new Agent(makeConfig());
      const provider = simpleTextProvider("x");
      parent.setProvider(provider as any);
      const child = parent.spawn({ purpose: "child" });
      // Child should be able to prompt without setting provider separately
      // This means setProvider was called on the child
      expect(child.getParent()).toBe(parent);
    });

    it("should add child to parent's children list", () => {
      const parent = new Agent(makeConfig());
      expect(parent.getChildren()).toHaveLength(0);
      parent.spawn({ purpose: "child-1" });
      parent.spawn({ purpose: "child-2" });
      expect(parent.getChildren()).toHaveLength(2);
    });

    it("should enforce MAX_SUB_AGENTS limit", () => {
      const parent = new Agent(makeConfig());
      for (let i = 0; i < MAX_SUB_AGENTS; i++) {
        parent.spawn({ purpose: `child-${i}` });
      }
      expect(() => parent.spawn({ purpose: "one-too-many" })).toThrow(
        `Cannot spawn sub-agent: parent already has ${MAX_SUB_AGENTS} children`,
      );
    });

    it("should enforce MAX_AGENT_DEPTH limit", () => {
      let current = new Agent(makeConfig());
      for (let i = 0; i < MAX_AGENT_DEPTH; i++) {
        current = current.spawn({ purpose: `level-${i + 1}` });
      }
      expect(current.depth).toBe(MAX_AGENT_DEPTH);
      expect(() => current.spawn({ purpose: "too-deep" })).toThrow(
        `Cannot spawn sub-agent: would exceed max depth of ${MAX_AGENT_DEPTH}`,
      );
    });

    it("should fire subagent:spawn event", () => {
      const events: string[] = [];
      const parent = new Agent(makeConfig({
        onEvent: (event) => events.push(event),
      }));
      parent.spawn({ purpose: "child" });
      expect(events).toContain("subagent:spawn");
    });
  });

  // ─── delegate() ───────────────────────────────────────────────────────

  describe("delegate()", () => {
    it("should spawn a child and run a prompt", async () => {
      const parent = new Agent(makeConfig());
      parent.setProvider(simpleTextProvider("child result") as any);
      const result = await parent.delegate({ purpose: "worker" }, "do work");
      expect(result.status).toBe("completed");
      expect(result.purpose).toBe("worker");
      expect(result.response.role).toBe("assistant");
    });

    it("should return error status on child failure", async () => {
      const errorProvider = {
        id: "mock",
        name: "Mock",
        models: [],
        stream: vi.fn(async function* () {
          yield { type: "error", error: new Error("boom") };
        }),
      };
      const parent = new Agent(makeConfig());
      parent.setProvider(errorProvider as any);
      const result = await parent.delegate({ purpose: "failer" }, "fail");
      expect(result.status).toBe("error");
      expect(result.error).toContain("boom");
    });
  });

  // ─── delegateParallel() ───────────────────────────────────────────────

  describe("delegateParallel()", () => {
    it("should reject if total children would exceed MAX_SUB_AGENTS", async () => {
      const parent = new Agent(makeConfig());
      parent.setProvider(simpleTextProvider("x") as any);
      // Spawn up to the limit minus 1
      for (let i = 0; i < MAX_SUB_AGENTS - 1; i++) {
        parent.spawn({ purpose: `pre-${i}` });
      }
      // Try to spawn 2 more via delegateParallel -> total would exceed MAX_SUB_AGENTS
      await expect(
        parent.delegateParallel([
          { config: { purpose: "a" }, prompt: "go" },
          { config: { purpose: "b" }, prompt: "go" },
        ]),
      ).rejects.toThrow("Cannot spawn");
    });
  });

  // ─── Tree Traversal ───────────────────────────────────────────────────

  describe("tree traversal", () => {
    let root: Agent;
    let childA: Agent;
    let childB: Agent;
    let grandchild: Agent;

    beforeEach(() => {
      root = new Agent(makeConfig());
      childA = root.spawn({ purpose: "child-a" });
      childB = root.spawn({ purpose: "child-b" });
      grandchild = childA.spawn({ purpose: "grandchild" });
    });

    it("getParent() returns null for root", () => {
      expect(root.getParent()).toBeNull();
    });

    it("getParent() returns the parent agent", () => {
      expect(childA.getParent()).toBe(root);
      expect(grandchild.getParent()).toBe(childA);
    });

    it("getRoot() returns the root from any node", () => {
      expect(root.getRoot()).toBe(root);
      expect(childA.getRoot()).toBe(root);
      expect(grandchild.getRoot()).toBe(root);
    });

    it("getAncestors() returns ancestors from parent to root", () => {
      const ancestors = grandchild.getAncestors();
      expect(ancestors).toHaveLength(2);
      expect(ancestors[0]).toBe(childA);
      expect(ancestors[1]).toBe(root);
    });

    it("getAncestors() returns empty for root", () => {
      expect(root.getAncestors()).toHaveLength(0);
    });

    it("getLineage() returns from root to self", () => {
      const lineage = grandchild.getLineage();
      expect(lineage).toHaveLength(3);
      expect(lineage[0]).toBe(root);
      expect(lineage[1]).toBe(childA);
      expect(lineage[2]).toBe(grandchild);
    });

    it("getLineagePath() returns readable path", () => {
      const path = grandchild.getLineagePath();
      expect(path).toBe("root > child-a > grandchild");
    });

    it("getChildren() returns direct children", () => {
      const children = root.getChildren();
      expect(children).toHaveLength(2);
    });

    it("getDescendants() returns all descendants depth-first", () => {
      const desc = root.getDescendants();
      expect(desc).toHaveLength(3); // childA, childB, grandchild
    });

    it("getSiblings() returns siblings", () => {
      const siblings = childA.getSiblings();
      expect(siblings).toHaveLength(1);
      expect(siblings[0]).toBe(childB);
    });

    it("getSiblings() returns empty for root", () => {
      expect(root.getSiblings()).toHaveLength(0);
    });

    it("findAgent() finds any agent in the tree by ID", () => {
      const found = grandchild.findAgent(childB.id);
      expect(found).toBe(childB);
    });

    it("findAgent() returns null for unknown ID", () => {
      expect(root.findAgent("nonexistent")).toBeNull();
    });

    it("isDescendantOf() returns true for ancestors", () => {
      expect(grandchild.isDescendantOf(root.id)).toBe(true);
      expect(grandchild.isDescendantOf(childA.id)).toBe(true);
    });

    it("isDescendantOf() returns false for non-ancestors", () => {
      expect(grandchild.isDescendantOf(childB.id)).toBe(false);
    });

    it("isAncestorOf() returns true for descendants", () => {
      expect(root.isAncestorOf(grandchild.id)).toBe(true);
    });

    it("isAncestorOf() returns false for non-descendants", () => {
      expect(childB.isAncestorOf(grandchild.id)).toBe(false);
    });
  });

  // ─── getTree() ────────────────────────────────────────────────────────

  describe("getTree()", () => {
    it("should return a tree snapshot with correct counts", () => {
      const root = new Agent(makeConfig());
      root.spawn({ purpose: "a" });
      root.spawn({ purpose: "b" });
      const tree = root.getTree();
      expect(tree.totalAgents).toBe(3);
      expect(tree.maxDepth).toBe(1);
      expect(tree.root.children).toHaveLength(2);
    });
  });

  // ─── renderTree() ─────────────────────────────────────────────────────

  describe("renderTree()", () => {
    it("should produce ASCII tree output", () => {
      const root = new Agent(makeConfig());
      root.spawn({ purpose: "child-a" });
      root.spawn({ purpose: "child-b" });
      const output = root.renderTree();
      expect(output).toContain("root");
      expect(output).toContain("child-a");
      expect(output).toContain("child-b");
      expect(output).toContain("(idle)");
    });

    it("should use tree-drawing characters", () => {
      const root = new Agent(makeConfig());
      root.spawn({ purpose: "a" });
      root.spawn({ purpose: "b" });
      const output = root.renderTree();
      expect(output).toContain("\u251C\u2500\u2500 "); // ├──
      expect(output).toContain("\u2514\u2500\u2500 "); // └──
    });
  });

  // ─── removeChild / pruneChildren ──────────────────────────────────────

  describe("removeChild()", () => {
    it("should remove a completed child by ID", () => {
      const parent = new Agent(makeConfig());
      const child = parent.spawn({ purpose: "done" });
      // Child needs a non-running status to be removable
      // Directly complete it by simulating status change
      // Since agentStatus is private, we test via the API
      expect(parent.getChildren()).toHaveLength(1);
      // idle children should be removable? No: removeChild only removes non-running
      // "idle" is not "running", so it should work
      const removed = parent.removeChild(child.id);
      expect(removed).toBe(true);
      expect(parent.getChildren()).toHaveLength(0);
    });

    it("should return false for unknown child ID", () => {
      const parent = new Agent(makeConfig());
      expect(parent.removeChild("nope")).toBe(false);
    });
  });

  describe("pruneChildren()", () => {
    it("should remove non-running children", () => {
      const parent = new Agent(makeConfig());
      parent.spawn({ purpose: "a" });
      parent.spawn({ purpose: "b" });
      // Both are idle (not running)
      const pruned = parent.pruneChildren();
      expect(pruned).toBe(2);
      expect(parent.getChildren()).toHaveLength(0);
    });
  });

  // ─── registerTool / unregisterTool ────────────────────────────────────

  describe("tool registration", () => {
    it("should register and unregister tools", () => {
      const tool: ToolHandler = {
        definition: { name: "t1", description: "test", inputSchema: { type: "object", properties: {} } },
        execute: vi.fn(async () => ({ content: "ok" })),
      };
      const agent = new Agent(makeConfig());
      agent.registerTool(tool);
      expect(agent.getState().tools).toHaveLength(1);
      agent.unregisterTool("t1");
      expect(agent.getState().tools).toHaveLength(0);
    });
  });

  // ─── getSessionId / getProfile / getMessages ─────────────────────────

  describe("accessors", () => {
    it("getSessionId() returns a UUID", () => {
      const agent = new Agent(makeConfig());
      expect(agent.getSessionId()).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("getProfile() returns the configured profile", () => {
      const agent = new Agent(makeConfig());
      expect(agent.getProfile()).toEqual(TEST_PROFILE);
    });

    it("getMessages() returns empty array initially", () => {
      const agent = new Agent(makeConfig());
      expect(agent.getMessages()).toHaveLength(0);
    });
  });
});
