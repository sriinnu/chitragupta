import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "node:child_process";
import * as util from "node:util";

// Mock child_process.execFile before importing the module
vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:util", async (importOriginal) => {
	const orig = await importOriginal<typeof import("node:util")>();
	return {
		...orig,
		promisify: vi.fn((fn: any) => fn),
	};
});

describe("CLI Availability Detection", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should detect available CLI tools", async () => {
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation((cmd: any, args: any, _opts: any) => {
			if (cmd === "which") {
				const command = args[0];
				if (command === "claude") {
					return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" }) as any;
				}
				if (command === "gemini") {
					return Promise.resolve({ stdout: "/usr/local/bin/gemini\n", stderr: "" }) as any;
				}
				return Promise.reject(new Error("not found")) as any;
			}
			if (args && args[0] === "--version") {
				if (cmd === "claude") {
					return Promise.resolve({ stdout: "claude 1.0.0\n", stderr: "" }) as any;
				}
				if (cmd === "gemini") {
					return Promise.resolve({ stdout: "gemini 2.0.0\n", stderr: "" }) as any;
				}
			}
			return Promise.reject(new Error("unknown")) as any;
		});

		const { detectAvailableCLIs } = await import("../src/providers/cli-detection.js");
		const results = await detectAvailableCLIs();

		expect(results.length).toBe(4);
		const claudeResult = results.find((r) => r.command === "claude");
		expect(claudeResult).toBeDefined();
		expect(claudeResult!.available).toBe(true);
		expect(claudeResult!.path).toBe("/usr/local/bin/claude");
		expect(claudeResult!.version).toBe("claude 1.0.0");

		const geminiResult = results.find((r) => r.command === "gemini");
		expect(geminiResult).toBeDefined();
		expect(geminiResult!.available).toBe(true);

		const codexResult = results.find((r) => r.command === "codex");
		expect(codexResult).toBeDefined();
		expect(codexResult!.available).toBe(false);

		const aiderResult = results.find((r) => r.command === "aider");
		expect(aiderResult).toBeDefined();
		expect(aiderResult!.available).toBe(false);
	});

	it("should return best CLI provider (claude has highest priority)", async () => {
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation((cmd: any, args: any, _opts: any) => {
			if (cmd === "which") {
				const command = args[0];
				if (command === "claude" || command === "gemini") {
					return Promise.resolve({ stdout: `/usr/local/bin/${command}\n`, stderr: "" }) as any;
				}
				return Promise.reject(new Error("not found")) as any;
			}
			return Promise.resolve({ stdout: "1.0.0\n", stderr: "" }) as any;
		});

		const { getBestCLIProvider } = await import("../src/providers/cli-detection.js");
		const best = await getBestCLIProvider();
		expect(best).not.toBeNull();
		expect(best!.id).toBe("claude-code");
	});

	it("should return gemini when claude is not available", async () => {
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation((cmd: any, args: any, _opts: any) => {
			if (cmd === "which") {
				const command = args[0];
				if (command === "gemini") {
					return Promise.resolve({ stdout: "/usr/local/bin/gemini\n", stderr: "" }) as any;
				}
				return Promise.reject(new Error("not found")) as any;
			}
			return Promise.resolve({ stdout: "2.0.0\n", stderr: "" }) as any;
		});

		const { getBestCLIProvider } = await import("../src/providers/cli-detection.js");
		const best = await getBestCLIProvider();
		expect(best).not.toBeNull();
		expect(best!.id).toBe("gemini-cli");
	});

	it("should return null when no CLI tools are available", async () => {
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation(() => {
			return Promise.reject(new Error("not found")) as any;
		});

		const { getBestCLIProvider } = await import("../src/providers/cli-detection.js");
		const best = await getBestCLIProvider();
		expect(best).toBeNull();
	});

	it("should handle version detection failure gracefully", async () => {
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation((cmd: any, args: any, _opts: any) => {
			if (cmd === "which") {
				if (args[0] === "claude") {
					return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" }) as any;
				}
				return Promise.reject(new Error("not found")) as any;
			}
			// version detection fails
			return Promise.reject(new Error("no --version support")) as any;
		});

		const { detectAvailableCLIs } = await import("../src/providers/cli-detection.js");
		const results = await detectAvailableCLIs();
		const claudeResult = results.find((r) => r.command === "claude");
		expect(claudeResult!.available).toBe(true);
		expect(claudeResult!.version).toBeUndefined();
	});

	it("should detect all 4 CLI tools", async () => {
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation((cmd: any, args: any, _opts: any) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: `/usr/local/bin/${args[0]}\n`, stderr: "" }) as any;
			}
			return Promise.resolve({ stdout: "1.0.0\n", stderr: "" }) as any;
		});

		const { detectAvailableCLIs } = await import("../src/providers/cli-detection.js");
		const results = await detectAvailableCLIs();
		expect(results.length).toBe(4);
		for (const r of results) {
			expect(r.available).toBe(true);
		}
	});

	it("should handle empty which output as not available", async () => {
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation((cmd: any, _args: any, _opts: any) => {
			if (cmd === "which") {
				return Promise.resolve({ stdout: "", stderr: "" }) as any;
			}
			return Promise.reject(new Error("not found")) as any;
		});

		const { detectAvailableCLIs } = await import("../src/providers/cli-detection.js");
		const results = await detectAvailableCLIs();
		for (const r of results) {
			expect(r.available).toBe(false);
		}
	});

	it("should probe all CLIs concurrently", async () => {
		let callCount = 0;
		const mockExecFile = vi.mocked(childProcess.execFile);
		mockExecFile.mockImplementation(() => {
			callCount++;
			return Promise.reject(new Error("not found")) as any;
		});

		const { detectAvailableCLIs } = await import("../src/providers/cli-detection.js");
		await detectAvailableCLIs();
		// Should make at least 4 which calls (one per CLI)
		expect(callCount).toBeGreaterThanOrEqual(4);
	});
});
