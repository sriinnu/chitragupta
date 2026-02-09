/**
 * @chitragupta/cli — Tests for main CLI orchestration (main.ts).
 *
 * Comprehensive coverage of the main() entry point and its internal helper
 * replaySessionIntoAgent(). Every external dependency is mocked via vi.hoisted()
 * so the test file exercises only the orchestration logic itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks (created before any module is loaded) ─────────────────────

const {
	// fs
	mockExistsSync,
	mockReadFileSync,
	mockReaddirSync,
	mockMkdirSync,
	mockWriteFileSync,
	// crypto
	mockCreateHash,
	mockRandomUUID,
	// @chitragupta/core
	mockLoadGlobalSettings,
	mockLoadProjectConfig,
	mockCreateConfig,
	mockCascadeConfigs,
	mockGetChitraguptaHome,
	mockResolveProfile,
	mockBuiltInProfiles,
	// @chitragupta/swara/provider-registry
	mockCreateProviderRegistry,
	mockRegistry,
	// @chitragupta/swara/providers
	mockRegisterSwaraProviders,
	mockCreateOpenAICompatProvider,
	// @chitragupta/swara (dynamic import)
	mockMargaPipeline,
	MockMargaPipeline,
	// @chitragupta/anina
	mockAgent,
	MockAgent,
	mockKaalaBrahma,
	MockKaalaBrahma,
	mockSoulManager,
	MockSoulManager,
	mockAgentReflector,
	MockAgentReflector,
	// @chitragupta/smriti/session-store
	mockCreateSession,
	mockListSessions,
	mockLoadSession,
	mockSaveSession,
	mockAddTurn,
	// @chitragupta/smriti (CheckpointManager)
	mockCheckpointManager,
	MockCheckpointManager,
	// @chitragupta/yantra
	mockGetAllTools,
	// @chitragupta/dharma
	mockPolicyEngine,
	MockPolicyEngine,
	mockStandardPreset,
	mockApprovalGate,
	MockApprovalGate,
	mockKarmaTracker,
	MockKarmaTracker,
	// @chitragupta/sutra
	mockCommHub,
	MockCommHub,
	mockMessageBus,
	MockMessageBus,
	MockSutraAgentRegistry,
	mockSandeshaRouter,
	MockSandeshaRouter,
	// @chitragupta/niyanta
	MockAutonomousOrchestrator,
	// @chitragupta/vidhya-skills
	MockSkillRegistry,
	MockVidyaBridge,
	// @chitragupta/smriti (ConsolidationEngine)
	MockConsolidationEngine,
	// local modules
	mockDetectProject,
	mockLoadContextFiles,
	mockBuildSystemPrompt,
	mockRunInteractiveMode,
	mockRunPrintMode,
	mockIsFirstRun,
	mockRunOnboarding,
	mockLoadPlugins,
	// mcp-loader
	mockLoadMCPConfig,
	mockStartMCPServers,
	mockImportMCPTools,
	mockShutdownMCPServers,
	// http-server (dynamic)
	mockCreateChitraguptaAPI,
	mockServerInstance,
} = vi.hoisted(() => {
	// ─── Agent mock ────────────────────────────────────────────────────
	const mockAgent = {
		id: "agent-1",
		setProvider: vi.fn(),
		prompt: vi.fn(),
		getMessages: vi.fn().mockReturnValue([]),
		pushMessage: vi.fn(),
		abort: vi.fn(),
		setOnEvent: vi.fn(),
		getConfig: vi.fn().mockReturnValue({}),
		registerTool: vi.fn(),
	};

	// Constructor mocks — use function() so `new` works
	const MockAgent = vi.fn(function () { return mockAgent; });

	// ─── Provider registry mock ────────────────────────────────────────
	const mockProvider = { id: "anthropic", name: "Anthropic" };
	const mockRegistry = {
		get: vi.fn().mockReturnValue(mockProvider),
		getAll: vi.fn().mockReturnValue([mockProvider]),
		register: vi.fn(),
	};

	// ─── Built-in profiles ─────────────────────────────────────────────
	const chitraguptaProfile = {
		id: "chitragupta",
		name: "Chitragupta",
		personality: "Bold and opinionated.",
		expertise: ["typescript"],
		preferredModel: "claude-sonnet-4-5-20250929",
	};

	// ─── Standard preset mock for dharma ───────────────────────────────
	const mockStandardPreset = {
		config: { costBudget: 10 },
		policySets: [],
	};

	// ─── MargaPipeline mock ────────────────────────────────────────────
	const mockMargaPipeline = { route: vi.fn() };
	const MockMargaPipeline = vi.fn(function () { return mockMargaPipeline; });

	// ─── CommHub mock ──────────────────────────────────────────────────
	const mockCommHub = { destroy: vi.fn() };
	const MockCommHub = vi.fn(function () { return mockCommHub; });

	// ─── SandeshaRouter mock ───────────────────────────────────────────
	const mockSandeshaRouter = { destroy: vi.fn() };
	const MockSandeshaRouter = vi.fn(function () { return mockSandeshaRouter; });

	// ─── MessageBus mock ───────────────────────────────────────────────
	const mockMessageBus = { destroy: vi.fn() };
	const MockMessageBus = vi.fn(function () { return mockMessageBus; });

	// ─── KaalaBrahma mock ──────────────────────────────────────────────
	const mockKaalaBrahma = {
		registerAgent: vi.fn(),
		recordHeartbeat: vi.fn(),
		dispose: vi.fn(),
		getTreeHealth: vi.fn().mockReturnValue({ agents: [] }),
	};
	const MockKaalaBrahma = vi.fn(function () { return mockKaalaBrahma; });

	// ─── SoulManager mock ──────────────────────────────────────────────
	const mockSoulManager = {};
	const MockSoulManager = vi.fn(function () { return mockSoulManager; });

	// ─── AgentReflector mock ───────────────────────────────────────────
	const mockAgentReflector = {};
	const MockAgentReflector = vi.fn(function () { return mockAgentReflector; });

	// ─── KarmaTracker mock ─────────────────────────────────────────────
	const mockKarmaTracker = {};
	const MockKarmaTracker = vi.fn(function () { return mockKarmaTracker; });

	// ─── PolicyEngine mock ─────────────────────────────────────────────
	const mockPolicyEngine = { addPolicySet: vi.fn() };
	const MockPolicyEngine = vi.fn(function () { return mockPolicyEngine; });

	// ─── ApprovalGate mock ─────────────────────────────────────────────
	const mockApprovalGate = {};
	const MockApprovalGate = vi.fn(function () { return mockApprovalGate; });

	// ─── CheckpointManager mock ────────────────────────────────────────
	const mockCheckpointManager = { save: vi.fn() };
	const MockCheckpointManager = vi.fn(function () { return mockCheckpointManager; });

	// ─── SutraAgentRegistry mock ───────────────────────────────────────
	const MockSutraAgentRegistry = vi.fn(function () { return {}; });

	// ─── AutonomousOrchestrator mock ───────────────────────────────────
	const MockAutonomousOrchestrator = vi.fn(function () { return {}; });

	// ─── SkillRegistry / VidyaBridge mock ──────────────────────────────
	const MockSkillRegistry = vi.fn(function () {
		return { size: 0, getAll: vi.fn().mockReturnValue([]) };
	});
	const MockVidyaBridge = vi.fn(function () {
		return { registerToolsAsSkills: vi.fn() };
	});

	// ─── ConsolidationEngine mock ──────────────────────────────────────
	const MockConsolidationEngine = vi.fn(function () {
		return {
			load: vi.fn(),
			consolidate: vi.fn().mockReturnValue({ newRules: [] }),
			decayRules: vi.fn(),
			pruneRules: vi.fn(),
			save: vi.fn(),
		};
	});

	// ─── HTTP server mock ──────────────────────────────────────────────
	const mockServerInstance = {
		start: vi.fn().mockResolvedValue(3141),
		stop: vi.fn().mockResolvedValue(undefined),
	};
	const mockCreateChitraguptaAPI = vi.fn().mockReturnValue(mockServerInstance);

	// ─── MCP loader mocks ──────────────────────────────────────────────
	const mockLoadMCPConfig = vi.fn().mockReturnValue([]);
	const mockStartMCPServers = vi.fn().mockResolvedValue({});
	const mockImportMCPTools = vi.fn().mockReturnValue([]);
	const mockShutdownMCPServers = vi.fn().mockResolvedValue(undefined);

	return {
		// fs
		mockExistsSync: vi.fn().mockReturnValue(false),
		mockReadFileSync: vi.fn().mockReturnValue(""),
		mockReaddirSync: vi.fn().mockReturnValue([]),
		mockMkdirSync: vi.fn(),
		mockWriteFileSync: vi.fn(),
		// crypto
		mockCreateHash: vi.fn().mockReturnValue({
			update: vi.fn().mockReturnValue({
				digest: vi.fn().mockReturnValue("abcdef123456abcdef"),
			}),
		}),
		mockRandomUUID: vi.fn().mockReturnValue("00000000-0000-0000-0000-000000000001"),
		// @chitragupta/core
		mockLoadGlobalSettings: vi.fn().mockReturnValue({
			defaultProvider: "anthropic",
			defaultModel: "claude-sonnet-4-5-20250929",
			agentProfile: "chitragupta",
			thinkingLevel: "medium",
		}),
		mockLoadProjectConfig: vi.fn().mockReturnValue({}),
		mockCreateConfig: vi.fn().mockImplementation((_layer: string, data: unknown) => data),
		mockCascadeConfigs: vi.fn().mockImplementation((...configs: unknown[]) => configs[0]),
		mockGetChitraguptaHome: vi.fn().mockReturnValue("/mock-home/.chitragupta"),
		mockResolveProfile: vi.fn().mockReturnValue(chitraguptaProfile),
		mockBuiltInProfiles: { chitragupta: chitraguptaProfile },
		// @chitragupta/swara/provider-registry
		mockCreateProviderRegistry: vi.fn().mockReturnValue(mockRegistry),
		mockRegistry,
		// @chitragupta/swara/providers
		mockRegisterSwaraProviders: vi.fn(),
		mockCreateOpenAICompatProvider: vi.fn(),
		// @chitragupta/swara
		mockMargaPipeline,
		MockMargaPipeline,
		// @chitragupta/anina
		mockAgent,
		MockAgent,
		mockKaalaBrahma,
		MockKaalaBrahma,
		mockSoulManager,
		MockSoulManager,
		mockAgentReflector,
		MockAgentReflector,
		// @chitragupta/smriti/session-store
		mockCreateSession: vi.fn().mockReturnValue({
			meta: { id: "session-001", project: "/test/project" },
			turns: [],
		}),
		mockListSessions: vi.fn().mockReturnValue([]),
		mockLoadSession: vi.fn(),
		mockSaveSession: vi.fn(),
		mockAddTurn: vi.fn(),
		// @chitragupta/smriti
		mockCheckpointManager,
		MockCheckpointManager,
		// @chitragupta/yantra
		mockGetAllTools: vi.fn().mockReturnValue([]),
		// @chitragupta/dharma
		mockPolicyEngine,
		MockPolicyEngine,
		mockStandardPreset,
		mockApprovalGate,
		MockApprovalGate,
		mockKarmaTracker,
		MockKarmaTracker,
		// @chitragupta/sutra
		mockCommHub,
		MockCommHub,
		mockMessageBus,
		MockMessageBus,
		MockSutraAgentRegistry,
		mockSandeshaRouter,
		MockSandeshaRouter,
		// @chitragupta/niyanta
		MockAutonomousOrchestrator,
		// @chitragupta/vidhya-skills
		MockSkillRegistry,
		MockVidyaBridge,
		// @chitragupta/smriti (ConsolidationEngine)
		MockConsolidationEngine,
		// local modules
		mockDetectProject: vi.fn().mockReturnValue({ type: "typescript", name: "test-app", path: "/test/project" }),
		mockLoadContextFiles: vi.fn().mockReturnValue({}),
		mockBuildSystemPrompt: vi.fn().mockReturnValue("You are Chitragupta."),
		mockRunInteractiveMode: vi.fn().mockResolvedValue(undefined),
		mockRunPrintMode: vi.fn().mockResolvedValue(0),
		mockIsFirstRun: vi.fn().mockReturnValue(false),
		mockRunOnboarding: vi.fn().mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-4-5-20250929", completed: true }),
		mockLoadPlugins: vi.fn().mockResolvedValue({ plugins: [], tools: [], commands: [] }),
		// mcp-loader
		mockLoadMCPConfig,
		mockStartMCPServers,
		mockImportMCPTools,
		mockShutdownMCPServers,
		// http-server
		mockCreateChitraguptaAPI,
		mockServerInstance,
	};
});

// ─── vi.mock() calls — these reference the hoisted variables ─────────────────

vi.mock("fs", () => ({
	default: {
		existsSync: mockExistsSync,
		readFileSync: mockReadFileSync,
		readdirSync: mockReaddirSync,
		mkdirSync: mockMkdirSync,
		writeFileSync: mockWriteFileSync,
	},
	existsSync: mockExistsSync,
	readFileSync: mockReadFileSync,
	readdirSync: mockReaddirSync,
	mkdirSync: mockMkdirSync,
	writeFileSync: mockWriteFileSync,
}));

vi.mock("crypto", () => ({
	default: {
		createHash: mockCreateHash,
		randomUUID: mockRandomUUID,
	},
	createHash: mockCreateHash,
	randomUUID: mockRandomUUID,
}));

vi.mock("@chitragupta/core", () => ({
	loadGlobalSettings: mockLoadGlobalSettings,
	loadProjectConfig: mockLoadProjectConfig,
	createConfig: mockCreateConfig,
	cascadeConfigs: mockCascadeConfigs,
	getChitraguptaHome: mockGetChitraguptaHome,
	resolveProfile: mockResolveProfile,
	BUILT_IN_PROFILES: mockBuiltInProfiles,
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@chitragupta/swara/provider-registry", () => ({
	createProviderRegistry: mockCreateProviderRegistry,
}));

vi.mock("@chitragupta/swara/providers", () => ({
	registerBuiltinProviders: mockRegisterSwaraProviders,
	createOpenAICompatProvider: mockCreateOpenAICompatProvider,
}));

vi.mock("@chitragupta/swara", () => ({
	MargaPipeline: MockMargaPipeline,
	HYBRID_BINDINGS: { bindings: [] },
}));

vi.mock("@chitragupta/anina", () => ({
	Agent: MockAgent,
	KaalaBrahma: MockKaalaBrahma,
	SoulManager: MockSoulManager,
	ARCHETYPES: {},
	AgentReflector: MockAgentReflector,
}));

vi.mock("@chitragupta/smriti/session-store", () => ({
	createSession: mockCreateSession,
	listSessions: mockListSessions,
	loadSession: mockLoadSession,
	saveSession: mockSaveSession,
	addTurn: mockAddTurn,
}));

vi.mock("@chitragupta/smriti", () => ({
	CheckpointManager: MockCheckpointManager,
	ConsolidationEngine: MockConsolidationEngine,
}));

vi.mock("@chitragupta/yantra", () => ({
	getAllTools: mockGetAllTools,
}));

vi.mock("@chitragupta/dharma", () => ({
	PolicyEngine: MockPolicyEngine,
	STANDARD_PRESET: mockStandardPreset,
	ApprovalGate: MockApprovalGate,
	KarmaTracker: MockKarmaTracker,
}));

vi.mock("@chitragupta/sutra", () => ({
	CommHub: MockCommHub,
	MessageBus: MockMessageBus,
	AgentRegistry: MockSutraAgentRegistry,
	SandeshaRouter: MockSandeshaRouter,
}));

vi.mock("@chitragupta/niyanta", () => ({
	AutonomousOrchestrator: MockAutonomousOrchestrator,
}));

vi.mock("@chitragupta/vidhya-skills", () => ({
	SkillRegistry: MockSkillRegistry,
	VidyaBridge: MockVidyaBridge,
}));

vi.mock("../src/project-detector.js", () => ({
	detectProject: mockDetectProject,
}));

vi.mock("../src/context-files.js", () => ({
	loadContextFiles: mockLoadContextFiles,
}));

vi.mock("../src/personality.js", () => ({
	buildSystemPrompt: mockBuildSystemPrompt,
}));

vi.mock("../src/modes/interactive.js", () => ({
	runInteractiveMode: mockRunInteractiveMode,
}));

vi.mock("../src/modes/print.js", () => ({
	runPrintMode: mockRunPrintMode,
}));

vi.mock("../src/onboarding.js", () => ({
	isFirstRun: mockIsFirstRun,
	runOnboarding: mockRunOnboarding,
}));

vi.mock("../src/plugin-loader.js", () => ({
	loadPlugins: mockLoadPlugins,
}));

vi.mock("../src/mcp-loader.js", () => ({
	loadMCPConfig: mockLoadMCPConfig,
	startMCPServers: mockStartMCPServers,
	importMCPTools: mockImportMCPTools,
	shutdownMCPServers: mockShutdownMCPServers,
}));

vi.mock("../src/http-server.js", () => ({
	createChitraguptaAPI: mockCreateChitraguptaAPI,
}));

// ─── Import the module under test AFTER all mocks are defined ────────────────

import { main } from "../src/main.js";
import type { ParsedArgs } from "../src/args.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal ParsedArgs with overrides. */
function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
	return {
		rest: [],
		...overrides,
	};
}

