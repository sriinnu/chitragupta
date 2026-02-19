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
export { createProviderRegistry } from "./provider-registry.js";
export type { ProviderRegistry } from "./provider-registry.js";

// ─── Streaming ──────────────────────────────────────────────────────────────
export {
	stream,
	collectStream,
	setDefaultRegistry,
	getDefaultRegistry,
} from "./stream.js";
export type { CollectedStream } from "./stream.js";

// ─── Cost Tracking ──────────────────────────────────────────────────────────
export { CostTracker, calculateCost } from "./cost-tracker.js";

// ─── Token Counting ─────────────────────────────────────────────────────────
export {
	estimateTokens,
	estimateMessagesTokens,
	fitsInContext,
	contextUsagePercent,
} from "./token-counter.js";

// ─── SSE Parser ─────────────────────────────────────────────────────────────
export { parseSSEStream } from "./sse.js";
export type { SSEEvent } from "./sse.js";

// ─── Retry ───────────────────────────────────────────────────────────────────
export {
	retryableStream,
	isRetryableError,
	parseRetryAfter,
	computeDelay,
	DEFAULT_RETRY_CONFIG,
} from "./retry.js";
export type { RetryConfig, RetryEvent, RetryEventHandler } from "./retry.js";

// ─── Rate Limiting ──────────────────────────────────────────────────────────
export { TokenBucketLimiter, DEFAULT_RATE_LIMITS } from "./rate-limiter.js";
export type { RateLimitConfig, RequestPriority } from "./rate-limiter.js";

// ─── Request Queue ──────────────────────────────────────────────────────────
export { RequestQueue, DEFAULT_QUEUE_CONFIG } from "./request-queue.js";
export type {
	RequestQueueConfig,
	QueuePriority,
	QueueStats,
	RequestHandle,
} from "./request-queue.js";

// ─── Error Recovery ─────────────────────────────────────────────────────────
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
export { ProcessPool } from "./process-pool.js";
export type { ProcessResult, ProcessPoolConfig } from "./process-pool.js";

// ─── Model Router ───────────────────────────────────────────────────────────
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
export { classifyComplexity } from "./router-classifier.js";
export type {
	TaskComplexity,
	ClassificationResult,
} from "./router-classifier.js";

// ─── Task-Type Classifier (Pravritti) ───────────────────────────────────────
export { classifyTaskType, RESOLUTION_MAP, LOCAL_BINDINGS, CLOUD_BINDINGS, HYBRID_BINDINGS } from "./router-task-type.js";
export type {
	TaskType,
	ResolutionPath,
	CheckinSubtype,
	TaskTypeResult,
	TaskModelBinding,
} from "./router-task-type.js";

// ─── Routing Pipeline (Marga) ───────────────────────────────────────────────
export { MargaPipeline } from "./router-pipeline.js";
export type {
	PipelineDecision,
	MargaPipelineConfig,
} from "./router-pipeline.js";

// ─── Marga Decision API (stable contract for Vaayu) ─────────────────────────
export { margaDecide, MARGA_CONTRACT_VERSION, ESCALATION_CHAIN } from "./marga-decide.js";
export type { MargaDecideRequest, MargaDecision } from "./marga-decide.js";

// ─── Environment Detection ──────────────────────────────────────────────────
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
export {
	createOllamaEmbeddings,
	createOpenAIEmbeddings,
	createEmbeddingProvider,
	EMBEDDING_MODELS,
} from "./embeddings.js";
export type {
	EmbeddingModel,
	EmbeddingResult,
	EmbeddingProvider,
	OllamaEmbeddingOptions,
	OpenAIEmbeddingOptions,
} from "./embeddings.js";

// ─── Turiya — Meta-Observer & Contextual Model Router ───────────────────
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
} from "./turiya.js";

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
