import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────

const {
	mockExistsSync,
	mockMkdirSync,
	mockReadFileSync,
	mockWriteFileSync,
	mockChmodSync,
	mockGetChitraguptaHome,
	mockDefaultSettings,
	mockRegisterSwaraProviders,
	mockStdoutWrite,
	mockStderrWrite,
	mockStdinOn,
	mockStdinRemoveListener,
	mockStdinSetRawMode,
	mockStdinResume,
} = vi.hoisted(() => ({
	mockExistsSync: vi.fn(() => false),
	mockMkdirSync: vi.fn(),
	mockReadFileSync: vi.fn(() => "{}"),
	mockWriteFileSync: vi.fn(),
	mockChmodSync: vi.fn(),
	mockGetChitraguptaHome: vi.fn(() => "/mock-home"),
	mockDefaultSettings: {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5-20250929",
		thinkingLevel: "medium",
		agentProfile: "chitragupta",
	},
	mockRegisterSwaraProviders: vi.fn(),
	mockStdoutWrite: vi.fn(() => true),
	mockStderrWrite: vi.fn(() => true),
	mockStdinOn: vi.fn(),
	mockStdinRemoveListener: vi.fn(),
	mockStdinSetRawMode: vi.fn(),
	mockStdinResume: vi.fn(),
}));

vi.mock("fs", () => ({
	default: {
		existsSync: mockExistsSync,
		mkdirSync: mockMkdirSync,
		readFileSync: mockReadFileSync,
		writeFileSync: mockWriteFileSync,
		chmodSync: mockChmodSync,
	},
}));

vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: mockGetChitraguptaHome,
	DEFAULT_SETTINGS: mockDefaultSettings,
}));

vi.mock("@chitragupta/swara/providers", () => ({
	registerBuiltinProviders: mockRegisterSwaraProviders,
}));

// Import after mocks
import { guideProviderSetup, detectEnvApiKeys } from "../src/provider-setup.js";
import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";
import type { CLIAvailability } from "@chitragupta/swara";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Original process references. */
let origStdoutWrite: typeof process.stdout.write;
let origStderrWrite: typeof process.stderr.write;
let origStdinOn: typeof process.stdin.on;
let origStdinRemoveListener: typeof process.stdin.removeListener;
let origStdinSetRawMode: typeof process.stdin.setRawMode;
let origStdinResume: typeof process.stdin.resume;
let origStdinIsTTY: boolean | undefined;
let origStdinIsRaw: boolean | undefined;

function installProcessMocks(): void {
	origStdoutWrite = process.stdout.write;
	origStderrWrite = process.stderr.write;
	origStdinOn = process.stdin.on;
	origStdinRemoveListener = process.stdin.removeListener;
	origStdinResume = process.stdin.resume;
	origStdinIsTTY = process.stdin.isTTY;
	origStdinIsRaw = process.stdin.isRaw;

	process.stdout.write = mockStdoutWrite as unknown as typeof process.stdout.write;
	process.stderr.write = mockStderrWrite as unknown as typeof process.stderr.write;
	process.stdin.on = mockStdinOn as unknown as typeof process.stdin.on;
	process.stdin.removeListener = mockStdinRemoveListener as unknown as typeof process.stdin.removeListener;
	process.stdin.resume = mockStdinResume;
	Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	Object.defineProperty(process.stdin, "isRaw", { value: false, configurable: true });
	if (typeof process.stdin.setRawMode === "function") {
		origStdinSetRawMode = process.stdin.setRawMode;
	}
	process.stdin.setRawMode = mockStdinSetRawMode as unknown as typeof process.stdin.setRawMode;
}

function restoreProcessMocks(): void {
	process.stdout.write = origStdoutWrite;
	process.stderr.write = origStderrWrite;
	process.stdin.on = origStdinOn;
	process.stdin.removeListener = origStdinRemoveListener;
	process.stdin.resume = origStdinResume;
	if (origStdinSetRawMode) process.stdin.setRawMode = origStdinSetRawMode;
	Object.defineProperty(process.stdin, "isTTY", { value: origStdinIsTTY, configurable: true });
	Object.defineProperty(process.stdin, "isRaw", { value: origStdinIsRaw, configurable: true });
}

