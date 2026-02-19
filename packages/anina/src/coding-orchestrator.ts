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

import { createLogger } from "@chitragupta/core";

import { Agent } from "./agent.js";
import { CodingAgent } from "./coding-agent.js";
import type { CodingAgentConfig } from "./coding-agent.js";
import { DebugAgent } from "./debug-agent.js";
import type { DebugAgentConfig } from "./debug-agent.js";
import { ReviewAgent } from "./review-agent.js";
import type { ReviewAgentConfig } from "./review-agent.js";

// Phase modules
import { planTask, formatPlanSummary } from "./coding-planner.js";
import {
	detectGitRepo,
	gitExec,
	createFeatureBranch,
	executeTask,
	validateWithRetry,
	parseDiffStats,
	computeStats,
	rollback,
} from "./coding-executor.js";
import {
	selfReview,
	executeFix,
	commitChanges,
	buildSummary,
	recordSession,
} from "./coding-reviewer.js";

// Re-export all types for backward compatibility
import { MAX_REVIEW_CYCLES, MAX_DEBUG_CYCLES } from "./coding-orchestrator-types.js";
export type {
	OrchestratorMode,
	TaskStep,
	TaskPlan,
	GitState,
	OrchestratorProgress,
	OrchestratorStats,
	PhaseTiming,
	DiffStats,
	OrchestratorResult,
	ReviewIssueCompact,
	CodingOrchestratorConfig,
} from "./coding-orchestrator-types.js";

import type {
	CodingOrchestratorConfig,
	GitState,
	OrchestratorProgress,
	OrchestratorResult,
	PhaseTiming,
	ResolvedOrchestratorConfig,
} from "./coding-orchestrator-types.js";

