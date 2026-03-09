/**
 * @chitragupta/cli — Shared bootstrap helpers.
 *
 * Functions used by both the interactive CLI (main.ts) and the
 * programmatic API (api.ts). Extracted to a single module to
 * eliminate duplication and keep behaviour in sync.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

import {
	getChitraguptaHome,
	DEFAULT_PROVIDER_PRIORITY,
} from "@chitragupta/core";
import type { AgentProfile, ChitraguptaSettings } from "@chitragupta/core";
import type { ToolHandler } from "@chitragupta/core";

import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";
import {
	registerBuiltinProviders as registerSwaraProviders,
	createLlamaCpp,
	createOpenAICompatProvider,
	type OpenAICompatConfig,
} from "@chitragupta/swara/providers";
import {
	createOllamaEmbeddings,
	createOpenAIEmbeddings,
	createOnnxEmbeddings,
	detectAvailableCLIs,
} from "@chitragupta/swara";
import type { EmbeddingProvider, CLIAvailability } from "@chitragupta/swara";

import { getAllTools } from "@chitragupta/yantra";

import type { PolicyAction } from "@chitragupta/dharma";

// ─── Memory Helpers ─────────────────────────────────────────────────────────

/**
 * Load memory content for a project from the canonical Smriti project scope:
 *   ~/.chitragupta/memory/projects/<hash>/project.md
 *
 * Compatibility fallbacks:
 *   1) Legacy CLI path: ~/.chitragupta/memory/<hash>/MEMORY.md
 *   2) Project-local file: <project>/MEMORY.md
 */
export function loadProjectMemory(projectPath: string): string | undefined {
	const hash = crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
	const memoryRoot = path.join(getChitraguptaHome(), "memory");
	const candidatePaths = [
		path.join(memoryRoot, "projects", hash, "project.md"),
		path.join(memoryRoot, hash, "MEMORY.md"),
		path.join(projectPath, "MEMORY.md"),
	];

	for (const memPath of candidatePaths) {
		try {
			if (!fs.existsSync(memPath)) continue;
			const content = fs.readFileSync(memPath, "utf-8").trim();
			if (content.length > 0) return content;
		} catch {
			// Silently skip unreadable candidates and continue fallback chain.
		}
	}
	return undefined;
}

// ─── Profile Helpers ────────────────────────────────────────────────────────

/**
 * Validate that a parsed object has the required AgentProfile fields.
 * Returns true if the profile is valid, false otherwise.
 */
export function isValidProfile(obj: unknown): obj is AgentProfile {
	if (obj == null || typeof obj !== "object") return false;
	const p = obj as Record<string, unknown>;
	return (
		typeof p.id === "string" && p.id.length > 0 &&
		typeof p.name === "string" && p.name.length > 0 &&
		typeof p.personality === "string" && p.personality.length > 0 &&
		Array.isArray(p.expertise) &&
		typeof p.voice === "string"
	);
}

/**
 * Load custom profiles from ~/.chitragupta/profiles/.
 */
export function loadCustomProfiles(): Record<string, AgentProfile> {
	const dir = path.join(getChitraguptaHome(), "profiles");
	const profiles: Record<string, AgentProfile> = {};

	if (!fs.existsSync(dir)) return profiles;

	try {
		const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
		for (const file of files) {
			try {
				const content = fs.readFileSync(path.join(dir, file), "utf-8");
				const profile = JSON.parse(content);
				if (isValidProfile(profile)) {
					profiles[profile.id] = profile;
				}
			} catch {
				// Silently skip: profile JSON is malformed or missing required fields
			}
		}
	} catch {
		// Silently skip: profiles directory not readable (permissions or missing)
	}

	return profiles;
}

// ─── Credentials ────────────────────────────────────────────────────────────

/** Allowed credential environment variable names. */
export const ALLOWED_CREDENTIAL_KEYS = new Set([
	// Anthropic
	"ANTHROPIC_API_KEY",
	// OpenAI
	"OPENAI_API_KEY",
	"OPENAI_ORG_ID",
	// Google
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"GOOGLE_APPLICATION_CREDENTIALS",
	// Ollama
	"OLLAMA_HOST",
	"OLLAMA_BASE_URL",
	// llama.cpp
	"LLAMACPP_BASE_URL",
	"LLAMACPP_ENDPOINT",
	// xAI (Grok)
	"XAI_API_KEY",
	// Groq
	"GROQ_API_KEY",
	// Cerebras
	"CEREBRAS_API_KEY",
	// Mistral
	"MISTRAL_API_KEY",
	// DeepSeek
	"DEEPSEEK_API_KEY",
	// OpenRouter
	"OPENROUTER_API_KEY",
	// Together AI
	"TOGETHER_API_KEY",
	// Generic
	"CHITRAGUPTA_API_KEY",
	"CHITRAGUPTA_HOME",
]);

/**
 * Load credentials from ~/.chitragupta/config/credentials.json
 * and set them as environment variables if not already set.
 *
 * Only keys in the ALLOWED_CREDENTIAL_KEYS allowlist are set,
 * preventing a tampered credentials file from hijacking PATH,
 * HOME, LD_PRELOAD, or other sensitive environment variables.
 */
