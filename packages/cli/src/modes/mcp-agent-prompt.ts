import { DEFAULT_PROVIDER_PRIORITY, loadGlobalSettings } from "@chitragupta/core";
import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import type { HeartbeatCallback } from "./mcp-prompt-jobs.js";

type PromptRunner = {
	prompt: (message: string) => Promise<string>;
	destroy: () => Promise<void>;
};

type PromptRunnerFactory = (options: {
	provider?: string;
	model?: string;
}) => Promise<PromptRunner>;

type AgentPromptFallbackDeps = {
	createChitragupta: PromptRunnerFactory;
	loadSettings: () => { providerPriority?: string[] };
	defaultProviderPriority: readonly string[];
};

/** Default timeout for a single prompt attempt (2 minutes). */
const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;
/** Heartbeat cadence while waiting on a provider response. */
const PROMPT_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Execute an agent prompt with provider fallback.
 *
 * Attempts:
 * 1. Requested provider/model (or auto routing when provider is omitted)
 * 2. Remaining providers from settings priority order, one by one
 *
 * Each attempt is bounded by `timeoutMs` (default 120s) to prevent
 * indefinite hangs when a provider is slow or unresponsive.
 */
export async function runAgentPromptWithFallback(
	params: {
		message: string;
		provider?: string;
		model?: string;
		timeoutMs?: number;
		/** Heartbeat callback — fired at each execution phase so the caller can detect liveness. */
		onHeartbeat?: HeartbeatCallback;
	},
	deps?: Partial<AgentPromptFallbackDeps>,
): Promise<{ response: string; providerId: string; attempts: number }> {
	const timeoutMs = params.timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
	const createChitragupta =
		deps?.createChitragupta ?? (await import("../api.js")).createChitragupta;
	const loadSettings = deps?.loadSettings ?? loadGlobalSettings;
	const defaultProviderPriority = deps?.defaultProviderPriority ?? DEFAULT_PROVIDER_PRIORITY;
	const explicitProvider = typeof params.provider === "string" && params.provider.trim().length > 0
		? params.provider.trim()
		: undefined;
	const explicitModel = typeof params.model === "string" && params.model.trim().length > 0
		? params.model.trim()
		: undefined;
	const settings = loadSettings();
	const configuredPriority =
		Array.isArray(settings.providerPriority) && settings.providerPriority.length > 0
			? settings.providerPriority
			: [...defaultProviderPriority];
	const dedupedPriority = [...new Set(configuredPriority.filter((id) => id && id.trim().length > 0))];
	const fallbackProviders = explicitProvider
		? dedupedPriority.filter((id) => id !== explicitProvider)
		: dedupedPriority.slice(1);
	const attempts: Array<{ provider?: string; model?: string }> = [
		{ provider: explicitProvider, model: explicitModel },
		...fallbackProviders.map((providerId) => ({ provider: providerId })),
	];
	const hb = params.onHeartbeat;
	const failures: string[] = [];
	for (let index = 0; index < attempts.length; index += 1) {
		const attempt = attempts[index];
		const providerId = attempt.provider ?? "auto";
		const attemptNum = index + 1;
		let runner: PromptRunner | null = null;
		let heartbeatTimer: NodeJS.Timeout | null = null;
		try {
			hb?.({ activity: `connecting to ${providerId}`, attempt: attemptNum, provider: providerId });
			runner = await createChitragupta({
				...(attempt.provider ? { provider: attempt.provider } : {}),
				...(attempt.model ? { model: attempt.model } : {}),
			});
			hb?.({ activity: `prompting ${providerId}`, attempt: attemptNum, provider: providerId });
			if (hb) {
				heartbeatTimer = setInterval(() => {
					hb({ activity: `prompting ${providerId}`, attempt: attemptNum, provider: providerId });
				}, PROMPT_HEARTBEAT_INTERVAL_MS);
			}
			let timeoutHandle: NodeJS.Timeout | null = null;
			let response: string;
			try {
				response = await Promise.race([
					runner.prompt(params.message),
					new Promise<never>((_, reject) => {
						timeoutHandle = setTimeout(() => reject(new Error(`Prompt timed out after ${timeoutMs}ms`)), timeoutMs);
					}),
				]);
			} finally {
				if (timeoutHandle) clearTimeout(timeoutHandle);
			}
			hb?.({ activity: "completed", attempt: attemptNum, provider: providerId });
			return { response, providerId, attempts: attemptNum };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			failures.push(`${providerId}: ${detail}`);
			hb?.({ activity: `failed ${providerId}, retrying`, attempt: attemptNum, provider: providerId });
		} finally {
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
			}
			if (runner) {
				try {
					await runner.destroy();
				} catch {
					// Best-effort cleanup.
				}
			}
		}
	}
	const summary = failures.slice(0, 4).join(" | ");
	throw new Error(`All provider attempts failed. ${summary || "No details available."}`);
}

/**
 * Create the `chitragupta_prompt` tool — delegates a task to Chitragupta's agent.
 */
export function createAgentPromptTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_prompt",
			description:
				"Delegate a task to Chitragupta's AI agent. The agent has its own " +
				"memory, tools, and configuration. Use this for complex tasks that " +
				"benefit from Chitragupta's project context and memory.",
			inputSchema: {
				type: "object",
				properties: {
					message: {
						type: "string",
						description: "The prompt/task to send to Chitragupta's agent.",
					},
					provider: {
						type: "string",
						description: "AI provider to use. Default: from config (usually 'anthropic')",
					},
					model: {
						type: "string",
						description: "Model to use. Default: from config",
					},
					timeout: {
						type: "number",
						description: "Timeout in milliseconds per attempt. Default: 120000 (2 min)",
					},
				},
				required: ["message"],
			},
		},
		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const message = String(args.message ?? "");
			if (!message) {
				return {
					content: [{ type: "text", text: "Error: message is required" }],
					isError: true,
				};
			}

			try {
				const result = await runAgentPromptWithFallback({
					message,
					...(args.provider ? { provider: String(args.provider) } : {}),
					...(args.model ? { model: String(args.model) } : {}),
					...(args.timeout ? { timeoutMs: Number(args.timeout) } : {}),
				});
				return {
					content: [{ type: "text", text: result.response }],
					_metadata: {
						providerId: result.providerId,
						attempts: result.attempts,
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Agent prompt failed: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	};
}
