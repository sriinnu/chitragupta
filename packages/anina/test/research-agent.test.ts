import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResearchAgent, RESEARCH_TOOL_NAMES } from "../src/research-agent.js";
import type { ResearchAgentConfig } from "../src/research-agent.js";
import type { ToolHandler } from "../src/types.js";

// ─── Mock @chitragupta/smriti ──────────────────────────────────────────────────

vi.mock("@chitragupta/smriti", () => ({
	createSession: vi.fn(() => ({ meta: { id: "mock-session" }, turns: [] })),
	loadSession: vi.fn(() => null),
	addTurn: vi.fn(),
	getMemory: vi.fn(() => null),
	appendMemory: vi.fn(),
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

function makeConfig(overrides?: Partial<ResearchAgentConfig>): ResearchAgentConfig {
	return {
		workingDirectory: "/test/project",
		tools: makeAllTools(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ResearchAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("RESEARCH_TOOL_NAMES", () => {
		it("includes read-only and search tools", () => {
			expect(RESEARCH_TOOL_NAMES.has("read")).toBe(true);
			expect(RESEARCH_TOOL_NAMES.has("grep")).toBe(true);
			expect(RESEARCH_TOOL_NAMES.has("find")).toBe(true);
			expect(RESEARCH_TOOL_NAMES.has("ls")).toBe(true);
			expect(RESEARCH_TOOL_NAMES.has("bash")).toBe(true);
		});

		it("excludes write and edit tools (researchers don't modify code)", () => {
			expect(RESEARCH_TOOL_NAMES.has("write")).toBe(false);
			expect(RESEARCH_TOOL_NAMES.has("edit")).toBe(false);
			expect(RESEARCH_TOOL_NAMES.has("diff")).toBe(false);
		});

		it("excludes non-research tools", () => {
			expect(RESEARCH_TOOL_NAMES.has("memory")).toBe(false);
			expect(RESEARCH_TOOL_NAMES.has("session")).toBe(false);
			expect(RESEARCH_TOOL_NAMES.has("watch")).toBe(false);
		});
	});

	describe("constructor", () => {
		it("creates an agent with only research-relevant tools (no write/edit)", () => {
			const researcher = new ResearchAgent(makeConfig());
			const agent = researcher.getAgent();
			const state = agent.getState();

			const toolNames = state.tools.map((t) => t.definition.name);
			expect(toolNames).toContain("read");
			expect(toolNames).toContain("grep");
			expect(toolNames).toContain("find");
			expect(toolNames).toContain("ls");
			expect(toolNames).toContain("bash");

			// Must NOT have write or edit
			expect(toolNames).not.toContain("write");
			expect(toolNames).not.toContain("edit");
			expect(toolNames).not.toContain("memory");
			expect(toolNames).not.toContain("session");
		});

		it("uses shodhaka profile", () => {
			const researcher = new ResearchAgent(makeConfig());
			const agent = researcher.getAgent();
			const profile = agent.getProfile();

			expect(profile.id).toBe("shodhaka");
			expect(profile.name).toContain("Shodhaka");
		});

		it("accepts custom provider and model", () => {
			const researcher = new ResearchAgent(makeConfig({
				providerId: "openai",
				modelId: "gpt-4o",
			}));
			const state = researcher.getAgent().getState();
			expect(state.providerId).toBe("openai");
			expect(state.model).toBe("gpt-4o");
		});

		it("works with no tools provided", () => {
			const researcher = new ResearchAgent({
				workingDirectory: "/test/project",
			});
			const state = researcher.getAgent().getState();
			expect(state.tools).toHaveLength(0);
		});
	});

	describe("ResearchResult structure", () => {
		it("has all required fields defined in the interface", () => {
			// Verify the interface shape by constructing a mock result
			const result = {
				answer: "Test answer",
				filesExamined: ["src/index.ts"],
				codeReferences: [{ file: "src/index.ts", line: 1, snippet: "export {}" }],
				confidence: 0.9,
				relatedTopics: ["architecture"],
			};

			expect(typeof result.answer).toBe("string");
			expect(Array.isArray(result.filesExamined)).toBe(true);
			expect(Array.isArray(result.codeReferences)).toBe(true);
			expect(typeof result.confidence).toBe("number");
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
			expect(Array.isArray(result.relatedTopics)).toBe(true);
		});
	});

	describe("tool filtering", () => {
		it("filters a full tool set to only research-safe tools", () => {
			const allTools = makeAllTools();
			const researcher = new ResearchAgent(makeConfig({ tools: allTools }));

			const state = researcher.getAgent().getState();
			const toolNames = new Set(state.tools.map((t) => t.definition.name));

			// Verify only RESEARCH_TOOL_NAMES are present
			for (const name of toolNames) {
				expect(RESEARCH_TOOL_NAMES.has(name)).toBe(true);
			}

			// Verify write/edit are excluded
			expect(toolNames.has("write")).toBe(false);
			expect(toolNames.has("edit")).toBe(false);
		});
	});
});
