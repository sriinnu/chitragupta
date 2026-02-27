/**
 * @chitragupta/swara — CLI provider factory.
 *
 * Creates a ProviderDefinition that wraps a local CLI tool (e.g. claude,
 * gemini, codex, aider) using the ProcessPool for bounded concurrency.
 *
 * Unlike API providers, CLI providers spawn child processes instead of
 * making HTTP requests. The factory pattern mirrors createOpenAICompatProvider.
 */

import { ProviderError } from "@chitragupta/core";
import type { TokenUsage } from "@chitragupta/core";
import { ProcessPool, type ProcessPoolConfig } from "../process-pool.js";
import type {
	AuthConfig,
	Context,
	ModelDefinition,
	ProviderDefinition,
	StreamEvent,
	StreamOptions,
} from "../types.js";

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Threshold (bytes) above which prompt is piped via stdin
 * instead of passed as a CLI argument. macOS ARG_MAX is ~256KB;
 * we trigger well below that to leave room for other args.
 */
export const STDIN_THRESHOLD_BYTES = 100_000;

/** Configuration for creating a CLI-backed provider. */
export interface CLIProviderConfig {
	/** Unique provider ID (e.g. "claude-code", "gemini-cli"). */
	id: string;
	/** Human-readable display name. */
	name: string;
	/** The CLI command to invoke (e.g. "claude", "gemini"). */
	command: string;
	/** Model definitions exposed by this CLI provider. */
	models: ModelDefinition[];
	/**
	 * Build the argument list for the CLI invocation.
	 *
	 * When `viaStdin` is true the caller will pipe the prompt into
	 * the child's stdin. The returned args should contain only flags
	 * (no prompt text). When false, include the prompt in the args
	 * as before.
	 */
	buildArgs: (model: string, context: Context, options: StreamOptions, viaStdin: boolean) => string[];
	/** Extract the actual response text from CLI stdout. */
	parseOutput: (stdout: string) => string;
	/**
	 * Return the prompt text to pipe via stdin.
	 * Called only when the prompt exceeds {@link STDIN_THRESHOLD_BYTES}.
	 * If omitted, `contextToPrompt(context)` is used as fallback.
	 */
	getStdinPrompt?: (context: Context) => string;
	/** Whether the CLI supports streaming output. Default: false. */
	isStreaming?: boolean;
	/** Optional shared ProcessPool. If omitted, a private pool is created. */
	pool?: ProcessPool;
	/** Process pool configuration (used only when creating a private pool). */
	poolConfig?: ProcessPoolConfig;
	/** Default timeout (ms) for CLI invocations. Default: 120000. */
	timeout?: number;
	/** Working directory for the CLI process. */
	cwd?: string;
	/** Extra environment variables passed to the CLI process. */
	env?: Record<string, string>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Extract the last user message text from a Context.
 * Fallback for stdin piping when no `getStdinPrompt` is configured.
 */
function extractUserText(context: Context): string {
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg.role === "user") {
			const parts: string[] = [];
			for (const part of msg.content) {
				if (part.type === "text") parts.push(part.text);
			}
			if (parts.length > 0) return parts.join("\n");
		}
	}
	return "";
}

/**
 * Estimate the total byte size of a Context's user message text.
 * Used to decide whether to pipe the prompt via stdin.
 */
function estimatePromptBytes(context: Context): number {
	let total = 0;
	for (const msg of context.messages) {
		if (msg.role === "user") {
			for (const part of msg.content) {
				if (part.type === "text") {
					total += Buffer.byteLength(part.text, "utf-8");
				}
			}
		}
	}
	return total;
}

/**
 * Create a CLI-backed provider definition.
 *
 * The returned provider spawns the configured CLI command via a ProcessPool,
 * collects its output, and yields the standard stream event sequence:
 * start -> text -> done.
 *
 * When the prompt exceeds {@link STDIN_THRESHOLD_BYTES}, it is piped via
 * the child's stdin instead of passed as a CLI argument, preventing E2BIG.
 */
export function createCLIProvider(config: CLIProviderConfig): ProviderDefinition {
	const pool = config.pool ?? new ProcessPool(config.poolConfig);
	const defaultTimeout = config.timeout ?? 120_000;

	async function* streamImpl(
		model: string,
		context: Context,
		options: StreamOptions,
	): AsyncGenerator<StreamEvent> {
		// Detect large prompts and pipe via stdin to avoid E2BIG
		const promptBytes = estimatePromptBytes(context);
		const viaStdin = promptBytes >= STDIN_THRESHOLD_BYTES;
		const args = config.buildArgs(model, context, options, viaStdin);
		const messageId = `${config.id}-${Date.now()}`;

		yield { type: "start", messageId };

		// Build stdin payload when prompt is too large for CLI args
		let stdinPayload: string | undefined;
		if (viaStdin) {
			stdinPayload = config.getStdinPrompt
				? config.getStdinPrompt(context)
				: extractUserText(context);
		}

		let result;
		try {
			result = await pool.execute(config.command, args, {
				timeout: defaultTimeout,
				cwd: config.cwd,
				env: config.env,
				stdin: stdinPayload,
			});
		} catch (err) {
			const error = err instanceof Error
				? new ProviderError(
					`CLI "${config.command}" failed to spawn: ${err.message}`,
					config.id,
					undefined,
					err,
				)
				: new ProviderError(
					`CLI "${config.command}" failed to spawn`,
					config.id,
				);
			yield { type: "error", error };
			return;
		}

		if (result.exitCode !== 0 && !result.killed) {
			yield {
				type: "error",
				error: new ProviderError(
					`CLI "${config.command}" exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`,
					config.id,
				),
			};
			return;
		}

		if (result.killed) {
			yield {
				type: "error",
				error: new ProviderError(
					`CLI "${config.command}" was killed (timeout or signal)`,
					config.id,
				),
			};
			return;
		}

		const text = config.parseOutput(result.stdout);
		if (text.length > 0) {
			yield { type: "text", text };
		}

		// CLI tools don't report token counts — emit zeroed usage
		const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
		yield { type: "usage", usage };
		yield { type: "done", stopReason: "end_turn", usage };
	}

	async function validateKey(): Promise<boolean> {
		try {
			const result = await pool.execute("which", [config.command], {
				timeout: 5_000,
			});
			return result.exitCode === 0;
		} catch {
			return false;
		}
	}

	const auth: AuthConfig = { type: "custom" };

	return {
		id: config.id,
		name: config.name,
		models: config.models,
		auth,
		stream: streamImpl,
		validateKey,
	};
}
