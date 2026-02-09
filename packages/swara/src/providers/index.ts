/**
 * Provider index — exports all built-in providers and registration helper.
 */

import type { ProviderRegistry } from "../provider-registry.js";
import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";
import { googleProvider } from "./google.js";
import { ollamaProvider } from "./ollama.js";

// ─── API Providers ──────────────────────────────────────────────────────────
export { openaiProvider } from "./openai.js";
export { anthropicProvider } from "./anthropic.js";
export { googleProvider } from "./google.js";
export { ollamaProvider } from "./ollama.js";
export { createOpenAICompatProvider } from "./openai-compat.js";
export type { OpenAICompatConfig } from "./openai-compat.js";

// ─── CLI Providers ──────────────────────────────────────────────────────────
export { createCLIProvider } from "./cli-base.js";
export type { CLIProviderConfig } from "./cli-base.js";
export {
	claudeCodeProvider,
	codexProvider,
	geminiCLIProvider,
	aiderProvider,
	contextToPrompt,
} from "./cli-providers.js";
export { detectAvailableCLIs, getBestCLIProvider } from "./cli-detection.js";
export type { CLIAvailability } from "./cli-detection.js";

// ─── Prebuilt Configs ───────────────────────────────────────────────────────
export {
	PREBUILT_PROVIDERS,
	registerPrebuiltProviders,
	createVLLM,
	createLMStudio,
	createLocalAI,
	createLlamaCpp,
} from "./prebuilt-configs.js";
export type { PrebuiltProviderEntry, LocalServerOptions } from "./prebuilt-configs.js";

/**
 * Register all built-in providers into a registry.
 *
 * Registers: OpenAI, Anthropic, Google Gemini, Ollama.
 */
export function registerBuiltinProviders(registry: ProviderRegistry): void {
	registry.register(openaiProvider);
	registry.register(anthropicProvider);
	registry.register(googleProvider);
	registry.register(ollamaProvider);
}
