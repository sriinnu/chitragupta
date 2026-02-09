/**
 * Google Gemini provider implementation.
 *
 * Uses raw `fetch()` against the Gemini REST API with streaming.
 */

import { AuthError, ProviderError } from "@chitragupta/core";
import type { TokenUsage, StopReason } from "@chitragupta/core";
import type {
	Context,
	ModelDefinition,
	ProviderDefinition,
	StreamEvent,
	StreamOptions,
} from "../types.js";

// ─── Models ─────────────────────────────────────────────────────────────────

const GEMINI_MODELS: ModelDefinition[] = [
	{
		id: "gemini-2.0-flash",
		name: "Gemini 2.0 Flash",
		contextWindow: 1_048_576,
		maxOutputTokens: 8_192,
		pricing: { input: 0.1, output: 0.4 },
		capabilities: { vision: true, thinking: false, toolUse: true, streaming: true },
	},
	{
		id: "gemini-2.0-flash-lite",
		name: "Gemini 2.0 Flash Lite",
		contextWindow: 1_048_576,
		maxOutputTokens: 8_192,
		pricing: { input: 0.075, output: 0.3 },
		capabilities: { vision: true, thinking: false, toolUse: true, streaming: true },
	},
	{
		id: "gemini-1.5-pro",
		name: "Gemini 1.5 Pro",
		contextWindow: 2_097_152,
		maxOutputTokens: 8_192,
		pricing: { input: 1.25, output: 5 },
		capabilities: { vision: true, thinking: false, toolUse: true, streaming: true },
	},
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getApiKey(): string {
	const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
	if (!key) {
		throw new AuthError(
			"GOOGLE_API_KEY or GEMINI_API_KEY environment variable is not set.",
			"google",
		);
	}
	return key;
}

interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

type GeminiPart =
	| { text: string }
	| { inlineData: { mimeType: string; data: string } }
	| { functionCall: { name: string; args: Record<string, unknown> } }
	| { functionResponse: { name: string; response: { content: string } } };

interface GeminiTool {
	functionDeclarations: Array<{
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	}>;
}

/**
 * Convert our unified Context into Gemini API format.
 */
function buildRequestBody(
	context: Context,
	options: StreamOptions,
): Record<string, unknown> {
	const contents: GeminiContent[] = [];

	for (const msg of context.messages) {
		if (msg.role === "system") {
			// Gemini uses systemInstruction, handled separately
			continue;
		}

		const role = msg.role === "assistant" ? "model" : "user";
		const parts: GeminiPart[] = [];

		for (const part of msg.content) {
			switch (part.type) {
				case "text":
					parts.push({ text: part.text });
					break;
				case "image":
					if (part.source.type === "base64") {
						parts.push({
							inlineData: {
								mimeType: part.source.mediaType,
								data: part.source.data,
							},
						});
					} else {
						parts.push({ text: `[Image URL: ${part.source.data}]` });
					}
					break;
				case "tool_call": {
					let parsedArgs: Record<string, unknown> = {};
					try {
						parsedArgs = JSON.parse(part.arguments) as Record<string, unknown>;
					} catch {
						parsedArgs = { raw: part.arguments };
					}
					parts.push({
						functionCall: { name: part.name, args: parsedArgs },
					});
					break;
				}
				case "tool_result":
					parts.push({
						functionResponse: {
							name: part.toolCallId,
							response: { content: part.content },
						},
					});
					break;
				case "thinking":
					parts.push({ text: part.text });
					break;
			}
		}

		if (parts.length > 0) {
			contents.push({ role, parts });
		}
	}

	const body: Record<string, unknown> = {
		contents,
	};

	// System instruction
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
	if (systemParts.length > 0) {
		body.systemInstruction = {
			parts: [{ text: systemParts.join("\n\n") }],
		};
	}

	// Generation config
	const generationConfig: Record<string, unknown> = {};
	if (options.maxTokens !== undefined) {
		generationConfig.maxOutputTokens = options.maxTokens;
	}
	if (options.temperature !== undefined) {
		generationConfig.temperature = options.temperature;
	}
	if (options.topP !== undefined) {
		generationConfig.topP = options.topP;
	}
	if (options.stopSequences && options.stopSequences.length > 0) {
		generationConfig.stopSequences = options.stopSequences;
	}
	if (Object.keys(generationConfig).length > 0) {
		body.generationConfig = generationConfig;
	}

	// Tools
	if (context.tools && context.tools.length > 0) {
		const tools: GeminiTool[] = [
			{
				functionDeclarations: context.tools.map((t) => ({
					name: t.name,
					description: t.description,
					parameters: t.inputSchema,
				})),
			},
		];
		body.tools = tools;
	}

	return body;
}

/**
 * Map Gemini finish reason to our StopReason.
 */
function mapStopReason(reason: string | undefined): StopReason {
	switch (reason) {
		case "STOP":
			return "end_turn";
		case "MAX_TOKENS":
			return "max_tokens";
		case "SAFETY":
			return "end_turn";
		case "RECITATION":
			return "end_turn";
		default:
			return "end_turn";
	}
}

// ─── Stream Implementation ──────────────────────────────────────────────────

/**
 * Parse the Gemini streaming response.
 *
 * Gemini's streamGenerateContent with `alt=sse` returns SSE events where
 * each `data:` payload is a JSON object with `candidates` array.
 */
async function* geminiStream(
	model: string,
	context: Context,
	options: StreamOptions,
): AsyncGenerator<StreamEvent> {
	const apiKey = getApiKey();
	const body = buildRequestBody(context, options);

	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: options.signal,
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "");
		throw new ProviderError(
			`Google Gemini API error ${response.status}: ${errorBody}`,
			"google",
			response.status,
		);
	}

	const messageId = `gemini-${Date.now()}`;
	yield { type: "start", messageId };

	let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
	let finishReason: string | undefined;

	// Gemini streams SSE with data: lines containing JSON
	const reader = response.body?.getReader();
	if (!reader) {
		throw new ProviderError("No response body from Gemini API", "google");
	}

	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Split on double newlines for SSE frames
			const frames = buffer.split("\n\n");
			buffer = frames.pop() ?? "";

			for (const frame of frames) {
				if (!frame.trim()) continue;

				// Extract data lines
				const dataLines: string[] = [];
				for (const line of frame.split("\n")) {
					if (line.startsWith("data:")) {
						dataLines.push(line.slice(5).trim());
					}
				}

				if (dataLines.length === 0) continue;
				const dataStr = dataLines.join("");

				if (dataStr === "[DONE]") continue;

				let data: Record<string, unknown>;
				try {
					data = JSON.parse(dataStr);
				} catch {
					// Skip non-JSON SSE frames (e.g. [DONE] sentinel, malformed events)
					continue;
				}

				// Process candidates
				const rawCandidates = data.candidates;
				const candidates = Array.isArray(rawCandidates)
					? rawCandidates as Array<Record<string, unknown>>
					: undefined;

				if (candidates && candidates.length > 0) {
					const candidate = candidates[0];

					// Finish reason
					if (candidate.finishReason) {
						finishReason = candidate.finishReason as string;
					}

					const content = candidate.content as
						| { parts?: unknown }
						| undefined;
					const parts = Array.isArray(content?.parts)
						? content.parts as Array<Record<string, unknown>>
						: undefined;

					if (parts) {
						for (const part of parts) {
							if (typeof part.text === "string" && part.text.length > 0) {
								yield { type: "text", text: part.text };
							}
							if (part.functionCall) {
								const fc = part.functionCall as {
									name: string;
									args: Record<string, unknown>;
								};
								yield {
									type: "tool_call",
									id: `gemini-tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
									name: fc.name,
									arguments: JSON.stringify(fc.args),
								};
							}
						}
					}
				}

				// Usage metadata
				const usageMeta = data.usageMetadata as
					| Record<string, unknown>
					| undefined;
				if (usageMeta) {
					usage = {
						inputTokens: Number(usageMeta.promptTokenCount) || 0,
						outputTokens: Number(usageMeta.candidatesTokenCount) || 0,
					};
				}
			}
		}
	} finally {
		reader.releaseLock();
	}

	yield { type: "usage", usage };
	yield { type: "done", stopReason: mapStopReason(finishReason), usage };
}

// ─── Validate Key ───────────────────────────────────────────────────────────

async function validateGoogleKey(key: string): Promise<boolean> {
	try {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
		);
		return response.ok;
	} catch {
		// Network error — treat as invalid key (may be offline)
		return false;
	}
}

// ─── Provider Definition ────────────────────────────────────────────────────

export const googleProvider: ProviderDefinition = {
	id: "google",
	name: "Google Gemini",
	models: GEMINI_MODELS,
	auth: { type: "env", envVar: "GOOGLE_API_KEY" },
	stream: geminiStream,
	validateKey: validateGoogleKey,
};
