/**
 * @chitragupta/yantra — Shell command execution tool.
 *
 * Executes shell commands via child_process.spawn with shell: true.
 * Captures stdout and stderr, returns combined output with exit code.
 * No command filtering is done here — the agent/permission layer handles that.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import type { ToolHandler, ToolContext, ToolResult } from "./types.js";
import { validatePath } from "./path-validation.js";

/** Configurable limits for the bash tool. */
export interface BashConfig {
	defaultTimeout?: number;
	maxOutput?: number;
}

const DEFAULT_BASH_CONFIG: Required<BashConfig> = {
	defaultTimeout: 30_000,
	maxOutput: 1_000_000,
};

let _bashConfig = { ...DEFAULT_BASH_CONFIG };

/** Update bash tool configuration at runtime. */
export function configureBash(config: BashConfig): void {
	_bashConfig = { ...DEFAULT_BASH_CONFIG, ...config };
}

function resolveCwd(cwd: string | undefined, context: ToolContext): string | ToolResult {
	if (!cwd) return context.workingDirectory;
	const resolved = path.isAbsolute(cwd) ? cwd : path.resolve(context.workingDirectory, cwd);
	const pathError = validatePath(cwd, resolved);
	if (pathError) return pathError;
	return resolved;
}

// ─── Environment Fortress ───────────────────────────────────────────────────

/**
 * Patterns for environment variable names that contain credentials.
 * Matched case-insensitively against each key in process.env.
 */
const CREDENTIAL_PATTERNS = [
	/_API_KEY$/i,
	/_SECRET/i,
	/_TOKEN$/i,
	/_PASSWORD/i,
	/_CREDENTIALS$/i,
	/^ANTHROPIC_/i,
	/^OPENAI_/i,
	/^GOOGLE_API/i,
	/^GEMINI_API/i,
	/^XAI_/i,
	/^GROQ_/i,
	/^CEREBRAS_/i,
	/^MISTRAL_/i,
	/^DEEPSEEK_/i,
	/^OPENROUTER_/i,
	/^TOGETHER_/i,
	/^CHITRAGUPTA_API/i,
	/^CHITRAGUPTA_AUTH/i,
];

/**
 * Build a sanitized environment for child processes.
 *
 * Inherits the full process.env but strips any keys that match
 * credential patterns. This prevents the agent from exfiltrating
 * API keys via `echo $ANTHROPIC_API_KEY` or `env | grep KEY`.
 */
function buildSafeEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (!CREDENTIAL_PATTERNS.some((pat) => pat.test(key))) {
			env[key] = value;
		}
	}
	return env;
}

/**
 * Sensitive file paths that shell commands must not access.
 * If a command references any of these, it is blocked.
 */
const BLOCKED_COMMAND_PATTERNS = [
	/credentials\.json/i,
	/\.chitragupta\/config/i,
	/\.ssh\//i,
	/\.gnupg\//i,
	/id_rsa/i,
	/id_ed25519/i,
	/id_ecdsa/i,
];

/**
 * Shell command execution tool handler.
 *
 * Executes commands via `child_process.spawn` with `shell: true`.
 * Captures stdout and stderr; supports timeouts and abort signals.
 * Output is truncated at ~1 MB.
 *
 * @example
 * ```ts
 * const result = await bashTool.execute(
 *   { command: "ls -la", timeout: 5000 },
 *   context,
 * );
 * ```
 */
export const bashTool: ToolHandler = {
	definition: {
		name: "bash",
		description:
			"Execute a shell command and return its output. " +
			"Captures both stdout and stderr. Returns the combined output with exit code.",
		inputSchema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "The shell command to execute.",
				},
				cwd: {
					type: "string",
					description: "Working directory for the command. Defaults to the session working directory.",
				},
				timeout: {
					type: "number",
					description: "Timeout in milliseconds. Defaults to 30000 (30 seconds).",
				},
			},
			required: ["command"],
		},
	},

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const command = args.command as string | undefined;
		if (!command) {
			return { content: "Error: 'command' argument is required.", isError: true };
		}

		// Block commands that reference sensitive credential files
		for (const pat of BLOCKED_COMMAND_PATTERNS) {
			if (pat.test(command)) {
				return {
					content: "Error: access to sensitive path denied. Commands referencing credential files, .ssh, or .gnupg are blocked.",
					isError: true,
				};
			}
		}

		const cwdResult = resolveCwd(args.cwd as string | undefined, context);
		if (typeof cwdResult === "object") return cwdResult; // ToolResult error
		const cwd = cwdResult;
		const timeout = (args.timeout as number) || _bashConfig.defaultTimeout;

		return new Promise<ToolResult>((resolve) => {
			const chunks: Buffer[] = [];
			let totalBytes = 0;
			let truncated = false;
			let killed = false;
			let timedOut = false;

			const proc = spawn(command, [], {
				shell: true,
				cwd,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: buildSafeEnv(),
			});

			/**
			 * Kill the entire process group (shell + children like `sleep`).
			 * On Linux/WSL, `shell: true` spawns a child under /bin/sh.
			 * SIGTERM to the shell alone does NOT propagate to children,
			 * so we kill the process group via negative pid.
			 */
			const killGroup = (sig: NodeJS.Signals) => {
				try {
					if (proc.pid) process.kill(-proc.pid, sig);
				} catch {
					try { proc.kill(sig); } catch { /* already dead */ }
				}
			};

			// Handle abort signal from context
			const abortHandler = () => {
				killed = true;
				killGroup("SIGTERM");
			};
			if (context.signal) {
				context.signal.addEventListener("abort", abortHandler, { once: true });
			}

			// Timeout handler
			const timer = setTimeout(() => {
				timedOut = true;
				killed = true;
				killGroup("SIGTERM");
				setTimeout(() => killGroup("SIGKILL"), 500);
			}, timeout);

			const collectOutput = (data: Buffer) => {
				if (truncated) return;
				totalBytes += data.length;
				if (totalBytes > _bashConfig.maxOutput) {
					truncated = true;
					// Keep only what fits
					const remaining = _bashConfig.maxOutput - (totalBytes - data.length);
					if (remaining > 0) {
						chunks.push(data.subarray(0, remaining));
					}
				} else {
					chunks.push(data);
				}
			};

			if (proc.stdout) proc.stdout.on("data", collectOutput);
			if (proc.stderr) proc.stderr.on("data", collectOutput);

			proc.on("close", (code, signal) => {
				clearTimeout(timer);
				if (context.signal) {
					context.signal.removeEventListener("abort", abortHandler);
				}

				const output = Buffer.concat(chunks).toString("utf-8");
				const exitCode = code ?? -1;

				let content = output;
				if (truncated) {
					content += `\n\n[Output truncated at ${_bashConfig.maxOutput} bytes]`;
				}
				if (timedOut) {
					content += `\n\n[Command timed out after ${timeout}ms]`;
				}
				if (killed && !timedOut) {
					content += `\n\n[Command was aborted]`;
				}

				content += `\n\n[Exit code: ${exitCode}]`;

				resolve({
					content,
					isError: exitCode !== 0,
					metadata: {
						exitCode,
						signal: signal ?? undefined,
						timedOut,
						truncated,
						cwd,
					},
				});
			});

			proc.on("error", (error) => {
				clearTimeout(timer);
				if (context.signal) {
					context.signal.removeEventListener("abort", abortHandler);
				}

				resolve({
					content: `Error executing command: ${error.message}`,
					isError: true,
					metadata: { cwd },
				});
			});
		});
	},
};
