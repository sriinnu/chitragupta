/**
 * @chitragupta/core — Foundation types for the entire Chitragupta system.
 */

// ─── Plugin System ───────────────────────────────────────────────────────────

/** The category of a plugin, used for filtering and lifecycle management. */
export type PluginType = "provider" | "tool" | "command" | "theme" | "agent-profile";

/** A Chitragupta plugin that can be registered, initialized, and destroyed. */
export interface Plugin {
	name: string;
	version: string;
	type: PluginType;
	description?: string;
	init(chitragupta: ChitraguptaAPI): void | Promise<void>;
	destroy?(): void | Promise<void>;
}

/** The API surface passed to plugins during initialization. */
export interface ChitraguptaAPI {
	config: Config;
	events: EventBus;
	plugins: PluginRegistry;
	getProfile(): AgentProfile;
}

/** Registry for managing plugin registration, lookup, and enumeration. */
export interface PluginRegistry {
	register(plugin: Plugin): void;
	unregister(name: string): void;
	get<T extends Plugin>(name: string): T | undefined;
	getAll(type?: PluginType): Plugin[];
	has(name: string): boolean;
}

// ─── Event Bus ───────────────────────────────────────────────────────────────

/** A typed, synchronous event bus for decoupled inter-system communication. */
export interface EventBus {
	on<T = unknown>(event: string, handler: (data: T) => void): void;
	off(event: string, handler: (...args: any[]) => void): void;
	emit<T = unknown>(event: string, data: T): void;
	once<T = unknown>(event: string, handler: (data: T) => void): void;
	removeAll(event?: string): void;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** The scope/priority tier of a configuration layer. */
export type ConfigLayer = "global" | "workspace" | "project" | "session";

/** A configuration store with dot-notation key access and layer awareness. */
export interface Config {
	get<T>(key: string): T | undefined;
	get<T>(key: string, fallback: T): T;
	set(key: string, value: unknown): void;
	has(key: string): boolean;
	delete(key: string): void;
	layer: ConfigLayer;
	all(): Record<string, unknown>;
	merge(other: Record<string, unknown>): void;
}

/** Global user settings persisted at ~/.chitragupta/config/settings.json. */
export interface ChitraguptaSettings {
	defaultProvider: string;
	defaultModel: string;
	thinkingLevel: ThinkingLevel;
	agentProfile: string;
	compaction: { enabled: boolean; threshold: number };
	memory: { autoSave: boolean; searchDepth: number };
	theme: string;
	plugins: string[];
	ollamaEndpoint?: string;
	graphrag?: {
		enabled: boolean;
		provider: string; // e.g. "ollama"
		model: string; // e.g. "nomic-embed-text"
		endpoint?: string;
	};
	budget?: BudgetConfig;
	mesh?: {
		enabled?: boolean;
		systemId?: string;
		mailboxCapacity?: number;
		gossip?: {
			enabled?: boolean;
			fanout?: number;
			sweepIntervalMs?: number;
			suspectTimeoutMs?: number;
			deadTimeoutMs?: number;
		};
	};
	chetana?: {
		enabled?: boolean;
		affectDecayRate?: number;
		attentionFocusWindow?: number;
		selfModelPersistence?: boolean;
		goalAbandonmentThreshold?: number;
	};
}

/** Sensible default values for all Chitragupta settings. */
export const DEFAULT_SETTINGS: ChitraguptaSettings = {
	defaultProvider: "anthropic",
	defaultModel: "claude-sonnet-4-5-20250929",
	thinkingLevel: "medium",
	agentProfile: "chitragupta",
	compaction: { enabled: true, threshold: 80 },
	memory: { autoSave: true, searchDepth: 50 },
	theme: "default",
	plugins: [],
	ollamaEndpoint: "http://localhost:11434",
	graphrag: {
		enabled: false,
		provider: "ollama",
		model: "nomic-embed-text",
	},
	budget: {
		maxSessionCost: 0,
		maxDailyCost: 0,
		warningThreshold: 0.8,
	},
	mesh: {
		enabled: false,
		systemId: "chitragupta",
		mailboxCapacity: 10_000,
		gossip: {
			enabled: true,
			fanout: 3,
			sweepIntervalMs: 5_000,
			suspectTimeoutMs: 15_000,
			deadTimeoutMs: 30_000,
		},
	},
};

// ─── Agent Identity ──────────────────────────────────────────────────────────

/** The voice/tone style for agent responses. */
export type VoiceStyle = "bold" | "friendly" | "minimal" | "custom";
/** How much extended thinking the model should use. */
export type ThinkingLevel = "none" | "low" | "medium" | "high";

/** An agent's identity profile: personality, expertise, voice, and model preferences. */
export interface AgentProfile {
	id: string;
	name: string;
	personality: string;
	expertise: string[];
	preferredModel?: string;
	preferredThinking?: ThinkingLevel;
	voice: VoiceStyle;
	customVoice?: string;
	/** Cognitive personality priors for the Chetana consciousness layer. */
	cognitivePriors?: {
		baseArousal?: number;
		emotionalReactivity?: number;
		goalOrientedness?: number;
		selfAwareness?: number;
	};
}

// ─── Common Types ────────────────────────────────────────────────────────────

/** The reason a model stopped generating output. */
export type StopReason = "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | "error";

/** Token usage breakdown for a single LLM completion. */
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	thinkingTokens?: number;
}

