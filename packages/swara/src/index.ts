/**
 * @chitragupta/swara — AI/LLM abstraction layer.
 *
 * Provides unified streaming across all LLM providers with a
 * plugin-based architecture.
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
	TextContent,
	ImageContent,
	ToolCallContent,
	ToolResultContent,
	ThinkingContent,
	ContentPart,
	Message,
	Context,
	ToolDefinition,
	StreamOptions,
	StreamEvent,
	AuthConfig,
	ModelDefinition,
	ProviderDefinition,
} from "./types.js";

// ─── Provider Registry ──────────────────────────────────────────────────────
/** Create a provider registry to register and resolve LLM backends by name. */
export { createProviderRegistry } from "./provider-registry.js";
export type { ProviderRegistry } from "./provider-registry.js";

// ─── Streaming ──────────────────────────────────────────────────────────────
/** Unified streaming interface across all LLM providers with event-based output. */
export {
	stream,
	collectStream,
	setDefaultRegistry,
	getDefaultRegistry,
} from "./stream.js";
export type { CollectedStream } from "./stream.js";

// ─── Cost Tracking ──────────────────────────────────────────────────────────
/** Track and calculate token costs across providers and models. */
export { CostTracker, calculateCost } from "./cost-tracker.js";

// ─── Token Counting ─────────────────────────────────────────────────────────
/** Estimate token counts and context window usage for messages and prompts. */
export {
	estimateTokens,
	estimateMessagesTokens,
	fitsInContext,
	contextUsagePercent,
} from "./token-counter.js";

// ─── SSE Parser ─────────────────────────────────────────────────────────────
/** Parse Server-Sent Events streams into typed events. */
export { parseSSEStream } from "./sse.js";
export type { SSEEvent } from "./sse.js";

// ─── Retry ───────────────────────────────────────────────────────────────────
/** Exponential-backoff retry with jitter for transient LLM provider errors. */
export {
	retryableStream,
	isRetryableError,
	parseRetryAfter,
	computeDelay,
	DEFAULT_RETRY_CONFIG,
} from "./retry.js";
export type { RetryConfig, RetryEvent, RetryEventHandler } from "./retry.js";

// ─── Rate Limiting ──────────────────────────────────────────────────────────
/** Token-bucket rate limiter with per-provider request throttling. */
export { TokenBucketLimiter, DEFAULT_RATE_LIMITS } from "./rate-limiter.js";
export type { RateLimitConfig, RequestPriority } from "./rate-limiter.js";

// ─── Request Queue ──────────────────────────────────────────────────────────
/** Priority request queue with concurrency control and backpressure. */
export { RequestQueue, DEFAULT_QUEUE_CONFIG } from "./request-queue.js";
export type {
	RequestQueueConfig,
	QueuePriority,
	QueueStats,
	RequestHandle,
} from "./request-queue.js";

