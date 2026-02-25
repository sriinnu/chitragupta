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

const SUPPORTED_COMPLETION_PROVIDERS = ["anthropic", "openai"] as const;
type SupportedCompletionProvider = (typeof SUPPORTED_COMPLETION_PROVIDERS)[number];

const DEFAULT_MODEL_BY_PROVIDER: Record<SupportedCompletionProvider, string> = {
	anthropic: "claude-sonnet-4-5-20250929",
	openai: "gpt-4o",
};

const PROVIDER_ENV_KEYS: Record<SupportedCompletionProvider, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
};

function isSupportedCompletionProvider(
	value: string | undefined,
): value is SupportedCompletionProvider {
	if (!value) return false;
	return SUPPORTED_COMPLETION_PROVIDERS.includes(value as SupportedCompletionProvider);
}

function buildNoAdaptersError(
	pinnedProvider: SupportedCompletionProvider | undefined,
): string {
	if (pinnedProvider) {
		return `Provider "${pinnedProvider}" is unavailable. Set ${PROVIDER_ENV_KEYS[pinnedProvider]} and retry.`;
	}
	return "No completion providers available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.";
}

function resolveModel(
	requestedModel: string | undefined,
	pinnedProvider: SupportedCompletionProvider | undefined,
	adapters: LLMProvider[],
): string {
	if (requestedModel) {
		return requestedModel;
	}

	if (pinnedProvider) {
		return DEFAULT_MODEL_BY_PROVIDER[pinnedProvider];
	}

	if (adapters.some((adapter) => adapter.id === "anthropic")) {
		return DEFAULT_MODEL_BY_PROVIDER.anthropic;
	}
	if (adapters.some((adapter) => adapter.id === "openai")) {
		return DEFAULT_MODEL_BY_PROVIDER.openai;
	}

	return DEFAULT_MODEL_BY_PROVIDER.anthropic;
}

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
				"Supports model selection, provider pinning (anthropic/openai), and token limits. " +
				"Falls back through configured provider chain on transient errors.",
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
							"If omitted, uses a provider-aware default model.",
					},
					provider: {
						type: "string",
						description:
							"Provider ID to pin the request to ('anthropic' or 'openai'). " +
							"If omitted, the router resolves provider from model/default routing.",
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

			const model = args.model ? String(args.model).trim() : undefined;
			const providerArg = args.provider ? String(args.provider).trim().toLowerCase() : undefined;
			if (providerArg && !isSupportedCompletionProvider(providerArg)) {
				return {
					content: [{
						type: "text",
						text: `Error: unsupported provider "${providerArg}". Supported providers: ${SUPPORTED_COMPLETION_PROVIDERS.join(", ")}.`,
					}],
					isError: true,
				};
			}

			const pinnedProvider = providerArg as SupportedCompletionProvider | undefined;
			const maxTokens = args.maxTokens
				? Math.max(1, Math.min(100_000, Number(args.maxTokens) || 4096))
				: 4096;

			try {
				const { CompletionRouter } = await import("@chitragupta/swara");
				const adapters = await loadProviderAdapters(pinnedProvider);

				if (adapters.length === 0) {
					return {
						content: [{ type: "text", text: buildNoAdaptersError(pinnedProvider) }],
						isError: true,
					};
				}

				const selectedModel = resolveModel(model, pinnedProvider, adapters);
				const router = new CompletionRouter({
					providers: adapters,
					defaultModel: selectedModel,
					retryAttempts: 2,
					timeout: 120_000,
				});

				const response = await router.complete({
					model: selectedModel,
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
							provider: pinnedProvider ?? "auto",
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
	pinnedProvider?: SupportedCompletionProvider,
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
