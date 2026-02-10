/**
 * Anthropic provider implementation.
 *
 * Uses raw `fetch()` against the Anthropic Messages API with SSE streaming.
 * Supports thinking blocks and tool use.
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

/**
 * Anthropic Messages API version. Update when Anthropic releases a new
 * API version. Can be overridden via ANTHROPIC_API_VERSION env var.
 */
const ANTHROPIC_API_VERSION = process.env.ANTHROPIC_API_VERSION ?? "2023-06-01";

// ─── Models ─────────────────────────────────────────────────────────────────

const ANTHROPIC_MODELS: ModelDefinition[] = [
	{
		id: "claude-sonnet-4-5-20250929",
		name: "Claude Sonnet 4.5",
		contextWindow: 200_000,
		maxOutputTokens: 16_384,
		pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		capabilities: { vision: true, thinking: true, toolUse: true, streaming: true },
	},
	{
		id: "claude-haiku-3-5-20241022",
		name: "Claude 3.5 Haiku",
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
		capabilities: { vision: true, thinking: false, toolUse: true, streaming: true },
	},
	{
		id: "claude-opus-4-20250514",
		name: "Claude Opus 4",
		contextWindow: 200_000,
		maxOutputTokens: 32_000,
		pricing: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		capabilities: { vision: true, thinking: true, toolUse: true, streaming: true },
	},
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getApiKey(): string {
	const key = process.env.ANTHROPIC_API_KEY;
	if (!key) {
		throw new AuthError(
			"ANTHROPIC_API_KEY environment variable is not set.",
			"anthropic",
		);
	}
	return key;
}

interface AnthropicMessage {
	role: "user" | "assistant";
	content: AnthropicContent[];
}

type AnthropicContent =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
	| { type: "thinking"; thinking: string };

interface AnthropicTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

/**
 * Convert our unified Context into Anthropic API format.
 */
function buildRequestBody(
	model: string,
	context: Context,
	options: StreamOptions,
): Record<string, unknown> {
	const messages: AnthropicMessage[] = [];

	for (const msg of context.messages) {
		if (msg.role === "system") {
			// Anthropic uses a top-level system parameter, not system messages.
			// These are merged into the systemPrompt below.
			continue;
		}

		const content: AnthropicContent[] = [];

		for (const part of msg.content) {
			switch (part.type) {
				case "text":
					content.push({ type: "text", text: part.text });
					break;
				case "image":
					if (part.source.type === "base64") {
						content.push({
							type: "image",
							source: {
								type: "base64",
								media_type: part.source.mediaType,
								data: part.source.data,
							},
						});
					} else {
						// Anthropic requires base64 for images; for URLs, we'd
						// need to fetch and convert — pass as text fallback.
						content.push({ type: "text", text: `[Image: ${part.source.data}]` });
					}
					break;
				case "tool_call":
					// Assistant tool_use blocks
					let parsedInput: unknown = {};
					try {
						parsedInput = JSON.parse(part.arguments);
					} catch {
						parsedInput = { raw: part.arguments };
					}
					content.push({
						type: "tool_use",
						id: part.id,
						name: part.name,
						input: parsedInput,
					});
					break;
				case "tool_result":
					content.push({
						type: "tool_result",
						tool_use_id: part.toolCallId,
						content: part.content,
						is_error: part.isError,
					});
					break;
				case "thinking":
					content.push({ type: "thinking", thinking: part.text });
					break;
			}
		}

		if (content.length > 0) {
			messages.push({
				role: msg.role as "user" | "assistant",
				content,
			});
		}
	}

	// Build system prompt — merge context.systemPrompt with any system messages
	const systemParts: string[] = [];
	if (context.systemPrompt) {
		systemParts.push(context.systemPrompt);
	}
	for (const msg of context.messages) {
		if (msg.role === "system") {
			for (const part of msg.content) {
				if (part.type === "text") {
					systemParts.push(part.text);
				}
			}
		}
	}

	const body: Record<string, unknown> = {
		model,
		messages,
		stream: true,
		max_tokens: options.maxTokens ?? 8192,
	};

	if (systemParts.length > 0) {
		body.system = systemParts.join("\n\n");
	}

	if (options.temperature !== undefined) {
		body.temperature = options.temperature;
	}
	if (options.topP !== undefined) {
		body.top_p = options.topP;
	}
	if (options.stopSequences && options.stopSequences.length > 0) {
		body.stop_sequences = options.stopSequences;
	}

	// Thinking / extended thinking
	if (options.thinking?.enabled) {
		body.thinking = {
			type: "enabled",
			budget_tokens: options.thinking.budgetTokens ?? 10000,
		};
	}

	// Tools
	if (context.tools && context.tools.length > 0) {
		const tools: AnthropicTool[] = context.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema,
		}));
		body.tools = tools;
	}

	return body;
}

/**
 * Map Anthropic stop_reason to our StopReason.
 */
function mapStopReason(reason: string | null | undefined): StopReason {
	switch (reason) {
		case "end_turn":
			return "end_turn";
		case "max_tokens":
			return "max_tokens";
		case "tool_use":
			return "tool_use";
		case "stop_sequence":
			return "stop_sequence";
		default:
			return "end_turn";
	}
}

// ─── Stream Implementation ──────────────────────────────────────────────────

