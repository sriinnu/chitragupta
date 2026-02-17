import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context, StreamEvent, ModelDefinition } from "../src/types.js";
import { createOpenAICompatProvider, type OpenAICompatConfig } from "../src/providers/openai-compat.js";

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

const testModel: ModelDefinition = {
	id: "test-model",
	name: "Test Model",
	contextWindow: 64_000,
	maxOutputTokens: 8_192,
	pricing: { input: 1, output: 2 },
	capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
};

const testConfig: OpenAICompatConfig = {
	id: "test-provider",
	name: "Test Provider",
	baseUrl: "https://api.test-provider.com/v1",
	authEnvVar: "TEST_PROVIDER_KEY",
	models: [testModel],
};

describe("OpenAI-Compatible Provider Factory", () => {
	const originalEnv = process.env.TEST_PROVIDER_KEY;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		process.env.TEST_PROVIDER_KEY = "test-key-456";
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalEnv !== undefined) {
			process.env.TEST_PROVIDER_KEY = originalEnv;
		} else {
			delete process.env.TEST_PROVIDER_KEY;
		}
	});

	it("should create provider with correct properties", () => {
		const provider = createOpenAICompatProvider(testConfig);
		expect(provider.id).toBe("test-provider");
		expect(provider.name).toBe("Test Provider");
		expect(provider.models).toHaveLength(1);
		expect(provider.models[0].id).toBe("test-model");
		expect(provider.auth.type).toBe("env");
		expect(provider.auth.envVar).toBe("TEST_PROVIDER_KEY");
	});

	it("should create provider with custom auth when no envVar", () => {
		const config: OpenAICompatConfig = {
			id: "no-auth",
			name: "No Auth",
			baseUrl: "http://localhost:8000/v1",
			models: [testModel],
		};
		const provider = createOpenAICompatProvider(config);
		expect(provider.auth.type).toBe("custom");
	});

	it("should throw AuthError when env var is missing", async () => {
		delete process.env.TEST_PROVIDER_KEY;
		const provider = createOpenAICompatProvider(testConfig);
		const gen = provider.stream("test-model", minimalContext(), {});
		await expect(async () => {
			for await (const _ of gen) {}
		}).rejects.toThrow("TEST_PROVIDER_KEY");
	});

	it("should yield start, text, done events for a basic stream", async () => {
		const sse = makeSSEPayload([
			{ data: JSON.stringify({ id: "compat-123", choices: [{ index: 0, delta: { content: "Hello!" }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "compat-123", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const provider = createOpenAICompatProvider(testConfig);
		const events = await collectEvents(provider.stream("test-model", minimalContext(), {}));
		const types = events.map((e) => e.type);
		expect(types).toContain("start");
		expect(types).toContain("text");
		expect(types).toContain("done");
		const textEvt = events.find((e) => e.type === "text")!;
		expect((textEvt as any).text).toBe("Hello!");
	});

	it("should send request to correct URL with auth header", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeSSEPayload([
			{ data: JSON.stringify({ id: "compat-url", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) },
		])));
		globalThis.fetch = mockFetch;
		const provider = createOpenAICompatProvider(testConfig);
		await collectEvents(provider.stream("test-model", minimalContext(), {}));
		const [url, opts] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.test-provider.com/v1/chat/completions");
		expect(opts.headers["Authorization"]).toBe("Bearer test-key-456");
	});

	it("should strip trailing slashes from base URL", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeSSEPayload([
			{ data: JSON.stringify({ id: "compat-slash", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) },
		])));
		globalThis.fetch = mockFetch;
		const config = { ...testConfig, baseUrl: "https://api.test.com/v1///" };
		const provider = createOpenAICompatProvider(config);
		await collectEvents(provider.stream("test-model", minimalContext(), {}));
		const url = mockFetch.mock.calls[0][0];
		expect(url).toBe("https://api.test.com/v1/chat/completions");
	});

	it("should throw ProviderError on non-OK HTTP response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("Unauthorized") });
		const provider = createOpenAICompatProvider(testConfig);
		const gen = provider.stream("test-model", minimalContext(), {});
		await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow("401");
	});

	it("should handle tool calls", async () => {
		const sse = makeSSEPayload([
			{ data: JSON.stringify({ id: "compat-tc", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "tc_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.txt\"}" } }] }, finish_reason: null }] }) },
			{ data: JSON.stringify({ id: "compat-tc", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const provider = createOpenAICompatProvider(testConfig);
		const events = await collectEvents(provider.stream("test-model", minimalContext(), {}));
		const tcEvents = events.filter((e) => e.type === "tool_call");
		expect(tcEvents.length).toBe(1);
		expect((tcEvents[0] as any).name).toBe("read_file");
	});

	it("should validate key by calling /models endpoint", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
		const provider = createOpenAICompatProvider(testConfig);
		const valid = await provider.validateKey!("key");
		expect(valid).toBe(true);
		const url = (globalThis.fetch as any).mock.calls[0][0];
		expect(url).toContain("/models");
	});

	it("should validate key returning false on failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
		const provider = createOpenAICompatProvider(testConfig);
		const valid = await provider.validateKey!("key");
		expect(valid).toBe(false);
	});

	it("should not send auth header when no authEnvVar", async () => {
		const noAuthConfig: OpenAICompatConfig = {
			id: "local",
			name: "Local",
			baseUrl: "http://localhost:8000/v1",
			models: [testModel],
		};
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeSSEPayload([
			{ data: JSON.stringify({ id: "local-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) },
		])));
		globalThis.fetch = mockFetch;
		const provider = createOpenAICompatProvider(noAuthConfig);
		await collectEvents(provider.stream("test-model", minimalContext(), {}));
		const opts = mockFetch.mock.calls[0][1];
		expect(opts.headers["Authorization"]).toBeUndefined();
	});
});
