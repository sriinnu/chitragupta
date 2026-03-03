import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock child_process for CLI detection ──────────────────────────────────

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

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

// ─── Import the module under test ──────────────────────────────────────────

import {
	commandExists,
	detectCodingClis,
	routeCodingTask,
	resetDetectionCache,
} from "../src/modes/coding-router.js";

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("coding-router", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDetectionCache();
	});

	describe("commandExists", () => {
		it("should return true when 'which' succeeds", async () => {
			mockExecFile.mockImplementation(
				(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
					cb(null);
				},
			);

			const exists = await commandExists("claude");
			expect(exists).toBe(true);
			expect(mockExecFile).toHaveBeenCalledWith(
				"which",
				["claude"],
				expect.any(Function),
			);
		});

		it("should return false when 'which' fails", async () => {
			mockExecFile.mockImplementation(
				(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
					cb(new Error("not found"));
				},
			);

			const exists = await commandExists("nonexistent");
			expect(exists).toBe(false);
		});
	});

	describe("detectCodingClis", () => {
		it("should return available CLIs in priority order", async () => {
			// Mock: claude and aider exist, others don't
			mockExecFile.mockImplementation(
				(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
					const tool = args[0];
					if (tool === "claude" || tool === "aider") {
						cb(null);
					} else {
						cb(new Error("not found"));
					}
				},
			);

			const clis = await detectCodingClis();
			expect(clis.length).toBe(2);
			// claude has higher priority than aider
			expect(clis[0].name).toBe("claude");
			expect(clis[1].name).toBe("aider");
		});

		it("should return empty array when no CLIs are available", async () => {
			mockExecFile.mockImplementation(
				(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
					cb(new Error("not found"));
				},
			);

			const clis = await detectCodingClis();
			expect(clis).toHaveLength(0);
		});

		it("should cache results across calls", async () => {
			mockExecFile.mockImplementation(
				(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
					cb(null);
				},
			);

			const first = await detectCodingClis();
			const second = await detectCodingClis();
			expect(first).toBe(second); // Same reference (cached)
		});
	});

	describe("routeCodingTask", () => {
		it("should return error when no CLI is available", async () => {
			mockExecFile.mockImplementation(
				(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
					cb(new Error("not found"));
				},
			);

			const result = await routeCodingTask({
				task: "fix bug",
				cwd: "/tmp",
			});

			expect(result.cli).toBe("none");
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain("No coding CLI available");
		});

		it("should spawn the highest-priority CLI", async () => {
			// Only codex is available
			mockExecFile.mockImplementation(
				(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
					if (args[0] === "codex") cb(null);
					else cb(new Error("not found"));
				},
			);

			// Mock the spawn call
			const mockStdout = {
				on: vi.fn(),
			};
			const mockStderr = {
				on: vi.fn(),
			};
			const mockProc = {
				stdout: mockStdout,
				stderr: mockStderr,
				on: vi.fn(),
			};

			mockSpawn.mockReturnValue(mockProc);

			// Start the route (it will wait for the process to exit)
			const resultPromise = routeCodingTask({
				task: "fix the bug",
				cwd: "/tmp/project",
			});

			// Wait a tick for the spawn to happen
			await new Promise((r) => setTimeout(r, 10));

			// Verify spawn was called with codex
			expect(mockSpawn).toHaveBeenCalledWith(
				"codex",
				["exec", "--full-auto", "-q", "fix the bug"],
				expect.objectContaining({ cwd: "/tmp/project" }),
			);

			// Simulate stdout output
			const stdoutCb = mockStdout.on.mock.calls.find(
				(c: unknown[]) => c[0] === "data",
			);
			if (stdoutCb) {
				stdoutCb[1](Buffer.from("Task completed successfully\n"));
			}

			// Simulate process close
			const closeCb = mockProc.on.mock.calls.find(
				(c: unknown[]) => c[0] === "close",
			);
			if (closeCb) {
				closeCb[1](0);
			}

			const result = await resultPromise;
			expect(result.cli).toBe("codex");
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("Task completed successfully");
		});

		it("should call onOutput for streaming", async () => {
			// claude is available
			mockExecFile.mockImplementation(
				(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
					if (args[0] === "claude") cb(null);
					else cb(new Error("not found"));
				},
			);

			const mockStdout = { on: vi.fn() };
			const mockStderr = { on: vi.fn() };
			const mockProc = {
				stdout: mockStdout,
				stderr: mockStderr,
				on: vi.fn(),
			};
			mockSpawn.mockReturnValue(mockProc);

			const chunks: string[] = [];
			const resultPromise = routeCodingTask({
				task: "test task",
				cwd: "/tmp",
				onOutput: (chunk) => chunks.push(chunk),
			});

			await new Promise((r) => setTimeout(r, 10));

			// Send data
			const stdoutCb = mockStdout.on.mock.calls.find(
				(c: unknown[]) => c[0] === "data",
			);
			if (stdoutCb) {
				stdoutCb[1](Buffer.from("chunk1"));
				stdoutCb[1](Buffer.from("chunk2"));
			}

			// Close process
			const closeCb = mockProc.on.mock.calls.find(
				(c: unknown[]) => c[0] === "close",
			);
			if (closeCb) closeCb[1](0);

			await resultPromise;
			expect(chunks).toEqual(["chunk1", "chunk2"]);
		});
	});
});

describe("createCodingAgentTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDetectionCache();
	});

	it("should create an MCP tool handler with correct definition", async () => {
		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");

		expect(tool.definition.name).toBe("coding_agent");
		expect(tool.definition.description).toContain("coding CLI");
		expect(tool.definition.inputSchema.required).toContain("task");
	});

	it("should return error when task is empty", async () => {
		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");

		const result = await tool.execute({ task: "" });
		expect(result.isError).toBe(true);
		expect(result.content[0]).toEqual(
			expect.objectContaining({ type: "text", text: expect.stringContaining("task is required") }),
		);
	});

	it("should return error when no CLI is available", async () => {
		mockExecFile.mockImplementation(
			(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
				cb(new Error("not found"));
			},
		);

		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");

		const result = await tool.execute({ task: "fix the bug" });
		expect(result.isError).toBe(true);
		expect(result.content[0]).toEqual(
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("No coding CLI available"),
			}),
		);
	});
});

describe("formatOrchestratorResult", () => {
	it("should be exported from mcp-tools-introspection", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-tools-introspection.js");
		expect(formatOrchestratorResult).toBeDefined();
		expect(typeof formatOrchestratorResult).toBe("function");
	});

	it("should format a successful result", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-tools-introspection.js");

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

		expect(text).toContain("Coding Agent");
		expect(text).toContain("Fix login bug");
		expect(text).toContain("Success");
		expect(text).toContain("src/login.ts");
	});

	it("should show failure status", async () => {
		const { formatOrchestratorResult } = await import("../src/modes/mcp-tools-introspection.js");

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

		expect(text).toContain("Failed");
	});
});
