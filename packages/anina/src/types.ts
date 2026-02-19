/**
 * @chitragupta/anina — Agent-specific types.
 *
 * These types define the agent runtime: tool handling, agent state,
 * events, messages, and configuration.
 */

import type {
	AgentProfile,
	CostBreakdown,
	ThinkingLevel,
	ToolDefinition,
	ToolContext,
	ToolResult,
	ToolHandler,
} from "@chitragupta/core";
import type { ContentPart, StreamEvent, EmbeddingProvider } from "@chitragupta/swara";

// ─── Mesh Structural Types ──────────────────────────────────────────────────
// Imported for local use (AgentConfig) and re-exported for backward compatibility.
// See types-mesh.ts for definitions and documentation.

import type {
	MeshActorSystem,
	MeshSamiti,
	LokapalaGuardians,
	KaalaLifecycle,
} from "./types-mesh.js";

export type {
	MeshActorRef,
	MeshActorBehavior,
	MeshEnvelopeCompat,
	MeshActorContextCompat,
	MeshActorSystem,
	MeshSamiti,
	LokapalaFinding,
	LokapalaGuardians,
	KaalaHeartbeat,
	KaalaStatusChangeCallback,
	KaalaLifecycle,
} from "./types-mesh.js";

// ─── Tool System ────────────────────────────────────────────────────────────
// Canonical ToolHandler, ToolContext, ToolResult, and ToolDefinition are
// defined in @chitragupta/core and re-exported here for backward compatibility.

export type { ToolDefinition, ToolContext, ToolResult, ToolHandler };

// ─── Agent Events ───────────────────────────────────────────────────────────

/** All possible agent event types emitted during the agent lifecycle. */
export type AgentEventType =
	| "stream:start"
	| "stream:text"
	| "stream:thinking"
	| "stream:tool_call"
	| "stream:usage"
	| "stream:done"
	| "stream:error"
	| "tool:start"
	| "tool:done"
	| "tool:error"
	| "turn:start"
	| "turn:done"
	| "agent:abort"
	| "agent:steer"
	| "subagent:spawn"
	| "subagent:done"
	| "subagent:error"
	| "subagent:event"
	| "agent:input_request"
	| "chetana:frustrated"
	| "chetana:confident"
	| "chetana:self_updated"
	| "chetana:goal_changed"
	| "chetana:attention_shifted"
	| "nidra:state_change"
	| "nidra:heartbeat"
	| "nidra:consolidation_start"
	| "nidra:consolidation_end"
	| "pratyabhijna:recognized";

// ─── Agent Messages ─────────────────────────────────────────────────────────

/** A single message in the agent's conversation history. */
export interface AgentMessage {
	/** Unique message identifier. */
	id: string;
	/** The role of the message sender. */
	role: "user" | "assistant" | "tool_result" | "system";
	/** Array of content parts (text, tool calls, images, etc.). */
	content: ContentPart[];
	/** Unix timestamp (ms) when the message was created. */
	timestamp: number;
	/** ID of the agent that produced this message. */
	agentId?: string;
	/** Model used for this message (for assistant messages). */
	model?: string;
	/** Cost breakdown for this message (for assistant messages). */
	cost?: CostBreakdown;
}

// ─── Agent State ────────────────────────────────────────────────────────────

/** Mutable runtime state for an agent instance. */
export interface AgentState {
	/** Full conversation message history. */
	messages: AgentMessage[];
	/** Current model identifier. */
	model: string;
	/** Provider identifier (e.g. "anthropic", "openai"). */
	providerId: string;
	/** Registered tool handlers. */
	tools: ToolHandler[];
	/** System prompt text sent to the LLM. */
	systemPrompt: string;
	/** Current thinking/reasoning level. */
	thinkingLevel: ThinkingLevel;
	/** Whether the agent is currently streaming a response. */
	isStreaming: boolean;
	/** Unique session identifier for this agent run. */
	sessionId: string;
	/** The agent profile ID being used. */
	agentProfileId: string;
}

