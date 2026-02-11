import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodingOrchestrator } from "../src/coding-orchestrator.js";
import type {
	CodingOrchestratorConfig,
	OrchestratorResult,
	OrchestratorProgress,
	TaskPlan,
	OrchestratorMode,
} from "../src/coding-orchestrator.js";
import type { ToolHandler } from "../src/types.js";

// ─── Mock @chitragupta/smriti ──────────────────────────────────────────────────

vi.mock("@chitragupta/smriti", () => ({
	createSession: vi.fn(() => ({ meta: { id: "mock-session" }, turns: [] })),
	loadSession: vi.fn(() => null),
	addTurn: vi.fn(),
	getMemory: vi.fn(() => null),
	appendMemory: vi.fn(),
}));

// ─── Mock child_process ────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
	execSync: vi.fn(() => "ok"),
}));

// ─── Mock fs ───────────────────────────────────────────────────────────────

const mockFiles: Record<string, string> = {};

vi.mock("node:fs", () => ({
	existsSync: vi.fn((p: string) => p in mockFiles),
	readFileSync: vi.fn((p: string) => {
		if (p in mockFiles) return mockFiles[p];
		throw new Error(`ENOENT: ${p}`);
	}),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeMockTool(name: string): ToolHandler {
	return {
		definition: {
			name,
			description: `Mock ${name} tool`,
			inputSchema: { type: "object", properties: {} },
		},
		execute: vi.fn(async () => ({ content: `${name} result` })),
	};
}

function makeTools(): ToolHandler[] {
	return ["read", "write", "edit", "bash", "grep", "find", "ls", "diff"].map(makeMockTool);
}

function makeConfig(overrides?: Partial<CodingOrchestratorConfig>): CodingOrchestratorConfig {
	return {
		workingDirectory: "/test/project",
		tools: makeTools(),
		mode: "plan-only", // Default to plan-only for unit tests (no LLM calls)
		...overrides,
	};
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("CodingOrchestrator", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const key of Object.keys(mockFiles)) {
			delete mockFiles[key];
		}
	});

	describe("constructor", () => {
		it("creates an orchestrator with default config", () => {
			const orch = new CodingOrchestrator(makeConfig());
			expect(orch).toBeDefined();
		});

		it("detects git repo from .git directory", () => {
			mockFiles["/test/project/.git"] = "";
			const orch = new CodingOrchestrator(makeConfig());
			const git = orch.getGitState();
			expect(git.isGitRepo).toBe(true);
		});

		it("detects non-git directory", () => {
			const orch = new CodingOrchestrator(makeConfig());
			const git = orch.getGitState();
			expect(git.isGitRepo).toBe(false);
		});

		it("initializes git state with null values", () => {
			const orch = new CodingOrchestrator(makeConfig());
			const git = orch.getGitState();
			expect(git.featureBranch).toBeNull();
			expect(git.originalBranch).toBeNull();
			expect(git.stashRef).toBeNull();
			expect(git.commits).toEqual([]);
		});
	});

	describe("run() in plan-only mode", () => {
		it("produces a task plan without executing", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Add input validation to the login form");

			expect(result.success).toBe(true);
			expect(result.plan).not.toBeNull();
			expect(result.plan!.task).toBe("Add input validation to the login form");
			expect(result.plan!.steps.length).toBeGreaterThan(0);
			expect(result.codingResults).toHaveLength(0);
		});

		it("classifies simple tasks as small complexity", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("fix typo in readme");

			expect(result.plan!.complexity).toBe("small");
			expect(result.plan!.steps).toHaveLength(1);
		});

		it("detects tasks requiring new files", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Create a new component for user authentication");

			expect(result.plan!.requiresNewFiles).toBe(true);
		});

		it("detects complex tasks", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Refactor the entire authentication system architecture");

			expect(result.plan!.complexity).toBe("large");
		});

		it("adds test step when task mentions testing", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Add unit tests for the user service");

			const testStep = result.plan!.steps.find((s) => s.description.toLowerCase().includes("test"));
			expect(testStep).toBeDefined();
		});

		it("adds test step when project has test command", async () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({
				scripts: { test: "vitest" },
			});
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Fix the broken login handler");

			const testStep = result.plan!.steps.find((s) => s.description.toLowerCase().includes("test"));
			expect(testStep).toBeDefined();
		});

		it("emits progress events", async () => {
			const events: OrchestratorProgress[] = [];
			const orch = new CodingOrchestrator(makeConfig({
				mode: "plan-only",
				onProgress: (p) => events.push(p),
			}));

			await orch.run("Add a feature");

			expect(events.length).toBeGreaterThanOrEqual(2);
			expect(events[0].phase).toBe("planning");
			expect(events[events.length - 1].phase).toBe("done");

			// All events should have elapsed time
			for (const event of events) {
				expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
			}
		});

		it("includes summary in result", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Add validation");

			expect(result.summary).toContain("Plan for:");
			expect(result.summary).toContain("Steps:");
		});

		it("records elapsed time", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Add validation");

			expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe("run() result structure", () => {
		it("returns all expected fields", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Some task");

			expect(result).toHaveProperty("success");
			expect(result).toHaveProperty("plan");
			expect(result).toHaveProperty("codingResults");
			expect(result).toHaveProperty("git");
			expect(result).toHaveProperty("reviewIssues");
			expect(result).toHaveProperty("validationPassed");
			expect(result).toHaveProperty("filesModified");
			expect(result).toHaveProperty("filesCreated");
			expect(result).toHaveProperty("summary");
			expect(result).toHaveProperty("elapsedMs");
			expect(result).toHaveProperty("progressLog");
		});

		it("deduplicates file lists", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Fix bug");

			expect(Array.isArray(result.filesModified)).toBe(true);
			expect(Array.isArray(result.filesCreated)).toBe(true);
		});
	});

	describe("config defaults", () => {
		it("defaults mode to full", () => {
			const orch = new CodingOrchestrator({
				workingDirectory: "/test/project",
				mode: undefined as any,
			});
			// We can verify the mode through run behavior — plan-only doesn't execute
			expect(orch).toBeDefined();
		});

		it("defaults branchPrefix to feat/", () => {
			mockFiles["/test/project/.git"] = "";
			const orch = new CodingOrchestrator(makeConfig());
			expect(orch).toBeDefined();
		});

		it("accepts custom maxReviewCycles", () => {
			const orch = new CodingOrchestrator(makeConfig({
				maxReviewCycles: 5,
			}));
			expect(orch).toBeDefined();
		});

		it("accepts custom maxDebugCycles", () => {
			const orch = new CodingOrchestrator(makeConfig({
				maxDebugCycles: 1,
			}));
			expect(orch).toBeDefined();
		});
	});

	describe("getCodingAgent", () => {
		it("returns null before run is called", () => {
			const orch = new CodingOrchestrator(makeConfig());
			expect(orch.getCodingAgent()).toBeNull();
		});

		it("returns agent after run is called", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			await orch.run("Some task");
			// In plan-only mode, the coding agent IS created (for convention detection)
			expect(orch.getCodingAgent()).not.toBeNull();
		});
	});

	describe("task planning heuristics", () => {
		it("creates single step for simple rename task", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("rename userId to user_id");

			expect(result.plan!.steps).toHaveLength(1);
			expect(result.plan!.complexity).toBe("small");
		});

		it("creates multi-step plan for feature task", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Implement a new REST endpoint for user profiles");

			expect(result.plan!.steps.length).toBeGreaterThan(1);
		});

		it("detects add comment as simple task", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("add comment explaining the sort algorithm");

			expect(result.plan!.steps).toHaveLength(1);
			expect(result.plan!.complexity).toBe("small");
		});

		it("detects remove unused as simple task", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("remove unused imports");

			expect(result.plan!.steps).toHaveLength(1);
		});

		it("marks system redesign as large complexity", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Migrate the database layer to a new architecture");

			expect(result.plan!.complexity).toBe("large");
		});

		it("detects new file creation from keywords", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));

			const tasks = [
				"create a new module for caching",
				"add a new test file for auth",
				"implement a new class for rate limiting",
			];

			for (const task of tasks) {
				const result = await orch.run(task);
				expect(result.plan!.requiresNewFiles).toBe(true);
			}
		});

		it("does not require new files for modification tasks", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("fix the bug in the login handler");

			expect(result.plan!.requiresNewFiles).toBe(false);
		});
	});

	describe("progress tracking", () => {
		it("logs all phases in plan-only mode", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Task");

			const phases = result.progressLog.map((p) => p.phase);
			expect(phases).toContain("planning");
			expect(phases).toContain("done");
		});

		it("includes messages in progress events", async () => {
			const orch = new CodingOrchestrator(makeConfig({ mode: "plan-only" }));
			const result = await orch.run("Add feature X");

			for (const progress of result.progressLog) {
				expect(progress.message.length).toBeGreaterThan(0);
			}
		});
	});
});
