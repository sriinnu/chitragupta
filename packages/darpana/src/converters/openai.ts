/**
 * Anthropic ↔ OpenAI format converter.
 *
 * Covers: OpenAI, Groq, DeepSeek, Mistral, Together, OpenRouter, Ollama, vLLM, LM Studio.
 */
import type {
	AnthropicRequest,
	AnthropicResponse,
	AnthropicContentBlock,
	AnthropicMessage,
	AnthropicSSEEvent,
	AnthropicDelta,
	AnthropicToolUseBlock,
	OpenAIRequest,
	OpenAIResponse,
	OpenAIMessage,
	OpenAIContentPart,
	OpenAIToolCall,
	OpenAITool,
	OpenAIStreamChunk,
	ModelOverrides,
} from "../types.js";

// ─── Request: Anthropic → OpenAI ───────────────────────────────────

export function toOpenAI(req: AnthropicRequest, upstreamModel: string, overrides?: ModelOverrides): OpenAIRequest {
	const messages: OpenAIMessage[] = [];

	// System message
	if (req.system) {
		const systemText = typeof req.system === "string"
			? req.system
			: req.system.map((b) => b.text).join("\n\n");
		messages.push({ role: "system", content: systemText });
	}

	// Convert messages
	for (const msg of req.messages) {
		const converted = convertMessage(msg);
		// A single Anthropic message may produce multiple OpenAI messages (tool results)
		if (Array.isArray(converted)) {
			messages.push(...converted);
		} else {
			messages.push(converted);
		}
	}

	const maxTokens = overrides?.maxTokensCap
		? Math.min(req.max_tokens, overrides.maxTokensCap)
		: req.max_tokens;

	// o-series models use max_completion_tokens instead of max_tokens
	const isOSeries = /^o[0-9]/.test(upstreamModel);

	const result: OpenAIRequest = {
		model: upstreamModel,
		messages,
		stream: req.stream ?? false,
	};

	if (isOSeries) {
		result.max_completion_tokens = maxTokens;
	} else {
		result.max_tokens = maxTokens;
	}

	if (req.stream) {
		result.stream_options = { include_usage: true };
	}

	if (req.temperature !== undefined) result.temperature = req.temperature;
	if (req.top_p !== undefined) result.top_p = req.top_p;
	if (req.stop_sequences?.length) result.stop = req.stop_sequences;

	// Tools
	if (req.tools?.length) {
		result.tools = req.tools.map((t): OpenAITool => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema,
			},
		}));

		if (req.tool_choice) {
			if (req.tool_choice.type === "auto") result.tool_choice = "auto";
			else if (req.tool_choice.type === "any") result.tool_choice = "required";
			else if (req.tool_choice.type === "none") result.tool_choice = "none";
			else if (req.tool_choice.type === "tool") {
				result.tool_choice = {
					type: "function",
					function: { name: req.tool_choice.name },
				};
			}
		}
	}

	return result;
}

