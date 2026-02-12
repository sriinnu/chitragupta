/**
 * @chitragupta/anina — CodingOrchestrator (संयोजक — The Coordinator).
 *
 * A high-level orchestrator that coordinates specialized agents into
 * an end-to-end coding workflow:
 *
 * 1. **Plan** — Analyze the task, identify affected files, create step-by-step plan
 * 2. **Branch** — Create a git feature branch for the work
 * 3. **Execute** — Run each step using CodingAgent with checkpointing
 * 4. **Validate** — Build, test, lint — retry with DebugAgent on failure
 * 5. **Review** — Self-review using ReviewAgent, fix found issues
 * 6. **Commit** — Generate a descriptive commit with diff summary
 *
 * The orchestrator doesn't replace the individual agents — it composes them
 * into a pipeline with git safety nets and structured progress reporting.
 */

import { existsSync } from "node:fs";
import { join, basename } from "node:path";

import { createLogger } from "@chitragupta/core";

import { Agent } from "./agent.js";
import { CodingAgent, CODE_TOOL_NAMES } from "./coding-agent.js";
import type { CodingAgentConfig, CodingResult, ProjectConventions } from "./coding-agent.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

const log = createLogger("anina:orchestrator");

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of self-review → fix cycles. */
const MAX_REVIEW_CYCLES = 2;

/** Maximum number of validation → debug-fix cycles. */
const MAX_DEBUG_CYCLES = 3;

/** Git stash message prefix for orchestrator checkpoints. */
const STASH_PREFIX = "chitragupta-orchestrator-checkpoint";

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
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
	/** Provider instance. Set by the caller (e.g. MCP tool) to enable LLM execution. */
	provider?: unknown;
	/** Additional context appended to every task prompt (project instructions, memory, etc.). */
	additionalContext?: string;
	/** Maximum time in milliseconds before aborting. Default: no timeout. */
	timeoutMs?: number;
	/** Optional session ID. When set, records the orchestration to smriti. */
	sessionId?: string;
	/**
	 * Approval callback for destructive/high-impact operations.
	 * Called before git branch creation, commit, or rollback.
	 * Return `true` to proceed, `false` to skip.
	 * If not set, all operations proceed automatically.
	 */
	onApproval?: (action: string, detail: string) => Promise<boolean>;
}

// ─── CodingOrchestrator ──────────────────────────────────────────────────────

/**
 * Sanyojaka — the Coordinator.
 *
 * Orchestrates an end-to-end coding workflow by composing specialized agents
 * with git integration, structured planning, and validation loops.
 *
 * @example
 * ```ts
 * import { CodingOrchestrator } from "@chitragupta/anina";
 * import { getAllTools } from "@chitragupta/yantra";
 *
 * const orchestrator = new CodingOrchestrator({
 *   workingDirectory: "/path/to/project",
 *   tools: getAllTools(),
 * });
 * const result = await orchestrator.run("Add input validation to the login form");
 * console.log(result.summary, result.validationPassed, result.git.featureBranch);
 * ```
 */
export class CodingOrchestrator {
	private config: Required<
		Pick<CodingOrchestratorConfig, "workingDirectory" | "mode" | "providerId" | "branchPrefix" | "maxReviewCycles" | "maxDebugCycles">
	> & CodingOrchestratorConfig;
	private codingAgent: CodingAgent | null = null;
	private planningAgent: Agent | null = null;
	private gitState: GitState;
	private progressLog: OrchestratorProgress[] = [];
	private phaseTimings: PhaseTiming[] = [];
	private errors: Array<{ phase: string; message: string; recoverable: boolean }> = [];
	private startTime: number = 0;

	constructor(config: CodingOrchestratorConfig) {
		this.config = {
			...config,
			mode: config.mode ?? "full",
			providerId: config.providerId ?? "anthropic",
			branchPrefix: config.branchPrefix ?? "feat/",
			maxReviewCycles: config.maxReviewCycles ?? MAX_REVIEW_CYCLES,
			maxDebugCycles: config.maxDebugCycles ?? MAX_DEBUG_CYCLES,
		};

		this.gitState = {
			isGitRepo: this.detectGitRepo(),
			featureBranch: null,
			originalBranch: null,
			stashRef: null,
			commits: [],
		};
	}

