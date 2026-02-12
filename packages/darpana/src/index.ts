/**
 * @chitragupta/darpana — High-performance LLM API proxy.
 *
 * Darpana (दर्पण) = mirror — reflects/proxies Anthropic-format API calls
 * to any LLM provider (OpenAI, Gemini, Groq, Ollama, etc.).
 */

// Server
export { createServer } from "./server.js";
export type { DarpanaServer } from "./server.js";

// Config
export { loadConfig, detectCredentialSources } from "./config.js";
export type { LoadConfigOptions } from "./config.js";

// Router
export { resolveRoute } from "./router.js";

// Converters
export { toOpenAI, fromOpenAI, processOpenAIChunk, createStreamState } from "./converters/openai.js";
export { toGemini, fromGemini, buildGeminiUrl, processGeminiChunk, createGeminiStreamState } from "./converters/google.js";
export { toPassthrough, fromPassthrough } from "./converters/passthrough.js";

// Stream
export { pipeStream } from "./stream.js";

// Upstream
export { sendUpstream, buildUpstreamUrl, buildUpstreamHeaders } from "./upstream.js";

// Types
export type {
	AnthropicRequest,
	AnthropicResponse,
	AnthropicMessage,
	AnthropicContentBlock,
	AnthropicSSEEvent,
	AnthropicTool,
	AnthropicToolChoice,
	AnthropicUsage,
	OpenAIRequest,
	OpenAIResponse,
	OpenAIStreamChunk,
	GeminiRequest,
	GeminiResponse,
	ProviderConfig,
	DarpanaConfig,
	ResolvedRoute,
	ConverterType,
	ModelOverrides,
} from "./types.js";
