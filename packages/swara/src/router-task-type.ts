/**
 * Pravritti — Task-type classifier.
 *
 * While Vichara asks "how hard is this?", Pravritti asks "what KIND of task
 * is this?" — embedding, code generation, search, vision, heartbeat, etc.
 *
 * Named "Pravritti" (Sanskrit: प्रवृत्ति — activity, inclination, the nature
 * of action). Every action has a pravritti — the type of work it demands.
 *
 * The classifier uses layered pattern matching on the user's message to
 * determine the task type. Each type maps to a recommended model class,
 * allowing the router to pick the RIGHT model (not just the cheapest).
 *
 * Example: "embed this document" → embedding → nomic-embed-text (local)
 *          "write a parser"      → code-gen  → qwen2.5-coder:7b (local)
 *          "explain the design"  → reasoning → claude-sonnet (cloud)
 */

import type { Context, StreamOptions } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Discrete task types. Each maps to a different resolution path —
 * some need LLMs, some need tools only, some are pure local compute.
 */
export type TaskType =
	| "chat"        // General conversation, Q&A → LLM
	| "code-gen"    // Writing, editing, or debugging code → LLM
	| "reasoning"   // Analysis, architecture, design, trade-offs → LLM
	| "search"      // BM25, vector search, retrieval → TOOL ONLY (no LLM)
	| "embedding"   // Text → vector → EMBEDDING MODEL (not chat model)
	| "vision"      // Image analysis → MULTIMODAL LLM
	| "tool-exec"   // Direct tool execution → TOOL ONLY (no LLM)
	| "heartbeat"   // Health check, ping, status → CHEAPEST possible
	| "summarize"   // Compress, summarize, extract → LLM
	| "translate"   // Language translation → LLM
	| "memory"      // Memory recall, session lookup → LOCAL ONLY (no LLM, no cloud)
	| "file-op"     // File read, write, list, grep → TOOL ONLY (no LLM)
	| "api-call"    // External API (Gmail, Slack, etc.) → TOOL ONLY (no LLM)
	| "compaction"; // Context compaction, budget allocation → LOCAL COMPUTE (Sinkhorn etc.)

/**
 * How a task should be resolved.
 * This is the KEY insight: not everything needs an LLM.
 */
export type ResolutionPath =
	| "llm"           // Needs a language model (generation, reasoning)
	| "llm-with-tools" // LLM generates, but calls tools during generation
	| "tool-only"     // Tool handles it directly. Zero tokens spent.
	| "local-compute" // Pure local algorithm (Sinkhorn, BM25, PageRank). Zero tokens.
	| "embedding"     // Needs an embedding model specifically, not a chat model.
	| "cheapest-llm"; // Needs an LLM but the absolute cheapest one suffices.

/** Maps each task type to its resolution path. */
export const RESOLUTION_MAP: Record<TaskType, ResolutionPath> = {
	"chat":        "llm",
	"code-gen":    "llm-with-tools",
	"reasoning":   "llm",
	"search":      "local-compute",
	"embedding":   "embedding",
	"vision":      "llm",
	"tool-exec":   "tool-only",
	"heartbeat":   "cheapest-llm",
	"summarize":   "llm",
	"translate":   "llm",
	"memory":      "local-compute",
	"file-op":     "tool-only",
	"api-call":    "tool-only",
	"compaction":  "local-compute",
};

/** Result of task-type classification. */
export interface TaskTypeResult {
	/** The detected task type. */
	type: TaskType;
	/** How this task should be resolved. */
	resolution: ResolutionPath;
	/** Human-readable explanation. */
	reason: string;
	/** Confidence in the classification [0.0, 1.0]. */
	confidence: number;
	/** Secondary type if ambiguous (e.g. code-gen + reasoning). */
	secondary?: TaskType;
}

/**
 * Model recommendation for a task type.
 * Maps each task type to a specific model class.
 */
export interface TaskModelBinding {
	/** The task type this binding serves. */
	taskType: TaskType;
	/** Provider ID. */
	providerId: string;
	/** Model ID. */
	modelId: string;
	/** Why this model for this task type. */
	rationale: string;
}

// ─── Pattern Definitions ────────────────────────────────────────────────────

interface TypeSignal {
	type: TaskType;
	weight: number;
	label: string;
	test: (text: string, wordCount: number, hasTools: boolean, hasImages: boolean) => boolean;
}