export function loadCredentials(): void {
	const credPath = path.join(getChitraguptaHome(), "config", "credentials.json");
	try {
		if (fs.existsSync(credPath)) {
			const creds = JSON.parse(fs.readFileSync(credPath, "utf-8")) as Record<string, string>;
			for (const [key, value] of Object.entries(creds)) {
				if (!process.env[key] && ALLOWED_CREDENTIAL_KEYS.has(key)) {
					process.env[key] = value;
				}
			}
		}
	} catch {
		// Silently skip: credentials file not readable or malformed
	}
}

// ─── Provider Registration ──────────────────────────────────────────────────

/**
 * Register all built-in providers (Anthropic, OpenAI, Google, Ollama, llama.cpp)
 * plus any user-configured OpenAI-compatible providers.
 */
export function registerBuiltinProviders(registry: ProviderRegistry, settings: ChitraguptaSettings): void {
	// Register the built-in providers: anthropic, openai, google, ollama
	registerSwaraProviders(registry);
	registry.register(createLlamaCpp({
		baseUrl:
			process.env.LLAMACPP_BASE_URL
			?? process.env.LLAMACPP_ENDPOINT
			?? settings.llamacppEndpoint
			?? "http://localhost:8080/v1",
	}));

	// Register any custom OpenAI-compatible providers from settings
	const customProviders = (settings as unknown as Record<string, unknown>).customProviders as
		Array<Record<string, unknown>> | undefined;
	if (customProviders) {
		for (const cp of customProviders) {
			const defaultModel = {
				id: "default", name: "Default", contextWindow: 128000,
				maxOutputTokens: 4096,
				pricing: { input: 0, output: 0 },
				capabilities: { vision: false, thinking: false, toolUse: true, streaming: true },
			};
			const provider = createOpenAICompatProvider({
				id: cp.id as string,
				name: cp.name as string,
				baseUrl: cp.baseUrl as string,
				authEnvVar: cp.authEnvVar as string | undefined,
				models: (cp.models as OpenAICompatConfig["models"] | undefined) ?? [defaultModel],
			});
			registry.register(provider);
		}
	}
}

// ─── CLI Provider Auto-Detection ─────────────────────────────────────────

/** Map from CLI command name to its ProviderDefinition. */
const CLI_PROVIDER_MAP: Record<string, () => Promise<import("@chitragupta/swara").ProviderDefinition>> = {
	claude: async () => (await import("@chitragupta/swara/providers")).claudeCodeProvider,
	gemini: async () => (await import("@chitragupta/swara/providers")).geminiCLIProvider,
	copilot: async () => (await import("@chitragupta/swara/providers")).copilotProvider,
	codex: async () => (await import("@chitragupta/swara/providers")).codexProvider,
	aider: async () => (await import("@chitragupta/swara/providers")).aiderProvider,
	zai: async () => (await import("@chitragupta/swara/providers")).zaiProvider,
	minimax: async () => (await import("@chitragupta/swara/providers")).minimaxProvider,
};

/**
 * Detect installed CLI tools (claude, gemini, copilot, codex, aider, zai, minimax) and register
 * them as providers. CLI providers have zero cost — they use their own
 * auth/billing. Returns the detection results for display.
 */
export async function registerCLIProviders(registry: ProviderRegistry): Promise<CLIAvailability[]> {
	const results = await detectAvailableCLIs();
	for (const cli of results) {
		if (cli.available && CLI_PROVIDER_MAP[cli.command]) {
			try {
				const provider = await CLI_PROVIDER_MAP[cli.command]();
				registry.register(provider);
			} catch {
				// Skip: provider registration failed — non-fatal
			}
		}
	}
	return results;
}

/**
 * Format a provider detection summary for the terminal.
 * Shows what's available and what will be used as primary.
 */
export function formatProviderSummary(
	cliResults: CLIAvailability[],
	hasLlamaCpp: boolean,
	hasOllama: boolean,
	apiKeys: string[],
): string {
	const lines: string[] = ["  Detected providers:"];
	let hasPrimary = false;

	for (const cli of cliResults) {
		if (cli.available) {
			const ver = cli.version ? ` (${cli.version})` : "";
			const tag = !hasPrimary ? " ← primary" : "";
			lines.push(`    \x1b[32m✓\x1b[0m ${cli.command} CLI${ver} — zero cost${tag}`);
			hasPrimary = true;
		}
	}

	if (hasLlamaCpp) {
		const tag = !hasPrimary ? " ← primary" : "";
		lines.push(`    \x1b[32m✓\x1b[0m llama.cpp (local) — zero cost${tag}`);
		hasPrimary = true;
	}

	if (hasOllama) {
		const tag = !hasPrimary ? " ← primary" : "";
		lines.push(`    \x1b[32m✓\x1b[0m Ollama (local) — zero cost${tag}`);
		hasPrimary = true;
	}

	for (const key of apiKeys) {
		const name = key.replace(/_API_KEY$/, "").replace(/_/g, " ");
		const tag = !hasPrimary ? " ← primary" : "";
		lines.push(`    \x1b[32m✓\x1b[0m ${name} API — paid${tag}`);
		hasPrimary = true;
	}

	if (!hasPrimary) {
		lines.push("    \x1b[31m✗\x1b[0m No providers found");
		lines.push("");
		lines.push("  Install a CLI tool (claude, codex, gemini) or set an API key.");
		lines.push("  Run: chitragupta provider add anthropic");
	}

	return lines.join("\n");
}

