/**
 * Takumi Bridge — Chitragupta -> Takumi child-process communication.
 *
 * Spawns Takumi as a headless child process and communicates via NDJSON
 * (structured mode) or plain text (CLI fallback mode). Provides graceful
 * degradation: RPC -> CLI text -> unavailable.
 *
 * Zero import coupling — all communication is via child_process stdio.
 *
 * @module
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type {
	TakumiBridgeOptions,
	TakumiBridgeStatus,
	TakumiContext,
	TakumiEvent,
	TakumiRequest,
	TakumiResponse,
} from "./takumi-bridge-types.js";
import {
	commandOnPath,
	getVersion,
	parseCliOutput,
	probeRpc,
	safeJsonParse,
} from "./takumi-bridge-helpers.js";

// Re-export helpers for backward-compat / convenience
export {
	commandOnPath,
	getVersion,
	parseCliOutput,
	probeRpc,
} from "./takumi-bridge-helpers.js";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Default timeout for a single task (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Default command name. */
const DEFAULT_COMMAND = "takumi";

// ─── Bridge Class ──────────────────────────────────────────────────────────

/**
 * Bridge for spawning Takumi as a child process and exchanging structured
 * results. Supports two communication modes:
 *
 * - **RPC mode**: NDJSON over stdio (`takumi --rpc`). Structured request/response.
 * - **CLI mode**: Plain text over stdio (`takumi --headless`). Output parsed for
 *   file modifications via git diff patterns.
 *
 * Falls back gracefully: RPC -> CLI -> unavailable.
 */
export class TakumiBridge {
	private readonly command: string;
	private readonly cwd: string;
	private readonly timeout: number;
	private readonly projectPath: string;
	private status: TakumiBridgeStatus | null = null;
	private injectedContext: TakumiContext | null = null;
	private activeProcess: ChildProcess | null = null;

	constructor(options: TakumiBridgeOptions) {
		this.command = options.command ?? DEFAULT_COMMAND;
		this.cwd = options.cwd;
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
		this.projectPath = options.projectPath ?? options.cwd;
	}

	// ─── Detection ───────────────────────────────────────────────────────

	/**
	 * Probe Takumi availability and determine the best communication mode.
	 *
	 * 1. Check if `takumi` exists on PATH via `which`/`where.exe`.
	 * 2. Run `takumi --version` to get the version string.
	 * 3. Probe RPC mode support by spawning `takumi --rpc` with a short timeout.
	 * 4. Fall back to CLI mode if RPC is unsupported.
	 */
	async detect(): Promise<TakumiBridgeStatus> {
		if (this.status !== null) return this.status;

		const exists = await commandOnPath(this.command);
		if (!exists) {
			this.status = { mode: "unavailable", command: this.command };
			return this.status;
		}

		const version = await getVersion(this.command);
		const rpcSupported = await probeRpc(this.command, this.cwd);

		this.status = {
			mode: rpcSupported ? "rpc" : "cli",
			command: this.command,
			version: version ?? undefined,
		};
		return this.status;
	}

	// ─── Execution ───────────────────────────────────────────────────────

	/**
	 * Execute a coding task via Takumi.
	 *
	 * Routes through the best available mode (RPC -> CLI -> error).
	 * Merges any previously injected context into the request.
	 */
	async execute(
		request: TakumiRequest,
		onEvent?: (event: TakumiEvent) => void,
	): Promise<TakumiResponse> {
		const status = await this.detect();

		// Merge injected context
		if (this.injectedContext) {
			request = {
				...request,
				context: { ...this.injectedContext, ...request.context },
			};
			this.injectedContext = null;
		}

		switch (status.mode) {
			case "rpc":
				return this._spawnRpc(request, onEvent);
			case "cli":
				return this._spawnCli(request.task, request.context, onEvent);
			default:
				return {
					type: "result",
					filesModified: [],
					output:
						`Takumi is not available on PATH.\n` +
						`Install: https://github.com/sriinnu/takumi\n` +
						`Or set a custom command in TakumiBridgeOptions.`,
					exitCode: 127,
				};
		}
	}

	/**
	 * Store context to be injected with the next `execute()` call.
	 * Merged into the request's context field.
	 */
	injectContext(context: TakumiContext): void {
		this.injectedContext = context;
	}

	/** Return the cached detection status (null if not yet probed). */
	getStatus(): TakumiBridgeStatus | null {
		return this.status;
	}

	/** Reset the cached detection result (useful for testing). */
	resetDetection(): void {
		this.status = null;
	}

	/** Kill any active child process and clean up. */
	dispose(): void {
		if (this.activeProcess && !this.activeProcess.killed) {
			this.activeProcess.kill("SIGTERM");
		}
		this.activeProcess = null;
		this.injectedContext = null;
	}

	// ─── Private: RPC Mode ───────────────────────────────────────────────

