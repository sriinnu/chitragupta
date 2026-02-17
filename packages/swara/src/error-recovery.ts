/**
 * @chitragupta/swara — Error recovery and circuit breaker.
 *
 * Provides:
 *   - Structured error parsing from raw provider responses
 *   - Circuit breaker pattern to stop hammering a failing provider
 *   - A `resilientStream()` wrapper that combines retry + circuit breaker
 */

import { ProviderError, StreamError, ChitraguptaError } from "@chitragupta/core";
import type { Context, StreamEvent, StreamOptions, ProviderDefinition } from "./types.js";
import { retryableStream } from "./retry.js";
import type { RetryConfig, RetryEventHandler } from "./retry.js";

// ─── Structured Error Parsing ───────────────────────────────────────────────

/**
 * A parsed, structured representation of a provider error.
 */
export interface ParsedProviderError {
	/** The original error. */
	original: Error;
	/** Which provider produced the error. */
	provider: string;
	/** HTTP status code, if available. */
	statusCode?: number;
	/** A human-readable error type. */
	errorType: ProviderErrorType;
	/** Whether this error is likely transient and retryable. */
	retryable: boolean;
	/** Suggested wait time in ms before retrying, if known. */
	retryAfterMs?: number;
	/** The raw error message from the provider. */
	rawMessage: string;
}

export type ProviderErrorType =
	| "rate_limit"
	| "auth"
	| "invalid_request"
	| "context_length"
	| "content_filter"
	| "server_error"
	| "network"
	| "timeout"
	| "overloaded"
	| "unknown";

/**
 * Parse a raw error into a structured ParsedProviderError.
 *
 * Inspects the error type, status code, and message to determine
 * the error category, retryability, and suggested action.
 */
export function parseProviderError(
	error: unknown,
	providerId: string,
): ParsedProviderError {
	const err = error instanceof Error ? error : new Error(String(error));
	const message = err.message.toLowerCase();

	let statusCode: number | undefined;
	if (error instanceof ProviderError) {
		statusCode = error.statusCode;
	}

	let errorType: ProviderErrorType = "unknown";
	let retryable = false;
	let retryAfterMs: number | undefined;

	// Determine error type by status code first, then by message
	if (statusCode !== undefined) {
		switch (statusCode) {
			case 401:
			case 403:
				errorType = "auth";
				retryable = false;
				break;
			case 400:
				if (message.includes("context") || message.includes("token")) {
					errorType = "context_length";
				} else if (message.includes("content") || message.includes("filter") || message.includes("safety")) {
					errorType = "content_filter";
				} else {
					errorType = "invalid_request";
				}
				retryable = false;
				break;
			case 429:
				errorType = "rate_limit";
				retryable = true;
				// Try to extract retry-after from the message
				const retryMatch = message.match(/retry[- ]?after[:\s]+(\d+)/i);
				if (retryMatch) {
					retryAfterMs = parseInt(retryMatch[1], 10) * 1000;
				}
				break;
			case 500:
			case 502:
			case 503:
				errorType = "server_error";
				retryable = true;
				break;
			case 529:
				errorType = "overloaded";
				retryable = true;
				break;
			default:
				if (statusCode >= 500) {
					errorType = "server_error";
					retryable = true;
				}
				break;
		}
	} else {
		// No status code — detect from message
		if (message.includes("rate limit") || message.includes("too many requests")) {
			errorType = "rate_limit";
			retryable = true;
		} else if (message.includes("unauthorized") || message.includes("invalid api key") || message.includes("authentication")) {
			errorType = "auth";
			retryable = false;
		} else if (message.includes("context length") || message.includes("maximum context") || message.includes("too many tokens")) {
			errorType = "context_length";
			retryable = false;
		} else if (message.includes("content filter") || message.includes("safety") || message.includes("content policy")) {
			errorType = "content_filter";
			retryable = false;
		} else if (message.includes("econnreset") || message.includes("econnrefused") || message.includes("socket hang up") || message.includes("fetch failed")) {
			errorType = "network";
			retryable = true;
		} else if (message.includes("timeout") || message.includes("etimedout") || message.includes("timed out")) {
			errorType = "timeout";
			retryable = true;
		} else if (message.includes("overloaded") || message.includes("capacity")) {
			errorType = "overloaded";
			retryable = true;
		} else if (message.includes("server error") || message.includes("internal error")) {
			errorType = "server_error";
			retryable = true;
		}
	}

	return {
		original: err,
		provider: providerId,
		statusCode,
		errorType,
		retryable,
		retryAfterMs,
		rawMessage: err.message,
	};
}

