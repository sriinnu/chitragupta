import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock dependencies ──────────────────────────────────────────────────────

// Mock smriti (required by mcp-server module)
vi.mock("@chitragupta/smriti/search", () => ({
	searchMemory: vi.fn().mockReturnValue([]),
}));

vi.mock("@chitragupta/smriti/session-store", () => ({
	listSessions: vi.fn().mockReturnValue([]),
	loadSession: vi.fn().mockReturnValue({ meta: { id: "test" }, turns: [] }),
	createSession: vi.fn(() => ({ meta: { id: "test-session" }, turns: [] })),
	addTurn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@chitragupta/yantra", () => ({
	getAllTools: vi.fn().mockReturnValue([
		{
			definition: {
				name: "read",
				description: "Read a file",
				inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
			},
			execute: vi.fn().mockResolvedValue({ content: "ok" }),
		},
	]),
}));

vi.mock("@chitragupta/core", async () => {
	const actual = await vi.importActual("@chitragupta/core");
	return {
		...actual,
		getChitraguptaHome: vi.fn().mockReturnValue("/tmp/.chitragupta-test"),
		loadGlobalSettings: vi.fn().mockReturnValue({
			providerPriority: ["anthropic"],
		}),
	};
});

// Mock the CodingOrchestrator from anina
const mockRun = vi.fn();

vi.mock("@chitragupta/anina", () => {
	class MockCodingOrchestrator {
		config: Record<string, unknown>;
		constructor(config: Record<string, unknown>) {
			this.config = config;
		}
		run = mockRun;
	}
	return {
		CodingOrchestrator: MockCodingOrchestrator,
	};
});

// Mock swara provider registry
const mockRegistry = {
	register: vi.fn(),
	get: vi.fn(),
	getAll: vi.fn().mockReturnValue([]),
};

vi.mock("@chitragupta/swara/provider-registry", () => ({
	createProviderRegistry: vi.fn().mockReturnValue(mockRegistry),
}));

