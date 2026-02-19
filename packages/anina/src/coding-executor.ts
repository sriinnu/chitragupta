/**
 * @chitragupta/anina — CodingOrchestrator execution phase.
 *
 * Handles git branch creation, task execution, validation with debug retry,
 * and git checkpoint/rollback operations.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { createLogger } from "@chitragupta/core";

import type { CodingAgent } from "./coding-agent.js";
import type { CodingResult } from "./coding-agent.js";
import type { DebugAgent } from "./debug-agent.js";
import { safeExecSync } from "./safe-exec.js";
import { enrichTaskWithPlan } from "./coding-planner.js";
import type {
	CodingOrchestratorConfig,
	DiffStats,
	GitState,
	OrchestratorProgress,
	OrchestratorStats,
	ResolvedOrchestratorConfig,
	TaskPlan,
	STASH_PREFIX as StashPrefixType,
} from "./coding-orchestrator-types.js";
import { STASH_PREFIX } from "./coding-orchestrator-types.js";

const log = createLogger("anina:orchestrator:executor");

// ─── Git Utilities ───────────────────────────────────────────────────────────

/** Check whether the working directory has a .git directory. */
export function detectGitRepo(workingDirectory: string): boolean {
	return existsSync(join(workingDirectory, ".git"));
}

