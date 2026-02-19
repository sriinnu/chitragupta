# @chitragupta/swara

![Logo](../../assets/logos/swara.svg)

**स्वर (svara) -- Voice**

**Unified LLM provider abstraction with streaming, retries, rate limiting, cost tracking, contextual model routing, and error recovery.**

Swara is the voice of Chitragupta. It provides a single `stream()` call that works identically across Anthropic, OpenAI, Google, Ollama, and any OpenAI-compatible endpoint. It handles the ugly details -- SSE parsing, retry with exponential backoff, circuit breakers, token bucket rate limiting, request queuing, and cost tracking -- so the rest of the system can focus on what to say, not how to say it.

The new **Turiya** meta-observer brings intelligent model routing to the stack: a 7-dimensional context vector feeds a LinUCB contextual bandit that learns which tier (no-llm, haiku, sonnet, opus) is optimal for each request, slashing cost without sacrificing quality.

---

## Key Features

- **Multi-provider streaming** -- Anthropic, OpenAI, Google, Ollama, and custom OpenAI-compatible endpoints
- **Provider registry** -- Plugin-based architecture for registering and switching providers at runtime
- **Retry with backoff** -- Configurable retry with exponential backoff, jitter, and `Retry-After` header parsing
- **Circuit breaker** -- Automatic failure detection with half-open recovery via `CircuitBreaker`
- **Rate limiting** -- Token bucket limiter with priority-based request queuing
- **Cost tracking** -- Per-call and cumulative cost calculation across all providers
- **Token counting** -- Estimation utilities for context window management (`fitsInContext`, `contextUsagePercent`)
- **SSE parsing** -- Robust server-sent events parser for streaming responses
- **Resilient streaming** -- `resilientStream()` combines retry, circuit breaker, and rate limiting in one call
- **Turiya meta-observer** -- LinUCB contextual bandit for intelligent 4-tier model routing with Thompson Sampling feedback
- **Marga pipeline** -- Task-type classification (15 types) + complexity analysis + model selection in a single zero-cost call
- **Embedding providers** -- Unified embedding interface across Ollama and OpenAI with batch support
- **Process pool** -- Bounded concurrent CLI process execution with FIFO queuing and graceful shutdown
- **Environment detection** -- Auto-detect GPU, inference backends, and API keys for optimal provider selection

## Architecture

```
@chitragupta/swara
├── types.ts              Message, Context, StreamEvent, ProviderDefinition, AuthConfig
├── provider-registry.ts  createProviderRegistry() — register/resolve providers
├── stream.ts             stream() and collectStream() — primary streaming API
├── cost-tracker.ts       CostTracker class and calculateCost() utility
├── token-counter.ts      estimateTokens(), fitsInContext(), contextUsagePercent()
├── retry.ts              retryableStream(), isRetryableError(), computeDelay()
├── rate-limiter.ts       TokenBucketLimiter with priority queuing
├── request-queue.ts      RequestQueue for ordered request processing
├── error-recovery.ts     CircuitBreaker, resilientStream(), parseProviderError()
├── sse.ts                parseSSEStream() for raw SSE event parsing
├── turiya.ts             ★ NEW — Turiya meta-observer (LinUCB contextual bandit)
├── router.ts             ModelRouter — tier-based routing with auto-escalation
├── router-classifier.ts  classifyComplexity() — pattern-based complexity scoring
├── router-task-type.ts   classifyTaskType() — 15 task-type detection (Pravritti)
├── router-pipeline.ts    MargaPipeline — unified intent → complexity → model pipeline
├── embeddings.ts         Ollama & OpenAI embedding providers with batch support
├── env-detection.ts      GPU, backend, and API key detection
├── process-pool.ts       ProcessPool — bounded concurrent CLI execution
└── providers/            Built-in provider implementations (Anthropic, OpenAI, etc.)
```

## API

### Basic Streaming

```typescript
import { stream, collectStream } from "@chitragupta/swara";

// Stream token by token
const events = stream({
  model: "claude-sonnet-4-5-20250929",
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
});

for await (const event of events) {
  if (event.type === "text") {
    process.stdout.write(event.text);
  }
}

// Or collect the full response
const result = await collectStream({
  model: "claude-sonnet-4-5-20250929",
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
});

console.log(result.text);
console.log(result.usage); // { inputTokens, outputTokens, ... }
```

### Provider Registry

```typescript
import {
  createProviderRegistry,
  openaiProvider,
  anthropicProvider,
  registerBuiltinProviders,
} from "@chitragupta/swara";

const registry = createProviderRegistry();
registerBuiltinProviders(registry);

// Or register individually
registry.register(openaiProvider);
registry.register(anthropicProvider);
```

