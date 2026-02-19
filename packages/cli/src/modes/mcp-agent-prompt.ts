import { DEFAULT_PROVIDER_PRIORITY, loadGlobalSettings } from "@chitragupta/core";
import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";

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

/**
 * Execute an agent prompt with provider fallback.
 *
 * Attempts:
 * 1. Requested provider/model (or auto routing when provider is omitted)
 * 2. Remaining providers from settings priority order, one by one
 */
export async function runAgentPromptWithFallback(
	params: {
		message: string;
		provider?: string;
		model?: string;
	},
	deps?: Partial<AgentPromptFallbackDeps>,
): Promise<{ response: string; providerId: string; attempts: number }> {
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
	const failures: string[] = [];
	for (let index = 0; index < attempts.length; index += 1) {
		const attempt = attempts[index];
		const providerId = attempt.provider ?? "auto";
		let runner: PromptRunner | null = null;
		try {
			runner = await createChitragupta({
				...(attempt.provider ? { provider: attempt.provider } : {}),
				...(attempt.model ? { model: attempt.model } : {}),
			});
			const response = await runner.prompt(params.message);
			return { response, providerId, attempts: index + 1 };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			failures.push(`${providerId}: ${detail}`);
		} finally {
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
