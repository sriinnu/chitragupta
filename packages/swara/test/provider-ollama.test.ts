import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context, StreamEvent } from "../src/types.js";

function makeNDJSON(lines: Array<Record<string, unknown>>): string {
	return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

function mockFetchResponse(status: number, ndjsonText: string): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(ndjsonText));
			controller.close();
		},
	});
	return {
		ok: status >= 200 && status < 300,
		status,
		body: stream,
		text: () => Promise.resolve(ndjsonText),
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

describe("Ollama Provider", () => {
	const originalHost = process.env.OLLAMA_HOST;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		delete process.env.OLLAMA_HOST;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalHost !== undefined) {
			process.env.OLLAMA_HOST = originalHost;
		} else {
			delete process.env.OLLAMA_HOST;
		}
	});

	it("should expose correct provider properties", async () => {
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		expect(ollamaProvider.id).toBe("ollama");
		expect(ollamaProvider.name).toBe("Ollama (Local)");
		expect(ollamaProvider.auth.type).toBe("custom");
	});

	it("should have at least 4 models defined", async () => {
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		expect(ollamaProvider.models.length).toBeGreaterThanOrEqual(4);
		const ids = ollamaProvider.models.map((m) => m.id);
		expect(ids).toContain("llama3.2");
		expect(ids).toContain("codellama");
		expect(ids).toContain("mistral");
		expect(ids).toContain("phi3");
	});

	it("should have zero pricing for all models (local)", async () => {
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		for (const model of ollamaProvider.models) {
			expect(model.pricing.input).toBe(0);
			expect(model.pricing.output).toBe(0);
		}
	});

	it("should use default localhost:11434 base URL", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeNDJSON([
			{ message: { content: "Hi" }, done: false },
			{ done: true, prompt_eval_count: 5, eval_count: 2 },
		])));
		globalThis.fetch = mockFetch;
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		await collectEvents(ollamaProvider.stream("llama3.2", minimalContext(), {}));
		expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
	});

	it("should use custom OLLAMA_HOST env var", async () => {
		process.env.OLLAMA_HOST = "http://myserver:9999";
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeNDJSON([
			{ message: { content: "Hi" }, done: false },
			{ done: true, prompt_eval_count: 5, eval_count: 2 },
		])));
		globalThis.fetch = mockFetch;
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		await collectEvents(ollamaProvider.stream("llama3.2", minimalContext(), {}));
		expect(mockFetch.mock.calls[0][0]).toBe("http://myserver:9999/api/chat");
	});

	it("should yield start, text, usage, done events for a basic stream", async () => {
		const ndjson = makeNDJSON([
			{ message: { role: "assistant", content: "Hello " }, done: false },
			{ message: { role: "assistant", content: "world!" }, done: false },
			{ done: true, prompt_eval_count: 10, eval_count: 5 },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, ndjson));
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		const events = await collectEvents(ollamaProvider.stream("llama3.2", minimalContext(), {}));
		const types = events.map((e) => e.type);
		expect(types).toContain("start");
		expect(types).toContain("text");
		expect(types).toContain("usage");
		expect(types).toContain("done");
		const textEvents = events.filter((e) => e.type === "text");
		expect(textEvents.length).toBe(2);
		expect((textEvents[0] as any).text).toBe("Hello ");
		expect((textEvents[1] as any).text).toBe("world!");
	});

	it("should throw ProviderError on connection failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		const gen = ollamaProvider.stream("llama3.2", minimalContext(), {});
		await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow("ECONNREFUSED");
	});

	it("should throw ProviderError on non-OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve("model not found") });
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		const gen = ollamaProvider.stream("llama3.2", minimalContext(), {});
		await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow("404");
	});

	it("should handle tool calls from Ollama", async () => {
		const ndjson = makeNDJSON([
			{ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "get_time", arguments: { timezone: "UTC" } } }] }, done: false },
			{ done: true, prompt_eval_count: 5, eval_count: 3 },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, ndjson));
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		const events = await collectEvents(ollamaProvider.stream("llama3.2", minimalContext(), {}));
		const toolCallEvents = events.filter((e) => e.type === "tool_call");
		expect(toolCallEvents.length).toBe(1);
		expect((toolCallEvents[0] as any).name).toBe("get_time");
		expect(JSON.parse((toolCallEvents[0] as any).arguments)).toEqual({ timezone: "UTC" });
	});

	it("should extract usage from final chunk", async () => {
		const ndjson = makeNDJSON([
			{ message: { content: "done" }, done: false },
			{ done: true, prompt_eval_count: 42, eval_count: 17 },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, ndjson));
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		const events = await collectEvents(ollamaProvider.stream("llama3.2", minimalContext(), {}));
		const usageEvt = events.find((e) => e.type === "usage")!;
		expect((usageEvt as any).usage.inputTokens).toBe(42);
		expect((usageEvt as any).usage.outputTokens).toBe(17);
	});

	it("should validate returning true when Ollama is running", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		const valid = await ollamaProvider.validateKey!("");
		expect(valid).toBe(true);
	});

	it("should validate returning false when Ollama is not running", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const { ollamaProvider } = await import("../src/providers/ollama.js");
		const valid = await ollamaProvider.validateKey!("");
		expect(valid).toBe(false);
	});
});
