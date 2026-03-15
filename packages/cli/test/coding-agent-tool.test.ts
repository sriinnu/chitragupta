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
			expect(result.taskId).toMatch(/^task-/);
			expect(result.laneId).toMatch(/^lane-/);
			expect(result.finalReport).toEqual(expect.objectContaining({
				taskId: result.taskId,
				laneId: result.laneId,
				failureKind: "executor-unavailable",
			}));
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
			expect(result.taskId).toMatch(/^task-/);
			expect(result.laneId).toMatch(/^lane-/);
			expect(result.finalReport).toEqual(expect.objectContaining({
				taskId: result.taskId,
				laneId: result.laneId,
				status: "completed",
			}));
		});

		it("should preserve caller-owned task and lane identity", async () => {
			mockExecFile.mockImplementation(
				(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
					if (args[0] === "codex") cb(null);
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

			const resultPromise = routeCodingTask({
				task: "keep identity",
				cwd: "/tmp/project",
				taskId: "task-owned-1",
				laneId: "lane-owned-1",
			});

			await new Promise((r) => setTimeout(r, 10));

			const closeCb = mockProc.on.mock.calls.find(
				(c: unknown[]) => c[0] === "close",
			);
			if (closeCb) {
				closeCb[1](0);
			}

			const result = await resultPromise;
			expect(result.taskId).toBe("task-owned-1");
			expect(result.laneId).toBe("lane-owned-1");
			expect(result.finalReport).toEqual(expect.objectContaining({
				taskId: "task-owned-1",
				laneId: "lane-owned-1",
			}));
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
			const events: Array<{ taskId: string; laneId: string; type: string; data: string }> = [];
			const resultPromise = routeCodingTask({
				task: "test task",
				cwd: "/tmp",
				onOutput: (chunk) => chunks.push(chunk),
				onProgress: (event) => events.push(event),
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
			expect(events).toEqual([
				expect.objectContaining({
					taskId: expect.stringMatching(/^task-/),
					laneId: expect.stringMatching(/^lane-/),
					type: "progress",
					data: "chunk1",
				}),
				expect.objectContaining({
					taskId: expect.stringMatching(/^task-/),
					laneId: expect.stringMatching(/^lane-/),
					type: "progress",
					data: "chunk2",
				}),
			]);
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
		expect(tool.definition.description).toContain("coding");
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

	it("preserves task and lane identity in cli mode", async () => {
		mockExecFile.mockImplementation(
			(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
				if (args[0] === "codex") cb(null);
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

		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");
		const resultPromise = tool.execute({
			task: "fix the flaky cli path",
			mode: "cli",
			taskId: "task-cli-1",
			laneId: "lane-cli-1",
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		const stdoutCb = mockStdout.on.mock.calls.find((call: unknown[]) => call[0] === "data");
		if (stdoutCb) {
			stdoutCb[1](Buffer.from("CLI completed\n"));
		}
		const closeCb = mockProc.on.mock.calls.find((call: unknown[]) => call[0] === "close");
		if (closeCb) {
			closeCb[1](0);
		}

		const result = await resultPromise;
		expect(result.isError).toBe(false);
		expect(result._metadata).toEqual(expect.objectContaining({
			mode: "cli",
			execution: {
				task: { id: "task-cli-1" },
				lane: { id: "lane-cli-1" },
			},
			taskId: "task-cli-1",
			laneId: "lane-cli-1",
			finalReport: expect.objectContaining({
				execution: {
					task: { id: "task-cli-1" },
					lane: { id: "lane-cli-1" },
				},
				taskId: "task-cli-1",
				laneId: "lane-cli-1",
				status: "completed",
			}),
			artifacts: [],
		}));
	});

	it("preserves an explicit execution object in cli mode", async () => {
		mockExecFile.mockImplementation(
			(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
				if (args[0] === "codex") cb(null);
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

		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");
		const resultPromise = tool.execute({
			task: "fix the explicit execution path",
			mode: "cli",
			execution: {
				task: { id: "task-cli-2" },
				lane: { id: "lane-cli-2" },
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		const closeCb = mockProc.on.mock.calls.find((call: unknown[]) => call[0] === "close");
		if (closeCb) {
			closeCb[1](0);
		}

		const result = await resultPromise;
		expect(result._metadata).toEqual(expect.objectContaining({
			execution: {
				task: { id: "task-cli-2" },
				lane: { id: "lane-cli-2" },
			},
			taskId: "task-cli-2",
			laneId: "lane-cli-2",
		}));
	});

	it("preserves typed execution metadata when cli mode throws before producing a result", async () => {
		mockExecFile.mockImplementation(
			(_cmd: string, args: string[], cb: (err: Error | null) => void) => {
				if (args[0] === "codex") cb(null);
				else cb(new Error("not found"));
			},
		);
		mockSpawn.mockImplementation(() => {
			throw new Error("spawn blew up");
		});

		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");
		const result = await tool.execute({
			task: "fail before cli result",
			mode: "cli",
			taskId: "task-cli-error-1",
			laneId: "lane-cli-error-1",
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]).toEqual(expect.objectContaining({
			type: "text",
			text: expect.stringContaining("coding_agent failed: spawn blew up"),
		}));
		expect(result._metadata).toEqual(expect.objectContaining({
			mode: "cli",
			execution: {
				task: { id: "task-cli-error-1" },
				lane: { id: "lane-cli-error-1" },
			},
			taskId: "task-cli-error-1",
			laneId: "lane-cli-error-1",
			finalReport: expect.objectContaining({
				execution: {
					task: { id: "task-cli-error-1" },
					lane: { id: "lane-cli-error-1" },
				},
				taskId: "task-cli-error-1",
				laneId: "lane-cli-error-1",
				status: "failed",
				failureKind: "runtime-failure",
			}),
			artifacts: [],
		}));
	});
});

describe("owned fix regressions", () => {
	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("../src/bootstrap.js");
		vi.doUnmock("../src/main-serve-helpers.js");
		vi.doUnmock("../src/mesh-bootstrap.js");
		vi.doUnmock("../src/modes/coding-router.js");
		vi.doUnmock("../src/modes/lucy-bridge.js");
		vi.doUnmock("../src/modes/mcp-subsystems.js");
		vi.doUnmock("@chitragupta/anina");
	});

	it("records skill gaps through the Akasha leave API", async () => {
		const { wireSkillGapRecorder } = await import("../src/nervous-system-wiring.js");
		const leave = vi.fn();
		const recordGap = vi.fn();

		const record = wireSkillGapRecorder({ leave }, { recordGap });
		record("missing-tool");

		expect(leave).toHaveBeenCalledWith(
			"skill-gap-recorder",
			"warning",
			"skill-gap",
			"Tool not found or failed: missing-tool",
			{ toolName: "missing-tool" },
		);
		expect(recordGap).toHaveBeenCalledWith("missing-tool");
	});

	it("records Buddhi decisions from the actual tool:done payload shape", async () => {
		const { wireBuddhiRecorder } = await import("../src/nervous-system-wiring.js");
		const recordDecision = vi.fn();
		const handler = wireBuddhiRecorder(
			{ recordDecision },
			{ kind: "db" },
			"/tmp/project",
			() => "serve-session-123",
		);

		handler?.("tool:done", {
			name: "coding_agent",
			id: "tool-1",
			result: { isError: false },
		});

		expect(recordDecision).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "serve-session-123",
				category: "tool-selection",
				description: "Used coding_agent",
				confidence: 0.8,
			}),
			{ kind: "db" },
		);
	});

	it("touches Nidra and re-registers the same logical serve session on every prompt", async () => {
		vi.resetModules();
		vi.doMock("@chitragupta/anina", () => ({
			Agent: class {
				private config: Record<string, unknown>;
				private provider: unknown;
				private messages: unknown[] = [];
				constructor(config: Record<string, unknown> = {}) {
					this.config = config;
				}
				getConfig() {
					return this.config;
				}
				getProvider() {
					return this.provider ?? { id: "provider" };
				}
				setProvider(provider: unknown) {
					this.provider = provider;
				}
				setOnEvent() {}
				abort() {}
				clearMessages() {
					this.messages = [];
				}
				pushMessage(message: unknown) {
					this.messages.push(message);
				}
				getModel() {
					return "test-model";
				}
				async prompt(message: unknown) {
					return {
						content: [{ type: "text", text: "ok" }],
					};
				}
			},
			MemoryBridge: class {
				constructor(public config: Record<string, unknown>) {
					this.config = config;
				}
				async loadMemoryContext() {
					return "";
				}
			},
		}));
		vi.doMock("../src/bootstrap.js", () => ({
			resolvePreferredProvider: vi.fn(),
		}));
		vi.doMock("../src/main-serve-helpers.js", () => ({
			createServerAgent: vi.fn(),
			provisionTlsCerts: vi.fn(),
			wireServePhaseModules: vi.fn(),
		}));
		vi.doMock("../src/mesh-bootstrap.js", () => ({
			bootstrapMeshNetwork: vi.fn(),
			buildMeshApiHandlers: vi.fn().mockReturnValue({}),
			resolveMeshConfig: vi.fn(),
		}));
		vi.doMock("../src/nervous-system-wiring.js", async () => {
			const actual = await vi.importActual("../src/nervous-system-wiring.js");
			return {
				...actual,
				applyLucyLiveGuidance: vi.fn(async (message: string) => message),
				createServeSessionScope: vi.fn(() => ({
					runWithSession: (_sessionId: string, fn: () => Promise<unknown>) => fn(),
					getSessionId: () => null,
				})),
			};
		});
		vi.doMock("../src/modes/daemon-bridge.js", () => ({
			openSession: vi.fn().mockResolvedValue({
				created: true,
				session: { meta: { id: "serve-session-1" }, turns: [] },
			}),
			showSession: vi.fn().mockResolvedValue({
				meta: { id: "serve-session-1" },
				turns: [],
			}),
			addTurn: vi.fn().mockResolvedValue(undefined),
		}));

		const { buildServerHandlers } = await import("../src/main-serve-mode.js");
		const touch = vi.fn();
		const notifySession = vi.fn();
		const prompt = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "ok" }],
		});

		const handlers = buildServerHandlers({
			serverAgent: {
				prompt,
				getConfig: () => ({ profile: { id: "chitragupta" }, systemPrompt: "base prompt" }),
				getProvider: () => ({ id: "provider" }),
				getModel: () => "test-model",
			},
			serverSession: null,
			serveSessionScope: {
				runWithSession: (_sessionId: string, fn: () => Promise<unknown>) => fn(),
				getSessionId: () => null,
			},
			registry: { getAll: () => [] } as { getAll(): Array<{ id: string; name: string }> },
			projectPath: "/tmp/project",
			modules: {
				vasanaEngine: undefined,
				vidhiEngine: undefined,
				servNidraDaemon: { touch, notifySession },
				servTriguna: undefined,
				servRtaEngine: undefined,
				servBuddhi: undefined,
				servDatabase: undefined,
				servSamiti: undefined,
				servSabhaEngine: undefined,
				servLokapala: undefined,
				servAkasha: undefined,
				servKartavyaEngine: undefined,
				servKalaChakra: undefined,
				servVidyaOrchestrator: undefined,
			},
			pairingEngine: {
				generateChallenge: vi.fn(),
				getTerminalDisplay: vi.fn().mockReturnValue(""),
			},
			budgetTracker: {},
			meshActorSystem: undefined,
			getMeshBootstrapResult: () => undefined,
		});

		expect(await handlers.prompt?.("first")).toBe("ok");
		expect(await handlers.prompt?.("second")).toBe("ok");
		expect(touch).toHaveBeenCalledTimes(2);
		expect(notifySession).toHaveBeenCalledTimes(2);
		expect(notifySession.mock.calls[0][0]).toMatch(/^serve-chat:/);
		expect(notifySession.mock.calls[1][0]).toBe(notifySession.mock.calls[0][0]);
	});

	it("prefers the live agent triguna over the stale serve placeholder", async () => {
		vi.resetModules();
		vi.doMock("@chitragupta/anina", () => ({
			Agent: class {
				private messages: unknown[] = [];
				constructor(private config: Record<string, unknown> = {}) {}
				getConfig() {
					return this.config;
				}
				getProvider() {
					return { id: "provider" };
				}
				setProvider() {}
				setOnEvent() {}
				abort() {}
				clearMessages() {
					this.messages = [];
				}
				pushMessage(message: unknown) {
					this.messages.push(message);
				}
				getModel() {
					return "test-model";
				}
				async prompt(message: unknown) {
					return {
						content: [{ type: "text", text: "ok" }],
					};
				}
			},
			MemoryBridge: class {
				constructor(public config: Record<string, unknown>) {
					this.config = config;
				}
				async loadMemoryContext() {
					return "";
				}
			},
		}));
		vi.doMock("../src/bootstrap.js", () => ({
			resolvePreferredProvider: vi.fn(),
		}));
		vi.doMock("../src/main-serve-helpers.js", () => ({
			createServerAgent: vi.fn(),
			provisionTlsCerts: vi.fn(),
			wireServePhaseModules: vi.fn(),
		}));
		vi.doMock("../src/mesh-bootstrap.js", () => ({
			bootstrapMeshNetwork: vi.fn(),
			buildMeshApiHandlers: vi.fn().mockReturnValue({}),
			resolveMeshConfig: vi.fn(),
		}));
		vi.doMock("../src/nervous-system-wiring.js", async () => {
			const actual = await vi.importActual("../src/nervous-system-wiring.js");
			return {
				...actual,
				applyLucyLiveGuidance: vi.fn(async (message: string) => message),
				createServeSessionScope: vi.fn(() => ({
					runWithSession: (_sessionId: string, fn: () => Promise<unknown>) => fn(),
					getSessionId: () => null,
				})),
			};
		});
		vi.doMock("../src/modes/daemon-bridge.js", () => ({
			openSession: vi.fn(),
			showSession: vi.fn(),
			addTurn: vi.fn(),
		}));

		const liveTriguna = { getState: vi.fn().mockReturnValue({ sattva: 0.7, rajas: 0.2, tamas: 0.1 }) };
		const staleTriguna = { getState: vi.fn().mockReturnValue({ sattva: 0.1, rajas: 0.2, tamas: 0.7 }) };
		const { buildServerHandlers } = await import("../src/main-serve-mode.js");
		const handlers = buildServerHandlers({
			serverAgent: {
				getChetana: () => ({ getTriguna: () => liveTriguna }),
			},
			serverSession: null,
			serveSessionScope: {
				runWithSession: (_sessionId: string, fn: () => Promise<unknown>) => fn(),
				getSessionId: () => null,
			},
			registry: { getAll: () => [] } as { getAll(): Array<{ id: string; name: string }> },
			projectPath: "/tmp/project",
			modules: {
				vasanaEngine: undefined,
				vidhiEngine: undefined,
				servNidraDaemon: undefined,
				servTriguna: staleTriguna,
				servRtaEngine: undefined,
				servBuddhi: undefined,
				servDatabase: undefined,
				servSamiti: undefined,
				servSabhaEngine: undefined,
				servLokapala: undefined,
				servAkasha: undefined,
				servKartavyaEngine: undefined,
				servKalaChakra: undefined,
				servVidyaOrchestrator: undefined,
			},
			pairingEngine: {
				generateChallenge: vi.fn(),
				getTerminalDisplay: vi.fn().mockReturnValue(""),
			},
			budgetTracker: {},
			meshActorSystem: undefined,
			getMeshBootstrapResult: () => undefined,
		});

		expect(handlers.getTriguna?.()).toBe(liveTriguna);
	});

		it("does not execute Lucy or CLI routing in plan-only mode", async () => {
			vi.resetModules();
			const routeCodingTaskSpy = vi.fn();
			const detectCodingClisSpy = vi.fn().mockResolvedValue([{ name: "codex" }]);
			const executeLucySpy = vi.fn();

		vi.doMock("../src/modes/coding-router.js", () => ({
			routeCodingTask: routeCodingTaskSpy,
			detectCodingClis: detectCodingClisSpy,
		}));
		vi.doMock("../src/modes/lucy-bridge.js", () => ({
			executeLucy: executeLucySpy,
		}));
		vi.doMock("../src/modes/mcp-subsystems.js", () => ({
			getAkasha: vi.fn().mockResolvedValue({
				query: vi.fn().mockReturnValue([]),
				leave: vi.fn(),
			}),
			getTranscendence: vi.fn().mockResolvedValue({
				fuzzyLookup: vi.fn().mockReturnValue(null),
			}),
			persistAkasha: vi.fn(),
		}));

			const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
			const tool = createCodingAgentTool("/tmp/project");
			const result = await tool.execute({
				task: "fix login bug",
				mode: "plan-only",
				execution: {
					task: { id: "task-plan-1" },
					lane: { id: "lane-plan-1" },
				},
			});

			expect(executeLucySpy).not.toHaveBeenCalled();
			expect(routeCodingTaskSpy).not.toHaveBeenCalled();
			expect(result.isError).toBe(false);
		expect(result.content[0]).toEqual(
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("Plan-only mode: no commands were executed."),
			}),
		);
			expect(result._metadata).toEqual(
				expect.objectContaining({
					mode: "plan-only",
					executed: false,
					execution: {
						task: { id: "task-plan-1" },
						lane: { id: "lane-plan-1" },
					},
					taskId: "task-plan-1",
					laneId: "lane-plan-1",
					artifacts: [],
				}),
			);
		});

	it("uses the real Akasha query and leave signatures in Lucy callbacks", async () => {
		vi.resetModules();
		const query = vi.fn().mockReturnValue([{ content: "Prefer narrow fixes" }]);
		const leave = vi.fn();
		const persistAkasha = vi.fn().mockResolvedValue(undefined);
		const executeLucySpy = vi.fn(async (_task: string, config: {
			queryAkasha?: (task: string) => Promise<string[]>;
			depositAkasha?: (trace: { type: "solution" | "warning"; topics: string[]; content: string }) => Promise<void>;
		}) => {
			await expect(config.queryAkasha?.("login bug")).resolves.toEqual(["Prefer narrow fixes"]);
			await config.depositAkasha?.({
				type: "solution",
				topics: ["auth"],
				content: "Keep auth changes localized",
			});
				return {
					success: true,
					output: "planned",
					filesModified: [],
					execution: {
						task: { id: "task-akasha-1" },
						lane: { id: "lane-akasha-1" },
					},
					taskId: "task-akasha-1",
					laneId: "lane-akasha-1",
					finalReport: {
						execution: {
							task: { id: "task-akasha-1" },
							lane: { id: "lane-akasha-1" },
						},
						taskId: "task-akasha-1",
						laneId: "lane-akasha-1",
						status: "completed" as const,
						summary: "planned",
						toolCalls: [],
						artifacts: [],
						failureKind: null,
					},
					artifacts: [],
					autoFixAttempts: 0,
					durationMs: 12,
					cli: "mock",
				};
		});

		vi.doMock("../src/modes/lucy-bridge.js", () => ({
			executeLucy: executeLucySpy,
		}));
		vi.doMock("../src/modes/coding-router.js", () => ({
			routeCodingTask: vi.fn(),
			detectCodingClis: vi.fn().mockResolvedValue([{ name: "mock" }]),
		}));
		vi.doMock("../src/modes/mcp-subsystems.js", () => ({
			getAkasha: vi.fn().mockResolvedValue({ query, leave }),
			persistAkasha,
			getTranscendence: vi.fn().mockResolvedValue({
				fuzzyLookup: vi.fn().mockReturnValue(null),
			}),
		}));

		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");
		const result = await tool.execute({ task: "fix auth bug" });

		expect(query).toHaveBeenCalledWith("login bug", { limit: 5 });
		expect(leave).toHaveBeenCalledWith(
			"lucy-bridge",
			"solution",
			"auth",
			"Keep auth changes localized",
			{ topics: ["auth"] },
		);
		expect(persistAkasha).toHaveBeenCalledTimes(1);
		expect(result.isError).toBe(false);
	});

		it("passes explicit engine route inputs into Lucy for strict engine-lane execution", async () => {
		vi.resetModules();
			const executeLucySpy = vi.fn(async (_task: string, config: {
				taskId?: string;
				laneId?: string;
				sessionId?: string;
				consumer?: string;
				routeClass?: string;
				capability?: string;
			}) => {
				expect(config.taskId).toBe("task-upstream-1");
				expect(config.laneId).toBe("lane-upstream-1");
				expect(config.sessionId).toBe("sess-123");
				expect(config.consumer).toBe("mcp:test");
				expect(config.routeClass).toBe("coding.review.strict");
				expect(config.capability).toBe("coding.review");
				return {
					success: true,
					output: "strict route",
					filesModified: [],
					execution: {
						task: { id: "task-strict-1" },
						lane: { id: "lane-strict-1" },
					},
					taskId: "task-strict-1",
					laneId: "lane-strict-1",
					finalReport: {
						execution: {
							task: { id: "task-strict-1" },
							lane: { id: "lane-strict-1" },
						},
						taskId: "task-strict-1",
						laneId: "lane-strict-1",
						status: "completed" as const,
					summary: "strict route",
					toolCalls: [],
					artifacts: [],
					failureKind: null,
				},
				artifacts: [],
				autoFixAttempts: 0,
				durationMs: 10,
				cli: "mock",
			};
		});

		vi.doMock("../src/modes/lucy-bridge.js", () => ({
			executeLucy: executeLucySpy,
		}));
		vi.doMock("../src/modes/coding-router.js", () => ({
			routeCodingTask: vi.fn(),
			detectCodingClis: vi.fn().mockResolvedValue([{ name: "mock" }]),
		}));
		vi.doMock("../src/modes/mcp-subsystems.js", () => ({
			getAkasha: vi.fn().mockResolvedValue({
				query: vi.fn().mockReturnValue([]),
				leave: vi.fn(),
			}),
			persistAkasha: vi.fn(),
			getTranscendence: vi.fn().mockResolvedValue({
				fuzzyLookup: vi.fn().mockReturnValue(null),
			}),
		}));

		const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
		const tool = createCodingAgentTool("/tmp/project");
			const result = await tool.execute({
				task: "review auth flow",
				taskId: "task-upstream-1",
				laneId: "lane-upstream-1",
				sessionId: "sess-123",
				consumer: "mcp:test",
				routeClass: "coding.review.strict",
			capability: "coding.review",
		});

			expect(executeLucySpy).toHaveBeenCalledTimes(1);
			expect(result.isError).toBe(false);
			expect(result._metadata).toEqual(expect.objectContaining({
				taskId: "task-strict-1",
				laneId: "lane-strict-1",
				finalReport: expect.objectContaining({
					taskId: "task-strict-1",
					laneId: "lane-strict-1",
				}),
				artifacts: [],
			}));
		});

		it("uses tool-level session and consumer defaults when explicit args omit them", async () => {
			vi.resetModules();
			const executeLucySpy = vi.fn(async (_task: string, config: {
				sessionId?: string;
				consumer?: string;
			}) => {
				expect(config.sessionId).toBe("sess-tool-default");
				expect(config.consumer).toBe("agent:coding_agent");
					return {
						success: true,
						output: "default route",
						filesModified: [],
						execution: {
							task: { id: "task-default-1" },
							lane: { id: "lane-default-1" },
						},
						taskId: "task-default-1",
						laneId: "lane-default-1",
						finalReport: {
							execution: {
								task: { id: "task-default-1" },
								lane: { id: "lane-default-1" },
							},
							taskId: "task-default-1",
							laneId: "lane-default-1",
							status: "completed" as const,
							summary: "default route",
							toolCalls: [],
							artifacts: [],
							failureKind: null,
						},
						artifacts: [],
						autoFixAttempts: 0,
						durationMs: 5,
						cli: "mock",
				};
			});

			vi.doMock("../src/modes/lucy-bridge.js", () => ({
				executeLucy: executeLucySpy,
			}));
			vi.doMock("../src/modes/coding-router.js", () => ({
				routeCodingTask: vi.fn(),
				detectCodingClis: vi.fn().mockResolvedValue([{ name: "mock" }]),
			}));
			vi.doMock("../src/modes/mcp-subsystems.js", () => ({
				getAkasha: vi.fn().mockResolvedValue({
					query: vi.fn().mockReturnValue([]),
					leave: vi.fn(),
				}),
				persistAkasha: vi.fn(),
				getTranscendence: vi.fn().mockResolvedValue({
					fuzzyLookup: vi.fn().mockReturnValue(null),
				}),
			}));

			const { createCodingAgentTool } = await import("../src/modes/mcp-tools-coding.js");
			const tool = createCodingAgentTool("/tmp/project", {
				sessionIdResolver: () => "sess-tool-default",
				consumer: "agent:coding_agent",
			});
			const result = await tool.execute({ task: "patch auth flow" });

			expect(executeLucySpy).toHaveBeenCalledTimes(1);
			expect(result.isError).toBe(false);
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
