import { describe, it, expect } from "vitest";
import { toGemini, fromGemini, buildGeminiUrl, createGeminiStreamState, processGeminiChunk } from "../../src/converters/google.js";
import type { AnthropicRequest, GeminiResponse } from "../../src/types.js";

describe("Google Gemini converter", () => {
	describe("toGemini", () => {
		it("converts a simple text request", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hello" }],
				max_tokens: 1024,
			};

			const result = toGemini(req, "gemini-2.5-pro");

			expect(result.contents).toHaveLength(1);
			expect(result.contents[0].role).toBe("user");
			expect(result.contents[0].parts).toEqual([{ text: "Hello" }]);
			expect(result.generationConfig?.maxOutputTokens).toBe(1024);
		});

		it("converts system instruction", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				system: "You are helpful.",
				max_tokens: 256,
			};

			const result = toGemini(req, "gemini-2.5-pro");
			expect(result.systemInstruction?.parts).toEqual([{ text: "You are helpful." }]);
		});

		it("converts tool definitions", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Search" }],
				max_tokens: 1024,
				tools: [{
					name: "search",
					description: "Search the web",
					input_schema: {
						type: "object",
						properties: { query: { type: "string" } },
						additionalProperties: false,
					},
				}],
				tool_choice: { type: "auto" },
			};

			const result = toGemini(req, "gemini-2.5-pro");

			expect(result.tools).toHaveLength(1);
			expect(result.tools![0].functionDeclarations[0].name).toBe("search");
			// additionalProperties should be stripped
			expect(result.tools![0].functionDeclarations[0].parameters).not.toHaveProperty("additionalProperties");
			expect(result.toolConfig?.functionCallingConfig?.mode).toBe("AUTO");
		});

		it("converts tool_choice type=tool to Gemini ANY + allowedFunctionNames", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
				tools: [{ name: "my_tool", input_schema: {} }],
				tool_choice: { type: "tool", name: "my_tool" },
			};

			const result = toGemini(req, "gemini-2.5-pro");
			expect(result.toolConfig?.functionCallingConfig?.mode).toBe("ANY");
			expect(result.toolConfig?.functionCallingConfig?.allowedFunctionNames).toEqual(["my_tool"]);
		});

		it("converts assistant tool_use to functionCall", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [
					{ role: "user", content: "Search for cats" },
					{
						role: "assistant",
						content: [{ type: "tool_use", id: "t1", name: "search", input: { query: "cats" } }],
					},
					{
						role: "user",
						content: [{ type: "tool_result", tool_use_id: "t1", content: "Found 10 cats" }],
					},
				],
				max_tokens: 1024,
			};

			const result = toGemini(req, "gemini-2.5-pro");

			expect(result.contents).toHaveLength(3);
			// Assistant message should have functionCall part
			const assistantParts = result.contents[1].parts;
			expect(assistantParts[0]).toHaveProperty("functionCall");
			// Tool result should have functionResponse part
			const toolParts = result.contents[2].parts;
			expect(toolParts[0]).toHaveProperty("functionResponse");
		});

		it("converts image blocks to inlineData", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{
					role: "user",
					content: [
						{ type: "text", text: "What is this?" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
					],
				}],
				max_tokens: 256,
			};

			const result = toGemini(req, "gemini-2.5-pro");
			expect(result.contents[0].parts).toHaveLength(2);
			expect(result.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "abc" } });
		});

		it("applies maxTokensCap", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 100000,
			};

			const result = toGemini(req, "gemini-2.5-pro", { maxTokensCap: 8192 });
			expect(result.generationConfig?.maxOutputTokens).toBe(8192);
		});

		it("strips default and unsupported format fields from schema", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
				tools: [{
					name: "my_tool",
					description: "A tool",
					input_schema: {
						type: "object",
						properties: {
							name: { type: "string", default: "foo", format: "uri" },
							count: { type: "integer", format: "int32", default: 0 },
						},
						additionalProperties: false,
						$schema: "http://json-schema.org/draft-07/schema#",
					},
				}],
			};

			const result = toGemini(req, "gemini-2.5-pro");
			const params = result.tools![0].functionDeclarations[0].parameters!;
			expect(params).not.toHaveProperty("additionalProperties");
			expect(params).not.toHaveProperty("$schema");
			expect(params).not.toHaveProperty("default");
			const props = params.properties as Record<string, Record<string, unknown>>;
			// "uri" is not a supported Gemini format — should be stripped
			expect(props.name).not.toHaveProperty("format");
			expect(props.name).not.toHaveProperty("default");
			// "int32" is a supported Gemini format — should be kept
			expect(props.count.format).toBe("int32");
			expect(props.count).not.toHaveProperty("default");
		});

		it("extracts text from tool_result array content (filters text blocks)", () => {
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
								{ type: "text", text: "line 1" },
								{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
								{ type: "text", text: "line 2" },
							],
						}],
					},
				],
				max_tokens: 1024,
			};

			const result = toGemini(req, "gemini-2.5-pro");
			const toolMsg = result.contents[2];
			const funcResp = toolMsg.parts[0] as { functionResponse: { response: { result: string } } };
			expect(funcResp.functionResponse.response.result).toBe("line 1line 2");
		});

		it("skips thinking blocks", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Let me think..." },
						{ type: "text", text: "Answer" },
					],
				}],
				max_tokens: 256,
			};

			const result = toGemini(req, "gemini-2.5-pro");
			expect(result.contents[0].parts).toHaveLength(1);
			expect(result.contents[0].parts[0]).toEqual({ text: "Answer" });
		});

		it("passes temperature, topP, topK, stopSequences", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hi" }],
				max_tokens: 256,
				temperature: 0.5,
				top_p: 0.8,
				top_k: 40,
				stop_sequences: ["STOP"],
			};

			const result = toGemini(req, "gemini-2.5-pro");
			expect(result.generationConfig?.temperature).toBe(0.5);
			expect(result.generationConfig?.topP).toBe(0.8);
			expect(result.generationConfig?.topK).toBe(40);
			expect(result.generationConfig?.stopSequences).toEqual(["STOP"]);
		});
	});

	describe("fromGemini", () => {
		it("converts a simple text response", () => {
			const res: GeminiResponse = {
				candidates: [{
					content: { role: "model", parts: [{ text: "Hello!" }] },
					finishReason: "STOP",
				}],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
			};

			const result = fromGemini(res, "claude-sonnet-4-20250514");

			expect(result.type).toBe("message");
			expect(result.role).toBe("assistant");
			expect(result.content).toHaveLength(1);
			expect(result.content[0]).toEqual({ type: "text", text: "Hello!" });
			expect(result.stop_reason).toBe("end_turn");
			expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
		});

		it("converts function call response", () => {
			const res: GeminiResponse = {
				candidates: [{
					content: {
						role: "model",
						parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
					},
				}],
			};

			const result = fromGemini(res, "claude-sonnet-4-20250514");
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("tool_use");
		});

		it("maps MAX_TOKENS finish reason", () => {
			const res: GeminiResponse = {
				candidates: [{
					content: { role: "model", parts: [{ text: "Truncated" }] },
					finishReason: "MAX_TOKENS",
				}],
			};

			const result = fromGemini(res, "claude-sonnet-4-20250514");
			expect(result.stop_reason).toBe("max_tokens");
		});
	});

	describe("buildGeminiUrl", () => {
		it("builds non-streaming URL", () => {
			const url = buildGeminiUrl("gemini-2.5-pro", false, "test-key");
			expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=test-key");
		});

		it("builds streaming URL with alt=sse", () => {
			const url = buildGeminiUrl("gemini-2.5-flash", true, "test-key");
			expect(url).toContain("streamGenerateContent");
			expect(url).toContain("alt=sse");
		});
	});

	describe("stream processing", () => {
		it("emits message_start on first chunk", () => {
			const state = createGeminiStreamState("claude-sonnet-4-20250514");
			const chunk: GeminiResponse = {
				candidates: [{
					content: { role: "model", parts: [{ text: "Hi" }] },
				}],
			};

			const events = processGeminiChunk(chunk, state);

			expect(events[0].type).toBe("message_start");
			expect(events[1].type).toBe("ping");
		});

		it("processes text content chunks", () => {
			const state = createGeminiStreamState("claude-sonnet-4-20250514");
			const events = processGeminiChunk({
				candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] } }],
			}, state);

			const blockStart = events.find((e) => e.type === "content_block_start");
			const blockDelta = events.find((e) => e.type === "content_block_delta");
			expect(blockStart).toBeDefined();
			expect(blockDelta).toBeDefined();
		});

		it("emits message_stop on finishReason", () => {
			const state = createGeminiStreamState("claude-sonnet-4-20250514");
			processGeminiChunk({
				candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }],
			}, state);

			const events = processGeminiChunk({
				candidates: [{ content: { role: "model", parts: [{ text: "!" }] }, finishReason: "STOP" }],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
			}, state);

			const messageStop = events.find((e) => e.type === "message_stop");
			expect(messageStop).toBeDefined();
		});
	});
});
