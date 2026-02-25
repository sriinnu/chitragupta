/**
 * OpenAI completion adapter.
 *
 * Wraps OpenAI's Chat Completions API into the LLMProvider interface.
 * Uses raw `fetch()` — no SDK dependency. Handles message format
 * conversion, tool use (function calling), SSE streaming, and error mapping.
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

const API_URL = "https://api.openai.com/v1/chat/completions";

/** Known OpenAI model identifiers for routing. */
const OPENAI_MODELS = [
	"gpt-4o",
	"gpt-4o-mini",
	"gpt-4-turbo",
	"gpt-4",
	"gpt-3.5-turbo",
	"o1",
	"o1-mini",
	"o3-mini",
];

// ─── Internal Types ─────────────────────────────────────────────────────────

interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OpenAIRequestBody {
	model: string;
	messages: OpenAIMessage[];
	stream: boolean;
	max_tokens?: number;
	temperature?: number;
	stop?: string[];
	stream_options?: { include_usage: boolean };
	tools?: Array<{
		type: "function";
		function: { name: string; description: string; parameters: Record<string, unknown> };
	}>;
}

// ─── Conversion Helpers ─────────────────────────────────────────────────────

/** Resolve the API key from the environment. */
function getApiKey(): string {
	const key = process.env.OPENAI_API_KEY;
	if (!key) {
		throw new Error("OPENAI_API_KEY environment variable is not set.");
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
 * Convert unified CompletionMessages into OpenAI Chat Completions format.
 */
function convertMessages(msgs: CompletionMessage[]): OpenAIMessage[] {
	const messages: OpenAIMessage[] = [];

	for (const msg of msgs) {
		switch (msg.role) {
			case "system": {
				messages.push({ role: "system", content: extractText(msg.content) });
				break;
			}
			case "user": {
				messages.push({ role: "user", content: extractText(msg.content) });
				break;
			}
			case "tool": {
				messages.push({
					role: "tool",
					content: extractText(msg.content),
					tool_call_id: msg.toolCallId ?? "",
				});
				break;
			}
			case "assistant": {
				const text = extractText(msg.content);
				const toolCalls: OpenAIToolCall[] = [];

				// Collect tool calls from content parts.
				if (typeof msg.content !== "string") {
					for (const part of msg.content) {
						if (part.type === "tool_call" && part.toolCallId && part.toolName) {
							toolCalls.push({
								id: part.toolCallId,
								type: "function",
								function: {
									name: part.toolName,
									arguments: JSON.stringify(part.toolInput ?? {}),
								},
							});
						}
					}
				}

				// Collect from explicit toolCalls field.
				if (msg.toolCalls) {
					for (const tc of msg.toolCalls) {
						toolCalls.push({
							id: tc.id,
							type: "function",
							function: {
								name: tc.name,
								arguments: JSON.stringify(tc.input),
							},
						});
					}
				}

				const oaiMsg: OpenAIMessage = {
					role: "assistant",
					content: text || null,
				};
				if (toolCalls.length > 0) {
					oaiMsg.tool_calls = toolCalls;
				}
				messages.push(oaiMsg);
				break;
			}
		}
	}

	return messages;
}

/** Build the full OpenAI request body. */
function buildRequestBody(request: CompletionRequest): OpenAIRequestBody {
	const messages = convertMessages(request.messages);

	const body: OpenAIRequestBody = {
		model: request.model,
		messages,
		stream: request.stream ?? false,
	};

	if (body.stream) {
		body.stream_options = { include_usage: true };
	}

	if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
	if (request.temperature !== undefined) body.temperature = request.temperature;
	if (request.stopSequences && request.stopSequences.length > 0) {
		body.stop = request.stopSequences;
	}

	if (request.tools && request.tools.length > 0) {
		body.tools = request.tools.map((t) => ({
			type: "function" as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema,
			},
		}));
	}

	return body;
}

/** Map OpenAI finish_reason to our CompletionStopReason. */
function mapStopReason(reason: string | null | undefined): CompletionStopReason {
	switch (reason) {
		case "stop": return "end_turn";
		case "length": return "max_tokens";
		case "tool_calls": return "tool_use";
		case "content_filter": return "end_turn";
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
			"Authorization": `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal: request.signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
	}

	const data = await response.json() as Record<string, unknown>;
	const choices = data.choices as Array<Record<string, unknown>> | undefined;
	const choice = choices?.[0];
	const message = choice?.message as Record<string, unknown> | undefined;

	const content: CompletionContentPart[] = [];
	const toolCalls: CompletionToolCall[] = [];

	if (message?.content && typeof message.content === "string") {
		content.push({ type: "text", text: message.content });
	}

	const rawToolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
	if (rawToolCalls) {
		for (const tc of rawToolCalls) {
			const fn = tc.function as Record<string, string>;
			let parsedInput: Record<string, unknown> = {};
			try {
				parsedInput = JSON.parse(fn.arguments) as Record<string, unknown>;
			} catch {
				parsedInput = { raw: fn.arguments };
			}
			const toolCall: CompletionToolCall = {
				id: tc.id as string,
				name: fn.name,
				input: parsedInput,
			};
			toolCalls.push(toolCall);
			content.push({
				type: "tool_call",
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				toolInput: toolCall.input,
			});
		}
	}

	const usage = data.usage as Record<string, number> | undefined;
	const finishReason = choice?.finish_reason as string | undefined;

	return {
		id: (data.id as string) ?? `openai-${Date.now()}`,
		model: (data.model as string) ?? request.model,
		content,
		stopReason: mapStopReason(finishReason),
		usage: {
			inputTokens: Number(usage?.prompt_tokens) || 0,
			outputTokens: Number(usage?.completion_tokens) || 0,
		},
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
	};
}

// ─── Streaming Completion ───────────────────────────────────────────────────

/** Stream a completion request via OpenAI's SSE Chat Completions API. */
async function* streamCompletion(
	request: CompletionRequest,
): AsyncIterable<CompletionStreamChunk> {
	const apiKey = getApiKey();
	const body = buildRequestBody({ ...request, stream: true });

	const response = await fetch(API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal: request.signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
	}

	let stopReason: CompletionStopReason = "end_turn";
	let usage: CompletionUsage = { inputTokens: 0, outputTokens: 0 };
	const accumulatedTools = new Map<number, { id: string; name: string; args: string }>();

	for await (const sseEvent of parseSSEStream(response)) {
		let chunk: Record<string, unknown>;
		try {
			chunk = JSON.parse(sseEvent.data);
		} catch {
			continue;
		}

		// Usage info (with stream_options.include_usage).
		if (chunk.usage && typeof chunk.usage === "object") {
			const u = chunk.usage as Record<string, number>;
			usage = {
				inputTokens: Number(u.prompt_tokens) || 0,
				outputTokens: Number(u.completion_tokens) || 0,
			};
		}

		const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
		if (!choices || choices.length === 0) continue;

		const choice = choices[0];
		const delta = choice.delta as Record<string, unknown> | undefined;

		if (choice.finish_reason) {
			stopReason = mapStopReason(choice.finish_reason as string);
		}

		if (!delta) continue;

		// Text content.
		if (typeof delta.content === "string" && delta.content.length > 0) {
			yield { type: "text_delta", text: delta.content };
		}

		// Tool calls (streamed incrementally).
		const toolCallDeltas = delta.tool_calls as Array<Record<string, unknown>> | undefined;
		if (toolCallDeltas) {
			for (const tc of toolCallDeltas) {
				const idx = tc.index as number;
				const existing = accumulatedTools.get(idx);

				if (!existing) {
					const fn = tc.function as Record<string, string> | undefined;
					accumulatedTools.set(idx, {
						id: (tc.id as string) ?? "",
						name: fn?.name ?? "",
						args: fn?.arguments ?? "",
					});
					yield {
						type: "tool_call_start",
						toolCall: {
							id: (tc.id as string) ?? "",
							name: fn?.name ?? "",
						},
					};
				} else {
					const fn = tc.function as Record<string, string> | undefined;
					if (fn?.arguments) {
						existing.args += fn.arguments;
						yield {
							type: "tool_call_delta",
							toolCall: { id: existing.id, name: existing.name },
							text: fn.arguments,
						};
					}
				}
			}
		}
	}

	yield { type: "done", stopReason, usage };
}

// ─── Provider Export ────────────────────────────────────────────────────────

/**
 * Create an OpenAI LLMProvider adapter.
 *
 * Uses the OPENAI_API_KEY environment variable for authentication.
 * Supports both streaming and non-streaming completions.
 */
export function createOpenAIAdapter(): LLMProvider {
	return {
		id: "openai",
		name: "OpenAI",
		complete,
		stream: streamCompletion,
		async listModels() {
			return [...OPENAI_MODELS];
		},
	};
}
