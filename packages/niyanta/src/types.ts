/**
 * @chitragupta/niyanta — Agent Orchestrator types.
 *
 * Niyanta (Sanskrit: controller/orchestrator) coordinates multiple agents,
 * manages agent-of-agents patterns, and provides high-level orchestration.
 */

// ─── Strategy ────────────────────────────────────────────────────────────────

/** Strategy for how the orchestrator assigns tasks to agents. */
export type OrchestratorStrategy =
	| "round-robin"
	| "least-loaded"
	| "specialized"
	| "hierarchical"
	| "swarm"
	| "competitive"
	| "custom";

// ─── Plan ────────────────────────────────────────────────────────────────────

/** An orchestrator plan — what agents to create and how to coordinate them. */
export interface OrchestrationPlan {
	id: string;
	name: string;
	strategy: OrchestratorStrategy;
	agents: AgentSlot[];
	routing: RoutingRule[];
	coordination: CoordinationConfig;
	fallback?: FallbackConfig;
}

// ─── Agent Slot ──────────────────────────────────────────────────────────────

/** A slot for an agent in the orchestration plan. */
export interface AgentSlot {
	id: string;
	role: string;
	profileId?: string;
	model?: string;
	capabilities: string[];
	maxConcurrent?: number;
	autoScale?: boolean;
	minInstances?: number;
	maxInstances?: number;
}

// ─── Routing ─────────────────────────────────────────────────────────────────

/** Rule for routing tasks to agents. */
export interface RoutingRule {
	id: string;
	/** Pattern to match against the task. */
	match: RoutingMatcher;
	/** Target agent slot ID. */
	target: string;
	/** Priority (higher = checked first). */
	priority: number;
	/** Transform the task before routing. */
	transform?: (task: OrchestratorTask) => OrchestratorTask;
}

export type RoutingMatcher =
	| { type: "keyword"; keywords: string[] }
	| { type: "pattern"; regex: string }
	| { type: "capability"; required: string[] }
	| { type: "file_type"; extensions: string[] }
	| { type: "always" }
	| { type: "expression"; expr: string };

// ─── Task ────────────────────────────────────────────────────────────────────

/** A task to be orchestrated. */
export interface OrchestratorTask {
	id: string;
	type: "prompt" | "review" | "test" | "refactor" | "analyze" | "custom";
	description: string;
	context?: Record<string, unknown>;
	priority: "critical" | "high" | "normal" | "low" | "background";
	dependencies?: string[];
	deadline?: number;
	maxRetries?: number;
	assignedAgent?: string;
	status: TaskStatus;
	result?: TaskResult;
	metadata?: Record<string, unknown>;
}

export type TaskStatus =
	| "pending"
	| "queued"
	| "assigned"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "retrying";

export interface TaskResult {
	success: boolean;
	output: string;
	artifacts?: string[];
	metrics?: TaskMetrics;
	error?: string;
}

export interface TaskMetrics {
	startTime: number;
	endTime: number;
	tokenUsage: number;
	cost: number;
	toolCalls: number;
	retries: number;
}

// ─── Coordination ────────────────────────────────────────────────────────────

/** Coordination configuration. */
export interface CoordinationConfig {
	/** How results from multiple agents are combined. */
	aggregation: "first-wins" | "majority-vote" | "merge" | "chain" | "custom";
	/** Consensus threshold for majority-vote (0-1). */
	consensusThreshold?: number;
	/** Whether agents can see each other's work. */
	sharedContext: boolean;
	/** Maximum time for the entire orchestration. */
	timeout?: number;
	/** Whether to continue if one agent fails. */
	tolerateFailures: boolean;
	/** Max failures before aborting entire orchestration. */
	maxFailures?: number;
}

// ─── Fallback ────────────────────────────────────────────────────────────────

/** Fallback when things go wrong. */
export interface FallbackConfig {
	/** Switch to a different model on failure. */
	modelFallback?: string[];
	/** Switch to a different agent profile. */
	profileFallback?: string[];
	/** Escalate to human (emit event for UI to handle). */
	escalateToHuman: boolean;
	/** Custom fallback handler. */
	handler?: (task: OrchestratorTask, error: Error) => OrchestratorTask | null;
}

// ─── Events ──────────────────────────────────────────────────────────────────

/** Events emitted by the orchestrator. */
export type OrchestratorEvent =
	| { type: "plan:start"; planId: string }
	| { type: "plan:complete"; planId: string; results: TaskResult[] }
	| { type: "plan:failed"; planId: string; error: string }
	| { type: "task:queued"; taskId: string; agentSlot: string }
	| { type: "task:assigned"; taskId: string; agentId: string }
	| { type: "task:completed"; taskId: string; result: TaskResult }
	| { type: "task:failed"; taskId: string; error: string }
	| { type: "task:retry"; taskId: string; attempt: number }
	| { type: "agent:spawned"; agentSlot: string; agentId: string }
	| { type: "agent:idle"; agentSlot: string; agentId: string }
	| { type: "agent:overloaded"; agentSlot: string; queueDepth: number }
	| { type: "escalation"; taskId: string; reason: string };

// ─── Stats ───────────────────────────────────────────────────────────────────

/** Orchestrator statistics. */
export interface OrchestratorStats {
	totalTasks: number;
	pendingTasks: number;
	runningTasks: number;
	completedTasks: number;
	failedTasks: number;
	activeAgents: number;
	totalCost: number;
	totalTokens: number;
	averageLatency: number;
	throughput: number;
}

// ─── Agent Info ──────────────────────────────────────────────────────────────

/** Runtime information about an active agent. */
export interface AgentInfo {
	id: string;
	slotId: string;
	role: string;
	currentTask?: string;
	tasksCompleted: number;
	status: "idle" | "busy" | "overloaded";
}

// ─── Metrics Report ──────────────────────────────────────────────────────────

/** Metrics report with windowed statistics. */
export interface MetricsReport {
	overall: OrchestratorStats;
	windows: {
		"1m": WindowStats;
		"5m": WindowStats;
		"15m": WindowStats;
	};
	latencyPercentiles: {
		p50: number;
		p95: number;
		p99: number;
	};
	costBySlot: Record<string, number>;
	errorRate: number;
}

/** Statistics within a time window. */
export interface WindowStats {
	tasksCompleted: number;
	tasksFailed: number;
	averageLatency: number;
	throughput: number;
	tokenUsage: number;
	cost: number;
}