// ─── Agent Configuration ────────────────────────────────────────────────────

/** Configuration for creating a new Agent instance. */
export interface AgentConfig {
	/** Agent personality/behavior profile. */
	profile: AgentProfile;
	/** LLM provider identifier. */
	providerId: string;
	/** Model identifier to use. */
	model: string;
	/** Optional tool handlers to register. */
	tools?: ToolHandler[];
	/** Optional custom system prompt (overrides profile-generated prompt). */
	systemPrompt?: string;
	/** Thinking level for extended reasoning. */
	thinkingLevel?: ThinkingLevel;
	/** Working directory for tool operations. */
	workingDirectory?: string;
	/** Maximum tool-use loop iterations per prompt. */
	maxTurns?: number;
	/** Callback for agent lifecycle events. */
	onEvent?: (event: AgentEventType, data: unknown) => void;
	/** Enable memory/session persistence. */
	enableMemory?: boolean;
	/** Project path for memory scoping. */
	project?: string;
	/** Enable the LearningLoop for tool usage tracking and Markov prediction. */
	enableLearning?: boolean;
	/** Enable the AutonomousAgent wrapper for self-healing and tool failure tracking. */
	enableAutonomy?: boolean;
	/**
	 * Number of consecutive tool failures before temporarily disabling a tool.
	 * Only used when `enableAutonomy` is true. Default: 3.
	 */
	consecutiveFailureThreshold?: number;
	/**
	 * Policy engine for enforcing guardrails on tool calls.
	 * When provided, every tool call is checked before execution.
	 * The engine receives the tool name and parsed arguments, and returns
	 * whether the call is allowed. If denied, an error tool_result is pushed
	 * instead of executing the tool.
	 */
	policyEngine?: {
		check(
			toolName: string,
			args: Record<string, unknown>,
		): { allowed: boolean; reason?: string };
	};
	/** Token budgets for each thinking level. */
	thinkingBudgets?: {
		low?: number;
		medium?: number;
		high?: number;
	};
	/**
	 * CommHub instance for inter-agent communication (Sutra IPC).
	 * When provided, enables the Sandesha input routing pattern
	 * and shared state between sub-agents.
	 */
	commHub?: {
		send(envelope: Record<string, unknown>): string;
		subscribe(agentId: string, topic: string, handler: (envelope: unknown) => void): () => void;
		broadcast(from: string, topic: string, payload: unknown): void;
		destroy(): void;
	};
	/**
	 * ActorSystem instance for P2P mesh communication (Sutra actor mesh).
	 * When provided, the agent auto-registers as an actor in the mesh,
	 * enabling inter-agent communication via tell/ask.
	 */
	actorSystem?: MeshActorSystem;
	/**
	 * Samiti instance for ambient channel communication.
	 * When provided, agent events are broadcast to relevant channels
	 * (e.g., tool errors → #correctness, security findings → #security).
	 */
	samiti?: MeshSamiti;
	/**
	 * Lokapala guardians for real-time tool call scanning.
	 * When provided, every tool execution is scanned for security, performance,
	 * and correctness issues. Critical findings are broadcast to Samiti channels.
	 */
	lokapala?: LokapalaGuardians;
	/**
	 * KaalaBrahma lifecycle manager for agent tree tracking.
	 * When provided, agents register/unregister with the lifecycle manager,
	 * enabling heartbeat monitoring, stale detection, and kill cascades.
	 */
	kaala?: KaalaLifecycle;
	/**
	 * Enable mesh integration (ActorSystem + Samiti).
	 * When true and actorSystem is provided, the agent auto-spawns as an actor.
	 * Default: true (auto-enable when actorSystem is provided).
	 */
	enableMesh?: boolean;
	/** Embedding provider for vector generation in memory subsystems. */
	embeddingProvider?: EmbeddingProvider;
	/** Enable the Chetana consciousness layer. Default: true (enabled). */
	enableChetana?: boolean;
	/** Configuration overrides for the Chetana consciousness layer. */
	chetanaConfig?: Partial<import("./chetana/types.js").ChetanaConfig>;
}

