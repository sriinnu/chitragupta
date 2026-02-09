import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks (created before module loading) ───────────────────────────

const {
	mockExistsSync,
	mockMkdirSync,
	mockWriteFileSync,
	mockChmodSync,
	mockGetChitraguptaHome,
	mockDefaultSettings,
	mockStdoutWrite,
	mockStdinOn,
	mockStdinRemoveListener,
	mockStdinSetRawMode,
	mockStdinResume,
	mockFetch,
} = vi.hoisted(() => ({
	mockExistsSync: vi.fn(() => false),
	mockMkdirSync: vi.fn(),
	mockWriteFileSync: vi.fn(),
	mockChmodSync: vi.fn(),
	mockGetChitraguptaHome: vi.fn(() => "/mock-home"),
	mockDefaultSettings: {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5-20250929",
		thinkingLevel: "medium",
		agentProfile: "chitragupta",
		compaction: { enabled: true, threshold: 80 },
		memory: { autoSave: true, searchDepth: 50 },
		theme: "default",
		plugins: [],
	},
	mockStdoutWrite: vi.fn(() => true),
	mockStdinOn: vi.fn(),
	mockStdinRemoveListener: vi.fn(),
	mockStdinSetRawMode: vi.fn(),
	mockStdinResume: vi.fn(),
	mockFetch: vi.fn(),
}));

vi.mock("fs", () => ({
	default: {
		existsSync: mockExistsSync,
		mkdirSync: mockMkdirSync,
		writeFileSync: mockWriteFileSync,
		chmodSync: mockChmodSync,
	},
}));

vi.mock("@chitragupta/core", () => ({
	getChitraguptaHome: mockGetChitraguptaHome,
	DEFAULT_SETTINGS: mockDefaultSettings,
}));

vi.mock("@chitragupta/ui/ansi", () => ({
	bold: (s: string) => s,
	dim: (s: string) => s,
	green: (s: string) => s,
	cyan: (s: string) => s,
	yellow: (s: string) => s,
	red: (s: string) => s,
}));

// Import AFTER mocks are defined
import { isFirstRun, runOnboarding } from "../src/onboarding.js";

// ─── Stdin/Stdout Helpers ────────────────────────────────────────────────────

/** Original process references, saved for restoration. */
let originalStdoutWrite: typeof process.stdout.write;
let originalStdinOn: typeof process.stdin.on;
let originalStdinRemoveListener: typeof process.stdin.removeListener;
let originalStdinSetRawMode: typeof process.stdin.setRawMode;
let originalStdinResume: typeof process.stdin.resume;
let originalStdinIsTTY: boolean | undefined;
let originalStdinIsRaw: boolean | undefined;

function installProcessMocks(): void {
	originalStdoutWrite = process.stdout.write;
	originalStdinOn = process.stdin.on;
	originalStdinRemoveListener = process.stdin.removeListener;
	originalStdinResume = process.stdin.resume;
	originalStdinIsTTY = process.stdin.isTTY;
	originalStdinIsRaw = process.stdin.isRaw;

	process.stdout.write = mockStdoutWrite as unknown as typeof process.stdout.write;
	process.stdin.on = mockStdinOn as unknown as typeof process.stdin.on;
	process.stdin.removeListener = mockStdinRemoveListener as unknown as typeof process.stdin.removeListener;
	process.stdin.resume = mockStdinResume;
	Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	Object.defineProperty(process.stdin, "isRaw", { value: false, configurable: true });

	if (typeof process.stdin.setRawMode === "function") {
		originalStdinSetRawMode = process.stdin.setRawMode;
	}
	process.stdin.setRawMode = mockStdinSetRawMode as unknown as typeof process.stdin.setRawMode;
}

function restoreProcessMocks(): void {
	process.stdout.write = originalStdoutWrite;
	process.stdin.on = originalStdinOn;
	process.stdin.removeListener = originalStdinRemoveListener;
	process.stdin.resume = originalStdinResume;
	if (originalStdinSetRawMode) {
		process.stdin.setRawMode = originalStdinSetRawMode;
	}
	Object.defineProperty(process.stdin, "isTTY", { value: originalStdinIsTTY, configurable: true });
	Object.defineProperty(process.stdin, "isRaw", { value: originalStdinIsRaw, configurable: true });
}

/**
 * Queue stdin responses that will be delivered to the `on("data", cb)` handler
 * registered by readLine/selectOption. Each response simulates typing + enter.
 */
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