async function* anthropicStream(
	model: string,
	context: Context,
	options: StreamOptions,
): AsyncGenerator<StreamEvent> {
	const apiKey = getApiKey();
	const body = buildRequestBody(model, context, options);

	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": ANTHROPIC_API_VERSION,
		},
		body: JSON.stringify(body),
		signal: options.signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new ProviderError(
			`Anthropic API error ${response.status}: ${errorBody}`,
			"anthropic",
			response.status,
		);
	}

	let messageId = "";
	let stopReason: StopReason = "end_turn";
	let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

	// Track content blocks by index for tool_use accumulation
	const contentBlocks = new Map<
		number,
		{ type: string; id?: string; name?: string; input?: string; text?: string }
	>();
	let currentBlockIndex = -1;

	for await (const sseEvent of parseSSEStream(response)) {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(sseEvent.data);
		} catch {
			// Skip non-JSON SSE frames (e.g. keep-alive, malformed events)
			continue;
		}

		const eventType = sseEvent.event ?? (data.type as string);

		switch (eventType) {
			case "message_start": {
				const message = data.message as Record<string, unknown> | undefined;
				messageId = (message?.id as string) ?? `anthropic-${Date.now()}`;
				yield { type: "start", messageId };

				// Initial usage from message_start
				const msgUsage = message?.usage as Record<string, number> | undefined;
				if (msgUsage) {
					usage = {
						inputTokens: Number(msgUsage.input_tokens) || 0,
						outputTokens: Number(msgUsage.output_tokens) || 0,
						cacheReadTokens: msgUsage.cache_read_input_tokens,
						cacheWriteTokens: msgUsage.cache_creation_input_tokens,
					};
				}
				break;
			}

			case "content_block_start": {
				const index = data.index as number;
				const block = data.content_block as Record<string, unknown> | undefined;
				if (!block) break;
				currentBlockIndex = index;

				if (block.type === "tool_use") {
					contentBlocks.set(index, {
						type: "tool_use",
						id: block.id as string,
						name: block.name as string,
						input: "",
					});
				} else if (block.type === "thinking") {
					contentBlocks.set(index, {
						type: "thinking",
						text: (block.thinking as string) ?? "",
					});
				} else if (block.type === "text") {
					contentBlocks.set(index, {
						type: "text",
						text: (block.text as string) ?? "",
					});
					// Emit any initial text
					if (block.text && (block.text as string).length > 0) {
						yield { type: "text", text: block.text as string };
					}
				}
				break;
			}

			case "content_block_delta": {
				const index = data.index as number;
				const delta = data.delta as Record<string, unknown> | undefined;
				if (!delta) break;

				if (delta.type === "text_delta") {
					yield { type: "text", text: delta.text as string };
				} else if (delta.type === "thinking_delta") {
					yield { type: "thinking", text: delta.thinking as string };
					const block = contentBlocks.get(index);
					if (block && block.type === "thinking") {
						block.text = (block.text ?? "") + (delta.thinking as string);
					}
				} else if (delta.type === "input_json_delta") {
					const block = contentBlocks.get(index);
					if (block && block.type === "tool_use") {
						block.input = (block.input ?? "") + (delta.partial_json as string);
					}
				}
				break;
			}

			case "content_block_stop": {
				const index = data.index as number;
				const block = contentBlocks.get(index);
				if (block?.type === "tool_use") {
					yield {
						type: "tool_call",
						id: block.id ?? "",
						name: block.name ?? "",
						arguments: block.input ?? "{}",
					};
				}
				break;
			}

			case "message_delta": {
				const delta = data.delta as Record<string, unknown> | undefined;
				if (delta?.stop_reason) {
					stopReason = mapStopReason(delta.stop_reason as string);
				}

				// Updated usage from message_delta
				const deltaUsage = data.usage as Record<string, number> | undefined;
				if (deltaUsage) {
					usage = {
						...usage,
						outputTokens: Number(deltaUsage.output_tokens) || usage.outputTokens,
					};
				}
				break;
			}

			case "message_stop": {
				// Stream complete
				break;
			}

			case "ping": {
				// Keep-alive — ignore
				break;
			}

			case "error": {
				const err = data.error as Record<string, unknown> | undefined;
				const errMsg = (err?.message as string) ?? "Unknown Anthropic streaming error";
				yield {
					type: "error",
					error: new ProviderError(errMsg, "anthropic"),
				};
				break;
			}
		}
	}

	// Emit final usage and done
	yield { type: "usage", usage };
	yield { type: "done", stopReason, usage };
}

// ─── Validate Key ───────────────────────────────────────────────────────────

async function validateAnthropicKey(key: string): Promise<boolean> {
	// Client-side format check — Anthropic keys start with "sk-ant-" and are 40+ chars.
	if (!key.startsWith("sk-ant-") || key.length < 40) {
		return false;
	}

	try {
		// Send a request with an intentionally empty messages array.
		// A valid key returns 400 (bad request but authenticated).
		// An invalid key returns 401/403.
		// This avoids generating actual completions and incurring costs.
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": key,
				"anthropic-version": ANTHROPIC_API_VERSION,
			},
			body: JSON.stringify({
				model: "claude-haiku-3-5-20241022",
				max_tokens: 1,
				messages: [],
			}),
		});
		// 400 = valid key (bad request but authenticated)
		// 401/403 = invalid key
		return response.status !== 401 && response.status !== 403;
	} catch {
		// Network error — treat as invalid key (may be offline)
		return false;
	}
}

// ─── Provider Definition ────────────────────────────────────────────────────

export const anthropicProvider: ProviderDefinition = {
	id: "anthropic",
	name: "Anthropic",
	models: ANTHROPIC_MODELS,
	auth: { type: "env", envVar: "ANTHROPIC_API_KEY" },
	stream: anthropicStream,
	validateKey: validateAnthropicKey,
};