// ─── Sub-Agent Spawning ─────────────────────────────────────────────────────

/**
 * Absolute system ceiling for agent tree depth. Cannot be overridden by config.
 * Any user-configured maxAgentDepth is clamped to this value.
 */
export const SYSTEM_MAX_AGENT_DEPTH = 10;

/**
 * Absolute system ceiling for sub-agents per parent. Cannot be overridden by config.
 * Any user-configured maxSubAgents is clamped to this value.
 */
export const SYSTEM_MAX_SUB_AGENTS = 16;

/** Default max agent depth used when no config override is provided. */
export const DEFAULT_MAX_AGENT_DEPTH = 3;

/** Default max sub-agents per parent used when no config override is provided. */
export const DEFAULT_MAX_SUB_AGENTS = 4;

/**
 * @deprecated Use DEFAULT_MAX_AGENT_DEPTH or configure via KaalaConfig.maxAgentDepth.
 * Kept for backward compatibility.
 */
export const MAX_AGENT_DEPTH = DEFAULT_MAX_AGENT_DEPTH;

/**
 * @deprecated Use DEFAULT_MAX_SUB_AGENTS or configure via KaalaConfig.maxSubAgents.
 * Kept for backward compatibility.
 */
export const MAX_SUB_AGENTS = DEFAULT_MAX_SUB_AGENTS;

/**
 * Config overrides when spawning a sub-agent.
 * Anything not specified inherits from the parent agent.
 */
export interface SpawnConfig {
	/** A purpose label for this sub-agent (e.g. "code-reviewer", "test-runner"). */
	purpose: string;
	/** Override the agent profile. Inherits parent's if omitted. */
	profile?: AgentProfile;
	/** Override the model. Inherits parent's if omitted. */
	model?: string;
	/** Override the provider. Inherits parent's if omitted. */
	providerId?: string;
	/** Override tools. Inherits parent's if omitted. */
	tools?: ToolHandler[];
	/** Override system prompt. Built from purpose + parent context if omitted. */
	systemPrompt?: string;
	/** Override thinking level. Inherits parent's if omitted. */
	thinkingLevel?: ThinkingLevel;
	/** Override working directory. Inherits parent's if omitted. */
	workingDirectory?: string;
	/** Override max turns. Defaults to parent's. */
	maxTurns?: number;
	/** Whether sub-agent events bubble up to the parent's onEvent. Default: true. */
	bubbleEvents?: boolean;
}

/**
 * Result returned when a sub-agent finishes its task.
 */
export interface SubAgentResult {
	/** The sub-agent's unique ID. */
	agentId: string;
	/** The purpose label given at spawn time. */
	purpose: string;
	/** The final assistant message. */
	response: AgentMessage;
	/** All messages exchanged during the sub-agent's run. */
	messages: AgentMessage[];
	/** Total cost incurred by this sub-agent (excluding its own children). */
	cost: CostBreakdown | null;
	/** Whether the sub-agent was aborted or errored. */
	status: "completed" | "aborted" | "error";
	/** Error message if status is "error". */
	error?: string;
}

// ─── Agent Tree ─────────────────────────────────────────────────────────────

/**
 * A snapshot of an agent's position in the tree.
 * Used for serialization and inspection — not for live traversal.
 */
export interface AgentTreeNode {
	id: string;
	purpose: string;
	profileId: string;
	model: string;
	depth: number;
	status: "idle" | "running" | "completed" | "aborted" | "error";
	children: AgentTreeNode[];
}

/**
 * Full tree rooted at the given agent.
 */
