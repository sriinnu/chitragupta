/**
 * @chitragupta/swara — Retry with exponential backoff.
 *
 * Wraps a provider's stream() with automatic retry logic for transient
 * failures. Retries on rate-limit (429), server errors (500, 502, 503),
 * and overloaded (529) status codes.
 *
 * Uses exponential backoff with jitter to prevent thundering-herd
 * problems across concurrent clients.
 */

import { ProviderError } from "@chitragupta/core";
import type { Context, StreamEvent, StreamOptions, ProviderDefinition } from "./types.js";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface RetryConfig {
	/** Maximum number of retry attempts before giving up. */
	maxRetries: number;
	/** Base delay in milliseconds before the first retry. */
	baseDelay: number;
	/** Maximum delay cap in milliseconds. */
	maxDelay: number;
	/** Multiplier applied to the base delay on each successive retry. */
	backoffMultiplier: number;
}

/** Sensible defaults for retry configuration. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	baseDelay: 1000,
	maxDelay: 30_000,
	backoffMultiplier: 2,
};

/** HTTP status codes that should trigger a retry. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);

// ─── Retry Event ────────────────────────────────────────────────────────────

export interface RetryEvent {
	/** Which attempt this retry is (1-based). */
	attempt: number;
	/** Maximum allowed attempts. */
	maxRetries: number;
	/** Delay in milliseconds before the next attempt. */
	delayMs: number;
	/** The error that caused the retry. */
	error: Error;
	/** The HTTP status code that triggered the retry, if available. */
	statusCode?: number;
}

export type RetryEventHandler = (event: RetryEvent) => void;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Determine whether an error is retryable based on its status code or message.
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof ProviderError && error.statusCode !== undefined) {
		return RETRYABLE_STATUS_CODES.has(error.statusCode);
	}

	// Fall back to message-based detection for errors without status codes
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return (
			msg.includes("rate limit") ||
			msg.includes("too many requests") ||
			msg.includes("overloaded") ||
			msg.includes("service unavailable") ||
			msg.includes("bad gateway") ||
			msg.includes("internal server error") ||
			msg.includes("econnreset") ||
			msg.includes("etimedout") ||
			msg.includes("socket hang up")
		);
	}

	return false;
}

/**
 * Extract a status code from an error, if present.
 */
function extractStatusCode(error: unknown): number | undefined {
	if (error instanceof ProviderError) {
		return error.statusCode;
	}
	return undefined;
}

/**
 * Parse a Retry-After header value into milliseconds.
 *
 * The header can be either an integer (seconds) or an HTTP-date.
 * Returns undefined if the value cannot be parsed.
 */
export function parseRetryAfter(value: string | undefined): number | undefined {
	if (!value) return undefined;

	// Try integer seconds first
	const seconds = Number(value);
	if (!Number.isNaN(seconds) && seconds > 0) {
		return seconds * 1000;
	}

	// Try HTTP-date
	const date = new Date(value);
	if (!Number.isNaN(date.getTime())) {
		const delayMs = date.getTime() - Date.now();
		return delayMs > 0 ? delayMs : undefined;
	}

	return undefined;
}

/**
 * Compute the delay for a given retry attempt.
 *
 * Uses exponential backoff: delay = min(baseDelay * multiplier^attempt, maxDelay)
 * plus a random jitter of 0-500ms to prevent thundering herd.
 */
export function computeDelay(
	attempt: number,
	config: RetryConfig,
	retryAfterMs?: number,
): number {
	// If the server specified a Retry-After, respect it as a minimum
	const exponential = Math.min(
		config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
		config.maxDelay,
	);

	// Add jitter: random 0-500ms
	const jitter = Math.floor(Math.random() * 500);

	const computed = exponential + jitter;

	// If Retry-After is present and larger, use it instead
	if (retryAfterMs !== undefined && retryAfterMs > computed) {
		return Math.min(retryAfterMs + jitter, config.maxDelay);
	}

	return computed;
}

/**
 * Sleep for the specified number of milliseconds, respecting an AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error("Aborted"));
			return;
		}

		const timer = setTimeout(resolve, ms);

		const onAbort = () => {
			clearTimeout(timer);
			reject(signal!.reason ?? new Error("Aborted"));
		};

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

// ─── Retryable Stream ───────────────────────────────────────────────────────

/**
 * Wrap a provider's stream() call with automatic retry logic.
 *
 * On retryable errors, waits with exponential backoff and retries the
 * entire stream from scratch. Emits retry events so the UI can display
 * "Retrying in Xs..." messages.
 *
 * @param provider   The LLM provider to stream from.
 * @param model      The model ID to use.
 * @param context    The conversation context.
 * @param options    Stream options (temperature, maxTokens, etc.).
 * @param retryConfig  Retry configuration. Defaults to DEFAULT_RETRY_CONFIG.
 * @param onRetry    Optional callback invoked before each retry.
 */
export async function* retryableStream(
	provider: ProviderDefinition,
	model: string,
	context: Context,
	options: StreamOptions = {},
	retryConfig: Partial<RetryConfig> = {},
	onRetry?: RetryEventHandler,
): AsyncIterable<StreamEvent> {
	const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
		try {
			// Yield all events from the provider's stream
			yield* provider.stream(model, context, options);
			// If we get here without error, the stream completed successfully
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// If not retryable or we've exhausted retries, rethrow
			if (!isRetryableError(error) || attempt >= config.maxRetries) {
				throw lastError;
			}

			// Check if the operation was aborted
			if (options.signal?.aborted) {
				throw lastError;
			}

			// Extract Retry-After if available (from ProviderError metadata)
			const statusCode = extractStatusCode(error);
			let retryAfterMs: number | undefined;

			if (error instanceof ProviderError) {
				// Some providers include retry-after in the error message
				const retryAfterMatch = error.message.match(/retry[- ]after:\s*(\d+)/i);
				if (retryAfterMatch) {
					retryAfterMs = parseInt(retryAfterMatch[1], 10) * 1000;
				}
			}

			// Compute the delay for this attempt
			const delayMs = computeDelay(attempt, config, retryAfterMs);

			// Emit retry event
			const retryEvent: RetryEvent = {
				attempt: attempt + 1,
				maxRetries: config.maxRetries,
				delayMs,
				error: lastError,
				statusCode,
			};

			onRetry?.(retryEvent);

			// Wait before retrying
			await sleep(delayMs, options.signal);
		}
	}

	// Should not reach here, but just in case
	if (lastError) {
		throw lastError;
	}
}
