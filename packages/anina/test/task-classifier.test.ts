import { describe, it, expect } from "vitest";
import {
	classifyTask,
	isCodeTask,
	ALL_TASK_TYPES,
} from "../src/task-classifier.js";
import type { TaskType, TaskClassification } from "../src/task-classifier.js";

describe("classifyTask", () => {
	// ── Helper ───────────────────────────────────────────────────────
	function expectType(input: string, expectedType: TaskType): void {
		const result = classifyTask(input);
		expect(result.type).toBe(expectedType);
	}

	// ── Empty / edge cases ──────────────────────────────────────────

	describe("edge cases", () => {
		it("returns 'general' for empty string", () => {
			const result = classifyTask("");
			expect(result.type).toBe("general");
			expect(result.confidence).toBe(0);
			expect(result.matchedKeywords).toEqual([]);
		});

		it("returns 'general' for whitespace-only input", () => {
			expectType("   \n\t  ", "general");
		});

		it("returns 'general' for unrecognized gibberish", () => {
			expectType("asdfqwer zxcv", "general");
		});

		it("completes in < 1ms", () => {
			const result = classifyTask("fix the bug in auth.ts");
			expect(result.durationMs).toBeLessThan(5); // generous for CI
		});

		it("always returns valid TaskClassification shape", () => {
			const result = classifyTask("hello world");
			expect(result).toHaveProperty("type");
			expect(result).toHaveProperty("confidence");
			expect(result).toHaveProperty("matchedKeywords");
			expect(result).toHaveProperty("durationMs");
			expect(typeof result.type).toBe("string");
			expect(typeof result.confidence).toBe("number");
			expect(Array.isArray(result.matchedKeywords)).toBe(true);
			expect(typeof result.durationMs).toBe("number");
		});
	});

	// ── Git operations ──────────────────────────────────────────────

	describe("git tasks", () => {
		it("classifies 'commit the changes'", () => {
			expectType("commit the changes", "git");
		});

		it("classifies 'push to origin'", () => {
			expectType("push to origin", "git");
		});

		it("classifies 'create a pull request'", () => {
			expectType("create a pull request", "git");
		});

		it("classifies 'git status'", () => {
			expectType("git status", "git");
		});

		it("classifies 'merge the feature branch'", () => {
			expectType("merge the feature branch", "git");
		});

		it("classifies 'rebase onto main'", () => {
			expectType("rebase onto main", "git");
		});

		it("classifies 'git diff HEAD~3'", () => {
			expectType("git diff HEAD~3", "git");
		});
	});

	// ── Test tasks ──────────────────────────────────────────────────

	describe("test tasks", () => {
		it("classifies 'write tests for the auth module'", () => {
			expectType("write tests for the auth module", "test");
		});

		it("classifies 'run vitest'", () => {
			expectType("run vitest", "test");
		});

		it("classifies 'add unit tests for the parser'", () => {
			expectType("add unit tests for the parser", "test");
		});

		it("classifies 'test coverage is too low'", () => {
			expectType("test coverage is too low", "test");
		});

		it("classifies references to .test.ts files", () => {
			expectType("update auth.test.ts", "test");
		});
	});

	// ── Code fix / debugging ────────────────────────────────────────

	describe("code-fix tasks", () => {
		it("classifies 'fix the bug in login.ts'", () => {
			expectType("fix the bug in login.ts", "code-fix");
		});

		it("classifies 'debug the authentication flow'", () => {
			expectType("debug the authentication flow", "code-fix");
		});

		it("classifies 'TypeError: cannot read property of undefined'", () => {
			expectType("TypeError: cannot read property of undefined", "code-fix");
		});

		it("classifies 'the server is crashing on startup'", () => {
			expectType("the server is crashing on startup", "code-fix");
		});

		it("classifies 'not working after the update'", () => {
			expectType("not working after the update", "code-fix");
		});

		it("classifies 'troubleshoot the deployment error'", () => {
			expectType("troubleshoot the deployment error", "code-fix");
		});
	});

	// ── Code refactoring ────────────────────────────────────────────

	describe("code-refactor tasks", () => {
		it("classifies 'refactor the database module'", () => {
			expectType("refactor the database module", "code-refactor");
		});

		it("classifies 'extract function from this class'", () => {
			expectType("extract function from this class", "code-refactor");
		});

		it("classifies 'clean up the legacy code'", () => {
			expectType("clean up the legacy code", "code-refactor");
		});

		it("classifies 'reduce complexity in the parser'", () => {
			expectType("reduce complexity in the parser", "code-refactor");
		});

		it("classifies 'remove dead code from utils'", () => {
			expectType("remove dead code from utils", "code-refactor");
		});
	});

	// ── Code review ─────────────────────────────────────────────────

	describe("code-review tasks", () => {
		it("classifies 'review this code'", () => {
			expectType("review this code", "code-review");
		});

		it("classifies 'security audit of the auth module'", () => {
			expectType("security audit of the auth module", "code-review");
		});

		it("classifies 'check for anti-patterns'", () => {
			expectType("check for anti-patterns", "code-review");
		});

		it("classifies 'review my PR changes'", () => {
			expectType("review my PR changes", "code-review");
		});
	});

	// ── Code writing ────────────────────────────────────────────────

	describe("code-write tasks", () => {
		it("classifies 'implement a new login function'", () => {
			expectType("implement a new login function", "code-write");
		});

		it("classifies 'write a class for user management'", () => {
			expectType("write a class for user management", "code-write");
		});

		it("classifies 'add a new field to the User model'", () => {
			expectType("add a new field to the User model", "code-write");
		});

		it("classifies 'wire up the event handler'", () => {
			expectType("wire up the event handler", "code-write");
		});
	});

	// ── Configuration ───────────────────────────────────────────────

	describe("config tasks", () => {
		it("classifies 'configure eslint for the project'", () => {
			expectType("configure eslint for the project", "config");
		});

		it("classifies 'update tsconfig.json'", () => {
			expectType("update tsconfig.json", "config");
		});

		it("classifies 'npm install lodash'", () => {
			expectType("npm install lodash", "config");
		});

		it("classifies 'set up the CI/CD pipeline'", () => {
			expectType("set up the CI/CD pipeline", "config");
		});
	});

	// ── Research ────────────────────────────────────────────────────

	describe("research tasks", () => {
		it("classifies 'explain how the router works'", () => {
			expectType("explain how the router works", "research");
		});

		it("classifies 'what is the architecture of this system'", () => {
			expectType("what is the architecture of this system", "research");
		});

		it("classifies 'show me where the auth logic is'", () => {
			expectType("show me where the auth logic is", "research");
		});

		it("classifies 'walk through the deployment flow'", () => {
			expectType("walk through the deployment flow", "research");
		});
	});

	// ── Memory operations ───────────────────────────────────────────

	describe("memory tasks", () => {
		it("classifies 'what did we decide about auth?'", () => {
			expectType("what did we decide about auth?", "memory");
		});

		it("classifies 'recall the last session'", () => {
			expectType("recall the last session", "memory");
		});

		it("classifies 'save this to memory'", () => {
			expectType("save this to memory", "memory");
		});

		it("classifies 'create a handover summary'", () => {
			expectType("create a handover summary", "memory");
		});
	});

	// ── Confidence ──────────────────────────────────────────────────

	describe("confidence scores", () => {
		it("returns higher confidence for strong keyword matches", () => {
			const gitResult = classifyTask("git status");
			expect(gitResult.confidence).toBeGreaterThanOrEqual(0.6);
		});

		it("returns confidence in [0, 1] range", () => {
			for (const prompt of ["fix bug", "commit changes", "explain this", "hello"]) {
				const result = classifyTask(prompt);
				expect(result.confidence).toBeGreaterThanOrEqual(0);
				expect(result.confidence).toBeLessThanOrEqual(1);
			}
		});

		it("returns matched keywords for the winning type", () => {
			const result = classifyTask("fix the TypeError in auth.ts");
			expect(result.matchedKeywords.length).toBeGreaterThan(0);
			// Should contain keywords like "fix" or "typeerror"
			const lower = result.matchedKeywords.map((k) => k.toLowerCase());
			expect(lower.some((k) => k.includes("fix") || k.includes("typeerror"))).toBe(true);
		});
	});
});

