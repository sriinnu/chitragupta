import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Context, StreamEvent } from "../src/types.js";

function makeGeminiSSE(chunks: Array<Record<string, unknown>>): string {
	return chunks.map((c) => "data: " + JSON.stringify(c)).join("\n\n") + "\n\n";
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

describe("Google Gemini Provider", () => {
	const originalGoogleKey = process.env.GOOGLE_API_KEY;
	const originalGeminiKey = process.env.GEMINI_API_KEY;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		process.env.GOOGLE_API_KEY = "test-google-key-123";
		delete process.env.GEMINI_API_KEY;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalGoogleKey !== undefined) {
			process.env.GOOGLE_API_KEY = originalGoogleKey;
		} else {
			delete process.env.GOOGLE_API_KEY;
		}
		if (originalGeminiKey !== undefined) {
			process.env.GEMINI_API_KEY = originalGeminiKey;
		} else {
			delete process.env.GEMINI_API_KEY;
		}
	});

	it("should expose correct provider properties", async () => {
		const { googleProvider } = await import("../src/providers/google.js");
		expect(googleProvider.id).toBe("google");
		expect(googleProvider.name).toBe("Google Gemini");
		expect(googleProvider.auth.type).toBe("env");
		expect(googleProvider.auth.envVar).toBe("GOOGLE_API_KEY");
	});

	it("should have at least 3 models defined", async () => {
		const { googleProvider } = await import("../src/providers/google.js");
		expect(googleProvider.models.length).toBeGreaterThanOrEqual(3);
		const ids = googleProvider.models.map((m) => m.id);
		expect(ids).toContain("gemini-2.0-flash");
		expect(ids).toContain("gemini-2.0-flash-lite");
		expect(ids).toContain("gemini-1.5-pro");
	});

	it("should have correct model capabilities for gemini-2.0-flash", async () => {
		const { googleProvider } = await import("../src/providers/google.js");
		const flash = googleProvider.models.find((m) => m.id === "gemini-2.0-flash");
		expect(flash).toBeDefined();
		expect(flash!.capabilities.vision).toBe(true);
		expect(flash!.capabilities.toolUse).toBe(true);
		expect(flash!.capabilities.streaming).toBe(true);
		expect(flash!.contextWindow).toBe(1_048_576);
	});

	it("should throw AuthError when API key is missing", async () => {
		delete process.env.GOOGLE_API_KEY;
		delete process.env.GEMINI_API_KEY;
		const { googleProvider } = await import("../src/providers/google.js");
		const gen = googleProvider.stream("gemini-2.0-flash", minimalContext(), {});
		await expect(async () => {
			for await (const _ of gen) {}
		}).rejects.toThrow(/GOOGLE_API_KEY|GEMINI_API_KEY/);
	});

	it("should also accept GEMINI_API_KEY env var", async () => {
		delete process.env.GOOGLE_API_KEY;
		process.env.GEMINI_API_KEY = "test-gemini-key";
		const sse = makeGeminiSSE([
			{ candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { googleProvider } = await import("../src/providers/google.js");
		const events = await collectEvents(googleProvider.stream("gemini-2.0-flash", minimalContext(), {}));
		expect(events.some((e) => e.type === "text")).toBe(true);
		const fetchCall = (globalThis.fetch as any).mock.calls[0][0] as string;
		expect(fetchCall).toContain("key=test-gemini-key");
	});

	it("should yield start, text, usage, done events for a basic stream", async () => {
		const sse = makeGeminiSSE([
			{ candidates: [{ content: { parts: [{ text: "Hello there!" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
			{ candidates: [{ content: { parts: [{ text: " More text." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 } },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { googleProvider } = await import("../src/providers/google.js");
		const events = await collectEvents(googleProvider.stream("gemini-2.0-flash", minimalContext(), {}));
		const types = events.map((e) => e.type);
		expect(types).toContain("start");
		expect(types).toContain("text");
		expect(types).toContain("usage");
		expect(types).toContain("done");
		const textEvents = events.filter((e) => e.type === "text");
		expect(textEvents.length).toBeGreaterThanOrEqual(1);
	});

	it("should throw ProviderError on non-OK HTTP response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve("Forbidden") });
		const { googleProvider } = await import("../src/providers/google.js");
		const gen = googleProvider.stream("gemini-2.0-flash", minimalContext(), {});
		await expect(async () => { for await (const _ of gen) {} }).rejects.toThrow("403");
	});

	it("should handle function call responses", async () => {
		const sse = makeGeminiSSE([
			{ candidates: [{ content: { parts: [{ functionCall: { name: "search", args: { query: "test" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { googleProvider } = await import("../src/providers/google.js");
		const events = await collectEvents(googleProvider.stream("gemini-2.0-flash", minimalContext(), {}));
		const toolCallEvents = events.filter((e) => e.type === "tool_call");
		expect(toolCallEvents.length).toBe(1);
		expect((toolCallEvents[0] as any).name).toBe("search");
		expect(JSON.parse((toolCallEvents[0] as any).arguments)).toEqual({ query: "test" });
	});

	it("should include API key in URL query parameter", async () => {
		const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(200, makeGeminiSSE([
			{ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] },
		])));
		globalThis.fetch = mockFetch;
		const { googleProvider } = await import("../src/providers/google.js");
		await collectEvents(googleProvider.stream("gemini-2.0-flash", minimalContext(), {}));
		const url = mockFetch.mock.calls[0][0] as string;
		expect(url).toContain("key=test-google-key-123");
		expect(url).toContain("streamGenerateContent");
		expect(url).toContain("alt=sse");
	});

	it("should validate key returning true for OK response", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
		const { googleProvider } = await import("../src/providers/google.js");
		const valid = await googleProvider.validateKey!("some-key");
		expect(valid).toBe(true);
	});

	it("should validate key returning false on error", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
		const { googleProvider } = await import("../src/providers/google.js");
		const valid = await googleProvider.validateKey!("key");
		expect(valid).toBe(false);
	});

	it("should map STOP finish reason to end_turn", async () => {
		const sse = makeGeminiSSE([
			{ candidates: [{ content: { parts: [{ text: "done" }] }, finishReason: "STOP" }] },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { googleProvider } = await import("../src/providers/google.js");
		const events = await collectEvents(googleProvider.stream("gemini-2.0-flash", minimalContext(), {}));
		const doneEvt = events.find((e) => e.type === "done")!;
		expect((doneEvt as any).stopReason).toBe("end_turn");
	});

	it("should map MAX_TOKENS finish reason to max_tokens", async () => {
		const sse = makeGeminiSSE([
			{ candidates: [{ content: { parts: [{ text: "trunc" }] }, finishReason: "MAX_TOKENS" }] },
		]);
		globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, sse));
		const { googleProvider } = await import("../src/providers/google.js");
		const events = await collectEvents(googleProvider.stream("gemini-2.0-flash", minimalContext(), {}));
		const doneEvt = events.find((e) => e.type === "done")!;
		expect((doneEvt as any).stopReason).toBe("max_tokens");
	});
});
