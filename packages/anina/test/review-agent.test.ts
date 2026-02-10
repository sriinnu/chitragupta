import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReviewAgent, REVIEW_TOOL_NAMES } from "../src/review-agent.js";
import type { ReviewAgentConfig } from "../src/review-agent.js";
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
	execSync: vi.fn(() => ""),
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

function makeConfig(overrides?: Partial<ReviewAgentConfig>): ReviewAgentConfig {
	return {
		workingDirectory: "/test/project",
		tools: makeAllTools(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ReviewAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("REVIEW_TOOL_NAMES", () => {
		it("includes read-only and search tools", () => {
			expect(REVIEW_TOOL_NAMES.has("read")).toBe(true);
			expect(REVIEW_TOOL_NAMES.has("grep")).toBe(true);
			expect(REVIEW_TOOL_NAMES.has("find")).toBe(true);
			expect(REVIEW_TOOL_NAMES.has("ls")).toBe(true);
			expect(REVIEW_TOOL_NAMES.has("diff")).toBe(true);
			expect(REVIEW_TOOL_NAMES.has("bash")).toBe(true);
		});

		it("excludes write and edit tools (reviewers don't modify code)", () => {
			expect(REVIEW_TOOL_NAMES.has("write")).toBe(false);
			expect(REVIEW_TOOL_NAMES.has("edit")).toBe(false);
		});

		it("excludes non-review tools", () => {
			expect(REVIEW_TOOL_NAMES.has("memory")).toBe(false);
			expect(REVIEW_TOOL_NAMES.has("session")).toBe(false);
			expect(REVIEW_TOOL_NAMES.has("watch")).toBe(false);
		});
	});

	describe("constructor", () => {
		it("creates an agent with only review-relevant tools (no write/edit)", () => {
			const reviewer = new ReviewAgent(makeConfig());
			const agent = reviewer.getAgent();
			const state = agent.getState();

			const toolNames = state.tools.map((t) => t.definition.name);
			expect(toolNames).toContain("read");
			expect(toolNames).toContain("grep");
			expect(toolNames).toContain("find");
			expect(toolNames).toContain("ls");
			expect(toolNames).toContain("diff");
			expect(toolNames).toContain("bash");

			// Must NOT have write or edit
			expect(toolNames).not.toContain("write");
			expect(toolNames).not.toContain("edit");
			expect(toolNames).not.toContain("memory");
			expect(toolNames).not.toContain("session");
		});

		it("uses parikshaka profile", () => {
			const reviewer = new ReviewAgent(makeConfig());
			const agent = reviewer.getAgent();
			const profile = agent.getProfile();

			expect(profile.id).toBe("parikshaka");
			expect(profile.name).toContain("Parikshaka");
		});

		it("accepts custom provider and model", () => {
			const reviewer = new ReviewAgent(makeConfig({
				providerId: "openai",
				modelId: "gpt-4o",
			}));
			const state = reviewer.getAgent().getState();
			expect(state.providerId).toBe("openai");
			expect(state.model).toBe("gpt-4o");
		});

		it("works with no tools provided", () => {
			const reviewer = new ReviewAgent({
				workingDirectory: "/test/project",
			});
			const state = reviewer.getAgent().getState();
			expect(state.tools).toHaveLength(0);
		});

		it("defaults focus to all areas", () => {
			const reviewer = new ReviewAgent(makeConfig());
			// The agent is created — defaults are applied internally
			expect(reviewer).toBeDefined();
			expect(reviewer.getAgent()).toBeDefined();
		});
	});

	describe("ReviewResult structure", () => {
		it("reviewDiff returns empty result for no changes", async () => {
			const { execSync } = await import("node:child_process");
			const mockExec = vi.mocked(execSync);
			mockExec.mockReturnValue("" as any);

			const reviewer = new ReviewAgent(makeConfig());
			const result = await reviewer.reviewDiff();

			expect(result).toHaveProperty("issues");
			expect(result).toHaveProperty("summary");
			expect(result).toHaveProperty("filesReviewed");
			expect(result).toHaveProperty("overallScore");
			expect(result.issues).toEqual([]);
			expect(result.overallScore).toBe(10);
			expect(result.summary).toBe("No changes to review.");
		});
	});

	describe("tool filtering", () => {
		it("filters a full tool set to only review-safe tools", () => {
			const allTools = makeAllTools();
			const reviewer = new ReviewAgent(makeConfig({ tools: allTools }));

			const state = reviewer.getAgent().getState();
			const toolNames = new Set(state.tools.map((t) => t.definition.name));

			// Verify only REVIEW_TOOL_NAMES are present
			for (const name of toolNames) {
				expect(REVIEW_TOOL_NAMES.has(name)).toBe(true);
			}

			// Verify write/edit are excluded
			expect(toolNames.has("write")).toBe(false);
			expect(toolNames.has("edit")).toBe(false);
		});
	});
});
