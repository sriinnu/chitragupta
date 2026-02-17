import { describe, it, expect } from "vitest";
import { resolveRoute } from "../src/router.js";
import type { DarpanaConfig } from "../src/types.js";

const testConfig: DarpanaConfig = {
	port: 8082,
	host: "127.0.0.1",
	providers: {
		openai: {
			type: "openai-compat",
			endpoint: "https://api.openai.com/v1",
			apiKey: "sk-test",
			models: {
				"gpt-4.1": {},
				"gpt-4.1-mini": {},
				"o3-mini": {},
			},
		},
		gemini: {
			type: "google",
			apiKey: "gem-test",
			models: {
				"gemini-2.5-pro": {},
				"gemini-2.5-flash": {},
			},
		},
		anthropic: {
			type: "passthrough",
			apiKey: "ant-test",
		},
		local: {
			type: "openai-compat",
			endpoint: "http://localhost:11434/v1",
			models: {},
		},
	},
	aliases: {
		sonnet: "openai/gpt-4.1",
		haiku: "openai/gpt-4.1-mini",
		opus: "openai/o3-mini",
	},
};

describe("Router", () => {
	describe("resolveRoute", () => {
		it("resolves exact alias", () => {
			const route = resolveRoute("sonnet", testConfig);
			expect(route.providerName).toBe("openai");
			expect(route.upstreamModel).toBe("gpt-4.1");
		});

		it("resolves fuzzy alias from full Claude model name", () => {
			const route = resolveRoute("claude-sonnet-4-20250514", testConfig);
			expect(route.providerName).toBe("openai");
			expect(route.upstreamModel).toBe("gpt-4.1");
		});

		it("resolves opus alias", () => {
			const route = resolveRoute("claude-opus-4-20250514", testConfig);
			expect(route.providerName).toBe("openai");
			expect(route.upstreamModel).toBe("o3-mini");
		});

		it("resolves haiku alias", () => {
			const route = resolveRoute("claude-haiku-4-20250514", testConfig);
			expect(route.providerName).toBe("openai");
			expect(route.upstreamModel).toBe("gpt-4.1-mini");
		});

		it("resolves explicit provider/model syntax", () => {
			const route = resolveRoute("gemini/gemini-2.5-pro", testConfig);
			expect(route.providerName).toBe("gemini");
			expect(route.upstreamModel).toBe("gemini-2.5-pro");
		});

		it("strips anthropic/ prefix", () => {
			const route = resolveRoute("anthropic/sonnet", testConfig);
			// After stripping "anthropic/", we get "sonnet" which is an exact alias
			// But wait, the stripped string is "sonnet" without the prefix.
			// Actually the code strips "anthropic/" prefix first, then checks aliases.
			// "anthropic/sonnet" → stripped = "sonnet" → exact alias match
			expect(route.providerName).toBe("openai");
			expect(route.upstreamModel).toBe("gpt-4.1");
		});

		it("searches providers for direct model name match", () => {
			const route = resolveRoute("gemini-2.5-flash", testConfig);
			expect(route.providerName).toBe("gemini");
			expect(route.upstreamModel).toBe("gemini-2.5-flash");
		});

		it("falls back to wildcard provider for unknown models", () => {
			const route = resolveRoute("llama3", testConfig);
			// "local" has empty models map = wildcard
			expect(route.providerName).toBe("local");
			expect(route.upstreamModel).toBe("llama3");
		});

		it("supports upstreamName overrides", () => {
			const cfg: DarpanaConfig = {
				...testConfig,
				providers: {
					test: {
						type: "openai-compat",
						endpoint: "http://localhost:8080/v1",
						models: {
							"custom-model": { upstreamName: "real-model-name" },
						},
					},
				},
				aliases: {},
			};

			const route = resolveRoute("custom-model", cfg);
			expect(route.upstreamModel).toBe("real-model-name");
		});

		it("throws for unknown model with no wildcard provider", () => {
			const cfg: DarpanaConfig = {
				port: 8082,
				host: "127.0.0.1",
				providers: {
					openai: {
						type: "openai-compat",
						models: { "gpt-4.1": {} },
					},
				},
				aliases: {},
			};

			expect(() => resolveRoute("unknown-model", cfg)).toThrow("No provider found");
		});

		it("throws for unknown provider in explicit syntax", () => {
			expect(() => resolveRoute("unknown-provider/model", testConfig)).toThrow("Unknown provider");
		});
	});
});
