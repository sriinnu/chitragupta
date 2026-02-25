/**
 * Tests for the Anthropic LLMProvider adapter (anthropic-adapter.ts).
 *
 * Covers: factory creation, model listing, non-streaming completion,
 * streaming completion, request formatting, response parsing,
 * tool use handling, and error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnthropicAdapter } from "../src/providers/anthropic-adapter.js";
import type {
	LLMProvider,
	CompletionRequest,
	CompletionStreamChunk,
} from "../src/completion-types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a mock JSON Response for non-streaming calls. */
function mockJsonResponse(status: number, body: Record<string, unknown>): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	} as unknown as Response;
}

/** Build a mock SSE streaming Response. */
function mockSSEResponse(status: number, events: Array<{ event?: string; data: string }>): Response {
	const sseText = events
		.map((e) => {
			const lines: string[] = [];
			if (e.event) lines.push(`event: ${e.event}`);
			lines.push(`data: ${e.data}`);
			return lines.join("\n");
		})
		.join("\n\n") + "\n\n";

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(sseText));
			controller.close();
		},
	});
	return {
		ok: status >= 200 && status < 300,
		status,
		body: stream,
		text: () => Promise.resolve(sseText),
	} as unknown as Response;
}

/** Build a minimal CompletionRequest. */
function minimalRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
	return {
		model: "claude-sonnet-4-5-20250929",
		messages: [{ role: "user", content: "Hello" }],
		...overrides,
	};
}