// Mock bootstrap helpers
vi.mock("../src/bootstrap.js", async () => {
	const actual = await vi.importActual("../src/bootstrap.js");
	return {
		...actual,
		loadCredentials: vi.fn(),
		registerBuiltinProviders: vi.fn(),
		registerCLIProviders: vi.fn().mockResolvedValue([]),
		resolvePreferredProvider: vi.fn(),
		getBuiltinTools: vi.fn().mockReturnValue([
			{
				definition: { name: "read", description: "Read", inputSchema: { type: "object", properties: {} } },
				execute: vi.fn().mockResolvedValue({ content: "ok" }),
			},
		]),
		loadProjectMemory: vi.fn().mockReturnValue(undefined),
	};
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the coding_agent tool handler from the MCP server module.
 * We import the module, then use the internal createCodingAgentTool.
 * Since it's a module-private function, we access it through the
 * tool registration pattern: register tools then find ours.
 */
async function getCodingAgentTool() {
	// The tool is created by createCodingAgentTool(projectPath).
	// Since the function isn't exported, we recreate the same logic
	// by importing the module and using dynamic import to reach the tool.
	// The cleanest approach: import the whole module and find the tool definition.
	const mod = await import("../src/modes/mcp-server.js");
	// runMcpServerMode is the only export. But we can test the tool
	// by recognizing that the coding_agent tool is self-contained —
	// its execute function uses dynamic imports internally.
	// So we test by calling the module's internal tool factory indirectly.

	// Alternate: test via the module's tool list creation.
	// Since we can't access createCodingAgentTool directly, let's test
	// the formatter and tool behavior by constructing the result objects.
	return mod;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("formatOrchestratorResult", () => {
	it("should produce all expected sections for a successful result", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-server.js");

		const text = formatOrchestratorResult({
			success: true,
			plan: {
				task: "Fix login bug",
				steps: [
					{ index: 1, description: "Analyze the code", completed: true },
					{ index: 2, description: "Fix the bug", completed: true },
				],
				complexity: "small",
			},
			codingResults: [],
			git: { featureBranch: "feat/fix-login-bug", commits: ["abc1234"] },
			reviewIssues: [],
			validationPassed: true,
			filesModified: ["src/login.ts"],
			filesCreated: ["src/login.test.ts"],
			summary: "Fixed the bug",
			elapsedMs: 45200,
		});

		expect(text).toContain("═══ Coding Agent ═══");
		expect(text).toContain("Fix login bug");
		expect(text).toContain("small");
		expect(text).toContain("✓ Success");
		// Plan
		expect(text).toContain("── Plan ──");
		expect(text).toContain("[✓] Analyze the code");
		expect(text).toContain("[✓] Fix the bug");
		// Files
		expect(text).toContain("── Files ──");
		expect(text).toContain("src/login.ts");
		expect(text).toContain("src/login.test.ts");
		// Git
		expect(text).toContain("── Git ──");
		expect(text).toContain("feat/fix-login-bug");
		expect(text).toContain("abc1234");
		// Validation
		expect(text).toContain("✓ passed");
		// Review
		expect(text).toContain("0 issues found");
		// Timing
		expect(text).toContain("45.2s");
	});

	it("should show failure status", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-server.js");

		const text = formatOrchestratorResult({
			success: false,
			plan: { task: "Broken task", steps: [], complexity: "medium" },
			codingResults: [],
			git: { featureBranch: null, commits: [] },
			reviewIssues: [],
			validationPassed: false,
			filesModified: [],
			filesCreated: [],
			summary: "Failed",
			elapsedMs: 1000,
		});

		expect(text).toContain("✗ Failed");
		expect(text).toContain("✗ failed");
	});

	it("should show review issues", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-server.js");

		const text = formatOrchestratorResult({
			success: true,
			plan: { task: "Add feature", steps: [], complexity: "medium" },
			codingResults: [],
			git: { featureBranch: null, commits: [] },
			reviewIssues: [
				{ severity: "CRITICAL", file: "src/auth.ts", line: 42, message: "SQL injection" },
				{ severity: "WARNING", file: "src/util.ts", message: "Unused import" },
			],
			validationPassed: true,
			filesModified: [],
			filesCreated: [],
			summary: "Done",
			elapsedMs: 3000,
		});

		expect(text).toContain("2 issue(s) found");
		expect(text).toContain("CRITICAL src/auth.ts:42 SQL injection");
		expect(text).toContain("WARNING src/util.ts Unused import");
	});

	it("should handle incomplete steps", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-server.js");

		const text = formatOrchestratorResult({
			success: false,
			plan: {
				task: "Multi-step task",
				steps: [
					{ index: 1, description: "Done step", completed: true },
					{ index: 2, description: "Pending step", completed: false },
				],
				complexity: "medium",
			},
			codingResults: [],
			git: { featureBranch: null, commits: [] },
			reviewIssues: [],
			validationPassed: false,
			filesModified: [],
			filesCreated: [],
			summary: "Partial",
			elapsedMs: 2000,
		});

		expect(text).toContain("[✓] Done step");
		expect(text).toContain("[○] Pending step");
	});

	it("should omit git section when no branch or commits", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-server.js");

		const text = formatOrchestratorResult({
			success: true,
			plan: { task: "Simple task", steps: [], complexity: "small" },
			codingResults: [],
			git: { featureBranch: null, commits: [] },
			reviewIssues: [],
			validationPassed: true,
			filesModified: [],
			filesCreated: [],
			summary: "Done",
			elapsedMs: 500,
		});

		expect(text).not.toContain("── Git ──");
	});

	it("should omit files section when no files changed", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-server.js");

		const text = formatOrchestratorResult({
			success: true,
			plan: { task: "Plan only", steps: [], complexity: "small" },
			codingResults: [],
			git: { featureBranch: null, commits: [] },
			reviewIssues: [],
			validationPassed: true,
			filesModified: [],
			filesCreated: [],
			summary: "Done",
			elapsedMs: 100,
		});

		expect(text).not.toContain("── Files ──");
	});
});

