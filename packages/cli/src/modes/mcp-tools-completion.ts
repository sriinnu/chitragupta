/**
 * MCP Tool Factory: chitragupta_completion.
 *
 * Exposes the swara CompletionRouter as an MCP tool, enabling
 * provider-agnostic LLM completion calls through the MCP protocol.
 * Supports model/provider selection, token limits, and returns
 * structured metadata with the response.
 *
 * @module
 */

import type { McpToolHandler, McpToolResult } from "@chitragupta/tantra";
import type { LLMProvider } from "@chitragupta/swara";

/**
 * Create the `chitragupta_completion` tool.
 *
 * Routes a completion request through the swara CompletionRouter,
 * which handles model-to-provider routing, fallback chains, retry
 * with exponential backoff, and configurable timeouts.
 *
 * The router and its providers are lazily initialized on first call
 * and cached for subsequent invocations.
 *
 * @returns An McpToolHandler ready for MCP server registration.
 */
export function createCompletionTool(): McpToolHandler {
	return {
		definition: {
			name: "chitragupta_completion",
			description:
				"Send a prompt to an LLM via Chitragupta's multi-provider completion router. " +
				"Supports model selection (claude-*, gpt-*, gemini-*, llama*, mistral*), " +
				"provider pinning, and token limits. Falls back through configured " +
				"provider chain on transient errors.",
			inputSchema: {
				type: "object",
				properties: {
					prompt: {
						type: "string",
						description: "The prompt text to send to the LLM.",
					},
					model: {
						type: "string",
						description:
							"Model identifier (e.g. 'claude-sonnet-4-5-20250929', 'gpt-4o'). " +
							"If omitted, uses the router's default model.",
					},
					provider: {
						type: "string",
						description:
							"Provider ID to pin the request to (e.g. 'anthropic', 'openai', 'ollama'). " +
							"If omitted, the router resolves the provider from the model prefix.",
					},
					maxTokens: {
						type: "number",
						description: "Maximum tokens to generate. Default: 4096",
					},
				},
				required: ["prompt"],
			},
		},

		async execute(args: Record<string, unknown>): Promise<McpToolResult> {
			const prompt = String(args.prompt ?? "");
			if (!prompt) {
				return {
					content: [{ type: "text", text: "Error: prompt is required" }],
					isError: true,
				};
			}

			const model = args.model ? String(args.model) : undefined;
			const provider = args.provider ? String(args.provider) : undefined;
			const maxTokens = args.maxTokens
				? Math.max(1, Math.min(100_000, Number(args.maxTokens) || 4096))
				: 4096;

			try {
				const { CompletionRouter } = await import("@chitragupta/swara");
				const adapters = await loadProviderAdapters(provider);

				if (adapters.length === 0) {
					return {
						content: [{ type: "text", text: "No LLM providers available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or configure Ollama." }],
						isError: true,
					};
				}

				const router = new CompletionRouter({
					providers: adapters,
					defaultModel: model ?? "claude-sonnet-4-5-20250929",
					retryAttempts: 2,
					timeout: 120_000,
				});

				const response = await router.complete({
					model: model ?? router.listModels()[0] ?? "claude-sonnet-4-5-20250929",
					messages: [{ role: "user", content: prompt }],
					maxTokens,
				});

				const text = response.content
					.filter((p) => p.type === "text" && p.text)
					.map((p) => p.text ?? "")
					.join("");

				return {
					content: [{ type: "text", text: text || "(empty response)" }],
					_metadata: {
						typed: {
							model: response.model,
							stopReason: response.stopReason,
							usage: response.usage,
							provider: provider ?? "auto",
						},
					},
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Completion failed: ${message}` }],
					isError: true,
				};
			}
		},
	};
}

// ─── Provider Adapter Loading ────────────────────────────────────────────────

/** Cached adapters to avoid re-creating on every call. */
let _cachedAdapters: LLMProvider[] | undefined;

/**
 * Lazily load available LLM provider adapters based on environment.
 *
 * Checks for API keys in environment variables and creates the
 * corresponding adapter. If a specific provider is requested,
 * only that adapter is loaded.
 *
 * @param pinnedProvider - Optional provider ID to load exclusively.
 * @returns Array of available LLM provider adapters.
 */
async function loadProviderAdapters(
	pinnedProvider?: string,
): Promise<LLMProvider[]> {
	if (_cachedAdapters && !pinnedProvider) {
		return _cachedAdapters;
	}

	const adapters: LLMProvider[] = [];

	try {
		const { createAnthropicAdapter, createOpenAIAdapter } = await import("@chitragupta/swara");

		const shouldLoadAnthropic = !pinnedProvider || pinnedProvider === "anthropic";
		const shouldLoadOpenAI = !pinnedProvider || pinnedProvider === "openai";

		if (shouldLoadAnthropic && process.env.ANTHROPIC_API_KEY) {
			adapters.push(createAnthropicAdapter());
		}

		if (shouldLoadOpenAI && process.env.OPENAI_API_KEY) {
			adapters.push(createOpenAIAdapter());
		}
	} catch {
		// Provider adapters are optional -- fail gracefully
	}

	if (!pinnedProvider) {
		_cachedAdapters = adapters;
	}

	return adapters;
}