// Patterns grouped by task type
const EMBEDDING_PATTERNS = /\b(embed|embedding|vector|vectorize|encode|encode\s+text|similarity|semantic\s+search|nearest\s+neighbor|cosine)\b/i;
const SEARCH_PATTERNS = /\b(search|find|look\s+up|retrieve|query|where\s+is|locate|grep|list\s+all|show\s+me\s+all|BM25|full.?text)\b/i;
const VISION_PATTERNS = /\b(image|screenshot|picture|photo|visual|pixel|diagram|render|draw|chart|look\s+at\s+this|what\s+do\s+you\s+see|describe\s+this\s+image)\b/i;
const CODE_PATTERNS = /\b(function|class|import|export|implement|code|write\s+a|create\s+a|debug|fix\s+the\s+bug|refactor|compile|typescript|python|javascript|rust|go|api\s+endpoint|unit\s+test|test\s+for)\b/i;
const REASONING_PATTERNS = /\b(analyze|compare|evaluate|design|trade-?offs?|pros?\s+and\s+cons?|architecture|investigate|explain\s+why|how\s+does|should\s+we|recommend|strategy|approach|plan|review)\b/i;
const SUMMARIZE_PATTERNS = /\b(summarize|summary|tldr|tl;dr|condense|compress|key\s+points|brief|overview|recap|digest|extract\s+the)\b/i;
const TRANSLATE_PATTERNS = /\b(translate|translation|in\s+spanish|in\s+french|in\s+german|in\s+hindi|in\s+japanese|to\s+english|from\s+english|localize|i18n)\b/i;
const HEARTBEAT_PATTERNS = /^(ping|health|status|alive|heartbeat|are\s+you\s+there|hello|hi|hey|ok|ack)\s*[\?\!]?\s*$/i;
const TOOL_PATTERNS = /\b(run\s+the|execute|call|invoke|use\s+the\s+tool|bash|shell|terminal|command|mkdir|npm|git|pip|docker)\b/i;
const MEMORY_PATTERNS = /\b(remember|recall|what\s+did\s+(i|we)|last\s+session|previous\s+conversation|my\s+preference|session\s+history|show\s+memory|list\s+sessions|search\s+sessions|what\s+do\s+you\s+know\s+about\s+me)\b/i;
const FILE_OP_PATTERNS = /\b(read\s+file|write\s+file|list\s+files|show\s+files|cat\s+|head\s+|tail\s+|ls\s+|find\s+files|grep\s+for|open\s+file|create\s+file|delete\s+file|rename\s+file|move\s+file|copy\s+file)\b/i;
const API_CALL_PATTERNS = /\b(get\s+(my\s+)?emails?|check\s+(my\s+)?inbox|send\s+(an?\s+)?email|slack\s+message|post\s+to|fetch\s+from|api\s+call|webhook|calendar|schedule|reminder|notification)\b/i;
const COMPACTION_PATTERNS = /\b(compact|compaction|token\s+budget|sinkhorn|allocat|context\s+window|trim\s+context|reduce\s+context|free\s+up\s+tokens)\b/i;

