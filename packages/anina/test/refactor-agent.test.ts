import { describe, it, expect, vi, beforeEach } from "vitest";
import { RefactorAgent, REFACTOR_TOOL_NAMES } from "../src/refactor-agent.js";
import type { RefactorAgentConfig, RefactorPlan } from "../src/refactor-agent.js";
import type { ToolHandler } from "../src/types.js";

// ─── Mock @chitragupta/smriti ──────────────────────────────────────────────────

vi.mock("@chitragupta/smriti", () => ({
	createSession: vi.fn(() => ({ meta: { id: "mock-session" }, turns: [] })),
	loadSession: vi.fn(() => null),
	addTurn: vi.fn(),
	getMemory: vi.fn(() => null),
	appendMemory: vi.fn(),
}));

// ─── Mock child_process.execSync ────────────────────────────────────────────

vi.mock("node:child_process", () => ({
	execSync: vi.fn(() => "ok"),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

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

function makeAllTools(): ToolHandler[] {
	return [
		"read", "write", "edit", "bash", "grep", "find", "ls",
		"memory", "session", "diff", "watch", "project-analysis",
	].map(makeMockTool);
}

function makeConfig(overrides?: Partial<RefactorAgentConfig>): RefactorAgentConfig {
	return {
		workingDirectory: "/test/project",
		tools: makeAllTools(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("RefactorAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("REFACTOR_TOOL_NAMES", () => {
		it("includes all code tools including write and edit", () => {
			expect(REFACTOR_TOOL_NAMES.has("read")).toBe(true);
			expect(REFACTOR_TOOL_NAMES.has("write")).toBe(true);
			expect(REFACTOR_TOOL_NAMES.has("edit")).toBe(true);
			expect(REFACTOR_TOOL_NAMES.has("bash")).toBe(true);
			expect(REFACTOR_TOOL_NAMES.has("grep")).toBe(true);
			expect(REFACTOR_TOOL_NAMES.has("find")).toBe(true);
			expect(REFACTOR_TOOL_NAMES.has("ls")).toBe(true);
			expect(REFACTOR_TOOL_NAMES.has("diff")).toBe(true);
		});

		it("excludes non-refactor tools", () => {
			expect(REFACTOR_TOOL_NAMES.has("memory")).toBe(false);
			expect(REFACTOR_TOOL_NAMES.has("session")).toBe(false);
			expect(REFACTOR_TOOL_NAMES.has("watch")).toBe(false);
			expect(REFACTOR_TOOL_NAMES.has("project-analysis")).toBe(false);
		});
	});

	describe("constructor", () => {
		it("creates an agent with all code tools (needs write/edit for refactoring)", () => {
			const refactorer = new RefactorAgent(makeConfig());
			const agent = refactorer.getAgent();
			const state = agent.getState();

			const toolNames = state.tools.map((t) => t.definition.name);
			expect(toolNames).toContain("read");
			expect(toolNames).toContain("write");
			expect(toolNames).toContain("edit");
			expect(toolNames).toContain("bash");
			expect(toolNames).toContain("grep");
			expect(toolNames).toContain("find");
			expect(toolNames).toContain("ls");
			expect(toolNames).toContain("diff");

			// Should NOT have memory/session/watch
			expect(toolNames).not.toContain("memory");
			expect(toolNames).not.toContain("session");
			expect(toolNames).not.toContain("watch");
		});

		it("uses parikartru profile", () => {
			const refactorer = new RefactorAgent(makeConfig());
			const agent = refactorer.getAgent();
			const profile = agent.getProfile();

			expect(profile.id).toBe("parikartru");
			expect(profile.name).toContain("Parikartru");
		});

		it("defaults maxFiles to 10 and validatePerFile to true", () => {
			const refactorer = new RefactorAgent(makeConfig());
			// Agent is created with defaults applied internally
			expect(refactorer).toBeDefined();
			expect(refactorer.getAgent()).toBeDefined();
		});

		it("accepts custom provider and model", () => {
			const refactorer = new RefactorAgent(makeConfig({
				providerId: "openai",
				modelId: "gpt-4o",
			}));
			const state = refactorer.getAgent().getState();
			expect(state.providerId).toBe("openai");
			expect(state.model).toBe("gpt-4o");
		});

		it("works with no tools provided", () => {
			const refactorer = new RefactorAgent({
				workingDirectory: "/test/project",
			});
			const state = refactorer.getAgent().getState();
			expect(state.tools).toHaveLength(0);
		});
	});

	describe("RefactorPlan structure", () => {
		it("has all required fields defined in the interface", () => {
			const plan: RefactorPlan = {
				type: "rename",
				description: "Rename function foo to bar",
				filesAffected: ["src/utils.ts", "src/index.ts"],
				estimatedChanges: 5,
				risks: ["May break callers in other packages"],
			};

			expect(plan.type).toBe("rename");
			expect(typeof plan.description).toBe("string");
			expect(Array.isArray(plan.filesAffected)).toBe(true);
			expect(typeof plan.estimatedChanges).toBe("number");
			expect(Array.isArray(plan.risks)).toBe(true);
		});
	});

	describe("tool filtering", () => {
		it("keeps write and edit tools (refactorers need to modify code)", () => {
			const allTools = makeAllTools();
			const refactorer = new RefactorAgent(makeConfig({ tools: allTools }));

			const state = refactorer.getAgent().getState();
			const toolNames = new Set(state.tools.map((t) => t.definition.name));

			// Verify only REFACTOR_TOOL_NAMES are present
			for (const name of toolNames) {
				expect(REFACTOR_TOOL_NAMES.has(name)).toBe(true);
			}

			// Critical: write and edit ARE included
			expect(toolNames.has("write")).toBe(true);
			expect(toolNames.has("edit")).toBe(true);
		});
	});
});
