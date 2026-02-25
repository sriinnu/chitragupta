/**
 * @chitragupta/swara — CompletionRouter.
 *
 * Provider-agnostic completion router that dispatches requests to the
 * appropriate LLM provider based on model prefix matching. Supports
 * fallback chains, retry with exponential backoff, and timeouts.
 */

import type {
	CompletionRequest,
	CompletionResponse,
	CompletionStreamChunk,
	CompletionRouterConfig,
	LLMProvider,
} from "./completion-types.js";

/** Default model prefix rules for routing. Order matters: first match wins. */
const DEFAULT_PREFIX_MAP: ReadonlyArray<{ prefix: string; providerId: string }> = [
	{ prefix: "claude-", providerId: "anthropic" },
	{ prefix: "gpt-", providerId: "openai" },
	{ prefix: "o1", providerId: "openai" },
	{ prefix: "o3", providerId: "openai" },
	{ prefix: "gemini-", providerId: "google" },
	{ prefix: "llama", providerId: "ollama" },
	{ prefix: "mistral", providerId: "ollama" },
	{ prefix: "codestral", providerId: "ollama" },
];

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Error thrown when no provider can handle the requested model. */
export class NoProviderError extends Error {
	readonly model: string;

	constructor(model: string) {
		super(`No provider found for model "${model}".`);
		this.name = "NoProviderError";
		this.model = model;
	}
}

/** Error thrown when a request exceeds its timeout. */
export class CompletionTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`Completion request timed out after ${timeoutMs}ms.`);
		this.name = "CompletionTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

/** Error thrown when all fallback providers fail. */
export class FallbackExhaustedError extends Error {
	readonly errors: Error[];

