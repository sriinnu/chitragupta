/**
 * Pre-built OpenAI-compatible configurations for popular LLM providers.
 *
 * Each configuration wraps `createOpenAICompatProvider` with the correct
 * base URL, auth env var, and model catalogue. Providers are only
 * registered when their API key is present in the environment.
 *
 * Also includes factory functions for local inference servers
 * (vLLM, LM Studio, LocalAI, llama.cpp) with configurable ports.
 */

import { createOpenAICompatProvider } from "./openai-compat.js";
import type { OpenAICompatConfig } from "./openai-compat.js";
import type { ProviderDefinition, ModelDefinition } from "../types.js";
import type { ProviderRegistry } from "../provider-registry.js";

// ─── Shared Capability Defaults ─────────────────────────────────────────────

const STD_CAPS: ModelDefinition["capabilities"] = {
	vision: false,
	thinking: false,
	toolUse: true,
	streaming: true,
};

// ─── xAI (Grok) ────────────────────────────────────────────────────────────

const xaiConfig: OpenAICompatConfig = {
	id: "xai",
	name: "xAI (Grok)",
	baseUrl: "https://api.x.ai/v1",
	authEnvVar: "XAI_API_KEY",
	models: [
		{
			id: "grok-2",
			name: "Grok 2",
			contextWindow: 131_072,
			maxOutputTokens: 32_768,
			pricing: { input: 2, output: 10 },
			capabilities: STD_CAPS,
		},
		{
			id: "grok-2-mini",
			name: "Grok 2 Mini",
			contextWindow: 131_072,
			maxOutputTokens: 32_768,
			pricing: { input: 0.3, output: 0.5 },
			capabilities: STD_CAPS,
		},
	],
};

// ─── Groq ───────────────────────────────────────────────────────────────────

const groqConfig: OpenAICompatConfig = {
	id: "groq",
	name: "Groq",
	baseUrl: "https://api.groq.com/openai/v1",
	authEnvVar: "GROQ_API_KEY",
	models: [
		{
			id: "llama-3.3-70b-versatile",
			name: "Llama 3.3 70B Versatile",
			contextWindow: 128_000,
			maxOutputTokens: 32_768,
			pricing: { input: 0.59, output: 0.79 },
			capabilities: STD_CAPS,
		},
		{
			id: "mixtral-8x7b-32768",
			name: "Mixtral 8x7B",
			contextWindow: 32_768,
			maxOutputTokens: 32_768,
			pricing: { input: 0.24, output: 0.24 },
			capabilities: STD_CAPS,
		},
	],
};

// ─── Cerebras ───────────────────────────────────────────────────────────────

const cerebrasConfig: OpenAICompatConfig = {
	id: "cerebras",
	name: "Cerebras",
	baseUrl: "https://api.cerebras.ai/v1",
	authEnvVar: "CEREBRAS_API_KEY",
	models: [
		{
			id: "llama3.1-70b",
			name: "Llama 3.1 70B",
			contextWindow: 128_000,
			maxOutputTokens: 8_192,
			pricing: { input: 0.6, output: 0.6 },
			capabilities: STD_CAPS,
		},
	],
};

// ─── Mistral ────────────────────────────────────────────────────────────────

const mistralConfig: OpenAICompatConfig = {
	id: "mistral",
	name: "Mistral",
	baseUrl: "https://api.mistral.ai/v1",
	authEnvVar: "MISTRAL_API_KEY",
	models: [
		{
			id: "mistral-large-latest",
			name: "Mistral Large",
			contextWindow: 128_000,
			maxOutputTokens: 32_768,
			pricing: { input: 2, output: 6 },
			capabilities: STD_CAPS,
		},
		{
			id: "codestral-latest",
			name: "Codestral",
			contextWindow: 32_768,
			maxOutputTokens: 32_768,
			pricing: { input: 0.3, output: 0.9 },
			capabilities: STD_CAPS,
		},
	],
};

// ─── DeepSeek ───────────────────────────────────────────────────────────────

const deepseekConfig: OpenAICompatConfig = {
	id: "deepseek",
	name: "DeepSeek",
	baseUrl: "https://api.deepseek.com",
	authEnvVar: "DEEPSEEK_API_KEY",
	models: [
		{
			id: "deepseek-chat",
			name: "DeepSeek Chat",
			contextWindow: 64_000,
			maxOutputTokens: 8_192,
			pricing: { input: 0.14, output: 0.28 },
			capabilities: STD_CAPS,
		},
		{
			id: "deepseek-coder",
			name: "DeepSeek Coder",
			contextWindow: 64_000,
			maxOutputTokens: 8_192,
			pricing: { input: 0.14, output: 0.28 },
			capabilities: STD_CAPS,
		},
	],
};

// ─── OpenRouter ─────────────────────────────────────────────────────────────

const openrouterConfig: OpenAICompatConfig = {
	id: "openrouter",
	name: "OpenRouter",
	baseUrl: "https://openrouter.ai/api/v1",
	authEnvVar: "OPENROUTER_API_KEY",
	models: [
		{
			id: "auto",
			name: "Auto (routed)",
			contextWindow: 128_000,
			maxOutputTokens: 16_384,
			pricing: { input: 0, output: 0 }, // varies by routed model
			capabilities: STD_CAPS,
		},
	],
};