### Cost Tracking

```typescript
import { CostTracker, calculateCost } from "@chitragupta/swara";

const tracker = new CostTracker();

// After each stream completes
tracker.add(usage, "claude-sonnet-4-5-20250929");

console.log(tracker.total);     // Total cost in USD
console.log(tracker.breakdown); // Per-model breakdown
```

### Resilient Streaming

```typescript
import { resilientStream } from "@chitragupta/swara";

// Combines retry + circuit breaker + rate limiting
const events = resilientStream({
  model: "claude-sonnet-4-5-20250929",
  messages,
  retryConfig: { maxRetries: 3 },
  circuitBreakerConfig: { failureThreshold: 5 },
});

for await (const event of events) {
  // Automatically retries on transient failures
}
```

### Token Counting

```typescript
import {
  estimateTokens,
  fitsInContext,
  contextUsagePercent,
} from "@chitragupta/swara";

const tokens = estimateTokens("Hello, world!");
const fits = fitsInContext(messages, "claude-sonnet-4-5-20250929");
const usage = contextUsagePercent(messages, "claude-sonnet-4-5-20250929");
```

---

### Turiya (तुरीय) -- Meta-Observer & Contextual Model Router

**File:** `turiya.ts` | **NEW in Phase 1**

In Vedic philosophy, *Turiya* is the "fourth state" -- pure consciousness that witnesses waking, dreaming, and deep sleep without being affected. It is the sakshi (witness) that observes without being observed.

In Chitragupta, Turiya is the meta-observer that makes intelligent model routing decisions based on a **7-dimensional context vector**, using **LinUCB** (contextual linear bandit) to learn optimal tier assignment from experience.

#### The 7 Dimensions

| Dimension | Description | Signal Source |
|-----------|-------------|---------------|
| `complexity` | Task difficulty [0, 1] | Token count, code presence, multi-step indicators |
| `urgency` | Response urgency [0, 1] | Time constraints, error context |
| `creativity` | Creative freedom needed [0, 1] | Brainstorming, open-ended questions |
| `precision` | Accuracy requirement [0, 1] | Math, code review, factual queries |
| `codeRatio` | Code-to-prose ratio [0, 1] | Code blocks, file references |
| `conversationDepth` | Normalized turn count [0, 1] | How far into the conversation |
| `memoryLoad` | Context/memory needed [0, 1] | Retrieval count, memory hits |

#### LinUCB Algorithm

For each arm *a* (tier), Turiya maintains `A_a` (d x d) and `b_a` (d x 1):

```
theta_a = A_a^{-1} * b_a           (learned weights)
UCB(a, x) = theta_a^T * x + alpha * sqrt(x^T * A_a^{-1} * x)
Select: argmax_a UCB(a, x)
Update: A_a += x * x^T, b_a += reward * x
```

Reference: Li et al. (2010), "A contextual-bandit approach to personalized news article recommendation."

#### 4 Routing Tiers

| Tier | Description | Typical Models |
|------|-------------|----------------|
| `no-llm` | Pure tool execution, zero tokens | Local search, file ops |
| `haiku` | Fast model for simple queries | Claude Haiku, llama3.2:1b |
| `sonnet` | Standard model for typical work | Claude Sonnet, qwen2.5-coder:7b |
| `opus` | Full model for complex reasoning | Claude Opus |

```typescript
import { Turiya } from "@chitragupta/swara";
import type { TuriyaContext, TuriyaDecision, TuriyaStats } from "@chitragupta/swara";

const turiya = new Turiya({ alpha: 1.5 });

// Classify a request
const context: TuriyaContext = turiya.extractContext(messages);
const decision: TuriyaDecision = turiya.classify(context);
console.log(decision.tier);        // "sonnet"
console.log(decision.confidence);  // 0.82
console.log(decision.costEstimate); // 0.003
console.log(decision.rationale);   // "Medium complexity code task → sonnet tier"

// Record outcome for learning
turiya.recordOutcome(decision.armIndex, 0.9); // reward in [0, 1]

// Get cumulative routing statistics
const stats: TuriyaStats = turiya.getStats();
console.log(stats.totalRequests);   // 150
console.log(stats.totalCostSaved);  // 12.50 USD saved vs. always-opus
console.log(stats.tierStats);       // Per-tier call counts, costs, rewards

// Serialize / restore state
const state = turiya.serialize();
const restored = Turiya.deserialize(state);
```

---

### Model Router (Marga)

Marga routes each request to the cheapest adequate model by classifying task complexity. Supports local-first and all-cloud strategies with automatic escalation on failure.

