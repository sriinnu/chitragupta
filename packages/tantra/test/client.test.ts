import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpClient } from "../src/client.js";
import { createResponse, createErrorResponse, INTERNAL_ERROR } from "../src/jsonrpc.js";
import type { JsonRpcRequest, JsonRpcResponse, McpClientConfig } from "../src/types.js";

/**
 * A mock transport that captures sent requests and allows injecting responses.
 */
class MockTransport {
  public sentMessages: JsonRpcRequest[] = [];
  private _handler: ((msg: any) => void) | null = null;

  onMessage(handler: (msg: any) => void): void {
    this._handler = handler;
  }

  send(msg: any): void {
    this.sentMessages.push(msg);
  }

  connect(_cmd: string, _args: string[]): void {
    // No-op for testing
  }

  disconnect(): void {
    // No-op for testing
  }

  /** Simulate receiving a response from the server. */
  injectResponse(response: JsonRpcResponse): void {
    if (this._handler) {
      this._handler(response);
    }
  }
}

describe("McpClient", () => {
  let client: McpClient;
  let mockTransport: MockTransport;

  beforeEach(() => {
    const config: McpClientConfig = {
      transport: "stdio",
      serverCommand: "echo",
      timeout: 5000,
    };
    client = new McpClient(config);
    mockTransport = new MockTransport();

    // Inject mock transport
    (client as any)._stdioTransport = mockTransport;
    mockTransport.onMessage((msg: any) => {
      (client as any)._onMessage(msg);
    });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe("connection state", () => {
    it("should start in disconnected state", () => {
      const freshClient = new McpClient({ transport: "stdio", serverCommand: "echo" });
      expect(freshClient.getState()).toBe("disconnected");
      expect(freshClient.getServerInfo()).toBeNull();
    });
  });

  describe("listTools", () => {
    it("should send tools/list request and return tools", async () => {
      (client as any)._state = "connected";

      const promise = client.listTools();

      // Respond to the pending request
      const sentReq = mockTransport.sentMessages[0];
      expect(sentReq.method).toBe("tools/list");

      mockTransport.injectResponse(
        createResponse(sentReq.id, {
          tools: [
            { name: "read", description: "Read a file", inputSchema: {} },
            { name: "write", description: "Write a file", inputSchema: {} },
          ],
        }),
      );

      const tools = await promise;
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("read");
      expect(tools[1].name).toBe("write");
    });
  });

  describe("listResources", () => {
    it("should send resources/list and return resources", async () => {
      (client as any)._state = "connected";

      const promise = client.listResources();

      const sentReq = mockTransport.sentMessages[0];
      mockTransport.injectResponse(
        createResponse(sentReq.id, {
          resources: [{ uri: "file:///test.md", name: "test" }],
        }),
      );

      const resources = await promise;
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe("file:///test.md");
    });
  });

  describe("listPrompts", () => {
    it("should send prompts/list and return prompts", async () => {
      (client as any)._state = "connected";

      const promise = client.listPrompts();

      const sentReq = mockTransport.sentMessages[0];
      mockTransport.injectResponse(
        createResponse(sentReq.id, {
          prompts: [{ name: "review", description: "Code review" }],
        }),
      );

      const prompts = await promise;
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe("review");
    });
  });

  describe("callTool", () => {
    it("should send tools/call with name and arguments", async () => {
      (client as any)._state = "connected";

      const promise = client.callTool("greet", { name: "Alice" });

      const sentReq = mockTransport.sentMessages[0];
      expect(sentReq.method).toBe("tools/call");
      expect(sentReq.params).toEqual({ name: "greet", arguments: { name: "Alice" } });

      mockTransport.injectResponse(
        createResponse(sentReq.id, {
          content: [{ type: "text", text: "Hello, Alice!" }],
        }),
      );

      const result = await promise;
      expect(result.content[0]).toEqual({ type: "text", text: "Hello, Alice!" });
    });

    it("should reject when server returns an error", async () => {
      (client as any)._state = "connected";

      const promise = client.callTool("bad-tool", {});

      const sentReq = mockTransport.sentMessages[0];
      mockTransport.injectResponse(
        createErrorResponse(sentReq.id, INTERNAL_ERROR, "Tool crashed"),
      );

      await expect(promise).rejects.toThrow("Tool crashed");
    });
  });

  describe("readResource", () => {
    it("should send resources/read with URI", async () => {
      (client as any)._state = "connected";

      const promise = client.readResource("file:///test.md");

      const sentReq = mockTransport.sentMessages[0];
      expect(sentReq.method).toBe("resources/read");
      expect(sentReq.params).toEqual({ uri: "file:///test.md" });

      mockTransport.injectResponse(
        createResponse(sentReq.id, {
          contents: [{ type: "text", text: "# Test" }],
        }),
      );

      const content = await promise;
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({ type: "text", text: "# Test" });
    });
  });

  describe("getPrompt", () => {
    it("should send prompts/get and return content", async () => {
      (client as any)._state = "connected";

      const promise = client.getPrompt("review", { language: "ts" });

      const sentReq = mockTransport.sentMessages[0];
      expect(sentReq.method).toBe("prompts/get");

      mockTransport.injectResponse(
        createResponse(sentReq.id, {
          description: "Code review prompt",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Review this ts code." }],
            },
          ],
        }),
      );

      const content = await promise;
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({ type: "text", text: "Review this ts code." });
    });

    it("should return empty array when no messages in response", async () => {
      (client as any)._state = "connected";

      const promise = client.getPrompt("empty");

      const sentReq = mockTransport.sentMessages[0];
      mockTransport.injectResponse(
        createResponse(sentReq.id, { messages: [] }),
      );

      const content = await promise;
      expect(content).toEqual([]);
    });
  });

  describe("timeout", () => {
    it("should reject with timeout when no response arrives", async () => {
      // Create client with very short timeout
      const fastClient = new McpClient({
        transport: "stdio",
        serverCommand: "echo",
        timeout: 50,
      });
      const fastMock = new MockTransport();
      (fastClient as any)._stdioTransport = fastMock;
      fastMock.onMessage((msg: any) => {
        (fastClient as any)._onMessage(msg);
      });
      (fastClient as any)._state = "connected";

      await expect(fastClient.callTool("slow", {})).rejects.toThrow("timed out");

      await fastClient.disconnect();
    });
  });

  describe("disconnect", () => {
    it("should reject all pending requests on disconnect", async () => {
      (client as any)._state = "connected";

      const promise = client.callTool("test", {});

      await client.disconnect();

      await expect(promise).rejects.toThrow("disconnected");
      expect(client.getState()).toBe("disconnected");
    });
  });
});
