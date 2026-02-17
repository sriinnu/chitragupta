import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks (created before module loading) ───────────────────────────

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
	const mockRandomUUID = vi.fn().mockReturnValue("uuid-1234-5678-9abc");

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
	const mockGetChitraguptaHome = vi.fn().mockReturnValue("/tmp/.chitragupta");
	const mockBuiltInProfile = {
		id: "chitragupta",
		name: "Chitragupta",
		personality: "You are a helpful coding assistant.",
		expertise: ["typescript"],
		preferredModel: "claude-sonnet-4-5-20250929",
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
	const apiKnownProviders = new Map<string, unknown>([["anthropic", mockProviderDef]]);
	const mockRegistry = {
		register: vi.fn(),
		get: vi.fn().mockImplementation((id: string) => apiKnownProviders.get(id)),
		getAll: vi.fn().mockReturnValue([mockProviderDef]),
	};
	const mockCreateProviderRegistry = vi.fn().mockReturnValue(mockRegistry);
	const mockRegisterBuiltinProviders = vi.fn();
	const mockCreateOpenAICompatProvider = vi.fn().mockReturnValue(mockProviderDef);

	// ── @chitragupta/anina (Agent) ──
	const mockAgentPromptResponse = {
		id: "msg-1",
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "Hello!" }],
		timestamp: Date.now(),
		cost: { total: 0.001, input: 0.0005, output: 0.0005 },
	};
	const mockAgent = {
		id: "agent-1",
		setProvider: vi.fn(),
		prompt: vi.fn().mockResolvedValue(mockAgentPromptResponse),
		getMessages: vi.fn().mockReturnValue([]),
		pushMessage: vi.fn(),
		abort: vi.fn(),
		setOnEvent: vi.fn(),
		getConfig: vi.fn().mockReturnValue({}),
		registerTool: vi.fn(),
	};
	// Use a regular function (not arrow) so it works with `new`
	const MockAgentClass = vi.fn().mockImplementation(function (this: any) {
		Object.assign(this, mockAgent);
		return mockAgent;
	});

	// ── @chitragupta/smriti ──
	const mockSession = {
		meta: {
			id: "s-abc123",
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
	const mockAddTurn = vi.fn().mockResolvedValue(undefined);
	const mockListSessions = vi.fn().mockReturnValue([]);
	const mockSearchMemory = vi.fn().mockReturnValue([]);

	// ── @chitragupta/yantra ──
	const mockGetAllTools = vi.fn().mockReturnValue([]);

	// ── local modules ──
	const mockDetectProject = vi.fn().mockReturnValue({
		type: "typescript",
		name: "test-project",
		path: "/mock/project",
	});
	const mockLoadContextFiles = vi.fn().mockReturnValue({});
	const mockBuildSystemPrompt = vi.fn().mockReturnValue("You are Chitragupta.");

	return {
		mockExistsSync,
		mockReadFileSync,
		mockReaddirSync,
		mockMkdirSync,
		mockWriteFileSync,
		mockCreateHash,
		mockRandomUUID,
		mockLoadGlobalSettings,
		mockLoadProjectConfig,
		mockCreateConfig,
		mockCascadeConfigs,
		mockGetChitraguptaHome,
		mockBuiltInProfile,
		mockBuiltInProfiles,
		mockResolveProfile,
		mockProviderDef,
		apiKnownProviders,
		mockRegistry,
		mockCreateProviderRegistry,
		mockRegisterBuiltinProviders,
		mockCreateOpenAICompatProvider,
		mockAgentPromptResponse,
		mockAgent,
		MockAgentClass,
		mockSession,
		mockCreateSession,
		mockSaveSession,
		mockLoadSession,
		mockAddTurn,
		mockListSessions,
		mockSearchMemory,
		mockGetAllTools,
		mockDetectProject,
		mockLoadContextFiles,
		mockBuildSystemPrompt,
		mockSettings,
	};
});

// ─── vi.mock declarations (use hoisted mocks) ───────────────────────────────

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
	addTurn: mocks.mockAddTurn,
	listSessions: mocks.mockListSessions,
}));

