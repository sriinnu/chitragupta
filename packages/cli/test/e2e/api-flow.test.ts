/**
 * E2E: Programmatic API Flow
 *
 * Exercises the FULL flow through:
 *   api.ts -> core (config) -> swara (providers) -> anina (Agent) -> smriti (session) -> yantra (tools)
 *
 * Mocks: filesystem, network, LLM provider (no real AI calls).
 * Real: module wiring, config cascading, session management, cost tracking.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks (created before module loading) ────────────────────────────

const mocks = vi.hoisted(() => {
	// ── fs ──
	const mockExistsSync = vi.fn().mockReturnValue(false);
	const mockReadFileSync = vi.fn().mockReturnValue("");
	const mockReaddirSync = vi.fn().mockReturnValue([]);
	const mockMkdirSync = vi.fn();
	const mockWriteFileSync = vi.fn();

	// ── crypto ──
	const mockCreateHash = vi.fn().mockReturnValue({
		update: vi.fn().mockReturnValue({
			digest: vi.fn().mockReturnValue("abcdef123456"),
		}),
	});
	const mockRandomUUID = vi.fn().mockReturnValue("uuid-e2e-1234-5678");

	// ── @chitragupta/core ──
	const mockSettings = {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5-20250929",
		thinkingLevel: "medium" as const,
		agentProfile: "chitragupta",
		compaction: { enabled: true, threshold: 80 },
		memory: { autoSave: true, searchDepth: 3 },
		theme: "nakshatram",
		plugins: [],
	};
	const mockLoadGlobalSettings = vi.fn().mockReturnValue(mockSettings);
	const mockLoadProjectConfig = vi.fn().mockReturnValue({});
	const mockCreateConfig = vi.fn().mockReturnValue({});
	const mockCascadeConfigs = vi.fn();
	const mockGetChitraguptaHome = vi.fn().mockReturnValue("/tmp/.chitragupta-e2e");
	const mockBuiltInProfile = {
		id: "chitragupta",
		name: "Chitragupta",
		personality: "You are a helpful coding assistant.",
		expertise: ["typescript"],
		preferredModel: "claude-sonnet-4-5-20250929",
		voice: "professional" as const,
	};
	const mockBuiltInProfiles: Record<string, typeof mockBuiltInProfile> = {
		chitragupta: mockBuiltInProfile,
	};
	const mockResolveProfile = vi.fn().mockReturnValue(mockBuiltInProfile);

	// ── @chitragupta/swara ──
	const mockProviderDef = {
		id: "anthropic",
		name: "Anthropic",
		models: [],
		createStream: vi.fn(),
	};
	const e2eKnownProviders = new Map<string, unknown>([["anthropic", mockProviderDef]]);
	const mockRegistry = {
		register: vi.fn(),
		get: vi.fn().mockImplementation((id: string) => e2eKnownProviders.get(id)),
		getAll: vi.fn().mockReturnValue([mockProviderDef]),
	};
	const mockCreateProviderRegistry = vi.fn().mockReturnValue(mockRegistry);
	const mockRegisterBuiltinProviders = vi.fn();
	const mockCreateOpenAICompatProvider = vi.fn().mockReturnValue(mockProviderDef);

	// ── @chitragupta/anina (Agent) ──
	let promptCallCount = 0;
	const mockAgentPromptResponse = () => ({
		id: `msg-${++promptCallCount}`,
		role: "assistant" as const,
		content: [{ type: "text" as const, text: `Response ${promptCallCount}` }],
		timestamp: Date.now(),
		cost: { total: 0.001, input: 0.0005, output: 0.0005 },
	});

	const storedMessages: Array<Record<string, unknown>> = [];
	let onEventHandler: ((event: string, data: unknown) => void) | null = null;
	let configRef: Record<string, unknown> = {};

	const mockAgent = {
		id: "agent-e2e",
		setProvider: vi.fn(),
		prompt: vi.fn().mockImplementation(async (message: string) => {
			const resp = mockAgentPromptResponse();
			// Store user message
			storedMessages.push({
				id: `user-${storedMessages.length}`,
				role: "user",
				content: [{ type: "text", text: message }],
				timestamp: Date.now(),
			});
			// Store assistant message
			storedMessages.push(resp);

			// Fire streaming events if handler is wired
			if (onEventHandler) {
				onEventHandler("stream:text", { text: resp.content[0].text });
				onEventHandler("stream:done", { stopReason: "end_turn", cost: resp.cost });
			}

			return resp;
		}),
		getMessages: vi.fn().mockImplementation(() => [...storedMessages]),
		pushMessage: vi.fn().mockImplementation((msg: Record<string, unknown>) => {
			storedMessages.push(msg);
		}),
		abort: vi.fn(),
		setOnEvent: vi.fn().mockImplementation((handler: (event: string, data: unknown) => void) => {
			onEventHandler = handler;
		}),
		getConfig: vi.fn().mockImplementation(() => ({
			...configRef,
			onEvent: onEventHandler,
		})),
		registerTool: vi.fn(),
	};

	const MockAgentClass = vi.fn().mockImplementation(function (this: any, config: Record<string, unknown>) {
		configRef = config;
		Object.assign(this, mockAgent);
		return mockAgent;
	});

	// ── @chitragupta/smriti ──
	const mockSession = {
		meta: {
			id: "s-e2e-001",
			title: "API Session",
			created: "2026-02-07T00:00:00.000Z",
			updated: "2026-02-07T00:00:00.000Z",
			agent: "chitragupta",
			model: "claude-sonnet-4-5-20250929",
			project: "/mock/project",
			parent: null,
			branch: null,
			tags: [],
			totalCost: 0,
			totalTokens: 0,
		},
		turns: [] as Array<{
			turnNumber: number;
			role: string;
			content: string;
			agent?: string;
			model?: string;
		}>,
	};
	const mockCreateSession = vi.fn().mockReturnValue(mockSession);
	const mockSaveSession = vi.fn();
	const mockLoadSession = vi.fn().mockReturnValue(mockSession);
	const mockListSessions = vi.fn().mockReturnValue([]);
	const mockSearchMemory = vi.fn().mockReturnValue([]);

	// ── @chitragupta/yantra ──
	const mockGetAllTools = vi.fn().mockReturnValue([]);

	// ── local modules ──
	const mockDetectProject = vi.fn().mockReturnValue({
		type: "generic",
		name: "test",
		path: "/mock/project",
	});
	const mockLoadContextFiles = vi.fn().mockReturnValue([]);
	const mockBuildSystemPrompt = vi.fn().mockReturnValue("You are a test assistant.");

	return {
		mockExistsSync,
		mockReadFileSync,
		mockReaddirSync,
		mockMkdirSync,
		mockWriteFileSync,
		mockCreateHash,
		mockRandomUUID,
		mockSettings,
		mockLoadGlobalSettings,
		mockLoadProjectConfig,
		mockCreateConfig,
		mockCascadeConfigs,
		mockGetChitraguptaHome,
		mockBuiltInProfile,
		mockBuiltInProfiles,
		mockResolveProfile,
		mockProviderDef,
		e2eKnownProviders,
		mockRegistry,
		mockCreateProviderRegistry,
		mockRegisterBuiltinProviders,
		mockCreateOpenAICompatProvider,
		mockAgent,
		MockAgentClass,
		mockSession,
		mockCreateSession,
		mockSaveSession,
		mockLoadSession,
		mockListSessions,
		mockSearchMemory,
		mockGetAllTools,
		mockDetectProject,
		mockLoadContextFiles,
		mockBuildSystemPrompt,
		// Mutable state resetters
		resetPromptCount: () => { promptCallCount = 0; },
		resetStoredMessages: () => { storedMessages.length = 0; },
		resetOnEvent: () => { onEventHandler = null; },
		resetConfigRef: () => { configRef = {}; },
	};
});

// ── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock("fs", () => ({
	default: {
		existsSync: mocks.mockExistsSync,
		readFileSync: mocks.mockReadFileSync,
		readdirSync: mocks.mockReaddirSync,
		mkdirSync: mocks.mockMkdirSync,
		writeFileSync: mocks.mockWriteFileSync,
	},
	existsSync: mocks.mockExistsSync,
	readFileSync: mocks.mockReadFileSync,
	readdirSync: mocks.mockReaddirSync,
	mkdirSync: mocks.mockMkdirSync,
	writeFileSync: mocks.mockWriteFileSync,
}));

vi.mock("crypto", () => ({
	default: {
		createHash: mocks.mockCreateHash,
		randomUUID: mocks.mockRandomUUID,
	},
	createHash: mocks.mockCreateHash,
	randomUUID: mocks.mockRandomUUID,
}));

vi.mock("@chitragupta/core", () => ({
	loadGlobalSettings: mocks.mockLoadGlobalSettings,
	loadProjectConfig: mocks.mockLoadProjectConfig,
	createConfig: mocks.mockCreateConfig,
	cascadeConfigs: mocks.mockCascadeConfigs,
	getChitraguptaHome: mocks.mockGetChitraguptaHome,
	resolveProfile: mocks.mockResolveProfile,
	BUILT_IN_PROFILES: mocks.mockBuiltInProfiles,
	DEFAULT_SETTINGS: mocks.mockSettings,
	DEFAULT_PROVIDER_PRIORITY: ["claude-code", "codex-cli", "gemini-cli", "aider-cli", "ollama", "anthropic", "openai", "google"],
	DEFAULT_FALLBACK_MODEL: "claude-sonnet-4-5-20250929",
}));

vi.mock("@chitragupta/swara/provider-registry", () => ({
	createProviderRegistry: mocks.mockCreateProviderRegistry,
}));

vi.mock("@chitragupta/swara/providers", () => ({
	registerBuiltinProviders: mocks.mockRegisterBuiltinProviders,
	createOpenAICompatProvider: mocks.mockCreateOpenAICompatProvider,
	claudeCodeProvider: { id: "claude-code", name: "Claude Code" },
	geminiCLIProvider: { id: "gemini-cli", name: "Gemini CLI" },
	codexProvider: { id: "codex-cli", name: "Codex CLI" },
	aiderProvider: { id: "aider-cli", name: "Aider CLI" },
}));

vi.mock("@chitragupta/swara", () => ({
	detectAvailableCLIs: vi.fn().mockResolvedValue([]),
	createOllamaEmbeddings: vi.fn().mockReturnValue({
		isConfigured: vi.fn().mockResolvedValue(false),
	}),
}));

vi.mock("@chitragupta/anina", () => ({
	Agent: mocks.MockAgentClass,
}));

vi.mock("@chitragupta/smriti/session-store", () => ({
	createSession: mocks.mockCreateSession,
	saveSession: mocks.mockSaveSession,
	loadSession: mocks.mockLoadSession,
	listSessions: mocks.mockListSessions,
}));

vi.mock("@chitragupta/smriti/search", () => ({
	searchMemory: mocks.mockSearchMemory,
}));

vi.mock("@chitragupta/yantra", () => ({
	getAllTools: mocks.mockGetAllTools,
}));

vi.mock("../../src/project-detector.js", () => ({
	detectProject: mocks.mockDetectProject,
}));

vi.mock("../../src/context-files.js", () => ({
	loadContextFiles: mocks.mockLoadContextFiles,
}));

vi.mock("../../src/personality.js", () => ({
	buildSystemPrompt: mocks.mockBuildSystemPrompt,
}));

vi.mock("../../src/mcp-loader.js", () => ({
	loadMCPConfig: vi.fn().mockReturnValue([]),
	startMCPServers: vi.fn().mockResolvedValue({}),
	importMCPTools: vi.fn().mockReturnValue([]),
	shutdownMCPServers: vi.fn().mockResolvedValue(undefined),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { createChitragupta } from "../../src/api.js";

// ── Reset helper ─────────────────────────────────────────────────────────────

function resetAllMocks(): void {
	mocks.resetPromptCount();
	mocks.resetStoredMessages();
	mocks.resetOnEvent();
	mocks.resetConfigRef();

	mocks.mockExistsSync.mockReset().mockReturnValue(false);
	mocks.mockReadFileSync.mockReset().mockReturnValue("");
	mocks.mockReaddirSync.mockReset().mockReturnValue([]);
	mocks.mockMkdirSync.mockReset();
	mocks.mockWriteFileSync.mockReset();

	mocks.mockCreateHash.mockReset().mockReturnValue({
		update: vi.fn().mockReturnValue({
			digest: vi.fn().mockReturnValue("abcdef123456"),
		}),
	});
	mocks.mockRandomUUID.mockReset().mockReturnValue("uuid-e2e-1234-5678");

	mocks.mockLoadGlobalSettings.mockReset().mockReturnValue(mocks.mockSettings);
	mocks.mockLoadProjectConfig.mockReset().mockReturnValue({});
	mocks.mockCreateConfig.mockReset().mockReturnValue({});
	mocks.mockCascadeConfigs.mockReset();
	mocks.mockGetChitraguptaHome.mockReset().mockReturnValue("/tmp/.chitragupta-e2e");
	mocks.mockResolveProfile.mockReset().mockReturnValue(mocks.mockBuiltInProfile);

	mocks.mockRegistry.register.mockReset();
	mocks.e2eKnownProviders.clear();
	mocks.e2eKnownProviders.set("anthropic", mocks.mockProviderDef);
	mocks.mockRegistry.get.mockReset().mockImplementation((id: string) => mocks.e2eKnownProviders.get(id));
	mocks.mockRegistry.getAll.mockReset().mockReturnValue([mocks.mockProviderDef]);
	mocks.mockCreateProviderRegistry.mockReset().mockReturnValue(mocks.mockRegistry);
	mocks.mockRegisterBuiltinProviders.mockReset();
	mocks.mockCreateOpenAICompatProvider.mockReset().mockReturnValue(mocks.mockProviderDef);

	// Reset agent mock
	let localPromptCount = 0;
	mocks.mockAgent.setProvider.mockReset();
	mocks.mockAgent.prompt.mockReset().mockImplementation(async (message: string) => {
		localPromptCount++;
		const resp = {
			id: `msg-${localPromptCount}`,
			role: "assistant" as const,
			content: [{ type: "text" as const, text: `Response ${localPromptCount}` }],
			timestamp: Date.now(),
			cost: { total: 0.001, input: 0.0005, output: 0.0005 },
		};
		return resp;
	});
	mocks.mockAgent.getMessages.mockReset().mockReturnValue([]);
	mocks.mockAgent.pushMessage.mockReset();
	mocks.mockAgent.abort.mockReset();
	mocks.mockAgent.setOnEvent.mockReset();
	mocks.mockAgent.getConfig.mockReset().mockReturnValue({});
	mocks.mockAgent.registerTool.mockReset();
	mocks.MockAgentClass.mockReset().mockImplementation(function (this: any, config: Record<string, unknown>) {
		Object.assign(this, mocks.mockAgent);
		return mocks.mockAgent;
	});

	// Reset session
	mocks.mockSession.turns = [];
	mocks.mockSession.meta.id = "s-e2e-001";
	mocks.mockSession.meta.title = "API Session";

	mocks.mockCreateSession.mockReset().mockReturnValue(mocks.mockSession);
	mocks.mockSaveSession.mockReset();
	mocks.mockLoadSession.mockReset().mockReturnValue(mocks.mockSession);
	mocks.mockListSessions.mockReset().mockReturnValue([]);
	mocks.mockSearchMemory.mockReset().mockReturnValue([]);

	mocks.mockGetAllTools.mockReset().mockReturnValue([]);

	mocks.mockDetectProject.mockReset().mockReturnValue({
		type: "generic",
		name: "test",
		path: "/mock/project",
	});
	mocks.mockLoadContextFiles.mockReset().mockReturnValue([]);
	mocks.mockBuildSystemPrompt.mockReset().mockReturnValue("You are a test assistant.");
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("E2E: API Flow", () => {
	beforeEach(() => {
		resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 1. Full create -> prompt -> destroy flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("full create -> prompt -> destroy flow", () => {
		it("should complete the entire lifecycle", async () => {
			const instance = await createChitragupta({ provider: "anthropic" });

			// Verify creation wiring
			expect(mocks.mockLoadGlobalSettings).toHaveBeenCalled();
			expect(mocks.mockCreateProviderRegistry).toHaveBeenCalled();
			expect(mocks.mockRegisterBuiltinProviders).toHaveBeenCalled();
			expect(mocks.MockAgentClass).toHaveBeenCalled();
			expect(mocks.mockAgent.setProvider).toHaveBeenCalledWith(mocks.mockProviderDef);

			// Prompt
			const response = await instance.prompt("Hello");
			expect(typeof response).toBe("string");
			expect(response.length).toBeGreaterThan(0);

			// Destroy
			await instance.destroy();
			expect(mocks.mockAgent.abort).toHaveBeenCalled();
		});

		it("should wire up all required modules during creation", async () => {
			const instance = await createChitragupta();

			// Verify each module was called in the pipeline
			expect(mocks.mockDetectProject).toHaveBeenCalled();
			expect(mocks.mockLoadContextFiles).toHaveBeenCalled();
			expect(mocks.mockBuildSystemPrompt).toHaveBeenCalled();
			expect(mocks.mockCreateSession).toHaveBeenCalled();
			expect(mocks.mockGetAllTools).toHaveBeenCalled();

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 2. Session recording
	// ═══════════════════════════════════════════════════════════════════════

	describe("session recording", () => {
		it("should record turns after prompt()", async () => {
			const instance = await createChitragupta();

			await instance.prompt("Hello world");

			const session = instance.getSession();
			expect(session.turnCount).toBe(2); // user + assistant
			expect(session.id).toBe("s-e2e-001");

			await instance.destroy();
		});

		it("should have a valid session ID", async () => {
			const instance = await createChitragupta();
			const session = instance.getSession();

			expect(typeof session.id).toBe("string");
			expect(session.id.length).toBeGreaterThan(0);

			await instance.destroy();
		});

		it("should track turn content correctly", async () => {
			const instance = await createChitragupta();

			await instance.prompt("What is TypeScript?");

			expect(mocks.mockSession.turns).toHaveLength(2);
			expect(mocks.mockSession.turns[0].role).toBe("user");
			expect(mocks.mockSession.turns[0].content).toBe("What is TypeScript?");
			expect(mocks.mockSession.turns[1].role).toBe("assistant");

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 3. Stats tracking
	// ═══════════════════════════════════════════════════════════════════════

	describe("stats tracking", () => {
		it("should return zero stats before any prompts", async () => {
			const instance = await createChitragupta();
			const stats = instance.getStats();

			expect(stats.totalCost).toBe(0);
			expect(stats.totalInputTokens).toBe(0);
			expect(stats.totalOutputTokens).toBe(0);
			expect(stats.turnCount).toBe(0);

			await instance.destroy();
		});

		it("should track cost after prompt()", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-cost",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "Response" }],
				timestamp: Date.now(),
				cost: { total: 0.05, input: 0.03, output: 0.02 },
			});

			const instance = await createChitragupta();
			await instance.prompt("Question");

			const stats = instance.getStats();
			expect(stats.totalCost).toBeCloseTo(0.05);

			await instance.destroy();
		});

		it("should accumulate cost over multiple prompts", async () => {
			let callNum = 0;
			mocks.mockAgent.prompt.mockImplementation(async () => {
				callNum++;
				return {
					id: `msg-${callNum}`,
					role: "assistant" as const,
					content: [{ type: "text" as const, text: `R${callNum}` }],
					timestamp: Date.now(),
					cost: { total: 0.01, input: 0.005, output: 0.005 },
				};
			});

			const instance = await createChitragupta();
			await instance.prompt("First");
			await instance.prompt("Second");
			await instance.prompt("Third");

			const stats = instance.getStats();
			expect(stats.totalCost).toBeCloseTo(0.03);

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 4. Multi-turn conversation
	// ═══════════════════════════════════════════════════════════════════════

	describe("multi-turn conversation", () => {
		it("should track correct turn count after multiple prompts", async () => {
			const instance = await createChitragupta();

			await instance.prompt("Message 1");
			await instance.prompt("Message 2");

			const session = instance.getSession();
			// 2 user + 2 assistant = 4 turns
			expect(session.turnCount).toBe(4);

			await instance.destroy();
		});

		it("should record all turns in order", async () => {
			const instance = await createChitragupta();

			await instance.prompt("First question");
			await instance.prompt("Follow-up question");

			expect(mocks.mockSession.turns).toHaveLength(4);
			expect(mocks.mockSession.turns[0].role).toBe("user");
			expect(mocks.mockSession.turns[0].content).toBe("First question");
			expect(mocks.mockSession.turns[1].role).toBe("assistant");
			expect(mocks.mockSession.turns[2].role).toBe("user");
			expect(mocks.mockSession.turns[2].content).toBe("Follow-up question");
			expect(mocks.mockSession.turns[3].role).toBe("assistant");

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 5. Session save
	// ═══════════════════════════════════════════════════════════════════════

	describe("session save", () => {
		it("should call saveSession on the smriti session store", async () => {
			const instance = await createChitragupta();
			await instance.prompt("Some content");
			await instance.saveSession();

			expect(mocks.mockSaveSession).toHaveBeenCalledTimes(1);
			expect(mocks.mockSaveSession).toHaveBeenCalledWith(mocks.mockSession);

			await instance.destroy();
		});

		it("should include turns in the saved session", async () => {
			const instance = await createChitragupta();
			await instance.prompt("Data to save");
			await instance.saveSession();

			const savedSession = mocks.mockSaveSession.mock.calls[0][0];
			expect(savedSession.turns.length).toBeGreaterThan(0);

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 6. Stream flow
	// ═══════════════════════════════════════════════════════════════════════

	describe("stream flow", () => {
		it("should yield chunks including text and done", async () => {
			// Set up the agent to fire events via setOnEvent
			let eventHandler: ((event: string, data: unknown) => void) | null = null;
			mocks.mockAgent.setOnEvent.mockImplementation(
				(handler: (event: string, data: unknown) => void) => {
					eventHandler = handler;
				},
			);
			mocks.mockAgent.getConfig.mockReturnValue({
				onEvent: null,
			});
			mocks.mockAgent.prompt.mockImplementation(async () => {
				// Simulate streaming events
				if (eventHandler) {
					eventHandler("stream:text", { text: "Hello " });
					eventHandler("stream:text", { text: "world!" });
					eventHandler("stream:done", { stopReason: "end_turn", cost: { total: 0.001 } });
				}
				return {
					id: "msg-stream",
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Hello world!" }],
					timestamp: Date.now(),
					cost: { total: 0.001, input: 0.0005, output: 0.0005 },
				};
			});

			const instance = await createChitragupta();
			const chunks: Array<{ type: string; data: unknown }> = [];

			for await (const chunk of instance.stream("Say hello")) {
				chunks.push(chunk);
			}

			// Should have text chunks and a done chunk
			const textChunks = chunks.filter((c) => c.type === "text");
			const doneChunks = chunks.filter((c) => c.type === "done");

			expect(textChunks.length).toBeGreaterThan(0);
			expect(doneChunks.length).toBeGreaterThan(0);

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 7. Cost limit enforcement
	// ═══════════════════════════════════════════════════════════════════════

	describe("cost limit enforcement", () => {
		it("should throw when session cost exceeds maxSessionCost", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-expensive",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "Done" }],
				timestamp: Date.now(),
				cost: { total: 0.01, input: 0.005, output: 0.005 },
			});

			const instance = await createChitragupta({ maxSessionCost: 0.01 });

			// First prompt should succeed (consumes budget)
			await instance.prompt("First prompt");

			// Second prompt should fail (budget exceeded)
			await expect(instance.prompt("Second prompt"))
				.rejects.toThrow(/Session cost limit exceeded/);

			await instance.destroy();
		});

		it("should enforce cost limit on stream() as well", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-exp",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "Done" }],
				timestamp: Date.now(),
				cost: { total: 0.05, input: 0.025, output: 0.025 },
			});

			const instance = await createChitragupta({ maxSessionCost: 0.05 });
			await instance.prompt("Exhaust budget");

			// Stream should also fail
			const gen = instance.stream("Over budget");
			await expect(gen[Symbol.asyncIterator]().next())
				.rejects.toThrow(/Session cost limit exceeded/);

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 8. Destroy prevents further use
	// ═══════════════════════════════════════════════════════════════════════

	describe("destroy prevents further use", () => {
		it("should throw on prompt() after destroy", async () => {
			const instance = await createChitragupta();
			await instance.destroy();

			await expect(instance.prompt("After destroy"))
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});

		it("should throw on saveSession() after destroy", async () => {
			const instance = await createChitragupta();
			await instance.destroy();

			await expect(instance.saveSession())
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});

		it("should throw on searchMemory() after destroy", async () => {
			const instance = await createChitragupta();
			await instance.destroy();

			await expect(instance.searchMemory("query"))
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});

		it("should be idempotent -- calling destroy twice is safe", async () => {
			const instance = await createChitragupta();
			await instance.destroy();
			await instance.destroy();

			expect(mocks.mockAgent.abort).toHaveBeenCalledTimes(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 9. Provider not found error
	// ═══════════════════════════════════════════════════════════════════════

	describe("provider not found error", () => {
		it("should throw with descriptive error including available providers", async () => {
			mocks.e2eKnownProviders.clear();
			mocks.mockRegistry.getAll.mockReturnValue([]);

			await expect(createChitragupta({ provider: "nonexistent" }))
				.rejects.toThrow(/No provider available/);
		});

		it("should list available providers in the error message", async () => {
			mocks.e2eKnownProviders.clear();
			mocks.mockRegistry.getAll.mockReturnValue([
				{ id: "anthropic" },
				{ id: "openai" },
				{ id: "ollama" },
			]);

			await expect(createChitragupta({ provider: "bad_provider" }))
				.rejects.toThrow(/anthropic, openai, ollama/);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 10. Custom profile
	// ═══════════════════════════════════════════════════════════════════════

	describe("custom profile", () => {
		it("should accept a custom profile object directly", async () => {
			const customProfile = {
				id: "test",
				name: "Test",
				personality: "Brief",
				expertise: [] as string[],
				voice: "professional" as const,
			};

			const instance = await createChitragupta({ profile: customProfile as any });

			// Should NOT call resolveProfile when object is passed directly
			expect(mocks.mockResolveProfile).not.toHaveBeenCalled();

			// Agent should receive the custom profile
			const agentConfig = mocks.MockAgentClass.mock.calls[0][0];
			expect(agentConfig.profile.id).toBe("test");
			expect(agentConfig.profile.personality).toBe("Brief");

			await instance.destroy();
		});

		it("should resolve a named profile by string ID", async () => {
			const customProfile = {
				id: "reviewer",
				name: "Reviewer",
				personality: "You review code.",
				expertise: ["review"],
			};
			mocks.mockResolveProfile.mockReturnValue(customProfile);

			const instance = await createChitragupta({ profile: "reviewer" });

			expect(mocks.mockResolveProfile).toHaveBeenCalled();
			const callArgs = mocks.mockResolveProfile.mock.calls[0];
			expect(callArgs[0]).toBe("reviewer");

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 11. Memory opt-out
	// ═══════════════════════════════════════════════════════════════════════

	describe("memory opt-out", () => {
		it("should skip memory loading when noMemory is true", async () => {
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFileSync.mockReturnValue("# Some memory content");

			const instance = await createChitragupta({ noMemory: true });

			// buildSystemPrompt should be called WITHOUT memoryContext
			const promptArgs = mocks.mockBuildSystemPrompt.mock.calls[0][0];
			expect(promptArgs.memoryContext).toBeUndefined();

			await instance.destroy();
		});

		it("should still work normally without memory", async () => {
			const instance = await createChitragupta({ noMemory: true });
			const response = await instance.prompt("Hello");

			expect(typeof response).toBe("string");
			expect(response.length).toBeGreaterThan(0);

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// 12. Event handler
	// ═══════════════════════════════════════════════════════════════════════

	describe("event handler", () => {
		it("should wire onEvent handler to the agent", async () => {
			const handler = vi.fn();
			const instance = await createChitragupta({ onEvent: handler });

			expect(mocks.mockAgent.setOnEvent).toHaveBeenCalled();

			await instance.destroy();
		});

		it("should forward events to the user handler during prompt", async () => {
			const receivedEvents: Array<{ event: string; data: unknown }> = [];
			const handler = vi.fn((event: string, data: unknown) => {
				receivedEvents.push({ event, data });
			});

			// Set up agent to capture and forward events
			let capturedHandler: ((event: string, data: unknown) => void) | null = null;
			mocks.mockAgent.setOnEvent.mockImplementation(
				(h: (event: string, data: unknown) => void) => {
					capturedHandler = h;
				},
			);
			mocks.mockAgent.prompt.mockImplementation(async () => {
				// Simulate event emission
				if (capturedHandler) {
					capturedHandler("stream:text", { text: "Hello" });
					capturedHandler("stream:done", { stopReason: "end_turn" });
				}
				return {
					id: "msg-ev",
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Hello" }],
					timestamp: Date.now(),
					cost: { total: 0.001, input: 0.0005, output: 0.0005 },
				};
			});

			const instance = await createChitragupta({ onEvent: handler });
			await instance.prompt("Trigger events");

			// The handler should have been wired
			expect(mocks.mockAgent.setOnEvent).toHaveBeenCalled();

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Full pipeline integration tests
	// ═══════════════════════════════════════════════════════════════════════

	describe("full pipeline integration", () => {
		it("should complete create -> multi-prompt -> stats -> save -> destroy", async () => {
			let callNum = 0;
			mocks.mockAgent.prompt.mockImplementation(async () => {
				callNum++;
				return {
					id: `msg-${callNum}`,
					role: "assistant" as const,
					content: [{ type: "text" as const, text: `Answer ${callNum}` }],
					timestamp: Date.now(),
					cost: { total: 0.01, input: 0.005, output: 0.005 },
				};
			});

			// 1. Create
			const instance = await createChitragupta({ provider: "anthropic" });

			// 2. First prompt
			const r1 = await instance.prompt("Question 1");
			expect(r1).toBe("Answer 1");

			// 3. Second prompt
			const r2 = await instance.prompt("Question 2");
			expect(r2).toBe("Answer 2");

			// 4. Check stats
			const stats = instance.getStats();
			expect(stats.totalCost).toBeCloseTo(0.02);

			// 5. Check session
			const session = instance.getSession();
			expect(session.turnCount).toBe(4); // 2 user + 2 assistant

			// 6. Save
			await instance.saveSession();
			expect(mocks.mockSaveSession).toHaveBeenCalled();

			// 7. Destroy
			await instance.destroy();
			expect(mocks.mockAgent.abort).toHaveBeenCalled();

			// 8. Verify destroyed state
			await expect(instance.prompt("After destroy"))
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});

		it("should handle session resume with existing turns", async () => {
			const existingSession = {
				meta: {
					...mocks.mockSession.meta,
					id: "s-resume-001",
				},
				turns: [
					{ turnNumber: 1, role: "user", content: "Previous question" },
					{ turnNumber: 2, role: "assistant", agent: "chitragupta", model: "claude-sonnet-4-5-20250929", content: "Previous answer" },
				],
			};
			mocks.mockLoadSession.mockReturnValue(existingSession);

			const instance = await createChitragupta({ sessionId: "s-resume-001" });

			// Agent should have had previous turns pushed
			expect(mocks.mockAgent.pushMessage).toHaveBeenCalledTimes(2);

			// First pushed message should be user
			const firstPush = mocks.mockAgent.pushMessage.mock.calls[0][0];
			expect(firstPush.role).toBe("user");
			expect(firstPush.content[0].text).toBe("Previous question");

			// Second pushed message should be assistant
			const secondPush = mocks.mockAgent.pushMessage.mock.calls[1][0];
			expect(secondPush.role).toBe("assistant");
			expect(secondPush.content[0].text).toBe("Previous answer");

			await instance.destroy();
		});

		it("should create new session when resume fails", async () => {
			mocks.mockLoadSession.mockImplementation(() => {
				throw new Error("Session not found");
			});

			const instance = await createChitragupta({ sessionId: "s-nonexistent" });

			// Should fall back to creating a new session
			expect(mocks.mockCreateSession).toHaveBeenCalled();

			await instance.destroy();
		});

		it("should handle response without cost gracefully", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-nocost",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "No cost info" }],
				timestamp: Date.now(),
				// No cost field
			});

			const instance = await createChitragupta();
			const result = await instance.prompt("Free prompt");
			expect(result).toBe("No cost info");

			const stats = instance.getStats();
			expect(stats.totalCost).toBe(0);

			await instance.destroy();
		});

		it("should handle multi-part content in response", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-multi",
				role: "assistant" as const,
				content: [
					{ type: "text" as const, text: "Part one. " },
					{ type: "text" as const, text: "Part two." },
				],
				timestamp: Date.now(),
				cost: { total: 0.001, input: 0.0005, output: 0.0005 },
			});

			const instance = await createChitragupta();
			const result = await instance.prompt("Multi-part question");
			expect(result).toBe("Part one. Part two.");

			await instance.destroy();
		});

		it("should handle search memory with different scopes", async () => {
			mocks.mockSearchMemory.mockReturnValue([
				{ content: "Project memory", relevance: 0.9, scope: { type: "project", path: "/my/project" } },
				{ content: "Global memory", relevance: 0.8, scope: { type: "global" } },
				{ content: "Agent memory", relevance: 0.7, scope: { type: "agent", agentId: "agent-1" } },
				{ content: "Session memory", relevance: 0.6, scope: { type: "session", sessionId: "s-1" } },
			]);

			const instance = await createChitragupta();
			const results = await instance.searchMemory("test query");

			expect(results).toHaveLength(4);
			expect(results[0].source).toBe("project:/my/project");
			expect(results[1].source).toBe("global");
			expect(results[2].source).toBe("agent:agent-1");
			expect(results[3].source).toBe("session:s-1");

			await instance.destroy();
		});

		it("should handle search memory with limit", async () => {
			mocks.mockSearchMemory.mockReturnValue([
				{ content: "R1", relevance: 0.9, scope: { type: "global" } },
				{ content: "R2", relevance: 0.8, scope: { type: "global" } },
				{ content: "R3", relevance: 0.7, scope: { type: "global" } },
			]);

			const instance = await createChitragupta();
			const results = await instance.searchMemory("query", 2);

			expect(results).toHaveLength(2);

			await instance.destroy();
		});
	});
});
