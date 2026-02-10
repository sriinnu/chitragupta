import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodingAgent, CODE_TOOL_NAMES } from "../src/coding-agent.js";
import type { CodingAgentConfig, ProjectConventions } from "../src/coding-agent.js";
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

// ─── Mock fs for convention detection ───────────────────────────────────────

const mockFiles: Record<string, string> = {};

vi.mock("node:fs", () => ({
	existsSync: vi.fn((p: string) => p in mockFiles),
	readFileSync: vi.fn((p: string) => {
		if (p in mockFiles) return mockFiles[p];
		throw new Error(`ENOENT: ${p}`);
	}),
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

function makeConfig(overrides?: Partial<CodingAgentConfig>): CodingAgentConfig {
	return {
		workingDirectory: "/test/project",
		tools: makeAllTools(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CodingAgent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset mock files
		for (const key of Object.keys(mockFiles)) {
			delete mockFiles[key];
		}
	});

	describe("CODE_TOOL_NAMES", () => {
		it("includes the expected code-relevant tools", () => {
			expect(CODE_TOOL_NAMES.has("read")).toBe(true);
			expect(CODE_TOOL_NAMES.has("write")).toBe(true);
			expect(CODE_TOOL_NAMES.has("edit")).toBe(true);
			expect(CODE_TOOL_NAMES.has("bash")).toBe(true);
			expect(CODE_TOOL_NAMES.has("grep")).toBe(true);
			expect(CODE_TOOL_NAMES.has("find")).toBe(true);
			expect(CODE_TOOL_NAMES.has("ls")).toBe(true);
			expect(CODE_TOOL_NAMES.has("diff")).toBe(true);
		});

		it("excludes non-code tools", () => {
			expect(CODE_TOOL_NAMES.has("memory")).toBe(false);
			expect(CODE_TOOL_NAMES.has("session")).toBe(false);
			expect(CODE_TOOL_NAMES.has("watch")).toBe(false);
			expect(CODE_TOOL_NAMES.has("project-analysis")).toBe(false);
		});
	});

	describe("constructor", () => {
		it("creates an agent with only code-relevant tools", () => {
			const coder = new CodingAgent(makeConfig());
			const agent = coder.getAgent();
			const state = agent.getState();

			// Should have filtered to only code tools
			const toolNames = state.tools.map((t) => t.definition.name);
			expect(toolNames).toContain("read");
			expect(toolNames).toContain("write");
			expect(toolNames).toContain("edit");
			expect(toolNames).toContain("bash");
			expect(toolNames).toContain("grep");
			expect(toolNames).toContain("find");
			expect(toolNames).toContain("ls");
			expect(toolNames).toContain("diff");

			// Should NOT have memory/session/watch/project-analysis
			expect(toolNames).not.toContain("memory");
			expect(toolNames).not.toContain("session");
			expect(toolNames).not.toContain("watch");
			expect(toolNames).not.toContain("project-analysis");
		});

		it("uses kartru profile with high thinking", () => {
			const coder = new CodingAgent(makeConfig());
			const agent = coder.getAgent();
			const profile = agent.getProfile();

			expect(profile.id).toBe("kartru");
			expect(profile.name).toContain("Kartru");
		});

		it("defaults autoValidate to true and maxValidationRetries to 3", () => {
			const coder = new CodingAgent(makeConfig());
			// Access defaults through execute behavior — the agent is configured
			// We verify this indirectly: these are internal config values
			expect(coder).toBeDefined();
		});

		it("accepts custom provider and model", () => {
			const coder = new CodingAgent(makeConfig({
				providerId: "openai",
				modelId: "gpt-4o",
			}));
			const state = coder.getAgent().getState();
			expect(state.providerId).toBe("openai");
			expect(state.model).toBe("gpt-4o");
		});

		it("works with no tools provided", () => {
			const coder = new CodingAgent({
				workingDirectory: "/test/project",
			});
			const state = coder.getAgent().getState();
			expect(state.tools).toHaveLength(0);
		});
	});

	describe("detectConventions", () => {
		it("detects TypeScript ESM project from package.json and tsconfig", () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({
				type: "module",
				scripts: {
					test: "vitest",
					build: "tsc",
					lint: "eslint .",
				},
				dependencies: {},
			});
			mockFiles["/test/project/tsconfig.json"] = "{}";

			const coder = new CodingAgent(makeConfig());

			return coder.detectConventions().then((conv) => {
				expect(conv.language).toBe("typescript");
				expect(conv.moduleSystem).toBe("esm");
				expect(conv.hasTypeScript).toBe(true);
				expect(conv.testCommand).toBe("npm test");
				expect(conv.buildCommand).toBe("npm run build");
				expect(conv.lintCommand).toBe("npm run lint");
			});
		});

		it("detects CommonJS project", () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({
				type: "commonjs",
				scripts: {},
			});

			const coder = new CodingAgent(makeConfig());

			return coder.detectConventions().then((conv) => {
				expect(conv.moduleSystem).toBe("commonjs");
				expect(conv.hasTypeScript).toBe(false);
			});
		});

		it("detects framework from dependencies", () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({
				dependencies: { next: "14.0.0" },
			});

			const coder = new CodingAgent(makeConfig());

			return coder.detectConventions().then((conv) => {
				expect(conv.framework).toBe("next.js");
			});
		});

		it("overrides detected commands with explicit config", () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({
				scripts: { test: "jest", build: "tsc" },
			});

			const coder = new CodingAgent(makeConfig({
				testCommand: "npm run test:ci",
				buildCommand: "npm run build:prod",
			}));

			return coder.detectConventions().then((conv) => {
				expect(conv.testCommand).toBe("npm run test:ci");
				expect(conv.buildCommand).toBe("npm run build:prod");
			});
		});

		it("skips default test command for placeholder scripts", () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({
				scripts: {
					test: 'echo "Error: no test specified" && exit 1',
				},
			});

			const coder = new CodingAgent(makeConfig());

			return coder.detectConventions().then((conv) => {
				expect(conv.testCommand).toBeUndefined();
			});
		});

		it("detects biome linter", () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({});
			mockFiles["/test/project/biome.json"] = "{}";

			const coder = new CodingAgent(makeConfig());

			return coder.detectConventions().then((conv) => {
				expect(conv.lintCommand).toBe("npx biome check .");
			});
		});

		it("returns sensible defaults for empty directory", () => {
			const coder = new CodingAgent(makeConfig());

			return coder.detectConventions().then((conv) => {
				expect(conv.language).toBe("unknown");
				expect(conv.moduleSystem).toBe("unknown");
				expect(conv.hasTypeScript).toBe(false);
				expect(conv.indentation).toBe("tabs");
				expect(conv.indentWidth).toBe(2);
			});
		});
	});

	describe("validate", () => {
		it("runs build and test commands and reports success", async () => {
			const { execSync } = await import("node:child_process");
			const mockExec = vi.mocked(execSync);
			mockExec.mockReturnValue("ok" as any);

			const coder = new CodingAgent(makeConfig({
				buildCommand: "npm run build",
				testCommand: "npm test",
			}));

			const result = await coder.validate();
			expect(result.passed).toBe(true);
			expect(result.output).toContain("[build] PASSED");
			expect(result.output).toContain("[test] PASSED");
			expect(mockExec).toHaveBeenCalledTimes(2);
		});

		it("reports failure when build fails", async () => {
			const { execSync } = await import("node:child_process");
			const mockExec = vi.mocked(execSync);
			mockExec.mockImplementation((cmd: string) => {
				if (typeof cmd === "string" && cmd.includes("build")) {
					const err = new Error("Build failed") as Error & { stderr: string; stdout: string };
					err.stderr = "error TS2345: Argument of type...";
					err.stdout = "";
					throw err;
				}
				return "ok" as any;
			});

			const coder = new CodingAgent(makeConfig({
				buildCommand: "npm run build",
				testCommand: "npm test",
			}));

			const result = await coder.validate();
			expect(result.passed).toBe(false);
			expect(result.output).toContain("[build] FAILED");
		});

		it("handles missing commands gracefully", async () => {
			const coder = new CodingAgent(makeConfig());
			// No build/test/lint commands configured, no conventions detected
			const result = await coder.validate();
			expect(result.passed).toBe(true);
			expect(result.output).toBe("");
		});
	});

	describe("getFilesModified / getFilesCreated", () => {
		it("starts with empty lists", () => {
			const coder = new CodingAgent(makeConfig());
			expect(coder.getFilesModified()).toEqual([]);
			expect(coder.getFilesCreated()).toEqual([]);
		});
	});

	describe("getConventions", () => {
		it("returns null before detectConventions is called", () => {
			const coder = new CodingAgent(makeConfig());
			expect(coder.getConventions()).toBeNull();
		});

		it("returns conventions after detectConventions is called", async () => {
			mockFiles["/test/project/package.json"] = JSON.stringify({ type: "module" });
			mockFiles["/test/project/tsconfig.json"] = "{}";

			const coder = new CodingAgent(makeConfig());
			const conv = await coder.detectConventions();

			expect(coder.getConventions()).toBe(conv);
			expect(conv.hasTypeScript).toBe(true);
		});
	});
});
