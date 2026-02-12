import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stripAnsi } from "@chitragupta/ui/ansi";
import { McpServer } from "../src/server.js";
import {
  createRequest,
  createResponse,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
} from "../src/jsonrpc.js";
import type {
  McpServerConfig,
  McpToolHandler,
  McpResourceHandler,
  McpPromptHandler,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../src/types.js";

/**
 * Helper: invoke a private method on the McpServer for testing.
 * We call _handleRequest directly to avoid needing real transports.
 */
async function handleRequest(
  server: McpServer,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  return (server as any)._handleRequest(request);
}

describe("McpServer", () => {
  let server: McpServer;

  const testToolHandler: McpToolHandler = {
    definition: {
      name: "greet",
      description: "Greet someone",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    },
    async execute(args: Record<string, unknown>) {
      return {
        content: [{ type: "text", text: `Hello, ${args.name}!` }],
      };
    },
  };

  const testResourceHandler: McpResourceHandler = {
    definition: {
      uri: "file:///readme.md",
      name: "README",
      description: "Project readme",
      mimeType: "text/markdown",
    },
    async read(_uri: string) {
      return [{ type: "text", text: "# Hello World" }];
    },
  };

  const testPromptHandler: McpPromptHandler = {
    definition: {
      name: "code-review",
      description: "Review code",
      arguments: [
        { name: "language", description: "Programming language", required: true },
      ],
    },
    async get(args: Record<string, string>) {
      return [{ type: "text", text: `Review this ${args.language} code.` }];
    },
  };

  beforeEach(() => {
    const config: McpServerConfig = {
      name: "test-server",
      version: "1.0.0",
      transport: "stdio",
      tools: [testToolHandler],
      resources: [testResourceHandler],
      prompts: [testPromptHandler],
    };
    server = new McpServer(config);
  });

  afterEach(async () => {
    await server.stop();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Initialize
  // ═══════════════════════════════════════════════════════════════════════

  describe("initialize", () => {
    it("should return server info and capabilities", async () => {
      const req = createRequest("initialize", { protocolVersion: "2024-11-05" }, 1);
      const res = await handleRequest(server, req);

      expect(res.error).toBeUndefined();
      const result = res.result as Record<string, unknown>;
      expect(result.protocolVersion).toBe("2024-11-05");

      const info = result.serverInfo as Record<string, unknown>;
      expect(info.name).toBe("test-server");
      expect(info.version).toBe("1.0.0");

      const caps = result.capabilities as Record<string, unknown>;
      expect(caps.tools).toBeDefined();
      expect(caps.resources).toBeDefined();
      expect(caps.prompts).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tools
  // ═══════════════════════════════════════════════════════════════════════

  describe("tools/list", () => {
    it("should list all registered tools", async () => {
      const req = createRequest("tools/list", undefined, 2);
      const res = await handleRequest(server, req);

      const result = res.result as Record<string, unknown>;
      const tools = result.tools as Array<{ name: string }>;
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("greet");
    });
  });

  describe("tools/call", () => {
    it("should execute a registered tool", async () => {
      const req = createRequest("tools/call", { name: "greet", arguments: { name: "Alice" } }, 3);
      const res = await handleRequest(server, req);

      expect(res.error).toBeUndefined();
      const result = res.result as { content: Array<{ type: string; text: string }>; _metadata?: unknown };
      expect(result.content[0].text).toContain("Hello, Alice!");
      const plain = stripAnsi(result.content[0].text);
      expect(plain).toMatch(/═══ greet ═/);
      expect(plain).toMatch(/⏱ [\d.]+ms/);
      // _metadata must not leak to wire
      expect(result._metadata).toBeUndefined();
    });

    it("should return error for unknown tool", async () => {
      const req = createRequest("tools/call", { name: "nonexistent" }, 4);
      const res = await handleRequest(server, req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(INVALID_PARAMS);
      expect(res.error!.message).toContain("Unknown tool");
    });

    it("should return error when name param is missing", async () => {
      const req = createRequest("tools/call", {}, 5);
      const res = await handleRequest(server, req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(INVALID_PARAMS);
    });

    it("should return isError result when tool execution throws", async () => {
      const failingTool: McpToolHandler = {
        definition: { name: "fail", description: "Always fails", inputSchema: {} },
        async execute() {
          throw new Error("tool broke");
        },
      };
      server.registerTool(failingTool);

      const req = createRequest("tools/call", { name: "fail" }, 6);
      const res = await handleRequest(server, req);

      // Tool errors are returned as result with isError: true
      expect(res.error).toBeUndefined();
      const result = res.result as { isError: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("tool broke");
      const plain = stripAnsi(result.content[0].text);
      expect(plain).toMatch(/═══ fail ═/);
      expect(plain).toMatch(/⏱ [\d.]+ms/);
    });
  });

  describe("registerTool / unregisterTool", () => {
    it("should add and remove tools dynamically", async () => {
      const newTool: McpToolHandler = {
        definition: { name: "echo", description: "Echo", inputSchema: {} },
        async execute(args) {
          return { content: [{ type: "text", text: JSON.stringify(args) }] };
        },
      };

      server.registerTool(newTool);

      let req = createRequest("tools/list", undefined, 10);
      let res = await handleRequest(server, req);
      let tools = (res.result as any).tools;
      expect(tools.map((t: any) => t.name)).toContain("echo");

      server.unregisterTool("echo");

      req = createRequest("tools/list", undefined, 11);
      res = await handleRequest(server, req);
      tools = (res.result as any).tools;
      expect(tools.map((t: any) => t.name)).not.toContain("echo");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Resources
  // ═══════════════════════════════════════════════════════════════════════

  describe("resources/list", () => {
    it("should list all registered resources", async () => {
      const req = createRequest("resources/list", undefined, 20);
      const res = await handleRequest(server, req);

      const result = res.result as Record<string, unknown>;
      const resources = result.resources as Array<{ uri: string; name: string }>;
      expect(resources).toHaveLength(1);
      expect(resources[0].name).toBe("README");
    });
  });

  describe("resources/read", () => {
    it("should read a registered resource by URI", async () => {
      const req = createRequest("resources/read", { uri: "file:///readme.md" }, 21);
      const res = await handleRequest(server, req);

      expect(res.error).toBeUndefined();
      const result = res.result as { contents: Array<{ type: string; text: string }> };
      expect(result.contents[0].text).toBe("# Hello World");
    });

    it("should return error for unknown resource URI", async () => {
      const req = createRequest("resources/read", { uri: "file:///nonexistent" }, 22);
      const res = await handleRequest(server, req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(INVALID_PARAMS);
    });

    it("should return error when uri param is missing", async () => {
      const req = createRequest("resources/read", {}, 23);
      const res = await handleRequest(server, req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(INVALID_PARAMS);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Prompts
  // ═══════════════════════════════════════════════════════════════════════

  describe("prompts/list", () => {
    it("should list all registered prompts", async () => {
      const req = createRequest("prompts/list", undefined, 30);
      const res = await handleRequest(server, req);

      const result = res.result as Record<string, unknown>;
      const prompts = result.prompts as Array<{ name: string }>;
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe("code-review");
    });
  });

  describe("prompts/get", () => {
    it("should get a prompt by name with arguments", async () => {
      const req = createRequest(
        "prompts/get",
        { name: "code-review", arguments: { language: "TypeScript" } },
        31,
      );
      const res = await handleRequest(server, req);

      expect(res.error).toBeUndefined();
      const result = res.result as { messages: Array<{ content: { type: string; text: string } }> };
      expect(result.messages[0].content.text).toBe("Review this TypeScript code.");
    });

    it("should return error for unknown prompt", async () => {
      const req = createRequest("prompts/get", { name: "nonexistent" }, 32);
      const res = await handleRequest(server, req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(INVALID_PARAMS);
    });

    it("should return error when name param is missing", async () => {
      const req = createRequest("prompts/get", {}, 33);
      const res = await handleRequest(server, req);

      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(INVALID_PARAMS);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Other Methods
  // ═══════════════════════════════════════════════════════════════════════

  describe("ping", () => {
    it("should respond to ping with empty result", async () => {
      const req = createRequest("ping", undefined, 40);
      const res = await handleRequest(server, req);
      expect(res.error).toBeUndefined();
      expect(res.result).toEqual({});
    });
  });

  describe("unknown method", () => {
    it("should return METHOD_NOT_FOUND for unknown methods", async () => {
      const req = createRequest("unknown/method", undefined, 50);
      const res = await handleRequest(server, req);
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(METHOD_NOT_FOUND);
    });
  });
});
