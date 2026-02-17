/**
 * Darpana (दर्पण) — Type definitions for the LLM API proxy.
 *
 * Covers Anthropic API shapes, OpenAI API shapes, Google Gemini shapes,
 * provider configuration, and proxy configuration.
 */

// ─── Anthropic API Types ───────────────────────────────────────────

export interface AnthropicRequest {
	model: string;
	messages: AnthropicMessage[];
	system?: string | AnthropicSystemBlock[];
	max_tokens: number;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	stop_sequences?: string[];
	stream?: boolean;
	tools?: AnthropicTool[];
	tool_choice?: AnthropicToolChoice;
	metadata?: Record<string, unknown>;
	thinking?: { type: "enabled"; budget_tokens: number } | { type: "disabled" };
}

export interface AnthropicMessage {
	role: "user" | "assistant";
	content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
	| AnthropicTextBlock
	| AnthropicImageBlock
	| AnthropicToolUseBlock
	| AnthropicToolResultBlock
	| AnthropicThinkingBlock;

export interface AnthropicTextBlock {
	type: "text";
	text: string;
}

export interface AnthropicImageBlock {
	type: "image";
	source: {
		type: "base64";
		media_type: string;
		data: string;
	};
}

export interface AnthropicToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content?: string | AnthropicContentBlock[];
	is_error?: boolean;
}

export interface AnthropicThinkingBlock {
	type: "thinking";
	thinking: string;
}

export interface AnthropicSystemBlock {
	type: "text";
	text: string;
	cache_control?: { type: "ephemeral" };
}

export interface AnthropicTool {
	name: string;
	description?: string;
	input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
	| { type: "auto" }
	| { type: "any" }
	| { type: "none" }
	| { type: "tool"; name: string };

export interface AnthropicResponse {
	id: string;
	type: "message";
	role: "assistant";
	model: string;
	content: AnthropicContentBlock[];
	stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
	stop_sequence?: string | null;
	usage: AnthropicUsage;
}

export interface AnthropicUsage {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

// ─── Anthropic SSE Types ───────────────────────────────────────────

export type AnthropicSSEEvent =
	| { type: "message_start"; message: Omit<AnthropicResponse, "content"> & { content: [] } }
	| { type: "content_block_start"; index: number; content_block: AnthropicContentBlock }
	| { type: "content_block_delta"; index: number; delta: AnthropicDelta }
	| { type: "content_block_stop"; index: number }
	| { type: "message_delta"; delta: { stop_reason: string; stop_sequence?: string | null }; usage?: { output_tokens: number } }
	| { type: "message_stop" }
	| { type: "ping" }
	| { type: "error"; error: { type: string; message: string } };

export type AnthropicDelta =
	| { type: "text_delta"; text: string }
	| { type: "input_json_delta"; partial_json: string }
	| { type: "thinking_delta"; thinking: string };

// ─── OpenAI API Types ──────────────────────────────────────────────

export interface OpenAIRequest {
	model: string;
	messages: OpenAIMessage[];
	max_tokens?: number;
	max_completion_tokens?: number;
	temperature?: number;
	top_p?: number;
	stop?: string[];
	stream?: boolean;
	stream_options?: { include_usage: boolean };
	tools?: OpenAITool[];
	tool_choice?: string | { type: "function"; function: { name: string } };
}

export interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | OpenAIContentPart[] | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
	name?: string;
}

export type OpenAIContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string; detail?: string } };

export interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface OpenAIResponse {
	id: string;
	object: "chat.completion";
	model: string;
	choices: OpenAIChoice[];
	usage?: OpenAIUsage;
}

export interface OpenAIChoice {
	index: number;
	message: OpenAIMessage;
	finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface OpenAIUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface OpenAIStreamChunk {
	id: string;
	object: "chat.completion.chunk";
	model: string;
	choices: OpenAIStreamChoice[];
	usage?: OpenAIUsage | null;
}

export interface OpenAIStreamChoice {
	index: number;
	delta: Partial<OpenAIMessage>;
	finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

// ─── Google Gemini API Types ───────────────────────────────────────

export interface GeminiRequest {
	contents: GeminiContent[];
	systemInstruction?: GeminiContent;
	tools?: GeminiToolDeclaration[];
	toolConfig?: { functionCallingConfig?: { mode?: string; allowedFunctionNames?: string[] } };
	generationConfig?: GeminiGenerationConfig;
}

export interface GeminiContent {
	role?: "user" | "model";
	parts: GeminiPart[];
}

export type GeminiPart =
	| { text: string }
	| { inlineData: { mimeType: string; data: string } }
	| { functionCall: { name: string; args: Record<string, unknown> } }
	| { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiToolDeclaration {
	functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiFunctionDeclaration {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

export interface GeminiGenerationConfig {
	maxOutputTokens?: number;
	temperature?: number;
	topP?: number;
	topK?: number;
	stopSequences?: string[];
}

export interface GeminiResponse {
	candidates: GeminiCandidate[];
	usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

export interface GeminiCandidate {
	content: GeminiContent;
	finishReason?: "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "OTHER";
}

// ─── Provider / Proxy Config ───────────────────────────────────────

export type ConverterType = "openai-compat" | "google" | "passthrough";

export interface ProviderConfig {
	type: ConverterType;
	endpoint?: string;
	apiKey?: string;
	models?: Record<string, ModelOverrides>;
	headers?: Record<string, string>;
	timeout?: number;
	maxRetries?: number;
}

export interface ModelOverrides {
	upstreamName?: string;
	maxTokensCap?: number;
}

export interface DarpanaConfig {
	port: number;
	host: string;
	providers: Record<string, ProviderConfig>;
	aliases: Record<string, string>;
	auth?: { apiKey?: string };
	cors?: boolean;
	logLevel?: string;
}

export interface ResolvedRoute {
	providerName: string;
	provider: ProviderConfig;
	upstreamModel: string;
}
