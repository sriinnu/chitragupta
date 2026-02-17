/**
 * @chitragupta/dharma — Scope restriction rules.
 * Keep agents within their boundaries.
 */

import path from "path";
import type { PolicyRule, PolicyAction, PolicyContext, PolicyVerdict } from "../types.js";

// ─── Lock File Patterns ─────────────────────────────────────────────────────

const LOCK_FILES = new Set([
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lockb",
	"Gemfile.lock",
	"Cargo.lock",
	"poetry.lock",
	"composer.lock",
	"go.sum",
]);

// ─── Dangerous Git Commands ─────────────────────────────────────────────────

const DANGEROUS_GIT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "git rebase", pattern: /git\s+rebase\b/ },
	{ name: "git reset --hard", pattern: /git\s+reset\s+--hard\b/ },
	{ name: "git push --force", pattern: /git\s+push\s+(?:.*\s+)?--force\b/ },
	{ name: "git push -f", pattern: /git\s+push\s+(?:.*\s+)?-f\b/ },
	{ name: "git clean -f", pattern: /git\s+clean\s+(?:.*\s+)?-f\b/ },
	{ name: "git checkout -- .", pattern: /git\s+checkout\s+--\s+\./ },
	{ name: "git restore --staged .", pattern: /git\s+restore\s+--staged\s+\./ },
];

// ─── Rule Implementations ───────────────────────────────────────────────────

/** Denies file operations outside the project root directory. */
export const projectBoundary: PolicyRule = {
	id: "scope.project-boundary",
	name: "Project Boundary",
	description: "Denies file operations outside the project root directory",
	severity: "error",
	category: "scope",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		const fileActionTypes = new Set(["file_read", "file_write", "file_delete"]);
		if (!fileActionTypes.has(action.type) || !action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "Not a file operation" };
		}

		const resolvedPath = path.resolve(action.filePath);
		const projectPath = path.resolve(context.projectPath);

		if (!resolvedPath.startsWith(projectPath + path.sep) && resolvedPath !== projectPath) {
			return {
				status: "deny",
				ruleId: this.id,
				reason: `File "${resolvedPath}" is outside the project root "${projectPath}"`,
				suggestion: "Only modify files within the current project directory",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "File is within project boundary" };
	},
};

/** Warns on modifying package lock files. */
export const noModifyLockFiles: PolicyRule = {
	id: "scope.no-modify-lock-files",
	name: "No Modify Lock Files",
	description: "Warns when modifying dependency lock files (package-lock.json, yarn.lock, etc.)",
	severity: "warning",
	category: "scope",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" && action.type !== "file_delete") {
			return { status: "allow", ruleId: this.id, reason: "Not a file modification" };
		}

		if (!action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "No file path specified" };
		}

		const basename = path.basename(action.filePath);

		if (LOCK_FILES.has(basename)) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `Modifying lock file "${basename}" — this should typically be done by the package manager`,
				suggestion: "Use the appropriate package manager command (npm install, yarn, etc.) instead of editing directly",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Not a lock file" };
	},
};

/** Denies dangerous git history-altering commands. */
export const noModifyGitHistory: PolicyRule = {
	id: "scope.no-modify-git-history",
	name: "No Modify Git History",
	description: "Denies git rebase, git reset --hard, git push --force, and other history-altering commands",
	severity: "error",
	category: "scope",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "shell_exec" || !action.command) {
			return { status: "allow", ruleId: this.id, reason: "Not a shell command" };
		}

		for (const { name, pattern } of DANGEROUS_GIT_PATTERNS) {
			if (pattern.test(action.command)) {
				return {
					status: "deny",
					ruleId: this.id,
					reason: `Blocked destructive git command: ${name}`,
					suggestion: "Use non-destructive git operations instead (git stash, git branch, git revert)",
				};
			}
		}

		return { status: "allow", ruleId: this.id, reason: "Not a dangerous git command" };
	},
};

/** Denies after the agent has modified more than N files in a session. */
export const maxModifiedFiles: PolicyRule = {
	id: "scope.max-modified-files",
	name: "Max Modified Files",
	description: "Denies after the agent has modified too many files in a single session",
	severity: "error",
	category: "scope",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" && action.type !== "file_delete") {
			return { status: "allow", ruleId: this.id, reason: "Not a file modification" };
		}

		// Default limit: 50 files. The engine config's maxFilesPerSession can override this.
		const limit = 50;
		const currentCount = context.filesModified.length;

		if (currentCount >= limit) {
			return {
				status: "deny",
				ruleId: this.id,
				reason: `File modification limit reached: ${currentCount}/${limit} files already modified in this session`,
				suggestion: "Start a new session or increase the maxFilesPerSession limit in your policy config",
			};
		}

		// Warn at 80%
		if (currentCount >= limit * 0.8) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `Approaching file modification limit: ${currentCount}/${limit} files modified`,
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Within file modification limit" };
	},
};

/** Enforces read-only access for configured paths. */
export const readOnlyPaths: PolicyRule = {
	id: "scope.read-only-paths",
	name: "Read-Only Paths",
	description: "Enforces read-only access for specific paths (e.g., node_modules, .git)",
	severity: "error",
	category: "scope",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		if (action.type !== "file_write" && action.type !== "file_delete") {
			return { status: "allow", ruleId: this.id, reason: "Not a write/delete operation" };
		}

		if (!action.filePath) {
			return { status: "allow", ruleId: this.id, reason: "No file path specified" };
		}

		const resolvedPath = path.resolve(action.filePath);
		const projectPath = path.resolve(context.projectPath);

		// Default read-only paths within the project
		const readOnlyDirs = [
			path.join(projectPath, "node_modules"),
			path.join(projectPath, ".git"),
			path.join(projectPath, "dist"),
			path.join(projectPath, "build"),
		];

		for (const roDir of readOnlyDirs) {
			if (resolvedPath.startsWith(roDir + path.sep) || resolvedPath === roDir) {
				return {
					status: "deny",
					ruleId: this.id,
					reason: `Path "${resolvedPath}" is read-only (within ${path.basename(roDir)}/)`,
					suggestion: `Do not directly modify files in ${path.basename(roDir)}/. Use build tools or package managers instead.`,
				};
			}
		}

		return { status: "allow", ruleId: this.id, reason: "Path is not read-only" };
	},
};

/** All built-in scope rules. */
export const SCOPE_RULES: PolicyRule[] = [
	projectBoundary,
	noModifyLockFiles,
	noModifyGitHistory,
	maxModifiedFiles,
	readOnlyPaths,
];