const TYPE_SIGNALS: TypeSignal[] = [
	// ── Heartbeat (highest priority — if it matches, it's almost always right) ──
	{
		type: "heartbeat",
		weight: 10,
		label: "heartbeat/ping pattern",
		test: (text) => HEARTBEAT_PATTERNS.test(text.trim()),
	},

	// ── Embedding ──
	{
		type: "embedding",
		weight: 8,
		label: "embedding/vector keywords",
		test: (text) => EMBEDDING_PATTERNS.test(text),
	},

	// ── Vision ──
	{
		type: "vision",
		weight: 7,
		label: "image/visual content",
		test: (_text, _wc, _hasTools, hasImages) => hasImages,
	},
	{
		type: "vision",
		weight: 5,
		label: "vision keywords",
		test: (text) => VISION_PATTERNS.test(text),
	},

	// ── Search ──
	{
		type: "search",
		weight: 6,
		label: "search/retrieval keywords",
		test: (text) => SEARCH_PATTERNS.test(text),
	},

	// ── Tool Execution ──
	{
		type: "tool-exec",
		weight: 5,
		label: "tool/command execution",
		test: (text, _wc, hasTools) => hasTools && TOOL_PATTERNS.test(text),
	},

	// ── Code Generation ──
	{
		type: "code-gen",
		weight: 5,
		label: "code generation keywords",
		test: (text) => CODE_PATTERNS.test(text),
	},

	// ── Summarize ──
	{
		type: "summarize",
		weight: 5,
		label: "summarization keywords",
		test: (text) => SUMMARIZE_PATTERNS.test(text),
	},

	// ── Translate ──
	{
		type: "translate",
		weight: 5,
		label: "translation keywords",
		test: (text) => TRANSLATE_PATTERNS.test(text),
	},

	// ── Memory (local recall, zero tokens) ──
	{
		type: "memory",
		weight: 7,
		label: "memory/session recall",
		test: (text) => MEMORY_PATTERNS.test(text),
	},

	// ── File Operations (tool only, zero tokens) ──
	{
		type: "file-op",
		weight: 7,
		label: "file read/write/list",
		test: (text) => FILE_OP_PATTERNS.test(text),
	},

	// ── API Calls (tool only, zero tokens) ──
	{
		type: "api-call",
		weight: 7,
		label: "external API call (email, slack, etc.)",
		test: (text) => API_CALL_PATTERNS.test(text),
	},

	// ── Compaction (local compute, zero tokens) ──
	{
		type: "compaction",
		weight: 8,
		label: "context compaction / budget allocation",
		test: (text) => COMPACTION_PATTERNS.test(text),
	},

	// ── Reasoning (broad, catches analytical work) ──
	{
		type: "reasoning",
		weight: 4,
		label: "reasoning/analysis keywords",
		test: (text) => REASONING_PATTERNS.test(text),
	},

	// ── Chat (default fallback — always matches) ──
	{
		type: "chat",
		weight: 1,
		label: "general conversation",
		test: () => true,
	},
];

// ─── Classifier ─────────────────────────────────────────────────────────────

/**
 * Classify the TASK TYPE of a request by analyzing the user's message.
 *
 * Unlike Vichara (complexity), Pravritti determines WHAT the user wants:
 * - embed text → embedding model
 * - write code → code model
 * - search files → BM25/vector, maybe no LLM
 * - heartbeat → cheapest model alive
 *
 * @param context - The conversation context.
 * @param _options - Reserved for future weighting.
 * @returns A {@link TaskTypeResult} with the detected type and confidence.
 */
export function classifyTaskType(context: Context, _options?: StreamOptions): TaskTypeResult {
	const lastUserMsg = [...context.messages].reverse().find((m) => m.role === "user");
	const text = lastUserMsg
		? lastUserMsg.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join(" ")
		: "";

	const wordCount = text.split(/\s+/).filter(Boolean).length;
	const hasTools = Array.isArray(context.tools) && context.tools.length > 0;
	const hasImages = lastUserMsg
		? lastUserMsg.content.some((p) => p.type === "image")
		: false;

	// Score each task type — highest total weight wins
	const scores = new Map<TaskType, { total: number; labels: string[] }>();

	for (const signal of TYPE_SIGNALS) {
		if (signal.test(text, wordCount, hasTools, hasImages)) {
			const entry = scores.get(signal.type) ?? { total: 0, labels: [] };
			entry.total += signal.weight;
			entry.labels.push(signal.label);
			scores.set(signal.type, entry);
		}
	}

	// Sort by score descending
	const ranked = [...scores.entries()].sort((a, b) => b[1].total - a[1].total);

	if (ranked.length === 0) {
		return { type: "chat", resolution: "llm", reason: "No signals matched", confidence: 0.5 };
	}

	const [topType, topEntry] = ranked[0];
	const secondEntry = ranked.length > 1 ? ranked[1] : undefined;

	// Confidence: ratio of top score to total, floored at 0.5
	const totalScore = ranked.reduce((sum, [, e]) => sum + e.total, 0);
	const rawConfidence = topEntry.total / (totalScore || 1);
	const confidence = Math.max(0.5, Math.min(1.0, rawConfidence));

	const reason = `Matched: ${topEntry.labels.join(", ")}`;
	const secondary = secondEntry && secondEntry[1].total > topEntry.total * 0.5
		? secondEntry[0]
		: undefined;

	return { type: topType, resolution: RESOLUTION_MAP[topType], reason, confidence, secondary };
}

// ─── Default Task-Type → Model Bindings ─────────────────────────────────────

/**
 * LOCAL_BINDINGS: Use local models where possible — zero cost.
 *
 * This is the recommended default: local LLMs for most tasks,
 * cloud only for what local can't handle.
 */