// ─── Error Recovery ─────────────────────────────────────────────────────────
/** Circuit breaker and resilient streaming with automatic provider error classification. */
export {
	parseProviderError,
	toChitraguptaError,
	CircuitBreaker,
	resilientStream,
	DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from "./error-recovery.js";
export type {
	ParsedProviderError,
	ProviderErrorType,
	CircuitBreakerConfig,
	ResilientStreamOptions,
} from "./error-recovery.js";

// ─── Process Pool ───────────────────────────────────────────────────────────
/** Child-process pool for CPU-bound work (embedding, tokenization) with auto-scaling. */
export { ProcessPool } from "./process-pool.js";
export type { ProcessResult, ProcessPoolConfig } from "./process-pool.js";

// ─── Model Router ───────────────────────────────────────────────────────────
/** Tiered model router that selects the best model based on task complexity. */
export {
	ModelRouter,
	DEFAULT_TIERS,
	CLOUD_TIERS,
} from "./router.js";
export type {
	ModelTier,
	RoutingDecision,
	ModelRouterConfig,
} from "./router.js";

// ─── Complexity Classifier (Vichara) ────────────────────────────────────────
/** Classify task complexity (trivial/simple/moderate/complex) from message content. */
export { classifyComplexity } from "./router-classifier.js";
export type {
	TaskComplexity,
	ClassificationResult,
} from "./router-classifier.js";

// ─── Task-Type Classifier (Pravritti) ───────────────────────────────────────
/** Classify task type (code, chat, analysis, etc.) and resolve to model bindings. */
export { classifyTaskType, RESOLUTION_MAP, LOCAL_BINDINGS, CLOUD_BINDINGS, HYBRID_BINDINGS } from "./router-task-type.js";
export type {
	TaskType,
	ResolutionPath,
	CheckinSubtype,
	TaskTypeResult,
	TaskModelBinding,
} from "./router-task-type.js";

// ─── Routing Pipeline (Marga) ───────────────────────────────────────────────
/** End-to-end routing pipeline: classify complexity, detect task type, select model. */
export { MargaPipeline } from "./router-pipeline.js";
export type {
	PipelineDecision,
	MargaPipelineConfig,
} from "./router-pipeline.js";

// ─── Marga Decision API (stable contract for Vaayu) ─────────────────────────
/** Stable versioned decision API for Vaayu gateway model routing integration. */
export { margaDecide, MARGA_CONTRACT_VERSION, MARGA_DEFAULT_PROVIDER, MARGA_DEFAULT_MODEL, ESCALATION_CHAIN } from "./marga-decide.js";
export type { MargaDecideRequest, MargaDecision } from "./marga-decide.js";

// ─── Environment Detection ──────────────────────────────────────────────────
/** Detect runtime environment: GPU availability, API keys, and recommended provider. */
export {
	detectEnvironment,
	detectGPU,
	probeBackends,
	detectApiKeys,
	getRecommendedProvider,
} from "./env-detection.js";
export type {
	GPUInfo,
	BackendAvailability,
	Environment,
} from "./env-detection.js";

// ─── Embeddings ─────────────────────────────────────────────────────────────
/** Create embedding providers for Ollama, OpenAI, and local ONNX models. */
export {
	createOllamaEmbeddings,
	createOpenAIEmbeddings,
	createOnnxEmbeddings,
	createEmbeddingProvider,
	EMBEDDING_MODELS,
} from "./embeddings.js";
export type {
	EmbeddingModel,
	EmbeddingResult,
	EmbeddingProvider,
	OllamaEmbeddingOptions,
	OpenAIEmbeddingOptions,
	OnnxEmbeddingOptions,
} from "./embeddings.js";

// ─── Turiya — Meta-Observer & Contextual Model Router ───────────────────
/** Meta-observer router that adapts model selection based on session context and budget. */
export { TuriyaRouter } from "./turiya.js";
export type {
	TuriyaContext,
	TuriyaTier,
	TuriyaDecision,
	TuriyaTierStats,
	TuriyaStats,
	TuriyaState,
	TuriyaRouterConfig,
	ManasFeatureBridge,
	TuriyaPreference,
	TuriyaCascadeResult,
} from "./turiya.js";

// ─── Turiya Math (public for Vaayu bridge) ──────────────────────────────
/** Budget-aware scoring and preference blending math for Turiya routing decisions. */
export {
	budgetAdjustedScore,
	updateBudgetLambda,
	preferenceBlendedScore,
} from "./turiya-math.js";

// ─── Completion Router (Provider-Agnostic LLM Adapter) ──────────────────────
/** Provider-agnostic completion router for calling any LLM without Vaayu. */
export { CompletionRouter, NoProviderError, CompletionTimeoutError, FallbackExhaustedError } from "./completion-router.js";
export type {
	CompletionRequest,
	CompletionResponse,
	CompletionStreamChunk,
	CompletionMessage,
	CompletionContentPart,
	CompletionToolCall,
	CompletionToolDefinition,
	CompletionStopReason,
	CompletionUsage,
	CompletionRouterConfig,
	LLMProvider,
} from "./completion-types.js";

// ─── Completion Adapters ────────────────────────────────────────────────────
/** Provider-agnostic adapters for direct LLM completion. */
export { createAnthropicAdapter } from "./providers/anthropic-adapter.js";
export { createOpenAIAdapter } from "./providers/openai-adapter.js";

// ─── Providers ──────────────────────────────────────────────────────────────
export {
	openaiProvider,
	anthropicProvider,
	googleProvider,
	ollamaProvider,
	createOpenAICompatProvider,
	registerBuiltinProviders,
	// CLI Providers
	createCLIProvider,
	claudeCodeProvider,
	codexProvider,
	geminiCLIProvider,
	aiderProvider,
	contextToPrompt,
	detectAvailableCLIs,
	getBestCLIProvider,
	// Prebuilt Configs
	PREBUILT_PROVIDERS,
	registerPrebuiltProviders,
	createVLLM,
	createLMStudio,
	createLocalAI,
	createLlamaCpp,
} from "./providers/index.js";
export type {
	OpenAICompatConfig,
	CLIProviderConfig,
	CLIAvailability,
	PrebuiltProviderEntry,
	LocalServerOptions,
} from "./providers/index.js";
