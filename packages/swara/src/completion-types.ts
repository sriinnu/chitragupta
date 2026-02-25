/**
 * @chitragupta/swara — Unified LLM completion types.
 *
 * Provider-agnostic types for LLM completion requests, responses, and streaming.
 * These types enable chitragupta to call any LLM without depending on Vaayu.
 */

// ─── Messages & Content ─────────────────────────────────────────────────────

/** A single content part within a completion message. */
export interface CompletionContentPart {
	type: "text" | "image" | "tool_call" | "tool_result";
	/** Text content (when type is "text" or "tool_result"). */
	text?: string;
	/** Tool name (when type is "tool_call"). */
	toolName?: string;
	/** Tool input parameters (when type is "tool_call"). */
	toolInput?: Record<string, unknown>;
	/** Tool call ID for matching calls to results. */
	toolCallId?: string;
}

/** A tool invocation returned by the model. */
export interface CompletionToolCall {
	/** Unique identifier for this tool call. */
	id: string;
	/** Name of the tool to invoke. */
	name: string;
	/** Input parameters for the tool. */
	input: Record<string, unknown>;
}

/** Schema definition for a tool available to the model. */
export interface CompletionToolDefinition {
	/** Unique tool name. */
	name: string;
	/** Human-readable description shown to the model. */
	description: string;
	/** JSON Schema describing accepted input parameters. */
	inputSchema: Record<string, unknown>;
}

/** A single message in a completion conversation. */
export interface CompletionMessage {
	role: "system" | "user" | "assistant" | "tool";
	/** Message content as a string or array of content parts. */
	content: string | CompletionContentPart[];
	/** Tool call ID this message responds to (role="tool"). */
	toolCallId?: string;
	/** Tool calls made by the assistant (role="assistant"). */
	toolCalls?: CompletionToolCall[];
}

// ─── Request & Response ─────────────────────────────────────────────────────

/** A provider-agnostic LLM completion request. */
export interface CompletionRequest {
	/** Model identifier (e.g. "claude-sonnet-4-5-20250929", "gpt-4o"). */
	model: string;
	/** Conversation messages. */
	messages: CompletionMessage[];
	/** Tools available to the model. */
	tools?: CompletionToolDefinition[];
	/** Sampling temperature (0-2). */
	temperature?: number;
	/** Maximum tokens to generate. */
	maxTokens?: number;
	/** Whether to stream the response. */
	stream?: boolean;
	/** Stop sequences that halt generation. */
	stopSequences?: string[];
	/** Optional abort signal for cancellation. */
	signal?: AbortSignal;
}

/** The reason generation stopped. */
export type CompletionStopReason =
	| "end_turn"
	| "tool_use"
	| "max_tokens"
	| "stop_sequence";

/** A provider-agnostic LLM completion response. */
export interface CompletionResponse {
	/** Unique response identifier. */
	id: string;
	/** Model that generated the response. */
	model: string;
	/** Response content parts. */
	content: CompletionContentPart[];
	/** Why generation stopped. */
	stopReason: CompletionStopReason;
	/** Token usage statistics. */
	usage: CompletionUsage;
	/** Tool calls made in this response. */
	toolCalls?: CompletionToolCall[];
}

/** Token usage statistics for a completion. */
export interface CompletionUsage {
	/** Number of input/prompt tokens consumed. */
	inputTokens: number;
	/** Number of output/completion tokens generated. */
	outputTokens: number;
}

// ─── Streaming ──────────────────────────────────────────────────────────────

/** A discrete chunk emitted during a streaming completion. */
export interface CompletionStreamChunk {
	type: "text_delta" | "tool_call_start" | "tool_call_delta" | "done";
	/** Text content delta (type="text_delta"). */
	text?: string;
	/** Partial tool call data (type="tool_call_start" or "tool_call_delta"). */
	toolCall?: Partial<CompletionToolCall>;
	/** Stop reason (type="done"). */
	stopReason?: CompletionStopReason;
	/** Final usage stats (type="done"). */
	usage?: CompletionUsage;
}

// ─── Provider Interface ─────────────────────────────────────────────────────

/** Interface that all LLM provider adapters must implement. */
export interface LLMProvider {
	/** Unique provider identifier (e.g. "anthropic", "openai"). */
	id: string;
	/** Human-readable provider name. */
	name: string;
	/** Send a completion request and receive a full response. */
	complete(request: CompletionRequest): Promise<CompletionResponse>;
	/** Stream a completion request as incremental chunks. */
	stream?(request: CompletionRequest): AsyncIterable<CompletionStreamChunk>;
	/** List models available from this provider. */
	listModels?(): Promise<string[]>;
}

// ─── Router Configuration ───────────────────────────────────────────────────

/** Configuration for the CompletionRouter. */
export interface CompletionRouterConfig {
	/** Registered LLM providers. */
	providers: LLMProvider[];
	/** Default model to use when none is specified. */
	defaultModel?: string;
	/** Ordered list of model prefixes to try on failure. */
	fallbackChain?: string[];
	/** Number of retry attempts on transient errors. */
	retryAttempts?: number;
	/** Base delay between retries in milliseconds. */
	retryDelayMs?: number;
	/** Request timeout in milliseconds. */
	timeout?: number;
}
