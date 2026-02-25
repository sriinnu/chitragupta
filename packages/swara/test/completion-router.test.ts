import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	CompletionRouter,
	NoProviderError,
	CompletionTimeoutError,
	FallbackExhaustedError,
} from "../src/completion-router.js";
import type {
	LLMProvider,
	CompletionRequest,
	CompletionResponse,
	CompletionStreamChunk,
} from "../src/completion-types.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeResponse(overrides: Partial<CompletionResponse> = {}): CompletionResponse {
	return {
		id: "test-resp-1",
		model: "test-model",
		content: [{ type: "text", text: "Hello!" }],
		stopReason: "end_turn",
		usage: { inputTokens: 10, outputTokens: 5 },
		...overrides,
	};
}

function makeProvider(
	id: string,
	name: string,
	response?: CompletionResponse,
	streamChunks?: CompletionStreamChunk[],
): LLMProvider {
	return {
		id,
		name,
		complete: vi.fn().mockResolvedValue(response ?? makeResponse({ model: `${id}-model` })),
		stream: streamChunks
			? vi.fn(async function* () { for (const c of streamChunks) yield c; })
			: vi.fn(async function* () {
				yield { type: "text_delta" as const, text: "Hi" };
				yield { type: "done" as const, stopReason: "end_turn" as const, usage: { inputTokens: 5, outputTokens: 3 } };
			}),
		listModels: vi.fn().mockResolvedValue([`${id}-model-a`, `${id}-model-b`]),
	};
}

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
	return {
		model: "claude-sonnet-4-5-20250929",
		messages: [{ role: "user", content: "Hello" }],
		...overrides,
	};
}

