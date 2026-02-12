import { describe, it, expect } from "vitest";
import { createStreamState, processOpenAIChunk } from "../src/converters/openai.js";
import { createGeminiStreamState, processGeminiChunk } from "../src/converters/google.js";
import type { OpenAIStreamChunk, GeminiResponse } from "../src/types.js";

describe("Stream state machine", () => {
	describe("OpenAI stream", () => {
		it("handles a complete text-only stream", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			const allEvents: any[] = [];

			// Initial chunk
			allEvents.push(...processOpenAIChunk({
				id: "c1",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			}, state));

			// Text chunks
			allEvents.push(...processOpenAIChunk({
				id: "c1",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { content: "Hello " }, finish_reason: null }],
			}, state));

			allEvents.push(...processOpenAIChunk({
				id: "c1",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { content: "world!" }, finish_reason: null }],
			}, state));

			// Finish
			allEvents.push(...processOpenAIChunk({
				id: "c1",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			}, state));

			const types = allEvents.map((e) => e.type);
			expect(types).toContain("message_start");
			expect(types).toContain("ping");
			expect(types).toContain("content_block_start");
			expect(types).toContain("content_block_delta");
			expect(types).toContain("content_block_stop");
			expect(types).toContain("message_delta");
			expect(types).toContain("message_stop");

			// Verify text deltas
			const textDeltas = allEvents.filter(
				(e) => e.type === "content_block_delta" && e.delta.type === "text_delta",
			);
			expect(textDeltas).toHaveLength(2);
			expect(textDeltas[0].delta.text).toBe("Hello ");
			expect(textDeltas[1].delta.text).toBe("world!");
		});

		it("handles a tool call stream", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			const allEvents: any[] = [];

			// Initial
			allEvents.push(...processOpenAIChunk({
				id: "c2",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			}, state));

			// Tool call start
			allEvents.push(...processOpenAIChunk({
				id: "c2",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					delta: {
						tool_calls: [{
							id: "call_1",
							type: "function",
							function: { name: "read_file", arguments: "" },
						}],
					},
					finish_reason: null,
				}],
			}, state));

			// Tool call args
			allEvents.push(...processOpenAIChunk({
				id: "c2",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					delta: {
						tool_calls: [{
							id: "",
							type: "function",
							function: { name: "", arguments: '{"path":"test.ts"}' },
						}],
					},
					finish_reason: null,
				}],
			}, state));

			// Finish
			allEvents.push(...processOpenAIChunk({
				id: "c2",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
			}, state));

			const toolStart = allEvents.find(
				(e) => e.type === "content_block_start" && e.content_block?.type === "tool_use",
			);
			expect(toolStart).toBeDefined();
			expect(toolStart.content_block.id).toBe("call_1");
			expect(toolStart.content_block.name).toBe("read_file");

			const jsonDeltas = allEvents.filter(
				(e) => e.type === "content_block_delta" && e.delta.type === "input_json_delta",
			);
			expect(jsonDeltas).toHaveLength(1);
			expect(jsonDeltas[0].delta.partial_json).toBe('{"path":"test.ts"}');
		});

		it("handles text then tool call in same stream", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			const allEvents: any[] = [];

			allEvents.push(...processOpenAIChunk({
				id: "c3",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			}, state));

			// Text
			allEvents.push(...processOpenAIChunk({
				id: "c3",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { content: "Let me search." }, finish_reason: null }],
			}, state));

			// Tool
			allEvents.push(...processOpenAIChunk({
				id: "c3",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					delta: {
						tool_calls: [{
							id: "call_2",
							type: "function",
							function: { name: "search", arguments: '{"q":"test"}' },
						}],
					},
					finish_reason: null,
				}],
			}, state));

			// Should have both text block and tool block
			const blockStarts = allEvents.filter((e) => e.type === "content_block_start");
			expect(blockStarts).toHaveLength(2);
			expect(blockStarts[0].content_block.type).toBe("text");
			expect(blockStarts[1].content_block.type).toBe("tool_use");

			// Text block should be stopped before tool starts
			const stops = allEvents.filter((e) => e.type === "content_block_stop");
			expect(stops.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Gemini stream", () => {
		it("handles a complete Gemini text stream", () => {
			const state = createGeminiStreamState("claude-sonnet-4-20250514");
			const allEvents: any[] = [];

			allEvents.push(...processGeminiChunk({
				candidates: [{ content: { role: "model", parts: [{ text: "Hello " }] } }],
			}, state));

			allEvents.push(...processGeminiChunk({
				candidates: [{ content: { role: "model", parts: [{ text: "world!" }] }, finishReason: "STOP" }],
				usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
			}, state));

			const types = allEvents.map((e) => e.type);
			expect(types).toContain("message_start");
			expect(types).toContain("content_block_start");
			expect(types).toContain("content_block_delta");
			expect(types).toContain("message_stop");
		});
	});
});
