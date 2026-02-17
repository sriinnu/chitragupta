import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context, StreamEvent } from "../src/types.js";

function makeSSEPayload(events: Array<{ data: string }>): string {
	return events.map((e) => "data: " + e.data).join("\n\n") + "\n\n";
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

describe("OpenAI Provider", () => {
	const originalEnv = process.env.OPENAI_API_KEY;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		process.env.OPENAI_API_KEY = "test-openai-key-123";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalEnv !== undefined) {
			process.env.OPENAI_API_KEY = originalEnv;
		} else {
			delete process.env.OPENAI_API_KEY;
		}
	});

	it("should expose correct provider properties", async () => {
		const { openaiProvider } = await import("../src/providers/openai.js");
		expect(openaiProvider.id).toBe("openai");
		expect(openaiProvider.name).toBe("OpenAI");
		expect(openaiProvider.auth.type).toBe("env");
		expect(openaiProvider.auth.envVar).toBe("OPENAI_API_KEY");
	});

	it("should have at least 5 models defined", async () => {
		const { openaiProvider } = await import("../src/providers/openai.js");
		expect(openaiProvider.models.length).toBeGreaterThanOrEqual(5);
		const ids = openaiProvider.models.map((m) => m.id);
		expect(ids).toContain("gpt-4o");
		expect(ids).toContain("gpt-4o-mini");
		expect(ids).toContain("o1");
	});

	it("should have correct model capabilities for gpt-4o", async () => {
		const { openaiProvider } = await import("../src/providers/openai.js");
		const gpt4o = openaiProvider.models.find((m) => m.id === "gpt-4o");
		expect(gpt4o).toBeDefined();
		expect(gpt4o!.capabilities.vision).toBe(true);
		expect(gpt4o!.capabilities.toolUse).toBe(true);
		expect(gpt4o!.capabilities.streaming).toBe(true);
		expect(gpt4o!.contextWindow).toBe(128_000);
	});

	it("should throw AuthError when API key is missing", async () => {
		delete process.env.OPENAI_API_KEY;
		const { openaiProvider } = await import("../src/providers/openai.js");
		const gen = openaiProvider.stream("gpt-4o", minimalContext(), {});
		await expect(async () => {
			for await (const _ of gen) {}
		}).rejects.toThrow("OPENAI_API_KEY");
	});

	it("should yield start, text, usage, done events for a basic stream", async () => {
		const sse = makeSSEPayload([
			{ data: JSON.stringify({ id: "chatcmpl-123", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "chatcmpl-123", choices: [{ index: 0, delta: { content: "Hi there!" }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "chatcmpl-123", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) },
			{ data: JSON.stringify({ id: "chatcmpl-123", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { openaiProvider } = await import("../src/providers/openai.js");
		const events = await collectEvents(openaiProvider.stream("gpt-4o", minimalContext(), {}));
		const types = events.map((e) => e.type);
		expect(types).toContain("start");
		expect(types).toContain("text");
		expect(types).toContain("done");
		const textEvt = events.find((e) => e.type === "text")!;
		expect((textEvt as any).text).toBe("Hi there!");
		const doneEvt = events.find((e) => e.type === "done")!;
		expect((doneEvt as any).stopReason).toBe("end_turn");
	});

	it("should throw ProviderError on non-OK HTTP response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("Internal Server Error") });
		const { openaiProvider } = await import("../src/providers/openai.js");
		const gen = openaiProvider.stream("gpt-4o", minimalContext(), {});
		await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow("500");
	});

	it("should handle tool calls streamed incrementally", async () => {
		const sse = makeSSEPayload([
			{ data: JSON.stringify({ id: "chatcmpl-tc", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "get_weather", arguments: "" } }] }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "chatcmpl-tc", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"city\":" } }] }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "chatcmpl-tc", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"NYC\"}" } }] }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "chatcmpl-tc", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { openaiProvider } = await import("../src/providers/openai.js");
		const events = await collectEvents(openaiProvider.stream("gpt-4o", minimalContext(), {}));
		const toolCallEvents = events.filter((e) => e.type === "tool_call");
		expect(toolCallEvents.length).toBe(1);
		expect((toolCallEvents[0] as any).id).toBe("call_abc");
		expect((toolCallEvents[0] as any).name).toBe("get_weather");
		expect((toolCallEvents[0] as any).arguments).toBe("{\"city\":\"NYC\"}");
		const doneEvt = events.find((e) => e.type === "done")!;
		expect((doneEvt as any).stopReason).toBe("tool_use");
	});

	it("should send correct headers including Bearer token", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeSSEPayload([
			{ data: JSON.stringify({ id: "chatcmpl-hdr", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) },
		])));
		globalThis.fetch = mockFetch;
		const { openaiProvider } = await import("../src/providers/openai.js");
		await collectEvents(openaiProvider.stream("gpt-4o", minimalContext(), { maxTokens: 512 }));
		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, opts] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/chat/completions");
		expect(opts.headers["Authorization"]).toBe("Bearer test-openai-key-123");
		const body = JSON.parse(opts.body);
		expect(body.model).toBe("gpt-4o");
		expect(body.stream).toBe(true);
		expect(body.max_tokens).toBe(512);
	});

	it("should validate key returning true for OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
		const { openaiProvider } = await import("../src/providers/openai.js");
		const valid = await openaiProvider.validateKey!("some-key");
		expect(valid).toBe(true);
	});

	it("should validate key returning false for non-OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
		const { openaiProvider } = await import("../src/providers/openai.js");
		const valid = await openaiProvider.validateKey!("bad-key");
		expect(valid).toBe(false);
	});

	it("should validate key returning false on network error", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
		const { openaiProvider } = await import("../src/providers/openai.js");
		const valid = await openaiProvider.validateKey!("key");
		expect(valid).toBe(false);
	});

	it("should include system prompt in messages", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeSSEPayload([
			{ data: JSON.stringify({ id: "chatcmpl-sys", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) },
		])));
		globalThis.fetch = mockFetch;
		const { openaiProvider } = await import("../src/providers/openai.js");
		const ctx: Context = { systemPrompt: "Be concise.", messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }] };
		await collectEvents(openaiProvider.stream("gpt-4o", ctx, {}));
		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[0].content).toBe("Be concise.");
	});

	it("should map finish_reason length to max_tokens", async () => {
		const sse = makeSSEPayload([
			{ data: JSON.stringify({ id: "chatcmpl-len", choices: [{ index: 0, delta: { content: "truncated" }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "chatcmpl-len", choices: [{ index: 0, delta: {}, finish_reason: "length" }] }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { openaiProvider } = await import("../src/providers/openai.js");
		const events = await collectEvents(openaiProvider.stream("gpt-4o", minimalContext(), {}));
		const doneEvt = events.find((e) => e.type === "done")!;
		expect((doneEvt as any).stopReason).toBe("max_tokens");
	});
});
