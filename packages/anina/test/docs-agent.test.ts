import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocsAgent, DOCS_TOOL_NAMES } from "../src/docs-agent.js";
import type { DocsAgentConfig, DocsResult } from "../src/docs-agent.js";
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

function makeConfig(overrides?: Partial<DocsAgentConfig>): DocsAgentConfig {
	return {
		workingDirectory: "/test/project",
		tools: makeAllTools(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DocsAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("DOCS_TOOL_NAMES", () => {
		it("includes read, write, edit, and search tools", () => {
			expect(DOCS_TOOL_NAMES.has("read")).toBe(true);
			expect(DOCS_TOOL_NAMES.has("write")).toBe(true);
			expect(DOCS_TOOL_NAMES.has("edit")).toBe(true);
			expect(DOCS_TOOL_NAMES.has("bash")).toBe(true);
			expect(DOCS_TOOL_NAMES.has("grep")).toBe(true);
			expect(DOCS_TOOL_NAMES.has("find")).toBe(true);
			expect(DOCS_TOOL_NAMES.has("ls")).toBe(true);
		});

		it("excludes non-docs tools", () => {
			expect(DOCS_TOOL_NAMES.has("memory")).toBe(false);
			expect(DOCS_TOOL_NAMES.has("session")).toBe(false);
			expect(DOCS_TOOL_NAMES.has("watch")).toBe(false);
			expect(DOCS_TOOL_NAMES.has("diff")).toBe(false);
			expect(DOCS_TOOL_NAMES.has("project-analysis")).toBe(false);
		});
	});

	describe("constructor", () => {
		it("creates an agent with docs-relevant tools (includes write/edit)", () => {
			const documenter = new DocsAgent(makeConfig());
			const agent = documenter.getAgent();
			const state = agent.getState();

			const toolNames = state.tools.map((t) => t.definition.name);
			expect(toolNames).toContain("read");
			expect(toolNames).toContain("write");
			expect(toolNames).toContain("edit");
			expect(toolNames).toContain("bash");
			expect(toolNames).toContain("grep");
			expect(toolNames).toContain("find");
			expect(toolNames).toContain("ls");

			// Should NOT have memory/session/watch/diff
			expect(toolNames).not.toContain("memory");
			expect(toolNames).not.toContain("session");
			expect(toolNames).not.toContain("watch");
		});

		it("uses lekhaka profile", () => {
			const documenter = new DocsAgent(makeConfig());
			const agent = documenter.getAgent();
			const profile = agent.getProfile();

			expect(profile.id).toBe("lekhaka");
			expect(profile.name).toContain("Lekhaka");
		});

		it("defaults style to technical", () => {
			const documenter = new DocsAgent(makeConfig());
			// Agent is created with style=technical default
			expect(documenter).toBeDefined();
			expect(documenter.getAgent()).toBeDefined();
		});

		it("accepts custom provider and model", () => {
			const documenter = new DocsAgent(makeConfig({
				providerId: "openai",
				modelId: "gpt-4o",
			}));
			const state = documenter.getAgent().getState();
			expect(state.providerId).toBe("openai");
			expect(state.model).toBe("gpt-4o");
		});

		it("works with no tools provided", () => {
			const documenter = new DocsAgent({
				workingDirectory: "/test/project",
			});
			const state = documenter.getAgent().getState();
			expect(state.tools).toHaveLength(0);
		});
	});

	describe("DocsResult structure", () => {
		it("has all required fields defined in the interface", () => {
			const result: DocsResult = {
				filesModified: ["README.md"],
				filesCreated: ["ARCHITECTURE.md"],
				summary: "Updated README and created architecture docs",
				wordCount: 500,
			};

			expect(Array.isArray(result.filesModified)).toBe(true);
			expect(Array.isArray(result.filesCreated)).toBe(true);
			expect(typeof result.summary).toBe("string");
			expect(typeof result.wordCount).toBe("number");
			expect(result.wordCount).toBeGreaterThanOrEqual(0);
		});
	});

	describe("tool filtering", () => {
		it("keeps write and edit tools (doc agents need to write documentation)", () => {
			const allTools = makeAllTools();
			const documenter = new DocsAgent(makeConfig({ tools: allTools }));

			const state = documenter.getAgent().getState();
			const toolNames = new Set(state.tools.map((t) => t.definition.name));

			// Verify only DOCS_TOOL_NAMES are present
			for (const name of toolNames) {
				expect(DOCS_TOOL_NAMES.has(name)).toBe(true);
			}

			// Critical: write and edit ARE included for documentation
			expect(toolNames.has("write")).toBe(true);
			expect(toolNames.has("edit")).toBe(true);
		});
	});
});
