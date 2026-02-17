import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context, StreamEvent } from "../src/types.js";

function makeSSEPayload(events: Array<{ event?: string; data: string }>): string {
	return events
		.map((e) => {
			const lines: string[] = [];
			if (e.event) lines.push("event: " + e.event);
			lines.push("data: " + e.data);
			return lines.join("\n");
		})
		.join("\n\n") + "\n\n";
}

function mockFetchResponse(status: number, sseText: string): Response {
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

function minimalContext(userText = "Hello"): Context {
	return {
		messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
	};
}

async function collectEvents(gen: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
	const events: StreamEvent[] = [];
	for await (const e of gen) events.push(e);
	return events;
}

describe("Anthropic Provider", () => {
	const originalEnv = process.env.ANTHROPIC_API_KEY;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key-123";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalEnv !== undefined) {
			process.env.ANTHROPIC_API_KEY = originalEnv;
		} else {
			delete process.env.ANTHROPIC_API_KEY;
		}
	});

	it("should expose correct provider properties", async () => {
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		expect(anthropicProvider.id).toBe("anthropic");
		expect(anthropicProvider.name).toBe("Anthropic");
		expect(anthropicProvider.auth.type).toBe("env");
		expect(anthropicProvider.auth.envVar).toBe("ANTHROPIC_API_KEY");
	});

	it("should have at least 3 models defined", async () => {
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		expect(anthropicProvider.models.length).toBeGreaterThanOrEqual(3);
		const ids = anthropicProvider.models.map((m) => m.id);
		expect(ids).toContain("claude-sonnet-4-5-20250929");
		expect(ids).toContain("claude-haiku-3-5-20241022");
		expect(ids).toContain("claude-opus-4-20250514");
	});

	it("should have correct model capabilities", async () => {
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const sonnet = anthropicProvider.models.find((m) => m.id === "claude-sonnet-4-5-20250929");
		expect(sonnet).toBeDefined();
		expect(sonnet!.capabilities.vision).toBe(true);
		expect(sonnet!.capabilities.thinking).toBe(true);
		expect(sonnet!.capabilities.toolUse).toBe(true);
		expect(sonnet!.capabilities.streaming).toBe(true);
		expect(sonnet!.contextWindow).toBe(200_000);
	});

	it("should throw AuthError when API key is missing", async () => {
		delete process.env.ANTHROPIC_API_KEY;
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const gen = anthropicProvider.stream("claude-sonnet-4-5-20250929", minimalContext(), {});
		await expect(async () => {
			for await (const _ of gen) { /* drain */ }
		}).rejects.toThrow("ANTHROPIC_API_KEY");
	});

	it("should yield start, text, usage, done events for a basic stream", async () => {
		const sse = makeSSEPayload([
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_test_123", usage: { input_tokens: 10, output_tokens: 0 } } }) },
			{ event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) },
			{ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello there!" } }) },
			{ event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: 0 }) },
			{ event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }) },
			{ event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const events = await collectEvents(anthropicProvider.stream("claude-sonnet-4-5-20250929", minimalContext(), {}));
		const types = events.map((e) => e.type);
		expect(types).toContain("start");
		expect(types).toContain("text");
		expect(types).toContain("usage");
		expect(types).toContain("done");
		const startEvt = events.find((e) => e.type === "start")!;
		expect((startEvt as any).messageId).toBe("msg_test_123");
		const textEvt = events.find((e) => e.type === "text")!;
		expect((textEvt as any).text).toBe("Hello there!");
		const doneEvt = events.find((e) => e.type === "done")!;
		expect((doneEvt as any).stopReason).toBe("end_turn");
	});

	it("should throw ProviderError on non-OK HTTP response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve("rate limited") });
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const gen = anthropicProvider.stream("claude-sonnet-4-5-20250929", minimalContext(), {});
		await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow("429");
	});

	it("should handle thinking blocks in the stream", async () => {
		const sse = makeSSEPayload([
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_think", usage: { input_tokens: 5, output_tokens: 0 } } }) },
			{ event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }) },
			{ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me reason..." } }) },
			{ event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: 0 }) },
			{ event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }) },
			{ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "The answer is 42." } }) },
			{ event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: 1 }) },
			{ event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } }) },
			{ event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const events = await collectEvents(anthropicProvider.stream("claude-sonnet-4-5-20250929", minimalContext(), {}));
		const thinkingEvents = events.filter((e) => e.type === "thinking");
		expect(thinkingEvents.length).toBeGreaterThanOrEqual(1);
		expect((thinkingEvents[0] as any).text).toBe("Let me reason...");
	});

	it("should handle tool use blocks in the stream", async () => {
		const sse = makeSSEPayload([
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_tool", usage: { input_tokens: 5, output_tokens: 0 } } }) },
			{ event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_123", name: "search" } }) },
			{ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":\"test\"}" } }) },
			{ event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: 0 }) },
			{ event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 10 } }) },
			{ event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const events = await collectEvents(anthropicProvider.stream("claude-sonnet-4-5-20250929", minimalContext(), {}));
		const toolCallEvents = events.filter((e) => e.type === "tool_call");
		expect(toolCallEvents.length).toBe(1);
		expect((toolCallEvents[0] as any).id).toBe("tool_123");
		expect((toolCallEvents[0] as any).name).toBe("search");
		expect((toolCallEvents[0] as any).arguments).toBe("{\"query\":\"test\"}");
		const doneEvt = events.find((e) => e.type === "done")!;
		expect((doneEvt as any).stopReason).toBe("tool_use");
	});

	it("should send correct headers and body in fetch call", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeSSEPayload([
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_hdr", usage: { input_tokens: 1, output_tokens: 0 } } }) },
			{ event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }) },
			{ event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
		])));
		globalThis.fetch = mockFetch;
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		await collectEvents(anthropicProvider.stream("claude-sonnet-4-5-20250929", minimalContext("Hi"), { maxTokens: 1024, temperature: 0.7 }));
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, opts] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.anthropic.com/v1/messages");
		expect(opts.method).toBe("POST");
		expect(opts.headers["x-api-key"]).toBe("test-anthropic-key-123");
		expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
		const body = JSON.parse(opts.body);
		expect(body.model).toBe("claude-sonnet-4-5-20250929");
		expect(body.stream).toBe(true);
		expect(body.max_tokens).toBe(1024);
		expect(body.temperature).toBe(0.7);
	});

	it("should validate key returning true for 200 response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 });
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const valid = await anthropicProvider.validateKey!("sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
		expect(valid).toBe(true);
	});

	it("should validate key returning false for 401 response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ status: 401 });
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const valid = await anthropicProvider.validateKey!("bad-key");
		expect(valid).toBe(false);
	});

	it("should validate key returning false on network error", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const valid = await anthropicProvider.validateKey!("key");
		expect(valid).toBe(false);
	});

	it("should yield error event for SSE error frames", async () => {
		const sse = makeSSEPayload([
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_err", usage: { input_tokens: 1, output_tokens: 0 } } }) },
			{ event: "error", data: JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Server overloaded" } }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const events = await collectEvents(anthropicProvider.stream("claude-sonnet-4-5-20250929", minimalContext(), {}));
		const errorEvents = events.filter((e) => e.type === "error");
		expect(errorEvents.length).toBe(1);
		expect((errorEvents[0] as any).error.message).toContain("Server overloaded");
	});

	it("should handle context with system prompt", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeSSEPayload([
			{ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_sys", usage: { input_tokens: 1, output_tokens: 0 } } }) },
			{ event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
		])));
		globalThis.fetch = mockFetch;
		const { anthropicProvider } = await import("../src/providers/anthropic.js");
		const ctx: Context = { systemPrompt: "You are a helpful assistant.", messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }] };
		await collectEvents(anthropicProvider.stream("claude-sonnet-4-5-20250929", ctx, {}));
		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.system).toBe("You are a helpful assistant.");
	});
});
