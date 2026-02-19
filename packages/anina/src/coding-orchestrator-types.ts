/**
 * @chitragupta/anina — CodingOrchestrator types and constants.
 *
 * Shared type definitions for the orchestrator pipeline phases:
 * planning, execution, validation, review, and commit.
 */

import type { CodingAgentEvent, CodingResult } from "./coding-agent.js";
import type { AgentConfig, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of self-review → fix cycles. */
export const MAX_REVIEW_CYCLES = 2;

/** Maximum number of validation → debug-fix cycles. */
export const MAX_DEBUG_CYCLES = 3;

/** Git stash message prefix for orchestrator checkpoints. */
export const STASH_PREFIX = "chitragupta-orchestrator-checkpoint";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Orchestrator execution mode. */
export type OrchestratorMode =
	| "full"       // Plan → Branch → Execute → Validate → Review → Commit
	| "execute"    // Execute → Validate (no git, no review)
	| "plan-only"; // Plan only, no execution

/** A single step in the task plan. */
export interface TaskStep {
	/** Step number (1-indexed). */
	index: number;
	/** Short description of what this step does. */
	description: string;
	/** Files likely affected by this step. */
	affectedFiles: string[];
	/** Whether this step is complete. */
	completed: boolean;
}

/** The task plan produced by the planning phase. */
export interface TaskPlan {
	/** Original task description. */
	task: string;
	/** Decomposed steps. */
	steps: TaskStep[];
	/** Files identified as relevant to the task. */
	relevantFiles: string[];
	/** Estimated complexity: "small" (1-2 files), "medium" (3-5), "large" (6+). */
	complexity: "small" | "medium" | "large";
	/** Whether the task requires new files or only modifications. */
	requiresNewFiles: boolean;
	/** Test suggestion: whether tests should be written and where. */
	testSuggestion?: string;
	/** Dependency hints: files that import/use the affected files. */
	dependencyHints?: string[];
}

/** Git workflow state tracked by the orchestrator. */
export interface GitState {
	/** Whether the working directory is a git repo. */
	isGitRepo: boolean;
	/** The branch created for this task (if any). */
	featureBranch: string | null;
	/** The branch we started from. */
	originalBranch: string | null;
	/** Stash reference for rollback. */
	stashRef: string | null;
	/** Commits made during this task. */
	commits: string[];
}

/** Progress event emitted during orchestration. */
export interface OrchestratorProgress {
	phase: "planning" | "branching" | "executing" | "validating" | "reviewing" | "committing" | "done" | "error";
	step?: number;
	totalSteps?: number;
	message: string;
	/** Time elapsed since orchestration started (ms). */
	elapsedMs: number;
}

/** Aggregated usage statistics from an orchestrator run. */
export interface OrchestratorStats {
	/** Total cost across all LLM calls. */
	totalCost: number;
	/** Currency for cost (e.g. "USD"). */
	currency: string;
	/** Per-category cost breakdown. */
	inputCost: number;
	outputCost: number;
	cacheReadCost: number;
	cacheWriteCost: number;
	/** Tool call breakdown: tool name → call count. */
	toolCalls: Record<string, number>;
	/** Total number of tool calls. */
	totalToolCalls: number;
	/** Number of LLM turns (assistant messages). */
	turns: number;
}

/** Per-phase timing breakdown. */
export interface PhaseTiming {
	phase: string;
	startMs: number;
	endMs: number;
	durationMs: number;
}

/** Diff statistics. */
export interface DiffStats {
	filesChanged: number;
	insertions: number;
	deletions: number;
}

/** Full result of an orchestrated coding task. */
export interface OrchestratorResult {
	/** Whether the entire workflow succeeded. */
	success: boolean;
	/** The task plan (if planning was requested). */
	plan: TaskPlan | null;
	/** Coding results from each execution step. */
	codingResults: CodingResult[];
	/** Git state (branch, commits, etc.). */
	git: GitState;
	/** Review issues found during self-review. */
	reviewIssues: ReviewIssueCompact[];
	/** Whether validation (build + test + lint) passed. */
	validationPassed: boolean;
	/** Total files modified across all steps. */
	filesModified: string[];
	/** Total files created across all steps. */
	filesCreated: string[];
	/** Final summary of what was accomplished. */
	summary: string;
	/** Total elapsed time (ms). */
	elapsedMs: number;
	/** Progress log. */
	progressLog: OrchestratorProgress[];
	/** Aggregated usage stats (tokens, cost, tool calls). */
	stats: OrchestratorStats;
	/** Git diff preview captured before commit (truncated to 8000 chars). */
	diffPreview?: string;
	/** Per-phase timing breakdown. */
	phaseTimings: PhaseTiming[];
	/** Diff statistics (files changed, insertions, deletions). */
	diffStats?: DiffStats;
	/** Structured errors that occurred during orchestration. */
	errors: Array<{ phase: string; message: string; recoverable: boolean }>;
}

/** Compact review issue for the orchestrator result. */
export interface ReviewIssueCompact {
	severity: string;
	file: string;
	line?: number;
	message: string;
}

/** Configuration for the CodingOrchestrator. */
export interface CodingOrchestratorConfig {
	/** Working directory (project root). */
	workingDirectory: string;
	/** Execution mode. Default: "full". */
	mode?: OrchestratorMode;
	/** Provider ID. Default: "anthropic". */
	providerId?: string;
	/** Model ID for the planning/orchestrating agent. */
	modelId?: string;
	/** Test command. Auto-detected if not provided. */
	testCommand?: string;
	/** Build command. Auto-detected if not provided. */
	buildCommand?: string;
	/** Lint command. Auto-detected if not provided. */
	lintCommand?: string;
	/** Whether to create a git feature branch. Default: true in "full" mode. */
	createBranch?: boolean;
	/** Git branch name prefix. Default: "feat/". */
	branchPrefix?: string;
	/** Whether to auto-commit on success. Default: true in "full" mode. */
	autoCommit?: boolean;
	/** Whether to run self-review after coding. Default: true in "full" mode. */
	selfReview?: boolean;
	/** Maximum self-review → fix cycles. Default: 2. */
	maxReviewCycles?: number;
	/** Maximum validation → debug-fix cycles. Default: 3. */
	maxDebugCycles?: number;
	/** Tool handlers to use. Filtered per agent type. */
	tools?: ToolHandler[];
	/** Progress callback. */
	onProgress?: (progress: OrchestratorProgress) => void;
	/** CommHub for IPC. */
	commHub?: AgentConfig["commHub"];
	/** ActorSystem for P2P mesh communication. */
	actorSystem?: AgentConfig["actorSystem"];
	/** Samiti for ambient channel broadcasts. */
	samiti?: AgentConfig["samiti"];
	/** Lokapala guardians for tool call scanning. */
	lokapala?: AgentConfig["lokapala"];
	/** KaalaBrahma lifecycle manager. */
	kaala?: AgentConfig["kaala"];
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
	/** Provider instance. Set by the caller (e.g. MCP tool) to enable LLM execution. */
	provider?: unknown;
	/** Additional context appended to every task prompt (project instructions, memory, etc.). */
	additionalContext?: string;
	/** Maximum time in milliseconds before aborting. Default: no timeout. */
	timeoutMs?: number;
	/**
	 * Coding agent event callback for streaming execution details.
	 * Receives tool calls, thinking, validation results, etc. from the coding agent.
	 */
	onCodingEvent?: (event: CodingAgentEvent) => void;
	/** Optional session ID. When set, records the orchestration to smriti. */
	sessionId?: string;
	/**
	 * Approval callback for destructive/high-impact operations.
	 * Called before git branch creation, commit, or rollback.
	 * Return `true` to proceed, `false` to skip.
	 * If not set, all operations proceed automatically.
	 */
	onApproval?: (action: string, detail: string) => Promise<boolean>;
	/**
	 * Stream callback for real-time output from validation commands.
	 * Called with validation output chunks (build, test, lint results).
	 */
	onStream?: (chunk: string, source: "build" | "test" | "lint" | "review" | "agent") => void;
	/** Git branch name template. Default: "{prefix}{slug}" */
	branchTemplate?: string;
}

/**
 * Resolved orchestrator config with required fields populated.
 * Used internally by phase modules that need guaranteed config values.
 */
export type ResolvedOrchestratorConfig = Required<
	Pick<CodingOrchestratorConfig, "workingDirectory" | "mode" | "providerId" | "branchPrefix" | "maxReviewCycles" | "maxDebugCycles">
> & CodingOrchestratorConfig;
