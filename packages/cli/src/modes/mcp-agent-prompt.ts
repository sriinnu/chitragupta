/**
 * MCP Agent Prompt — Smart fallback chain: CLI → Local → Cloud API.
 *
 * Implements `runAgentPromptWithFallback()` used by the `chitragupta_prompt`
 * MCP tool. Routes through available providers with graceful degradation:
 *
 *   1. **CLI providers** (claude, gemini, etc.) — fastest, uses existing auth
 *   2. **Local models** (ollama, llama.cpp) — no cloud dependency
 *   3. **Cloud API** via CompletionRouter — requires API keys
 *
 * Wires:
 *   - Wire 1: Project memory injected as system prompt context
 *   - Wire 2: Skill gap recording on all-fail scenarios
 *   - Wire 5: Soul identity (future: inject via loadProjectMemory)
 *
 * @module
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Heartbeat info emitted during execution. */
export interface HeartbeatInfo {
	/** Human-readable activity description. */
	activity: string;
}

/** Options for {@link runAgentPromptWithFallback}. */
export interface AgentPromptOptions {
	/** The user's message/task. */
	message: string;
	/** Heartbeat callback during execution. */
	onHeartbeat?: (info: HeartbeatInfo) => void;
}

/** Result from the agent prompt fallback chain. */
export interface AgentPromptResult {
	/** The LLM response text. */
	response: string;
	/** Provider that succeeded (CLI name or "api:<provider>"). */
	providerId: string;
	/** Total attempts made before success or failure. */
	attempts: number;
}

/** Detected CLI info. */
export interface CLIInfo {
	command: string;
	available: boolean;
}

/** CLI execution result. */
export interface CLIExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	killed: boolean;
}

/** Completion router interface (subset of swara CompletionRouter). */
export interface CompletionRouterLike {
	complete: (opts: Record<string, unknown>) => Promise<{
		content: Array<{ type: string; text: string }>;
	}>;
}

/** Local model completion result. */
export interface LocalCompletionResult {
	text: string;
	providerId: string;
}

/** Marga routing decision. */
export interface MargaDecision {
	providerId: string;
	modelId: string;
}

/**
 * Dependency injection interface for testability.
 *
 * All external I/O is injected, allowing tests to mock CLI detection,
 * execution, memory loading, and LLM routing without real providers.
 */
export interface SmartPromptDeps {
	/** Detect available CLI tools on PATH. */
	detectCLIs: () => Promise<CLIInfo[]>;
	/** Execute a CLI command with args. */
	executeCLI: (cmd: string, args: string[]) => Promise<CLIExecResult>;
	/** Load project memory for system prompt injection (Wire 1). */
	loadProjectMemory: () => string | undefined;
	/** Get a CompletionRouter for cloud API fallback. */
	getCompletionRouter: () => Promise<CompletionRouterLike | null>;
	/** Try a local model (ollama, llama.cpp). */
	localComplete: () => Promise<LocalCompletionResult | null>;
	/** Get Marga routing decision for model selection. */
	margaDecide: () => MargaDecision | null;
}

// ─── CLI Arg Builders ───────────────────────────────────────────────────────

type ArgBuilder = (message: string, systemPrompt?: string) => string[];

/** Known CLI tools and how to build their argument lists. */
const CLI_ARG_BUILDERS: Record<string, ArgBuilder> = {
	claude: (message, systemPrompt) => {
		const args = ["-p", message];
		if (systemPrompt) args.push("--system-prompt", systemPrompt);
		return args;
	},
	gemini: (message, systemPrompt) => {
		const args = [message];
		if (systemPrompt) args.push("--system-prompt", systemPrompt);
		return args;
	},
	aider: (message) => ["--message", message],
	codex: (message) => [message],
};

// ─── Auth Error Detection ───────────────────────────────────────────────────

const AUTH_PATTERNS = [
	/not logged in/i,
	/authenticate/i,
	/unauthorized/i,
	/auth.*fail/i,
	/login required/i,
	/api key.*invalid/i,
];