/** Collect all text written to stdout for assertion. */
function capturedOutput(): string {
	return mockStdoutWrite.mock.calls.map((c: unknown[]) => String(c[0])).join("");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Onboarding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(false);
		mockGetChitraguptaHome.mockReturnValue("/mock-home");
		installProcessMocks();

		// Default: global fetch mock returning 200
		globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});
	});

	afterEach(() => {
		restoreProcessMocks();
		vi.restoreAllMocks();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// isFirstRun
	// ═══════════════════════════════════════════════════════════════════════

	describe("isFirstRun", () => {
		it("should return true when home directory does not exist", () => {
			mockExistsSync.mockReturnValue(false);
			expect(isFirstRun()).toBe(true);
		});

		it("should return false when home directory exists", () => {
			mockExistsSync.mockReturnValue(true);
			expect(isFirstRun()).toBe(false);
		});

		it("should call getChitraguptaHome to determine the path", () => {
			isFirstRun();
			expect(mockGetChitraguptaHome).toHaveBeenCalled();
		});

		it("should pass getChitraguptaHome result to existsSync", () => {
			mockGetChitraguptaHome.mockReturnValue("/custom-home");
			isFirstRun();
			expect(mockExistsSync).toHaveBeenCalledWith("/custom-home");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// runOnboarding — Anthropic (full success flow)
	// ═══════════════════════════════════════════════════════════════════════

	describe("runOnboarding — Anthropic full flow", () => {
		it("should complete full onboarding with Anthropic provider", async () => {
			// Responses: "1" = Anthropic provider, "sk-ant-test-key" = API key
			queueStdinResponses("1", "sk-ant-test-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const result = await runOnboarding();

			expect(result.provider).toBe("anthropic");
			expect(result.model).toBe("claude-sonnet-4-5-20250929");
			expect(result.completed).toBe(true);
		});

		it("should create config directory with recursive flag", async () => {
			queueStdinResponses("1", "sk-ant-test-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			expect(mockMkdirSync).toHaveBeenCalledWith("/mock-home/config", { recursive: true });
		});

		it("should create memory, sessions, and profiles directories", async () => {
			queueStdinResponses("1", "sk-ant-test-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			expect(mockMkdirSync).toHaveBeenCalledWith("/mock-home/memory", { recursive: true });
			expect(mockMkdirSync).toHaveBeenCalledWith("/mock-home/sessions", { recursive: true });
			expect(mockMkdirSync).toHaveBeenCalledWith("/mock-home/profiles", { recursive: true });
		});

		it("should write credentials.json with correct env var and chmod 0o600", async () => {
			queueStdinResponses("1", "sk-ant-test-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			// Find the credentials.json write call
			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			expect(credCalls.length).toBe(1);
			const credContent = JSON.parse(credCalls[0][1] as string);
			expect(credContent).toHaveProperty("ANTHROPIC_API_KEY", "sk-ant-test-key");

			expect(mockChmodSync).toHaveBeenCalledWith("/mock-home/config/credentials.json", 0o600);
		});

		it("should write settings.json with provider and model", async () => {
			queueStdinResponses("1", "sk-ant-test-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const settingsCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("settings.json"),
			);
			expect(settingsCalls.length).toBe(1);
			const settings = JSON.parse(settingsCalls[0][1] as string);
			expect(settings.defaultProvider).toBe("anthropic");
			expect(settings.defaultModel).toBe("claude-sonnet-4-5-20250929");
		});

		it("should display welcome message", async () => {
			queueStdinResponses("1", "sk-ant-test-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Welcome to Chitragupta");
		});

		it("should display success message on completion", async () => {
			queueStdinResponses("1", "sk-ant-test-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("You're ready.");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// runOnboarding — OpenAI
	// ═══════════════════════════════════════════════════════════════════════

	describe("runOnboarding — OpenAI", () => {
		it("should select OpenAI provider with correct defaults", async () => {
			queueStdinResponses("2", "sk-openai-test");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const result = await runOnboarding();

			expect(result.provider).toBe("openai");
			expect(result.model).toBe("gpt-4o");
			expect(result.completed).toBe(true);
		});

		it("should store credential under OPENAI_API_KEY", async () => {
			queueStdinResponses("2", "sk-openai-test");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			const credContent = JSON.parse(credCalls[0][1] as string);
			expect(credContent).toHaveProperty("OPENAI_API_KEY", "sk-openai-test");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// runOnboarding — Google
	// ═══════════════════════════════════════════════════════════════════════

	describe("runOnboarding — Google", () => {
		it("should select Google provider with correct defaults", async () => {
			queueStdinResponses("3", "AIza-google-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const result = await runOnboarding();

			expect(result.provider).toBe("google");
			expect(result.model).toBe("gemini-2.0-flash");
			expect(result.completed).toBe(true);
		});

		it("should store credential under GOOGLE_API_KEY", async () => {
			queueStdinResponses("3", "AIza-google-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			const credContent = JSON.parse(credCalls[0][1] as string);
			expect(credContent).toHaveProperty("GOOGLE_API_KEY", "AIza-google-key");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// runOnboarding — Ollama
	// ═══════════════════════════════════════════════════════════════════════

	describe("runOnboarding — Ollama", () => {
		it("should select Ollama and use default endpoint when empty input", async () => {
			// "4" = Ollama, "" = accept default endpoint
			queueStdinResponses("4", "");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const result = await runOnboarding();

			expect(result.provider).toBe("ollama");
			expect(result.model).toBe("llama3.2");
			expect(result.completed).toBe(true);
		});

		it("should store OLLAMA_HOST with default endpoint", async () => {
			queueStdinResponses("4", "");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			const credContent = JSON.parse(credCalls[0][1] as string);
			expect(credContent).toHaveProperty("OLLAMA_HOST", "http://localhost:11434");
		});

		it("should store custom Ollama endpoint", async () => {
			queueStdinResponses("4", "http://myhost:8080");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			const credContent = JSON.parse(credCalls[0][1] as string);
			expect(credContent).toHaveProperty("OLLAMA_HOST", "http://myhost:8080");
		});

		it("should set ollamaEndpoint in settings.json", async () => {
			queueStdinResponses("4", "http://myhost:8080");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const settingsCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("settings.json"),
			);
			const settings = JSON.parse(settingsCalls[0][1] as string);
			expect(settings.ollamaEndpoint).toBe("http://myhost:8080");
		});

		it("should ping /api/tags for Ollama connection test", async () => {
			queueStdinResponses("4", "");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:11434/api/tags",
				expect.objectContaining({
					signal: expect.any(AbortSignal),
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// runOnboarding — OpenAI-compatible
	// ═══════════════════════════════════════════════════════════════════════

	describe("runOnboarding — OpenAI-compatible", () => {
		it("should select OpenAI-compatible provider", async () => {
			queueStdinResponses("5", "custom-key-123");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const result = await runOnboarding();

			expect(result.provider).toBe("openai-compat");
			expect(result.model).toBe("gpt-4o");
			expect(result.completed).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// runOnboarding — Empty key (incomplete flow)
	// ═══════════════════════════════════════════════════════════════════════

	describe("runOnboarding — empty key", () => {
		it("should return completed:false when no key is provided", async () => {
			// "1" = Anthropic, "" = empty key
			queueStdinResponses("1", "");
			const result = await runOnboarding();

			expect(result.provider).toBe("anthropic");
			expect(result.model).toBe("claude-sonnet-4-5-20250929");
			expect(result.completed).toBe(false);
		});

		it("should display hint to set key later", async () => {
			queueStdinResponses("1", "");
			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("No key provided");
			expect(output).toContain("chitragupta provider add anthropic");
		});

		it("should not write any config files when key is empty", async () => {
			queueStdinResponses("1", "");
			await runOnboarding();

			expect(mockMkdirSync).not.toHaveBeenCalled();
			expect(mockWriteFileSync).not.toHaveBeenCalled();
			expect(mockChmodSync).not.toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Connection test scenarios (tested via runOnboarding)
	// ═══════════════════════════════════════════════════════════════════════

	describe("testConnection — via runOnboarding", () => {
		it("should show 'Credentials verified' on 200 OK", async () => {
			queueStdinResponses("1", "sk-ant-valid");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Credentials verified");
		});

		it("should show 'Authentication failed' on 401", async () => {
			queueStdinResponses("1", "sk-ant-bad");
			mockFetch.mockResolvedValue({ ok: false, status: 401 });

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Authentication failed");
		});

		it("should show 'Authentication failed' on 403", async () => {
			queueStdinResponses("1", "sk-ant-forbidden");
			mockFetch.mockResolvedValue({ ok: false, status: 403 });

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Authentication failed");
		});

		it("should treat 429 as valid credentials (rate limited)", async () => {
			queueStdinResponses("1", "sk-ant-ratelimited");
			mockFetch.mockResolvedValue({ ok: false, status: 429 });

			const result = await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Rate limited, but credentials are valid");
			expect(result.completed).toBe(true);
		});

		it("should show error on other HTTP failures", async () => {
			queueStdinResponses("1", "sk-ant-error");
			mockFetch.mockResolvedValue({ ok: false, status: 500 });

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Request failed (HTTP 500)");
		});

		it("should handle timeout error", async () => {
			queueStdinResponses("1", "sk-ant-timeout");
			mockFetch.mockRejectedValue(new Error("The operation was aborted due to timeout"));

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Connection timed out");
		});

		it("should handle generic network error", async () => {
			queueStdinResponses("1", "sk-ant-netfail");
			mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Connection failed: ECONNREFUSED");
		});

		it("should save credentials even when connection test fails", async () => {
			queueStdinResponses("1", "sk-ant-bad");
			mockFetch.mockResolvedValue({ ok: false, status: 401 });

			const result = await runOnboarding();

			// Credentials should still be written
			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			expect(credCalls.length).toBe(1);
			expect(result.completed).toBe(true);

			const output = capturedOutput();
			expect(output).toContain("Saving credentials anyway");
		});

		it("should show 'Connected to Ollama' on successful Ollama ping", async () => {
			queueStdinResponses("4", "");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Connected to Ollama");
		});

		it("should handle Ollama connection failure", async () => {
			queueStdinResponses("4", "");
			mockFetch.mockResolvedValue({ ok: false, status: 500 });

			await runOnboarding();

			// Ollama with !res.ok throws, caught in the catch block
			const output = capturedOutput();
			expect(output).toContain("Connection failed");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// buildTestRequest — verified via fetch call args
	// ═══════════════════════════════════════════════════════════════════════

	describe("buildTestRequest — via fetch arguments", () => {
		it("should use api.anthropic.com with x-api-key header for Anthropic", async () => {
			queueStdinResponses("1", "sk-ant-123");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.anthropic.com/v1/messages",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"x-api-key": "sk-ant-123",
						"anthropic-version": "2023-06-01",
					}),
				}),
			);
		});

		it("should use generativelanguage.googleapis.com with key in URL for Google", async () => {
			queueStdinResponses("3", "AIza-google-123");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const fetchUrl = mockFetch.mock.calls[0][0] as string;
			expect(fetchUrl).toContain("generativelanguage.googleapis.com");
			expect(fetchUrl).toContain("key=AIza-google-123");
		});

		it("should use api.openai.com with Bearer auth for OpenAI", async () => {
			queueStdinResponses("2", "sk-openai-456");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/chat/completions",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Authorization": "Bearer sk-openai-456",
					}),
				}),
			);
		});

		it("should use OpenAI-compatible endpoint for provider 5", async () => {
			queueStdinResponses("5", "custom-key-789");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/chat/completions",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Authorization": "Bearer custom-key-789",
					}),
				}),
			);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// selectOption — invalid then valid input
	// ═══════════════════════════════════════════════════════════════════════

	describe("selectOption — input validation", () => {
		it("should reject invalid choice and re-prompt until valid", async () => {
			// First "9" is invalid (only 5 providers), then "1" is valid
			// Then "sk-key" for the API key
			let callIndex = 0;
			const responses = ["9", "1", "sk-key"];
			mockStdinOn.mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
				if (event === "data" && callIndex < responses.length) {
					const idx = callIndex++;
					setTimeout(() => cb(Buffer.from(responses[idx] + "\r")), 0);
				}
				return process.stdin;
			});

			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			const result = await runOnboarding();

			const output = capturedOutput();
			expect(output).toContain("Invalid choice");
			expect(result.provider).toBe("anthropic");
			expect(result.completed).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Settings content validation
	// ═══════════════════════════════════════════════════════════════════════

	describe("settings content", () => {
		it("should not set ollamaEndpoint for non-Ollama providers", async () => {
			queueStdinResponses("1", "sk-ant-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const settingsCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("settings.json"),
			);
			const settings = JSON.parse(settingsCalls[0][1] as string);
			expect(settings.ollamaEndpoint).toBeUndefined();
		});

		it("should spread DEFAULT_SETTINGS into written settings", async () => {
			queueStdinResponses("1", "sk-ant-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const settingsCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("settings.json"),
			);
			const settings = JSON.parse(settingsCalls[0][1] as string);
			// Should contain DEFAULT_SETTINGS fields
			expect(settings.thinkingLevel).toBe("medium");
			expect(settings.agentProfile).toBe("chitragupta");
			expect(settings.theme).toBe("default");
		});

		it("should use tab indentation in written JSON files", async () => {
			queueStdinResponses("1", "sk-ant-key");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			const rawJson = credCalls[0][1] as string;
			expect(rawJson).toContain("\t");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Edge cases
	// ═══════════════════════════════════════════════════════════════════════

	describe("edge cases", () => {
		it("should trim whitespace from API key input", async () => {
			queueStdinResponses("1", "  sk-ant-with-spaces  ");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			const credContent = JSON.parse(credCalls[0][1] as string);
			expect(credContent.ANTHROPIC_API_KEY).toBe("sk-ant-with-spaces");
		});

		it("should trim whitespace from Ollama endpoint input", async () => {
			queueStdinResponses("4", "  http://myhost:1234  ");
			mockFetch.mockResolvedValue({ ok: true, status: 200 });

			await runOnboarding();

			const credCalls = mockWriteFileSync.mock.calls.filter(
				(c: unknown[]) => String(c[0]).includes("credentials.json"),
			);
			const credContent = JSON.parse(credCalls[0][1] as string);
			expect(credContent.OLLAMA_HOST).toBe("http://myhost:1234");
		});

		it("should handle whitespace-only key as empty (completed:false)", async () => {
			queueStdinResponses("1", "   ");
			const result = await runOnboarding();

			expect(result.completed).toBe(false);
		});
	});
});
