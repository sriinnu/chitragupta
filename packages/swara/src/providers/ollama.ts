/**
 * Ollama provider implementation for LOCAL LLMs.
 *
 * Uses raw `fetch()` against the Ollama REST API at localhost:11434.
 * Ollama streams newline-delimited JSON (NDJSON).
 * All pricing is $0 since models run locally.
 */

import { ProviderError } from "@chitragupta/core";
import type { TokenUsage, StopReason } from "@chitragupta/core";
import type {
	Context,
	ModelDefinition,
	ProviderDefinition,
	StreamEvent,
	StreamOptions,
} from "../types.js";

// ─── Models ─────────────────────────────────────────────────────────────────

const OLLAMA_MODELS: ModelDefinition[] = [
	{
		id: "llama3.2",
		name: "Llama 3.2",
		contextWindow: 128_000,
		maxOutputTokens: 8_192,
		pricing: { input: 0, output: 0 },
		capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
	},
	{
		id: "codellama",
		name: "Code Llama",
		contextWindow: 16_384,
		maxOutputTokens: 4_096,
		pricing: { input: 0, output: 0 },
		capabilities: { vision: false, thinking: false, toolUse: false, streaming: true },
	},
	{
		id: "mistral",
		name: "Mistral",
		contextWindow: 32_768,
		maxOutputTokens: 8_192,
		pricing: { input: 0, output: 0 },
		capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
	},
	{
		id: "phi3",
		name: "Phi-3",
		contextWindow: 128_000,
		maxOutputTokens: 4_096,
		pricing: { input: 0, output: 0 },
		capabilities: { vision: false, thinking: false, toolUse: false, streaming: true },
	},
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_OLLAMA_BASE = "http://localhost:11434";

function getBaseUrl(): string {
	return process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_BASE;
}

interface OllamaMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	images?: string[];
	tool_calls?: Array<{
		function: { name: string; arguments: Record<string, unknown> };
	}>;
}

interface OllamaTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

/**
 * Convert our unified Context into Ollama chat API format.
 */
function buildMessages(context: Context): OllamaMessage[] {
	const messages: OllamaMessage[] = [];

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

		const textParts: string[] = [];
		const images: string[] = [];
		const toolCalls: Array<{
			function: { name: string; arguments: Record<string, unknown> };
		}> = [];

		for (const part of msg.content) {
			switch (part.type) {
				case "text":
					textParts.push(part.text);
					break;
				case "thinking":
					textParts.push(part.text);
					break;
				case "image":
					if (part.source.type === "base64") {
						images.push(part.source.data);
					}
					break;
				case "tool_call": {
					let parsedArgs: Record<string, unknown> = {};
					try {
						parsedArgs = JSON.parse(part.arguments) as Record<string, unknown>;
					} catch {
						parsedArgs = { raw: part.arguments };
					}
					toolCalls.push({
						function: { name: part.name, arguments: parsedArgs },
					});
					break;
				}
				case "tool_result":
					// Ollama uses role:"tool" for tool results
					messages.push({
						role: "tool",
						content: part.content,
					});
					break;
			}
		}

		const oMsg: OllamaMessage = {
			role: msg.role as "user" | "assistant",
			content: textParts.join("\n"),
		};
		if (images.length > 0) {
			oMsg.images = images;
		}
		if (toolCalls.length > 0) {
			oMsg.tool_calls = toolCalls;
		}

		messages.push(oMsg);
	}

	return messages;
}

// ─── Stream Implementation ──────────────────────────────────────────────────

async function* ollamaStream(
	model: string,
	context: Context,
	options: StreamOptions,
): AsyncGenerator<StreamEvent> {
	const baseUrl = getBaseUrl();
	const messages = buildMessages(context);

	const body: Record<string, unknown> = {
		model,
		messages,
		stream: true,
	};

	// Options mapping
	const ollamaOptions: Record<string, unknown> = {};
	if (options.maxTokens !== undefined) {
		ollamaOptions.num_predict = options.maxTokens;
	}
	if (options.temperature !== undefined) {
		ollamaOptions.temperature = options.temperature;
	}
	if (options.topP !== undefined) {
		ollamaOptions.top_p = options.topP;
	}
	if (options.stopSequences && options.stopSequences.length > 0) {
		ollamaOptions.stop = options.stopSequences;
	}
	if (Object.keys(ollamaOptions).length > 0) {
		body.options = ollamaOptions;
	}

	// Tools
	if (context.tools && context.tools.length > 0) {
		const tools: OllamaTool[] = context.tools.map((t) => ({
			type: "function" as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema,
			},
		}));
		body.tools = tools;
	}

	let response: Response;
	try {
		response = await fetch(`${baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: options.signal,
		});
	} catch (err) {
		throw new ProviderError(
			`Failed to connect to Ollama at ${baseUrl}. Is Ollama running? Error: ${(err as Error).message}`,
			"ollama",
		);
	}

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new ProviderError(
			`Ollama API error ${response.status}: ${errorBody}`,
			"ollama",
			response.status,
		);
	}

	const messageId = `ollama-${Date.now()}`;
	yield { type: "start", messageId };

	let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

	// Ollama streams newline-delimited JSON
	const reader = response.body?.getReader();
	if (!reader) {
		throw new ProviderError("No response body from Ollama API", "ollama");
	}

	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Split on newlines — Ollama sends one JSON object per line
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				let chunk: Record<string, unknown>;
				try {
					chunk = JSON.parse(trimmed);
				} catch {
					continue;
				}

				// Check for message content
				const message = chunk.message as Record<string, unknown> | undefined;
				if (message) {
					// Text content
					if (typeof message.content === "string" && message.content.length > 0) {
						yield { type: "text", text: message.content as string };
					}

					// Tool calls
					const toolCalls = message.tool_calls as
						| Array<Record<string, unknown>>
						| undefined;
					if (toolCalls) {
						for (const tc of toolCalls) {
							const fn = tc.function as Record<string, unknown> | undefined;
							if (fn) {
								yield {
									type: "tool_call",
									id: `ollama-tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
									name: fn.name as string,
									arguments: JSON.stringify(fn.arguments ?? {}),
								};
							}
						}
					}
				}

				// Check if this is the final message
				if (chunk.done === true) {
					// Extract usage from the final response
					usage = {
						inputTokens: (chunk.prompt_eval_count as number) ?? 0,
						outputTokens: (chunk.eval_count as number) ?? 0,
					};
				}
			}
		}

		// Process any remaining buffer
		if (buffer.trim()) {
			try {
				const chunk = JSON.parse(buffer.trim());
				if (chunk.done === true) {
					usage = {
						inputTokens: (chunk.prompt_eval_count as number) ?? 0,
						outputTokens: (chunk.eval_count as number) ?? 0,
					};
				} else if (chunk.message?.content) {
					yield { type: "text", text: chunk.message.content as string };
				}
			} catch {
				// Ignore incomplete JSON
			}
		}
	} finally {
		reader.releaseLock();
	}

	yield { type: "usage", usage };
	yield { type: "done", stopReason: "end_turn" as StopReason, usage };
}

// ─── Validate ───────────────────────────────────────────────────────────────

async function validateOllama(): Promise<boolean> {
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(`${baseUrl}/api/tags`);
		return response.ok;
	} catch {
		return false;
	}
}

// ─── Provider Definition ────────────────────────────────────────────────────

export const ollamaProvider: ProviderDefinition = {
	id: "ollama",
	name: "Ollama (Local)",
	models: OLLAMA_MODELS,
	auth: { type: "custom" },
	stream: ollamaStream,
	validateKey: validateOllama,
};
