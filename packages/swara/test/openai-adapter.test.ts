/**
 * Tests for the OpenAI LLMProvider adapter (openai-adapter.ts).
 *
 * Covers: factory creation, model listing, non-streaming completion,
 * streaming completion, request formatting, response parsing,
 * tool use (function calling), and error paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOpenAIAdapter } from "../src/providers/openai-adapter.js";
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
function mockSSEResponse(status: number, events: Array<{ data: string }>): Response {
	const sseText = events
		.map((e) => `data: ${e.data}`)
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
		model: "gpt-4o",
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

describe("createOpenAIAdapter", () => {
	let originalFetch: typeof globalThis.fetch;
	let originalKey: string | undefined;
	let adapter: LLMProvider;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		originalKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = "test-openai-key-xyz";
		adapter = createOpenAIAdapter();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalKey !== undefined) {
			process.env.OPENAI_API_KEY = originalKey;
		} else {
			delete process.env.OPENAI_API_KEY;
		}
	});

	// ─── Factory & Identity ──────────────────────────────────────────

	it("should return provider with correct id and name", () => {
		expect(adapter.id).toBe("openai");
		expect(adapter.name).toBe("OpenAI");
	});

	it("should expose complete, stream, and listModels methods", () => {
		expect(typeof adapter.complete).toBe("function");
		expect(typeof adapter.stream).toBe("function");
		expect(typeof adapter.listModels).toBe("function");
	});

	it("should list known OpenAI models", async () => {
		const models = await adapter.listModels!();
		expect(models.length).toBeGreaterThanOrEqual(4);
		expect(models).toContain("gpt-4o");
		expect(models).toContain("gpt-4o-mini");
		expect(models).toContain("o1");
	});

	// ─── Non-Streaming Completion ────────────────────────────────────

	it("should send a non-streaming request with correct headers", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-test",
			model: "gpt-4o",
			choices: [{ index: 0, message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 5, completion_tokens: 2 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest());

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.openai.com/v1/chat/completions");
		expect(opts.method).toBe("POST");
		const headers = opts.headers as Record<string, string>;
		expect(headers["Authorization"]).toBe("Bearer test-openai-key-xyz");
	});

	it("should parse a non-streaming text response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-parse",
			model: "gpt-4o",
			choices: [{ index: 0, message: { role: "assistant", content: "Response text" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 8, completion_tokens: 3 },
		}));

		const resp = await adapter.complete(minimalRequest());
		expect(resp.id).toBe("chatcmpl-parse");
		expect(resp.model).toBe("gpt-4o");
		expect(resp.content).toHaveLength(1);
		expect(resp.content[0].type).toBe("text");
		expect(resp.content[0].text).toBe("Response text");
		expect(resp.stopReason).toBe("end_turn"); // OpenAI "stop" -> "end_turn"
		expect(resp.usage.inputTokens).toBe(8);
		expect(resp.usage.outputTokens).toBe(3);
	});

	it("should parse tool_calls in non-streaming response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-tool",
			model: "gpt-4o",
			choices: [{
				index: 0,
				message: {
					role: "assistant",
					content: null,
					tool_calls: [{
						id: "call_abc",
						type: "function",
						function: { name: "get_weather", arguments: "{\"city\":\"London\"}" },
					}],
				},
				finish_reason: "tool_calls",
			}],
			usage: { prompt_tokens: 10, completion_tokens: 15 },
		}));

		const resp = await adapter.complete(minimalRequest());
		expect(resp.toolCalls).toHaveLength(1);
		expect(resp.toolCalls![0].id).toBe("call_abc");
		expect(resp.toolCalls![0].name).toBe("get_weather");
		expect(resp.toolCalls![0].input).toEqual({ city: "London" });
		expect(resp.stopReason).toBe("tool_use"); // OpenAI "tool_calls" -> "tool_use"
	});

	it("should handle malformed tool call arguments gracefully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-bad",
			model: "gpt-4o",
			choices: [{
				index: 0,
				message: {
					role: "assistant",
					content: null,
					tool_calls: [{
						id: "call_bad",
						type: "function",
						function: { name: "search", arguments: "not-valid-json" },
					}],
				},
				finish_reason: "tool_calls",
			}],
			usage: { prompt_tokens: 5, completion_tokens: 5 },
		}));

		const resp = await adapter.complete(minimalRequest());
		expect(resp.toolCalls).toHaveLength(1);
		expect(resp.toolCalls![0].input).toEqual({ raw: "not-valid-json" });
	});

	it("should throw on non-OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: () => Promise.resolve("unauthorized"),
		} as unknown as Response);

		await expect(adapter.complete(minimalRequest())).rejects.toThrow("401");
	});

	it("should throw when API key is missing", async () => {
		delete process.env.OPENAI_API_KEY;
		adapter = createOpenAIAdapter();
		await expect(adapter.complete(minimalRequest())).rejects.toThrow("OPENAI_API_KEY");
	});

	it("should include tools as function definitions in request body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-fn",
			model: "gpt-4o",
			choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 5, completion_tokens: 1 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({
			tools: [{
				name: "calculate",
				description: "Perform arithmetic",
				inputSchema: { type: "object", properties: { expr: { type: "string" } } },
			}],
		}));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.tools).toHaveLength(1);
		expect(body.tools[0].type).toBe("function");
		expect(body.tools[0].function.name).toBe("calculate");
		expect(body.tools[0].function.parameters).toBeDefined();
	});

	it("should set max_tokens, temperature, and stop in request body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-opts",
			model: "gpt-4o",
			choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 0 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({
			maxTokens: 4096,
			temperature: 0.3,
			stopSequences: ["###"],
		}));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.max_tokens).toBe(4096);
		expect(body.temperature).toBe(0.3);
		expect(body.stop).toEqual(["###"]);
	});

	it("should map finish_reason 'length' to 'max_tokens'", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-len",
			model: "gpt-4o",
			choices: [{ index: 0, message: { role: "assistant", content: "truncated" }, finish_reason: "length" }],
			usage: { prompt_tokens: 5, completion_tokens: 100 },
		}));

		const resp = await adapter.complete(minimalRequest());
		expect(resp.stopReason).toBe("max_tokens");
	});

	it("should include system messages in the messages array", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-sys",
			model: "gpt-4o",
			choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 5, completion_tokens: 1 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello" },
			],
		}));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[0].content).toBe("You are a helpful assistant.");
	});

	// ─── Streaming Completion ────────────────────────────────────────

	it("should stream text deltas", async () => {
		const sseEvents = [
			{ data: JSON.stringify({ choices: [{ index: 0, delta: { content: "Hello " }, finish_reason: null }] }) },
			{ data: JSON.stringify({ choices: [{ index: 0, delta: { content: "world!" }, finish_reason: null }] }) },
			{ data: JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4 } }) },
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
	});

	it("should stream tool call chunks", async () => {
		const sseEvents = [
			{ data: JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_s1", type: "function", function: { name: "search", arguments: "" } }] }, finish_reason: null }] }) },
			{ data: JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"q\":" } }] }, finish_reason: null }] }) },
			{ data: JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"test\"}" } }] }, finish_reason: null }] }) },
			{ data: JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 8 } }) },
		];
		globalThis.fetch = vi.fn().mockResolvedValue(mockSSEResponse(200, sseEvents));

		const chunks = await collectChunks(adapter.stream!(minimalRequest({ stream: true })));

		const startChunk = chunks.find((c) => c.type === "tool_call_start");
		expect(startChunk).toBeDefined();
		expect(startChunk!.toolCall!.id).toBe("call_s1");
		expect(startChunk!.toolCall!.name).toBe("search");

		const deltaChunks = chunks.filter((c) => c.type === "tool_call_delta");
		expect(deltaChunks.length).toBeGreaterThanOrEqual(1);
	});

	it("should throw on non-OK streaming response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
			text: () => Promise.resolve("service unavailable"),
		} as unknown as Response);

		await expect(collectChunks(adapter.stream!(minimalRequest({ stream: true })))).rejects.toThrow("503");
	});

	it("should enable stream_options.include_usage for streaming requests", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockSSEResponse(200, [
			{ data: JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] }) },
			{ data: JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } }) },
		]));
		globalThis.fetch = mockFetch;

		await collectChunks(adapter.stream!(minimalRequest({ stream: true })));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
	});

	it("should convert tool role messages into tool messages with tool_call_id", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockJsonResponse(200, {
			id: "chatcmpl-tr",
			model: "gpt-4o",
			choices: [{ index: 0, message: { role: "assistant", content: "Got it." }, finish_reason: "stop" }],
			usage: { prompt_tokens: 10, completion_tokens: 3 },
		}));
		globalThis.fetch = mockFetch;

		await adapter.complete(minimalRequest({
			messages: [
				{ role: "user", content: "Use tool" },
				{ role: "tool", content: "tool result here", toolCallId: "tc_99" },
			],
		}));

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		const toolMsg = body.messages.find((m: { role: string }) => m.role === "tool");
		expect(toolMsg).toBeDefined();
		expect(toolMsg.tool_call_id).toBe("tc_99");
		expect(toolMsg.content).toBe("tool result here");
	});

	it("should handle response with usage in streaming done chunk", async () => {
		const sseEvents = [
			{ data: JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] }) },
			{ data: JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 7 } }) },
		];
		globalThis.fetch = vi.fn().mockResolvedValue(mockSSEResponse(200, sseEvents));

		const chunks = await collectChunks(adapter.stream!(minimalRequest({ stream: true })));
		const doneChunk = chunks.find((c) => c.type === "done");
		expect(doneChunk).toBeDefined();
		expect(doneChunk!.usage!.inputTokens).toBe(12);
		expect(doneChunk!.usage!.outputTokens).toBe(7);
	});
});