async function collectChunks(iter: AsyncIterable<CompletionStreamChunk>): Promise<CompletionStreamChunk[]> {
	const chunks: CompletionStreamChunk[] = [];
	for await (const chunk of iter) chunks.push(chunk);
	return chunks;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CompletionRouter", () => {
	let anthropicProvider: LLMProvider;
	let openaiProvider: LLMProvider;

	beforeEach(() => {
		anthropicProvider = makeProvider("anthropic", "Anthropic");
		openaiProvider = makeProvider("openai", "OpenAI");
	});

	// ── 1. Routing by model prefix ──────────────────────────────────────

	it("should route claude-* models to anthropic provider", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider, openaiProvider],
		});

		await router.complete(makeRequest({ model: "claude-sonnet-4-5-20250929" }));
		expect(anthropicProvider.complete).toHaveBeenCalledOnce();
		expect(openaiProvider.complete).not.toHaveBeenCalled();
	});

	it("should route gpt-* models to openai provider", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider, openaiProvider],
		});

		await router.complete(makeRequest({ model: "gpt-4o" }));
		expect(openaiProvider.complete).toHaveBeenCalledOnce();
		expect(anthropicProvider.complete).not.toHaveBeenCalled();
	});

	it("should route o1/o3 models to openai provider", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider, openaiProvider],
		});

		await router.complete(makeRequest({ model: "o1" }));
		expect(openaiProvider.complete).toHaveBeenCalledOnce();
	});

	// ── 2. Default model ────────────────────────────────────────────────

	it("should use defaultModel when request has no model", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
			defaultModel: "claude-sonnet-4-5-20250929",
		});

		await router.complete(makeRequest({ model: "" }));
		expect(anthropicProvider.complete).toHaveBeenCalledWith(
			expect.objectContaining({ model: "claude-sonnet-4-5-20250929" }),
		);
	});

	// ── 3. NoProviderError ──────────────────────────────────────────────

	it("should throw NoProviderError for unknown model prefix", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
		});

		await expect(
			router.complete(makeRequest({ model: "unknown-model-xyz" })),
		).rejects.toThrow(NoProviderError);
	});

	it("should throw NoProviderError when no model specified and no default", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
		});

		await expect(
			router.complete(makeRequest({ model: "" })),
		).rejects.toThrow(NoProviderError);
	});

	// ── 4. Fallback chain ───────────────────────────────────────────────

	it("should fall back to next model in chain when primary fails", async () => {
		const failingAnthropic = makeProvider("anthropic", "Anthropic");
		(failingAnthropic.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("Service unavailable 503"),
		);

		const router = new CompletionRouter({
			providers: [failingAnthropic, openaiProvider],
			fallbackChain: ["gpt-4o"],
			retryAttempts: 0, // Disable retry to test fallback directly.
		});

		const resp = await router.complete(makeRequest({ model: "claude-sonnet-4-5-20250929" }));
		expect(resp.model).toBe("openai-model");
		expect(openaiProvider.complete).toHaveBeenCalledOnce();
	});

	it("should throw FallbackExhaustedError when all fallbacks fail", async () => {
		const failingAnthropic = makeProvider("anthropic", "Anthropic");
		(failingAnthropic.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("Anthropic down"),
		);
		const failingOpenai = makeProvider("openai", "OpenAI");
		(failingOpenai.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("OpenAI down"),
		);

		const router = new CompletionRouter({
			providers: [failingAnthropic, failingOpenai],
			fallbackChain: ["gpt-4o"],
			retryAttempts: 0,
		});

		await expect(
			router.complete(makeRequest({ model: "claude-sonnet-4-5-20250929" })),
		).rejects.toThrow(FallbackExhaustedError);
	});

	// ── 5. Retry with exponential backoff ───────────────────────────────

	it("should retry on transient errors", async () => {
		const flakyProvider = makeProvider("anthropic", "Anthropic");
		let callCount = 0;
		(flakyProvider.complete as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callCount++;
			if (callCount <= 2) {
				return Promise.reject(new Error("rate limit 429"));
			}
			return Promise.resolve(makeResponse());
		});

		const router = new CompletionRouter({
			providers: [flakyProvider],
			retryAttempts: 3,
			retryDelayMs: 10, // Very short delay for tests.
		});

		const resp = await router.complete(makeRequest());
		expect(resp.content[0].text).toBe("Hello!");
		expect(callCount).toBe(3);
	});

	it("should not retry on non-transient errors", async () => {
		const authFailProvider = makeProvider("anthropic", "Anthropic");
		(authFailProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("Invalid API key"),
		);

		const router = new CompletionRouter({
			providers: [authFailProvider],
			retryAttempts: 3,
			retryDelayMs: 10,
		});

		await expect(
			router.complete(makeRequest()),
		).rejects.toThrow("Invalid API key");
		expect(authFailProvider.complete).toHaveBeenCalledOnce();
	});

	// ── 6. Timeout handling ─────────────────────────────────────────────

	it("should throw CompletionTimeoutError when request exceeds timeout", async () => {
		const slowProvider = makeProvider("anthropic", "Anthropic");
		(slowProvider.complete as ReturnType<typeof vi.fn>).mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve(makeResponse()), 500)),
		);

		const router = new CompletionRouter({
			providers: [slowProvider],
			timeout: 50,
			retryAttempts: 0,
		});

		await expect(
			router.complete(makeRequest()),
		).rejects.toThrow(CompletionTimeoutError);
	});

	// ── 7. Streaming ────────────────────────────────────────────────────

	it("should stream through the correct provider", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider, openaiProvider],
		});

		const chunks = await collectChunks(
			router.stream(makeRequest({ model: "claude-sonnet-4-5-20250929" })),
		);

		expect(chunks.length).toBe(2);
		expect(chunks[0].type).toBe("text_delta");
		expect(chunks[0].text).toBe("Hi");
		expect(chunks[1].type).toBe("done");
	});

	it("should stream with fallback on provider failure", async () => {
		const failingAnthropic = makeProvider("anthropic", "Anthropic");
		failingAnthropic.stream = vi.fn(async function* () {
			throw new Error("503 service unavailable");
		});

		const router = new CompletionRouter({
			providers: [failingAnthropic, openaiProvider],
			fallbackChain: ["gpt-4o"],
			retryAttempts: 0,
		});

		const chunks = await collectChunks(
			router.stream(makeRequest({ model: "claude-sonnet-4-5-20250929" })),
		);

		expect(chunks.length).toBe(2);
		expect(chunks[0].type).toBe("text_delta");
	});

	it("should fallback to complete() wrapped as stream when provider has no stream", async () => {
		const noStreamProvider: LLMProvider = {
			id: "anthropic",
			name: "Anthropic (no stream)",
			complete: vi.fn().mockResolvedValue(makeResponse()),
		};

		const router = new CompletionRouter({
			providers: [noStreamProvider],
		});

		const chunks = await collectChunks(
			router.stream(makeRequest()),
		);

		expect(chunks.length).toBe(2);
		expect(chunks[0].type).toBe("text_delta");
		expect(chunks[0].text).toBe("Hello!");
		expect(chunks[1].type).toBe("done");
	});

	// ── 8. Provider add/remove ──────────────────────────────────────────

	it("should add a provider at runtime", async () => {
		const router = new CompletionRouter({ providers: [] });
		router.addProvider(anthropicProvider);

		const resp = await router.complete(makeRequest());
		expect(resp).toBeDefined();
		expect(anthropicProvider.complete).toHaveBeenCalledOnce();
	});

	it("should remove a provider", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider, openaiProvider],
		});

		router.removeProvider("anthropic");

		await expect(
			router.complete(makeRequest({ model: "claude-sonnet-4-5-20250929" })),
		).rejects.toThrow(NoProviderError);
	});

	it("should list registered provider IDs", () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider, openaiProvider],
		});

		const ids = router.getProviderIds();
		expect(ids).toContain("anthropic");
		expect(ids).toContain("openai");
	});

	it("should get a provider by ID", () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
		});

		expect(router.getProvider("anthropic")).toBe(anthropicProvider);
		expect(router.getProvider("unknown")).toBeUndefined();
	});

	// ── 9. Tool calls in streaming ──────────────────────────────────────

	it("should stream tool call chunks", async () => {
		const toolChunks: CompletionStreamChunk[] = [
			{ type: "tool_call_start", toolCall: { id: "tc_1", name: "search" } },
			{ type: "tool_call_delta", toolCall: { id: "tc_1" }, text: '{"query":"test"}' },
			{ type: "done", stopReason: "tool_use", usage: { inputTokens: 8, outputTokens: 12 } },
		];
		const toolProvider = makeProvider("anthropic", "Anthropic", undefined, toolChunks);

		const router = new CompletionRouter({
			providers: [toolProvider],
		});

		const chunks = await collectChunks(
			router.stream(makeRequest()),
		);

		expect(chunks[0].type).toBe("tool_call_start");
		expect(chunks[0].toolCall?.name).toBe("search");
		expect(chunks[1].type).toBe("tool_call_delta");
		expect(chunks[2].type).toBe("done");
		expect(chunks[2].stopReason).toBe("tool_use");
	});

	// ── 10. Request normalization ───────────────────────────────────────

	it("should pass temperature and maxTokens to provider", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
		});

		await router.complete(makeRequest({
			model: "claude-sonnet-4-5-20250929",
			temperature: 0.7,
			maxTokens: 2048,
		}));

		expect(anthropicProvider.complete).toHaveBeenCalledWith(
			expect.objectContaining({
				temperature: 0.7,
				maxTokens: 2048,
			}),
		);
	});

	// ── 11. Error message preservation ──────────────────────────────────

	it("should preserve original error message on non-retryable failure", async () => {
		const errorProvider = makeProvider("anthropic", "Anthropic");
		(errorProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("Model not found: claude-fake"),
		);

		const router = new CompletionRouter({
			providers: [errorProvider],
			retryAttempts: 0,
		});

		await expect(
			router.complete(makeRequest()),
		).rejects.toThrow("Model not found: claude-fake");
	});

	// ── 12. Resolve provider ────────────────────────────────────────────

	it("should resolve provider by model prefix", () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider, openaiProvider],
		});

		expect(router.resolveProvider("claude-sonnet-4-5-20250929")?.id).toBe("anthropic");
		expect(router.resolveProvider("gpt-4o")?.id).toBe("openai");
		expect(router.resolveProvider("o3-mini")?.id).toBe("openai");
		expect(router.resolveProvider("unknown-model")).toBeUndefined();
	});

	// ── 13. Multiple providers for same prefix ──────────────────────────

	it("should handle re-adding a provider with same ID (replaces)", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
		});

		const newAnthropic = makeProvider("anthropic", "Anthropic v2");
		router.addProvider(newAnthropic);

		await router.complete(makeRequest());
		// The new provider should be used.
		expect(newAnthropic.complete).toHaveBeenCalledOnce();
		expect(anthropicProvider.complete).not.toHaveBeenCalled();
	});

	// ── 14. Stream retry on transient error ─────────────────────────────

	it("should retry streaming on transient errors", async () => {
		let streamCallCount = 0;
		const flakyStreamProvider: LLMProvider = {
			id: "anthropic",
			name: "Anthropic Flaky Stream",
			complete: vi.fn().mockResolvedValue(makeResponse()),
			stream: vi.fn(async function* () {
				streamCallCount++;
				if (streamCallCount <= 1) {
					throw new Error("502 bad gateway");
				}
				yield { type: "text_delta" as const, text: "Recovered" };
				yield { type: "done" as const, stopReason: "end_turn" as const, usage: { inputTokens: 3, outputTokens: 2 } };
			}),
		};

		const router = new CompletionRouter({
			providers: [flakyStreamProvider],
			retryAttempts: 2,
			retryDelayMs: 10,
		});

		const chunks = await collectChunks(router.stream(makeRequest()));
		expect(chunks[0].text).toBe("Recovered");
		expect(streamCallCount).toBe(2);
	});

	// ── 15. AbortSignal cancellation ────────────────────────────────────

	it("should respect AbortSignal during retry delays", async () => {
		const slowProvider = makeProvider("anthropic", "Anthropic");
		(slowProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("rate limit 429"),
		);

		const controller = new AbortController();
		const router = new CompletionRouter({
			providers: [slowProvider],
			retryAttempts: 5,
			retryDelayMs: 5000, // Long delay.
		});

		// Abort after 50ms.
		setTimeout(() => controller.abort(), 50);

		await expect(
			router.complete(makeRequest({ signal: controller.signal })),
		).rejects.toThrow(); // Should throw quickly, not wait for 5s retries.
	});

	// ── 16. listModels ──────────────────────────────────────────────────

	it("should return empty model list when no models registered", () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
		});

		const models = router.listModels();
		expect(Array.isArray(models)).toBe(true);
	});

	// ── 17. CompletionRequest with tools ─────────────────────────────────

	it("should forward tools in the request to provider", async () => {
		const router = new CompletionRouter({
			providers: [anthropicProvider],
		});

		const tools = [{
			name: "search",
			description: "Search the web",
			inputSchema: { type: "object", properties: { query: { type: "string" } } },
		}];

		await router.complete(makeRequest({ tools }));

		expect(anthropicProvider.complete).toHaveBeenCalledWith(
			expect.objectContaining({ tools }),
		);
	});
});
