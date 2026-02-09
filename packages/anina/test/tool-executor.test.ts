import { describe, it, expect, vi } from "vitest";
import { ToolExecutor } from "../src/tool-executor.js";
import type { ToolHandler, ToolContext } from "../src/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeHandler(name: string, fn?: ToolHandler["execute"]): ToolHandler {
  return {
    definition: {
      name,
      description: `Tool ${name}`,
      inputSchema: { type: "object", properties: {} },
    },
    execute: fn ?? vi.fn(async () => ({ content: `${name} result` })),
  };
}

const CTX: ToolContext = {
  sessionId: "test-session",
  workingDirectory: "/tmp/test",
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe("ToolExecutor", () => {
  describe("register()", () => {
    it("should register a tool handler", () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("read"));
      expect(executor.has("read")).toBe(true);
      expect(executor.size).toBe(1);
    });

    it("should throw on duplicate registration", () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("read"));
      expect(() => executor.register(makeHandler("read"))).toThrow(
        'Tool "read" is already registered',
      );
    });
  });

  describe("unregister()", () => {
    it("should unregister a tool by name", () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("read"));
      executor.unregister("read");
      expect(executor.has("read")).toBe(false);
      expect(executor.size).toBe(0);
    });

    it("should be a no-op for unregistered tools", () => {
      const executor = new ToolExecutor();
      executor.unregister("nonexistent");
      expect(executor.size).toBe(0);
    });
  });

  describe("has()", () => {
    it("should return true for registered tools", () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("write"));
      expect(executor.has("write")).toBe(true);
    });

    it("should return false for unregistered tools", () => {
      const executor = new ToolExecutor();
      expect(executor.has("write")).toBe(false);
    });
  });

  describe("execute()", () => {
    it("should execute a registered tool and return its result", async () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("greet", async () => ({ content: "hello!" })));
      const result = await executor.execute("greet", {}, CTX);
      expect(result.content).toBe("hello!");
      expect(result.isError).toBeUndefined();
    });

    it("should return an error result for unregistered tools", async () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("a"));
      const result = await executor.execute("missing", {}, CTX);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool "missing" not found');
      expect(result.content).toContain("a"); // lists available tools
    });

    it("should catch tool execution errors and return them as error results", async () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("broken", async () => {
        throw new Error("kaboom");
      }));
      const result = await executor.execute("broken", {}, CTX);
      expect(result.isError).toBe(true);
      expect(result.content).toContain("kaboom");
    });

    it("should pass arguments and context to the tool handler", async () => {
      const executor = new ToolExecutor();
      const spy = vi.fn(async () => ({ content: "ok" }));
      executor.register(makeHandler("spy", spy));
      const args = { path: "/foo" };
      await executor.execute("spy", args, CTX);
      expect(spy).toHaveBeenCalledWith(args, CTX);
    });

    it("should handle non-Error thrown values", async () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("throws-string", async () => {
        throw "string error";
      }));
      const result = await executor.execute("throws-string", {}, CTX);
      expect(result.isError).toBe(true);
      expect(result.content).toContain("string error");
    });
  });

  describe("getDefinitions()", () => {
    it("should return definitions for all registered tools", () => {
      const executor = new ToolExecutor();
      executor.register(makeHandler("a"));
      executor.register(makeHandler("b"));
      const defs = executor.getDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs.map((d) => d.name)).toEqual(["a", "b"]);
    });

    it("should return an empty array when no tools are registered", () => {
      const executor = new ToolExecutor();
      expect(executor.getDefinitions()).toEqual([]);
    });
  });

  describe("size", () => {
    it("should reflect the number of registered tools", () => {
      const executor = new ToolExecutor();
      expect(executor.size).toBe(0);
      executor.register(makeHandler("x"));
      expect(executor.size).toBe(1);
      executor.register(makeHandler("y"));
      expect(executor.size).toBe(2);
      executor.unregister("x");
      expect(executor.size).toBe(1);
    });
  });
});