vi.mock("@chitragupta/smriti/search", () => ({
	searchMemory: mocks.mockSearchMemory,
}));

vi.mock("@chitragupta/yantra", () => ({
	getAllTools: mocks.mockGetAllTools,
}));

vi.mock("../src/project-detector.js", () => ({
	detectProject: mocks.mockDetectProject,
}));

vi.mock("../src/context-files.js", () => ({
	loadContextFiles: mocks.mockLoadContextFiles,
}));

vi.mock("../src/personality.js", () => ({
	buildSystemPrompt: mocks.mockBuildSystemPrompt,
}));

// Mock the dynamic import for mcp-loader
vi.mock("../src/mcp-loader.js", () => ({
	loadMCPConfig: vi.fn().mockReturnValue([]),
	startMCPServers: vi.fn().mockResolvedValue({}),
	importMCPTools: vi.fn().mockReturnValue([]),
	shutdownMCPServers: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { createChitragupta } from "../src/api.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reset all hoisted mocks to their default state. */
function resetMocks(): void {
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
	mocks.mockRandomUUID.mockReset().mockReturnValue("uuid-1234-5678-9abc");

	mocks.mockLoadGlobalSettings.mockReset().mockReturnValue(mocks.mockSettings);
	mocks.mockLoadProjectConfig.mockReset().mockReturnValue({});
	mocks.mockCreateConfig.mockReset().mockReturnValue({});
	mocks.mockCascadeConfigs.mockReset();
	mocks.mockGetChitraguptaHome.mockReset().mockReturnValue("/tmp/.chitragupta");
	mocks.mockResolveProfile.mockReset().mockReturnValue(mocks.mockBuiltInProfile);

	mocks.mockRegistry.register.mockReset();
	mocks.apiKnownProviders.clear();
	mocks.apiKnownProviders.set("anthropic", mocks.mockProviderDef);
	mocks.mockRegistry.get.mockReset().mockImplementation((id: string) => mocks.apiKnownProviders.get(id));
	mocks.mockRegistry.getAll.mockReset().mockReturnValue([mocks.mockProviderDef]);
	mocks.mockCreateProviderRegistry.mockReset().mockReturnValue(mocks.mockRegistry);
	mocks.mockRegisterBuiltinProviders.mockReset();
	mocks.mockCreateOpenAICompatProvider.mockReset().mockReturnValue(mocks.mockProviderDef);

	const freshResponse = {
		id: "msg-1",
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "Hello!" }],
		timestamp: Date.now(),
		cost: { total: 0.001, input: 0.0005, output: 0.0005 },
	};
	mocks.mockAgent.setProvider.mockReset();
	mocks.mockAgent.prompt.mockReset().mockResolvedValue(freshResponse);
	mocks.mockAgent.getMessages.mockReset().mockReturnValue([]);
	mocks.mockAgent.pushMessage.mockReset();
	mocks.mockAgent.abort.mockReset();
	mocks.mockAgent.setOnEvent.mockReset();
	mocks.mockAgent.getConfig.mockReset().mockReturnValue({});
	mocks.mockAgent.registerTool.mockReset();
	mocks.MockAgentClass.mockReset().mockImplementation(function (this: any) {
		Object.assign(this, mocks.mockAgent);
		return mocks.mockAgent;
	});

	// Reset session to a fresh copy
	mocks.mockSession.turns = [];
	mocks.mockSession.meta.id = "s-abc123";
	mocks.mockSession.meta.title = "API Session";

	mocks.mockCreateSession.mockReset().mockReturnValue(mocks.mockSession);
	mocks.mockSaveSession.mockReset();
	mocks.mockLoadSession.mockReset().mockReturnValue(mocks.mockSession);
	mocks.mockAddTurn.mockReset().mockResolvedValue(undefined);
	mocks.mockListSessions.mockReset().mockReturnValue([]);
	mocks.mockSearchMemory.mockReset().mockReturnValue([]);

	mocks.mockGetAllTools.mockReset().mockReturnValue([]);

	mocks.mockDetectProject.mockReset().mockReturnValue({
		type: "typescript",
		name: "test-project",
		path: "/mock/project",
	});
	mocks.mockLoadContextFiles.mockReset().mockReturnValue({});
	mocks.mockBuildSystemPrompt.mockReset().mockReturnValue("You are Chitragupta.");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createChitragupta", () => {
	beforeEach(() => {
		resetMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Factory — basic creation
	// ═══════════════════════════════════════════════════════════════════════

	describe("factory basics", () => {
		it("should create an instance with default options", async () => {
			const instance = await createChitragupta();

			expect(mocks.mockLoadGlobalSettings).toHaveBeenCalled();
			expect(mocks.mockCreateProviderRegistry).toHaveBeenCalled();
			expect(mocks.mockRegisterBuiltinProviders).toHaveBeenCalled();
			expect(mocks.MockAgentClass).toHaveBeenCalled();
			expect(mocks.mockAgent.setProvider).toHaveBeenCalledWith(mocks.mockProviderDef);
			expect(instance).toBeDefined();
			expect(instance.agent).toBeDefined();
			expect(typeof instance.prompt).toBe("function");
			expect(typeof instance.stream).toBe("function");
			expect(typeof instance.searchMemory).toBe("function");
			expect(typeof instance.getSession).toBe("function");
			expect(typeof instance.saveSession).toBe("function");
			expect(typeof instance.getStats).toBe("function");
			expect(typeof instance.destroy).toBe("function");

			await instance.destroy();
		});

		it("should respect the provider option", async () => {
			const customProvider = { ...mocks.mockProviderDef, id: "openai" };
			mocks.apiKnownProviders.set("openai", customProvider);

			const instance = await createChitragupta({ provider: "openai" });

			expect(mocks.mockRegistry.get).toHaveBeenCalledWith("openai");
			expect(mocks.mockAgent.setProvider).toHaveBeenCalledWith(customProvider);

			await instance.destroy();
		});

		it("should respect the model option", async () => {
			const instance = await createChitragupta({ model: "gpt-4o" });

			const agentConfig = mocks.MockAgentClass.mock.calls[0][0];
			expect(agentConfig.model).toBe("gpt-4o");

			await instance.destroy();
		});

		it("should respect the workingDir option", async () => {
			const instance = await createChitragupta({ workingDir: "/custom/dir" });

			expect(mocks.mockDetectProject).toHaveBeenCalledWith("/custom/dir");
			const agentConfig = mocks.MockAgentClass.mock.calls[0][0];
			expect(agentConfig.workingDirectory).toBe("/custom/dir");

			await instance.destroy();
		});

		it("should throw when provider is not found", async () => {
			mocks.apiKnownProviders.clear();
			mocks.mockRegistry.getAll.mockReturnValue([]);

			await expect(createChitragupta({ provider: "unknown-provider" }))
				.rejects.toThrow(/No provider available/);
		});

		it("should include available providers in error message", async () => {
			mocks.apiKnownProviders.clear();
			mocks.mockRegistry.getAll.mockReturnValue([
				{ id: "anthropic" },
				{ id: "openai" },
			]);

			await expect(createChitragupta({ provider: "bogus" }))
				.rejects.toThrow(/anthropic, openai/);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Credentials
	// ═══════════════════════════════════════════════════════════════════════

	describe("credentials loading", () => {
		it("should load credentials and set env vars", async () => {
			const credPath = "/tmp/.chitragupta/config/credentials.json";
			const anthropicKey = ["ANTHROPIC", "API", "KEY"].join("_");

			mocks.mockExistsSync.mockImplementation((p) => {
				return String(p) === credPath;
			});
			mocks.mockReadFileSync.mockImplementation((p) => {
				if (String(p) === credPath) {
					return JSON.stringify({ [anthropicKey]: "test-anthropic-value" });
				}
				return "";
			});

			// Ensure the key is not already set
			delete process.env[anthropicKey];

			const instance = await createChitragupta();

			expect(process.env[anthropicKey]).toBe("test-anthropic-value");

			// Cleanup
			delete process.env[anthropicKey];
			await instance.destroy();
		});

		it("should not overwrite existing env vars from credentials", async () => {
			const credPath = "/tmp/.chitragupta/config/credentials.json";
			const openaiKey = ["OPENAI", "API", "KEY"].join("_");

			mocks.mockExistsSync.mockImplementation((p) => {
				return String(p) === credPath;
			});
			mocks.mockReadFileSync.mockImplementation((p) => {
				if (String(p) === credPath) {
					return JSON.stringify({ [openaiKey]: "new-value" });
				}
				return "";
			});

			process.env[openaiKey] = "original-value";

			const instance = await createChitragupta();

			expect(process.env[openaiKey]).toBe("original-value");

			// Cleanup
			delete process.env[openaiKey];
			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Project config
	// ═══════════════════════════════════════════════════════════════════════

	describe("project config", () => {
		it("should load project config for the working directory", async () => {
			const instance = await createChitragupta({ workingDir: "/my/project" });

			expect(mocks.mockLoadProjectConfig).toHaveBeenCalledWith("/my/project");

			await instance.destroy();
		});

		it("should handle missing project config gracefully", async () => {
			mocks.mockLoadProjectConfig.mockImplementation(() => {
				throw new Error("No project config found");
			});

			const instance = await createChitragupta();

			// Should not throw — uses defaults
			expect(instance).toBeDefined();

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Profile resolution
	// ═══════════════════════════════════════════════════════════════════════

	describe("profile resolution", () => {
		it("should resolve a custom profile by ID string", async () => {
			const customProfile = {
				id: "reviewer",
				name: "Reviewer",
				personality: "You review code carefully.",
				expertise: ["code-review"],
			};
			mocks.mockResolveProfile.mockReturnValue(customProfile);

			const instance = await createChitragupta({ profile: "reviewer" });

			expect(mocks.mockResolveProfile).toHaveBeenCalled();
			const callArgs = mocks.mockResolveProfile.mock.calls[0];
			expect(callArgs[0]).toBe("reviewer");

			await instance.destroy();
		});

		it("should use built-in profile as fallback when resolve returns undefined", async () => {
			mocks.mockResolveProfile.mockReturnValue(undefined);

			const instance = await createChitragupta({ profile: "nonexistent" });

			// Falls back to BUILT_IN_PROFILES["chitragupta"]
			const agentConfig = mocks.MockAgentClass.mock.calls[0][0];
			expect(agentConfig.profile).toBe(mocks.mockBuiltInProfile);

			await instance.destroy();
		});

		it("should accept a custom profile object directly", async () => {
			const customProfile = {
				id: "custom-direct",
				name: "Custom Direct",
				personality: "Direct custom profile.",
				expertise: [],
			} as any;

			const instance = await createChitragupta({ profile: customProfile });

			// Should NOT call resolveProfile when object is passed
			expect(mocks.mockResolveProfile).not.toHaveBeenCalled();
			const agentConfig = mocks.MockAgentClass.mock.calls[0][0];
			expect(agentConfig.profile.id).toBe("custom-direct");

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Session management
	// ═══════════════════════════════════════════════════════════════════════

	describe("session management", () => {
		it("should create a new session when no sessionId is given", async () => {
			const instance = await createChitragupta();

			expect(mocks.mockCreateSession).toHaveBeenCalled();
			expect(mocks.mockLoadSession).not.toHaveBeenCalled();

			await instance.destroy();
		});

		it("should resume an existing session by sessionId", async () => {
			const existingSession = {
				meta: {
					...mocks.mockSession.meta,
					id: "s-existing-123",
				},
				turns: [],
			};
			mocks.mockLoadSession.mockReturnValue(existingSession);

			const instance = await createChitragupta({ sessionId: "s-existing-123" });

			expect(mocks.mockLoadSession).toHaveBeenCalledWith("s-existing-123", expect.any(String));

			await instance.destroy();
		});

		it("should create new session when resuming fails (session not found)", async () => {
			mocks.mockLoadSession.mockImplementation(() => {
				throw new Error("Session not found");
			});

			const instance = await createChitragupta({ sessionId: "s-nonexistent" });

			expect(mocks.mockLoadSession).toHaveBeenCalled();
			expect(mocks.mockCreateSession).toHaveBeenCalled();

			await instance.destroy();
		});

		it("should replay turns into agent when resuming a session with turns", async () => {
			const sessionWithTurns = {
				meta: { ...mocks.mockSession.meta, id: "s-with-turns" },
				turns: [
					{ turnNumber: 1, role: "user", content: "Hello" },
					{ turnNumber: 2, role: "assistant", agent: "chitragupta", model: "claude-sonnet-4-5-20250929", content: "Hi!" },
				],
			};
			mocks.mockLoadSession.mockReturnValue(sessionWithTurns);

			const instance = await createChitragupta({ sessionId: "s-with-turns" });

			// Each turn should be pushed into the agent
			expect(mocks.mockAgent.pushMessage).toHaveBeenCalledTimes(2);

			// First call: user message
			const firstCall = mocks.mockAgent.pushMessage.mock.calls[0][0];
			expect(firstCall.role).toBe("user");
			expect(firstCall.content[0].text).toBe("Hello");

			// Second call: assistant message
			const secondCall = mocks.mockAgent.pushMessage.mock.calls[1][0];
			expect(secondCall.role).toBe("assistant");
			expect(secondCall.content[0].text).toBe("Hi!");

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Thinking level
	// ═══════════════════════════════════════════════════════════════════════

	describe("thinking level", () => {
		it("should use explicit thinkingLevel when provided", async () => {
			const instance = await createChitragupta({ thinkingLevel: "high" });

			const agentConfig = mocks.MockAgentClass.mock.calls[0][0];
			expect(agentConfig.thinkingLevel).toBe("high");

			await instance.destroy();
		});

		it("should fall back to settings thinkingLevel when not provided", async () => {
			const instance = await createChitragupta();

			const agentConfig = mocks.MockAgentClass.mock.calls[0][0];
			expect(agentConfig.thinkingLevel).toBe("medium");

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// noMemory option
	// ═══════════════════════════════════════════════════════════════════════

	describe("noMemory option", () => {
		it("should skip loading project memory when noMemory is true", async () => {
			// Even if memory file exists, it should not be loaded
			mocks.mockExistsSync.mockReturnValue(true);
			mocks.mockReadFileSync.mockReturnValue("# Some memory content");

			const instance = await createChitragupta({ noMemory: true });

			// buildSystemPrompt should be called without memoryContext
			const promptCall = mocks.mockBuildSystemPrompt.mock.calls[0][0];
			expect(promptCall.memoryContext).toBeUndefined();

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Event handler wiring
	// ═══════════════════════════════════════════════════════════════════════

	describe("onEvent handler", () => {
		it("should wire up user onEvent handler to agent", async () => {
			const userHandler = vi.fn();
			const instance = await createChitragupta({ onEvent: userHandler });

			expect(mocks.mockAgent.setOnEvent).toHaveBeenCalled();

			await instance.destroy();
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// Instance methods
// ═════════════════════════════════════════════════════════════════════════════

describe("ChitraguptaInstance", () => {
	beforeEach(() => {
		resetMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// prompt()
	// ═══════════════════════════════════════════════════════════════════════

	describe("prompt()", () => {
		it("should return text from agent response", async () => {
			const instance = await createChitragupta();

			const result = await instance.prompt("Hello there");

			expect(result).toBe("Hello!");
			expect(mocks.mockAgent.prompt).toHaveBeenCalledWith("Hello there");

			await instance.destroy();
		});

		it("should extract text from multiple content parts", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-multi",
				role: "assistant",
				content: [
					{ type: "text", text: "Part one. " },
					{ type: "text", text: "Part two." },
				],
				timestamp: Date.now(),
				cost: { total: 0.002, input: 0.001, output: 0.001 },
			});

			const instance = await createChitragupta();
			const result = await instance.prompt("multi-part");

			expect(result).toBe("Part one. Part two.");

			await instance.destroy();
		});

		it("should record user and assistant turns in session", async () => {
			const instance = await createChitragupta();

			await instance.prompt("What is TypeScript?");

			expect(mocks.mockSession.turns).toHaveLength(2);
			expect(mocks.mockSession.turns[0].role).toBe("user");
			expect(mocks.mockSession.turns[0].content).toBe("What is TypeScript?");
			expect(mocks.mockSession.turns[1].role).toBe("assistant");
			expect(mocks.mockSession.turns[1].content).toBe("Hello!");

			await instance.destroy();
		});

		it("should track cumulative cost across multiple prompts", async () => {
			let callCount = 0;
			mocks.mockAgent.prompt.mockImplementation(async () => {
				callCount++;
				return {
					id: `msg-${callCount}`,
					role: "assistant" as const,
					content: [{ type: "text" as const, text: `Response ${callCount}` }],
					timestamp: Date.now(),
					cost: { total: 0.01, input: 0.005, output: 0.005 },
				};
			});

			const instance = await createChitragupta();

			await instance.prompt("First");
			await instance.prompt("Second");

			const stats = instance.getStats();
			// Cumulative cost = 0.01 + 0.01 = 0.02
			expect(stats.totalCost).toBeCloseTo(0.02);

			await instance.destroy();
		});

		it("should throw when instance has been destroyed", async () => {
			const instance = await createChitragupta();
			await instance.destroy();

			await expect(instance.prompt("after destroy"))
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});

		it("should throw when cost limit is exceeded", async () => {
			// First prompt costs 0.01
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-expensive",
				role: "assistant",
				content: [{ type: "text", text: "Done" }],
				timestamp: Date.now(),
				cost: { total: 0.01, input: 0.005, output: 0.005 },
			});

			const instance = await createChitragupta({ maxSessionCost: 0.01 });

			// First prompt should succeed
			await instance.prompt("First");

			// Second prompt should fail because cumulative cost >= maxSessionCost
			await expect(instance.prompt("Second"))
				.rejects.toThrow(/Session cost limit exceeded/);

			await instance.destroy();
		});

		it("should handle response without cost gracefully", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-nocost",
				role: "assistant",
				content: [{ type: "text", text: "No cost tracked" }],
				timestamp: Date.now(),
				// No cost field
			});

			const instance = await createChitragupta();
			const result = await instance.prompt("free question");

			expect(result).toBe("No cost tracked");

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// getSession()
	// ═══════════════════════════════════════════════════════════════════════

	describe("getSession()", () => {
		it("should return session info with id, title, turnCount, and createdAt", async () => {
			const instance = await createChitragupta();
			const info = instance.getSession();

			expect(info.id).toBe("s-abc123");
			expect(info.title).toBe("API Session");
			expect(info.turnCount).toBe(0);
			expect(typeof info.createdAt).toBe("number");
			expect(info.createdAt).toBeGreaterThan(0);

			await instance.destroy();
		});

		it("should reflect updated turnCount after prompts", async () => {
			const instance = await createChitragupta();

			await instance.prompt("turn one");

			const info = instance.getSession();
			// Each prompt adds 2 turns (user + assistant)
			expect(info.turnCount).toBe(2);

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// saveSession()
	// ═══════════════════════════════════════════════════════════════════════

	describe("saveSession()", () => {
		it("should call smriti saveSession with the session object", async () => {
			const instance = await createChitragupta();

			await instance.saveSession();

			expect(mocks.mockSaveSession).toHaveBeenCalledWith(mocks.mockSession);

			await instance.destroy();
		});

		it("should throw when instance has been destroyed", async () => {
			const instance = await createChitragupta();
			await instance.destroy();

			await expect(instance.saveSession())
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// getStats()
	// ═══════════════════════════════════════════════════════════════════════

	describe("getStats()", () => {
		it("should return zero stats when no prompts have been made", async () => {
			const instance = await createChitragupta();
			const stats = instance.getStats();

			expect(stats.totalCost).toBe(0);
			expect(stats.totalInputTokens).toBe(0);
			expect(stats.totalOutputTokens).toBe(0);
			expect(stats.turnCount).toBe(0);

			await instance.destroy();
		});

		it("should return cumulative cost from prompts", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-stats",
				role: "assistant",
				content: [{ type: "text", text: "Answer" }],
				timestamp: Date.now(),
				cost: { total: 0.05, input: 0.03, output: 0.02 },
			});

			const instance = await createChitragupta();
			await instance.prompt("Question");

			const stats = instance.getStats();
			expect(stats.totalCost).toBeCloseTo(0.05);

			await instance.destroy();
		});

		it("should count user messages as turns", async () => {
			const userMsg = {
				id: "u1",
				role: "user" as const,
				content: [{ type: "text" as const, text: "Hi" }],
				timestamp: Date.now(),
			};
			const assistantMsg = {
				id: "a1",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "Hello" }],
				timestamp: Date.now(),
				cost: { total: 0.001, input: 0.0005, output: 0.0005 },
			};
			mocks.mockAgent.getMessages.mockReturnValue([userMsg, assistantMsg]);

			const instance = await createChitragupta();
			const stats = instance.getStats();

			expect(stats.turnCount).toBe(1);

			await instance.destroy();
		});

		it("should sum costs across messages from agent history", async () => {
			const messages = [
				{
					id: "u1",
					role: "user" as const,
					content: [{ type: "text" as const, text: "Q1" }],
					timestamp: Date.now(),
				},
				{
					id: "a1",
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "A1" }],
					timestamp: Date.now(),
					cost: { total: 0.01, input: 0.005, output: 0.005 },
				},
				{
					id: "u2",
					role: "user" as const,
					content: [{ type: "text" as const, text: "Q2" }],
					timestamp: Date.now(),
				},
				{
					id: "a2",
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "A2" }],
					timestamp: Date.now(),
					cost: { total: 0.02, input: 0.01, output: 0.01 },
				},
			];
			mocks.mockAgent.getMessages.mockReturnValue(messages);

			const instance = await createChitragupta();

			// No prompt calls, so cumulativeCost is 0 — getStats falls back to sumCosts
			const stats = instance.getStats();
			expect(stats.totalCost).toBeCloseTo(0.03);
			expect(stats.turnCount).toBe(2);

			await instance.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// searchMemory()
	// ═══════════════════════════════════════════════════════════════════════

	describe("searchMemory()", () => {
		it("should return mapped search results", async () => {
			mocks.mockSearchMemory.mockReturnValue([
				{
					content: "TypeScript is a typed superset of JavaScript.",
					relevance: 0.95,
					scope: { type: "project", path: "/my/project" },
				},
				{
					content: "Use strict mode for better safety.",
					relevance: 0.7,
					scope: { type: "global" },
				},
			]);

			const instance = await createChitragupta();
			const results = await instance.searchMemory("typescript");

			expect(results).toHaveLength(2);
			expect(results[0].content).toBe("TypeScript is a typed superset of JavaScript.");
			expect(results[0].score).toBe(0.95);
			expect(results[0].source).toBe("project:/my/project");
			expect(results[1].source).toBe("global");

			await instance.destroy();
		});

		it("should respect the limit parameter", async () => {
			mocks.mockSearchMemory.mockReturnValue([
				{ content: "Result 1", relevance: 0.9, scope: { type: "global" } },
				{ content: "Result 2", relevance: 0.8, scope: { type: "global" } },
				{ content: "Result 3", relevance: 0.7, scope: { type: "global" } },
			]);

			const instance = await createChitragupta();
			const results = await instance.searchMemory("query", 2);

			expect(results).toHaveLength(2);

			await instance.destroy();
		});

		it("should handle agent scope results", async () => {
			mocks.mockSearchMemory.mockReturnValue([
				{
					content: "Agent-specific memory.",
					relevance: 0.85,
					scope: { type: "agent", agentId: "agent-42" },
				},
			]);

			const instance = await createChitragupta();
			const results = await instance.searchMemory("agent info");

			expect(results[0].source).toBe("agent:agent-42");

			await instance.destroy();
		});

		it("should handle session scope results", async () => {
			mocks.mockSearchMemory.mockReturnValue([
				{
					content: "Session-specific data.",
					relevance: 0.6,
					scope: { type: "session", sessionId: "s-sess-1" },
				},
			]);

			const instance = await createChitragupta();
			const results = await instance.searchMemory("session data");

			expect(results[0].source).toBe("session:s-sess-1");

			await instance.destroy();
		});

		it("should throw when instance has been destroyed", async () => {
			const instance = await createChitragupta();
			await instance.destroy();

			await expect(instance.searchMemory("query"))
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// destroy()
	// ═══════════════════════════════════════════════════════════════════════

	describe("destroy()", () => {
		it("should abort the agent on destroy", async () => {
			const instance = await createChitragupta();

			await instance.destroy();

			expect(mocks.mockAgent.abort).toHaveBeenCalled();
		});

		it("should be idempotent — calling destroy twice is safe", async () => {
			const instance = await createChitragupta();

			await instance.destroy();
			await instance.destroy();

			// abort should only be called once (first destroy)
			expect(mocks.mockAgent.abort).toHaveBeenCalledTimes(1);
		});

		it("should not throw if MCP shutdown fails", async () => {
			// Re-import mcp-loader to set up shutdown failure
			const mcpLoader = await import("../src/mcp-loader.js");
			vi.mocked(mcpLoader.loadMCPConfig).mockReturnValue([{ id: "test" }] as any);
			vi.mocked(mcpLoader.startMCPServers).mockResolvedValue({} as any);
			vi.mocked(mcpLoader.importMCPTools).mockReturnValue([]);
			vi.mocked(mcpLoader.shutdownMCPServers).mockRejectedValue(new Error("MCP shutdown failed"));

			const instance = await createChitragupta();

			// Should not throw
			await expect(instance.destroy()).resolves.toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// stream()
	// ═══════════════════════════════════════════════════════════════════════

	describe("stream()", () => {
		it("should throw when instance has been destroyed", async () => {
			const instance = await createChitragupta();
			await instance.destroy();

			const gen = instance.stream("after destroy");
			await expect(gen[Symbol.asyncIterator]().next())
				.rejects.toThrow("ChitraguptaInstance has been destroyed");
		});

		it("should throw when cost limit is exceeded", async () => {
			mocks.mockAgent.prompt.mockResolvedValue({
				id: "msg-expensive",
				role: "assistant",
				content: [{ type: "text", text: "Done" }],
				timestamp: Date.now(),
				cost: { total: 0.05, input: 0.025, output: 0.025 },
			});

			const instance = await createChitragupta({ maxSessionCost: 0.05 });

			// First prompt exhausts the budget
			await instance.prompt("First");

			// Stream should throw because budget is exhausted
			const gen = instance.stream("Second");
			await expect(gen[Symbol.asyncIterator]().next())
				.rejects.toThrow(/Session cost limit exceeded/);

			await instance.destroy();
		});

		it("persists assistant text from final response when stream text events are absent", async () => {
			const instance = await createChitragupta();
			const chunks: unknown[] = [];

			for await (const chunk of instance.stream("No stream chunks")) {
				chunks.push(chunk);
			}

			expect(chunks).toEqual([]);
			expect(mocks.mockSession.turns.at(-1)?.role).toBe("assistant");
			expect(mocks.mockSession.turns.at(-1)?.content).toBe("Hello!");

			const assistantTurnCall = mocks.mockAddTurn.mock.calls.find(
				(call) => call[2]?.role === "assistant",
			);
			expect(assistantTurnCall?.[2]?.content).toBe("Hello!");

			await instance.destroy();
		});
	});
});
