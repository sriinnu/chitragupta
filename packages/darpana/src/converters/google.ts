/**
 * Anthropic ↔ Google Gemini format converter.
 *
 * Supports both AI Studio (API key) and Vertex AI (ADC).
 */
import type {
	AnthropicRequest,
	AnthropicResponse,
	AnthropicContentBlock,
	AnthropicMessage,
	AnthropicSSEEvent,
	AnthropicDelta,
	GeminiRequest,
	GeminiResponse,
	GeminiContent,
	GeminiPart,
	GeminiToolDeclaration,
	GeminiGenerationConfig,
	ModelOverrides,
} from "../types.js";
import { extractToolResultContent } from "./shared.js";

// ─── Request: Anthropic → Gemini ───────────────────────────────────

export function toGemini(req: AnthropicRequest, _upstreamModel: string, overrides?: ModelOverrides): GeminiRequest {
	const contents: GeminiContent[] = [];

	// Convert messages
	for (const msg of req.messages) {
		const geminiContent = convertMessage(msg);
		if (geminiContent) contents.push(geminiContent);
	}

	const result: GeminiRequest = { contents };

	// System instruction
	if (req.system) {
		const systemText = typeof req.system === "string"
			? req.system
			: req.system.map((b) => b.text).join("\n\n");
		result.systemInstruction = { parts: [{ text: systemText }] };
	}

	// Generation config
	const genConfig: GeminiGenerationConfig = {};
	const maxTokens = overrides?.maxTokensCap
		? Math.min(req.max_tokens, overrides.maxTokensCap)
		: req.max_tokens;
	genConfig.maxOutputTokens = maxTokens;
	if (req.temperature !== undefined) genConfig.temperature = req.temperature;
	if (req.top_p !== undefined) genConfig.topP = req.top_p;
	if (req.top_k !== undefined) genConfig.topK = req.top_k;
	if (req.stop_sequences?.length) genConfig.stopSequences = req.stop_sequences;
	result.generationConfig = genConfig;

	// Tools
	if (req.tools?.length) {
		result.tools = [{
			functionDeclarations: req.tools.map((t) => ({
				name: t.name,
				description: t.description,
				parameters: cleanSchemaForGemini(t.input_schema),
			})),
		}];

		if (req.tool_choice) {
			if (req.tool_choice.type === "auto") {
				result.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
			} else if (req.tool_choice.type === "any") {
				result.toolConfig = { functionCallingConfig: { mode: "ANY" } };
			} else if (req.tool_choice.type === "none") {
				result.toolConfig = { functionCallingConfig: { mode: "NONE" } };
			} else if (req.tool_choice.type === "tool") {
				result.toolConfig = {
					functionCallingConfig: { mode: "ANY", allowedFunctionNames: [req.tool_choice.name] },
				};
			}
		}
	}

	return result;
}

function convertMessage(msg: AnthropicMessage): GeminiContent | null {
	const role = msg.role === "assistant" ? "model" : "user";
	const parts: GeminiPart[] = [];

	if (typeof msg.content === "string") {
		parts.push({ text: msg.content });
		return { role, parts };
	}

	for (const block of msg.content) {
		switch (block.type) {
			case "text":
				parts.push({ text: block.text });
				break;
			case "image":
				parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
				break;
			case "tool_use":
				parts.push({ functionCall: { name: block.name, args: block.input } });
				break;
			case "tool_result": {
				const text = extractToolResultContent(block.content);
				parts.push({
					functionResponse: {
						name: block.tool_use_id,
						response: { result: text },
					},
				});
				break;
			}
			case "thinking":
				// Skip thinking blocks — Gemini doesn't support them
				break;
		}
	}

	return parts.length > 0 ? { role, parts } : null;
}

/**
 * Strip Gemini-unsupported schema fields recursively.
 */
/** Gemini-supported format values. */
const GEMINI_SUPPORTED_FORMATS = new Set(["float", "double", "int32", "int64", "enum", "date-time"]);

function cleanSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
	const cleaned = { ...schema };
	delete cleaned.additionalProperties;
	delete cleaned.$schema;
	delete cleaned.default;

	// Strip unsupported format values
	if (typeof cleaned.format === "string" && !GEMINI_SUPPORTED_FORMATS.has(cleaned.format)) {
		delete cleaned.format;
	}

	// Recursively clean nested schemas
	if (cleaned.properties && typeof cleaned.properties === "object") {
		const props: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(cleaned.properties as Record<string, unknown>)) {
			props[key] = typeof val === "object" && val ? cleanSchemaForGemini(val as Record<string, unknown>) : val;
		}
		cleaned.properties = props;
	}

	if (cleaned.items && typeof cleaned.items === "object") {
		cleaned.items = cleanSchemaForGemini(cleaned.items as Record<string, unknown>);
	}

	return cleaned;
}

