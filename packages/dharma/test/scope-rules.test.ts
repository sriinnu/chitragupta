import { describe, it, expect } from "vitest";
import type { PolicyAction, PolicyContext } from "@chitragupta/dharma";
import {
	projectBoundary,
	noModifyLockFiles,
	noModifyGitHistory,
	maxModifiedFiles,
	readOnlyPaths,
	SCOPE_RULES,
} from "@chitragupta/dharma";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<PolicyAction> = {}): PolicyAction {
	return {
		type: "file_write",
		filePath: "/project/src/utils.ts",
		content: "export const x = 1;\n",
		...overrides,
	};
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
	return {
		sessionId: "sess-scope-001",
		agentId: "agent-001",
		agentDepth: 0,
		projectPath: "/project",
		totalCostSoFar: 0,
		costBudget: 10,
		filesModified: [],
		commandsRun: [],
		timestamp: Date.now(),
		...overrides,
	};
}

// ─── projectBoundary ────────────────────────────────────────────────────────

describe("projectBoundary", () => {
	it("denies file_read outside projectPath", async () => {
		const verdict = await projectBoundary.evaluate(
			makeAction({ type: "file_read", filePath: "/etc/passwd" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies file_write outside projectPath", async () => {
		const verdict = await projectBoundary.evaluate(
			makeAction({ type: "file_write", filePath: "/tmp/evil.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies file_delete outside projectPath", async () => {
		const verdict = await projectBoundary.evaluate(
			makeAction({ type: "file_delete", filePath: "/home/user/secrets.txt" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("allows file operations inside projectPath", async () => {
		const verdict = await projectBoundary.evaluate(
			makeAction({ type: "file_write", filePath: "/project/src/index.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows file operations at projectPath root", async () => {
		const verdict = await projectBoundary.evaluate(
			makeAction({ type: "file_read", filePath: "/project" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-file actions", async () => {
		const verdict = await projectBoundary.evaluate(
			makeAction({ type: "shell_exec", command: "ls /etc" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows llm_call actions", async () => {
		const verdict = await projectBoundary.evaluate(
			makeAction({ type: "llm_call" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(projectBoundary.id).toBe("scope.project-boundary");
		expect(projectBoundary.category).toBe("scope");
		expect(projectBoundary.severity).toBe("error");
	});
});

// ─── noModifyLockFiles ──────────────────────────────────────────────────────

describe("noModifyLockFiles", () => {
	it("warns on file_write to package-lock.json", async () => {
		const verdict = await noModifyLockFiles.evaluate(
			makeAction({ filePath: "/project/package-lock.json" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("package-lock.json");
	});

	it("warns on file_write to yarn.lock", async () => {
		const verdict = await noModifyLockFiles.evaluate(
			makeAction({ filePath: "/project/yarn.lock" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("warns on file_write to pnpm-lock.yaml", async () => {
		const verdict = await noModifyLockFiles.evaluate(
			makeAction({ filePath: "/project/pnpm-lock.yaml" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("warns on file_delete of lock file", async () => {
		const verdict = await noModifyLockFiles.evaluate(
			makeAction({ type: "file_delete", filePath: "/project/bun.lockb" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("allows file_write to non-lock files", async () => {
		const verdict = await noModifyLockFiles.evaluate(
			makeAction({ filePath: "/project/src/index.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-write actions on lock files", async () => {
		const verdict = await noModifyLockFiles.evaluate(
			makeAction({ type: "file_read", filePath: "/project/package-lock.json" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(noModifyLockFiles.id).toBe("scope.no-modify-lock-files");
	});
});

// ─── noModifyGitHistory ─────────────────────────────────────────────────────

describe("noModifyGitHistory", () => {
	it("denies git rebase", async () => {
		const verdict = await noModifyGitHistory.evaluate(
			makeAction({ type: "shell_exec", command: "git rebase main" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
		expect(verdict.reason).toContain("git rebase");
	});

	it("denies git reset --hard", async () => {
		const verdict = await noModifyGitHistory.evaluate(
			makeAction({ type: "shell_exec", command: "git reset --hard HEAD~1" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies git push --force", async () => {
		const verdict = await noModifyGitHistory.evaluate(
			makeAction({ type: "shell_exec", command: "git push origin main --force" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies git push -f", async () => {
		const verdict = await noModifyGitHistory.evaluate(
			makeAction({ type: "shell_exec", command: "git push -f origin main" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies git clean -f", async () => {
		const verdict = await noModifyGitHistory.evaluate(
			makeAction({ type: "shell_exec", command: "git clean -f ." }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("allows normal git commands", async () => {
		const allowedCommands = [
			"git status",
			"git log --oneline",
			"git add .",
			"git commit -m 'fix: something'",
			"git push origin main",
			"git pull",
			"git stash",
			"git branch feature/new",
			"git diff HEAD",
		];

		for (const command of allowedCommands) {
			const verdict = await noModifyGitHistory.evaluate(
				makeAction({ type: "shell_exec", command }),
				makeContext(),
			);
			expect(verdict).toMatchObject({ status: "allow" });
		}
	});

	it("allows non-shell_exec actions", async () => {
		const verdict = await noModifyGitHistory.evaluate(
			makeAction({ type: "file_write" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(noModifyGitHistory.id).toBe("scope.no-modify-git-history");
		expect(noModifyGitHistory.severity).toBe("error");
	});
});

// ─── maxModifiedFiles ───────────────────────────────────────────────────────

describe("maxModifiedFiles", () => {
	it("denies file_write when >= 50 files already modified", async () => {
		const files = Array.from({ length: 50 }, (_, i) => `/project/src/file${i}.ts`);
		const verdict = await maxModifiedFiles.evaluate(
			makeAction(),
			makeContext({ filesModified: files }),
		);
		expect(verdict).toMatchObject({ status: "deny" });
		expect(verdict.reason).toContain("50/50");
	});

	it("warns at 80% (>= 40 files)", async () => {
		const files = Array.from({ length: 40 }, (_, i) => `/project/src/file${i}.ts`);
		const verdict = await maxModifiedFiles.evaluate(
			makeAction(),
			makeContext({ filesModified: files }),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("40/50");
	});

	it("allows when under 80% threshold", async () => {
		const files = Array.from({ length: 10 }, (_, i) => `/project/src/file${i}.ts`);
		const verdict = await maxModifiedFiles.evaluate(
			makeAction(),
			makeContext({ filesModified: files }),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-file_write/delete actions even at limit", async () => {
		const files = Array.from({ length: 50 }, (_, i) => `/project/src/file${i}.ts`);
		const verdict = await maxModifiedFiles.evaluate(
			makeAction({ type: "file_read" }),
			makeContext({ filesModified: files }),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("checks file_delete too", async () => {
		const files = Array.from({ length: 50 }, (_, i) => `/project/src/file${i}.ts`);
		const verdict = await maxModifiedFiles.evaluate(
			makeAction({ type: "file_delete", filePath: "/project/src/old.ts" }),
			makeContext({ filesModified: files }),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("has correct metadata", () => {
		expect(maxModifiedFiles.id).toBe("scope.max-modified-files");
	});
});

// ─── readOnlyPaths ──────────────────────────────────────────────────────────

describe("readOnlyPaths", () => {
	it("denies file_write in node_modules/", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ filePath: "/project/node_modules/lodash/index.js" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
		expect(verdict.reason).toContain("node_modules");
	});

	it("denies file_write in .git/", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ filePath: "/project/.git/config" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies file_write in dist/", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ filePath: "/project/dist/index.js" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies file_write in build/", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ filePath: "/project/build/output.js" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("denies file_delete in node_modules/", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ type: "file_delete", filePath: "/project/node_modules/pkg/index.js" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("allows file_write in src/", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ filePath: "/project/src/index.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows file_write in test/", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ filePath: "/project/test/utils.test.ts" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows file_read in node_modules/ (read is ok)", async () => {
		const verdict = await readOnlyPaths.evaluate(
			makeAction({ type: "file_read", filePath: "/project/node_modules/lodash/index.js" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(readOnlyPaths.id).toBe("scope.read-only-paths");
		expect(readOnlyPaths.severity).toBe("error");
	});
});

// ─── SCOPE_RULES ────────────────────────────────────────────────────────────

describe("SCOPE_RULES", () => {
	it("is an array of exactly 5 rules", () => {
		expect(SCOPE_RULES).toHaveLength(5);
	});

	it("contains all scope rules", () => {
		const ids = SCOPE_RULES.map((r) => r.id);
		expect(ids).toContain("scope.project-boundary");
		expect(ids).toContain("scope.no-modify-lock-files");
		expect(ids).toContain("scope.no-modify-git-history");
		expect(ids).toContain("scope.max-modified-files");
		expect(ids).toContain("scope.read-only-paths");
	});

	it("all rules have category scope", () => {
		for (const rule of SCOPE_RULES) {
			expect(rule.category).toBe("scope");
		}
	});

	it("all rules have an evaluate function", () => {
		for (const rule of SCOPE_RULES) {
			expect(typeof rule.evaluate).toBe("function");
		}
	});
});
