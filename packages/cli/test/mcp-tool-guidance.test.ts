import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetLucyLiveGuidanceBlock = vi.fn();
const mockEnrichFromVasana = vi.fn();
const mockWireBuddhiRecorder = vi.fn();
const mockCreateDaemonBuddhiProxy = vi.fn();
const mockAllowLocalRuntimeFallback = vi.fn(() => false);
const mockGetVasana = vi.fn();
const mockTrigunaUpdate = vi.fn();
const mockPackLiveContextText = vi.fn();
const mockPackContextViaDaemon = vi.fn();

vi.mock("../src/nervous-system-wiring.js", () => ({
	getLucyLiveGuidanceBlock: mockGetLucyLiveGuidanceBlock,
	enrichFromVasana: mockEnrichFromVasana,
	wireBuddhiRecorder: mockWireBuddhiRecorder,
}));

vi.mock("../src/runtime-daemon-proxies.js", () => ({
	createDaemonBuddhiProxy: mockCreateDaemonBuddhiProxy,
	allowLocalRuntimeFallback: mockAllowLocalRuntimeFallback,
}));

vi.mock("../src/modes/mcp-subsystems.js", () => ({
	getVasana: mockGetVasana,
	getTriguna: vi.fn(async () => ({ update: mockTrigunaUpdate })),
}));

vi.mock("@chitragupta/smriti", () => ({
	packLiveContextText: mockPackLiveContextText,
}));

vi.mock("../src/modes/daemon-bridge-sessions.js", () => ({
	packContextViaDaemon: mockPackContextViaDaemon,
}));

