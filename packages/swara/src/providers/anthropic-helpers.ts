/**
 * Anthropic provider helpers — request body builder and type mappings.
 *
 * Extracted from anthropic.ts for maintainability.
 *
 * @module anthropic-helpers
 */

import type { StopReason, TokenUsage } from "@chitragupta/core";
import type { Context, StreamOptions, ModelDefinition } from "../types.js";

// ─── Models ─────────────────────────────────────────────────────────────────

/** Anthropic model definitions. */
export const ANTHROPIC_MODELS: ModelDefinition[] = [
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

// ─── Anthropic API Types ────────────────────────────────────────────────────

export interface AnthropicMessage {
	role: "user" | "assistant";
	content: AnthropicContent[];
}

export type AnthropicContent =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
	| { type: "thinking"; thinking: string };

export interface AnthropicTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

// ─── Request Builder ────────────────────────────────────────────────────────

/**
 * Convert our unified Context into Anthropic API format.
 */
export function buildRequestBody(
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

// ─── Stop Reason Mapping ────────────────────────────────────────────────────

/**
 * Map Anthropic stop_reason to our StopReason.
 */
export function mapStopReason(reason: string | null | undefined): StopReason {
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