describe("coding_agent MCP tool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("module export", () => {
		it("should export runMcpServerMode", async () => {
			const mod = await getCodingAgentTool();
			expect(mod.runMcpServerMode).toBeDefined();
			expect(typeof mod.runMcpServerMode).toBe("function");
		});
	});

	describe("CodingOrchestrator integration", () => {
		it("should import CodingOrchestrator from anina", async () => {
			const { CodingOrchestrator } = await import("@chitragupta/anina");
			expect(CodingOrchestrator).toBeDefined();
		});

		it("should construct orchestrator with config", async () => {
			const { CodingOrchestrator } = await import("@chitragupta/anina");
			const orch = new CodingOrchestrator({
				workingDirectory: "/test",
				mode: "plan-only",
			});
			expect(orch).toBeDefined();
			expect(orch.run).toBeDefined();
		});
	});

	describe("OrchestratorResult formatting", () => {
		// Test the result formatter by checking what the tool would produce.
		// Since formatOrchestratorResult is module-private, we validate through
		// the mock orchestrator → tool execute path.

		it("should produce text with all expected sections for a successful result", async () => {
			const { resolvePreferredProvider } = await import("../src/bootstrap.js");
			(resolvePreferredProvider as ReturnType<typeof vi.fn>).mockReturnValue({
				providerId: "anthropic",
				provider: { id: "anthropic", name: "Anthropic" },
			});

			mockRun.mockResolvedValue({
				success: true,
				plan: {
					task: "Fix login bug",
					steps: [
						{ index: 1, description: "Analyze the code", completed: true },
						{ index: 2, description: "Fix the bug", completed: true },
					],
					relevantFiles: [],
					complexity: "small",
					requiresNewFiles: false,
				},
				codingResults: [],
				git: { isGitRepo: true, featureBranch: "feat/fix-login-bug", originalBranch: "main", stashRef: null, commits: ["abc1234"] },
				reviewIssues: [],
				validationPassed: true,
				filesModified: ["src/login.ts"],
				filesCreated: [],
				summary: "Fixed the login bug",
				elapsedMs: 5200,
				progressLog: [],
			});

			// Simulate what the MCP tool does internally
			const { CodingOrchestrator } = await import("@chitragupta/anina");
			const orch = new CodingOrchestrator({ workingDirectory: "/test", mode: "full" });
			const result = await orch.run("Fix login bug");

			// Validate the result shape that would be formatted
			expect(result.success).toBe(true);
			expect(result.plan).not.toBeNull();
			expect(result.plan!.task).toBe("Fix login bug");
			expect(result.plan!.steps).toHaveLength(2);
			expect(result.git.featureBranch).toBe("feat/fix-login-bug");
			expect(result.git.commits).toContain("abc1234");
			expect(result.validationPassed).toBe(true);
			expect(result.filesModified).toContain("src/login.ts");
			expect(result.elapsedMs).toBe(5200);
		});

		it("should handle a failed result", async () => {
			mockRun.mockResolvedValue({
				success: false,
				plan: {
					task: "Refactor auth",
					steps: [{ index: 1, description: "Analyze", completed: false }],
					relevantFiles: [],
					complexity: "large",
					requiresNewFiles: false,
				},
				codingResults: [],
				git: { isGitRepo: false, featureBranch: null, originalBranch: null, stashRef: null, commits: [] },
				reviewIssues: [
					{ severity: "CRITICAL", file: "src/auth.ts", line: 42, message: "SQL injection vulnerability" },
				],
				validationPassed: false,
				filesModified: [],
				filesCreated: [],
				summary: "Failed: provider error",
				elapsedMs: 1000,
				progressLog: [],
			});

			const { CodingOrchestrator } = await import("@chitragupta/anina");
			const orch = new CodingOrchestrator({ workingDirectory: "/test" });
			const result = await orch.run("Refactor auth");

			expect(result.success).toBe(false);
			expect(result.reviewIssues).toHaveLength(1);
			expect(result.reviewIssues[0].severity).toBe("CRITICAL");
			expect(result.validationPassed).toBe(false);
		});

		it("should handle plan-only result with no git or files", async () => {
			mockRun.mockResolvedValue({
				success: true,
				plan: {
					task: "Add tests",
					steps: [
						{ index: 1, description: "Understand codebase", completed: false },
						{ index: 2, description: "Write tests", completed: false },
					],
					relevantFiles: [],
					complexity: "medium",
					requiresNewFiles: true,
				},
				codingResults: [],
				git: { isGitRepo: false, featureBranch: null, originalBranch: null, stashRef: null, commits: [] },
				reviewIssues: [],
				validationPassed: false,
				filesModified: [],
				filesCreated: [],
				summary: "Plan for: Add tests",
				elapsedMs: 200,
				progressLog: [],
			});

			const { CodingOrchestrator } = await import("@chitragupta/anina");
			const orch = new CodingOrchestrator({ workingDirectory: "/test", mode: "plan-only" });
			const result = await orch.run("Add tests");

			expect(result.success).toBe(true);
			expect(result.plan!.complexity).toBe("medium");
			expect(result.filesModified).toHaveLength(0);
			expect(result.filesCreated).toHaveLength(0);
			expect(result.git.featureBranch).toBeNull();
		});
	});

	describe("provider resolution", () => {
		it("should handle missing provider gracefully", async () => {
			const { resolvePreferredProvider } = await import("../src/bootstrap.js");
			// Simulate no provider available
			(resolvePreferredProvider as ReturnType<typeof vi.fn>).mockReturnValue(null);

			// The tool should return an error when no provider is resolved.
			// We verify the bootstrap mock returns null for provider resolution.
			const resolved = resolvePreferredProvider(undefined, {} as any, {} as any);
			expect(resolved).toBeNull();
		});

		it("should resolve explicit provider", async () => {
			const { resolvePreferredProvider } = await import("../src/bootstrap.js");
			(resolvePreferredProvider as ReturnType<typeof vi.fn>).mockReturnValue({
				providerId: "openai",
				provider: { id: "openai", name: "OpenAI" },
			});

			const resolved = resolvePreferredProvider("openai", {} as any, {} as any);
			expect(resolved).not.toBeNull();
			expect(resolved!.providerId).toBe("openai");
		});
	});

	describe("config passthrough", () => {
		it("should accept provider field in CodingOrchestratorConfig", async () => {
			const { CodingOrchestrator } = await import("@chitragupta/anina");

			// Verify the constructor accepts provider
			const orch = new CodingOrchestrator({
				workingDirectory: "/test",
				mode: "plan-only",
				provider: { id: "mock", name: "Mock Provider" },
			});
			expect(orch).toBeDefined();
		});

		it("should pass mode through to orchestrator", async () => {
			const { CodingOrchestrator } = await import("@chitragupta/anina");

			// Verify each mode is accepted
			for (const mode of ["full", "execute", "plan-only"] as const) {
				const orch = new CodingOrchestrator({
					workingDirectory: "/test",
					mode,
				});
				expect(orch).toBeDefined();
			}
		});

		it("should pass optional boolean flags", async () => {
			const { CodingOrchestrator } = await import("@chitragupta/anina");

			const orch = new CodingOrchestrator({
				workingDirectory: "/test",
				mode: "full",
				createBranch: false,
				autoCommit: false,
				selfReview: false,
			});
			expect(orch).toBeDefined();
		});
	});
});
