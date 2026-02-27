import { describe, expect, it, vi } from "vitest";
import { runAgentPromptWithFallback, type SmartPromptDeps } from "../src/modes/mcp-agent-prompt.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a deps object with sensible defaults that can be overridden. */
function makeDeps(overrides: Partial<SmartPromptDeps> = {}): SmartPromptDeps {
	return {
		detectCLIs: async () => [],
		executeCLI: async () => ({ stdout: "", stderr: "", exitCode: 1, killed: false }),
		loadProjectMemory: () => undefined,
		getCompletionRouter: async () => null,
		margaDecide: () => null,
		...overrides,
	};
}

describe("runAgentPromptWithFallback", () => {
	it("returns CLI response when a CLI succeeds", async () => {
		const deps = makeDeps({
			detectCLIs: async () => [
				{ command: "claude", available: true },
				{ command: "gemini", available: false },
			],
			executeCLI: async (cmd) => {
				if (cmd === "claude") {
					return { stdout: "hello from claude", stderr: "", exitCode: 0, killed: false };
				}
				return { stdout: "", stderr: "not found", exitCode: 1, killed: false };
			},
		});

		const result = await runAgentPromptWithFallback({ message: "test" }, deps);

		expect(result.response).toBe("hello from claude");
		expect(result.providerId).toBe("claude");
		expect(result.attempts).toBe(1);
	});

	it("falls back to next CLI when first CLI fails", async () => {
		const deps = makeDeps({
			detectCLIs: async () => [
				{ command: "claude", available: true },
				{ command: "gemini", available: true },
			],
			executeCLI: async (cmd) => {
				if (cmd === "claude") {
					return { stdout: "", stderr: "connection error", exitCode: 1, killed: false };
				}
				if (cmd === "gemini") {
					return { stdout: "gemini response", stderr: "", exitCode: 0, killed: false };
				}
				return { stdout: "", stderr: "", exitCode: 1, killed: false };
			},
		});

		const result = await runAgentPromptWithFallback({ message: "test" }, deps);

		expect(result.response).toBe("gemini response");
		expect(result.providerId).toBe("gemini");
	});

	it("falls back to API when all CLIs fail", async () => {
		const deps = makeDeps({
			detectCLIs: async () => [
				{ command: "claude", available: true },
			],
			executeCLI: async () => ({
				stdout: "", stderr: "crash", exitCode: 1, killed: false,
			}),
			getCompletionRouter: async () => ({
				complete: async () => ({
					content: [{ type: "text", text: "api response" }],
				}),
			}),
			margaDecide: () => ({ providerId: "anthropic", modelId: "claude-sonnet-4-5-20250929" }),
		});

		const result = await runAgentPromptWithFallback({ message: "test" }, deps);

		expect(result.response).toBe("api response");
		expect(result.providerId).toContain("api:");
		expect(result.attempts).toBeGreaterThanOrEqual(2);
	});

	it("throws when all providers fail (CLI + API)", async () => {
		const deps = makeDeps({
			detectCLIs: async () => [{ command: "claude", available: true }],
			executeCLI: async () => ({
				stdout: "", stderr: "fail", exitCode: 1, killed: false,
			}),
			getCompletionRouter: async () => null,
		});

		await expect(
			runAgentPromptWithFallback({ message: "test" }, deps),
		).rejects.toThrow(/All attempts failed/i);
	});

	it("detects auth errors and reports re-auth hints", async () => {
		const deps = makeDeps({
			detectCLIs: async () => [
				{ command: "claude", available: true },
			],
			executeCLI: async () => ({
				stdout: "", stderr: "Error: not logged in. Please authenticate.", exitCode: 1, killed: false,
			}),
			getCompletionRouter: async () => null,
		});

		await expect(
			runAgentPromptWithFallback({ message: "test" }, deps),
		).rejects.toThrow(/auth/i);
	});

	it("skips timed-out CLIs and continues", async () => {
		const deps = makeDeps({
			detectCLIs: async () => [
				{ command: "claude", available: true },
				{ command: "gemini", available: true },
			],
			executeCLI: async (cmd) => {
				if (cmd === "claude") {
					return { stdout: "", stderr: "", exitCode: 0, killed: true };
				}
				return { stdout: "gemini ok", stderr: "", exitCode: 0, killed: false };
			},
		});

		const result = await runAgentPromptWithFallback({ message: "test" }, deps);

		expect(result.response).toBe("gemini ok");
		expect(result.providerId).toBe("gemini");
	});

	it("emits heartbeats during CLI execution", async () => {
		const heartbeats: string[] = [];
		const deps = makeDeps({
			detectCLIs: async () => [{ command: "gemini", available: true }],
			executeCLI: async () => ({
				stdout: "ok", stderr: "", exitCode: 0, killed: false,
			}),
		});

		await runAgentPromptWithFallback({
			message: "hb-test",
			onHeartbeat: (info) => heartbeats.push(info.activity),
		}, deps);

		expect(heartbeats.length).toBeGreaterThanOrEqual(1);
		expect(heartbeats).toContain("trying gemini");
	});

	it("loads project memory as system prompt context", async () => {
		let capturedArgs: string[] = [];
		const deps = makeDeps({
			detectCLIs: async () => [{ command: "claude", available: true }],
			executeCLI: async (_cmd, args) => {
				capturedArgs = args;
				return { stdout: "with-context", stderr: "", exitCode: 0, killed: false };
			},
			loadProjectMemory: () => "User prefers TypeScript. Project uses Vitest.",
		});

		const result = await runAgentPromptWithFallback({ message: "test" }, deps);

		expect(result.response).toBe("with-context");
		// Claude CLI gets --system-prompt arg with project memory
		expect(capturedArgs).toContain("--system-prompt");
		const sysIdx = capturedArgs.indexOf("--system-prompt");
		expect(capturedArgs[sysIdx + 1]).toContain("Project context");
	});

	it("skips CLIs without an arg builder", async () => {
		const deps = makeDeps({
			detectCLIs: async () => [
				{ command: "unknown-cli", available: true },
			],
			getCompletionRouter: async () => null,
		});

		await expect(
			runAgentPromptWithFallback({ message: "test" }, deps),
		).rejects.toThrow(/All attempts failed/i);
	});
});
