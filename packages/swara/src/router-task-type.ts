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
import { TYPE_SIGNALS, detectCheckinSubtype } from "./router-task-type-signals.js";
export { LOCAL_BINDINGS, CLOUD_BINDINGS, HYBRID_BINDINGS } from "./router-task-bindings.js";

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
	| "heartbeat"   // Health check, ping, status → LOCAL deterministic ack
	| "smalltalk"   // Greeting/check-in/ack → LOCAL deterministic reply
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

export type CheckinSubtype = "greeting" | "ack" | "checkin";

/** Maps each task type to its resolution path. */
export const RESOLUTION_MAP: Record<TaskType, ResolutionPath> = {
	"chat":        "llm",
	"code-gen":    "llm-with-tools",
	"reasoning":   "llm",
	"search":      "local-compute",
	"embedding":   "embedding",
	"vision":      "llm",
	"tool-exec":   "tool-only",
	"heartbeat":   "local-compute",
	"smalltalk":   "local-compute",
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
	/** Check-in subtype for smalltalk/heartbeat intents. */
	checkinSubtype?: CheckinSubtype;
	/** Top classifier score (used for near-tie abstain checks downstream). */
	topScore?: number;
	/** Runner-up classifier score (used for near-tie abstain checks downstream). */
	secondScore?: number;
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

// ─── Classifier ─────────────────────────────────────────────────────────────

/**
 * Classify the TASK TYPE of a request by analyzing the user's message.
 *
 * Unlike Vichara (complexity), Pravritti determines WHAT the user wants:
 * - embed text → embedding model
 * - write code → code model
 * - search files → BM25/vector, maybe no LLM
 * - heartbeat/smalltalk → deterministic local reply
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
	const topScore = topEntry.total;
	const secondScore = secondEntry?.[1].total ?? 0;

	// Confidence: ratio of top score to total, floored at 0.5
	const totalScore = ranked.reduce((sum, [, e]) => sum + e.total, 0);
	const rawConfidence = topEntry.total / (totalScore || 1);
	const confidence = Math.max(0.5, Math.min(1.0, rawConfidence));

	const reason = `Matched: ${topEntry.labels.join(", ")}`;
	const secondary = secondEntry && secondEntry[1].total > topEntry.total * 0.5
		? secondEntry[0]
		: undefined;
	let checkinSubtype: CheckinSubtype | undefined;
	if (topType === "smalltalk" || topType === "heartbeat") {
		checkinSubtype = detectCheckinSubtype(text, topType);
	}

	return {
		type: topType,
		resolution: RESOLUTION_MAP[topType],
		reason,
		confidence,
		secondary,
		checkinSubtype,
		topScore,
		secondScore,
	};
}
