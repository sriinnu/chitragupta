/**
 * Darpana config loader — JSON file + env var + CLI credential auto-detection.
 *
 * Priority: config file > env vars > CLI stored credentials > Ollama fallback.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import type { DarpanaConfig, ProviderConfig } from "./types.js";

const DEFAULT_CONFIG: DarpanaConfig = {
	port: 8082,
	host: "127.0.0.1",
	providers: {},
	aliases: {},
};

/**
 * Interpolate `${ENV_VAR}` references in a string.
 */
function interpolateEnv(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}

/**
 * Deep-walk an object and interpolate all string values.
 */
function interpolateObject<T>(obj: T): T {
	if (typeof obj === "string") return interpolateEnv(obj) as T;
	if (Array.isArray(obj)) return obj.map(interpolateObject) as T;
	if (obj && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			result[k] = interpolateObject(v);
		}
		return result as T;
	}
	return obj;
}

// ─── CLI Credential Detection ──────────────────────────────────────

interface CLICredentials {
	claude?: { accessToken: string; expiresAt?: number };
	codex?: { accessToken: string };
}

/**
 * Read stored credentials from installed CLIs.
 * Returns tokens that can be used as API keys — no manual keys needed.
 */
function detectCLICredentials(): CLICredentials {
	const creds: CLICredentials = {};
	const home = homedir();

	// ─── Claude Code: ~/.claude/.credentials.json ───
	try {
		const claudeCredsPath = join(home, ".claude", ".credentials.json");
		if (existsSync(claudeCredsPath)) {
			const raw = JSON.parse(readFileSync(claudeCredsPath, "utf-8"));
			const oauth = raw?.claudeAiOauth;
			if (oauth?.accessToken) {
				// Check expiry — skip if expired (with 60s buffer)
				const expiresAt = oauth.expiresAt ? Number(oauth.expiresAt) : Infinity;
				if (expiresAt > Date.now() + 60_000) {
					creds.claude = { accessToken: oauth.accessToken, expiresAt };
				}
			}
		}
	} catch {
		// Credentials unreadable — skip silently
	}

	// ─── Codex CLI: ~/.codex/auth.json ───
	try {
		const codexAuthPath = join(home, ".codex", "auth.json");
		if (existsSync(codexAuthPath)) {
			const raw = JSON.parse(readFileSync(codexAuthPath, "utf-8"));
			// Prefer explicit API key, fall back to OAuth access_token
			const apiKey = raw?.OPENAI_API_KEY;
			const oauthToken = raw?.tokens?.access_token;
			const token = (apiKey && apiKey !== "null") ? apiKey : oauthToken;
			if (token) {
				creds.codex = { accessToken: token };
			}
		}
	} catch {
		// Credentials unreadable — skip silently
	}

	return creds;
}

/**
 * Check if a CLI binary is available on PATH.
 */
