import { describe, it, expect } from "vitest";
import { toOpenAI, fromOpenAI, createStreamState, processOpenAIChunk } from "../../src/converters/openai.js";
import type { AnthropicRequest, OpenAIResponse, OpenAIStreamChunk } from "../../src/types.js";

describe("OpenAI converter", () => {
	describe("toOpenAI", () => {
		it("converts a simple text request", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hello" }],
				max_tokens: 1024,
				stream: false,
			};

			const result = toOpenAI(req, "gpt-4.1");

			expect(result.model).toBe("gpt-4.1");
			expect(result.max_tokens).toBe(1024);
			expect(result.stream).toBe(false);
			expect(result.messages).toHaveLength(1);
			expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
		});

		it("converts system message to OpenAI format", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				system: "You are helpful.",
				max_tokens: 256,
			};

			const result = toOpenAI(req, "gpt-4.1");

			expect(result.messages[0]).toEqual({ role: "system", content: "You are helpful." });
			expect(result.messages[1]).toEqual({ role: "user", content: "Hi" });
		});

		it("converts array system blocks", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				system: [{ type: "text", text: "Block 1" }, { type: "text", text: "Block 2" }],
				max_tokens: 256,
			};

			const result = toOpenAI(req, "gpt-4.1");
			expect(result.messages[0].content).toBe("Block 1\n\nBlock 2");
		});

		it("converts tool definitions", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "List files" }],
				max_tokens: 1024,
				tools: [{
					name: "list_files",
					description: "Lists files in a directory",
					input_schema: { type: "object", properties: { path: { type: "string" } } },
				}],
				tool_choice: { type: "auto" },
			};

			const result = toOpenAI(req, "gpt-4.1");

			expect(result.tools).toHaveLength(1);
			expect(result.tools![0].type).toBe("function");
			expect(result.tools![0].function.name).toBe("list_files");
			expect(result.tool_choice).toBe("auto");
		});

		it("converts tool_choice type=tool to OpenAI format", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
				tools: [{ name: "my_tool", input_schema: {} }],
				tool_choice: { type: "tool", name: "my_tool" },
			};

			const result = toOpenAI(req, "gpt-4.1");
			expect(result.tool_choice).toEqual({ type: "function", function: { name: "my_tool" } });
		});

		it("converts tool_choice type=any to required", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
				tools: [{ name: "my_tool", input_schema: {} }],
				tool_choice: { type: "any" },
			};

			const result = toOpenAI(req, "gpt-4.1");
			expect(result.tool_choice).toBe("required");
		});

		it("converts assistant message with tool_use blocks", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [
					{ role: "user", content: "List files" },
					{
						role: "assistant",
						content: [
							{ type: "text", text: "I'll list the files." },
							{ type: "tool_use", id: "toolu_123", name: "list_files", input: { path: "." } },
						],
					},
					{
						role: "user",
						content: [
							{ type: "tool_result", tool_use_id: "toolu_123", content: "file1.txt\nfile2.txt" },
						],
					},
				],
				max_tokens: 1024,
			};

			const result = toOpenAI(req, "gpt-4.1");

			// First: user message
			expect(result.messages[0].role).toBe("user");
			// Second: assistant with tool_calls
			const assistantMsg = result.messages[1];
			expect(assistantMsg.role).toBe("assistant");
			expect(assistantMsg.content).toBe("I'll list the files.");
			expect(assistantMsg.tool_calls).toHaveLength(1);
			expect(assistantMsg.tool_calls![0].id).toBe("toolu_123");
			// Third: tool result
			const toolMsg = result.messages[2];
			expect(toolMsg.role).toBe("tool");
			expect(toolMsg.tool_call_id).toBe("toolu_123");
			expect(toolMsg.content).toBe("file1.txt\nfile2.txt");
		});

		it("converts image blocks to OpenAI image_url format", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{
					role: "user",
					content: [
						{ type: "text", text: "What is this?" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
					],
				}],
				max_tokens: 256,
			};

			const result = toOpenAI(req, "gpt-4.1");
			const content = result.messages[0].content as any[];
			expect(content).toHaveLength(2);
			expect(content[1].type).toBe("image_url");
			expect(content[1].image_url.url).toBe("data:image/png;base64,abc123");
		});

		it("applies maxTokensCap from overrides", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 100000,
			};

			const result = toOpenAI(req, "gpt-4.1", { maxTokensCap: 16384 });
			expect(result.max_tokens).toBe(16384);
		});

		it("uses max_completion_tokens for o-series models", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 4096,
			};

			const result = toOpenAI(req, "o3-mini");
			expect(result.max_completion_tokens).toBe(4096);
			expect(result.max_tokens).toBeUndefined();
		});

		it("uses max_tokens for non-o-series models", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 4096,
			};

			const result = toOpenAI(req, "gpt-4.1");
			expect(result.max_tokens).toBe(4096);
			expect(result.max_completion_tokens).toBeUndefined();
		});

		it("includes stream_options when streaming", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
				stream: true,
			};

			const result = toOpenAI(req, "gpt-4.1");
			expect(result.stream).toBe(true);
			expect(result.stream_options).toEqual({ include_usage: true });
		});

		it("extracts text from tool_result with array content (filters text blocks only)", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [
					{ role: "user", content: "Do it" },
					{
						role: "assistant",
						content: [{ type: "tool_use", id: "t1", name: "my_tool", input: {} }],
					},
					{
						role: "user",
						content: [{
							type: "tool_result",
							tool_use_id: "t1",
							content: [
								{ type: "text", text: "result line 1" },
								{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
								{ type: "text", text: "result line 2" },
							],
						}],
					},
				],
				max_tokens: 1024,
			};

			const result = toOpenAI(req, "gpt-4.1");
			const toolMsg = result.messages.find((m) => m.role === "tool");
			expect(toolMsg?.content).toBe("result line 1result line 2");
		});

		it("handles tool_result with null/undefined content", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [
					{ role: "user", content: "Do it" },
					{
						role: "assistant",
						content: [{ type: "tool_use", id: "t1", name: "my_tool", input: {} }],
					},
					{
						role: "user",
						content: [{ type: "tool_result", tool_use_id: "t1" }],
					},
				],
				max_tokens: 1024,
			};

			const result = toOpenAI(req, "gpt-4.1");
			const toolMsg = result.messages.find((m) => m.role === "tool");
			expect(toolMsg?.content).toBe("");
		});

		it("skips thinking blocks in messages", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [
					{ role: "user", content: "Think about this" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "Let me think..." },
							{ type: "text", text: "Here's my answer" },
						],
					},
				],
				max_tokens: 1024,
			};

			const result = toOpenAI(req, "gpt-4.1");
			const assistantMsg = result.messages[1];
			expect(assistantMsg.content).toBe("Here's my answer");
			// Should not have any thinking-related content
			expect(assistantMsg.tool_calls).toBeUndefined();
		});

		it("passes through temperature and top_p", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
				temperature: 0.7,
				top_p: 0.9,
			};

			const result = toOpenAI(req, "gpt-4.1");
			expect(result.temperature).toBe(0.7);
			expect(result.top_p).toBe(0.9);
		});
	});

	describe("fromOpenAI", () => {
		it("converts a simple text response", () => {
			const res: OpenAIResponse = {
				id: "chatcmpl-123",
				object: "chat.completion",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					message: { role: "assistant", content: "Hello back!" },
					finish_reason: "stop",
				}],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			};

			const result = fromOpenAI(res, "claude-sonnet-4-20250514");

			expect(result.id).toBe("chatcmpl-123");
			expect(result.type).toBe("message");
			expect(result.role).toBe("assistant");
			expect(result.model).toBe("claude-sonnet-4-20250514");
			expect(result.content).toHaveLength(1);
			expect(result.content[0]).toEqual({ type: "text", text: "Hello back!" });
			expect(result.stop_reason).toBe("end_turn");
			expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
		});

		it("converts tool call response", () => {
			const res: OpenAIResponse = {
				id: "chatcmpl-456",
				object: "chat.completion",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					message: {
						role: "assistant",
						content: null,
						tool_calls: [{
							id: "call_abc",
							type: "function",
							function: { name: "search", arguments: '{"query":"test"}' },
						}],
					},
					finish_reason: "tool_calls",
				}],
				usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
			};

			const result = fromOpenAI(res, "claude-sonnet-4-20250514");

			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("tool_use");
			if (result.content[0].type === "tool_use") {
				expect(result.content[0].id).toBe("call_abc");
				expect(result.content[0].name).toBe("search");
				expect(result.content[0].input).toEqual({ query: "test" });
			}
			expect(result.stop_reason).toBe("tool_use");
		});

		it("handles empty choices", () => {
			const res: OpenAIResponse = {
				id: "chatcmpl-789",
				object: "chat.completion",
				model: "gpt-4.1",
				choices: [],
			};

			const result = fromOpenAI(res, "claude-sonnet-4-20250514");
			expect(result.content).toEqual([]);
			expect(result.stop_reason).toBe("end_turn");
		});

		it("falls back to {raw: args} when tool args JSON is invalid", () => {
			const res: OpenAIResponse = {
				id: "chatcmpl-bad-args",
				object: "chat.completion",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					message: {
						role: "assistant",
						content: null,
						tool_calls: [{
							id: "call_bad",
							type: "function",
							function: { name: "my_tool", arguments: "not valid json{{{" },
						}],
					},
					finish_reason: "tool_calls",
				}],
			};

			const result = fromOpenAI(res, "claude-sonnet-4-20250514");
			expect(result.content[0].type).toBe("tool_use");
			if (result.content[0].type === "tool_use") {
				expect(result.content[0].input).toEqual({ raw: "not valid json{{{" });
			}
		});

		it("maps length finish_reason to max_tokens", () => {
			const res: OpenAIResponse = {
				id: "chatcmpl-len",
				object: "chat.completion",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					message: { role: "assistant", content: "Truncated..." },
					finish_reason: "length",
				}],
			};

			const result = fromOpenAI(res, "claude-sonnet-4-20250514");
			expect(result.stop_reason).toBe("max_tokens");
		});
	});

	describe("stream processing", () => {
		it("emits message_start on first chunk", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			const chunk: OpenAIStreamChunk = {
				id: "chatcmpl-stream",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			};

			const events = processOpenAIChunk(chunk, state);

			expect(events[0].type).toBe("message_start");
			expect(events[1].type).toBe("ping");
		});

		it("processes text delta chunks", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			// First chunk to start
			processOpenAIChunk({
				id: "chatcmpl-s",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			}, state);

			// Text delta chunk
			const events = processOpenAIChunk({
				id: "chatcmpl-s",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
			}, state);

			// Should have content_block_start + content_block_delta
			const blockStart = events.find((e) => e.type === "content_block_start");
			const blockDelta = events.find((e) => e.type === "content_block_delta");

			expect(blockStart).toBeDefined();
			expect(blockDelta).toBeDefined();
			if (blockDelta?.type === "content_block_delta") {
				expect(blockDelta.delta).toEqual({ type: "text_delta", text: "Hello" });
			}
		});

		it("processes tool call chunks", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			processOpenAIChunk({
				id: "chatcmpl-t",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			}, state);

			const events = processOpenAIChunk({
				id: "chatcmpl-t",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{
					index: 0,
					delta: {
						tool_calls: [{
							id: "call_1",
							type: "function",
							function: { name: "search", arguments: '{"q":' },
						}],
					},
					finish_reason: null,
				}],
			}, state);

			const blockStart = events.find((e) => e.type === "content_block_start");
			expect(blockStart).toBeDefined();
			if (blockStart?.type === "content_block_start") {
				expect(blockStart.content_block.type).toBe("tool_use");
			}
		});

		it("emits message_stop on finish_reason", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			processOpenAIChunk({
				id: "c",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
			}, state);
			processOpenAIChunk({
				id: "c",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
			}, state);

			const events = processOpenAIChunk({
				id: "c",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			}, state);

			const stopEvent = events.find((e) => e.type === "content_block_stop");
			const deltaEvent = events.find((e) => e.type === "message_delta");
			const messageStop = events.find((e) => e.type === "message_stop");

			expect(stopEvent).toBeDefined();
			expect(deltaEvent).toBeDefined();
			expect(messageStop).toBeDefined();
			if (deltaEvent?.type === "message_delta") {
				expect(deltaEvent.delta.stop_reason).toBe("end_turn");
			}
		});

		it("includes stop_sequence: null in message_delta", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			processOpenAIChunk({
				id: "sq",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
			}, state);

			const events = processOpenAIChunk({
				id: "sq",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			}, state);

			const deltaEvent = events.find((e) => e.type === "message_delta");
			expect(deltaEvent).toBeDefined();
			if (deltaEvent?.type === "message_delta") {
				expect(deltaEvent.delta.stop_sequence).toBeNull();
			}
		});

		it("tracks usage from chunks", () => {
			const state = createStreamState("claude-sonnet-4-20250514");
			processOpenAIChunk({
				id: "u",
				object: "chat.completion.chunk",
				model: "gpt-4.1",
				choices: [],
				usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
			}, state);

			expect(state.usage.input_tokens).toBe(50);
			expect(state.usage.output_tokens).toBe(25);
		});
	});
});