describe("mcp-tool-guidance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAllowLocalRuntimeFallback.mockReturnValue(false);
		mockCreateDaemonBuddhiProxy.mockReturnValue({ recordDecision: vi.fn() });
		mockWireBuddhiRecorder.mockReturnValue(vi.fn());
		mockGetVasana.mockResolvedValue({ kind: "vasana" });
		mockGetLucyLiveGuidanceBlock.mockResolvedValue("[Lucy live guidance]\n- Predicted entity: auth.ts");
		mockEnrichFromVasana.mockReturnValue("## Behavioral Tendencies (Vasana)\n- Prefer conservative rollout.");
		mockPackLiveContextText.mockResolvedValue(null);
		mockPackContextViaDaemon.mockResolvedValue({ packed: false });
	});

	it("prepends nervous-system context to guided MCP tools", async () => {
		const { wrapMcpToolWithNervousSystem } = await import("../src/modes/mcp-tool-guidance.js");
		const handler = wrapMcpToolWithNervousSystem({
			definition: {
				name: "bash",
				description: "Run a shell command",
				inputSchema: { type: "object" },
			},
			execute: vi.fn(async () => ({
				content: [{ type: "text", text: "tool output" }],
			})),
		}, {
			projectPath: "/tmp/project",
			sessionIdResolver: () => "sess-1",
		});

		const result = await handler.execute({ command: "git status" });
		expect(result.content[0]).toEqual(expect.objectContaining({
			type: "text",
			text: expect.stringContaining("[Nervous system context for bash]"),
		}));
		expect(result.content[0]).toEqual(expect.objectContaining({
			text: expect.stringContaining("[Lucy live guidance]"),
		}));
		expect(result.content[0]).toEqual(expect.objectContaining({
			text: expect.stringContaining("Behavioral Tendencies"),
		}));
		expect(result.content[1]).toEqual({ type: "text", text: "tool output" });
	});

	it("does not inject nervous-system text into bookkeeping tools", async () => {
		const { wrapMcpToolWithNervousSystem } = await import("../src/modes/mcp-tool-guidance.js");
		const handler = wrapMcpToolWithNervousSystem({
			definition: {
				name: "chitragupta_session_list",
				description: "List sessions",
				inputSchema: { type: "object" },
			},
			execute: vi.fn(async () => ({
				content: [{ type: "text", text: "session output" }],
			})),
		}, {
			projectPath: "/tmp/project",
			sessionIdResolver: () => "sess-1",
		});

		const result = await handler.execute({});
		expect(result.content).toEqual([{ type: "text", text: "session output" }]);
	});

	it("creates a Buddhi recorder through the daemon proxy", async () => {
		const { createMcpBuddhiRecorder } = await import("../src/modes/mcp-tool-guidance.js");
		const recorder = createMcpBuddhiRecorder("/tmp/project", () => "sess-1");
		expect(mockCreateDaemonBuddhiProxy).toHaveBeenCalledTimes(1);
		expect(mockWireBuddhiRecorder).toHaveBeenCalledWith(
			expect.any(Object),
			undefined,
			"/tmp/project",
			expect.any(Function),
		);
		expect(typeof recorder).toBe("function");
	});

	it("updates triguna from MCP tool-call outcomes", async () => {
		const { updateMcpTriguna } = await import("../src/modes/mcp-tool-guidance.js");
		await updateMcpTriguna({
			tool: "bash",
			args: { command: "git status" },
			result: { content: [{ type: "text", text: "ok" }], isError: false },
			elapsedMs: 220,
		});

		expect(mockTrigunaUpdate).toHaveBeenCalledWith(expect.objectContaining({
			errorRate: 0,
			successRate: 1,
		}));
	});

	it("packs large nervous-system context through PAKT when beneficial", async () => {
		mockPackContextViaDaemon.mockResolvedValue({
			runtime: "pakt-core",
			packedText: "packed-guidance",
			format: "text",
			savings: 41,
			originalLength: 1200,
		});

		const { wrapMcpToolWithNervousSystem } = await import("../src/modes/mcp-tool-guidance.js");
		const handler = wrapMcpToolWithNervousSystem({
			definition: {
				name: "bash",
				description: "Run a shell command",
				inputSchema: { type: "object" },
			},
			execute: vi.fn(async () => ({
				content: [{ type: "text", text: "tool output" }],
			})),
		}, {
			projectPath: "/tmp/project",
			sessionIdResolver: () => "sess-1",
		});

		const result = await handler.execute({ command: "git status" });
		expect(result.content[0]).toEqual(expect.objectContaining({
			type: "text",
			text: expect.stringContaining("packed via pakt-core"),
		}));
		expect(result.content[0]).toEqual(expect.objectContaining({
			text: expect.stringContaining("packed-guidance"),
		}));
	});

	it("treats daemon packed=false as authoritative for guidance packing", async () => {
		mockAllowLocalRuntimeFallback.mockReturnValue(true);
		mockPackContextViaDaemon.mockResolvedValue({ packed: false });
		mockPackLiveContextText.mockResolvedValue({
			runtime: "pakt-core",
			packedText: "locally-packed-guidance",
			format: "text",
			savings: 25,
			originalLength: 900,
		});

		const { wrapMcpToolWithNervousSystem } = await import("../src/modes/mcp-tool-guidance.js");
		const handler = wrapMcpToolWithNervousSystem({
			definition: {
				name: "bash",
				description: "Run a shell command",
				inputSchema: { type: "object" },
			},
			execute: vi.fn(async () => ({
				content: [{ type: "text", text: "tool output" }],
			})),
		}, {
			projectPath: "/tmp/project",
			sessionIdResolver: () => "sess-1",
		});

		const result = await handler.execute({ command: "git status" });
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("[Lucy live guidance]");
		expect(text).not.toContain("packed via pakt-core");
		expect(text).not.toContain("locally-packed-guidance");
		expect(mockPackLiveContextText).not.toHaveBeenCalled();
	});

	it("injects guidance into text-like tool args before execution", async () => {
		const execute = vi.fn(async () => ({
			content: [{ type: "text", text: "tool output" }],
		}));
		const { wrapMcpToolWithNervousSystem } = await import("../src/modes/mcp-tool-guidance.js");
		const handler = wrapMcpToolWithNervousSystem({
			definition: {
				name: "research_agent",
				description: "Run a research-oriented task",
				inputSchema: { type: "object" },
			},
			execute,
		}, {
			projectPath: "/tmp/project",
			sessionIdResolver: () => "sess-1",
		});

		const result = await handler.execute({ prompt: "Investigate a regression." });
		expect(execute).toHaveBeenCalledWith(expect.objectContaining({
			prompt: expect.stringContaining("[Lucy live guidance]"),
		}));
		expect(result.content[0]).toEqual({
			type: "text",
			text: "[Nervous system context applied pre-execution for research_agent]",
		});
	});

	it("injects guidance into nested message-style args before execution", async () => {
		const execute = vi.fn(async () => ({
			content: [{ type: "text", text: "tool output" }],
		}));
		const { wrapMcpToolWithNervousSystem } = await import("../src/modes/mcp-tool-guidance.js");
		const handler = wrapMcpToolWithNervousSystem({
			definition: {
				name: "chat_tool",
				description: "Run a chat-style tool",
				inputSchema: { type: "object" },
			},
			execute,
		}, {
			projectPath: "/tmp/project",
			sessionIdResolver: () => "sess-1",
		});

		await handler.execute({
			messages: [
				{ role: "system", content: "Existing system guidance." },
				{ role: "user", content: "Investigate the failure." },
			],
		});

		expect(execute).toHaveBeenCalledWith(expect.objectContaining({
			messages: expect.arrayContaining([
				expect.objectContaining({
					content: expect.stringContaining("[Lucy live guidance]"),
				}),
			]),
		}));
	});
});
