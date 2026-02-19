import { describe, expect, it } from "vitest";
import { runAgentPromptWithFallback } from "../src/modes/mcp-agent-prompt.js";

type FakeRunner = {
	prompt: (message: string) => Promise<string>;
	destroy: () => Promise<void>;
};

describe("runAgentPromptWithFallback", () => {
	it("falls back to the next provider when auto selection fails", async () => {
		const calls: Array<{ provider?: string; model?: string }> = [];
		const deps = {
			createChitragupta: async (options: { provider?: string; model?: string }): Promise<FakeRunner> => {
				calls.push(options);
				if (!options.provider) {
					return {
						prompt: async () => {
							throw new Error('CLI "claude" exited with code 1');
						},
						destroy: async () => {},
					};
				}
				if (options.provider === "openai") {
					return {
						prompt: async () => "fallback-ok",
						destroy: async () => {},
					};
				}
				return {
					prompt: async () => {
						throw new Error(`provider ${options.provider} unavailable`);
					},
					destroy: async () => {},
				};
			},
			loadSettings: () => ({ providerPriority: ["anthropic", "openai", "ollama"] }),
			defaultProviderPriority: ["anthropic", "openai", "ollama"],
		};

		const result = await runAgentPromptWithFallback(
			{ message: "hello" },
			deps,
		);

		expect(result.response).toBe("fallback-ok");
		expect(result.providerId).toBe("openai");
		expect(result.attempts).toBe(2);
		expect(calls).toEqual([{},{ provider: "openai" }]);
	});

	it("keeps explicit provider first and clears model for fallback providers", async () => {
		const calls: Array<{ provider?: string; model?: string }> = [];
		const deps = {
			createChitragupta: async (options: { provider?: string; model?: string }): Promise<FakeRunner> => {
				calls.push(options);
				if (options.provider === "anthropic") {
					return {
						prompt: async () => {
							throw new Error('CLI "claude" exited with code 1');
						},
						destroy: async () => {},
					};
				}
				if (options.provider === "openai") {
					return {
						prompt: async () => "openai-ok",
						destroy: async () => {},
					};
				}
				return {
					prompt: async () => "other-ok",
					destroy: async () => {},
				};
			},
			loadSettings: () => ({ providerPriority: ["anthropic", "openai"] }),
			defaultProviderPriority: ["anthropic", "openai"],
		};

		const result = await runAgentPromptWithFallback(
			{
				message: "explain this",
				provider: "anthropic",
				model: "claude-sonnet-4-5-20250929",
			},
			deps,
		);

		expect(result.response).toBe("openai-ok");
		expect(calls).toEqual([
			{ provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
			{ provider: "openai" },
		]);
	});

	it("returns consolidated failure details when all providers fail", async () => {
		const deps = {
			createChitragupta: async (): Promise<FakeRunner> => ({
				prompt: async () => {
					throw new Error("transient failure");
				},
				destroy: async () => {},
			}),
			loadSettings: () => ({ providerPriority: ["anthropic", "openai"] }),
			defaultProviderPriority: ["anthropic", "openai"],
		};

		await expect(
			runAgentPromptWithFallback({ message: "test" }, deps),
		).rejects.toThrow(/All provider attempts failed/i);
	});
});