/** Collect all chunks from an async iterable. */
async function collectChunks(iter: AsyncIterable<CompletionStreamChunk>): Promise<CompletionStreamChunk[]> {
	const chunks: CompletionStreamChunk[] = [];
	for await (const c of iter) chunks.push(c);
	return chunks;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createAnthropicAdapter", () => {
	let originalFetch: typeof globalThis.fetch;
	let originalKey: string | undefined;
	let adapter: LLMProvider;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		originalKey = process.env.ANTHROPIC_API_KEY;
		process.env.ANTHROPIC_API_KEY = "test-key-abc123";
		adapter = createAnthropicAdapter();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalKey !== undefined) {
			process.env.ANTHROPIC_API_KEY = originalKey;
		} else {
			delete process.env.ANTHROPIC_API_KEY;
		}
	});

	// ─── Factory & Identity ──────────────────────────────────────────

	it("should return provider with correct id and name", () => {
		expect(adapter.id).toBe("anthropic");
		expect(adapter.name).toBe("Anthropic");
	});

	it("should expose complete, stream, and listModels methods", () => {
		expect(typeof adapter.complete).toBe("function");
		expect(typeof adapter.stream).toBe("function");
		expect(typeof adapter.listModels).toBe("function");
	});

	it("should list known Anthropic models", async () => {
		const models = await adapter.listModels!();
		expect(models.length).toBeGreaterThanOrEqual(3);
		expect(models).toContain("claude-sonnet-4-5-20250929");
		expect(models).toContain("claude-opus-4-20250514");
	});

	// ─── Non-Streaming Completion ────────────────────────────────────

	it("should send a non-streaming request with correct headers", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_test",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "Hi there!" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 10, output_tokens: 5 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest());

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.anthropic.com/v1/messages");
		expect(opts.method).toBe("POST");
		const headers = opts.headers as Record<string, string>;
		expect(headers["x-api-key"]).toBe("test-key-abc123");
		expect(headers["anthropic-version"]).toBe("2023-06-01");
	});

	it("should parse a non-streaming text response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_parse",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "Parsed response" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 8, output_tokens: 3 },
		}));

		const resp = await adapter.complete(minimalRequest());
		expect(resp.id).toBe("msg_parse");
		expect(resp.model).toBe("claude-sonnet-4-5-20250929");
		expect(resp.content).toHaveLength(1);
		expect(resp.content[0].type).toBe("text");
		expect(resp.content[0].text).toBe("Parsed response");
		expect(resp.stopReason).toBe("end_turn");
		expect(resp.usage.inputTokens).toBe(8);
		expect(resp.usage.outputTokens).toBe(3);
	});

	it("should parse tool_use blocks in non-streaming response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_tool",
			model: "claude-sonnet-4-5-20250929",
			content: [
				{ type: "text", text: "Using a tool." },
				{ type: "tool_use", id: "call_123", name: "search", input: { query: "test" } },
			],
			stop_reason: "tool_use",
			usage: { input_tokens: 15, output_tokens: 20 },
		}));

		const resp = await adapter.complete(minimalRequest());
		expect(resp.toolCalls).toHaveLength(1);
		expect(resp.toolCalls![0].id).toBe("call_123");
		expect(resp.toolCalls![0].name).toBe("search");
		expect(resp.toolCalls![0].input).toEqual({ query: "test" });
		expect(resp.stopReason).toBe("tool_use");
		// Content should include both text and tool_call parts
		expect(resp.content.length).toBeGreaterThanOrEqual(2);
	});

	it("should throw on non-OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			text: () => Promise.resolve("rate limited"),
		} as unknown as Response);

		await expect(adapter.complete(minimalRequest())).rejects.toThrow("429");
	});

	it("should throw when API key is missing", async () => {
		delete process.env.ANTHROPIC_API_KEY;
		adapter = createAnthropicAdapter();
		await expect(adapter.complete(minimalRequest())).rejects.toThrow("ANTHROPIC_API_KEY");
	});

	it("should include tools in request body when provided", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_tools",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "ok" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 5, output_tokens: 2 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({
			tools: [{
				name: "get_weather",
				description: "Get current weather",
				inputSchema: { type: "object", properties: { city: { type: "string" } } },
			}],
		}));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.tools).toHaveLength(1);
		expect(body.tools[0].name).toBe("get_weather");
		expect(body.tools[0].input_schema).toBeDefined();
	});

	it("should set max_tokens and temperature in request body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_opts",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 1, output_tokens: 0 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({ maxTokens: 2048, temperature: 0.5 }));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.max_tokens).toBe(2048);
		expect(body.temperature).toBe(0.5);
	});

	it("should map stop_reason 'max_tokens' correctly", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_max",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "truncated" }],
			stop_reason: "max_tokens",
			usage: { input_tokens: 5, output_tokens: 100 },
		}));

		const resp = await adapter.complete(minimalRequest());
		expect(resp.stopReason).toBe("max_tokens");
	});

	it("should extract system message from messages and set as top-level system field", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_sys",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "ok" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 5, output_tokens: 1 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({
			messages: [
				{ role: "system", content: "You are helpful." },
				{ role: "user", content: "Hi" },
			],
		}));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.system).toBe("You are helpful.");
		// System message should not be in the messages array
		expect(body.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);
	});

	// ─── Streaming Completion ────────────────────────────────────────

	it("should stream text deltas", async () => {
		const sseEvents = [
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_s1", usage: { input_tokens: 5, output_tokens: 0 } } }) },
			{ event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) },
			{ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } }) },
			{ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world!" } }) },
			{ event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } }) },
		];
		globalThis.fetch = vi.fn().mockResolvedValue(mockSSEResponse(200, sseEvents));

		const chunks = await collectChunks(adapter.stream!(minimalRequest({ stream: true })));
		const textChunks = chunks.filter((c) => c.type === "text_delta");
		expect(textChunks).toHaveLength(2);
		expect(textChunks[0].text).toBe("Hello ");
		expect(textChunks[1].text).toBe("world!");

		const doneChunk = chunks.find((c) => c.type === "done");
		expect(doneChunk).toBeDefined();
		expect(doneChunk!.stopReason).toBe("end_turn");
		expect(doneChunk!.usage!.outputTokens).toBe(4);
	});

	it("should stream tool call start and delta chunks", async () => {
		const sseEvents = [
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_tc", usage: { input_tokens: 3, output_tokens: 0 } } }) },
			{ event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tc_1", name: "search" } }) },
			{ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"hi\"}" } }) },
			{ event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 8 } }) },
		];
		globalThis.fetch = vi.fn().mockResolvedValue(mockSSEResponse(200, sseEvents));

		const chunks = await collectChunks(adapter.stream!(minimalRequest({ stream: true })));

		const startChunk = chunks.find((c) => c.type === "tool_call_start");
		expect(startChunk).toBeDefined();
		expect(startChunk!.toolCall!.id).toBe("tc_1");
		expect(startChunk!.toolCall!.name).toBe("search");

		const deltaChunk = chunks.find((c) => c.type === "tool_call_delta");
		expect(deltaChunk).toBeDefined();
		expect(deltaChunk!.text).toBe("{\"q\":\"hi\"}");
	});

	it("should throw on streaming error event", async () => {
		const sseEvents = [
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_err", usage: { input_tokens: 1, output_tokens: 0 } } }) },
			{ event: "error", data: JSON.stringify({ type: "error", error: { message: "Overloaded" } }) },
		];
		globalThis.fetch = vi.fn().mockResolvedValue(mockSSEResponse(200, sseEvents));

		await expect(collectChunks(adapter.stream!(minimalRequest({ stream: true })))).rejects.toThrow("Overloaded");
	});

	it("should throw on non-OK streaming response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: () => Promise.resolve("internal error"),
		} as unknown as Response);

		await expect(collectChunks(adapter.stream!(minimalRequest({ stream: true })))).rejects.toThrow("500");
	});

	it("should convert tool role messages to user messages with tool_result content", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_tr",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "Got it." }],
			stop_reason: "end_turn",
			usage: { input_tokens: 10, output_tokens: 3 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({
			messages: [
				{ role: "user", content: "Use the tool" },
				{
					role: "assistant",
					content: [
						{ type: "tool_call", toolCallId: "tc_1", toolName: "search", toolInput: { q: "test" } },
					],
				},
				{ role: "tool", content: "result data", toolCallId: "tc_1" },
			],
		}));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		// The tool message should be converted to a user message with tool_result content
		const toolMsg = body.messages.find((m: { role: string; content: Array<{ type: string }> }) =>
			m.role === "user" && Array.isArray(m.content) && m.content.some((c: { type: string }) => c.type === "tool_result"),
		);
		expect(toolMsg).toBeDefined();
	});

	it("should include stop_sequences when provided", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_stop",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "" }],
			stop_reason: "stop_sequence",
			usage: { input_tokens: 1, output_tokens: 0 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({ stopSequences: ["###", "END"] }));
		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.stop_sequences).toEqual(["###", "END"]);
	});

	it("should default max_tokens to 8192 when not specified", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "msg_def",
			model: "claude-sonnet-4-5-20250929",
			content: [{ type: "text", text: "" }],
			stop_reason: "end_turn",
			usage: { input_tokens: 1, output_tokens: 0 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest());
		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.max_tokens).toBe(8192);
	});
});
