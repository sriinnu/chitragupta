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
	/** Build the argument list for the CLI invocation. */
	buildArgs: (model: string, context: Context, options: StreamOptions) => string[];
	/** Extract the actual response text from CLI stdout. */
	parseOutput: (stdout: string) => string;
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
 * Create a CLI-backed provider definition.
 *
 * The returned provider spawns the configured CLI command via a ProcessPool,
 * collects its output, and yields the standard stream event sequence:
 * start → text → done.
 */
export function createCLIProvider(config: CLIProviderConfig): ProviderDefinition {
	const pool = config.pool ?? new ProcessPool(config.poolConfig);
	const defaultTimeout = config.timeout ?? 120_000;

	async function* streamImpl(
		model: string,
		context: Context,
		options: StreamOptions,
	): AsyncGenerator<StreamEvent> {
		const args = config.buildArgs(model, context, options);
		const messageId = `${config.id}-${Date.now()}`;

		yield { type: "start", messageId };

		let result;
		try {
			result = await pool.execute(config.command, args, {
				timeout: defaultTimeout,
				cwd: config.cwd,
				env: config.env,
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
