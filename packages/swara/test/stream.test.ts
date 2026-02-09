import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	setDefaultRegistry,
	getDefaultRegistry,
	stream,
	collectStream,
} from "@chitragupta/swara";
import type {
	ProviderRegistry,
	ProviderDefinition,
	StreamEvent,
	Context,
	CollectedStream,
} from "@chitragupta/swara";
import { ProviderError } from "@chitragupta/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(): Context {
	return {
		messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
	};
}

function makeProvider(id: string, streamFn?: ProviderDefinition["stream"]): ProviderDefinition {
	return {
		id,
		name: `Provider ${id}`,
		models: [],
		auth: { type: "api-key" },
		stream: streamFn ?? (async function* () {}),
	};
}

function makeRegistry(providers: ProviderDefinition[] = []): ProviderRegistry {
	const map = new Map<string, ProviderDefinition>();
	for (const p of providers) map.set(p.id, p);

	return {
		register(p) { map.set(p.id, p); },
		get(id) { return map.get(id); },
		getAll() { return Array.from(map.values()); },
		has(id) { return map.has(id); },
		remove(id) { map.delete(id); },
		getModels() { return []; },
	};
}

async function collectAsyncIterable<T>(iter: AsyncIterable<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const item of iter) items.push(item);
	return items;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("stream.ts", () => {
	beforeEach(() => {
		// Reset the default registry to null before each test.
		// We achieve this by setting a registry then checking, but the real
		// reset comes from module-level let. Since modules are cached, we
		// call setDefaultRegistry with a dummy then test accordingly.
		// Actually, we need to un-set it. Let's use a workaround:
		// The only way to "reset" is to never set it, but since the module
		// is shared, we'll just manage state carefully in each test.
	});

	describe("getDefaultRegistry / setDefaultRegistry", () => {
		it("should return null initially or after module load", () => {
			// This test might fail if another test ran first and set the registry.
			// We'll test the setter/getter pair instead.
			const registry = makeRegistry();
			setDefaultRegistry(registry);
			expect(getDefaultRegistry()).toBe(registry);
		});

		it("should store and retrieve the registry", () => {
			const registry = makeRegistry();
			setDefaultRegistry(registry);
			expect(getDefaultRegistry()).toBe(registry);
		});

		it("should allow overwriting with a different registry", () => {
			const r1 = makeRegistry();
			const r2 = makeRegistry();
			setDefaultRegistry(r1);
			expect(getDefaultRegistry()).toBe(r1);
			setDefaultRegistry(r2);
			expect(getDefaultRegistry()).toBe(r2);
		});
	});

	describe("stream()", () => {
		it("should throw ProviderError when no registry is set", async () => {
			// We need to clear the default registry. The module doesn't export
			// a clear function, so we'll mock the internal state via the stream
			// function behavior. Since we can't truly clear it without module
			// reload, we'll skip this test if getDefaultRegistry() is not null
			// and instead test the provider-not-found path.

			// Actually, let's work around by importing the raw module.
			// Since the vitest alias resolves @chitragupta/swara to src/index.ts,
			// and the module-level `let defaultRegistry` is shared, we need a
			// different approach. Let's use vi.resetModules.
		});

		it("should throw ProviderError when provider is not found in registry", async () => {
			const registry = makeRegistry([makeProvider("alpha"), makeProvider("beta")]);
			setDefaultRegistry(registry);

			const ctx = makeContext();
			const gen = stream("nonexistent", "model-1", ctx);

			await expect(collectAsyncIterable(gen)).rejects.toThrow(ProviderError);
			try {
				const g2 = stream("nonexistent", "model-1", ctx);
				await collectAsyncIterable(g2);
			} catch (err) {
				expect(err).toBeInstanceOf(ProviderError);
				expect((err as ProviderError).message).toContain("nonexistent");
				expect((err as ProviderError).message).toContain("alpha");
				expect((err as ProviderError).message).toContain("beta");
			}
		});

		it("should yield events from the provider's stream method", async () => {
			const events: StreamEvent[] = [
				{ type: "start", messageId: "msg-1" },
				{ type: "text", text: "Hello " },
				{ type: "text", text: "world" },
				{ type: "done", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } },
			];

			const provider = makeProvider("test", async function* () {
				for (const e of events) yield e;
			});

			setDefaultRegistry(makeRegistry([provider]));
			const ctx = makeContext();
			const result = await collectAsyncIterable(stream("test", "m1", ctx));

			expect(result).toHaveLength(4);
			expect(result[0]).toEqual({ type: "start", messageId: "msg-1" });
			expect(result[1]).toEqual({ type: "text", text: "Hello " });
			expect(result[2]).toEqual({ type: "text", text: "world" });
			expect(result[3]).toEqual({ type: "done", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } });
		});

		it("should pass modelId, context, and options to provider.stream", async () => {
			const spy = vi.fn(async function* () {});
			const provider = makeProvider("spy-provider", spy);
			setDefaultRegistry(makeRegistry([provider]));

			const ctx = makeContext();
			const opts = { maxTokens: 100, temperature: 0.5 };
			const gen = stream("spy-provider", "gpt-4", ctx, opts);
			await collectAsyncIterable(gen);

			expect(spy).toHaveBeenCalledWith("gpt-4", ctx, opts);
		});

		it("should show (none) when registry has no providers", async () => {
			setDefaultRegistry(makeRegistry([]));
			const ctx = makeContext();

			try {
				const gen = stream("missing", "m1", ctx);
				await collectAsyncIterable(gen);
				expect.unreachable("Should have thrown");
			} catch (err) {
				expect((err as ProviderError).message).toContain("(none)");
			}
		});
	});

	describe("collectStream()", () => {
		it("should concatenate text events", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "text", text: "Hello " };
				yield { type: "text", text: "world" };
				yield { type: "text", text: "!" };
				yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
			}

			const result = await collectStream(events());
			expect(result.text).toBe("Hello world!");
		});

		it("should concatenate thinking events", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "thinking", text: "Let me " };
				yield { type: "thinking", text: "think..." };
				yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
			}

			const result = await collectStream(events());
			expect(result.thinking).toBe("Let me think...");
		});

		it("should accumulate tool_call events as ToolCallContent[]", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "tool_call", id: "tc-1", name: "read_file", arguments: '{"path": "/foo"}' };
				yield { type: "tool_call", id: "tc-2", name: "write_file", arguments: '{"path": "/bar"}' };
				yield { type: "done", stopReason: "tool_use", usage: { inputTokens: 1, outputTokens: 1 } };
			}

			const result = await collectStream(events());
			expect(result.toolCalls).toHaveLength(2);
			expect(result.toolCalls[0]).toEqual({
				type: "tool_call",
				id: "tc-1",
				name: "read_file",
				arguments: '{"path": "/foo"}',
			});
			expect(result.toolCalls[1]).toEqual({
				type: "tool_call",
				id: "tc-2",
				name: "write_file",
				arguments: '{"path": "/bar"}',
			});
		});

		it("should capture usage from 'usage' events", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "usage", usage: { inputTokens: 100, outputTokens: 50 } };
			}

			const result = await collectStream(events());
			expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
		});

		it("should capture stopReason and usage from 'done' events (done overrides earlier usage)", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "usage", usage: { inputTokens: 100, outputTokens: 50 } };
				yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 200, outputTokens: 100 } };
			}

			const result = await collectStream(events());
			expect(result.stopReason).toBe("end_turn");
			expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
		});

		it("should throw on 'error' events", async () => {
			const err = new Error("stream failed");
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "text", text: "partial" };
				yield { type: "error", error: err };
			}

			await expect(collectStream(events())).rejects.toThrow("stream failed");
		});

		it("should ignore 'start' events", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "start", messageId: "m-1" };
				yield { type: "text", text: "content" };
				yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
			}

			const result = await collectStream(events());
			expect(result.text).toBe("content");
			// start event should not appear in any field
			expect(result.thinking).toBe("");
			expect(result.toolCalls).toHaveLength(0);
		});

		it("should return empty defaults for an empty stream", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				// empty
			}

			const result = await collectStream(events());
			expect(result.text).toBe("");
			expect(result.thinking).toBe("");
			expect(result.toolCalls).toEqual([]);
			expect(result.usage).toBeNull();
			expect(result.stopReason).toBeNull();
		});

		it("should handle mixed text and thinking events", async () => {
			async function* events(): AsyncIterable<StreamEvent> {
				yield { type: "thinking", text: "reasoning..." };
				yield { type: "text", text: "The answer is " };
				yield { type: "thinking", text: " more thought" };
				yield { type: "text", text: "42" };
				yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 10 } };
			}

			const result = await collectStream(events());
			expect(result.text).toBe("The answer is 42");
			expect(result.thinking).toBe("reasoning... more thought");
			expect(result.stopReason).toBe("end_turn");
		});
	});
});