/** Spy on process.exit to prevent actual exits and capture calls. */
function spyOnExit() {
	return vi.spyOn(process, "exit").mockImplementation((() => {
		throw new Error("process.exit");
	}) as unknown as (code?: string | number | null | undefined) => never);
}

/** Spy on process.stderr.write to capture error output. */
function spyOnStderr() {
	return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

/** Spy on process.stdout.write to capture normal output. */
function spyOnStdout() {
	return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

/**
 * Call main() and swallow the expected process.exit throw.
 *
 * After the ConsolidationEngine fix, interactive mode returns cleanly
 * to main(), which runs post-session hooks and then calls process.exit(0).
 * Since tests mock process.exit to throw, every interactive-path test
 * must catch that throw.
 */
async function runMain(args: ParsedArgs): Promise<void> {
	try {
		await main(args);
	} catch {
		// process.exit mock throws — expected for interactive & print paths
	}
}

// ─── Default mock state restoration ─────────────────────────────────────────

/** Restore all mocks to their default state after vi.clearAllMocks(). */
function restoreDefaults() {
	mockIsFirstRun.mockReturnValue(false);
	mockLoadGlobalSettings.mockReturnValue({
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5-20250929",
		agentProfile: "chitragupta",
		thinkingLevel: "medium",
	});
	mockLoadProjectConfig.mockReturnValue({});
	mockCreateConfig.mockImplementation((_layer: string, data: unknown) => data);
	mockCascadeConfigs.mockImplementation((...configs: unknown[]) => configs[0]);
	mockGetChitraguptaHome.mockReturnValue("/mock-home/.chitragupta");
	mockResolveProfile.mockReturnValue({
		id: "chitragupta",
		name: "Chitragupta",
		personality: "Bold and opinionated.",
		expertise: ["typescript"],
		preferredModel: "claude-sonnet-4-5-20250929",
	});
	mockCreateProviderRegistry.mockReturnValue(mockRegistry);
	mockRegistry.get.mockReturnValue({ id: "anthropic", name: "Anthropic" });
	mockRegistry.getAll.mockReturnValue([{ id: "anthropic", name: "Anthropic" }]);
	MockAgent.mockImplementation(function () { return mockAgent; });
	mockAgent.getMessages.mockReturnValue([]);
	mockAgent.setProvider.mockReturnValue(undefined);
	mockAgent.registerTool.mockReturnValue(undefined);
	mockAgent.pushMessage.mockReturnValue(undefined);
	mockCreateSession.mockReturnValue({
		meta: { id: "session-001", project: "/test/project" },
		turns: [],
	});
	mockListSessions.mockReturnValue([]);
	mockRunPrintMode.mockResolvedValue(0);
	mockRunInteractiveMode.mockResolvedValue(undefined);
	mockRunOnboarding.mockResolvedValue({ provider: "anthropic", model: "claude-sonnet-4-5-20250929", completed: true });
	mockLoadPlugins.mockResolvedValue({ plugins: [], tools: [], commands: [] });
	mockDetectProject.mockReturnValue({ type: "typescript", name: "test-app", path: "/test/project" });
	mockLoadContextFiles.mockReturnValue({});
	mockBuildSystemPrompt.mockReturnValue("You are Chitragupta.");
	mockGetAllTools.mockReturnValue([]);
	mockExistsSync.mockReturnValue(false);
	mockReadFileSync.mockReturnValue("");
	mockReaddirSync.mockReturnValue([]);
	mockCreateHash.mockReturnValue({
		update: vi.fn().mockReturnValue({
			digest: vi.fn().mockReturnValue("abcdef123456abcdef"),
		}),
	});
	MockMargaPipeline.mockImplementation(function () { return mockMargaPipeline; });
	MockKaalaBrahma.mockImplementation(function () { return mockKaalaBrahma; });
	mockKaalaBrahma.registerAgent.mockReturnValue(undefined);
	mockKaalaBrahma.recordHeartbeat.mockReturnValue(undefined);
	MockCommHub.mockImplementation(function () { return mockCommHub; });
	MockSandeshaRouter.mockImplementation(function () { return mockSandeshaRouter; });
	MockMessageBus.mockImplementation(function () { return mockMessageBus; });
	MockCheckpointManager.mockImplementation(function () { return mockCheckpointManager; });
	MockPolicyEngine.mockImplementation(function () { return mockPolicyEngine; });
	MockApprovalGate.mockImplementation(function () { return mockApprovalGate; });
	MockKarmaTracker.mockImplementation(function () { return mockKarmaTracker; });
	MockSoulManager.mockImplementation(function () { return mockSoulManager; });
	MockAgentReflector.mockImplementation(function () { return mockAgentReflector; });
	mockCreateChitraguptaAPI.mockReturnValue(mockServerInstance);
	mockServerInstance.start.mockResolvedValue(3141);
	mockServerInstance.stop.mockResolvedValue(undefined);
	mockLoadMCPConfig.mockReturnValue([]);
	mockStartMCPServers.mockResolvedValue({});
	mockImportMCPTools.mockReturnValue([]);
	mockShutdownMCPServers.mockResolvedValue(undefined);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("main()", () => {
	let exitSpy: ReturnType<typeof spyOnExit>;
	let stderrSpy: ReturnType<typeof spyOnStderr>;
	let stdoutSpy: ReturnType<typeof spyOnStdout>;

	beforeEach(() => {
		vi.clearAllMocks();
		restoreDefaults();

		exitSpy = spyOnExit();
		stderrSpy = spyOnStderr();
		stdoutSpy = spyOnStdout();
	});

	afterEach(() => {
		exitSpy.mockRestore();
		stderrSpy.mockRestore();
		stdoutSpy.mockRestore();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Onboarding
	// ═══════════════════════════════════════════════════════════════════════

	describe("onboarding", () => {
		it("should run onboarding when isFirstRun returns true", async () => {
			mockIsFirstRun.mockReturnValue(true);

			await runMain(makeArgs());

			expect(mockIsFirstRun).toHaveBeenCalled();
			expect(mockRunOnboarding).toHaveBeenCalled();
		});

		it("should skip onboarding when isFirstRun returns false", async () => {
			mockIsFirstRun.mockReturnValue(false);

			await runMain(makeArgs());

			expect(mockIsFirstRun).toHaveBeenCalled();
			expect(mockRunOnboarding).not.toHaveBeenCalled();
		});

		it("should proceed to interactive mode even if onboarding is not completed", async () => {
			mockIsFirstRun.mockReturnValue(true);
			mockRunOnboarding.mockResolvedValue({
				provider: "anthropic",
				model: "claude-sonnet-4-5-20250929",
				completed: false,
			});

			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Print mode
	// ═══════════════════════════════════════════════════════════════════════

	describe("print mode", () => {
		it("should run print mode with a prompt", async () => {
			mockRunPrintMode.mockResolvedValue(0);

			try {
				await main(makeArgs({ print: true, prompt: "explain this code" }));
			} catch {
				// process.exit is expected
			}

			expect(mockRunPrintMode).toHaveBeenCalledWith(
				expect.objectContaining({
					agent: mockAgent,
					prompt: "explain this code",
				}),
			);
		});

		it("should error when print mode has no prompt", async () => {
			try {
				await main(makeArgs({ print: true }));
			} catch {
				// process.exit throws
			}

			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("Print mode requires a prompt"),
			);
		});

		it("should save session turns after print mode completes", async () => {
			mockRunPrintMode.mockResolvedValue(0);
			mockAgent.getMessages.mockReturnValue([
				{
					content: [{ type: "text", text: "Here is the explanation." }],
				},
			]);

			try {
				await main(makeArgs({ print: true, prompt: "explain" }));
			} catch {
				// process.exit is expected
			}

			// User turn saved
			expect(mockAddTurn).toHaveBeenCalledWith(
				"session-001",
				expect.any(String),
				expect.objectContaining({
					role: "user",
					content: "explain",
				}),
			);

			// Assistant turn saved
			expect(mockAddTurn).toHaveBeenCalledWith(
				"session-001",
				expect.any(String),
				expect.objectContaining({
					role: "assistant",
					content: "Here is the explanation.",
				}),
			);
		});

		it("should call process.exit with the exit code from runPrintMode", async () => {
			mockRunPrintMode.mockResolvedValue(1);

			try {
				await main(makeArgs({ print: true, prompt: "fail" }));
			} catch {
				// process.exit throws
			}

			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it("should exit with code 0 on successful print", async () => {
			mockRunPrintMode.mockResolvedValue(0);

			try {
				await main(makeArgs({ print: true, prompt: "success" }));
			} catch {
				// process.exit throws
			}

			expect(exitSpy).toHaveBeenCalledWith(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Interactive mode
	// ═══════════════════════════════════════════════════════════════════════

	describe("interactive mode", () => {
		it("should launch interactive mode when no print flag is set", async () => {
			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});

		it("should pass correct options to runInteractiveMode", async () => {
			await runMain(makeArgs({ prompt: "hello world" }));

			expect(mockRunInteractiveMode).toHaveBeenCalledWith(
				expect.objectContaining({
					agent: mockAgent,
					profile: expect.objectContaining({ id: "chitragupta" }),
					initialPrompt: "hello world",
					session: expect.objectContaining({ id: "session-001" }),
				}),
			);
		});

		it("should pass provider registry and margaPipeline to interactive mode", async () => {
			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalledWith(
				expect.objectContaining({
					providerRegistry: mockRegistry,
					margaPipeline: mockMargaPipeline,
				}),
			);
		});

		it("should pass userExplicitModel=true when args.model is set", async () => {
			await runMain(makeArgs({ model: "gpt-4o" }));

			expect(mockRunInteractiveMode).toHaveBeenCalledWith(
				expect.objectContaining({
					userExplicitModel: true,
				}),
			);
		});

		it("should pass userExplicitModel=false when args.model is not set", async () => {
			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalledWith(
				expect.objectContaining({
					userExplicitModel: false,
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Serve command
	// ═══════════════════════════════════════════════════════════════════════

	describe("serve command", () => {
		it("should create HTTP server with default port and host", async () => {
			// The serve command blocks on SIGINT; simulate SIGINT to unblock.
			const originalOn = process.on.bind(process);
			const onSpy = vi.spyOn(process, "on").mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
				if (event === "SIGINT") {
					setTimeout(() => handler(), 0);
				}
				return originalOn(event, handler);
			}) as typeof process.on);

			await main(makeArgs({ command: "serve" }));

			expect(mockCreateChitraguptaAPI).toHaveBeenCalled();
			expect(mockServerInstance.start).toHaveBeenCalled();
			expect(stdoutSpy).toHaveBeenCalledWith(
				expect.stringContaining("3141"),
			);

			onSpy.mockRestore();
		});

		it("should use custom port and host from args", async () => {
			const originalOn = process.on.bind(process);
			const onSpy = vi.spyOn(process, "on").mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
				if (event === "SIGINT") {
					setTimeout(() => handler(), 0);
				}
				return originalOn(event, handler);
			}) as typeof process.on);

			await main(makeArgs({ command: "serve", port: 8080, host: "0.0.0.0" }));

			expect(mockCreateChitraguptaAPI).toHaveBeenCalledWith(
				expect.any(Object),
				expect.objectContaining({
					port: 8080,
					host: "0.0.0.0",
				}),
			);

			onSpy.mockRestore();
		});

		it("should return early without running interactive or print mode", async () => {
			const originalOn = process.on.bind(process);
			const onSpy = vi.spyOn(process, "on").mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
				if (event === "SIGINT") {
					setTimeout(() => handler(), 0);
				}
				return originalOn(event, handler);
			}) as typeof process.on);

			await main(makeArgs({ command: "serve" }));

			expect(mockRunInteractiveMode).not.toHaveBeenCalled();
			expect(mockRunPrintMode).not.toHaveBeenCalled();

			onSpy.mockRestore();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Provider resolution
	// ═══════════════════════════════════════════════════════════════════════

	describe("provider resolution", () => {
		it("should use args.provider when specified", async () => {
			await runMain(makeArgs({ provider: "openai" }));

			expect(mockRegistry.get).toHaveBeenCalledWith("openai");
		});

		it("should fall back to settings.defaultProvider when no args.provider", async () => {
			mockLoadGlobalSettings.mockReturnValue({
				defaultProvider: "google",
				defaultModel: "gemini-pro",
				agentProfile: "chitragupta",
			});

			await runMain(makeArgs());

			expect(mockRegistry.get).toHaveBeenCalledWith("google");
		});

		it("should fall back to 'anthropic' when neither args nor settings have provider", async () => {
			mockLoadGlobalSettings.mockReturnValue({});

			await runMain(makeArgs());

			expect(mockRegistry.get).toHaveBeenCalledWith("anthropic");
		});

		it("should error and exit when provider is not found", async () => {
			mockRegistry.get.mockReturnValue(undefined);

			await runMain(makeArgs({ provider: "nonexistent" }));

			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining('"nonexistent" not found'),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Profile resolution
	// ═══════════════════════════════════════════════════════════════════════

	describe("profile resolution", () => {
		it("should use args.profile when specified", async () => {
			await runMain(makeArgs({ profile: "reviewer" }));

			expect(mockResolveProfile).toHaveBeenCalledWith("reviewer", expect.any(Object));
		});

		it("should fall back to settings.agentProfile when no args.profile", async () => {
			mockLoadGlobalSettings.mockReturnValue({
				defaultProvider: "anthropic",
				agentProfile: "friendly",
			});

			await runMain(makeArgs());

			expect(mockResolveProfile).toHaveBeenCalledWith("friendly", expect.any(Object));
		});

		it("should fall back to 'chitragupta' when neither args nor settings have profile", async () => {
			mockLoadGlobalSettings.mockReturnValue({});

			await runMain(makeArgs());

			expect(mockResolveProfile).toHaveBeenCalledWith("chitragupta", expect.any(Object));
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Session handling
	// ═══════════════════════════════════════════════════════════════════════

	describe("session handling", () => {
		it("should create a new session by default", async () => {
			await runMain(makeArgs());

			expect(mockCreateSession).toHaveBeenCalledWith(
				expect.objectContaining({
					project: expect.any(String),
					agent: "chitragupta",
				}),
			);
		});

		it("should set session title from prompt (truncated to 60 chars)", async () => {
			const longPrompt = "A".repeat(100);
			await runMain(makeArgs({ prompt: longPrompt }));

			expect(mockCreateSession).toHaveBeenCalledWith(
				expect.objectContaining({
					title: longPrompt.slice(0, 60),
				}),
			);
		});

		it("should set session title to 'New Session' when no prompt", async () => {
			await runMain(makeArgs());

			expect(mockCreateSession).toHaveBeenCalledWith(
				expect.objectContaining({
					title: "New Session",
				}),
			);
		});

		it("should continue the most recent session with --continue flag", async () => {
			const sessionMeta = { id: "session-abc", title: "Last Session", updated: "2025-01-01" };
			const sessionData = {
				meta: { id: "session-abc", project: "/test/project" },
				turns: [
					{ role: "user", content: "Hello", agent: "chitragupta", model: "claude" },
					{ role: "assistant", content: "Hi!", agent: "chitragupta", model: "claude" },
				],
			};
			mockListSessions.mockReturnValue([sessionMeta]);
			mockLoadSession.mockReturnValue(sessionData);

			await runMain(makeArgs({ continue: true }));

			expect(mockListSessions).toHaveBeenCalledWith(expect.any(String));
			expect(mockLoadSession).toHaveBeenCalledWith("session-abc", expect.any(String));
			// Turns should be replayed into the agent
			expect(mockAgent.pushMessage).toHaveBeenCalledTimes(2);
			// Should NOT create a new session since we loaded one
			expect(mockCreateSession).not.toHaveBeenCalled();
		});

		it("should start fresh when --continue but no sessions exist", async () => {
			mockListSessions.mockReturnValue([]);

			await runMain(makeArgs({ continue: true }));

			// Falls through to creating a new session
			expect(mockCreateSession).toHaveBeenCalled();
		});

		it("should start fresh when --continue but session load fails", async () => {
			const sessionMeta = { id: "session-abc", title: "Corrupt", updated: "2025-01-01" };
			mockListSessions.mockReturnValue([sessionMeta]);
			mockLoadSession.mockImplementation(() => {
				throw new Error("corrupt session");
			});

			await runMain(makeArgs({ continue: true }));

			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("Could not load last session"),
			);
			expect(mockCreateSession).toHaveBeenCalled();
		});

		it("should handle the resume flag and list sessions", async () => {
			const sessions = [
				{ id: "s1", title: "Session 1", updated: "2025-06-01" },
				{ id: "s2", title: "Session 2", updated: "2025-05-01" },
			];
			const sessionData = {
				meta: { id: "s1", project: "/test/project" },
				turns: [{ role: "user", content: "Resumed", agent: "chitragupta", model: "claude" }],
			};
			mockListSessions.mockReturnValue(sessions);
			mockLoadSession.mockReturnValue(sessionData);

			await runMain(makeArgs({ resume: true }));

			expect(stdoutSpy).toHaveBeenCalledWith(
				expect.stringContaining("Recent sessions"),
			);
			expect(mockLoadSession).toHaveBeenCalledWith("s1", expect.any(String));
			expect(mockAgent.pushMessage).toHaveBeenCalledTimes(1);
		});

		it("should create new session when --resume but no sessions found", async () => {
			mockListSessions.mockReturnValue([]);

			await runMain(makeArgs({ resume: true }));

			expect(stderrSpy).toHaveBeenCalledWith(
				expect.stringContaining("No sessions found"),
			);
			expect(mockCreateSession).toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Memory loading
	// ═══════════════════════════════════════════════════════════════════════

	describe("memory", () => {
		it("should load project memory by default", async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("# Project Memory\nPrefer tabs.");

			await runMain(makeArgs());

			// Memory context should be passed to buildSystemPrompt
			expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
				expect.objectContaining({
					memoryContext: expect.stringContaining("Prefer tabs"),
				}),
			);
		});

		it("should skip memory when --noMemory is set", async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("# Project Memory\nDon't load me.");

			await runMain(makeArgs({ noMemory: true }));

			// memoryContext should be undefined since noMemory is set.
			// Since skills are mocked with size 0, skillContext is also undefined.
			expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
				expect.objectContaining({
					memoryContext: undefined,
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Agent creation and provider wiring
	// ═══════════════════════════════════════════════════════════════════════

	describe("agent creation", () => {
		it("should create an Agent with correct config", async () => {
			await runMain(makeArgs());

			expect(MockAgent).toHaveBeenCalledWith(
				expect.objectContaining({
					providerId: "anthropic",
					systemPrompt: "You are Chitragupta.",
					profile: expect.objectContaining({ id: "chitragupta" }),
				}),
			);
		});

		it("should set the resolved provider on the agent", async () => {
			const provider = { id: "anthropic", name: "Anthropic" };
			mockRegistry.get.mockReturnValue(provider);

			await runMain(makeArgs());

			expect(mockAgent.setProvider).toHaveBeenCalledWith(provider);
		});

		it("should use model from args when specified", async () => {
			await runMain(makeArgs({ model: "gpt-4o" }));

			expect(MockAgent).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "gpt-4o",
				}),
			);
		});

		it("should fall back to profile preferredModel when no args.model", async () => {
			mockLoadGlobalSettings.mockReturnValue({});
			mockResolveProfile.mockReturnValue({
				id: "chitragupta",
				name: "Chitragupta",
				personality: "Bold.",
				expertise: [],
				preferredModel: "claude-opus-4-0-20250514",
			});

			await runMain(makeArgs());

			expect(MockAgent).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-opus-4-0-20250514",
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Plugin loading
	// ═══════════════════════════════════════════════════════════════════════

	describe("plugins", () => {
		it("should load plugins and register their tools with the agent", async () => {
			const pluginTool = { definition: { name: "deploy" }, execute: vi.fn() };
			mockLoadPlugins.mockResolvedValue({
				plugins: [{ name: "deployer", tools: [pluginTool] }],
				tools: [pluginTool],
				commands: [],
			});

			await runMain(makeArgs());

			expect(mockLoadPlugins).toHaveBeenCalled();
			expect(mockAgent.registerTool).toHaveBeenCalledWith(pluginTool);
		});

		it("should handle plugin loading failure gracefully", async () => {
			mockLoadPlugins.mockRejectedValue(new Error("plugin load failed"));

			// Should not throw
			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// KaalaBrahma lifecycle registration
	// ═══════════════════════════════════════════════════════════════════════

	describe("KaalaBrahma lifecycle", () => {
		it("should register the root agent with KaalaBrahma", async () => {
			await runMain(makeArgs());

			expect(mockKaalaBrahma.registerAgent).toHaveBeenCalledWith(
				expect.objectContaining({
					agentId: "agent-1",
					status: "alive",
					depth: 0,
					parentId: null,
					purpose: "root CLI agent",
				}),
			);
			expect(mockKaalaBrahma.recordHeartbeat).toHaveBeenCalledWith("agent-1");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Cleanup and SIGINT
	// ═══════════════════════════════════════════════════════════════════════

	describe("cleanup", () => {
		it("should register beforeExit and SIGINT handlers", async () => {
			const onSpy = vi.spyOn(process, "on");

			await runMain(makeArgs());

			const events = onSpy.mock.calls.map((c) => c[0]);
			expect(events).toContain("beforeExit");
			expect(events).toContain("SIGINT");

			onSpy.mockRestore();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Optional integrations (graceful handling of missing packages)
	// ═══════════════════════════════════════════════════════════════════════

	describe("optional integrations", () => {
		it("should handle missing MCP gracefully", async () => {
			// MCP is already mocked to return empty configs, so main() should not throw.
			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});

		it("should handle vidhya-skills with zero skills gracefully", async () => {
			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});

		it("should handle dharma policy engine initialization", async () => {
			await runMain(makeArgs());

			expect(MockPolicyEngine).toHaveBeenCalled();
			expect(MockAgent).toHaveBeenCalledWith(
				expect.objectContaining({
					policyEngine: expect.objectContaining({
						check: expect.any(Function),
					}),
				}),
			);
		});

		it("should handle KaalaBrahma constructor failure gracefully", async () => {
			MockKaalaBrahma.mockImplementation(function () {
				throw new Error("KaalaBrahma unavailable");
			});

			// Should not throw; KaalaBrahma is optional
			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});

		it("should handle CommHub constructor failure gracefully", async () => {
			MockCommHub.mockImplementation(function () {
				throw new Error("CommHub unavailable");
			});

			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Configuration cascade
	// ═══════════════════════════════════════════════════════════════════════

	describe("configuration", () => {
		it("should load global settings and project config", async () => {
			await runMain(makeArgs());

			expect(mockLoadGlobalSettings).toHaveBeenCalled();
			expect(mockLoadProjectConfig).toHaveBeenCalled();
		});

		it("should create and cascade config layers", async () => {
			await runMain(makeArgs());

			expect(mockCreateConfig).toHaveBeenCalledWith("global", expect.any(Object));
			expect(mockCreateConfig).toHaveBeenCalledWith("project", expect.any(Object));
			expect(mockCascadeConfigs).toHaveBeenCalled();
		});

		it("should handle loadProjectConfig failure gracefully", async () => {
			mockLoadProjectConfig.mockImplementation(() => {
				throw new Error("no project config");
			});

			await runMain(makeArgs());

			// Should still work with empty project config
			expect(mockRunInteractiveMode).toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Project detection and context
	// ═══════════════════════════════════════════════════════════════════════

	describe("project detection", () => {
		it("should detect the current project", async () => {
			await runMain(makeArgs());

			expect(mockDetectProject).toHaveBeenCalledWith(expect.any(String));
		});

		it("should load context files for the project", async () => {
			await runMain(makeArgs());

			expect(mockLoadContextFiles).toHaveBeenCalledWith(expect.any(String));
		});

		it("should pass project info to interactive mode", async () => {
			const project = { type: "python", name: "ml-project", path: "/ml" };
			mockDetectProject.mockReturnValue(project);

			await runMain(makeArgs());

			expect(mockRunInteractiveMode).toHaveBeenCalledWith(
				expect.objectContaining({
					project,
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// System prompt construction
	// ═══════════════════════════════════════════════════════════════════════

	describe("system prompt", () => {
		it("should build the system prompt with profile, project, and context", async () => {
			await runMain(makeArgs());

			expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
				expect.objectContaining({
					profile: expect.objectContaining({ id: "chitragupta" }),
					project: expect.any(Object),
					contextFiles: expect.any(Object),
					tools: expect.any(Array),
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Provider registry initialization
	// ═══════════════════════════════════════════════════════════════════════

	describe("provider registry", () => {
		it("should create a provider registry and register built-in providers", async () => {
			await runMain(makeArgs());

			expect(mockCreateProviderRegistry).toHaveBeenCalled();
			expect(mockRegisterSwaraProviders).toHaveBeenCalledWith(mockRegistry);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Post-session consolidation
	// ═══════════════════════════════════════════════════════════════════════

	describe("post-session consolidation", () => {
		it("should run ConsolidationEngine after interactive mode returns", async () => {
			await runMain(makeArgs());

			// ConsolidationEngine should have been constructed
			expect(MockConsolidationEngine).toHaveBeenCalled();

			// Its load/consolidate/save methods should have been invoked
			const instance = MockConsolidationEngine.mock.results[0]?.value;
			expect(instance).toBeDefined();
			expect(instance.load).toHaveBeenCalled();
		});

		it("should call process.exit(0) after consolidation completes", async () => {
			await runMain(makeArgs());

			expect(exitSpy).toHaveBeenCalledWith(0);
		});

		it("should exit cleanly even if consolidation throws", async () => {
			MockConsolidationEngine.mockImplementation(function () {
				return {
					load: vi.fn(() => { throw new Error("disk full"); }),
					consolidate: vi.fn(),
					decayRules: vi.fn(),
					pruneRules: vi.fn(),
					save: vi.fn(),
				};
			});

			// Should not throw beyond the expected process.exit
			await runMain(makeArgs());

			expect(exitSpy).toHaveBeenCalledWith(0);
		});
	});
});
