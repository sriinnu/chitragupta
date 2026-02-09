/**
 * @chitragupta/cli — First-run onboarding flow.
 *
 * Guides the user through provider selection, API key configuration,
 * connection verification, and initial settings creation. Runs once
 * when ~/.chitragupta does not yet exist.
 */

import fs from "fs";
import path from "path";
import { getChitraguptaHome, DEFAULT_SETTINGS } from "@chitragupta/core";
import type { ChitraguptaSettings } from "@chitragupta/core";
import { bold, dim, green, cyan, yellow, red } from "@chitragupta/ui/ansi";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OnboardingResult {
	provider: string;
	model: string;
	completed: boolean;
}

interface ProviderChoice {
	id: string;
	name: string;
	envVar: string;
	defaultModel: string;
	needsKey: boolean;
	keyLabel: string;
}

// ─── Provider Definitions ────────────────────────────────────────────────────

const PROVIDERS: ProviderChoice[] = [
	{ id: "anthropic", name: "Anthropic (recommended)", envVar: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-4-5-20250929", needsKey: true, keyLabel: "Anthropic API key" },
	{ id: "openai", name: "OpenAI", envVar: "OPENAI_API_KEY", defaultModel: "gpt-4o", needsKey: true, keyLabel: "OpenAI API key" },
	{ id: "google", name: "Google (Gemini)", envVar: "GOOGLE_API_KEY", defaultModel: "gemini-2.0-flash", needsKey: true, keyLabel: "Google API key" },
	{ id: "ollama", name: "Ollama (local, no API key needed)", envVar: "OLLAMA_HOST", defaultModel: "llama3.2", needsKey: false, keyLabel: "Ollama endpoint" },
	{ id: "openai-compat", name: "Other (OpenAI-compatible)", envVar: "OPENAI_API_KEY", defaultModel: "gpt-4o", needsKey: true, keyLabel: "API key" },
];

// ─── Stdin Helpers ───────────────────────────────────────────────────────────

/**
 * Read a single line from stdin using raw mode.
 * Handles backspace, enter, and Ctrl+C. When `masked` is true,
 * renders dots for all but the last 4 characters.
 */
function readLine(prompt: string, masked = false): Promise<string> {
	return new Promise((resolve) => {
		const stdout = process.stdout;
		const stdin = process.stdin;
		stdout.write(prompt);

		const wasRaw = stdin.isRaw;
		if (stdin.isTTY) stdin.setRawMode(true);
		stdin.resume();

		let buffer = "";
		const VISIBLE_TAIL = 4;

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
				if (!masked) { stdout.write(c); continue; }

				// Redraw masked: ***...last4
				stdout.write("\r" + prompt);
				if (buffer.length <= VISIBLE_TAIL) {
					stdout.write(buffer);
				} else {
					stdout.write(dim("*".repeat(buffer.length - VISIBLE_TAIL)) + buffer.slice(-VISIBLE_TAIL));
				}
			}
		};

		function cleanup(): void {
			stdin.removeListener("data", onData);
			if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
		}

		stdin.on("data", onData);
	});
}

/** Present a numbered menu and return the zero-based index chosen. */
async function selectOption(title: string, options: string[]): Promise<number> {
	const stdout = process.stdout;
	stdout.write(`\n  ${bold(title)}\n\n`);
	for (let i = 0; i < options.length; i++) {
		const marker = i === 0 ? cyan("*") : dim(">");
		stdout.write(`    ${marker} ${dim(`${i + 1}.`)} ${options[i]}\n`);
	}
	stdout.write("\n");

	while (true) {
		const input = await readLine(`  ${dim("Choice [1-" + options.length + "]:")} `);
		const num = parseInt(input.trim(), 10);
		if (num >= 1 && num <= options.length) return num - 1;
		stdout.write(`  ${red("Invalid choice.")} Enter 1-${options.length}.\n`);
	}
}

// ─── First-Run Detection ────────────────────────────────────────────────────

/** Check whether this is the user's first run by looking for ~/.chitragupta. */
export function isFirstRun(): boolean {
	return !fs.existsSync(getChitraguptaHome());
}

// ─── Connection Test ─────────────────────────────────────────────────────────

/** Build a minimal request config for verifying a cloud provider's credentials. */
function buildTestRequest(providerId: string, key: string): { url: string; headers: Record<string, string>; body: string } {
	if (providerId === "anthropic") {
		return {
			url: "https://api.anthropic.com/v1/messages",
			headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
			body: JSON.stringify({ model: "claude-haiku-3-5-20241022", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
		};
	}
	if (providerId === "google") {
		return {
			url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 1 } }),
		};
	}
	// Default: OpenAI-compatible
	return {
		url: "https://api.openai.com/v1/chat/completions",
		headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
	};
}