	constructor(errors: Error[]) {
		const summary = errors.map((e) => e.message).join("; ");
		super(`All fallback providers failed: ${summary}`);
		this.name = "FallbackExhaustedError";
		this.errors = errors;
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Determine if an error is transient and worth retrying.
 */
function isRetryable(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const msg = error.message.toLowerCase();
	return (
		msg.includes("429") ||
		msg.includes("500") ||
		msg.includes("502") ||
		msg.includes("503") ||
		msg.includes("529") ||
		msg.includes("rate limit") ||
		msg.includes("too many requests") ||
		msg.includes("overloaded") ||
		msg.includes("service unavailable") ||
		msg.includes("econnreset") ||
		msg.includes("etimedout") ||
		msg.includes("socket hang up")
	);
}

/**
 * Sleep for the given milliseconds, respecting an AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(new Error("Aborted"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Compute exponential backoff delay with jitter.
 */
function backoffDelay(attempt: number, baseMs: number): number {
	const exponential = baseMs * Math.pow(2, attempt);
	const jitter = Math.floor(Math.random() * 500);
	return exponential + jitter;
}

/**
 * Wrap a promise with a timeout.
 */
function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(new Error("Aborted"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			reject(new CompletionTimeoutError(timeoutMs));
		}, timeoutMs);
		signal?.addEventListener("abort", onAbort, { once: true });

		promise.then(
			(value) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

// ─── Model Registry Entry ───────────────────────────────────────────────────

interface ModelEntry {
	model: string;
	providerId: string;
}

// ─── CompletionRouter ───────────────────────────────────────────────────────

/**
 * Routes LLM completion requests to the appropriate provider.
 *
 * Features:
 * - Model-to-provider routing by prefix matching
 * - Fallback chain: try alternate models/providers on failure
 * - Retry with exponential backoff for transient errors
 * - Configurable request timeouts
 * - Runtime provider registration/removal
 */
export class CompletionRouter {
	private readonly providers = new Map<string, LLMProvider>();
	private readonly modelRegistry: ModelEntry[] = [];
	private readonly defaultModel: string | undefined;
	private readonly fallbackChain: string[];
	private readonly retryAttempts: number;
	private readonly retryDelayMs: number;
	private readonly timeout: number | undefined;

	constructor(config: CompletionRouterConfig) {
		this.defaultModel = config.defaultModel;
		this.fallbackChain = config.fallbackChain ?? [];
		this.retryAttempts = config.retryAttempts ?? 2;
		this.retryDelayMs = config.retryDelayMs ?? 1000;
		this.timeout = config.timeout;

		for (const provider of config.providers) {
			this.addProvider(provider);
		}
	}

	// ─── Provider Management ──────────────────────────────────────────────

	/** Register a new provider at runtime. Populates model registry asynchronously. */
	addProvider(provider: LLMProvider): void {
		this._removeProviderModels(provider.id);
		this.providers.set(provider.id, provider);
		this._populateModels(provider);
	}

	/** Remove all model entries currently tied to a provider ID. */
	private _removeProviderModels(providerId: string): void {
		for (let i = this.modelRegistry.length - 1; i >= 0; i--) {
			if (this.modelRegistry[i].providerId === providerId) {
				this.modelRegistry.splice(i, 1);
			}
		}
	}

	/** Query a provider's available models and add them to the registry. */
	private _populateModels(provider: LLMProvider): void {
		if (!provider.listModels) return;
		provider.listModels().then(
			(models) => {
				// Ignore stale async responses from providers that were replaced/removed.
				if (this.providers.get(provider.id) !== provider) {
					return;
				}
				for (const model of models) {
					if (!this.modelRegistry.some((e) => e.model === model)) {
						this.modelRegistry.push({ model, providerId: provider.id });
					}
				}
			},
			() => { /* best-effort — prefix matching still works as fallback */ },
		);
	}

	/** Remove a provider by ID. */
	removeProvider(providerId: string): void {
		this.providers.delete(providerId);
		this._removeProviderModels(providerId);
	}

	/** List all available model IDs across registered providers. */
	listModels(): string[] {
		const models = this.modelRegistry.map((e) => e.model);
		if (this.defaultModel) models.push(this.defaultModel);
		models.push(...this.fallbackChain);
		return [...new Set(models)];
	}

	/** Get a registered provider by ID. */
	getProvider(providerId: string): LLMProvider | undefined { return this.providers.get(providerId); }

	/** Get all registered provider IDs. */
	getProviderIds(): string[] { return [...this.providers.keys()]; }

	// ─── Routing ──────────────────────────────────────────────────────────

	/**
	 * Resolve the provider for a given model ID.
	 * Uses prefix matching against known provider patterns.
	 */
	resolveProvider(model: string): LLMProvider | undefined {
		// Check explicit model registry first.
		const entry = this.modelRegistry.find((e) => e.model === model);
		if (entry) {
			return this.providers.get(entry.providerId);
		}

		// Fall back to prefix matching.
		for (const rule of DEFAULT_PREFIX_MAP) {
			if (model.startsWith(rule.prefix)) {
				return this.providers.get(rule.providerId);
			}
		}

		// Last resort: try each provider.
		return undefined;
	}

	// ─── Completion ───────────────────────────────────────────────────────

	/**
	 * Send a completion request, routing to the appropriate provider.
	 *
	 * Applies retry logic for transient errors and falls back to
	 * alternate models if configured.
	 */
	async complete(request: CompletionRequest): Promise<CompletionResponse> {
		const model = request.model || this.defaultModel;
		if (!model) {
			throw new NoProviderError(request.model || "(no model specified)");
		}

		const modelsToTry = [model, ...this.fallbackChain.filter((m) => m !== model)];
		const errors: Error[] = [];

		for (const targetModel of modelsToTry) {
			const provider = this.resolveProvider(targetModel);
			if (!provider) {
				errors.push(new NoProviderError(targetModel));
				continue;
			}

			try {
				const result = await this.executeWithRetry(
					provider,
					{ ...request, model: targetModel },
				);
				return result;
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				errors.push(err);
				// Continue to next fallback model.
			}
		}

		if (errors.length === 1) {
			throw errors[0];
		}
		throw new FallbackExhaustedError(errors);
	}

	/**
	 * Stream a completion, routing to the appropriate provider.
	 *
	 * Falls back to non-streaming completion wrapped as a single
	 * chunk if the provider does not support streaming.
	 */
	async *stream(request: CompletionRequest): AsyncIterable<CompletionStreamChunk> {
		const model = request.model || this.defaultModel;
		if (!model) {
			throw new NoProviderError(request.model || "(no model specified)");
		}

		const modelsToTry = [model, ...this.fallbackChain.filter((m) => m !== model)];
		const errors: Error[] = [];

		for (const targetModel of modelsToTry) {
			const provider = this.resolveProvider(targetModel);
			if (!provider) {
				errors.push(new NoProviderError(targetModel));
				continue;
			}

			try {
				yield* this.streamWithRetry(
					provider,
					{ ...request, model: targetModel },
				);
				return;
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				errors.push(err);
				// Continue to next fallback model.
			}
		}

		if (errors.length === 1) {
			throw errors[0];
		}
		throw new FallbackExhaustedError(errors);
	}

	// ─── Retry Logic ──────────────────────────────────────────────────────

	/**
	 * Execute a completion with retry logic and optional timeout.
	 */
	private async executeWithRetry(
		provider: LLMProvider,
		request: CompletionRequest,
	): Promise<CompletionResponse> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
			try {
				const promise = provider.complete(request);
				if (this.timeout) {
					return await withTimeout(promise, this.timeout, request.signal);
				}
				return await promise;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (!isRetryable(error) || attempt >= this.retryAttempts) {
					throw lastError;
				}

				if (request.signal?.aborted) {
					throw lastError;
				}

				const delay = backoffDelay(attempt, this.retryDelayMs);
				await sleep(delay, request.signal);
			}
		}

		throw lastError ?? new Error("Unexpected retry exhaustion");
	}

	/**
	 * Stream with retry logic. On transient error, retries the
	 * entire stream from scratch.
	 */
	private async *streamWithRetry(
		provider: LLMProvider,
		request: CompletionRequest,
	): AsyncIterable<CompletionStreamChunk> {
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
			try {
				if (provider.stream) {
					yield* provider.stream(request);
				} else {
					// Provider doesn't support streaming; wrap complete() as chunks.
					const response = await provider.complete(request);
					const text = response.content
						.filter((p) => p.type === "text" && p.text)
						.map((p) => p.text!)
						.join("");
					if (text) {
						yield { type: "text_delta", text };
					}
					yield {
						type: "done",
						stopReason: response.stopReason,
						usage: response.usage,
					};
				}
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (!isRetryable(error) || attempt >= this.retryAttempts) {
					throw lastError;
				}

				if (request.signal?.aborted) {
					throw lastError;
				}

				const delay = backoffDelay(attempt, this.retryDelayMs);
				await sleep(delay, request.signal);
			}
		}

		throw lastError ?? new Error("Unexpected retry exhaustion");
	}
}