export const LOCAL_BINDINGS: TaskModelBinding[] = [
	// ── Zero-token paths (no LLM, no cost) ──
	{
		taskType: "search",
		providerId: "none",
		modelId: "bm25-local",
		rationale: "BM25 + hybrid vectors run locally. No LLM call needed.",
	},
	{
		taskType: "memory",
		providerId: "none",
		modelId: "local-recall",
		rationale: "Memory/session recall is pure local disk I/O. Zero tokens.",
	},
	{
		taskType: "file-op",
		providerId: "none",
		modelId: "tool-direct",
		rationale: "File read/write/list goes straight to yantra tools. Zero tokens.",
	},
	{
		taskType: "api-call",
		providerId: "none",
		modelId: "tool-direct",
		rationale: "Gmail, Slack, webhooks — tool handles the API call. Zero tokens.",
	},
	{
		taskType: "compaction",
		providerId: "none",
		modelId: "sinkhorn-local",
		rationale: "Sinkhorn-Knopp, TextRank, MinHash — pure local math. Zero tokens.",
	},
	// ── Local LLM paths (free) ──
	{
		taskType: "heartbeat",
		providerId: "ollama",
		modelId: "llama3.2:1b",
		rationale: "Heartbeat needs the fastest, cheapest response. 1B local is instant.",
	},
	{
		taskType: "embedding",
		providerId: "ollama",
		modelId: "bge-m3",
		rationale: "BGE-M3: 1024-dim, multi-lingual, dense+sparse in one model. Best local embedding.",
	},
	{
		taskType: "code-gen",
		providerId: "ollama",
		modelId: "qwen2.5-coder:7b",
		rationale: "Qwen Coder 7B is state-of-art for local code gen. Free.",
	},
	{
		taskType: "chat",
		providerId: "ollama",
		modelId: "llama3.2:3b",
		rationale: "General chat handled by 3B Llama locally. Fast and free.",
	},
	{
		taskType: "summarize",
		providerId: "ollama",
		modelId: "llama3.2:3b",
		rationale: "Summarization is compression — 3B local handles it well.",
	},
	{
		taskType: "translate",
		providerId: "ollama",
		modelId: "llama3.2:3b",
		rationale: "Basic translation at 3B level. Upgrade for rare languages.",
	},
	{
		taskType: "tool-exec",
		providerId: "ollama",
		modelId: "qwen2.5-coder:7b",
		rationale: "Tool calling needs structured output. Qwen Coder handles JSON well.",
	},
	// ── Cloud paths (only when local can't handle) ──
	{
		taskType: "reasoning",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5-20250929",
		rationale: "Deep reasoning needs a strong model. Sonnet balances cost + quality.",
	},
	{
		taskType: "vision",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5-20250929",
		rationale: "Vision requires multimodal. Sonnet has image understanding.",
	},
];

/**
 * CLOUD_BINDINGS: All cloud, optimized for cost within cloud providers.
 *
 * For users without local GPU or who prefer cloud reliability.
 * Note: tool-only and local-compute tasks STILL skip the LLM — even on cloud plan.
 */