/**
 * Verify credentials by making a minimal API call.
 * For Ollama, pings /api/tags. For cloud providers, sends a tiny completion.
 */
async function testConnection(provider: ProviderChoice, credential: string): Promise<boolean> {
	const stdout = process.stdout;
	stdout.write(`\n  ${dim("Testing connection...")}`);

	try {
		if (provider.id === "ollama") {
			const endpoint = credential || "http://localhost:11434";
			const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10_000) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			stdout.write(` ${green("Connected to Ollama.")}\n`);
			return true;
		}

		const req = buildTestRequest(provider.id, credential);
		const res = await fetch(req.url, {
			method: "POST", headers: req.headers, body: req.body,
			signal: AbortSignal.timeout(15_000),
		});

		if (res.status === 401 || res.status === 403) {
			stdout.write(` ${red("Authentication failed.")} Check your API key.\n`);
			return false;
		}
		if (res.status === 429) {
			stdout.write(` ${yellow("Rate limited, but credentials are valid.")}\n`);
			return true;
		}
		if (!res.ok) {
			stdout.write(` ${red(`Request failed (HTTP ${res.status}).`)}\n`);
			return false;
		}
		stdout.write(` ${green("Credentials verified.")}\n`);
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const label = msg.includes("timeout") || msg.includes("TIMEOUT") ? "Connection timed out." : `Connection failed: ${msg}`;
		stdout.write(` ${red(label)}\n`);
		return false;
	}
}

// ─── Main Onboarding Flow ────────────────────────────────────────────────────

/**
 * Run the interactive first-run onboarding flow.
 *
 * Walks through provider selection, credential entry, connection
 * verification, and writes initial configuration to ~/.chitragupta/config/.
 */
export async function runOnboarding(): Promise<OnboardingResult> {
	const stdout = process.stdout;
	const home = getChitraguptaHome();

	// 1. Welcome
	stdout.write("\n");
	stdout.write(`  ${bold("Welcome to Chitragupta.")} Let's get you set up.\n`);

	// 2. Provider selection
	const providerIndex = await selectOption(
		"Choose your AI provider:",
		PROVIDERS.map((p) => p.name),
	);
	const provider = PROVIDERS[providerIndex];

	// 3. Credential input
	let credential = "";
	if (provider.needsKey) {
		stdout.write("\n");
		credential = await readLine(`  ${dim(provider.keyLabel + ":")} `, true);
		if (!credential.trim()) {
			stdout.write(`\n  ${red("No key provided.")} Set it later: ${dim("chitragupta provider add " + provider.id)}\n\n`);
			return { provider: provider.id, model: provider.defaultModel, completed: false };
		}
		credential = credential.trim();
	} else {
		stdout.write("\n");
		const endpoint = await readLine(`  ${dim("Ollama endpoint [http://localhost:11434]:")} `);
		credential = endpoint.trim() || "http://localhost:11434";
	}

	// 4. Test connection
	const ok = await testConnection(provider, credential);
	if (!ok) {
		stdout.write(`\n  ${yellow("Saving credentials anyway.")} Re-test: ${dim("chitragupta provider test " + provider.id)}\n`);
	}

	// 5. Save credentials
	const configDir = path.join(home, "config");
	fs.mkdirSync(configDir, { recursive: true });

	const credentials: Record<string, string> = {};
	credentials[provider.needsKey ? provider.envVar : "OLLAMA_HOST"] = credential;

	const credPath = path.join(configDir, "credentials.json");
	fs.writeFileSync(credPath, JSON.stringify(credentials, null, "\t"), "utf-8");
	fs.chmodSync(credPath, 0o600);

	// 6. Create initial settings
	const settings: ChitraguptaSettings = {
		...DEFAULT_SETTINGS,
		defaultProvider: provider.id,
		defaultModel: provider.defaultModel,
	};
	if (provider.id === "ollama") settings.ollamaEndpoint = credential;

	fs.writeFileSync(path.join(configDir, "settings.json"), JSON.stringify(settings, null, "\t"), "utf-8");

	// Scaffold directory structure
	for (const dir of ["memory", "sessions", "profiles"]) {
		fs.mkdirSync(path.join(home, dir), { recursive: true });
	}

	// 7. Done
	stdout.write("\n");
	stdout.write(`  ${green(bold("You're ready."))} Try: ${cyan("chitragupta 'Hello'")}\n\n`);

	return { provider: provider.id, model: provider.defaultModel, completed: true };
}
