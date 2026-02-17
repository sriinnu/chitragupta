import { describe, it, expect } from "vitest";
import { toPassthrough, fromPassthrough, parseAnthropicSSELine } from "../../src/converters/passthrough.js";
import type { AnthropicRequest, AnthropicResponse } from "../../src/types.js";

describe("Passthrough converter", () => {
	describe("toPassthrough", () => {
		it("returns request unchanged when model matches", () => {
			const req: AnthropicRequest = {
				model: "claude-sonnet-4-20250514",
				messages: [{ role: "user", content: "Hello" }],
				max_tokens: 1024,
			};

			const result = toPassthrough(req, "claude-sonnet-4-20250514");
			expect(result).toBe(req); // Same reference
		});

		it("overrides model when different", () => {
			const req: AnthropicRequest = {
				model: "sonnet",
				messages: [{ role: "user", content: "Hello" }],
				max_tokens: 1024,
			};

			const result = toPassthrough(req, "claude-sonnet-4-20250514");
			expect(result.model).toBe("claude-sonnet-4-20250514");
			expect(result.messages).toBe(req.messages); // Shallow copy preserves references
		});
	});

	describe("fromPassthrough", () => {
		it("returns response unchanged", () => {
			const res: AnthropicResponse = {
				id: "msg_123",
				type: "message",
				role: "assistant",
				model: "claude-sonnet-4-20250514",
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 5 },
			};

			const result = fromPassthrough(res);
			expect(result).toBe(res);
		});
	});

	describe("parseAnthropicSSELine", () => {
		it("parses valid data lines", () => {
			const event = parseAnthropicSSELine('data: {"type":"message_start","message":{"id":"msg_1"}}');
			expect(event).toEqual({ type: "message_start", message: { id: "msg_1" } });
		});

		it("returns null for non-data lines", () => {
			expect(parseAnthropicSSELine("event: message_start")).toBeNull();
			expect(parseAnthropicSSELine("")).toBeNull();
			expect(parseAnthropicSSELine(": comment")).toBeNull();
		});

		it("returns null for [DONE]", () => {
			expect(parseAnthropicSSELine("data: [DONE]")).toBeNull();
		});

		it("returns null for malformed JSON", () => {
			expect(parseAnthropicSSELine("data: {invalid}")).toBeNull();
		});
	});
});
