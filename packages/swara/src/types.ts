/**
 * @chitragupta/swara — AI/LLM abstraction types.
 *
 * Builds on top of @chitragupta/core's TokenUsage, CostBreakdown, and StopReason.
 */

import type { TokenUsage, CostBreakdown, StopReason, ToolDefinition as CoreToolDefinition } from "@chitragupta/core";

// ─── Content Parts ──────────────────────────────────────────────────────────

/** A text content part within a message. */
export interface TextContent {
	type: "text";
	text: string;
}

/** An image content part (base64 or URL) within a message. */
export interface ImageContent {
	type: "image";
	source: {
		type: "base64" | "url";
		mediaType: string;
		data: string;
	};
}

/** A tool call request from the assistant. */
export interface ToolCallContent {
	type: "tool_call";
	id: string;
	name: string;
	arguments: string;
}

/** The result of a tool call execution, sent back to the model. */
export interface ToolResultContent {
	type: "tool_result";
	toolCallId: string;
	content: string;
	isError?: boolean;
}

/** Extended thinking (chain-of-thought) content from the model. */
export interface ThinkingContent {
	type: "thinking";
	text: string;
}

/** Union of all content part types that can appear in a message. */
export type ContentPart =
	| TextContent
	| ImageContent
	| ToolCallContent
	| ToolResultContent
	| ThinkingContent;

// ─── Messages & Context ─────────────────────────────────────────────────────

/** A single message in a conversation (user, assistant, or system). */
export interface Message {
	role: "user" | "assistant" | "system";
	content: ContentPart[];
}

/** Definition of a tool that the model can call. Re-exported from @chitragupta/core. */
export type ToolDefinition = CoreToolDefinition;

/** The full conversation context sent to an LLM provider. */
export interface Context {
	messages: Message[];
	systemPrompt?: string;
	tools?: ToolDefinition[];
}

// ─── Streaming ──────────────────────────────────────────────────────────────

/** Options for controlling LLM stream behavior. */
export interface StreamOptions {
	maxTokens?: number;
	temperature?: number;
	topP?: number;
	stopSequences?: string[];
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
	};
	signal?: AbortSignal;
}

/** A discrete event emitted during an LLM streaming response. */
export type StreamEvent =
	| { type: "start"; messageId: string }
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool_call"; id: string; name: string; arguments: string }
	| { type: "usage"; usage: TokenUsage }
	| { type: "done"; stopReason: StopReason; usage: TokenUsage; cost?: CostBreakdown }
	| { type: "error"; error: Error };

// ─── Auth ───────────────────────────────────────────────────────────────────

/** Authentication configuration for an LLM provider. */
export interface AuthConfig {
	type: "api-key" | "oauth" | "env" | "custom";
	envVar?: string;
}

// ─── Model & Provider Definitions ───────────────────────────────────────────

/** Full definition of an LLM model including pricing, context limits, and capabilities. */
export interface ModelDefinition {
	id: string;
	name: string;
	contextWindow: number;
	maxOutputTokens: number;
	pricing: {
		input: number;
		output: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	capabilities: {
		vision: boolean;
		thinking: boolean;
		toolUse: boolean;
		streaming: boolean;
	};
}

/** Full definition of an LLM provider including its models, auth, and streaming interface. */
export interface ProviderDefinition {
	id: string;
	name: string;
	models: ModelDefinition[];
	auth: AuthConfig;
	stream(
		model: string,
		context: Context,
		options: StreamOptions,
	): AsyncIterable<StreamEvent>;
	validateKey?(key: string): Promise<boolean>;
}
