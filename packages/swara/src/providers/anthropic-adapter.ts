/**
 * Anthropic completion adapter.
 *
 * Wraps Anthropic's Messages API into the LLMProvider interface.
 * Uses raw `fetch()` — no SDK dependency. Handles message format
 * conversion, tool use, SSE streaming, and error mapping.
 */

import { parseSSEStream } from "../sse.js";
import type {
	LLMProvider,
	CompletionRequest,
	CompletionResponse,
	CompletionStreamChunk,
	CompletionMessage,
	CompletionContentPart,
	CompletionToolCall,
	CompletionStopReason,
	CompletionUsage,
} from "../completion-types.js";

/** Anthropic Messages API version. Override via ANTHROPIC_API_VERSION env var. */
const API_VERSION = process.env.ANTHROPIC_API_VERSION ?? "2023-06-01";
const API_URL = "https://api.anthropic.com/v1/messages";

/** Known Anthropic model prefixes for routing. */
const ANTHROPIC_MODELS = [
	"claude-sonnet-4-5-20250929",
	"claude-haiku-3-5-20241022",
	"claude-opus-4-20250514",
	"claude-3-5-sonnet-20241022",
	"claude-3-5-haiku-20241022",
	"claude-3-opus-20240229",
];

// ─── Internal Types ─────────────────────────────────────────────────────────

interface AnthropicMessage {
	role: "user" | "assistant";
	content: AnthropicContent[];
}

type AnthropicContent =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicRequestBody {
	model: string;
	messages: AnthropicMessage[];
	max_tokens: number;
	stream: boolean;
	system?: string;
	temperature?: number;
	stop_sequences?: string[];
	tools?: Array<{
		name: string;
		description: string;
		input_schema: Record<string, unknown>;
	}>;
}

// ─── Conversion Helpers ─────────────────────────────────────────────────────

/** Resolve the API key from the environment. */
function getApiKey(): string {
	const key = process.env.ANTHROPIC_API_KEY;
	if (!key) {
		throw new Error("ANTHROPIC_API_KEY environment variable is not set.");
	}
	return key;
}

/**
 * Extract plain text from a CompletionMessage's content field.
 */
function extractText(content: string | CompletionContentPart[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((p) => p.type === "text" && p.text)
		.map((p) => p.text!)
		.join("\n");
}

/**
 * Convert unified CompletionMessages into Anthropic API format.
 * Returns `{ system, messages }` since Anthropic uses a top-level system field.
 */
function convertMessages(
	msgs: CompletionMessage[],
): { system: string | undefined; messages: AnthropicMessage[] } {
	let system: string | undefined;
	const messages: AnthropicMessage[] = [];

	for (const msg of msgs) {
		switch (msg.role) {
			case "system": {
				// Anthropic uses a top-level system parameter.
				const text = extractText(msg.content);
				system = system ? `${system}\n\n${text}` : text;
				break;
			}
			case "user": {
				const content: AnthropicContent[] = [];
				if (typeof msg.content === "string") {
					content.push({ type: "text", text: msg.content });
				} else {
					for (const part of msg.content) {
						if (part.type === "text" && part.text) {
							content.push({ type: "text", text: part.text });
						} else if (part.type === "tool_result" && part.toolCallId) {
							content.push({
								type: "tool_result",
								tool_use_id: part.toolCallId,
								content: part.text ?? "",
							});
						}
					}
				}
				if (content.length > 0) {
					messages.push({ role: "user", content });
				}
				break;
			}
			case "tool": {
				// Tool results become user messages with tool_result content.
				const toolContent: AnthropicContent[] = [{
					type: "tool_result",
					tool_use_id: msg.toolCallId ?? "",
					content: extractText(msg.content),
				}];
				messages.push({ role: "user", content: toolContent });
				break;
			}
			case "assistant": {
				const content: AnthropicContent[] = [];
				if (typeof msg.content === "string") {
					content.push({ type: "text", text: msg.content });
				} else {
					for (const part of msg.content) {
						if (part.type === "text" && part.text) {
							content.push({ type: "text", text: part.text });
						} else if (part.type === "tool_call" && part.toolCallId && part.toolName) {
							content.push({
								type: "tool_use",
								id: part.toolCallId,
								name: part.toolName,
								input: part.toolInput ?? {},
							});
						}
					}
				}
				// Also add explicit toolCalls if present.
				if (msg.toolCalls) {
					for (const tc of msg.toolCalls) {
						content.push({
							type: "tool_use",
							id: tc.id,
							name: tc.name,
							input: tc.input,
						});
					}
				}
				if (content.length > 0) {
					messages.push({ role: "assistant", content });
				}
				break;
			}
		}
	}

	return { system, messages };
}

/** Build the full Anthropic request body. */
function buildRequestBody(request: CompletionRequest): AnthropicRequestBody {
	const { system, messages } = convertMessages(request.messages);

	const body: AnthropicRequestBody = {
		model: request.model,
		messages,
		max_tokens: request.maxTokens ?? 8192,
		stream: request.stream ?? false,
	};

	if (system) body.system = system;
	if (request.temperature !== undefined) body.temperature = request.temperature;
	if (request.stopSequences && request.stopSequences.length > 0) {
		body.stop_sequences = request.stopSequences;
	}

	if (request.tools && request.tools.length > 0) {
		body.tools = request.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema,
		}));
	}

	return body;
}