/** Execute a git command synchronously in the working directory. */
export function gitExec(command: string, workingDirectory: string): string {
	return safeExecSync(command, {
		cwd: workingDirectory,
		encoding: "utf-8",
		timeout: 30_000,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

/** Create a git stash checkpoint for rollback safety. */
export function checkpoint(label: string, gitState: GitState, workingDirectory: string): void {
	if (!gitState.isGitRepo) return;

	try {
		const status = gitExec("git status --porcelain", workingDirectory).trim();
		if (!status) return;

		gitExec(`git stash push -m "${STASH_PREFIX}: ${label}"`, workingDirectory);
		gitState.stashRef = label;

		try {
			gitExec("git stash pop", workingDirectory);
		} catch {
			try {
				gitExec("git stash apply", workingDirectory);
			} catch {
				log.debug("stash pop/apply failed — stash preserved for manual recovery", { label });
			}
		}
	} catch {
		// Non-fatal — checkpoint is best-effort
	}
}

/** Rollback git state: reset, switch to original branch, delete feature branch. */
export function rollback(gitState: GitState, workingDirectory: string): void {
	if (!gitState.isGitRepo) return;

	try {
		if (gitState.featureBranch) {
			try {
				gitExec("git reset --hard HEAD", workingDirectory);
			} catch { /* ignore */ }
		}

		if (gitState.originalBranch) {
			try {
				gitExec(`git checkout ${gitState.originalBranch}`, workingDirectory);
				log.debug("rolled back to original branch", { branch: gitState.originalBranch });
			} catch (err) {
				log.debug("failed to checkout original branch", { error: String(err) });
				return;
			}

			if (gitState.featureBranch) {
				try {
					gitExec(`git branch -D ${gitState.featureBranch}`, workingDirectory);
					log.debug("deleted feature branch", { branch: gitState.featureBranch });
					gitState.featureBranch = null;
				} catch {
					log.debug("failed to delete feature branch (manual cleanup needed)");
				}
			}
		}
	} catch (err) {
		log.debug("rollback failed", { error: String(err) });
	}
}

/** Clean up orchestrator stash entries after successful commit. */
export function cleanupStash(workingDirectory: string): void {
	try {
		const stashList = gitExec("git stash list", workingDirectory).trim();
		if (!stashList) return;

		const lines = stashList.split("\n");
		const toRemove: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(STASH_PREFIX)) {
				toRemove.push(i);
			}
		}

		for (const idx of toRemove.reverse()) {
			try {
				gitExec(`git stash drop stash@{${idx}}`, workingDirectory);
			} catch { /* ignore individual drop failures */ }
		}

		if (toRemove.length > 0) {
			log.debug("cleaned up stash entries", { count: toRemove.length });
		}
	} catch {
		// Non-fatal
	}
}

// ─── Branch Management ───────────────────────────────────────────────────────

/** Generate a git branch name from the task description. */
export function generateBranchName(task: string, branchPrefix: string): string {
	const lower = task.toLowerCase();
	let scope = branchPrefix;
	if (/\b(fix|bug|error|crash|broken|issue)\b/.test(lower)) scope = "fix/";
	else if (/\b(refactor|cleanup|clean up|reorganize)\b/.test(lower)) scope = "refactor/";
	else if (/\b(docs?|documentation|readme)\b/.test(lower)) scope = "docs/";
	else if (/\b(test|spec|coverage)\b/.test(lower)) scope = "test/";
	else if (/\b(chore|config|setup|update dep)\b/.test(lower)) scope = "chore/";

	const issueMatch = task.match(/#(\d+)|([A-Z]+-\d+)/);
	const issueSlug = issueMatch ? `${issueMatch[0].replace("#", "")}-` : "";

	const slug = task
		.toLowerCase()
		.replace(/#\d+|[A-Z]+-\d+/g, "")
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.slice(0, 40)
		.replace(/^-|-$/g, "");

	return `${scope}${issueSlug}${slug || "task"}`;
}

/** Create a git feature branch for the coding task. */
export async function createFeatureBranch(
	task: string,
	config: ResolvedOrchestratorConfig,
	gitState: GitState,
	emitProgress: (phase: OrchestratorProgress["phase"], message: string) => void,
	requestApproval: (action: string, detail: string) => Promise<boolean>,
	errors: Array<{ phase: string; message: string; recoverable: boolean }>,
): Promise<void> {
	if (!gitState.isGitRepo) return;

	try {
		gitState.originalBranch = gitExec("git rev-parse --abbrev-ref HEAD", config.workingDirectory).trim();

		const dirtyCheck = gitExec("git status --porcelain", config.workingDirectory).trim();
		if (dirtyCheck) {
			emitProgress("branching", `Warning: working tree has ${dirtyCheck.split("\n").length} uncommitted change(s)`);
			errors.push({ phase: "branching", message: "Working tree has uncommitted changes", recoverable: true });
		}

		const branchName = generateBranchName(task, config.branchPrefix);

		try {
			gitExec(`git rev-parse --verify ${branchName}`, config.workingDirectory);
			const ts = Date.now().toString(36);
			const uniqueName = `${branchName}-${ts}`;
			gitExec(`git checkout -b ${uniqueName}`, config.workingDirectory);
			gitState.featureBranch = uniqueName;
		} catch {
			gitExec(`git checkout -b ${branchName}`, config.workingDirectory);
			gitState.featureBranch = branchName;
		}

		log.debug("created feature branch", { branch: gitState.featureBranch });
	} catch (err) {
		log.debug("failed to create feature branch", { error: String(err) });
		errors.push({ phase: "branching", message: String(err instanceof Error ? err.message : err), recoverable: true });
	}
}

// ─── Task Execution ──────────────────────────────────────────────────────────

/** Execute the coding task using the CodingAgent with plan context. */
export async function executeTask(
	task: string,
	plan: TaskPlan,
	codingAgent: CodingAgent,
	gitState: GitState,
	workingDirectory: string,
): Promise<CodingResult> {
	const enrichedTask = enrichTaskWithPlan(task, plan);
	checkpoint("pre-execution", gitState, workingDirectory);
	const result = await codingAgent.execute(enrichedTask);

	for (const step of plan.steps) {
		step.completed = true;
	}

	return result;
}

// ─── Validation with Debug Retry ─────────────────────────────────────────────

/** Stream validation output to the onStream callback. */
export function streamValidationOutput(output: string, onStream?: CodingOrchestratorConfig["onStream"]): void {
	if (!onStream || !output) return;

	const sections = output.split("\n---\n");
	for (const section of sections) {
		const match = section.match(/^\[(\w+)\]/);
		const source = match?.[1]?.toLowerCase() as "build" | "test" | "lint" | undefined;
		onStream(section, source ?? "build");
	}
}

/**
 * Run validation and retry with DebugAgent on failure.
 * Returns whether validation passed and any extra coding results from debug fixes.
 */
export async function validateWithRetry(
	initialResult: CodingResult,
	config: ResolvedOrchestratorConfig,
	getCodingAgent: () => CodingAgent,
	createDebugAgent: () => DebugAgent,
	emitProgress: (phase: OrchestratorProgress["phase"], message: string) => void,
	errors: Array<{ phase: string; message: string; recoverable: boolean }>,
): Promise<{ passed: boolean; extraResults: CodingResult[] }> {
	const agent = getCodingAgent();
	const extraResults: CodingResult[] = [];

	if (initialResult.validationPassed) {
		return { passed: true, extraResults };
	}

	const validation = await agent.validate();
	streamValidationOutput(validation.output, config.onStream);
	if (validation.passed) {
		return { passed: true, extraResults };
	}

	let debugCycles = 0;
	let lastValidation = validation;
	const debugCycleTimeoutMs = 120_000;

	while (!lastValidation.passed && debugCycles < config.maxDebugCycles) {
		debugCycles++;
		emitProgress("validating", `Validation failed, debug investigation ${debugCycles}/${config.maxDebugCycles}...`);

		try {
			const debugAgent = createDebugAgent();
			const debugResult = await Promise.race([
				debugAgent.quickFix({
					error: lastValidation.output.slice(0, 2000),
					reproduction: `Validation command failed in ${config.workingDirectory}`,
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error(`Debug cycle ${debugCycles} timed out after ${debugCycleTimeoutMs}ms`)), debugCycleTimeoutMs),
				),
			]);

			log.debug("debug agent result", {
				rootCause: debugResult.rootCause.slice(0, 100),
				fixApplied: debugResult.fixApplied,
				confidence: debugResult.confidence,
			});

			if (debugResult.fixApplied) {
				extraResults.push({
					success: true,
					filesModified: debugResult.filesInvestigated,
					filesCreated: [],
					validationPassed: debugResult.validationPassed ?? false,
					validationOutput: debugResult.rootCause,
					summary: debugResult.proposedFix,
					validationRetries: 0,
				});
			}
		} catch (debugErr) {
			log.debug("debug agent failed, falling back to coding agent", { error: String(debugErr) });

			const fixPrompt = [
				`Validation failed (attempt ${debugCycles}/${config.maxDebugCycles}). Fix these errors:`,
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
		}

		lastValidation = await agent.validate();
		streamValidationOutput(lastValidation.output, config.onStream);

		if (lastValidation.passed) break;

		errors.push({
			phase: "validating",
			message: `Debug cycle ${debugCycles}: ${lastValidation.output.slice(0, 200)}`,
			recoverable: debugCycles < config.maxDebugCycles,
		});
	}

	return { passed: lastValidation.passed, extraResults };
}

// ─── Stats & Diff ────────────────────────────────────────────────────────────

/** Parse unified diff to extract file change statistics. */
export function parseDiffStats(diff: string): DiffStats {
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

/** Aggregate cost and tool usage from the coding agent's message history. */
export function computeStats(codingAgent: CodingAgent | null): OrchestratorStats {
	const stats: OrchestratorStats = {
		totalCost: 0, currency: "USD",
		inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
		toolCalls: {}, totalToolCalls: 0, turns: 0,
	};

	if (!codingAgent) return stats;

	const messages = codingAgent.getAgent().getMessages();
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
