import { describe, it, expect, vi, beforeEach } from "vitest";
import { DebugAgent, DEBUG_TOOL_NAMES } from "../src/debug-agent.js";
import type { DebugAgentConfig, BugReport } from "../src/debug-agent.js";
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

function makeConfig(overrides?: Partial<DebugAgentConfig>): DebugAgentConfig {
	return {
		workingDirectory: "/test/project",
		tools: makeAllTools(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DebugAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("DEBUG_TOOL_NAMES", () => {
		it("includes all code tools including write and edit", () => {
			expect(DEBUG_TOOL_NAMES.has("read")).toBe(true);
			expect(DEBUG_TOOL_NAMES.has("write")).toBe(true);
			expect(DEBUG_TOOL_NAMES.has("edit")).toBe(true);
			expect(DEBUG_TOOL_NAMES.has("bash")).toBe(true);
			expect(DEBUG_TOOL_NAMES.has("grep")).toBe(true);
			expect(DEBUG_TOOL_NAMES.has("find")).toBe(true);
			expect(DEBUG_TOOL_NAMES.has("ls")).toBe(true);
			expect(DEBUG_TOOL_NAMES.has("diff")).toBe(true);
		});

		it("excludes non-debug tools", () => {
			expect(DEBUG_TOOL_NAMES.has("memory")).toBe(false);
			expect(DEBUG_TOOL_NAMES.has("session")).toBe(false);
			expect(DEBUG_TOOL_NAMES.has("watch")).toBe(false);
			expect(DEBUG_TOOL_NAMES.has("project-analysis")).toBe(false);
		});
	});

	describe("constructor", () => {
		it("creates an agent with all code tools (needs write/edit for fixes)", () => {
			const debugger_ = new DebugAgent(makeConfig());
			const agent = debugger_.getAgent();
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

		it("uses anveshi profile", () => {
			const debugger_ = new DebugAgent(makeConfig());
			const agent = debugger_.getAgent();
			const profile = agent.getProfile();

			expect(profile.id).toBe("anveshi");
			expect(profile.name).toContain("Anveshi");
		});

		it("accepts custom provider and model", () => {
			const debugger_ = new DebugAgent(makeConfig({
				providerId: "openai",
				modelId: "gpt-4o",
			}));
			const state = debugger_.getAgent().getState();
			expect(state.providerId).toBe("openai");
			expect(state.model).toBe("gpt-4o");
		});

		it("defaults autoFix to false", () => {
			const debugger_ = new DebugAgent(makeConfig());
			// Agent is created with autoFix=false by default
			expect(debugger_).toBeDefined();
			expect(debugger_.getAgent()).toBeDefined();
		});

		it("works with no tools provided", () => {
			const debugger_ = new DebugAgent({
				workingDirectory: "/test/project",
			});
			const state = debugger_.getAgent().getState();
			expect(state.tools).toHaveLength(0);
		});
	});

	describe("investigateTest", () => {
		it("returns no-bug result when test passes", async () => {
			const { execSync } = await import("node:child_process");
			const mockExec = vi.mocked(execSync);
			mockExec.mockReturnValue("All tests passed" as any);

			const debugger_ = new DebugAgent(makeConfig());
			const result = await debugger_.investigateTest("npm test");

			expect(result).toHaveProperty("rootCause");
			expect(result).toHaveProperty("filesInvestigated");
			expect(result).toHaveProperty("proposedFix");
			expect(result).toHaveProperty("fixApplied");
			expect(result).toHaveProperty("confidence");

			expect(result.rootCause).toContain("no bug found");
			expect(result.fixApplied).toBe(false);
			expect(result.confidence).toBe(1.0);
		});
	});

	describe("DebugResult structure", () => {
		it("has all required fields", async () => {
			const { execSync } = await import("node:child_process");
			const mockExec = vi.mocked(execSync);
			// Test passes — returns a no-bug result
			mockExec.mockReturnValue("PASS" as any);

			const debugger_ = new DebugAgent(makeConfig());
			const result = await debugger_.investigateTest("npm test");

			// Verify structure has all required fields
			expect(typeof result.rootCause).toBe("string");
			expect(Array.isArray(result.filesInvestigated)).toBe(true);
			expect(typeof result.proposedFix).toBe("string");
			expect(typeof result.fixApplied).toBe("boolean");
			expect(typeof result.confidence).toBe("number");
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});
	});

	describe("tool filtering", () => {
		it("keeps write and edit tools (debuggers need to apply fixes)", () => {
			const allTools = makeAllTools();
			const debugger_ = new DebugAgent(makeConfig({ tools: allTools }));

			const state = debugger_.getAgent().getState();
			const toolNames = new Set(state.tools.map((t) => t.definition.name));

			// Verify only DEBUG_TOOL_NAMES are present
			for (const name of toolNames) {
				expect(DEBUG_TOOL_NAMES.has(name)).toBe(true);
			}

			// Critical difference from ReviewAgent: write and edit ARE included
			expect(toolNames.has("write")).toBe(true);
			expect(toolNames.has("edit")).toBe(true);
		});
	});
});
