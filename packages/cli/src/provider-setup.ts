/**
 * @chitragupta/cli — Provider setup guidance for first-run / no-provider scenarios.
 *
 * When the CLI boots and finds zero providers (no CLIs, no Ollama, no API keys),
 * this module prints a clear diagnostic and offers simple recovery options.
 * It does NOT build a full TUI wizard — just env var detection, a numbered
 * menu, and credential persistence.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome, DEFAULT_SETTINGS } from "@chitragupta/core";
import type { ChitraguptaSettings } from "@chitragupta/core";
import type { ProviderRegistry } from "@chitragupta/swara/provider-registry";
import type { CLIAvailability } from "@chitragupta/swara";
import { registerBuiltinProviders as registerSwaraProviders } from "@chitragupta/swara/providers";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of the provider setup guide. */
export interface ProviderSetupResult {
	/** Whether a provider was successfully configured. */
	configured: boolean;
	/** The provider ID that was configured, if any. */
	providerId?: string;
}

/** Environment variable to provider mapping. */
interface EnvProviderMapping {
	envVar: string;
	providerId: string;
	label: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** API key env vars that map to known providers. */
const ENV_PROVIDER_MAPPINGS: EnvProviderMapping[] = [
	{ envVar: "ANTHROPIC_API_KEY", providerId: "anthropic", label: "Anthropic" },
	{ envVar: "OPENAI_API_KEY", providerId: "openai", label: "OpenAI" },
	{ envVar: "GOOGLE_API_KEY", providerId: "google", label: "Google (Gemini)" },
	{ envVar: "GEMINI_API_KEY", providerId: "google", label: "Google (Gemini)" },
	{ envVar: "GROQ_API_KEY", providerId: "groq", label: "Groq" },
	{ envVar: "DEEPSEEK_API_KEY", providerId: "deepseek", label: "DeepSeek" },
	{ envVar: "OPENROUTER_API_KEY", providerId: "openrouter", label: "OpenRouter" },
];

/** CLI tools that are checked during boot. */
const CLI_NAMES = ["claude", "gemini", "copilot", "codex", "aider", "zai", "minimax"];

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Detect which API key environment variables are set.
 * Returns the mappings for all env vars that have a non-empty value.
 */
export function detectEnvApiKeys(): EnvProviderMapping[] {
	return ENV_PROVIDER_MAPPINGS.filter(
		(m) => {
			const val = process.env[m.envVar];
			return val !== undefined && val.trim().length > 0;
		},
	);
}

/**
 * Print a diagnostic showing what was checked and not found.
 */
function printDiagnostic(cliResults: CLIAvailability[], hasOllama: boolean): void {
	const stderr = process.stderr;

	stderr.write("\n  \x1b[33mNo AI provider detected.\x1b[0m\n\n");
	stderr.write("  \x1b[2mChecked CLI tools:\x1b[0m\n");

	for (const cli of cliResults) {
		const status = cli.available
			? `\x1b[32m found\x1b[0m`
			: `\x1b[31m not found\x1b[0m`;
		stderr.write(`    ${cli.command.padEnd(10)} ${status}\n`);
	}

	// Show any missing CLIs that weren't in the results (shouldn't happen, but be safe)
	const checkedCommands = new Set(cliResults.map((c) => c.command));
	for (const name of CLI_NAMES) {
		if (!checkedCommands.has(name)) {
			stderr.write(`    ${name.padEnd(10)} \x1b[31m not found\x1b[0m\n`);
		}
	}

	stderr.write(`\n  \x1b[2mOllama:\x1b[0m          ${hasOllama ? "\x1b[32m running\x1b[0m" : "\x1b[31m not running\x1b[0m"}\n`);

	stderr.write("\n  \x1b[2mAPI key env vars:\x1b[0m\n");
	for (const m of ENV_PROVIDER_MAPPINGS) {
		const set = process.env[m.envVar] !== undefined && process.env[m.envVar]!.trim().length > 0;
		const status = set ? "\x1b[32m set\x1b[0m" : "\x1b[31m not set\x1b[0m";
		stderr.write(`    ${m.envVar.padEnd(22)} ${status}\n`);
	}
	stderr.write("\n");
}

/**
 * Auto-register providers from detected env vars.
 * Registers the built-in swara providers (which check env vars internally)
 * and returns the list of provider IDs that should now be available.
 */
function autoRegisterFromEnvVars(
	registry: ProviderRegistry,
	detectedKeys: EnvProviderMapping[],
): string[] {
	// Re-register swara built-in providers — they check env vars at call time
	registerSwaraProviders(registry);

	const registered: string[] = [];
	for (const mapping of detectedKeys) {
		const provider = registry.get(mapping.providerId);
		if (provider) {
			registered.push(mapping.providerId);
		}
	}
	return [...new Set(registered)];
}

/**
 * Save a provider choice to settings.json and optionally credentials.json.
 */
function persistProviderChoice(providerId: string, envVar?: string, apiKey?: string): void {
	const home = getChitraguptaHome();
	const configDir = path.join(home, "config");
	fs.mkdirSync(configDir, { recursive: true });

	// Update settings.json
	const settingsPath = path.join(configDir, "settings.json");
	let settings: ChitraguptaSettings = { ...DEFAULT_SETTINGS };
	try {
		if (fs.existsSync(settingsPath)) {
			settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as ChitraguptaSettings;
		}
	} catch { /* use defaults */ }

	settings.defaultProvider = providerId;
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, "\t"), "utf-8");

	// Save API key to credentials.json if provided
	if (envVar && apiKey) {
		const credPath = path.join(configDir, "credentials.json");
		let creds: Record<string, string> = {};
		try {
			if (fs.existsSync(credPath)) {
				creds = JSON.parse(fs.readFileSync(credPath, "utf-8")) as Record<string, string>;
			}
		} catch { /* start fresh */ }

		creds[envVar] = apiKey;
		fs.writeFileSync(credPath, JSON.stringify(creds, null, "\t"), "utf-8");
		fs.chmodSync(credPath, 0o600);

		// Also set in process.env so the current session picks it up
		process.env[envVar] = apiKey;
	}
}