// ─── Together AI ────────────────────────────────────────────────────────────

const togetherConfig: OpenAICompatConfig = {
	id: "together",
	name: "Together AI",
	baseUrl: "https://api.together.xyz/v1",
	authEnvVar: "TOGETHER_API_KEY",
	models: [
		{
			id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
			name: "Llama 3.1 70B Instruct Turbo",
			contextWindow: 128_000,
			maxOutputTokens: 8_192,
			pricing: { input: 0.88, output: 0.88 },
			capabilities: STD_CAPS,
		},
	],
};

// ─── Prebuilt Provider Registry ─────────────────────────────────────────────

/** Descriptor for a prebuilt cloud provider. */
export interface PrebuiltProviderEntry {
	id: string;
	envVar: string;
	create: () => ProviderDefinition;
}

/** All prebuilt cloud providers with lazy factory functions. */
export const PREBUILT_PROVIDERS: readonly PrebuiltProviderEntry[] = [
	{ id: "xai", envVar: "XAI_API_KEY", create: () => createOpenAICompatProvider(xaiConfig) },
	{ id: "groq", envVar: "GROQ_API_KEY", create: () => createOpenAICompatProvider(groqConfig) },
	{ id: "cerebras", envVar: "CEREBRAS_API_KEY", create: () => createOpenAICompatProvider(cerebrasConfig) },
	{ id: "mistral", envVar: "MISTRAL_API_KEY", create: () => createOpenAICompatProvider(mistralConfig) },
	{ id: "deepseek", envVar: "DEEPSEEK_API_KEY", create: () => createOpenAICompatProvider(deepseekConfig) },
	{ id: "openrouter", envVar: "OPENROUTER_API_KEY", create: () => createOpenAICompatProvider(openrouterConfig) },
	{ id: "together", envVar: "TOGETHER_API_KEY", create: () => createOpenAICompatProvider(togetherConfig) },
];

/**
 * Register only those prebuilt providers whose API key env var is set.
 *
 * @returns The number of providers registered.
 */
export function registerPrebuiltProviders(registry: ProviderRegistry): number {
	let count = 0;
	for (const entry of PREBUILT_PROVIDERS) {
		const key = process.env[entry.envVar];
		if (key && key.length > 0) {
			registry.register(entry.create());
			count++;
		}
	}
	return count;
}

// ─── Local Server Factories ─────────────────────────────────────────────────

/** Options for local inference server providers. */
export interface LocalServerOptions {
	/** Override the default port. */
	port?: number;
	/** Override the full base URL (takes precedence over port). */
	baseUrl?: string;
	/** Additional model definitions to expose. */
	models?: ModelDefinition[];
}

/**
 * Create a provider for a vLLM server.
 * Default: `http://localhost:8000/v1`
 */
export function createVLLM(options?: LocalServerOptions): ProviderDefinition {
	const baseUrl = options?.baseUrl ?? `http://localhost:${options?.port ?? 8000}/v1`;
	return createOpenAICompatProvider({
		id: "vllm",
		name: "vLLM (Local)",
		baseUrl,
		models: options?.models ?? [{
			id: "default",
			name: "vLLM Default",
			contextWindow: 128_000,
			maxOutputTokens: 8_192,
			pricing: { input: 0, output: 0 },
			capabilities: STD_CAPS,
		}],
	});
}

/**
 * Create a provider for LM Studio's local server.
 * Default: `http://localhost:1234/v1`
 */
export function createLMStudio(options?: LocalServerOptions): ProviderDefinition {
	const baseUrl = options?.baseUrl ?? `http://localhost:${options?.port ?? 1234}/v1`;
	return createOpenAICompatProvider({
		id: "lmstudio",
		name: "LM Studio (Local)",
		baseUrl,
		models: options?.models ?? [{
			id: "default",
			name: "LM Studio Default",
			contextWindow: 128_000,
			maxOutputTokens: 8_192,
			pricing: { input: 0, output: 0 },
			capabilities: STD_CAPS,
		}],
	});
}

/**
 * Create a provider for a LocalAI server.
 * Default: `http://localhost:8080/v1`
 */
export function createLocalAI(options?: LocalServerOptions): ProviderDefinition {
	const baseUrl = options?.baseUrl ?? `http://localhost:${options?.port ?? 8080}/v1`;
	return createOpenAICompatProvider({
		id: "localai",
		name: "LocalAI (Local)",
		baseUrl,
		models: options?.models ?? [{
			id: "default",
			name: "LocalAI Default",
			contextWindow: 32_768,
			maxOutputTokens: 8_192,
			pricing: { input: 0, output: 0 },
			capabilities: STD_CAPS,
		}],
	});
}

/**
 * Create a provider for a llama.cpp server.
 * Default: `http://localhost:8080/v1`
 */
export function createLlamaCpp(options?: LocalServerOptions): ProviderDefinition {
	const baseUrl = options?.baseUrl ?? `http://localhost:${options?.port ?? 8080}/v1`;
	return createOpenAICompatProvider({
		id: "llamacpp",
		name: "llama.cpp (Local)",
		baseUrl,
		models: options?.models ?? [{
			id: "default",
			name: "llama.cpp Default",
			contextWindow: 32_768,
			maxOutputTokens: 4_096,
			pricing: { input: 0, output: 0 },
			capabilities: STD_CAPS,
		}],
	});
}