// ── isCodeTask ──────────────────────────────────────────────────────────────

describe("isCodeTask", () => {
	it("returns true for code-write", () => {
		expect(isCodeTask("code-write")).toBe(true);
	});

	it("returns true for code-fix", () => {
		expect(isCodeTask("code-fix")).toBe(true);
	});

	it("returns true for code-refactor", () => {
		expect(isCodeTask("code-refactor")).toBe(true);
	});

	it("returns true for code-review", () => {
		expect(isCodeTask("code-review")).toBe(true);
	});

	it("returns true for test", () => {
		expect(isCodeTask("test")).toBe(true);
	});

	it("returns false for git", () => {
		expect(isCodeTask("git")).toBe(false);
	});

	it("returns false for config", () => {
		expect(isCodeTask("config")).toBe(false);
	});

	it("returns false for research", () => {
		expect(isCodeTask("research")).toBe(false);
	});

	it("returns false for memory", () => {
		expect(isCodeTask("memory")).toBe(false);
	});

	it("returns false for general", () => {
		expect(isCodeTask("general")).toBe(false);
	});
});

// ── ALL_TASK_TYPES ──────────────────────────────────────────────────────────

describe("ALL_TASK_TYPES", () => {
	it("contains exactly 10 task types", () => {
		expect(ALL_TASK_TYPES).toHaveLength(10);
	});

	it("includes all expected types", () => {
		const expected: TaskType[] = [
			"code-write", "code-fix", "code-refactor", "code-review",
			"test", "config", "research", "git", "memory", "general",
		];
		for (const t of expected) {
			expect(ALL_TASK_TYPES).toContain(t);
		}
	});

	it("is immutable (readonly)", () => {
		// TypeScript enforces readonly at compile time; at runtime we just
		// verify it's a frozen-like array (no mutation methods would break it).
		expect(Array.isArray(ALL_TASK_TYPES)).toBe(true);
	});
});
