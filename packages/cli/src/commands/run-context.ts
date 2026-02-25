/**
 * @chitragupta/cli -- Context builder for the `chitragupta run` command.
 *
 * Gathers project context (git info, instructions, memory, session history)
 * and assembles it into a structured context string for the LLM.
 *
 * Extracted from run.ts to stay within the 450 LOC limit.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { searchSessions, searchMemory } from "@chitragupta/smriti/search";

// ─── Git Context ─────────────────────────────────────────────────────────────

/** Lightweight git metadata for context injection. */
export interface GitContext {
	branch: string;
	recentCommits: string[];
	hasUncommitted: boolean;
}

/**
 * Gather git context from the project directory.
 * Returns undefined if the directory is not a git repository.
 *
 * @param projectPath - Absolute path to the project directory.
 * @returns Git metadata or undefined if not a git repo.
 */
export function getGitContext(projectPath: string): GitContext | undefined {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: projectPath, encoding: "utf-8", timeout: 5000,
		}).trim();

		const logRaw = execSync(
			'git log --oneline -5 --no-decorate 2>/dev/null || true',
			{ cwd: projectPath, encoding: "utf-8", timeout: 5000 },
		).trim();
		const recentCommits = logRaw ? logRaw.split("\n") : [];

		const status = execSync("git status --porcelain 2>/dev/null || true", {
			cwd: projectPath, encoding: "utf-8", timeout: 5000,
		}).trim();
		const hasUncommitted = status.length > 0;

		return { branch, recentCommits, hasUncommitted };
	} catch {
		return undefined;
	}
}

// ─── Project Instructions ────────────────────────────────────────────────────

/**
 * Load CLAUDE.md or CHITRAGUPTA.md from the project root if either exists.
 *
 * @param projectPath - Absolute path to the project directory.
 * @returns File contents or undefined if not found.
 */
export function loadProjectInstructions(
	projectPath: string,
): string | undefined {
	for (const name of ["CLAUDE.md", "CHITRAGUPTA.md"]) {
		const filePath = path.join(projectPath, name);
		try {
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, "utf-8").trim();
				if (content.length > 0) return content;
			}
		} catch {
			// Not readable, skip
		}
	}
	return undefined;
}

// ─── Memory & Session Loader ─────────────────────────────────────────────────

/**
 * Load relevant memory snippets for the given task.
 * Returns up to 3 snippets, each truncated to 500 chars.
 *
 * @param task - The task description to search for.
 * @returns Array of memory content snippets.
 */
export function loadMemorySnippets(task: string): string[] {
	const snippets: string[] = [];
	try {
		const memResults = searchMemory(task);
		for (const mr of memResults.slice(0, 3)) {
			if (mr.content.length > 0) {
				snippets.push(mr.content.slice(0, 500));
			}
		}
	} catch {
		// Memory search is best-effort
	}
	return snippets;
}

/**
 * Load related session summaries for the given task.
 * Returns up to 3 formatted session lines.
 *
 * @param task - The task description to search for.
 * @param projectPath - Project path to scope session search.
 * @returns Array of formatted session summary strings.
 */
export function loadSessionHistory(
	task: string,
	projectPath: string,
): string[] {
	const history: string[] = [];
	try {
		const related = searchSessions(task, projectPath);
		for (const s of related.slice(0, 3)) {
			history.push(
				`- ${s.title} (${s.id}) — ${s.model}, ${s.updated}`,
			);
		}
	} catch {
		// Session search is best-effort
	}
	return history;
}

// ─── Context Builder ─────────────────────────────────────────────────────────

/**
 * Build the full context string sent to the LLM alongside the task.
 * Combines project info, git state, memory, and instructions.
 *
 * @param projectPath - Absolute path to the project.
 * @param memorySnippets - Relevant memory content.
 * @param sessionHistory - Related session summaries.
 * @returns Assembled context string with markdown sections.
 */
export function buildRunContext(
	projectPath: string,
	memorySnippets: string[],
	sessionHistory: string[],
): string {
	const parts: string[] = [];

	// Project info
	parts.push(`## Project\nPath: ${projectPath}`);

	// Git context
	const git = getGitContext(projectPath);
	if (git) {
		parts.push(
			`## Git\nBranch: ${git.branch}` +
			(git.hasUncommitted ? " (uncommitted changes)" : "") +
			(git.recentCommits.length > 0
				? `\nRecent commits:\n${git.recentCommits.map((c) => `  ${c}`).join("\n")}`
				: ""),
		);
	}

	// Project instructions
	const instructions = loadProjectInstructions(projectPath);
	if (instructions) {
		parts.push(`## Project Instructions\n${instructions}`);
	}

	// Memory context
	if (memorySnippets.length > 0) {
		parts.push(`## Relevant Memory\n${memorySnippets.join("\n---\n")}`);
	}

	// Session history
	if (sessionHistory.length > 0) {
		parts.push(`## Related Sessions\n${sessionHistory.join("\n")}`);
	}

	return parts.join("\n\n");
}