	/**
	 * Run the full orchestrated coding workflow.
	 *
	 * @param task - Description of the coding task to accomplish.
	 * @returns Comprehensive result including plan, code changes, git state, and review.
	 */
	async run(task: string): Promise<OrchestratorResult> {
		this.startTime = Date.now();
		this.phaseTimings = [];
		this.errors = [];
		const result: OrchestratorResult = {
			success: false,
			plan: null,
			codingResults: [],
			git: this.gitState,
			reviewIssues: [],
			validationPassed: false,
			filesModified: [],
			filesCreated: [],
			summary: "",
			elapsedMs: 0,
			progressLog: this.progressLog,
			stats: {
				totalCost: 0, currency: "USD",
				inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
				toolCalls: {}, totalToolCalls: 0, turns: 0,
			},
			phaseTimings: [],
			errors: [],
		};

		// Timeout guard: abort if timeoutMs exceeded
		const timeoutMs = this.config.timeoutMs;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		if (timeoutMs && timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				// Abort the coding agent if it's running
				if (this.codingAgent) {
					this.codingAgent.getAgent().abort();
				}
			}, timeoutMs);
		}

		try {
			// ── Phase 1: Plan ──
			const planStart = Date.now();
			this.emitProgress("planning", `Analyzing task: ${task.slice(0, 80)}...`);
			const plan = await this.planTask(task);
			result.plan = plan;
			this.recordPhase("planning", planStart);

			if (this.config.mode === "plan-only") {
				result.success = true;
				result.summary = this.formatPlanSummary(plan);
				this.emitProgress("done", result.summary);
				return this.finalize(result);
			}

			// ── Phase 2: Branch ──
			if (this.config.mode === "full" && this.shouldCreateBranch()) {
				const branchStart = Date.now();
				this.emitProgress("branching", "Creating feature branch...");
				const approved = await this.requestApproval("create_branch", `Create branch: ${this.config.branchPrefix}${task.slice(0, 40)}`);
				if (approved) {
					await this.createFeatureBranch(task);
				}
				this.recordPhase("branching", branchStart);
			}

			// ── Phase 3: Execute ──
			const execStart = Date.now();
			this.emitProgress("executing", `Executing ${plan.steps.length} step(s)...`);
			const codingResult = await this.executeTask(task, plan);
			result.codingResults.push(codingResult);
			result.filesModified.push(...codingResult.filesModified);
			result.filesCreated.push(...codingResult.filesCreated);
			this.recordPhase("executing", execStart);

			// ── Phase 4: Validate ──
			const valStart = Date.now();
			this.emitProgress("validating", "Running validation (build, test, lint)...");
			const validationResult = await this.validateWithRetry(codingResult);
			result.validationPassed = validationResult.passed;

			if (validationResult.extraResults.length > 0) {
				result.codingResults.push(...validationResult.extraResults);
				for (const r of validationResult.extraResults) {
					result.filesModified.push(...r.filesModified);
					result.filesCreated.push(...r.filesCreated);
				}
			}
			this.recordPhase("validating", valStart);

			// ── Phase 5: Self-Review ──
			if (this.config.mode === "full" && this.shouldSelfReview()) {
				const revStart = Date.now();
				this.emitProgress("reviewing", "Self-reviewing changes...");
				const reviewResult = await this.selfReview();
				result.reviewIssues = reviewResult.issues;

				// If critical issues found, fix them
				if (reviewResult.hasCritical && reviewResult.fixPrompt) {
					const fixResult = await this.executeFix(reviewResult.fixPrompt);
					if (fixResult) {
						result.codingResults.push(fixResult);
						result.filesModified.push(...fixResult.filesModified);
					}
				}
				this.recordPhase("reviewing", revStart);
			}

			// ── Diff preview + stats (captured before commit) ──
			if (this.gitState.isGitRepo && (result.filesModified.length > 0 || result.filesCreated.length > 0)) {
				try {
					const diff = this.gitExec("git diff HEAD").trim();
					if (diff) {
						result.diffPreview = diff.length > 8000 ? diff.slice(0, 8000) + "\n\n... (truncated)" : diff;
						result.diffStats = this.parseDiffStats(diff);
						this.emitProgress("committing", `Diff: +${result.diffStats.insertions}/-${result.diffStats.deletions} in ${result.diffStats.filesChanged} file(s)`);
					}
				} catch { /* non-fatal */ }
			}

			// ── Phase 6: Commit ──
			if (this.config.mode === "full" && this.shouldAutoCommit()) {
				const commitStart = Date.now();
				this.emitProgress("committing", "Generating commit...");
				const approved = await this.requestApproval("commit", `Commit changes (${result.filesModified.length + result.filesCreated.length} files)`);
				if (approved) {
					await this.commitChanges(task, result);
				}
				this.recordPhase("committing", commitStart);
			}

			result.success = true;
			result.summary = this.buildSummary(result);
			this.emitProgress("done", result.summary);

		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.summary = `Orchestration failed: ${message}`;
			this.errors.push({ phase: "run", message, recoverable: false });
			this.emitProgress("error", result.summary);
			log.debug("orchestration failed", { error: message });

			// Attempt rollback if we have a stash
			if (this.gitState.stashRef) {
				this.rollback();
			}
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}

		return this.finalize(result);
	}

	/** Get the detected git state. */
	getGitState(): Readonly<GitState> {
		return { ...this.gitState };
	}

	/** Get the underlying CodingAgent (created on first execute). */
	getCodingAgent(): CodingAgent | null {
		return this.codingAgent;
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Phase 1: Planning
	// ═══════════════════════════════════════════════════════════════════════

	/**
	 * Analyze a task and produce a structured plan.
	 * Uses a lightweight agent prompt to decompose the task.
	 */
	private async planTask(task: string): Promise<TaskPlan> {
		// For simple tasks, skip LLM planning entirely
		const simpleKeywords = ["fix typo", "rename", "add comment", "remove unused", "update import"];
		const isSimple = simpleKeywords.some((kw) => task.toLowerCase().includes(kw));

		if (isSimple) {
			return {
				task,
				steps: [{ index: 1, description: task, affectedFiles: [], completed: false }],
				relevantFiles: [],
				complexity: "small",
				requiresNewFiles: false,
			};
		}

		// Try LLM-based planning when a provider is available
		if (this.config.provider) {
			try {
				const plan = await this.llmPlan(task);
				if (plan) return plan;
			} catch (err) {
				log.warn("LLM planning failed, falling back to heuristic:", { error: String(err) });
			}
		}

		return this.heuristicPlan(task);
	}

	/**
	 * LLM-based planning: create a lightweight read-only agent that explores
	 * the project and returns a structured JSON plan.
	 */
	private async llmPlan(task: string): Promise<TaskPlan | null> {
		const { KARTRU_PROFILE } = await import("@chitragupta/core");

		// Filter to read-only tools only
		const readOnlyNames = new Set(["read", "ls", "find", "grep", "bash"]);
		const readOnlyTools = (this.config.tools ?? []).filter(
			(t) => readOnlyNames.has(t.definition.name),
		);

		const planningConfig: AgentConfig = {
			profile: { ...KARTRU_PROFILE, id: "sanyojaka-planner", name: "Sanyojaka Planner" },
			providerId: this.config.providerId,
			model: this.config.modelId ?? KARTRU_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools: readOnlyTools,
			thinkingLevel: "medium",
			workingDirectory: this.config.workingDirectory,
			maxTurns: 8,
			enableChetana: false,
			enableLearning: false,
			enableAutonomy: false,
		};

		this.planningAgent = new Agent(planningConfig);
		this.planningAgent.setProvider(this.config.provider as import("@chitragupta/swara").ProviderDefinition);

		const contextNote = this.config.additionalContext
			? `\n\nProject context:\n${this.config.additionalContext}`
			: "";

		const planPrompt = `You are a coding task planner. Analyze the following coding task and the project structure, then produce a detailed plan.

Task: ${task}

Working directory: ${this.config.workingDirectory}
${contextNote}

Instructions:
1. Use the available tools (read, ls, find, grep) to explore the project structure and understand the codebase.
2. Identify which files are relevant to the task.
3. Determine what changes need to be made.
4. Create a step-by-step plan.

After exploring, respond with ONLY a JSON object (no markdown fences, no explanation) in this exact format:
{
  "steps": [
    { "index": 1, "description": "Short description of step", "affectedFiles": ["path/to/file.ts"] }
  ],
  "relevantFiles": ["path/to/file1.ts", "path/to/file2.ts"],
  "complexity": "small" | "medium" | "large",
  "requiresNewFiles": true | false
}

Where complexity is:
- "small": 1-2 files changed, simple fix
- "medium": 3-5 files, moderate changes
- "large": 6+ files or significant structural changes

Keep steps focused and actionable. Each step should describe a single coherent change.`;

		const response = await this.planningAgent.prompt(planPrompt);

		// Extract JSON from the last assistant message
		const textContent = response.content
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("");

		// Try to parse JSON — look for { ... } in the response
		const jsonMatch = textContent.match(/\{[\s\S]*"steps"[\s\S]*\}/);
		if (!jsonMatch) {
			log.warn("LLM plan response did not contain valid JSON");
			return null;
		}

		try {
			const parsed = JSON.parse(jsonMatch[0]) as {
				steps?: Array<{ index?: number; description?: string; affectedFiles?: string[] }>;
				relevantFiles?: string[];
				complexity?: string;
				requiresNewFiles?: boolean;
			};

			if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
				log.warn("LLM plan has no steps");
				return null;
			}

			const steps: TaskStep[] = parsed.steps.map((s, i) => ({
				index: s.index ?? i + 1,
				description: s.description ?? `Step ${i + 1}`,
				affectedFiles: Array.isArray(s.affectedFiles) ? s.affectedFiles : [],
				completed: false,
			}));

			const complexity = (["small", "medium", "large"] as const).includes(
				parsed.complexity as "small" | "medium" | "large",
			)
				? (parsed.complexity as TaskPlan["complexity"])
				: steps.length <= 2 ? "small" : steps.length <= 4 ? "medium" : "large";

			return {
				task,
				steps,
				relevantFiles: Array.isArray(parsed.relevantFiles) ? parsed.relevantFiles : [],
				complexity,
				requiresNewFiles: parsed.requiresNewFiles ?? false,
			};
		} catch (parseErr) {
			log.warn("Failed to parse LLM plan JSON:", { error: String(parseErr) });
			return null;
		}
	}

	/** Heuristic-only planning fallback (no LLM needed). */
	private async heuristicPlan(task: string): Promise<TaskPlan> {
		const agent = this.getOrCreateCodingAgent();
		const conventions = await agent.detectConventions();

		const steps: TaskStep[] = [];
		let requiresNewFiles = false;

		if (/\b(create|add|new|implement)\b.*\b(files?|components?|modules?|class(?:es)?|functions?|endpoints?|routes?|tests?)\b/i.test(task)) {
			requiresNewFiles = true;
		}

		const mentionsTests = /\b(tests?|specs?|testing)\b/i.test(task);

		steps.push({ index: 1, description: "Understand the codebase: read relevant files and identify patterns", affectedFiles: [], completed: false });

		if (requiresNewFiles) {
			steps.push({ index: steps.length + 1, description: "Create new file(s) following project conventions", affectedFiles: [], completed: false });
		}

		steps.push({ index: steps.length + 1, description: "Implement the changes", affectedFiles: [], completed: false });

		if (mentionsTests || conventions.testCommand) {
			steps.push({ index: steps.length + 1, description: "Write or update tests", affectedFiles: [], completed: false });
		}

		const complexityKeywords = /\b(refactor|redesign|rewrite|migrate|architecture|system)\b/i;
		const complexity: TaskPlan["complexity"] = complexityKeywords.test(task)
			? "large"
			: steps.length > 3 ? "medium" : "small";

		return { task, steps, relevantFiles: [], complexity, requiresNewFiles };
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Phase 2: Git Branch
	// ═══════════════════════════════════════════════════════════════════════

	private async createFeatureBranch(task: string): Promise<void> {
		if (!this.gitState.isGitRepo) return;

		try {
			// Save current branch
			this.gitState.originalBranch = this.gitExec("git rev-parse --abbrev-ref HEAD").trim();

			// Generate branch name from task
			const branchName = this.generateBranchName(task);
			this.gitExec(`git checkout -b ${branchName}`);
			this.gitState.featureBranch = branchName;

			log.debug("created feature branch", { branch: branchName });
		} catch (err) {
			log.debug("failed to create feature branch", { error: String(err) });
			// Non-fatal — continue without branching
		}
	}

	private generateBranchName(task: string): string {
		const slug = task
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.replace(/\s+/g, "-")
			.slice(0, 40)
			.replace(/-+$/, "");

		return `${this.config.branchPrefix}${slug || "task"}`;
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Phase 3: Execute
	// ═══════════════════════════════════════════════════════════════════════

	private async executeTask(task: string, plan: TaskPlan): Promise<CodingResult> {
		const agent = this.getOrCreateCodingAgent();

		// Enrich the task with plan context
		const enrichedTask = this.enrichTaskWithPlan(task, plan);

		// Checkpoint before execution (if git available)
		this.checkpoint("pre-execution");

		const result = await agent.execute(enrichedTask);

		// Mark all steps as completed
		for (const step of plan.steps) {
			step.completed = true;
		}

		return result;
	}

	private enrichTaskWithPlan(task: string, plan: TaskPlan): string {
		if (plan.steps.length <= 1) return task;

		const planStr = plan.steps
			.map((s) => `${s.index}. ${s.description}`)
			.join("\n");

		return [
			task,
			"",
			"--- Execution Plan ---",
			planStr,
			"",
			`Complexity: ${plan.complexity}`,
			plan.requiresNewFiles ? "Note: This task requires creating new files." : "",
		].filter(Boolean).join("\n");
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Phase 4: Validate with Debug Retry
	// ═══════════════════════════════════════════════════════════════════════

	private async validateWithRetry(
		initialResult: CodingResult,
	): Promise<{ passed: boolean; extraResults: CodingResult[] }> {
		const agent = this.getOrCreateCodingAgent();
		const extraResults: CodingResult[] = [];

		// If the initial result already passed validation, we're done
		if (initialResult.validationPassed) {
			return { passed: true, extraResults };
		}

		// Run validation independently
		const validation = await agent.validate();
		if (validation.passed) {
			return { passed: true, extraResults };
		}

		// Validation failed — retry with debug-fix cycles
		let debugCycles = 0;
		let lastValidation = validation;

		while (!lastValidation.passed && debugCycles < this.config.maxDebugCycles) {
			debugCycles++;
			this.emitProgress(
				"validating",
				`Validation failed, debug-fix cycle ${debugCycles}/${this.config.maxDebugCycles}...`,
			);

			// Send the validation errors to the coding agent for fixing
			const fixPrompt = [
				`Validation failed (attempt ${debugCycles}/${this.config.maxDebugCycles}). Fix these errors:`,
				"",
				"```",
				lastValidation.output,
				"```",
				"",
				"Analyze the errors carefully, fix the root cause (not just the symptoms),",
				"and ensure the code compiles and all tests pass.",
			].join("\n");

			const fixResult = await agent.execute(fixPrompt);
			extraResults.push(fixResult);

			// Re-validate
			lastValidation = await agent.validate();
		}

		return { passed: lastValidation.passed, extraResults };
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Phase 5: Self-Review
	// ═══════════════════════════════════════════════════════════════════════

	private async selfReview(): Promise<{
		issues: ReviewIssueCompact[];
		hasCritical: boolean;
		fixPrompt: string | null;
	}> {
		if (!this.gitState.isGitRepo) {
			return { issues: [], hasCritical: false, fixPrompt: null };
		}

		try {
			// Get the diff of all changes
			const diff = this.gitExec("git diff HEAD").trim();
			if (!diff) {
				return { issues: [], hasCritical: false, fixPrompt: null };
			}

			// Use the coding agent to do a self-review
			const agent = this.getOrCreateCodingAgent();
			const reviewPrompt = [
				"Review the following changes you just made. Look for:",
				"- Bugs: null checks, off-by-one, race conditions, unhandled errors",
				"- Security: injection, XSS, secrets in code, unsafe permissions",
				"- Style: naming, consistency, dead code, missing types",
				"",
				"```diff",
				diff.length > 8000 ? diff.slice(0, 8000) + "\n... (truncated)" : diff,
				"```",
				"",
				"Format each issue as:",
				"ISSUE: <SEVERITY> <file>:<line> <message>",
				"Where SEVERITY is CRITICAL, ERROR, WARNING, or INFO.",
				"",
				"If no issues found, respond with: NO ISSUES FOUND",
			].join("\n");

			const response = await agent.getAgent().prompt(reviewPrompt);
			const text = response.content
				.filter((p) => p.type === "text")
				.map((p) => (p as { type: "text"; text: string }).text)
				.join("\n");

			// Parse review issues
			const issues = this.parseReviewIssues(text);
			const hasCritical = issues.some((i) => i.severity === "CRITICAL" || i.severity === "ERROR");

			let fixPrompt: string | null = null;
			if (hasCritical) {
				const criticalIssues = issues
					.filter((i) => i.severity === "CRITICAL" || i.severity === "ERROR")
					.map((i) => `- ${i.severity}: ${i.file}${i.line ? `:${i.line}` : ""} ${i.message}`)
					.join("\n");

				fixPrompt = [
					"Self-review found critical issues that must be fixed:",
					"",
					criticalIssues,
					"",
					"Fix these issues now.",
				].join("\n");
			}

			return { issues, hasCritical, fixPrompt };
		} catch (err) {
			log.debug("self-review failed", { error: String(err) });
			return { issues: [], hasCritical: false, fixPrompt: null };
		}
	}

	private parseReviewIssues(text: string): ReviewIssueCompact[] {
		if (text.includes("NO ISSUES FOUND")) return [];

		const issues: ReviewIssueCompact[] = [];
		const lines = text.split("\n");

		for (const line of lines) {
			const match = line.match(/ISSUE:\s*(CRITICAL|ERROR|WARNING|INFO)\s+(\S+?)(?::(\d+))?\s+(.+)/i);
			if (match) {
				issues.push({
					severity: match[1].toUpperCase(),
					file: match[2],
					line: match[3] ? parseInt(match[3], 10) : undefined,
					message: match[4],
				});
			}
		}

		return issues;
	}

	private async executeFix(fixPrompt: string): Promise<CodingResult | null> {
		try {
			const agent = this.getOrCreateCodingAgent();
			return await agent.execute(fixPrompt);
		} catch (err) {
			log.debug("fix execution failed", { error: String(err) });
			return null;
		}
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Phase 6: Commit
	// ═══════════════════════════════════════════════════════════════════════

	private async commitChanges(task: string, result: OrchestratorResult): Promise<void> {
		if (!this.gitState.isGitRepo) return;

		try {
			// Check if there are changes to commit
			const status = this.gitExec("git status --porcelain").trim();
			if (!status) return;

			// Stage all changes
			this.gitExec("git add -A");

			// Generate commit message
			const commitMsg = this.generateCommitMessage(task, result);

			// Write commit message to a temp file to avoid all shell escaping issues
			const { writeFileSync, unlinkSync } = await import("node:fs");
			const msgFile = join(this.config.workingDirectory, ".git", "CHITRAGUPTA_COMMIT_MSG");
			try {
				writeFileSync(msgFile, commitMsg, "utf-8");
				this.gitExec(`git commit --file="${msgFile}"`);
			} finally {
				// Clean up temp file
				try { unlinkSync(msgFile); } catch { /* ignore */ }
			}

			// Verify commit succeeded by checking the hash
			const commitHash = this.gitExec("git rev-parse --short HEAD").trim();
			if (commitHash) {
				this.gitState.commits.push(commitHash);
				log.debug("committed changes", { hash: commitHash });
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			// Check if pre-commit hook blocked the commit
			if (errMsg.includes("hook")) {
				log.debug("commit blocked by git hook", { error: errMsg });
				this.emitProgress("committing", `Commit blocked by git hook: ${errMsg.slice(0, 100)}`);
			} else {
				log.debug("commit failed", { error: errMsg });
			}
			// Non-fatal — the code changes are still there
		}
	}

	private generateCommitMessage(task: string, result: OrchestratorResult): string {
		const filesCount = result.filesModified.length + result.filesCreated.length;
		const prefix = result.filesCreated.length > 0 ? "feat" : "fix";
		const subject = task.length > 60 ? task.slice(0, 57) + "..." : task;

		const lines = [`${prefix}: ${subject}`];

		if (filesCount > 0) {
			lines.push("");
			if (result.filesModified.length > 0) {
				lines.push(`Modified: ${result.filesModified.map((f) => basename(f)).join(", ")}`);
			}
			if (result.filesCreated.length > 0) {
				lines.push(`Created: ${result.filesCreated.map((f) => basename(f)).join(", ")}`);
			}
			if (result.diffStats) {
				lines.push(`Changes: +${result.diffStats.insertions}/-${result.diffStats.deletions}`);
			}
		}

		if (result.validationPassed) {
			lines.push("");
			lines.push("Validation: passed (build + test + lint)");
		}

		lines.push("");
		lines.push("Generated by Sanyojaka (CodingOrchestrator)");

		return lines.join("\n");
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Git Utilities
	// ═══════════════════════════════════════════════════════════════════════

	private detectGitRepo(): boolean {
		return existsSync(join(this.config.workingDirectory, ".git"));
	}

	private gitExec(command: string): string {
		return safeExecSync(command, {
			cwd: this.config.workingDirectory,
			encoding: "utf-8",
			timeout: 30_000,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	private checkpoint(label: string): void {
		if (!this.gitState.isGitRepo) return;

		try {
			// Check if there are changes to stash
			const status = this.gitExec("git status --porcelain").trim();
			if (!status) return;

			// Stash changes — keep them as a safety net (do NOT pop immediately)
			this.gitExec(`git stash push -m "${STASH_PREFIX}: ${label}"`);
			this.gitState.stashRef = label;

			// Pop the stash so work continues with the files in place
			// but now we have a stash entry to fall back to
			try {
				this.gitExec("git stash pop");
			} catch {
				// Pop conflict — stash is preserved, apply instead
				try {
					this.gitExec("git stash apply");
				} catch {
					// If apply also fails, the stash is still there for manual recovery
					log.debug("stash pop/apply failed — stash preserved for manual recovery", { label });
				}
			}
		} catch {
			// Non-fatal — checkpoint is best-effort
		}
	}

	private rollback(): void {
		if (!this.gitState.isGitRepo) return;

		try {
			// First, discard uncommitted changes on the feature branch
			if (this.gitState.featureBranch) {
				try {
					this.gitExec("git reset --hard HEAD");
				} catch { /* ignore */ }
			}

			// Checkout the original branch
			if (this.gitState.originalBranch) {
				try {
					this.gitExec(`git checkout ${this.gitState.originalBranch}`);
					log.debug("rolled back to original branch", { branch: this.gitState.originalBranch });
				} catch (err) {
					log.debug("failed to checkout original branch", { error: String(err) });
					return; // Don't delete branch if we can't switch away
				}

				// Delete the feature branch (it was created by us)
				if (this.gitState.featureBranch) {
					try {
						this.gitExec(`git branch -D ${this.gitState.featureBranch}`);
						log.debug("deleted feature branch", { branch: this.gitState.featureBranch });
						this.gitState.featureBranch = null;
					} catch {
						log.debug("failed to delete feature branch (manual cleanup needed)");
					}
				}
			}
		} catch (err) {
			log.debug("rollback failed", { error: String(err) });
		}
	}

	private escapeForShell(str: string): string {
		// Escape double quotes and backslashes for shell safety
		return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Agent Management
	// ═══════════════════════════════════════════════════════════════════════

	private getOrCreateCodingAgent(): CodingAgent {
		if (this.codingAgent) return this.codingAgent;

		const agentConfig: CodingAgentConfig = {
			workingDirectory: this.config.workingDirectory,
			providerId: this.config.providerId,
			modelId: this.config.modelId,
			testCommand: this.config.testCommand,
			buildCommand: this.config.buildCommand,
			lintCommand: this.config.lintCommand,
			tools: this.config.tools,
			policyEngine: this.config.policyEngine,
			commHub: this.config.commHub,
			additionalContext: this.config.additionalContext,
		};

		this.codingAgent = new CodingAgent(agentConfig);

		// Inject provider if the caller supplied one (e.g. MCP tool wrapper)
		if (this.config.provider) {
			this.codingAgent.getAgent().setProvider(this.config.provider as import("@chitragupta/swara").ProviderDefinition);
		}

		return this.codingAgent;
	}

	// ═══════════════════════════════════════════════════════════════════════
	// Helpers
	// ═══════════════════════════════════════════════════════════════════════

	private shouldCreateBranch(): boolean {
		return this.config.createBranch !== false && this.gitState.isGitRepo;
	}

	private shouldSelfReview(): boolean {
		return this.config.selfReview !== false;
	}

	private shouldAutoCommit(): boolean {
		return this.config.autoCommit !== false;
	}

	private recordPhase(phase: string, startMs: number): void {
		const endMs = Date.now();
		this.phaseTimings.push({ phase, startMs: startMs - this.startTime, endMs: endMs - this.startTime, durationMs: endMs - startMs });
	}

	private async requestApproval(action: string, detail: string): Promise<boolean> {
		if (!this.config.onApproval) return true;
		try {
			return await this.config.onApproval(action, detail);
		} catch {
			return true; // Default to proceeding if callback fails
		}
	}

	private parseDiffStats(diff: string): DiffStats {
		let insertions = 0;
		let deletions = 0;
		const files = new Set<string>();
		for (const line of diff.split("\n")) {
			if (line.startsWith("+++ b/")) {
				files.add(line.slice(6));
			} else if (line.startsWith("+") && !line.startsWith("+++")) {
				insertions++;
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				deletions++;
			}
		}
		return { filesChanged: files.size, insertions, deletions };
	}

	private emitProgress(phase: OrchestratorProgress["phase"], message: string, step?: number, totalSteps?: number): void {
		const progress: OrchestratorProgress = {
			phase,
			step,
			totalSteps,
			message,
			elapsedMs: Date.now() - this.startTime,
		};
		this.progressLog.push(progress);
		this.config.onProgress?.(progress);
	}

	private formatPlanSummary(plan: TaskPlan): string {
		const lines = [
			`Plan for: ${plan.task}`,
			`Complexity: ${plan.complexity}`,
			`Steps: ${plan.steps.length}`,
			"",
			...plan.steps.map((s) => `  ${s.index}. ${s.description}`),
		];
		return lines.join("\n");
	}

	private buildSummary(result: OrchestratorResult): string {
		const parts: string[] = [];
		const totalFiles = result.filesModified.length + result.filesCreated.length;

		parts.push(`Task completed: ${totalFiles} file(s) changed`);

		if (result.diffStats) {
			parts.push(`+${result.diffStats.insertions}/-${result.diffStats.deletions}`);
		}

		if (result.validationPassed) {
			parts.push("Validation: passed");
		} else {
			parts.push("Validation: failed");
		}

		if (result.reviewIssues.length > 0) {
			parts.push(`Review: ${result.reviewIssues.length} issue(s) found`);
		}

		if (result.git.featureBranch) {
			parts.push(`Branch: ${result.git.featureBranch}`);
		}

		if (result.git.commits.length > 0) {
			parts.push(`Commits: ${result.git.commits.join(", ")}`);
		}

		return parts.join(" | ");
	}

	private finalize(result: OrchestratorResult): OrchestratorResult {
		result.elapsedMs = Date.now() - this.startTime;
		result.git = { ...this.gitState };
		// Deduplicate file lists
		result.filesModified = [...new Set(result.filesModified)];
		result.filesCreated = [...new Set(result.filesCreated)];
		// Compute usage stats from agent messages
		result.stats = this.computeStats();
		// Phase timings and structured errors
		result.phaseTimings = [...this.phaseTimings];
		result.errors = [...this.errors];
		// Record session (fire-and-forget)
		this.recordSession(result).catch((e) => {
			log.debug("session recording failed", { error: String(e) });
		});
		return result;
	}

	/** Record the orchestration result to @chitragupta/smriti (if sessionId set). */
	private async recordSession(result: OrchestratorResult): Promise<void> {
		if (!this.config.sessionId) return;

		try {
			const { createSession, addTurn } = await import("@chitragupta/smriti");
			const project = this.config.workingDirectory;

			const session = createSession({
				title: `Coding: ${result.plan?.task ?? "unknown task"}`,
				project,
				agent: "sanyojaka",
				model: this.config.modelId ?? "unknown",
			});

			const sessionId = session.meta.id;

			// Record the plan as user turn
			await addTurn(sessionId, project, {
				turnNumber: 1,
				role: "user",
				content: `Task: ${result.plan?.task ?? "unknown"}\nMode: ${this.config.mode}\nComplexity: ${result.plan?.complexity ?? "unknown"}`,
			});

			// Record the result as assistant turn
			const toolCalls = Object.entries(result.stats.toolCalls).map(([name, count]) => ({
				name,
				input: `${count} calls`,
				result: "ok",
			}));

			await addTurn(sessionId, project, {
				turnNumber: 2,
				role: "assistant",
				content: [
					`Result: ${result.success ? "success" : "failed"}`,
					`Files modified: ${result.filesModified.join(", ") || "none"}`,
					`Files created: ${result.filesCreated.join(", ") || "none"}`,
					`Validation: ${result.validationPassed ? "passed" : "failed"}`,
					`Review issues: ${result.reviewIssues.length}`,
					`Git: ${result.git.featureBranch ?? "no branch"} | ${result.git.commits.join(", ") || "no commits"}`,
					`Cost: $${result.stats.totalCost.toFixed(4)} | ${result.stats.turns} turns | ${result.stats.totalToolCalls} tool calls`,
					`Duration: ${result.elapsedMs}ms`,
					result.summary,
				].join("\n"),
				toolCalls,
			});

			log.debug("session recorded", { sessionId });
		} catch {
			// smriti is optional — don't fail the orchestration
		}
	}

	/** Aggregate cost and tool usage from the coding agent's message history. */
	private computeStats(): OrchestratorStats {
		const stats: OrchestratorStats = {
			totalCost: 0, currency: "USD",
			inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
			toolCalls: {}, totalToolCalls: 0, turns: 0,
		};

		if (!this.codingAgent) return stats;

		const messages = this.codingAgent.getAgent().getMessages();
		for (const msg of messages) {
			if (msg.role === "assistant") {
				stats.turns++;
				if (msg.cost) {
					stats.inputCost += msg.cost.input;
					stats.outputCost += msg.cost.output;
					stats.cacheReadCost += msg.cost.cacheRead ?? 0;
					stats.cacheWriteCost += msg.cost.cacheWrite ?? 0;
					stats.totalCost += msg.cost.total;
					stats.currency = msg.cost.currency;
				}
			}
			for (const part of msg.content) {
				if (part.type === "tool_call" && "name" in part) {
					const name = (part as { name: string }).name;
					stats.toolCalls[name] = (stats.toolCalls[name] ?? 0) + 1;
					stats.totalToolCalls++;
				}
			}
		}

		return stats;
	}
}