function queueStdinResponses(...responses: string[]): void {
	let callIndex = 0;
	mockStdinOn.mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
		if (event === "data" && callIndex < responses.length) {
			const idx = callIndex++;
			setTimeout(() => cb(Buffer.from(responses[idx] + "\r")), 0);
		}
		return process.stdin;
	});
}

function capturedStderr(): string {
	return mockStderrWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
}

function capturedStdout(): string {
	return mockStdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
}

/** Create a mock provider registry. */
function createMockRegistry(): ProviderRegistry {
	const providers = new Map<string, { id: string }>();
	return {
		register: vi.fn((p: { id: string }) => { providers.set(p.id, p); }),
		get: vi.fn((id: string) => providers.get(id) ?? null),
		getAll: vi.fn(() => [...providers.values()]),
		remove: vi.fn(),
	} as unknown as ProviderRegistry;
}

/** Create mock CLI results — all unavailable by default. */
function createMockCLIResults(): CLIAvailability[] {
	return [
		{ command: "claude", available: false },
		{ command: "gemini", available: false },
		{ command: "copilot", available: false },
		{ command: "codex", available: false },
		{ command: "aider", available: false },
		{ command: "zai", available: false },
		{ command: "minimax", available: false },
	];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("provider-setup", () => {
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		vi.clearAllMocks();
		installProcessMocks();
		// Save and clear relevant env vars
		for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"]) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		restoreProcessMocks();
		// Restore env vars
		for (const [key, val] of Object.entries(savedEnv)) {
			if (val === undefined) { delete process.env[key]; } else { process.env[key] = val; }
		}
	});

	// ═════════════════════════════════════════════════════════════════════════
	// detectEnvApiKeys
	// ═════════════════════════════════════════════════════════════════════════

	describe("detectEnvApiKeys", () => {
		it("should return empty when no env vars are set", () => {
			expect(detectEnvApiKeys()).toEqual([]);
		});

		it("should detect ANTHROPIC_API_KEY", () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-test";
			const result = detectEnvApiKeys();
			expect(result.length).toBe(1);
			expect(result[0].providerId).toBe("anthropic");
		});

		it("should detect OPENAI_API_KEY", () => {
			process.env.OPENAI_API_KEY = "sk-openai-test";
			const result = detectEnvApiKeys();
			expect(result.length).toBe(1);
			expect(result[0].providerId).toBe("openai");
		});

		it("should detect multiple keys", () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-test";
			process.env.OPENAI_API_KEY = "sk-openai-test";
			const result = detectEnvApiKeys();
			expect(result.length).toBe(2);
		});

		it("should ignore empty string values", () => {
			process.env.ANTHROPIC_API_KEY = "";
			expect(detectEnvApiKeys()).toEqual([]);
		});

		it("should ignore whitespace-only values", () => {
			process.env.ANTHROPIC_API_KEY = "   ";
			expect(detectEnvApiKeys()).toEqual([]);
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// guideProviderSetup — auto-detect from env vars
	// ═════════════════════════════════════════════════════════════════════════

	describe("guideProviderSetup — env var auto-detect", () => {
		it("should auto-configure when ANTHROPIC_API_KEY is set", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
			const registry = createMockRegistry();
			// When registerSwaraProviders is called, simulate registering anthropic
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "anthropic" } as never);
			});

			const result = await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(result.configured).toBe(true);
			expect(result.providerId).toBe("anthropic");
		});

		it("should print diagnostic before auto-configuring", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "anthropic" } as never);
			});

			await guideProviderSetup(registry, createMockCLIResults(), false);

			const output = capturedStderr();
			expect(output).toContain("No AI provider detected");
			expect(output).toContain("claude");
			expect(output).toContain("Ollama");
		});

		it("should print found API key message", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "anthropic" } as never);
			});

			await guideProviderSetup(registry, createMockCLIResults(), false);

			const output = capturedStderr();
			expect(output).toContain("Found API key");
			expect(output).toContain("Anthropic");
		});

		it("should persist provider choice on auto-detect", async () => {
			process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "anthropic" } as never);
			});

			await guideProviderSetup(registry, createMockCLIResults(), false);

			const settingsCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("settings.json"),
			);
			expect(settingsCalls.length).toBe(1);
			const settings = JSON.parse(settingsCalls[0][1] as string);
			expect(settings.defaultProvider).toBe("anthropic");
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// guideProviderSetup — non-TTY
	// ═════════════════════════════════════════════════════════════════════════

	describe("guideProviderSetup — non-TTY", () => {
		it("should return configured:false and print guidance", async () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
			const registry = createMockRegistry();

			const result = await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(result.configured).toBe(false);
			const output = capturedStderr();
			expect(output).toContain("export ANTHROPIC_API_KEY");
			expect(output).toContain("ollama serve");
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// guideProviderSetup — interactive TTY
	// ═════════════════════════════════════════════════════════════════════════

	describe("guideProviderSetup — interactive TTY", () => {
		it("should present menu and accept Anthropic API key", async () => {
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "anthropic" } as never);
			});

			queueStdinResponses("1", "sk-ant-entered");

			const result = await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(result.configured).toBe(true);
			expect(result.providerId).toBe("anthropic");
		});

		it("should save credentials.json with chmod 0o600", async () => {
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "anthropic" } as never);
			});

			queueStdinResponses("1", "sk-ant-entered");

			await guideProviderSetup(registry, createMockCLIResults(), false);

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			expect(credCalls.length).toBe(1);
			const creds = JSON.parse(credCalls[0][1] as string);
			expect(creds.ANTHROPIC_API_KEY).toBe("sk-ant-entered");
			expect(mockChmodSync).toHaveBeenCalledWith("/mock-home/config/credentials.json", 0o600);
		});

		it("should accept OpenAI API key (choice 2)", async () => {
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "openai" } as never);
			});

			queueStdinResponses("2", "sk-openai-entered");

			const result = await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(result.configured).toBe(true);
			expect(result.providerId).toBe("openai");
		});

		it("should accept Google API key (choice 3)", async () => {
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "google" } as never);
			});

			queueStdinResponses("3", "AIza-google-entered");

			const result = await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(result.configured).toBe(true);
			expect(result.providerId).toBe("google");
		});

		it("should return configured:false when user skips (choice 4)", async () => {
			const registry = createMockRegistry();

			queueStdinResponses("4");

			const result = await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(result.configured).toBe(false);
		});

		it("should return configured:false when empty key is entered", async () => {
			const registry = createMockRegistry();

			queueStdinResponses("1", "");

			const result = await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(result.configured).toBe(false);
		});

		it("should set env var in process.env after saving key", async () => {
			const registry = createMockRegistry();
			mockRegisterSwaraProviders.mockImplementation((reg: ProviderRegistry) => {
				(reg as ReturnType<typeof createMockRegistry>).register({ id: "anthropic" } as never);
			});

			queueStdinResponses("1", "sk-ant-for-env");

			await guideProviderSetup(registry, createMockCLIResults(), false);

			expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-for-env");
		});
	});

	// ═════════════════════════════════════════════════════════════════════════
	// Diagnostic output
	// ═════════════════════════════════════════════════════════════════════════

	describe("diagnostic output", () => {
		it("should show CLI detection results", async () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
			const registry = createMockRegistry();
			const cliResults: CLIAvailability[] = [
				{ command: "claude", available: false },
				{ command: "gemini", available: true, version: "1.0" },
			];

			await guideProviderSetup(registry, cliResults, false);

			const output = capturedStderr();
			expect(output).toContain("claude");
			expect(output).toContain("not found");
			expect(output).toContain("gemini");
			// gemini is available, should show "found"
			expect(output).toContain("found");
		});

		it("should show Ollama status", async () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
			const registry = createMockRegistry();

			await guideProviderSetup(registry, createMockCLIResults(), true);

			const output = capturedStderr();
			expect(output).toContain("running");
		});

		it("should show env var status", async () => {
			Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
			const registry = createMockRegistry();

			await guideProviderSetup(registry, createMockCLIResults(), false);

			const output = capturedStderr();
			expect(output).toContain("ANTHROPIC_API_KEY");
			expect(output).toContain("OPENAI_API_KEY");
			expect(output).toContain("not set");
		});
	});
});