/**
 * Convert a ParsedProviderError into a typed ChitraguptaError.
 */
export function toChitraguptaError(parsed: ParsedProviderError): ChitraguptaError {
	switch (parsed.errorType) {
		case "rate_limit":
			return new ProviderError(
				`Rate limited by ${parsed.provider}. ${parsed.retryAfterMs ? `Retry after ${Math.ceil(parsed.retryAfterMs / 1000)}s.` : ""}`,
				parsed.provider,
				parsed.statusCode,
			);
		case "auth":
			return new ProviderError(
				`Authentication failed for ${parsed.provider}. Check your API key.`,
				parsed.provider,
				parsed.statusCode,
			);
		case "context_length":
			return new ProviderError(
				`Context length exceeded for ${parsed.provider}. Try compacting your conversation.`,
				parsed.provider,
				parsed.statusCode,
			);
		case "content_filter":
			return new ProviderError(
				`Content filtered by ${parsed.provider}'s safety system.`,
				parsed.provider,
				parsed.statusCode,
			);
		case "overloaded":
			return new ProviderError(
				`${parsed.provider} is currently overloaded. Try again shortly.`,
				parsed.provider,
				parsed.statusCode,
			);
		case "network":
			return new StreamError(
				`Network error connecting to ${parsed.provider}: ${parsed.rawMessage}`,
			);
		case "timeout":
			return new StreamError(
				`Request to ${parsed.provider} timed out.`,
			);
		case "server_error":
			return new ProviderError(
				`Server error from ${parsed.provider}: ${parsed.rawMessage}`,
				parsed.provider,
				parsed.statusCode,
			);
		case "invalid_request":
			return new ProviderError(
				`Invalid request to ${parsed.provider}: ${parsed.rawMessage}`,
				parsed.provider,
				parsed.statusCode,
			);
		default:
			return new ProviderError(
				`Error from ${parsed.provider}: ${parsed.rawMessage}`,
				parsed.provider,
				parsed.statusCode,
			);
	}
}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

export interface CircuitBreakerConfig {
	/** Number of consecutive failures before opening the circuit. */
	failureThreshold: number;
	/** How long (in ms) to wait before attempting a request on an open circuit. */
	cooldownMs: number;
	/** Number of successes in half-open state to close the circuit. */
	successThreshold: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 5,
	cooldownMs: 30_000,
	successThreshold: 2,
};

type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker for LLM provider calls.
 *
 * Monitors consecutive failures and opens the circuit (stops making
 * requests) when the failure threshold is reached. After a cooldown
 * period, the circuit enters a half-open state where a limited number
 * of probe requests are allowed. If those succeed, the circuit closes
 * again.
 *
 * This prevents wasting API quota and user time on a failing provider.
 */
export class CircuitBreaker {
	private config: CircuitBreakerConfig;
	private state: CircuitState = "closed";
	private consecutiveFailures = 0;
	private consecutiveSuccesses = 0;
	private lastFailureTime = 0;
	private readonly providerId: string;

	constructor(providerId: string, config: Partial<CircuitBreakerConfig> = {}) {
		this.providerId = providerId;
		this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
	}

