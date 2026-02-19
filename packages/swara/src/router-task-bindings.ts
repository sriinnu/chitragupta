import type { TaskModelBinding } from "./router-task-type.js";

/**
 * LOCAL_BINDINGS: Use local models where possible — zero cost.
 *
 * This is the recommended default: local LLMs for most tasks,
 * cloud only for what local can't handle.
 */
export const LOCAL_BINDINGS: TaskModelBinding[] = [
	{
		taskType: "heartbeat",
		providerId: "none",
		modelId: "heartbeat-local",
		rationale: "Heartbeat is a deterministic local ack. Zero tokens.",
	},
	{
		taskType: "smalltalk",
		providerId: "none",
		modelId: "smalltalk-local",
		rationale: "Greetings/check-ins are deterministic local replies. Zero tokens.",
	},
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
	{
		taskType: "heartbeat",
		providerId: "none",
		modelId: "heartbeat-local",
		rationale: "Heartbeat checks stay local and deterministic. Zero tokens.",
	},
	{
		taskType: "smalltalk",
		providerId: "none",
		modelId: "smalltalk-local",
		rationale: "Smalltalk stays local by policy. Zero tokens.",
	},
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
	{
		taskType: "heartbeat",
		providerId: "none",
		modelId: "heartbeat-local",
		rationale: "Heartbeat: deterministic local ack. Zero tokens.",
	},
	{
		taskType: "smalltalk",
		providerId: "none",
		modelId: "smalltalk-local",
		rationale: "Smalltalk: deterministic local greeting/check-in. Zero tokens.",
	},
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
