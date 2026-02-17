import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  chitraguptaToolToMcp,
  mcpToolToChitragupta,
  type ChitraguptaToolHandler,
  type ChitraguptaToolContext,
} from "../src/bridge.js";
import type { McpTool, McpToolResult } from "../src/types.js";
import { McpClient } from "../src/client.js";

describe("bridge", () => {
  const mockContext: ChitraguptaToolContext = {
    sessionId: "test-session",
    workingDirectory: "/tmp/test",
  };

  // ═══════════════════════════════════════════════════════════════════════
  // chitraguptaToolToMcp
  // ═══════════════════════════════════════════════════════════════════════

  describe("chitraguptaToolToMcp", () => {
    it("should convert a Chitragupta tool definition to MCP format", () => {
      const chitraguptaTool: ChitraguptaToolHandler = {
        definition: {
          name: "read_file",
          description: "Read a file from disk",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
        async execute(_args, _ctx) {
          return { content: "file contents" };
        },
      };

      const mcpTool = chitraguptaToolToMcp(chitraguptaTool);

      expect(mcpTool.definition.name).toBe("read_file");
      expect(mcpTool.definition.description).toBe("Read a file from disk");
      expect(mcpTool.definition.inputSchema).toEqual(chitraguptaTool.definition.inputSchema);
    });

    it("should wrap text result as MCP content array", async () => {
      const chitraguptaTool: ChitraguptaToolHandler = {
        definition: {
          name: "greet",
          description: "Greet",
          inputSchema: {},
        },
        async execute(args) {
          return { content: `Hello, ${args.name}!` };
        },
      };

      const mcpTool = chitraguptaToolToMcp(chitraguptaTool);
      const result = await mcpTool.execute({ name: "Alice" });

      expect(result.content).toEqual([{ type: "text", text: "Hello, Alice!" }]);
      expect(result.isError).toBeUndefined();
    });

    it("should preserve isError flag", async () => {
      const chitraguptaTool: ChitraguptaToolHandler = {
        definition: { name: "fail", description: "Fail", inputSchema: {} },
        async execute() {
          return { content: "Something went wrong", isError: true };
        },
      };

      const mcpTool = chitraguptaToolToMcp(chitraguptaTool);
      const result = await mcpTool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content[0]).toEqual({ type: "text", text: "Something went wrong" });
    });

    it("should catch exceptions and return as MCP error result", async () => {
      const chitraguptaTool: ChitraguptaToolHandler = {
        definition: { name: "crash", description: "Crash", inputSchema: {} },
        async execute() {
          throw new Error("Unexpected crash");
        },
      };

      const mcpTool = chitraguptaToolToMcp(chitraguptaTool);
      const result = await mcpTool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content[0]).toEqual({ type: "text", text: "Unexpected crash" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // mcpToolToChitragupta
  // ═══════════════════════════════════════════════════════════════════════

  describe("mcpToolToChitragupta", () => {
    it("should convert an MCP tool to Chitragupta format", () => {
      const mcpTool: McpTool = {
        name: "search",
        description: "Search the web",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      };

      // Create a mock client
      const mockClient = {
        callTool: vi.fn(),
      } as unknown as McpClient;

      const chitraguptaTool = mcpToolToChitragupta(mcpTool, mockClient);

      expect(chitraguptaTool.definition.name).toBe("search");
      expect(chitraguptaTool.definition.description).toBe("Search the web");
      expect(chitraguptaTool.definition.inputSchema).toEqual(mcpTool.inputSchema);
    });

    it("should call the MCP client and collapse text content", async () => {
      const mcpTool: McpTool = {
        name: "search",
        description: "Search",
        inputSchema: {},
      };

      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [
            { type: "text", text: "Result 1" },
            { type: "text", text: "Result 2" },
          ],
        }),
      } as unknown as McpClient;

      const chitraguptaTool = mcpToolToChitragupta(mcpTool, mockClient);
      const result = await chitraguptaTool.execute({ query: "test" }, mockContext);

      expect(mockClient.callTool).toHaveBeenCalledWith("search", { query: "test" });
      expect(result.content).toBe("Result 1\nResult 2");
      expect(result.isError).toBeUndefined();
    });

    it("should handle resource content type", async () => {
      const mcpTool: McpTool = { name: "res", description: "Resource", inputSchema: {} };

      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [
            { type: "resource", uri: "file:///test.md", text: "readme content" },
          ],
        }),
      } as unknown as McpClient;

      const chitraguptaTool = mcpToolToChitragupta(mcpTool, mockClient);
      const result = await chitraguptaTool.execute({}, mockContext);

      expect(result.content).toBe("readme content");
    });

    it("should handle image content type", async () => {
      const mcpTool: McpTool = { name: "img", description: "Image", inputSchema: {} };

      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
        }),
      } as unknown as McpClient;

      const chitraguptaTool = mcpToolToChitragupta(mcpTool, mockClient);
      const result = await chitraguptaTool.execute({}, mockContext);

      expect(result.content).toBe("[image: image/png]");
    });

    it("should catch MCP client errors and return as Chitragupta error result", async () => {
      const mcpTool: McpTool = { name: "err", description: "Error", inputSchema: {} };

      const mockClient = {
        callTool: vi.fn().mockRejectedValue(new Error("Connection lost")),
      } as unknown as McpClient;

      const chitraguptaTool = mcpToolToChitragupta(mcpTool, mockClient);
      const result = await chitraguptaTool.execute({}, mockContext);

      expect(result.isError).toBe(true);
      expect(result.content).toBe("Connection lost");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Round-trip conversion
  // ═══════════════════════════════════════════════════════════════════════

  describe("round-trip conversion", () => {
    it("should preserve tool definition through chitragupta -> mcp -> chitragupta", async () => {
      const original: ChitraguptaToolHandler = {
        definition: {
          name: "calculate",
          description: "Calculate something",
          inputSchema: {
            type: "object",
            properties: { expression: { type: "string" } },
          },
        },
        async execute(args) {
          return { content: `= ${args.expression}` };
        },
      };

      // Chitragupta -> MCP
      const mcpVersion = chitraguptaToolToMcp(original);
      expect(mcpVersion.definition.name).toBe("calculate");
      expect(mcpVersion.definition.description).toBe("Calculate something");

      // MCP -> Chitragupta (requires a client, but the definition should round-trip)
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "= 42" }],
        }),
      } as unknown as McpClient;

      const roundTripped = mcpToolToChitragupta(mcpVersion.definition, mockClient);

      expect(roundTripped.definition.name).toBe(original.definition.name);
      expect(roundTripped.definition.description).toBe(original.definition.description);
      expect(roundTripped.definition.inputSchema).toEqual(original.definition.inputSchema);
    });
  });
});