/** Map Anthropic stop_reason to our CompletionStopReason. */
function mapStopReason(reason: string | null | undefined): CompletionStopReason {
	switch (reason) {
		case "end_turn": return "end_turn";
		case "max_tokens": return "max_tokens";
		case "tool_use": return "tool_use";
		case "stop_sequence": return "stop_sequence";
		default: return "end_turn";
	}
}

// ─── Non-Streaming Completion ───────────────────────────────────────────────

/** Send a non-streaming completion request. */
async function complete(request: CompletionRequest): Promise<CompletionResponse> {
	const apiKey = getApiKey();
	const body = buildRequestBody({ ...request, stream: false });

	const response = await fetch(API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": API_VERSION,
		},
		body: JSON.stringify(body),
		signal: request.signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
	}

	const data = await response.json() as Record<string, unknown>;
	const content: CompletionContentPart[] = [];
	const toolCalls: CompletionToolCall[] = [];

	const blocks = data.content as Array<Record<string, unknown>> | undefined;
	if (blocks) {
		for (const block of blocks) {
			if (block.type === "text") {
				content.push({ type: "text", text: block.text as string });
			} else if (block.type === "tool_use") {
				const tc: CompletionToolCall = {
					id: block.id as string,
					name: block.name as string,
					input: block.input as Record<string, unknown>,
				};
				toolCalls.push(tc);
				content.push({
					type: "tool_call",
					toolCallId: tc.id,
					toolName: tc.name,
					toolInput: tc.input,
				});
			}
		}
	}

	const usage = data.usage as Record<string, number> | undefined;

	return {
		id: (data.id as string) ?? `anthropic-${Date.now()}`,
		model: (data.model as string) ?? request.model,
		content,
		stopReason: mapStopReason(data.stop_reason as string | undefined),
		usage: {
			inputTokens: Number(usage?.input_tokens) || 0,
			outputTokens: Number(usage?.output_tokens) || 0,
		},
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
	};
}

// ─── Streaming Completion ───────────────────────────────────────────────────

/** Stream a completion request via Anthropic's SSE Messages API. */
async function* streamCompletion(
	request: CompletionRequest,
): AsyncIterable<CompletionStreamChunk> {
	const apiKey = getApiKey();
	const body = buildRequestBody({ ...request, stream: true });

	const response = await fetch(API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": API_VERSION,
		},
		body: JSON.stringify(body),
		signal: request.signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
	}

	let stopReason: CompletionStopReason = "end_turn";
	let usage: CompletionUsage = { inputTokens: 0, outputTokens: 0 };

	// Track tool_use content blocks by index.
	const toolBlocks = new Map<number, { id: string; name: string; input: string }>();

	for await (const sseEvent of parseSSEStream(response)) {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(sseEvent.data);
		} catch {
			continue;
		}

		const eventType = sseEvent.event ?? (data.type as string);

		switch (eventType) {
			case "message_start": {
				const message = data.message as Record<string, unknown> | undefined;
				const msgUsage = message?.usage as Record<string, number> | undefined;
				if (msgUsage) {
					usage = {
						inputTokens: Number(msgUsage.input_tokens) || 0,
						outputTokens: Number(msgUsage.output_tokens) || 0,
					};
				}
				break;
			}
			case "content_block_start": {
				const index = data.index as number;
				const block = data.content_block as Record<string, unknown> | undefined;
				if (block?.type === "tool_use") {
					toolBlocks.set(index, {
						id: block.id as string,
						name: block.name as string,
						input: "",
					});
					yield {
						type: "tool_call_start",
						toolCall: { id: block.id as string, name: block.name as string },
					};
				}
				break;
			}
			case "content_block_delta": {
				const index = data.index as number;
				const delta = data.delta as Record<string, unknown> | undefined;
				if (!delta) break;

				if (delta.type === "text_delta") {
					yield { type: "text_delta", text: delta.text as string };
				} else if (delta.type === "input_json_delta") {
					const tb = toolBlocks.get(index);
					if (tb) {
						tb.input += delta.partial_json as string;
						yield {
							type: "tool_call_delta",
							toolCall: { id: tb.id, name: tb.name },
							text: delta.partial_json as string,
						};
					}
				}
				break;
			}
			case "message_delta": {
				const delta = data.delta as Record<string, unknown> | undefined;
				if (delta?.stop_reason) {
					stopReason = mapStopReason(delta.stop_reason as string);
				}
				const deltaUsage = data.usage as Record<string, number> | undefined;
				if (deltaUsage) {
					usage = {
						...usage,
						outputTokens: Number(deltaUsage.output_tokens) || usage.outputTokens,
					};
				}
				break;
			}
			case "error": {
				const err = data.error as Record<string, unknown> | undefined;
				const errMsg = (err?.message as string) ?? "Unknown Anthropic streaming error";
				throw new Error(errMsg);
			}
		}
	}

	yield { type: "done", stopReason, usage };
}

// ─── Provider Export ────────────────────────────────────────────────────────

/**
 * Create an Anthropic LLMProvider adapter.
 *
 * Uses the ANTHROPIC_API_KEY environment variable for authentication.
 * Supports both streaming and non-streaming completions.
 */
export function createAnthropicAdapter(): LLMProvider {
	return {
		id: "anthropic",
		name: "Anthropic",
		complete,
		stream: streamCompletion,
		async listModels() {
			return [...ANTHROPIC_MODELS];
		},
	};
}