	/**
	 * Spawn `takumi --rpc` and communicate via NDJSON.
	 *
	 * Sends the full TakumiRequest as a single NDJSON line on stdin.
	 * Reads NDJSON lines from stdout — events (progress/error) are streamed
	 * to the callback, and the final "result" line is returned.
	 */
	private _spawnRpc(
		request: TakumiRequest,
		onEvent?: (event: TakumiEvent) => void,
	): Promise<TakumiResponse> {
		return new Promise((resolve) => {
			const args = ["--rpc", "--cwd", this.cwd];
			const proc = spawn(this.command, args, {
				cwd: this.cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...this._buildContextEnv(request.context) },
			});
			this.activeProcess = proc;

			let result: TakumiResponse | null = null;
			const stderrChunks: string[] = [];

			const timer = setTimeout(() => {
				proc.kill("SIGTERM");
			}, this.timeout);

			// Read NDJSON lines from stdout
			const rl = createInterface({ input: proc.stdout! });
			rl.on("line", (line) => {
				const parsed = safeJsonParse(line);
				if (!parsed) return;

				if (parsed.type === "result") {
					result = parsed as unknown as TakumiResponse;
				} else if (
					parsed.type === "progress" ||
					parsed.type === "tool_call" ||
					parsed.type === "error"
				) {
					onEvent?.(parsed as unknown as TakumiEvent);
				}
			});

			proc.stderr?.on("data", (chunk: Buffer) => {
				stderrChunks.push(chunk.toString("utf-8"));
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				this.activeProcess = null;
				resolve({
					type: "result",
					filesModified: [],
					output: `Failed to spawn ${this.command}: ${err.message}`,
					exitCode: 1,
				});
			});

			proc.on("close", (code) => {
				clearTimeout(timer);
				this.activeProcess = null;
				rl.close();

				if (result) {
					resolve(result);
				} else {
					resolve({
						type: "result",
						filesModified: [],
						output: stderrChunks.join("") || "Takumi RPC returned no result.",
						exitCode: code ?? 1,
					});
				}
			});

			// Send the request
			proc.stdin!.write(JSON.stringify(request) + "\n");
			proc.stdin!.end();
		});
	}

	// ─── Private: CLI Mode ───────────────────────────────────────────────

	/**
	 * Spawn `takumi --headless` and parse text output for file modifications.
	 *
	 * Falls back to unstructured communication — collects all stdout/stderr
	 * text and attempts to extract modified files from git diff patterns.
	 */
	private _spawnCli(
		task: string,
		context: TakumiContext | undefined,
		onEvent?: (event: TakumiEvent) => void,
	): Promise<TakumiResponse> {
		return new Promise((resolve) => {
			const args = this._buildCliArgs(task, context);
			const proc = spawn(this.command, args, {
				cwd: this.cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, ...this._buildContextEnv(context) },
			});
			this.activeProcess = proc;

			const chunks: string[] = [];

			const timer = setTimeout(() => {
				proc.kill("SIGTERM");
			}, this.timeout);

			proc.stdout?.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf-8");
				chunks.push(text);
				onEvent?.({ type: "progress", data: text });
			});

			proc.stderr?.on("data", (chunk: Buffer) => {
				chunks.push(chunk.toString("utf-8"));
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				this.activeProcess = null;
				resolve({
					type: "result",
					filesModified: [],
					output: `Failed to spawn ${this.command}: ${err.message}`,
					exitCode: 1,
				});
			});

			proc.on("close", (code) => {
				clearTimeout(timer);
				this.activeProcess = null;
				const output = chunks.join("");
				const parsed = parseCliOutput(output);

				resolve({
					type: "result",
					filesModified: parsed.filesModified,
					testsRun: parsed.testsRun,
					diffSummary: parsed.diffSummary,
					output,
					exitCode: code ?? 1,
				});
			});
		});
	}

	// ─── Private: Helpers ────────────────────────────────────────────────

	/** Build CLI arguments for headless mode. */
	private _buildCliArgs(task: string, context?: TakumiContext): string[] {
		const args = ["--headless", "--cwd", this.cwd, task];
		if (context?.repoMap) {
			args.push("--repo-map", context.repoMap);
		}
		return args;
	}

	/**
	 * Build environment variables for context injection.
	 * Serializes context fields as env vars prefixed with `CHITRAGUPTA_`.
	 */
	private _buildContextEnv(
		context?: TakumiContext,
	): Record<string, string> {
		if (!context) return {};
		const env: Record<string, string> = {};

		if (context.episodicHints?.length) {
			env.CHITRAGUPTA_EPISODIC_HINTS = JSON.stringify(context.episodicHints);
		}
		if (context.recentDecisions?.length) {
			env.CHITRAGUPTA_RECENT_DECISIONS = JSON.stringify(
				context.recentDecisions,
			);
		}
		if (context.fileContext && Object.keys(context.fileContext).length > 0) {
			env.CHITRAGUPTA_FILE_CONTEXT = JSON.stringify(context.fileContext);
		}
		return env;
	}
}
