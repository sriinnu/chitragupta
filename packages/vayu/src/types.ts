/**
 * @chitragupta/vayu — Workflow DAG Engine types.
 *
 * Define complex multi-step agent workflows as directed acyclic graphs
 * with dependencies, parallel execution, conditional branching, and error handling.
 */

// ─── Step Actions ───────────────────────────────────────────────────────────

/** What a step does. */
export type StepAction =
	| { type: "prompt"; message: string; model?: string; profile?: string }
	| { type: "tool"; name: string; args: Record<string, unknown> }
	| { type: "shell"; command: string; cwd?: string; shellArgs?: string[] }
	| { type: "transform"; fn: string }
	| { type: "conditional"; if: StepCondition; then: string; else?: string }
	| { type: "parallel"; steps: string[] }
	| { type: "subworkflow"; workflowId: string; inputs?: Record<string, StepInput> }
	| { type: "wait"; duration: number }
	| { type: "approval"; message: string };

// ─── Step Inputs ────────────────────────────────────────────────────────────

/** How step inputs are resolved. */
export type StepInput =
	| { source: "literal"; value: unknown }
	| { source: "step"; stepId: string; path: string }
	| { source: "env"; variable: string }
	| { source: "context"; key: string }
	| { source: "expression"; expr: string };

// ─── Conditions ─────────────────────────────────────────────────────────────

/** Condition for conditional execution. */
export type StepCondition =
	| { type: "equals"; left: StepInput; right: StepInput }
	| { type: "contains"; input: StepInput; value: string }
	| { type: "exists"; input: StepInput }
	| { type: "not"; condition: StepCondition }
	| { type: "and"; conditions: StepCondition[] }
	| { type: "or"; conditions: StepCondition[] }
	| { type: "expression"; expr: string };

// ─── Retry ──────────────────────────────────────────────────────────────────

export interface RetryConfig {
	maxRetries: number;
	/** Milliseconds between retries. */
	delay: number;
	/** Multiplier for exponential backoff. */
	backoff?: number;
}

// ─── Workflow Step ──────────────────────────────────────────────────────────

/** A workflow step definition. */
export interface WorkflowStep {
	id: string;
	name: string;
	/** What this step does. */
	action: StepAction;
	/** Steps that must complete before this one can start. */
	dependsOn: string[];
	/** Condition to evaluate before running. If false, step is skipped. */
	condition?: StepCondition;
	/** Retry configuration. */
	retry?: RetryConfig;
	/** Timeout in ms. */
	timeout?: number;
	/** Inputs from previous steps or static values. */
	inputs?: Record<string, StepInput>;
	/** What to do on failure. */
	onFailure?: "fail" | "continue" | "retry";
	/** Tags for filtering/grouping. */
	tags?: string[];
}

// ─── Workflow Triggers ──────────────────────────────────────────────────────

export type WorkflowTrigger =
	| { type: "manual" }
	| { type: "file_change"; patterns: string[] }
	| { type: "schedule"; cron: string }
	| { type: "event"; eventName: string };

// ─── Full Workflow ──────────────────────────────────────────────────────────

/** Full workflow definition. */
export interface Workflow {
	id: string;
	name: string;
	description: string;
	version: string;
	steps: WorkflowStep[];
	/** Global context available to all steps. */
	context?: Record<string, unknown>;
	/** Global timeout for entire workflow in ms. */
	timeout?: number;
	/** Max concurrent steps. */
	maxConcurrency?: number;
	/** Triggers that can start this workflow. */
	triggers?: WorkflowTrigger[];
}

// ─── Runtime State ──────────────────────────────────────────────────────────

/** Runtime state of a step. */
export interface StepExecution {
	stepId: string;
	status: "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled";
	startTime?: number;
	endTime?: number;
	output?: unknown;
	error?: string;
	retryCount: number;
	duration?: number;
}

/** Runtime state of a workflow. */
export interface WorkflowExecution {
	workflowId: string;
	executionId: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	startTime: number;
	endTime?: number;
	steps: Map<string, StepExecution>;
	context: Record<string, unknown>;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Events emitted during workflow execution. */
export type WorkflowEvent =
	| { type: "workflow:start"; workflowId: string; executionId: string }
	| { type: "workflow:done"; workflowId: string; executionId: string; status: string }
	| { type: "step:start"; stepId: string; stepName: string }
	| { type: "step:done"; stepId: string; status: string; output?: unknown }
	| { type: "step:error"; stepId: string; error: string; retryCount: number }
	| { type: "step:skip"; stepId: string; reason: string }
	| { type: "step:retry"; stepId: string; attempt: number; maxRetries: number }
	| { type: "approval:required"; stepId: string; message: string }
	| { type: "approval:received"; stepId: string; approved: boolean };
