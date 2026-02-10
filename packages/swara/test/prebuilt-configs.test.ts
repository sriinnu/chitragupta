import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	PREBUILT_PROVIDERS,
	registerPrebuiltProviders,
	createVLLM,
	createLMStudio,
	createLocalAI,
	createLlamaCpp,
} from "../src/providers/prebuilt-configs.js";
import { createProviderRegistry } from "../src/provider-registry.js";

describe("Prebuilt Provider Configs", () => {
	describe("PREBUILT_PROVIDERS list", () => {
		it("should contain at least 7 providers", () => {
			expect(PREBUILT_PROVIDERS.length).toBeGreaterThanOrEqual(7);
		});

		it("should include xAI provider", () => {
			const xai = PREBUILT_PROVIDERS.find((p) => p.id === "xai");
			expect(xai).toBeDefined();
			expect(xai!.envVar).toBe("XAI_API_KEY");
		});

		it("should include Groq provider", () => {
			const groq = PREBUILT_PROVIDERS.find((p) => p.id === "groq");
			expect(groq).toBeDefined();
			expect(groq!.envVar).toBe("GROQ_API_KEY");
		});

		it("should include Cerebras provider", () => {
			const cerebras = PREBUILT_PROVIDERS.find((p) => p.id === "cerebras");
			expect(cerebras).toBeDefined();
			expect(cerebras!.envVar).toBe("CEREBRAS_API_KEY");
		});

		it("should include Mistral provider", () => {
			const mistral = PREBUILT_PROVIDERS.find((p) => p.id === "mistral");
			expect(mistral).toBeDefined();
			expect(mistral!.envVar).toBe("MISTRAL_API_KEY");
		});

		it("should include DeepSeek provider", () => {
			const deepseek = PREBUILT_PROVIDERS.find((p) => p.id === "deepseek");
			expect(deepseek).toBeDefined();
			expect(deepseek!.envVar).toBe("DEEPSEEK_API_KEY");
		});

		it("should include OpenRouter provider", () => {
			const openrouter = PREBUILT_PROVIDERS.find((p) => p.id === "openrouter");
			expect(openrouter).toBeDefined();
			expect(openrouter!.envVar).toBe("OPENROUTER_API_KEY");
		});

		it("should include Together AI provider", () => {
			const together = PREBUILT_PROVIDERS.find((p) => p.id === "together");
			expect(together).toBeDefined();
			expect(together!.envVar).toBe("TOGETHER_API_KEY");
		});

		it("should have lazy create functions", () => {
			for (const entry of PREBUILT_PROVIDERS) {
				expect(typeof entry.create).toBe("function");
			}
		});
	});

	describe("registerPrebuiltProviders", () => {
		const savedEnvs: Record<string, string | undefined> = {};

		beforeEach(() => {
			for (const entry of PREBUILT_PROVIDERS) {
				savedEnvs[entry.envVar] = process.env[entry.envVar];
				delete process.env[entry.envVar];
			}
		});

		afterEach(() => {
			for (const entry of PREBUILT_PROVIDERS) {
				if (savedEnvs[entry.envVar] !== undefined) {
					process.env[entry.envVar] = savedEnvs[entry.envVar];
				} else {
					delete process.env[entry.envVar];
				}
			}
		});

		it("should register zero providers when no env vars are set", () => {
			const registry = createProviderRegistry();
			const count = registerPrebuiltProviders(registry);
			expect(count).toBe(0);
			expect(registry.getAll().length).toBe(0);
		});

		it("should register only providers whose env var is set", () => {
			process.env.GROQ_API_KEY = "test-groq-key";
			process.env.XAI_API_KEY = "test-xai-key";
			const registry = createProviderRegistry();
			const count = registerPrebuiltProviders(registry);
			expect(count).toBe(2);
			expect(registry.has("groq")).toBe(true);
			expect(registry.has("xai")).toBe(true);
			expect(registry.has("mistral")).toBe(false);
		});

		it("should not register providers with empty env var", () => {
			process.env.GROQ_API_KEY = "";
			const registry = createProviderRegistry();
			const count = registerPrebuiltProviders(registry);
			expect(count).toBe(0);
		});
	});

	describe("createVLLM", () => {
		it("should create provider with default port 8000", () => {
			const provider = createVLLM();
			expect(provider.id).toBe("vllm");
			expect(provider.name).toBe("vLLM (Local)");
		});

		it("should create provider with custom port", () => {
			const provider = createVLLM({ port: 9000 });
			expect(provider.id).toBe("vllm");
		});

		it("should create provider with custom baseUrl", () => {
			const provider = createVLLM({ baseUrl: "http://gpu-server:8080/v1" });
			expect(provider.id).toBe("vllm");
		});

		it("should have zero pricing", () => {
			const provider = createVLLM();
			for (const m of provider.models) {
				expect(m.pricing.input).toBe(0);
				expect(m.pricing.output).toBe(0);
			}
		});
	});

	describe("createLMStudio", () => {
		it("should create provider with default port 1234", () => {
			const provider = createLMStudio();
			expect(provider.id).toBe("lmstudio");
			expect(provider.name).toBe("LM Studio (Local)");
		});

		it("should have custom auth (no API key needed)", () => {
			const provider = createLMStudio();
			expect(provider.auth.type).toBe("custom");
		});
	});

	describe("createLocalAI", () => {
		it("should create provider with default port 8080", () => {
			const provider = createLocalAI();
			expect(provider.id).toBe("localai");
			expect(provider.name).toBe("LocalAI (Local)");
		});
	});

	describe("createLlamaCpp", () => {
		it("should create provider with default port 8080", () => {
			const provider = createLlamaCpp();
			expect(provider.id).toBe("llamacpp");
			expect(provider.name).toBe("llama.cpp (Local)");
		});

		it("should accept custom models", () => {
			const provider = createLlamaCpp({
				models: [{
					id: "my-model",
					name: "My Model",
					contextWindow: 4096,
					maxOutputTokens: 2048,
					pricing: { input: 0, output: 0 },
					capabilities: { vision: false, thinking: false, toolUse: false, streaming: true },
				}],
			});
			expect(provider.models[0].id).toBe("my-model");
		});
	});

	describe("Lazy provider creation", () => {
		it("should create valid providers from each entry", () => {
			for (const entry of PREBUILT_PROVIDERS) {
				const provider = entry.create();
				expect(provider.id).toBe(entry.id);
				expect(typeof provider.stream).toBe("function");
				expect(provider.models.length).toBeGreaterThan(0);
			}
		});
	});
});