function isAuthError(stderr: string): boolean {
	return AUTH_PATTERNS.some((p) => p.test(stderr));
}

// ─── Skill Gap Recording (Wire 2) ──────────────────────────────────────────

/** Record a skill gap to the learning persistence file. */
function recordSkillGap(context: string): void {
	try {
		const learningDir = path.join(os.homedir(), ".chitragupta", "learning");
		fs.mkdirSync(learningDir, { recursive: true });
		const filePath = path.join(learningDir, "session-state.json");
		const entry = JSON.stringify({
			type: "prompt-all-fail",
			context,
			ts: Date.now(),
		}) + "\n";
		fs.appendFileSync(filePath, entry);
	} catch { /* best-effort */ }
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Run an agent prompt with smart fallback: CLI → Local → Cloud API.
 *
 * Tries available CLIs first (fastest, uses existing auth), then falls back
 * to local models, then cloud API via CompletionRouter. Project memory is
 * injected as system prompt context (Wire 1).
 *
 * @param options - Message and callbacks.
 * @param deps - Injected dependencies for testability.
 * @returns The response, provider ID, and attempt count.
 * @throws When all providers fail or auth errors are detected.
 */
export async function runAgentPromptWithFallback(
	options: AgentPromptOptions,
	deps: SmartPromptDeps,
): Promise<AgentPromptResult> {
	const { message, onHeartbeat } = options;
	const errors: string[] = [];
	let attempts = 0;
	let authError: string | null = null;

	// Wire 1: Load project memory for system prompt
	const projectMemory = deps.loadProjectMemory();
	const systemPrompt = projectMemory
		? `Project context:\n${projectMemory}`
		: undefined;

	// ─── Phase 1: Try available CLIs ──────────────────────────────────

	const clis = await deps.detectCLIs();
	const available = clis.filter((c) => c.available);

	for (const cli of available) {
		const argBuilder = CLI_ARG_BUILDERS[cli.command];
		if (!argBuilder) continue; // Skip CLIs without a known arg format

		attempts++;
		onHeartbeat?.({ activity: `trying ${cli.command}` });

		const args = argBuilder(message, systemPrompt);
		const result = await deps.executeCLI(cli.command, args);

		// Killed = timed out, skip to next
		if (result.killed) {
			errors.push(`${cli.command}: timed out`);
			continue;
		}

		if (result.exitCode === 0 && result.stdout.trim()) {
			return { response: result.stdout, providerId: cli.command, attempts };
		}

		// Detect auth errors for better error messages
		if (result.stderr && isAuthError(result.stderr)) {
			authError = `${cli.command}: ${result.stderr.trim()}`;
		}

		errors.push(`${cli.command}: ${result.stderr || "empty response"}`);
	}

	// ─── Phase 2: Try local model ────────────────────────────────────

	attempts++;
	onHeartbeat?.({ activity: "trying local model" });

	const localResult = await deps.localComplete();
	if (localResult) {
		return {
			response: localResult.text,
			providerId: localResult.providerId,
			attempts,
		};
	}

	// ─── Phase 3: Try cloud API via CompletionRouter ─────────────────

	attempts++;
	onHeartbeat?.({ activity: "trying cloud API" });

	const router = await deps.getCompletionRouter();
	if (router) {
		const routing = deps.margaDecide();
		const result = await router.complete({
			model: routing?.modelId,
			messages: [{ role: "user", content: message }],
		});

		const text = result.content?.find(
			(c: { type: string; text: string }) => c.type === "text",
		)?.text;

		if (text) {
			return {
				response: text,
				providerId: `api:${routing?.providerId ?? "auto"}`,
				attempts,
			};
		}
	}

	// ─── All failed ──────────────────────────────────────────────────

	// Wire 2: Record this as a skill gap
	recordSkillGap(message.slice(0, 200));

	if (authError) {
		throw new Error(`Auth error: ${authError}. Re-authenticate and try again.`);
	}

	throw new Error(
		`All attempts failed (${attempts}): ${errors.join("; ")}`,
	);
}