```typescript
import {
  ModelRouter,
  DEFAULT_TIERS,
  CLOUD_TIERS,
  classifyComplexity,
} from "@chitragupta/swara";

// Classify request complexity (zero-cost, pattern-based)
const result = classifyComplexity(context);
// -> { complexity: "medium", reason: "Matched: code-related keywords", confidence: 0.85 }

// Create a router with local-first tiers
const router = new ModelRouter({
  tiers: DEFAULT_TIERS,
  registry,
  autoEscalate: true,
  maxEscalations: 2,
});

// Route: picks cheapest model that can handle the complexity
const decision = router.route(context);
// -> trivial: llama3.2:1b, simple: llama3.2:3b, medium: qwen2.5-coder:7b,
//   complex: claude-sonnet, expert: claude-opus

// Stream with auto-escalation on failure
for await (const event of router.complete(context)) {
  // If the selected model fails, automatically escalates to the next tier
}
```

### Task-Type Classification (Pravritti)

Pravritti detects WHAT the user wants -- not just how hard it is:

```typescript
import { classifyTaskType, MargaPipeline, HYBRID_BINDINGS } from "@chitragupta/swara";

// 15 task types: chat, code-gen, reasoning, search, embedding, vision,
//   tool-exec, heartbeat, smalltalk, summarize, translate, memory, file-op, api-call, compaction

const taskType = classifyTaskType(context);
// -> { type: "code-gen", resolution: "llm-with-tools", confidence: 0.9 }

// Full pipeline: intent + complexity + model selection
const pipeline = new MargaPipeline({ registry, bindings: HYBRID_BINDINGS });
const decision = pipeline.classify(context);
// -> { taskType: "search", skipLLM: true }  — zero tokens for search!
// -> { taskType: "code-gen", modelId: "qwen2.5-coder:7b" }  — local model for code
// -> { taskType: "reasoning", modelId: "claude-sonnet-4-5-20250929" }  — cloud for reasoning
```

### Embedding Providers

Unified embedding interface across local (Ollama) and cloud (OpenAI) backends:

```typescript
import {
  createEmbeddingProvider,
  EMBEDDING_MODELS,
} from "@chitragupta/swara";

// Local embeddings via Ollama
const local = createEmbeddingProvider("ollama", {
  model: "nomic-embed-text", // 768d, 8192 tokens
});

// Cloud embeddings via OpenAI
const cloud = createEmbeddingProvider("openai", {
  model: "text-embedding-3-small", // 1536d
});

// Single embedding
const result = await local.embed("Hello world");
console.log(result.embedding.length); // 768

// Batch embedding
const results = await local.embedBatch(["text1", "text2", "text3"]);

// Available models
console.log(EMBEDDING_MODELS);
// nomic-embed-text (768d), mxbai-embed-large (1024d), bge-m3 (1024d),
// text-embedding-3-small (1536d), text-embedding-3-large (3072d)
```

### Process Pool

Bounded pool for concurrent CLI process execution with FIFO queuing and graceful timeout handling:

```typescript
import { ProcessPool } from "@chitragupta/swara";

const pool = new ProcessPool({
  maxConcurrency: 5,
  defaultTimeout: 30_000,
});

// Execute a command
const result = await pool.execute("node", ["-e", "console.log('hello')"]);
console.log(result.stdout);   // "hello\n"
console.log(result.exitCode); // 0

// Timeout: SIGTERM -> 3s grace -> SIGKILL
const slow = await pool.execute("sleep", ["60"], { timeout: 1000 });
console.log(slow.killed); // true

// Pool stats
console.log(pool.getStats()); // { active: 0, queued: 0, completed: 2, failed: 0 }

// Drain all pending work
await pool.drain();
```

### Environment Detection

Auto-detect GPU, running inference backends, and API keys for optimal provider selection:

```typescript
import {
  detectEnvironment,
  getRecommendedProvider,
  detectGPU,
  probeBackends,
  detectApiKeys,
} from "@chitragupta/swara";

// Full environment snapshot
const env = await detectEnvironment();
console.log(env.gpu);       // { vendor: "apple", name: "Apple Silicon" }
console.log(env.backends);  // { ollama: true, vllm: false, localai: false, lmstudio: false }
console.log(env.apiKeys);   // ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]

// Recommended provider based on environment
const provider = getRecommendedProvider(env);
// Priority: Apple Silicon -> "ollama", NVIDIA+vLLM -> "vllm",
//   Ollama available -> "ollama", API keys -> "anthropic"/"openai"
```

## Test Coverage

| Module | Tests |
|--------|-------|
| Providers, streaming, retry | 27 test files |
| Turiya meta-observer | Included |
| Marga pipeline & router | Included |
| Embeddings & process pool | Included |
| **Total** | 27 test files, 0 failures |

---

[Back to Chitragupta root](../../README.md)