// ─── Tool Adapter ───────────────────────────────────────────────────────────

/**
 * Adapt yantra tools to the canonical ToolHandler interface.
 *
 * Now that both @chitragupta/yantra and @chitragupta/anina share the canonical
 * ToolHandler from @chitragupta/core, the mapping is a simple spread.
 */
export function getBuiltinTools(): ToolHandler[] {
	return getAllTools().map((tool) => ({
		definition: tool.definition as ToolHandler["definition"],
		execute: tool.execute as ToolHandler["execute"],
	}));
}

// ─── Policy Action Type Mapping ─────────────────────────────────────────────

/**
 * Map a tool name to the correct PolicyAction type so that dharma security
 * rules actually fire. Without this mapping every tool call arrives as
 * `type: "tool_call"`, which bypasses all shell_exec, file_*, and
 * network_request rules — rendering the entire security layer inert.
 *
 * The returned type must be a member of the PolicyAction["type"] union
 * defined in @chitragupta/dharma/types.
 */
export function getActionType(toolName: string): PolicyAction["type"] {
	const lower = toolName.toLowerCase();

	// Shell / command execution tools
	if (lower === "bash" || lower === "shell" || lower === "exec" || lower === "terminal") {
		return "shell_exec";
	}

	// File read tools
	if (lower === "read" || lower === "read_file" || lower === "cat" || lower === "head" || lower === "tail") {
		return "file_read";
	}

	// File write tools
	if (lower === "write" || lower === "write_file" || lower === "edit" || lower === "patch" || lower === "mkdir") {
		return "file_write";
	}

	// File delete tools
	if (lower === "delete" || lower === "rm" || lower === "remove") {
		return "file_delete";
	}

	// Network tools
	if (lower === "fetch" || lower === "http" || lower === "curl" || lower === "web_search") {
		return "network_request";
	}

	// Default fallback — unknown tools still pass through as generic tool_call
	return "tool_call";
}

// ─── Embedding Provider ─────────────────────────────────────────────────────

/**
 * Create the best available embedding provider.
 *
 * Fallback chain: Ollama (local, free) → OpenAI (cloud, needs key) →
 * ONNX (bundled MiniLM, zero-dep) → undefined (hash fallback in smriti).
 */
export async function createEmbeddingProviderInstance(): Promise<EmbeddingProvider | undefined> {
	// 1. Ollama — best quality, free, local
	try {
		const ollama = createOllamaEmbeddings();
		if (await ollama.isConfigured()) return ollama;
	} catch { /* Ollama unavailable */ }

	// 2. OpenAI — cloud, uses existing API key
	try {
		const openai = createOpenAIEmbeddings();
		if (await openai.isConfigured()) return openai;
	} catch { /* No OpenAI key */ }

	// 3. ONNX — bundled all-MiniLM-L6-v2, no external deps
	try {
		const onnx = createOnnxEmbeddings();
		if (await onnx.isConfigured()) return onnx;
	} catch { /* @huggingface/transformers not installed */ }

	// 4. Nothing available — smriti falls back to hash (with warning)
	process.stderr.write(
		"[chitragupta] Warning: No embedding provider available. " +
		"Semantic search will be degraded. Install Ollama, set OPENAI_API_KEY, " +
		"or run: npm install @huggingface/transformers\n",
	);
	return undefined;
}

// ─── Provider Priority Resolution ───────────────────────────────────────────

/**
 * Resolve the best available provider from the user's priority list.
 *
 * Walks the priority array and returns the first provider that's
 * actually registered in the registry. If the user specified an
 * explicit `--provider` flag, that overrides everything.
 *
 * @param explicitProvider - `--provider` CLI flag (overrides priority)
 * @param settings - User settings containing providerPriority
 * @param registry - Provider registry with registered providers
 * @returns { providerId, provider } or null if nothing available
 */
export function resolvePreferredProvider(
	explicitProvider: string | undefined,
	settings: ChitraguptaSettings,
	registry: ProviderRegistry,
): { providerId: string; provider: import("@chitragupta/swara").ProviderDefinition } | null {
	// Explicit --provider flag always wins
	if (explicitProvider) {
		const p = registry.get(explicitProvider);
		if (p) return { providerId: explicitProvider, provider: p };
		return null;
	}

	// Walk the priority list, pick the first available
	const priority = settings.providerPriority ?? DEFAULT_PROVIDER_PRIORITY;
	for (const id of priority) {
		const p = registry.get(id);
		if (p) return { providerId: id, provider: p };
	}

	// Absolute fallback: try anything registered
	const all = registry.getAll();
	if (all.length > 0) {
		return { providerId: all[0].id, provider: all[0] };
	}

	return null;
}
