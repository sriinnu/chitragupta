/**
 * OpenAI-compatible provider factory.
 *
 * Creates a ProviderDefinition that speaks the OpenAI Chat Completions API
 * against an arbitrary base URL. This enables support for:
 *
 *   Groq, Cerebras, xAI, DeepSeek, vLLM, LiteLLM, OpenRouter, Mistral, etc.
 *
 * Reuses the same SSE parsing logic as the OpenAI provider.
 */

import { AuthError, ProviderError } from "@chitragupta/core";
import type { TokenUsage, StopReason } from "@chitragupta/core";
import { parseSSEStream } from "../sse.js";
import type {
	AuthConfig,
	Context,
	ModelDefinition,
	ProviderDefinition,
	StreamEvent,
	StreamOptions,
	ToolDefinition,
} from "../types.js";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface OpenAICompatConfig {
	/** Unique provider ID (e.g. "groq", "deepseek"). */
	id: string;
	/** Display name. */
	name: string;
	/** Base URL of the OpenAI-compatible API (e.g. "https://api.groq.com/openai/v1"). */
	baseUrl: string;
	/** Environment variable name for the API key. If omitted, no auth header is sent. */
	authEnvVar?: string;
	/** Model definitions supported by this provider. */
	models: ModelDefinition[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
 * Convert our unified Context into OpenAI-format messages.
 */
function buildMessages(context: Context): OpenAIMessage[] {
	const messages: OpenAIMessage[] = [];

	if (context.systemPrompt) {
		messages.push({ role: "system", content: context.systemPrompt });
	}

	for (const msg of context.messages) {
		if (msg.role === "system") {
			const text = msg.content
				.filter((p) => p.type === "text")
				.map((p) => (p as { text: string }).text)
				.join("\n");
			messages.push({ role: "system", content: text });
			continue;
		}

		// Tool results -> role:"tool"
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

	return messages;
}

function buildTools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.inputSchema,
		},
	}));
}

function mapStopReason(reason: string | null): StopReason {
	switch (reason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		default:
			return "end_turn";
	}
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create an OpenAI-compatible provider definition.
 *
 * The returned provider uses the same SSE streaming protocol as OpenAI
 * but points to a different base URL.
 */
export function createOpenAICompatProvider(
	config: OpenAICompatConfig,
): ProviderDefinition {
	function getApiKey(): string | undefined {
		if (!config.authEnvVar) return undefined;
		const key = process.env[config.authEnvVar];
		if (!key) {
			throw new AuthError(
				`${config.authEnvVar} environment variable is not set.`,
				config.id,
			);
		}
		return key;
	}

	async function* streamImpl(
		model: string,
		context: Context,
		options: StreamOptions,
	): AsyncGenerator<StreamEvent> {
		const apiKey = getApiKey();
		const messages = buildMessages(context);

		const body: Record<string, unknown> = {
			model,
			messages,
			stream: true,
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

		const tools = buildTools(context.tools);
		if (tools) {
			body.tools = tools;
		}

		// Some providers support usage in stream
		body.stream_options = { include_usage: true };

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`;
		}

		// Normalize base URL — strip trailing slash
		const baseUrl = config.baseUrl.replace(/\/+$/, "");

		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: options.signal,
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "");
			throw new ProviderError(
				`${config.name} API error ${response.status}: ${errorBody}`,
				config.id,
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
				continue;
			}

			if (!started) {
				messageId = (chunk.id as string) ?? `${config.id}-${Date.now()}`;
				yield { type: "start", messageId };
				started = true;
			}

			// Usage info
			if (chunk.usage && typeof chunk.usage === "object") {
				const u = chunk.usage as Record<string, number>;
				usage = {
					inputTokens: u.prompt_tokens ?? 0,
					outputTokens: u.completion_tokens ?? 0,
				};
				yield { type: "usage", usage };
			}

			const choices = chunk.choices as
				| Array<Record<string, unknown>>
				| undefined;
			if (!choices || choices.length === 0) continue;

			const choice = choices[0];
			const delta = choice.delta as Record<string, unknown> | undefined;

			if (choice.finish_reason) {
				finishReason = choice.finish_reason as string;
			}

			if (!delta) continue;

			// Text
			if (typeof delta.content === "string" && delta.content.length > 0) {
				yield { type: "text", text: delta.content as string };
			}

			// Tool calls
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

		yield { type: "done", stopReason: mapStopReason(finishReason), usage };
	}

	async function validateKey(key: string): Promise<boolean> {
		try {
			const baseUrl = config.baseUrl.replace(/\/+$/, "");
			const response = await fetch(`${baseUrl}/models`, {
				headers: { Authorization: `Bearer ${key}` },
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	const auth: AuthConfig = config.authEnvVar
		? { type: "env", envVar: config.authEnvVar }
		: { type: "custom" };

	return {
		id: config.id,
		name: config.name,
		models: config.models,
		auth,
		stream: streamImpl,
		validateKey,
	};
}