function convertMessage(msg: AnthropicMessage): OpenAIMessage | OpenAIMessage[] {
	if (typeof msg.content === "string") {
		return { role: msg.role, content: msg.content };
	}

	// Filter out thinking blocks — OpenAI doesn't support them
	const blocks = msg.content.filter((b) => b.type !== "thinking");

	// Check if this contains tool_result blocks (these become separate "tool" messages in OpenAI)
	const toolResults = blocks.filter((b) => b.type === "tool_result");
	const otherBlocks = blocks.filter((b) => b.type !== "tool_result");

	const messages: OpenAIMessage[] = [];

	// Non-tool-result content
	if (otherBlocks.length > 0) {
		if (msg.role === "assistant") {
			// Assistant messages with tool_use become message + tool_calls
			const textParts = otherBlocks.filter((b) => b.type === "text");
			const toolUses = otherBlocks.filter((b) => b.type === "tool_use") as AnthropicToolUseBlock[];

			const assistantMsg: OpenAIMessage = { role: "assistant" };

			if (textParts.length > 0) {
				assistantMsg.content = textParts.map((b) => (b as { text: string }).text).join("");
			} else {
				assistantMsg.content = null;
			}

			if (toolUses.length > 0) {
				assistantMsg.tool_calls = toolUses.map((t): OpenAIToolCall => ({
					id: t.id,
					type: "function",
					function: { name: t.name, arguments: JSON.stringify(t.input) },
				}));
			}

			messages.push(assistantMsg);
		} else {
			// User messages — convert content blocks to OpenAI parts
			const parts: OpenAIContentPart[] = [];
			for (const block of otherBlocks) {
				if (block.type === "text") {
					parts.push({ type: "text", text: block.text });
				} else if (block.type === "image") {
					parts.push({
						type: "image_url",
						image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
					});
				}
			}
			messages.push({ role: "user", content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts });
		}
	}

	// Tool results become "tool" role messages in OpenAI
	for (const block of toolResults) {
		if (block.type !== "tool_result") continue;
		messages.push({
			role: "tool",
			tool_call_id: block.tool_use_id,
			content: extractToolResultContent(block.content),
		});
	}

	return messages.length === 1 ? messages[0] : messages;
}

// ─── Response: OpenAI → Anthropic ──────────────────────────────────

export function fromOpenAI(res: OpenAIResponse, requestModel: string): AnthropicResponse {
	const choice = res.choices[0];
	if (!choice) {
		return {
			id: res.id,
			type: "message",
			role: "assistant",
			model: requestModel,
			content: [],
			stop_reason: "end_turn",
			usage: { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 },
		};
	}

	const content: AnthropicContentBlock[] = [];

	// Text content
	if (choice.message.content) {
		content.push({ type: "text", text: choice.message.content as string });
	}

	// Tool calls
	if (choice.message.tool_calls) {
		for (const tc of choice.message.tool_calls) {
			content.push({
				type: "tool_use",
				id: tc.id,
				name: tc.function.name,
				input: safeJsonParse(tc.function.arguments),
			});
		}
	}

	return {
		id: res.id,
		type: "message",
		role: "assistant",
		model: requestModel,
		content,
		stop_reason: mapFinishReason(choice.finish_reason),
		usage: {
			input_tokens: res.usage?.prompt_tokens ?? 0,
			output_tokens: res.usage?.completion_tokens ?? 0,
		},
	};
}

function mapFinishReason(reason: string | null): AnthropicResponse["stop_reason"] {
	switch (reason) {
		case "stop": return "end_turn";
		case "length": return "max_tokens";
		case "tool_calls": return "tool_use";
		default: return "end_turn";
	}
}

function safeJsonParse(s: string): Record<string, unknown> {
	try { return JSON.parse(s); }
	catch { return { raw: s }; }
}

/**
 * Extract text content from a tool_result block's content field.
 * Handles: string, null/undefined, array of content blocks, dict/object.
 */
function extractToolResultContent(content: unknown): string {
	if (content == null) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((b: Record<string, unknown>) => b.type === "text")
			.map((b: Record<string, unknown>) => (b as { text: string }).text)
			.join("");
	}
	if (typeof content === "object") return JSON.stringify(content);
	return String(content);
}

// ─── Stream: OpenAI chunks → Anthropic SSE events ──────────────────

export interface OpenAIStreamState {
	id: string;
	model: string;
	contentBlockIndex: number;
	inTextBlock: boolean;
	inToolBlock: boolean;
	currentToolId: string;
	currentToolName: string;
	currentToolArgs: string;
	usage: { input_tokens: number; output_tokens: number };
	started: boolean;
}