// ─── Response: Gemini → Anthropic ──────────────────────────────────

export function fromGemini(res: GeminiResponse, requestModel: string): AnthropicResponse {
	const candidate = res.candidates?.[0];
	const content: AnthropicContentBlock[] = [];
	let stopReason: AnthropicResponse["stop_reason"] = "end_turn";

	if (candidate) {
		for (const part of candidate.content?.parts ?? []) {
			if ("text" in part) {
				content.push({ type: "text", text: part.text });
			} else if ("functionCall" in part) {
				content.push({
					type: "tool_use",
					id: `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					name: part.functionCall.name,
					input: part.functionCall.args,
				});
			}
		}

		if (candidate.finishReason) {
			stopReason = mapGeminiFinishReason(candidate.finishReason);
		}
	}

	return {
		id: `msg_${Date.now()}`,
		type: "message",
		role: "assistant",
		model: requestModel,
		content,
		stop_reason: stopReason,
		usage: {
			input_tokens: res.usageMetadata?.promptTokenCount ?? 0,
			output_tokens: res.usageMetadata?.candidatesTokenCount ?? 0,
		},
	};
}

function mapGeminiFinishReason(reason: string): AnthropicResponse["stop_reason"] {
	switch (reason) {
		case "STOP": return "end_turn";
		case "MAX_TOKENS": return "max_tokens";
		default: return "end_turn";
	}
}

// ─── Stream: Gemini chunks → Anthropic SSE ─────────────────────────

export interface GeminiStreamState {
	model: string;
	contentBlockIndex: number;
	inTextBlock: boolean;
	inToolBlock: boolean;
	started: boolean;
	usage: { input_tokens: number; output_tokens: number };
}

export function createGeminiStreamState(requestModel: string): GeminiStreamState {
	return {
		model: requestModel,
		contentBlockIndex: -1,
		inTextBlock: false,
		inToolBlock: false,
		started: false,
		usage: { input_tokens: 0, output_tokens: 0 },
	};
}

export function processGeminiChunk(chunk: GeminiResponse, state: GeminiStreamState): AnthropicSSEEvent[] {
	const events: AnthropicSSEEvent[] = [];

	if (!state.started) {
		state.started = true;
		events.push({
			type: "message_start",
			message: {
				id: `msg_${Date.now()}`,
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

	if (chunk.usageMetadata) {
		state.usage.input_tokens = chunk.usageMetadata.promptTokenCount ?? 0;
		state.usage.output_tokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
	}

	const candidate = chunk.candidates?.[0];
	if (candidate?.content?.parts) {
		for (const part of candidate.content.parts) {
			if ("text" in part) {
				if (!state.inTextBlock) {
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
					delta: { type: "text_delta", text: part.text } as AnthropicDelta,
				});
			} else if ("functionCall" in part) {
				if (state.inTextBlock) {
					events.push({ type: "content_block_stop", index: state.contentBlockIndex });
					state.inTextBlock = false;
				}
				if (state.inToolBlock) {
					events.push({ type: "content_block_stop", index: state.contentBlockIndex });
				}
				state.contentBlockIndex++;
				state.inToolBlock = true;

				const toolId = `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
				events.push({
					type: "content_block_start",
					index: state.contentBlockIndex,
					content_block: { type: "tool_use", id: toolId, name: part.functionCall.name, input: {} },
				});
				events.push({
					type: "content_block_delta",
					index: state.contentBlockIndex,
					delta: { type: "input_json_delta", partial_json: JSON.stringify(part.functionCall.args) } as AnthropicDelta,
				});
			}
		}
	}

	if (candidate?.finishReason) {
		if (state.inTextBlock || state.inToolBlock) {
			events.push({ type: "content_block_stop", index: state.contentBlockIndex });
			state.inTextBlock = false;
			state.inToolBlock = false;
		}

		const stopReason = mapGeminiFinishReason(candidate.finishReason);
		events.push({
			type: "message_delta",
			delta: { stop_reason: stopReason as string, stop_sequence: null },
			usage: { output_tokens: state.usage.output_tokens },
		});
		events.push({ type: "message_stop" });
	}

	return events;
}

/**
 * Build the Gemini API URL for a model.
 */
export function buildGeminiUrl(model: string, stream: boolean, apiKey: string): string {
	const method = stream ? "streamGenerateContent" : "generateContent";
	const alt = stream ? "&alt=sse" : "";
	return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${apiKey}${alt}`;
}
