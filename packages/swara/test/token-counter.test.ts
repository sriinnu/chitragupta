import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessagesTokens,
  fitsInContext,
  contextUsagePercent,
} from "@chitragupta/swara";
import type { Message, ModelDefinition } from "@chitragupta/swara";

const testModel: ModelDefinition = {
  id: "test-model",
  name: "Test Model",
  contextWindow: 1000, // small for easy testing
  maxOutputTokens: 200,
  pricing: { input: 1, output: 2 },
  capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
};

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate approximately 1 token per 4 characters", () => {
    // 8 chars -> 2 tokens
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("should ceil the result", () => {
    // 5 chars -> ceil(5/4) = 2
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("should handle longer text proportionally", () => {
    const text = "a".repeat(100);
    // 100 / 4 = 25
    expect(estimateTokens(text)).toBe(25);
  });

  it("should return 0 for falsy input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should handle single character", () => {
    // 1 / 4 = 0.25, ceil = 1
    expect(estimateTokens("a")).toBe(1);
  });
});

describe("estimateMessagesTokens", () => {
  it("should return 0 for empty messages array", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("should estimate tokens for text content messages", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello, how are you?" }],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should estimate tokens for thinking content", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "thinking", text: "Let me think about this..." }],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should estimate tokens for tool_call content", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "tc_1",
            name: "read_file",
            arguments: '{"path": "/foo/bar.ts"}',
          },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should estimate tokens for tool_result content", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolCallId: "tc_1",
            content: "File content here...",
          },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should use a fixed estimate (~1000 tokens) for image content", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", mediaType: "image/png", data: "abc" },
          },
        ],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    // Image produces 4000 chars "x".repeat(4000), plus overhead
    // 4000 / 4 = 1000 tokens approx
    expect(tokens).toBeGreaterThanOrEqual(1000);
  });

  it("should sum tokens across multiple messages", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there! How can I help?" }] },
      { role: "user", content: [{ type: "text", text: "Explain TypeScript generics" }] },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);

    // Individual counts should sum up
    const individual = messages.reduce(
      (sum, msg) => sum + estimateMessagesTokens([msg]),
      0,
    );
    expect(tokens).toBe(individual);
  });
});

describe("fitsInContext", () => {
  it("should return true when messages fit within context window", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ];
    expect(fitsInContext(messages, testModel)).toBe(true);
  });

  it("should return false when messages exceed context window", () => {
    // Create a message that exceeds the 1000 token context window
    const longText = "a".repeat(5000); // ~1250 tokens
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: longText }] },
    ];
    expect(fitsInContext(messages, testModel)).toBe(false);
  });
});

describe("contextUsagePercent", () => {
  it("should return 0 for empty messages", () => {
    expect(contextUsagePercent([], testModel)).toBe(0);
  });

  it("should return a percentage between 0 and 100 for normal usage", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Hello world" }] },
    ];
    const percent = contextUsagePercent(messages, testModel);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThan(100);
  });

  it("should return > 100 when messages exceed the context window", () => {
    const longText = "a".repeat(5000);
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: longText }] },
    ];
    const percent = contextUsagePercent(messages, testModel);
    expect(percent).toBeGreaterThan(100);
  });

  it("should return 0 when model contextWindow is 0", () => {
    const zeroCtxModel = { ...testModel, contextWindow: 0 };
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    expect(contextUsagePercent(messages, zeroCtxModel)).toBe(0);
  });
});