const log = createLogger("anina:orchestrator");

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
	private config: ResolvedOrchestratorConfig;
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
			isGitRepo: detectGitRepo(this.config.workingDirectory),
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

		const timeoutMs = this.config.timeoutMs;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		if (timeoutMs && timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				if (this.codingAgent) {
					this.codingAgent.getAgent().abort();
				}
			}, timeoutMs);
		}

		try {
			// ── Phase 1: Plan ──
			const planStart = Date.now();
			this.emitProgress("planning", `Analyzing task: ${task.slice(0, 80)}...`);
			const planResult = await planTask(task, this.config, () => this.getOrCreateCodingAgent(), this.gitState.isGitRepo);
			result.plan = planResult.plan;
			this.planningAgent = planResult.planningAgent;
			this.recordPhase("planning", planStart);

			if (this.config.mode === "plan-only") {
				result.success = true;
				result.summary = formatPlanSummary(planResult.plan);
				this.emitProgress("done", result.summary);
				return this.finalize(result);
			}

			if (planResult.plan.steps.length === 0) {
				result.success = false;
				result.summary = "This doesn't look like a coding task. Try describing a code change, bug fix, or feature to implement.";
				this.emitProgress("done", result.summary);
				result.errors.push({ phase: "planning", message: result.summary, recoverable: true });
				return this.finalize(result);
			}

			// ── Phase 2: Branch ──
			if (this.config.mode === "full" && this.shouldCreateBranch()) {
				const branchStart = Date.now();
				this.emitProgress("branching", "Creating feature branch...");
				const approved = await this.requestApproval("create_branch", `Create branch: ${this.config.branchPrefix}${task.slice(0, 40)}`);
				if (approved) {
					await createFeatureBranch(task, this.config, this.gitState, this.emitProgress.bind(this), this.requestApproval.bind(this), this.errors);
				}
				this.recordPhase("branching", branchStart);
			}

			// ── Phase 3: Execute ──
			const execStart = Date.now();
			this.emitProgress("executing", `Executing ${planResult.plan.steps.length} step(s)...`);
			const codingResult = await executeTask(task, planResult.plan, this.getOrCreateCodingAgent(), this.gitState, this.config.workingDirectory);
			result.codingResults.push(codingResult);
			result.filesModified.push(...codingResult.filesModified);
			result.filesCreated.push(...codingResult.filesCreated);
			this.recordPhase("executing", execStart);

			// ── Phase 4: Validate ──
			const valStart = Date.now();
			this.emitProgress("validating", "Running validation (build, test, lint)...");
			const validationResult = await validateWithRetry(
				codingResult, this.config, () => this.getOrCreateCodingAgent(),
				() => this.createDebugAgent(), this.emitProgress.bind(this), this.errors,
			);
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
				const reviewResult = await selfReview(
					this.gitState, this.config.workingDirectory,
					() => this.createReviewAgent(), () => this.getOrCreateCodingAgent(),
				);
				result.reviewIssues = reviewResult.issues;

				if (reviewResult.hasCritical && reviewResult.fixPrompt) {
					const fixResult = await executeFix(reviewResult.fixPrompt, () => this.getOrCreateCodingAgent());
					if (fixResult) {
						result.codingResults.push(fixResult);
						result.filesModified.push(...fixResult.filesModified);
					}
				}
				this.recordPhase("reviewing", revStart);
			}

			// ── Diff preview + stats ──
			if (this.gitState.isGitRepo && (result.filesModified.length > 0 || result.filesCreated.length > 0)) {
				try {
					const diff = gitExec("git diff HEAD", this.config.workingDirectory).trim();
					if (diff) {
						result.diffPreview = diff.length > 8000 ? diff.slice(0, 8000) + "\n\n... (truncated)" : diff;
						result.diffStats = parseDiffStats(diff);
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
					await commitChanges(task, result, this.config, this.gitState, this.emitProgress.bind(this), this.errors);
				}
				this.recordPhase("committing", commitStart);
			}

			result.success = true;
			result.summary = buildSummary(result);
			this.emitProgress("done", result.summary);

		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.summary = `Orchestration failed: ${message}`;
			this.errors.push({ phase: "run", message, recoverable: false });
			this.emitProgress("error", result.summary);
			log.debug("orchestration failed", { error: message });

			if (this.gitState.stashRef) {
				rollback(this.gitState, this.config.workingDirectory);
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
			actorSystem: this.config.actorSystem,
			samiti: this.config.samiti,
			lokapala: this.config.lokapala,
			kaala: this.config.kaala,
			additionalContext: this.config.additionalContext,
			onEvent: this.config.onCodingEvent,
		};

		this.codingAgent = new CodingAgent(agentConfig);

		if (this.config.provider) {
			this.codingAgent.getAgent().setProvider(this.config.provider as import("@chitragupta/swara").ProviderDefinition);
		}

		return this.codingAgent;
	}

	/** Create a DebugAgent for investigating validation failures. */
	private createDebugAgent(): DebugAgent {
		const config: DebugAgentConfig = {
			workingDirectory: this.config.workingDirectory,
			providerId: this.config.providerId,
			modelId: this.config.modelId,
			autoFix: true,
			testCommand: this.config.testCommand,
			buildCommand: this.config.buildCommand,
			tools: this.config.tools,
			policyEngine: this.config.policyEngine,
			commHub: this.config.commHub,
			actorSystem: this.config.actorSystem,
			samiti: this.config.samiti,
			lokapala: this.config.lokapala,
			kaala: this.config.kaala,
		};

		const agent = new DebugAgent(config);

		if (this.config.provider) {
			agent.getAgent().setProvider(this.config.provider as import("@chitragupta/swara").ProviderDefinition);
		}

		return agent;
	}

	/** Create a ReviewAgent for self-reviewing changes. */
	private createReviewAgent(): ReviewAgent {
		const config: ReviewAgentConfig = {
			workingDirectory: this.config.workingDirectory,
			providerId: this.config.providerId,
			modelId: this.config.modelId,
			focus: ["bugs", "security"],
			minSeverity: "warning",
			maxIssues: 10,
			tools: this.config.tools,
			policyEngine: this.config.policyEngine,
			commHub: this.config.commHub,
			actorSystem: this.config.actorSystem,
			samiti: this.config.samiti,
			lokapala: this.config.lokapala,
			kaala: this.config.kaala,
		};

		const agent = new ReviewAgent(config);

		if (this.config.provider) {
			agent.getAgent().setProvider(this.config.provider as import("@chitragupta/swara").ProviderDefinition);
		}

		return agent;
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
			return true;
		}
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

	private finalize(result: OrchestratorResult): OrchestratorResult {
		result.elapsedMs = Date.now() - this.startTime;
		result.git = { ...this.gitState };
		result.filesModified = [...new Set(result.filesModified)];
		result.filesCreated = [...new Set(result.filesCreated)];
		result.stats = computeStats(this.codingAgent);
		result.phaseTimings = [...this.phaseTimings];
		result.errors = [...this.errors];
		recordSession(result, this.config).catch((e) => {
			log.debug("session recording failed", { error: String(e) });
		});
		return result;
	}
}