export const CLOUD_BINDINGS: TaskModelBinding[] = [
	// ── Zero-token paths (same everywhere — these NEVER need LLM) ──
	{
		taskType: "search",
		providerId: "none",
		modelId: "bm25-local",
		rationale: "Search is always local. BM25 + vectors don't need cloud LLM.",
	},
	{
		taskType: "memory",
		providerId: "none",
		modelId: "local-recall",
		rationale: "Memory recall is local disk. No cloud needed ever.",
	},
	{
		taskType: "file-op",
		providerId: "none",
		modelId: "tool-direct",
		rationale: "File operations go straight to tools. Zero tokens even on cloud.",
	},
	{
		taskType: "api-call",
		providerId: "none",
		modelId: "tool-direct",
		rationale: "API calls (Gmail, Slack) go through tools. Zero tokens.",
	},
	{
		taskType: "compaction",
		providerId: "none",
		modelId: "sinkhorn-local",
		rationale: "Compaction is pure math. Sinkhorn-Knopp runs locally.",
	},
	// ── Cloud LLM paths ──
	{
		taskType: "heartbeat",
		providerId: "anthropic",
		modelId: "claude-haiku-3-5",
		rationale: "Cheapest cloud model. Heartbeat needs minimal intelligence.",
	},
	{
		taskType: "embedding",
		providerId: "openai",
		modelId: "text-embedding-3-small",
		rationale: "OpenAI embedding API — 1536d, $0.02/1M tokens.",
	},
	{
		taskType: "code-gen",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5-20250929",
		rationale: "Claude Sonnet is excellent at code. Best price/quality.",
	},
	{
		taskType: "chat",
		providerId: "anthropic",
		modelId: "claude-haiku-3-5",
		rationale: "Haiku for simple chat. Fast, cheap, good enough.",
	},
	{
		taskType: "summarize",
		providerId: "anthropic",
		modelId: "claude-haiku-3-5",
		rationale: "Haiku compresses well. Summarization doesn't need opus-level.",
	},
	{
		taskType: "translate",
		providerId: "openai",
		modelId: "gpt-4o-mini",
		rationale: "GPT-4o-mini handles translation well across languages.",
	},
	{
		taskType: "tool-exec",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5-20250929",
		rationale: "Sonnet's tool use is production-grade. Reliable function calling.",
	},
	{
		taskType: "reasoning",
		providerId: "anthropic",
		modelId: "claude-opus-4-6",
		rationale: "Deep reasoning demands the strongest model. Opus is the ceiling.",
	},
	{
		taskType: "vision",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5-20250929",
		rationale: "Sonnet handles vision. Opus if you need deeper analysis.",
	},
];

/**
 * HYBRID_BINDINGS: Local for cheap tasks, cloud for hard ones.
 *
 * The sweet spot for most users: zero-cost where possible,
 * pay only for what local can't do.
 */
export const HYBRID_BINDINGS: TaskModelBinding[] = [
	// ── Zero-token paths (tool-only / local-compute) ──
	{
		taskType: "search",
		providerId: "none",
		modelId: "bm25-local",
		rationale: "Search: pure local BM25 + vectors. Zero tokens.",
	},
	{
		taskType: "memory",
		providerId: "none",
		modelId: "local-recall",
		rationale: "Memory: local disk I/O. Zero tokens.",
	},
	{
		taskType: "file-op",
		providerId: "none",
		modelId: "tool-direct",
		rationale: "Files: yantra tools handle directly. Zero tokens.",
	},
	{
		taskType: "api-call",
		providerId: "none",
		modelId: "tool-direct",
		rationale: "APIs: tool handles the call. Zero tokens.",
	},
	{
		taskType: "compaction",
		providerId: "none",
		modelId: "sinkhorn-local",
		rationale: "Compaction: Sinkhorn-Knopp locally. Zero tokens.",
	},
	// ── Local LLM paths (free) ──
	{
		taskType: "heartbeat",
		providerId: "ollama",
		modelId: "llama3.2:1b",
		rationale: "Heartbeat: local, instant, free.",
	},
	{
		taskType: "embedding",
		providerId: "ollama",
		modelId: "bge-m3",
		rationale: "BGE-M3: 1024d, multi-lingual, dense+sparse unified. Zero cost.",
	},
	{
		taskType: "chat",
		providerId: "ollama",
		modelId: "llama3.2:3b",
		rationale: "Chat: local 3B handles casual conversation.",
	},
	{
		taskType: "summarize",
		providerId: "ollama",
		modelId: "llama3.2:3b",
		rationale: "Summarize: local compression is fast and free.",
	},
	{
		taskType: "translate",
		providerId: "ollama",
		modelId: "llama3.2:3b",
		rationale: "Translate: local for common languages.",
	},
	{
		taskType: "code-gen",
		providerId: "ollama",
		modelId: "qwen2.5-coder:7b",
		rationale: "Code: Qwen Coder locally. Escalates to Sonnet if complex.",
	},
	{
		taskType: "tool-exec",
		providerId: "ollama",
		modelId: "qwen2.5-coder:7b",
		rationale: "Tool calls: Qwen handles JSON. Escalates if needed.",
	},
	// ── Cloud paths (only when needed) ──
	{
		taskType: "reasoning",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5-20250929",
		rationale: "Reasoning: needs cloud intelligence. Sonnet is the sweet spot.",
	},
	{
		taskType: "vision",
		providerId: "anthropic",
		modelId: "claude-sonnet-4-5-20250929",
		rationale: "Vision: multimodal requires cloud.",
	},
];
