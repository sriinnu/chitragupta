/**
 * Smart Prompt Runner — CLI-first, API-fallback, no Agent boot.
 *
 * Architecture:
 *   Phase 1: Try installed CLIs directly (zero cost, 30s timeout)
 *            Skip self-host to prevent recursion.
 *   Phase 2: Try local LLM (Ollama) if running.
 *   Phase 3: Try API keys via CompletionRouter (paid, Marga-routed).
 *
 * Each CLI is called as a raw subprocess — NO full Agent/session boot.
 * Auth errors are detected from stderr and reported with re-auth hints.
 *
 * @module
 */

import type { HeartbeatCallback } from "./mcp-prompt-jobs.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Timeout per CLI attempt — fail fast, move on. */
const CLI_TIMEOUT_MS = 30_000;
/** Timeout for API completion attempts. */
const API_TIMEOUT_MS = 60_000;
/** Heartbeat interval. */
const HEARTBEAT_INTERVAL_MS = 8_000;

/** Auth-failure patterns in CLI stderr/stdout. */
const AUTH_ERROR_PATTERNS = [
	"auth", "login", "token expired", "authenticate", "unauthorized",
	"not logged in", "credentials", "sign in", "access denied",
];

/** Re-auth hints per CLI. */
const AUTH_HINTS: Record<string, string> = {
	claude: "Run: claude auth login",
	gemini: "Run: gemini auth login",
	copilot: "Run: copilot auth login (or: gh auth login)",
	codex: "Run: codex auth login",
	aider: "Check aider API key configuration",
	zai: "Run: zai auth login (or set ZAI_API_KEY)",
	minimax: "Set MINIMAX_API_KEY environment variable",
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface PromptAttemptResult {
	response: string;
	providerId: string;
	phase: "cli" | "ollama" | "api";
}

/** Injectable dependencies for testing. */
export interface SmartPromptDeps {
	detectCLIs?: () => Promise<Array<{ command: string; available: boolean }>>;
	executeCLI?: (command: string, args: string[], timeoutMs: number) => Promise<{
		stdout: string; stderr: string; exitCode: number; killed: boolean;
	}>;
	loadProjectMemory?: (projectPath: string) => string | undefined;
	getCompletionRouter?: () => Promise<{
		complete: (req: { model: string; messages: Array<{ role: string; content: string }>; maxTokens: number }) =>
			Promise<{ content: Array<{ type: string; text?: string }> }>;
	} | null>;
	margaDecide?: (msg: string) => Promise<{ providerId: string; modelId: string } | null> | { providerId: string; modelId: string } | null;
}

// ─── Self-Recursion Detection ───────────────────────────────────────────────

/** CLIs to skip when running inside an MCP subprocess to prevent recursion. */
function getSkippedCLIs(): Set<string> {
	const skipped = new Set<string>();
	// When spawned by Claude Code as MCP, skip claude to prevent recursion
	if (process.env.CHITRAGUPTA_MCP_AGENT === "true") {
		skipped.add("claude");
	}
	return skipped;
}

// ─── Auth Error Detection ───────────────────────────────────────────────────

function isAuthError(output: string): boolean {
	const lower = output.toLowerCase();
	return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
}

function formatAuthHint(command: string, stderr: string): string {
	const hint = AUTH_HINTS[command] ?? `Check ${command} authentication`;
	const detail = stderr.slice(0, 200).trim();
	return `${command} auth expired. ${hint}. Detail: ${detail}`;
}

// ─── Phase 1: Direct CLI Execution ──────────────────────────────────────────

async function tryCliProviders(
	message: string,
	systemPrompt: string | undefined,
	hb: HeartbeatCallback | undefined,
	deps: SmartPromptDeps,
): Promise<{ result?: PromptAttemptResult; failures: string[] }> {
	const failures: string[] = [];
	const skipped = getSkippedCLIs();

	// Detect available CLIs
	const detectCLIs = deps.detectCLIs ?? (async () => {
		const { detectAvailableCLIs } = await import("@chitragupta/swara");
		return detectAvailableCLIs();
	});
	const cliResults = await detectCLIs();
	const availableCLIs = cliResults.filter((c) => c.available && !skipped.has(c.command));

	if (availableCLIs.length === 0) {
		failures.push("No CLIs available" + (skipped.size > 0 ? ` (skipped: ${[...skipped].join(", ")})` : ""));
		return { failures };
	}

	// Build CLI args per command
	const cliArgBuilders: Record<string, () => string[]> = {
		claude: () => {
			const args = ["--print", message, "--output-format", "text"];
			if (systemPrompt) args.push("--system-prompt", systemPrompt);
			return args;
		},
		gemini: () => {
			const prompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;
			return ["--prompt", prompt];
		},
		copilot: () => {
			const prompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;
			return ["-p", prompt];
		},
		codex: () => {
			const prompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;
			return ["exec", "--full-auto", prompt];
		},
		aider: () => {
			const prompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;
			return ["--message", prompt, "--no-auto-commits", "--yes"];
		},
		zai: () => {
			const prompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;
			return ["-p", prompt];
		},
		minimax: () => {
			const prompt = systemPrompt ? `${systemPrompt}\n\n${message}` : message;
			return ["-p", prompt];
		},
	};

	const executeCLI = deps.executeCLI ?? (async (cmd: string, args: string[], timeout: number) => {
		const { ProcessPool } = await import("@chitragupta/swara/process-pool");
		const pool = new ProcessPool({ maxConcurrency: 2 });
		return pool.execute(cmd, args, { timeout });
	});

	for (let i = 0; i < availableCLIs.length; i++) {
		const cli = availableCLIs[i];
		const attemptNum = i + 1;
		const buildArgs = cliArgBuilders[cli.command];
		if (!buildArgs) {
			failures.push(`${cli.command}: no arg builder`);
			continue;
		}

		hb?.({ activity: `trying ${cli.command}`, attempt: attemptNum, provider: cli.command });

		let heartbeatTimer: NodeJS.Timeout | null = null;
		try {
			if (hb) {
				heartbeatTimer = setInterval(() => {
					hb({ activity: `waiting on ${cli.command}`, attempt: attemptNum, provider: cli.command });
				}, HEARTBEAT_INTERVAL_MS);
			}

			const result = await executeCLI(cli.command, buildArgs(), CLI_TIMEOUT_MS);

			if (result.killed) {
				failures.push(`${cli.command}: timed out after ${CLI_TIMEOUT_MS / 1000}s`);
				continue;
			}

			if (result.exitCode !== 0) {
				if (isAuthError(result.stderr || result.stdout)) {
					failures.push(formatAuthHint(cli.command, result.stderr || result.stdout));
					continue;
				}
				failures.push(`${cli.command}: exit ${result.exitCode} — ${(result.stderr || result.stdout).slice(0, 200)}`);
				continue;
			}

			const text = result.stdout.trim();
			if (text.length > 0) {
				hb?.({ activity: "completed", attempt: attemptNum, provider: cli.command });
				return { result: { response: text, providerId: cli.command, phase: "cli" }, failures };
			}
			failures.push(`${cli.command}: empty response`);
		} catch (err) {
			failures.push(`${cli.command}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			if (heartbeatTimer) clearInterval(heartbeatTimer);
		}
	}

	return { failures };
}

// ─── Phase 3: API Completion (CompletionRouter) ─────────────────────────────

async function tryApiProviders(
	message: string,
	systemPrompt: string | undefined,
	hb: HeartbeatCallback | undefined,
	deps: SmartPromptDeps,
): Promise<{ result?: PromptAttemptResult; failures: string[] }> {
	const failures: string[] = [];

	hb?.({ activity: "trying API providers", attempt: 1, provider: "api" });

	try {
		const getRouter = deps.getCompletionRouter ?? (async () => {
			const { createAnthropicAdapter, createOpenAIAdapter, CompletionRouter } = await import("@chitragupta/swara");
			const adapters = [];
			if (process.env.ANTHROPIC_API_KEY) adapters.push(createAnthropicAdapter());
			if (process.env.OPENAI_API_KEY) adapters.push(createOpenAIAdapter());
			if (adapters.length === 0) return null;
			return new CompletionRouter({ providers: adapters, retryAttempts: 1, timeout: API_TIMEOUT_MS });
		});

		const router = await getRouter();
		if (!router) {
			failures.push("No API keys available (set ANTHROPIC_API_KEY or OPENAI_API_KEY)");
			return { failures };
		}

		// Use Marga for smart model selection on API calls
		let model = "claude-sonnet-4-5-20250929";
		const decide = deps.margaDecide ?? (async (msg: string) => {
			try {
				const { margaDecide } = await import("@chitragupta/swara");
				return margaDecide({ message: msg, hasTools: false, hasImages: false, bindingStrategy: "cloud" });
			} catch { return null; }
		});
		const decision = await Promise.resolve(decide(message));
		if (decision?.modelId) model = decision.modelId;

		const messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }> = [];
		if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
		messages.push({ role: "user", content: message });

		hb?.({ activity: `calling ${model}`, attempt: 1, provider: "api" });
		const response = await router.complete({ model, messages, maxTokens: 8192 });
		const text = response.content
			.filter((p) => p.type === "text" && p.text)
			.map((p) => p.text ?? "")
			.join("");

		if (text.length > 0) {
			hb?.({ activity: "completed", attempt: 1, provider: "api" });
			return { result: { response: text, providerId: `api:${model}`, phase: "api" }, failures };
		}
		failures.push("API: empty response");
	} catch (err) {
		failures.push(`API: ${err instanceof Error ? err.message : String(err)}`);
	}

	return { failures };
}

// ─── Main Entry: Smart Prompt Runner ────────────────────────────────────────

/**
 * Execute a prompt using the smart CLI-first, API-fallback strategy.
 *
 * Phase 1: Try installed CLIs directly (30s timeout, skip self-host).
 * Phase 2: Try API keys via CompletionRouter (Marga-routed model).
 * Reports auth failures with re-auth hints.
 */
export async function runAgentPromptWithFallback(
	params: {
		message: string;
		provider?: string;
		model?: string;
		timeoutMs?: number;
		onHeartbeat?: HeartbeatCallback;
	},
	deps?: Partial<SmartPromptDeps>,
): Promise<{ response: string; providerId: string; attempts: number }> {
	const safeDeps: SmartPromptDeps = deps ?? {};
	const hb = params.onHeartbeat;
	const allFailures: string[] = [];

	// Load project memory for context (lightweight, cached)
	let systemPrompt: string | undefined;
	try {
		const loadMem = safeDeps.loadProjectMemory ?? (await import("../bootstrap.js")).loadProjectMemory;
		const memory = loadMem(process.cwd());
		if (memory) {
			systemPrompt = `You are Chitragupta, an AI assistant with project memory.\n\nProject context:\n${memory.slice(0, 4000)}`;
		}
	} catch { /* memory loading is best-effort */ }

	// Phase 1: CLI providers (zero cost)
	const cliResult = await tryCliProviders(params.message, systemPrompt, hb, safeDeps);
	if (cliResult.result) return { ...cliResult.result, attempts: 1 };
	allFailures.push(...cliResult.failures);

	// Phase 2: API providers (paid, Marga-routed)
	const apiResult = await tryApiProviders(params.message, systemPrompt, hb, safeDeps);
	if (apiResult.result) return { ...apiResult.result, attempts: allFailures.length + 1 };
	allFailures.push(...apiResult.failures);

	const summary = allFailures.slice(0, 6).join(" | ");
	throw new Error(`All attempts failed. ${summary}`);
}
