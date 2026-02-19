/**
 * @chitragupta/anina — CodingOrchestrator review and commit phase.
 *
 * Self-review using ReviewAgent (Parikshaka), inline review fallback,
 * commit message generation, and session recording.
 */

import { basename } from "node:path";
import { join } from "node:path";

import { createLogger } from "@chitragupta/core";

import { Agent } from "./agent.js";
import type { CodingAgent, CodingResult } from "./coding-agent.js";
import type { ReviewAgent } from "./review-agent.js";
import { gitExec, cleanupStash } from "./coding-executor.js";
import type {
	CodingOrchestratorConfig,
	GitState,
	OrchestratorResult,
	OrchestratorStats,
	ReviewIssueCompact,
	ResolvedOrchestratorConfig,
} from "./coding-orchestrator-types.js";

const log = createLogger("anina:orchestrator:reviewer");

// ─── Self-Review ─────────────────────────────────────────────────────────────

/** Parse ISSUE lines from a review response into structured issues. */
export function parseReviewIssues(text: string): ReviewIssueCompact[] {
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

/**
 * Run self-review on the current changes.
 * Uses ReviewAgent (Parikshaka) with inline fallback.
 */
export async function selfReview(
	gitState: GitState,
	workingDirectory: string,
	createReviewAgent: () => ReviewAgent,
	getCodingAgent: () => CodingAgent,
): Promise<{ issues: ReviewIssueCompact[]; hasCritical: boolean; fixPrompt: string | null }> {
	if (!gitState.isGitRepo) {
		return { issues: [], hasCritical: false, fixPrompt: null };
	}

	try {
		const reviewer = createReviewAgent();
		const reviewResult = await reviewer.reviewDiff("HEAD");

		const issues: ReviewIssueCompact[] = reviewResult.issues.map((i) => ({
			severity: i.severity.toUpperCase(),
			file: i.file,
			line: i.line,
			message: i.suggestion ? `${i.message} — ${i.suggestion}` : i.message,
		}));

		const hasCritical = issues.some((i) => i.severity === "CRITICAL" || i.severity === "ERROR");

		let fixPrompt: string | null = null;
		if (hasCritical) {
			const criticalIssues = issues
				.filter((i) => i.severity === "CRITICAL" || i.severity === "ERROR")
				.map((i) => `- ${i.severity}: ${i.file}${i.line ? `:${i.line}` : ""} ${i.message}`)
				.join("\n");

			fixPrompt = [
				"Code review found critical issues that must be fixed:",
				"",
				criticalIssues,
				"",
				"Fix these issues now.",
			].join("\n");
		}

		return { issues, hasCritical, fixPrompt };
	} catch (err) {
		log.debug("self-review failed, falling back to inline review", { error: String(err) });
		return inlineSelfReview(workingDirectory, gitState, getCodingAgent);
	}
}

/** Fallback inline self-review (used when ReviewAgent is unavailable). */
async function inlineSelfReview(
	workingDirectory: string,
	gitState: GitState,
	getCodingAgent: () => CodingAgent,
): Promise<{ issues: ReviewIssueCompact[]; hasCritical: boolean; fixPrompt: string | null }> {
	try {
		const diff = gitExec("git diff HEAD", workingDirectory).trim();
		if (!diff) return { issues: [], hasCritical: false, fixPrompt: null };

		const agent = getCodingAgent();
		const reviewPrompt = [
			"Review the following changes you just made. Look for:",
			"- Bugs: null checks, off-by-one, race conditions, unhandled errors",
			"- Security: injection, XSS, secrets in code, unsafe permissions",
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

		const issues = parseReviewIssues(text);
		const hasCritical = issues.some((i) => i.severity === "CRITICAL" || i.severity === "ERROR");
		let fixPrompt: string | null = null;
		if (hasCritical) {
			fixPrompt = "Self-review found critical issues that must be fixed:\n\n" +
				issues
					.filter((i) => i.severity === "CRITICAL" || i.severity === "ERROR")
					.map((i) => `- ${i.severity}: ${i.file}${i.line ? `:${i.line}` : ""} ${i.message}`)
					.join("\n") + "\n\nFix these issues now.";
		}
		return { issues, hasCritical, fixPrompt };
	} catch {
		return { issues: [], hasCritical: false, fixPrompt: null };
	}
}

/** Execute a fix using the coding agent. */
export async function executeFix(
	fixPrompt: string,
	getCodingAgent: () => CodingAgent,
): Promise<CodingResult | null> {
	try {
		const agent = getCodingAgent();
		return await agent.execute(fixPrompt);
	} catch (err) {
		log.debug("fix execution failed", { error: String(err) });
		return null;
	}
}

// ─── Commit ──────────────────────────────────────────────────────────────────

/**
 * Commit all staged changes with a generated commit message.
 * Uses LLM commit message generation with heuristic fallback.
 */
export async function commitChanges(
	task: string,
	result: OrchestratorResult,
	config: ResolvedOrchestratorConfig,
	gitState: GitState,
	emitProgress: (phase: "committing", message: string) => void,
	errors: Array<{ phase: string; message: string; recoverable: boolean }>,
): Promise<void> {
	if (!gitState.isGitRepo) return;

	try {
		const status = gitExec("git status --porcelain", config.workingDirectory).trim();
		if (!status) return;

		gitExec("git add -A", config.workingDirectory);
		const commitMsg = await generateCommitMessage(task, result, config);

		const { writeFileSync, unlinkSync } = await import("node:fs");
		const msgFile = join(config.workingDirectory, ".git", "CHITRAGUPTA_COMMIT_MSG");
		try {
			writeFileSync(msgFile, commitMsg, "utf-8");
			gitExec(`git commit --file="${msgFile}"`, config.workingDirectory);
		} finally {
			try { unlinkSync(msgFile); } catch { /* ignore */ }
		}

		const commitHash = gitExec("git rev-parse --short HEAD", config.workingDirectory).trim();
		if (commitHash) {
			gitState.commits.push(commitHash);
			log.debug("committed changes", { hash: commitHash });
			cleanupStash(config.workingDirectory);
		}
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		if (errMsg.includes("hook")) {
			log.debug("commit blocked by git hook", { error: errMsg });
			emitProgress("committing", `Commit blocked by git hook: ${errMsg.slice(0, 100)}`);
			errors.push({ phase: "committing", message: `Git hook blocked commit: ${errMsg.slice(0, 100)}`, recoverable: true });
		} else {
			log.debug("commit failed", { error: errMsg });
			errors.push({ phase: "committing", message: errMsg, recoverable: true });
		}
	}
}

/** Generate a commit message using LLM with heuristic fallback. */
async function generateCommitMessage(
	task: string,
	result: OrchestratorResult,
	config: ResolvedOrchestratorConfig,
): Promise<string> {
	if (config.provider && result.diffPreview) {
		try {
			const msg = await llmCommitMessage(task, result, config);
			if (msg) return msg;
		} catch {
			// Fall back to heuristic
		}
	}
	return heuristicCommitMessage(task, result);
}

/** Generate a commit message using an LLM agent. */
async function llmCommitMessage(
	task: string,
	result: OrchestratorResult,
	config: ResolvedOrchestratorConfig,
): Promise<string | null> {
	const { KARTRU_PROFILE } = await import("@chitragupta/core");

	const commitAgent = new Agent({
		profile: { ...KARTRU_PROFILE, id: "sanyojaka-committer", name: "Sanyojaka Committer" },
		providerId: config.providerId,
		model: config.modelId ?? "claude-sonnet-4-5-20250929",
		tools: [],
		thinkingLevel: "low",
		workingDirectory: config.workingDirectory,
		maxTurns: 1,
		enableChetana: false,
		enableLearning: false,
		enableAutonomy: false,
		policyEngine: config.policyEngine,
		commHub: config.commHub,
		actorSystem: config.actorSystem,
		samiti: config.samiti,
		lokapala: config.lokapala,
		kaala: config.kaala,
	});
	commitAgent.setProvider(config.provider as import("@chitragupta/swara").ProviderDefinition);

	const diff = (result.diffPreview ?? "").slice(0, 4000);
	const prompt = `Generate a git commit message for these changes.

Task: ${task}
Files modified: ${result.filesModified.map((f) => basename(f)).join(", ")}
Files created: ${result.filesCreated.map((f) => basename(f)).join(", ")}

Diff (truncated):
\`\`\`
${diff}
\`\`\`

Rules:
1. First line: type(scope): description (max 72 chars). Type: feat, fix, refactor, docs, test, chore
2. Blank line, then body (2-4 sentences explaining WHY, not what)
3. If a GitHub issue ID is in the task (e.g. #123 or PROJ-123), add "Closes #123" at end
4. End with: Generated by Sanyojaka (CodingOrchestrator)
5. Return ONLY the commit message, no markdown fences or explanation`;

	const response = await commitAgent.prompt(prompt);
	const text = response.content
		.filter((p) => p.type === "text")
		.map((p) => (p as { type: "text"; text: string }).text)
		.join("");

	return text.trim() || null;
}

/** Generate a heuristic commit message without LLM. */
function heuristicCommitMessage(task: string, result: OrchestratorResult): string {
	const filesCount = result.filesModified.length + result.filesCreated.length;

	const lower = task.toLowerCase();
	let prefix = "feat";
	if (/\b(fix|bug|error|crash|broken)\b/.test(lower)) prefix = "fix";
	else if (/\b(refactor|cleanup|reorganize)\b/.test(lower)) prefix = "refactor";
	else if (/\b(docs?|documentation|readme)\b/.test(lower)) prefix = "docs";
	else if (/\b(test|spec|coverage)\b/.test(lower)) prefix = "test";
	else if (/\b(chore|config|setup)\b/.test(lower)) prefix = "chore";
	else if (result.filesCreated.length > 0) prefix = "feat";

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

	const issueMatch = task.match(/#(\d+)|([A-Z]+-\d+)/);
	if (issueMatch) {
		lines.push("");
		lines.push(`Closes ${issueMatch[0]}`);
	}

	if (result.validationPassed) {
		lines.push("");
		lines.push("Validation: passed (build + test + lint)");
	}

	lines.push("");
	lines.push("Generated by Sanyojaka (CodingOrchestrator)");

	return lines.join("\n");
}

// ─── Summary & Session Recording ─────────────────────────────────────────────

/** Build a human-readable summary of the orchestration result. */
export function buildSummary(result: OrchestratorResult): string {
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

/** Record the orchestration result to @chitragupta/smriti (if sessionId set). */
export async function recordSession(result: OrchestratorResult, config: ResolvedOrchestratorConfig): Promise<void> {
	if (!config.sessionId) return;

	try {
		const { createSession, addTurn } = await import("@chitragupta/smriti");
		const project = config.workingDirectory;

		const session = createSession({
			title: `Coding: ${result.plan?.task ?? "unknown task"}`,
			project,
			agent: "sanyojaka",
			model: config.modelId ?? "unknown",
		});

		const sessionId = session.meta.id;

		await addTurn(sessionId, project, {
			turnNumber: 1,
			role: "user",
			content: `Task: ${result.plan?.task ?? "unknown"}\nMode: ${config.mode}\nComplexity: ${result.plan?.complexity ?? "unknown"}`,
		});

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