/**
 * Print guidance for non-interactive mode (no TTY).
 */
function printNonInteractiveGuidance(): void {
	const stderr = process.stderr;
	stderr.write("  \x1b[1mTo fix this, do one of:\x1b[0m\n\n");
	stderr.write("    1. Set an API key:\n");
	stderr.write("       \x1b[36mexport ANTHROPIC_API_KEY=sk-ant-...\x1b[0m\n\n");
	stderr.write("    2. Install a CLI tool:\n");
	stderr.write("       \x1b[36mnpm install -g @anthropic-ai/claude-code\x1b[0m\n\n");
	stderr.write("    3. Start Ollama:\n");
	stderr.write("       \x1b[36mollama serve\x1b[0m\n\n");
}

/**
 * Read a single line from stdin (simplified, no raw mode needed for this).
 */
function readLineSimple(prompt: string, masked = false): Promise<string> {
	return new Promise((resolve) => {
		const stdout = process.stdout;
		const stdin = process.stdin;
		stdout.write(prompt);

		const wasRaw = stdin.isRaw;
		if (stdin.isTTY) stdin.setRawMode(true);
		stdin.resume();

		let buffer = "";

		const onData = (chunk: Buffer): void => {
			for (const c of chunk.toString("utf-8")) {
				const code = c.charCodeAt(0);
				if (code === 3) { cleanup(); stdout.write("\n"); process.exit(0); }
				if (c === "\r" || c === "\n") { cleanup(); stdout.write("\n"); resolve(buffer); return; }
				if (code === 127 || code === 8) {
					if (buffer.length > 0) { buffer = buffer.slice(0, -1); stdout.write("\b \b"); }
					continue;
				}
				if (code < 32) continue;
				buffer += c;
				if (!masked) { stdout.write(c); } else { stdout.write("*"); }
			}
		};

		function cleanup(): void {
			stdin.removeListener("data", onData);
			if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
		}

		stdin.on("data", onData);
	});
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Guide the user through provider setup when no providers are detected.
 *
 * Steps:
 *   1. Print diagnostic: what CLIs were checked, Ollama status, env vars
 *   2. Auto-detect env vars and register if found
 *   3. If still nothing and TTY is available, present simple options
 *   4. If non-TTY, print guidance and return
 *
 * @param registry - The provider registry to register providers into
 * @param cliResults - Results from CLI detection
 * @param hasOllama - Whether Ollama was detected
 * @returns Whether a provider was successfully configured
 */
export async function guideProviderSetup(
	registry: ProviderRegistry,
	cliResults: CLIAvailability[],
	hasOllama: boolean,
): Promise<ProviderSetupResult> {
	const stderr = process.stderr;

	// Step 1: Print diagnostic
	printDiagnostic(cliResults, hasOllama);

	// Step 2: Check env vars — maybe user set one but we didn't pick it up
	const detectedKeys = detectEnvApiKeys();
	if (detectedKeys.length > 0) {
		const providers = autoRegisterFromEnvVars(registry, detectedKeys);
		if (providers.length > 0) {
			const labels = detectedKeys.map((k) => k.label).join(", ");
			stderr.write(`  \x1b[32mFound API key(s) in environment:\x1b[0m ${labels}\n`);
			stderr.write(`  \x1b[32mAuto-registered provider(s):\x1b[0m ${providers.join(", ")}\n\n`);
			persistProviderChoice(providers[0]);
			return { configured: true, providerId: providers[0] };
		}
	}

	// Step 3: If not a TTY, print guidance and bail
	if (!process.stdin.isTTY) {
		printNonInteractiveGuidance();
		return { configured: false };
	}

	// Step 4: Interactive prompt — simple numbered menu
	stderr.write("  \x1b[1mHow would you like to connect?\x1b[0m\n\n");
	stderr.write("    \x1b[36m1.\x1b[0m Enter an Anthropic API key\n");
	stderr.write("    \x1b[36m2.\x1b[0m Enter an OpenAI API key\n");
	stderr.write("    \x1b[36m3.\x1b[0m Enter a Google AI API key\n");
	stderr.write("    \x1b[36m4.\x1b[0m Skip for now (exit)\n\n");

	const choice = await readLineSimple("  \x1b[2mChoice [1-4]:\x1b[0m ");
	const choiceNum = parseInt(choice.trim(), 10);

	if (choiceNum >= 1 && choiceNum <= 3) {
		const options = [
			{ providerId: "anthropic", envVar: "ANTHROPIC_API_KEY", label: "Anthropic API key" },
			{ providerId: "openai", envVar: "OPENAI_API_KEY", label: "OpenAI API key" },
			{ providerId: "google", envVar: "GOOGLE_API_KEY", label: "Google AI API key" },
		];
		const selected = options[choiceNum - 1];

		const apiKey = await readLineSimple(`  ${selected.label}: `, true);
		if (!apiKey.trim()) {
			stderr.write("\n  \x1b[33mNo key entered.\x1b[0m Run \x1b[36mchitragupta\x1b[0m again after setting your API key.\n\n");
			return { configured: false };
		}

		// Persist and register
		persistProviderChoice(selected.providerId, selected.envVar, apiKey.trim());
		registerSwaraProviders(registry);

		stderr.write(`\n  \x1b[32mSaved ${selected.label}.\x1b[0m Provider \x1b[1m${selected.providerId}\x1b[0m is now active.\n\n`);
		return { configured: true, providerId: selected.providerId };
	}

	// Choice 4 or invalid — skip
	stderr.write("\n  \x1b[2mSkipped. Set an API key or install a CLI tool to get started.\x1b[0m\n\n");
	return { configured: false };
}