/** Monetary cost breakdown for a single or aggregated LLM completion. */
export interface CostBreakdown {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	total: number;
	currency: string;
}

export interface Position {
	line: number;
	column: number;
}

export interface Range {
	start: Position;
	end: Position;
}

// ─── Token Budget ───────────────────────────────────────────────────────────

/** Token and cost budget configuration. */
export interface BudgetConfig {
	/** Maximum cost per session in USD. 0 = unlimited. */
	maxSessionCost?: number;
	/** Maximum daily cost in USD. 0 = unlimited. */
	maxDailyCost?: number;
	/** Warning threshold as fraction (0.0-1.0). Default: 0.8 */
	warningThreshold?: number;
}

/** Current state of the token/cost budget. */
export interface BudgetStatus {
	/** Current session cost */
	sessionCost: number;
	/** Current daily cost (across all sessions today) */
	dailyCost: number;
	/** Session budget limit (0 = unlimited) */
	sessionLimit: number;
	/** Daily budget limit (0 = unlimited) */
	dailyLimit: number;
	/** Whether session budget warning triggered */
	sessionWarning: boolean;
	/** Whether session budget exceeded */
	sessionExceeded: boolean;
	/** Whether daily budget warning triggered */
	dailyWarning: boolean;
	/** Whether daily budget exceeded */
	dailyExceeded: boolean;
}

// ─── Sandesha Input Routing ─────────────────────────────────────────────────

/** A sub-agent's request for user input, bubbled up via events. */
export interface InputRequest {
	/** Unique request ID (e.g. `input_${agentId}_${counter}`) */
	requestId: string;
	/** ID of the agent requesting input */
	agentId: string;
	/** Human-readable prompt to show the user */
	prompt: string;
	/** Optional choices for structured input */
	choices?: string[];
	/** Default value if no response within timeout */
	defaultValue?: string;
	/** Timeout in ms (agent falls back to defaultValue after this) */
	timeoutMs?: number;
}

// ─── Tool System (Canonical) ────────────────────────────────────────────────

/** Schema describing a tool's name, description, and input parameters. */
export interface ToolDefinition {
	/** Unique tool name used for invocation. */
	name: string;
	/** Human-readable description shown to the LLM. */
	description: string;
	/** JSON Schema object describing the accepted input parameters. */
	inputSchema: Record<string, unknown>;
}

/** Runtime context provided to every tool execution. */
export interface ToolContext {
	/** Current agent session identifier. */
	sessionId: string;
	/** Absolute path to the agent's working directory. */
	workingDirectory: string;
	/** Optional abort signal for cancelling long-running tool operations. */
	signal?: AbortSignal;
}

/**
 * Structured result returned by a tool execution.
 *
 * @example
 * ```ts
 * const result: ToolResult = {
 *   content: "File written successfully",
 *   metadata: { path: "/tmp/foo.ts", size: 42 },
 * };
 * ```
 */
export interface ToolResult {
	/** Human-readable output content (shown to the LLM). */
	content: string;
	/** If true, the result represents an error. */
	isError?: boolean;
	/** Optional structured metadata for programmatic consumption. */
	metadata?: Record<string, unknown>;
}

/**
 * A tool handler combines a definition (schema) with an execute function.
 * This is the canonical interface shared by @chitragupta/yantra and @chitragupta/anina.
 */
export interface ToolHandler {
	/** The tool definition describing name, description, and input schema. */
	definition: ToolDefinition;
	/**
	 * Execute the tool with the given arguments and context.
	 * @param args - Parsed arguments matching the tool's inputSchema.
	 * @param context - Runtime context (session ID, working directory, abort signal).
	 * @returns A structured ToolResult with content and optional metadata.
	 */
	execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

// ─── Sandesha Input Routing ─────────────────────────────────────────────────

/** Resolution sent back to the requesting agent via CommHub. */
export interface InputResolve {
	/** Matches InputRequest.requestId */
	requestId: string;
	/** The user's response value */
	value: string;
	/** Whether the request was denied by an ancestor */
	denied?: boolean;
	/** Reason for denial */
	denyReason?: string;
}