export interface AgentTree {
	root: AgentTreeNode;
	totalAgents: number;
	maxDepth: number;
}

// ─── Phase 1: Nidra (Sleep Cycle) Types ────────────────────────────────────

/** The three consciousness states of the Nidra daemon. */
export type NidraState = "LISTENING" | "DREAMING" | "DEEP_SLEEP";

/** The five phases of the Svapna (dream) consolidation cycle. */
export type SvapnaPhase = "REPLAY" | "RECOMBINE" | "CRYSTALLIZE" | "PROCEDURALIZE" | "COMPRESS";

/** Configuration for the Nidra daemon. */
export interface NidraConfig {
	/** Heartbeat interval per state (ms). */
	heartbeatMs: {
		LISTENING: number;
		DREAMING: number;
		DEEP_SLEEP: number;
	};
	/** Idle timeout before transitioning LISTENING → DREAMING (ms). */
	idleTimeoutMs: number;
	/** Dream duration before transitioning DREAMING → DEEP_SLEEP (ms). */
	dreamDurationMs: number;
	/** Deep sleep duration before returning to LISTENING (ms). */
	deepSleepDurationMs: number;
	/** Whether to auto-start the daemon. */
	autoStart: boolean;
	/** Project path for scoping consolidation. */
	project?: string;
}

/** Default Nidra configuration. */
export const DEFAULT_NIDRA_CONFIG: NidraConfig = {
	heartbeatMs: {
		LISTENING: 30_000,   // 30s
		DREAMING: 120_000,   // 2min
		DEEP_SLEEP: 300_000, // 5min
	},
	idleTimeoutMs: 300_000,        // 5min idle → start dreaming
	dreamDurationMs: 600_000,      // 10min dreaming → deep sleep
	deepSleepDurationMs: 1_800_000, // 30min deep sleep → wake
	autoStart: false,
};

/** Snapshot of Nidra daemon state. */
export interface NidraSnapshot {
	state: NidraState;
	lastStateChange: number;
	lastHeartbeat: number;
	lastConsolidationStart?: number;
	lastConsolidationEnd?: number;
	consolidationPhase?: SvapnaPhase;
	consolidationProgress: number;
	uptime: number;
}

// ─── Phase 1: Pratyabhijna (Self-Recognition) Types ────────────────────────

/** The identity context reconstructed at session start. */
export interface PratyabhijnaContext {
	/** Session ID this context was built for. */
	sessionId: string;
	/** Project this context pertains to. */
	project: string;
	/** The self-recognition narrative. */
	identitySummary: string;
	/** Top global vasanas loaded. */
	globalVasanas: Array<{ tendency: string; strength: number; valence: string }>;
	/** Top project-specific vasanas. */
	projectVasanas: Array<{ tendency: string; strength: number; valence: string }>;
	/** Active samskaras for this project. */
	activeSamskaras: Array<{ patternType: string; patternContent: string; confidence: number }>;
	/** Cross-project insights. */
	crossProjectInsights: string[];
	/** Tool mastery scores from Atma-Darshana. */
	toolMastery: Record<string, number>;
	/** How long the recognition took (ms). */
	warmupMs: number;
	/** Unix timestamp. */
	createdAt: number;
}

/** Configuration for Pratyabhijna self-recognition. */
export interface PratyabhijnaConfig {
	/** Number of top vasanas to load per scope. */
	topK: number;
	/** Maximum samskaras to include. */
	maxSamskaras: number;
	/** Maximum cross-project sessions to consider. */
	maxCrossProject: number;
	/** Target warmup time (ms) — will truncate if exceeding. */
	warmupBudgetMs: number;
}

/** Default Pratyabhijna config. */
export const DEFAULT_PRATYABHIJNA_CONFIG: PratyabhijnaConfig = {
	topK: 10,
	maxSamskaras: 20,
	maxCrossProject: 5,
	warmupBudgetMs: 30,
};
