import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectApiKeys, getRecommendedProvider } from "@chitragupta/swara";
import type { Environment } from "@chitragupta/swara";

describe("detectApiKeys", () => {
	const keysToClean = [
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"GOOGLE_AI_API_KEY",
	];
	const savedValues: Record<string, string | undefined> = {};

	beforeEach(() => {
		// Save and clear all keys we might touch
		for (const key of keysToClean) {
			savedValues[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		// Restore original values
		for (const key of keysToClean) {
			if (savedValues[key] !== undefined) {
				process.env[key] = savedValues[key];
			} else {
				delete process.env[key];
			}
		}
	});

	it("returns empty array when no API keys are set", () => {
		const keys = detectApiKeys();
		// None of the standard keys should appear since we cleared them
		expect(keys).not.toContain("ANTHROPIC_API_KEY");
		expect(keys).not.toContain("OPENAI_API_KEY");
		expect(keys).not.toContain("GOOGLE_AI_API_KEY");
	});

	it("returns key names that are set and non-empty", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test-123";
		process.env.OPENAI_API_KEY = "sk-openai-456";
		const keys = detectApiKeys();
		expect(keys).toContain("ANTHROPIC_API_KEY");
		expect(keys).toContain("OPENAI_API_KEY");
	});

	it("ignores empty string values", () => {
		process.env.ANTHROPIC_API_KEY = "";
		process.env.OPENAI_API_KEY = "sk-valid";
		const keys = detectApiKeys();
		expect(keys).not.toContain("ANTHROPIC_API_KEY");
		expect(keys).toContain("OPENAI_API_KEY");
	});
});

describe("getRecommendedProvider", () => {
	function makeEnv(overrides: Partial<Environment> = {}): Environment {
		return {
			platform: "linux",
			arch: "x64",
			gpu: { vendor: "none" },
			backends: { ollama: false, vllm: false, localai: false, lmstudio: false },
			apiKeys: [],
			...overrides,
		};
	}

	it("returns 'ollama' for macOS ARM64", () => {
		const env = makeEnv({ platform: "darwin", arch: "arm64" });
		expect(getRecommendedProvider(env)).toBe("ollama");
	});

	it("returns 'vllm' for NVIDIA GPU with vLLM available", () => {
		const env = makeEnv({
			gpu: { vendor: "nvidia", name: "RTX 4090", vram: 24576 },
			backends: { ollama: false, vllm: true, localai: false, lmstudio: false },
		});
		expect(getRecommendedProvider(env)).toBe("vllm");
	});

	it("returns 'ollama' when ollama backend is available", () => {
		const env = makeEnv({
			backends: { ollama: true, vllm: false, localai: false, lmstudio: false },
		});
		expect(getRecommendedProvider(env)).toBe("ollama");
	});

	it("returns 'anthropic' when only ANTHROPIC_API_KEY is set", () => {
		const env = makeEnv({ apiKeys: ["ANTHROPIC_API_KEY"] });
		expect(getRecommendedProvider(env)).toBe("anthropic");
	});

	it("returns 'openai' when only OPENAI_API_KEY is set", () => {
		const env = makeEnv({ apiKeys: ["OPENAI_API_KEY"] });
		expect(getRecommendedProvider(env)).toBe("openai");
	});

	it("returns 'ollama' as final fallback", () => {
		const env = makeEnv();
		expect(getRecommendedProvider(env)).toBe("ollama");
	});

	it("prefers local over cloud (ollama before anthropic)", () => {
		const env = makeEnv({
			backends: { ollama: true, vllm: false, localai: false, lmstudio: false },
			apiKeys: ["ANTHROPIC_API_KEY"],
		});
		expect(getRecommendedProvider(env)).toBe("ollama");
	});
});