function cliExists(name: string): boolean {
	try {
		execSync(`which ${name}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Read the default model from Codex config.toml (best-effort).
 */
function readCodexModel(): string | undefined {
	try {
		const tomlPath = join(homedir(), ".codex", "config.toml");
		if (!existsSync(tomlPath)) return undefined;
		const raw = readFileSync(tomlPath, "utf-8");
		const match = raw.match(/^model\s*=\s*"([^"]+)"/m);
		return match?.[1];
	} catch {
		return undefined;
	}
}

// ─── Provider Auto-Detection ───────────────────────────────────────

/**
 * Auto-detect providers from: env vars → CLI credentials → Ollama fallback.
 */
function autoDetectProviders(): Record<string, ProviderConfig> {
	const providers: Record<string, ProviderConfig> = {};
	const cliCreds = detectCLICredentials();

	// ─── Explicit env var providers (highest priority) ───

	if (process.env.OPENAI_API_KEY) {
		providers.openai = {
			type: "openai-compat",
			endpoint: "https://api.openai.com/v1",
			apiKey: process.env.OPENAI_API_KEY,
			models: {
				"gpt-4.1": {},
				"gpt-4.1-mini": {},
				"gpt-4.1-nano": {},
				"o3-mini": {},
				"o4-mini": {},
			},
		};
	}

	if (process.env.GEMINI_API_KEY) {
		providers.gemini = {
			type: "google",
			apiKey: process.env.GEMINI_API_KEY,
			models: {
				"gemini-2.5-pro": {},
				"gemini-2.5-flash": {},
			},
		};
	}

	if (process.env.GROQ_API_KEY) {
		providers.groq = {
			type: "openai-compat",
			endpoint: "https://api.groq.com/openai/v1",
			apiKey: process.env.GROQ_API_KEY,
			models: { "llama-3.3-70b-versatile": {} },
		};
	}

	if (process.env.DEEPSEEK_API_KEY) {
		providers.deepseek = {
			type: "openai-compat",
			endpoint: "https://api.deepseek.com/v1",
			apiKey: process.env.DEEPSEEK_API_KEY,
			models: { "deepseek-chat": {}, "deepseek-reasoner": {} },
		};
	}

	if (process.env.TOGETHER_API_KEY) {
		providers.together = {
			type: "openai-compat",
			endpoint: "https://api.together.xyz/v1",
			apiKey: process.env.TOGETHER_API_KEY,
			models: {},
		};
	}

	if (process.env.OPENROUTER_API_KEY) {
		providers.openrouter = {
			type: "openai-compat",
			endpoint: "https://openrouter.ai/api/v1",
			apiKey: process.env.OPENROUTER_API_KEY,
			models: {},
		};
	}

	if (process.env.ANTHROPIC_API_KEY) {
		providers.anthropic = {
			type: "passthrough",
			apiKey: process.env.ANTHROPIC_API_KEY,
		};
	}

	// ─── CLI credential providers (fallback when no env var) ───

	// Claude Code OAuth → Anthropic passthrough (no ANTHROPIC_API_KEY needed)
	if (!providers.anthropic && cliCreds.claude) {
		providers.anthropic = {
			type: "passthrough",
			apiKey: cliCreds.claude.accessToken,
		};
	}

	// Codex CLI OAuth → OpenAI (no OPENAI_API_KEY needed)
	if (!providers.openai && cliCreds.codex) {
		const codexModel = readCodexModel();
		providers.openai = {
			type: "openai-compat",
			endpoint: "https://api.openai.com/v1",
			apiKey: cliCreds.codex.accessToken,
			models: {
				"gpt-4.1": {},
				"gpt-4.1-mini": {},
				"gpt-4.1-nano": {},
				"o3-mini": {},
				"o4-mini": {},
				...(codexModel ? { [codexModel]: {} } : {}),
			},
		};
	}

	// Always add local Ollama — it needs no key and serves as wildcard fallback
	const ollamaHost = process.env.OLLAMA_HOST ?? "http://localhost:11434";
	providers.local = {
		type: "openai-compat",
		endpoint: `${ollamaHost}/v1`,
		models: {},
	};

	return providers;
}

/**
 * Build default aliases from the first available provider.
 */
function buildDefaultAliases(providers: Record<string, ProviderConfig>): Record<string, string> {
	const aliases: Record<string, string> = {};

	// Prefer cloud providers for sonnet/opus/haiku aliases
	if (providers.openai) {
		aliases.sonnet = "openai/gpt-4.1";
		aliases.haiku = "openai/gpt-4.1-mini";
		aliases.opus = "openai/o3-mini";
	} else if (providers.anthropic) {
		// Using Claude Code or Anthropic key — pass Claude models through directly
		aliases.sonnet = "anthropic/claude-sonnet-4-20250514";
		aliases.haiku = "anthropic/claude-haiku-4-20250514";
		aliases.opus = "anthropic/claude-opus-4-20250514";
	} else if (providers.gemini) {
		aliases.sonnet = "gemini/gemini-2.5-pro";
		aliases.haiku = "gemini/gemini-2.5-flash";
		aliases.opus = "gemini/gemini-2.5-pro";
	} else if (providers.groq) {
		aliases.sonnet = "groq/llama-3.3-70b-versatile";
		aliases.haiku = "groq/llama-3.3-70b-versatile";
	} else if (providers.local) {
		aliases.sonnet = "local/llama3";
		aliases.haiku = "local/llama3";
	}

	return aliases;
}

export interface LoadConfigOptions {
	configPath?: string;
	port?: number;
	host?: string;
}

/**
 * Build a human-readable summary of detected credential sources.
 */
export function detectCredentialSources(): { name: string; source: string }[] {
	const sources: { name: string; source: string }[] = [];
	const cliCreds = detectCLICredentials();

	if (process.env.ANTHROPIC_API_KEY) sources.push({ name: "Anthropic", source: "ANTHROPIC_API_KEY env" });
	else if (cliCreds.claude) sources.push({ name: "Anthropic", source: "Claude Code OAuth (~/.claude/.credentials.json)" });

	if (process.env.OPENAI_API_KEY) sources.push({ name: "OpenAI", source: "OPENAI_API_KEY env" });
	else if (cliCreds.codex) sources.push({ name: "OpenAI", source: "Codex CLI OAuth (~/.codex/auth.json)" });

	if (process.env.GEMINI_API_KEY) sources.push({ name: "Gemini", source: "GEMINI_API_KEY env" });
	if (process.env.GROQ_API_KEY) sources.push({ name: "Groq", source: "GROQ_API_KEY env" });
	if (process.env.DEEPSEEK_API_KEY) sources.push({ name: "DeepSeek", source: "DEEPSEEK_API_KEY env" });

	if (cliExists("ollama")) sources.push({ name: "Ollama", source: "ollama CLI installed" });
	else sources.push({ name: "Ollama", source: "localhost:11434 (fallback)" });

	return sources;
}

/**
 * Load Darpana config from file or auto-detect from environment + CLIs.
 */
export function loadConfig(opts: LoadConfigOptions = {}): DarpanaConfig {
	let config: DarpanaConfig = { ...DEFAULT_CONFIG };

	// Try loading from file
	const configPath = opts.configPath
		?? process.env.DARPANA_CONFIG
		?? findConfigFile();

	if (configPath && existsSync(configPath)) {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<DarpanaConfig>;
		config = { ...config, ...interpolateObject(parsed) };
	} else {
		// Auto-detect from env + CLI credentials
		config.providers = autoDetectProviders();
		config.aliases = buildDefaultAliases(config.providers);
	}

	// Env var overrides
	if (process.env.DARPANA_PORT) config.port = Number.parseInt(process.env.DARPANA_PORT, 10);
	if (process.env.DARPANA_HOST) config.host = process.env.DARPANA_HOST;

	// CLI overrides
	if (opts.port) config.port = opts.port;
	if (opts.host) config.host = opts.host;

	// Validate
	validateConfig(config);

	return config;
}

/**
 * Validate a loaded config — catch misconfigurations before the server starts.
 */
function validateConfig(config: DarpanaConfig): void {
	const errors: string[] = [];

	// Port
	if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
		errors.push(`Invalid port: ${config.port} (must be 1-65535)`);
	}

	// Providers
	for (const [name, p] of Object.entries(config.providers)) {
		if (p.type === "openai-compat" && !p.endpoint) {
			errors.push(`Provider "${name}" (openai-compat) requires an endpoint`);
		}
		if (p.type === "google" && !p.apiKey) {
			errors.push(`Provider "${name}" (google) requires an apiKey`);
		}
	}

	// Aliases — check that target providers exist
	for (const [alias, target] of Object.entries(config.aliases)) {
		if (target.includes("/")) {
			const providerName = target.split("/")[0];
			if (!config.providers[providerName]) {
				errors.push(`Alias "${alias}" targets provider "${providerName}" which does not exist`);
			}
		}
	}

	if (errors.length > 0) {
		throw new Error(`Darpana config validation failed:\n  - ${errors.join("\n  - ")}`);
	}
}

function findConfigFile(): string | undefined {
	const candidates = ["darpana.json", ".darpana.json", "darpana.config.json"];
	for (const name of candidates) {
		const p = resolve(process.cwd(), name);
		if (existsSync(p)) return p;
	}
	return undefined;
}