	/**
	 * Check if a request is allowed through the circuit.
	 *
	 * @throws ProviderError if the circuit is open and not yet in cooldown.
	 */
	allowRequest(): boolean {
		switch (this.state) {
			case "closed":
				return true;

			case "open": {
				// Check if cooldown has elapsed
				const elapsed = Date.now() - this.lastFailureTime;
				if (elapsed >= this.config.cooldownMs) {
					// Transition to half-open
					this.state = "half-open";
					this.consecutiveSuccesses = 0;
					return true;
				}
				return false;
			}

			case "half-open":
				return true;
		}
	}

	/**
	 * Record a successful request. Helps close the circuit in half-open state.
	 */
	recordSuccess(): void {
		this.consecutiveFailures = 0;

		if (this.state === "half-open") {
			this.consecutiveSuccesses++;
			if (this.consecutiveSuccesses >= this.config.successThreshold) {
				this.state = "closed";
			}
		}
	}

	/**
	 * Record a failed request. May open the circuit.
	 */
	recordFailure(): void {
		this.consecutiveSuccesses = 0;
		this.consecutiveFailures++;
		this.lastFailureTime = Date.now();

		if (this.state === "half-open") {
			// Any failure in half-open immediately reopens
			this.state = "open";
		} else if (this.consecutiveFailures >= this.config.failureThreshold) {
			this.state = "open";
		}
	}

	/**
	 * Get the current circuit state.
	 */
	getState(): CircuitState {
		return this.state;
	}

	/**
	 * Get the remaining cooldown time in milliseconds.
	 * Returns 0 if the circuit is not open.
	 */
	getRemainingCooldown(): number {
		if (this.state !== "open") return 0;
		const elapsed = Date.now() - this.lastFailureTime;
		return Math.max(0, this.config.cooldownMs - elapsed);
	}

	/**
	 * Get the provider ID this circuit breaker is for.
	 */
	getProviderId(): string {
		return this.providerId;
	}

	/**
	 * Reset the circuit breaker to closed state.
	 */
	reset(): void {
		this.state = "closed";
		this.consecutiveFailures = 0;
		this.consecutiveSuccesses = 0;
		this.lastFailureTime = 0;
	}
}

// ─── Resilient Stream ───────────────────────────────────────────────────────

export interface ResilientStreamOptions {
	retryConfig?: Partial<RetryConfig>;
	circuitBreaker?: CircuitBreaker;
	onRetry?: RetryEventHandler;
}

/**
 * A resilient stream wrapper that combines retry logic with circuit breaking.
 *
 * Before making a request, checks the circuit breaker. On success, records
 * it. On failure, records it and retries if applicable.
 *
 * @param provider  The LLM provider.
 * @param model     The model ID.
 * @param context   The conversation context.
 * @param options   Stream options.
 * @param resilientOpts  Retry and circuit breaker configuration.
 */
export async function* resilientStream(
	provider: ProviderDefinition,
	model: string,
	context: Context,
	options: StreamOptions = {},
	resilientOpts: ResilientStreamOptions = {},
): AsyncIterable<StreamEvent> {
	const { circuitBreaker, retryConfig, onRetry } = resilientOpts;

	// Check circuit breaker before attempting
	if (circuitBreaker) {
		if (!circuitBreaker.allowRequest()) {
			const remaining = circuitBreaker.getRemainingCooldown();
			const parsed = parseProviderError(
				new ProviderError(
					`Circuit breaker open for provider "${provider.id}". ` +
					`Too many consecutive failures. Cooldown: ${Math.ceil(remaining / 1000)}s remaining.`,
					provider.id,
				),
				provider.id,
			);
			throw toChitraguptaError(parsed);
		}
	}

	try {
		const stream = retryableStream(provider, model, context, options, retryConfig, onRetry);

		for await (const event of stream) {
			yield event;
		}

		// Stream completed successfully
		circuitBreaker?.recordSuccess();
	} catch (error) {
		// Record failure in circuit breaker
		circuitBreaker?.recordFailure();

		// Parse into a structured error and rethrow as a ChitraguptaError
		const parsed = parseProviderError(error, provider.id);
		throw toChitraguptaError(parsed);
	}
}