export function createStreamState(requestModel: string): OpenAIStreamState {
	return {
		id: "",
		model: requestModel,
		contentBlockIndex: -1,
		inTextBlock: false,
		inToolBlock: false,
		currentToolId: "",
		currentToolName: "",
		currentToolArgs: "",
		usage: { input_tokens: 0, output_tokens: 0 },
		started: false,
	};
}

export function processOpenAIChunk(chunk: OpenAIStreamChunk, state: OpenAIStreamState): AnthropicSSEEvent[] {
	const events: AnthropicSSEEvent[] = [];

	if (!state.id && chunk.id) state.id = chunk.id;

	// Emit message_start on first chunk
	if (!state.started) {
		state.started = true;
		events.push({
			type: "message_start",
			message: {
				id: state.id || `msg_${Date.now()}`,
				type: "message",
				role: "assistant",
				model: state.model,
				content: [],
				stop_reason: null,
				usage: { input_tokens: 0, output_tokens: 0 },
			},
		});
		events.push({ type: "ping" });
	}

	if (chunk.usage) {
		state.usage.input_tokens = chunk.usage.prompt_tokens ?? state.usage.input_tokens;
		state.usage.output_tokens = chunk.usage.completion_tokens ?? state.usage.output_tokens;
	}

	const choice = chunk.choices?.[0];
	if (!choice) return events;

	const delta = choice.delta;

	// Text content delta
	if (delta.content) {
		if (!state.inTextBlock) {
			// Close any open tool block
			if (state.inToolBlock) {
				events.push({ type: "content_block_stop", index: state.contentBlockIndex });
				state.inToolBlock = false;
			}
			state.contentBlockIndex++;
			state.inTextBlock = true;
			events.push({
				type: "content_block_start",
				index: state.contentBlockIndex,
				content_block: { type: "text", text: "" },
			});
		}
		events.push({
			type: "content_block_delta",
			index: state.contentBlockIndex,
			delta: { type: "text_delta", text: delta.content } as AnthropicDelta,
		});
	}

	// Tool call deltas
	if (delta.tool_calls) {
		// Close text block if open
		if (state.inTextBlock) {
			events.push({ type: "content_block_stop", index: state.contentBlockIndex });
			state.inTextBlock = false;
		}

		for (const tc of delta.tool_calls) {
			if (tc.id) {
				// New tool call — close previous if open
				if (state.inToolBlock) {
					events.push({ type: "content_block_stop", index: state.contentBlockIndex });
				}
				state.contentBlockIndex++;
				state.inToolBlock = true;
				state.currentToolId = tc.id;
				state.currentToolName = tc.function?.name ?? "";
				state.currentToolArgs = tc.function?.arguments ?? "";

				events.push({
					type: "content_block_start",
					index: state.contentBlockIndex,
					content_block: {
						type: "tool_use",
						id: tc.id,
						name: state.currentToolName,
						input: {},
					},
				});

				if (state.currentToolArgs) {
					events.push({
						type: "content_block_delta",
						index: state.contentBlockIndex,
						delta: { type: "input_json_delta", partial_json: state.currentToolArgs } as AnthropicDelta,
					});
				}
			} else if (tc.function?.arguments) {
				// Continuation of current tool args
				state.currentToolArgs += tc.function.arguments;
				events.push({
					type: "content_block_delta",
					index: state.contentBlockIndex,
					delta: { type: "input_json_delta", partial_json: tc.function.arguments } as AnthropicDelta,
				});
			}
		}
	}

	// Finish reason
	if (choice.finish_reason) {
		// Close any open block
		if (state.inTextBlock || state.inToolBlock) {
			events.push({ type: "content_block_stop", index: state.contentBlockIndex });
			state.inTextBlock = false;
			state.inToolBlock = false;
		}

		events.push({
			type: "message_delta",
			delta: { stop_reason: mapFinishReason(choice.finish_reason) as string, stop_sequence: null },
			usage: { output_tokens: state.usage.output_tokens },
		});
		events.push({ type: "message_stop" });
	}

	return events;
}
