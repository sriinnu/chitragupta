/**
 * OpenAI provider implementation.
 *
 * Uses raw `fetch()` against the OpenAI Chat Completions API with SSE streaming.
 * No SDK dependency required.
 */

import { AuthError, ProviderError } from "@chitragupta/core";
import type { TokenUsage, StopReason } from "@chitragupta/core";
import { parseSSEStream } from "../sse.js";
import type {
	Context,
	ModelDefinition,
	ProviderDefinition,
	StreamEvent,
	StreamOptions,
} from "../types.js";

// ─── Models ─────────────────────────────────────────────────────────────────

const OPENAI_MODELS: ModelDefinition[] = [
	{
		id: "gpt-4o",
		name: "GPT-4o",
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		pricing: { input: 2.5, output: 10, cacheRead: 1.25 },
		capabilities: { vision: true, thinking: false, toolUse: true, streaming: true },
	},
	{
		id: "gpt-4o-mini",
		name: "GPT-4o Mini",
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		pricing: { input: 0.15, output: 0.6, cacheRead: 0.075 },
		capabilities: { vision: true, thinking: false, toolUse: true, streaming: true },
	},
	{
		id: "o1",
		name: "o1",
		contextWindow: 200_000,
		maxOutputTokens: 100_000,
		pricing: { input: 15, output: 60, cacheRead: 7.5 },
		capabilities: { vision: true, thinking: true, toolUse: true, streaming: true },
	},
	{
		id: "o1-mini",
		name: "o1 Mini",
		contextWindow: 128_000,
		maxOutputTokens: 65_536,
		pricing: { input: 3, output: 12, cacheRead: 1.5 },
		capabilities: { vision: false, thinking: true, toolUse: true, streaming: true },
	},
	{
		id: "o3-mini",
		name: "o3 Mini",
		contextWindow: 200_000,
		maxOutputTokens: 100_000,
		pricing: { input: 1.1, output: 4.4, cacheRead: 0.55 },
		capabilities: { vision: false, thinking: true, toolUse: true, streaming: true },
	},
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getApiKey(): string {
	const key = process.env.OPENAI_API_KEY;
	if (!key) {
		throw new AuthError(
			"OPENAI_API_KEY environment variable is not set.",
			"openai",
		);
	}
	return key;
}

interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | OpenAIContentPart[] | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

interface OpenAIContentPart {
	type: "text" | "image_url";
	text?: string;
	image_url?: { url: string; detail?: string };
}

interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OpenAITool {
	type: "function";
	function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * Convert our unified Context into OpenAI API messages and tools.
 */
function buildRequestBody(
	model: string,
	context: Context,
	options: StreamOptions,
): Record<string, unknown> {
	const messages: OpenAIMessage[] = [];

	// System prompt
	if (context.systemPrompt) {
		messages.push({ role: "system", content: context.systemPrompt });
	}

	// Conversation messages
	for (const msg of context.messages) {
		if (msg.role === "system") {
			// Additional system messages
			const text = msg.content
				.filter((p) => p.type === "text")
				.map((p) => (p as { text: string }).text)
				.join("\n");
			messages.push({ role: "system", content: text });
			continue;
		}

		// Check for tool results — these become role:"tool" messages
		const toolResults = msg.content.filter((p) => p.type === "tool_result");
		if (toolResults.length > 0) {
			for (const tr of toolResults) {
				if (tr.type === "tool_result") {
					messages.push({
						role: "tool",
						tool_call_id: tr.toolCallId,
						content: tr.content,
					});
				}
			}
			continue;
		}

		// Build content parts
		const contentParts: OpenAIContentPart[] = [];
		const toolCalls: OpenAIToolCall[] = [];

		for (const part of msg.content) {
			switch (part.type) {
				case "text":
					contentParts.push({ type: "text", text: part.text });
					break;
				case "image":
					if (part.source.type === "base64") {
						contentParts.push({
							type: "image_url",
							image_url: {
								url: `data:${part.source.mediaType};base64,${part.source.data}`,
							},
						});
					} else {
						contentParts.push({
							type: "image_url",
							image_url: { url: part.source.data },
						});
					}
					break;
				case "tool_call":
					toolCalls.push({
						id: part.id,
						type: "function",
						function: { name: part.name, arguments: part.arguments },
					});
					break;
				case "thinking":
					// OpenAI doesn't have a thinking content type — include as text
					contentParts.push({ type: "text", text: part.text });
					break;
			}
		}

		const oaiMsg: OpenAIMessage = {
			role: msg.role as "user" | "assistant",
			content: contentParts.length > 0 ? contentParts : null,
		};

		if (toolCalls.length > 0) {
			oaiMsg.tool_calls = toolCalls;
		}

		messages.push(oaiMsg);
	}

	// Build request body
	const body: Record<string, unknown> = {
		model,
		messages,
		stream: true,
		stream_options: { include_usage: true },
	};

	if (options.maxTokens !== undefined) {
		body.max_tokens = options.maxTokens;
	}
	if (options.temperature !== undefined) {
		body.temperature = options.temperature;
	}
	if (options.topP !== undefined) {
		body.top_p = options.topP;
	}
	if (options.stopSequences && options.stopSequences.length > 0) {
		body.stop = options.stopSequences;
	}

	// Tools
	if (context.tools && context.tools.length > 0) {
		const tools: OpenAITool[] = context.tools.map((t) => ({
			type: "function" as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema,
			},
		}));
		body.tools = tools;
	}

	return body;
}

/**
 * Map OpenAI's finish_reason to our StopReason.
 */
function mapStopReason(reason: string | null): StopReason {
	switch (reason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		case "content_filter":
			return "end_turn";
		default:
			return "end_turn";
	}
}

// ─── Stream Implementation ──────────────────────────────────────────────────

async function* openaiStream(
	model: string,
	context: Context,
	options: StreamOptions,
): AsyncGenerator<StreamEvent> {
	const apiKey = getApiKey();
	const body = buildRequestBody(model, context, options);

	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal: options.signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new ProviderError(
			`OpenAI API error ${response.status}: ${errorBody}`,
			"openai",
			response.status,
		);
	}

	let messageId = "";
	let finishReason: string | null = null;
	const accumulatedToolCalls = new Map<
		number,
		{ id: string; name: string; arguments: string }
	>();
	let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
	let started = false;

	for await (const sseEvent of parseSSEStream(response)) {
		let chunk: Record<string, unknown>;
		try {
			chunk = JSON.parse(sseEvent.data);
		} catch {
			// Skip non-JSON SSE frames (e.g. [DONE] sentinel, keep-alive)
			continue;
		}

		// Emit start event on first chunk
		if (!started) {
			messageId = (chunk.id as string) ?? `openai-${Date.now()}`;
			yield { type: "start", messageId };
			started = true;
		}

		// Usage info (sent with stream_options.include_usage)
		if (chunk.usage && typeof chunk.usage === "object") {
			const u = chunk.usage as Record<string, unknown>;
			const promptDetails = u.prompt_tokens_details as Record<string, number> | undefined;
			usage = {
				inputTokens: Number(u.prompt_tokens) || 0,
				outputTokens: Number(u.completion_tokens) || 0,
				cacheReadTokens: promptDetails?.cached_tokens,
			};
			yield { type: "usage", usage };
		}

		const rawChoices = chunk.choices;
		const choices = Array.isArray(rawChoices) ? rawChoices as Array<Record<string, unknown>> : undefined;
		if (!choices || choices.length === 0) continue;

		const choice = choices[0];
		const delta = choice.delta as Record<string, unknown> | undefined;

		if (choice.finish_reason) {
			finishReason = choice.finish_reason as string;
		}

		if (!delta) continue;

		// Text content
		if (typeof delta.content === "string" && delta.content.length > 0) {
			yield { type: "text", text: delta.content as string };
		}

		// Tool calls (streamed incrementally)
		const toolCallDeltas = delta.tool_calls as
			| Array<Record<string, unknown>>
			| undefined;
		if (toolCallDeltas) {
			for (const tc of toolCallDeltas) {
				const idx = tc.index as number;
				const existing = accumulatedToolCalls.get(idx);

				if (!existing) {
					accumulatedToolCalls.set(idx, {
						id: (tc.id as string) ?? "",
						name: ((tc.function as Record<string, unknown>)?.name as string) ?? "",
						arguments: ((tc.function as Record<string, unknown>)?.arguments as string) ?? "",
					});
				} else {
					if (tc.id) existing.id = tc.id as string;
					const fn = tc.function as Record<string, unknown> | undefined;
					if (fn?.name) existing.name += fn.name as string;
					if (fn?.arguments) existing.arguments += fn.arguments as string;
				}
			}
		}
	}

	// Emit accumulated tool calls
	for (const [, tc] of accumulatedToolCalls) {
		yield {
			type: "tool_call",
			id: tc.id,
			name: tc.name,
			arguments: tc.arguments,
		};
	}

	// Done event
	const stopReason = mapStopReason(finishReason);
	yield { type: "done", stopReason, usage };
}

// ─── Validate Key ───────────────────────────────────────────────────────────

async function validateOpenAIKey(key: string): Promise<boolean> {
	try {
		const response = await fetch("https://api.openai.com/v1/models", {
			headers: { Authorization: `Bearer ${key}` },
		});
		return response.ok;
	} catch {
		// Network error — treat as invalid key (may be offline)
		return false;
	}
}

// ─── Provider Definition ────────────────────────────────────────────────────

export const openaiProvider: ProviderDefinition = {
	id: "openai",
	name: "OpenAI",
	models: OPENAI_MODELS,
	auth: { type: "env", envVar: "OPENAI_API_KEY" },
	stream: openaiStream,
	validateKey: validateOpenAIKey,
};
