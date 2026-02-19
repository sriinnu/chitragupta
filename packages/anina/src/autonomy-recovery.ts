/**
 * @chitragupta/anina — Autonomy error classification, retry, and recovery.
 *
 * Standalone functions extracted from AutonomousAgent for:
 * - Error classification (transient vs fatal vs unknown)
 * - Exponential backoff retry with jitter
 * - Context corruption detection and recovery
 * - Message validation (structural prefix scanning)
 */

import type { AgentMessage, AgentState } from "./types.js";

// ─── Error Classification ───────────────────────────────────────────────────

/** Transient error patterns (network, timeout, rate limit). */
const TRANSIENT_PATTERNS = [
	/timeout/i, /ECONNREFUSED/i, /ECONNRESET/i, /ETIMEDOUT/i,
	/ENOTFOUND/i, /rate.?limit/i, /429/, /503/, /502/, /504/,
	/too many requests/i, /network/i, /fetch failed/i,
	/socket hang up/i, /EPIPE/i,
];

/** Fatal error patterns (invalid input, permission, auth). */
const FATAL_PATTERNS = [
	/invalid.*input/i, /permission denied/i, /unauthorized/i,
	/forbidden/i, /401/, /403/, /invalid.*api.?key/i,
	/authentication/i, /not found.*model/i, /invalid.*model/i,
	/context.*length.*exceeded/i,
];

/**
 * Classify an error as transient, fatal, or unknown.
 *
 * Transient errors are retryable (network glitches, rate limits, timeouts).
 * Fatal errors should be surfaced immediately (bad input, auth failures).
 * Unknown errors default to cautious retry behavior.
 */
export function classifyError(error: Error): "transient" | "fatal" | "unknown" {
	const message = error.message + (error.cause ? ` ${String(error.cause)}` : "");
	for (const pattern of FATAL_PATTERNS) {
		if (pattern.test(message)) return "fatal";
	}
	for (const pattern of TRANSIENT_PATTERNS) {
		if (pattern.test(message)) return "transient";
	}
	return "unknown";
}

// ─── Backoff ────────────────────────────────────────────────────────────────

/**
 * Compute exponential backoff delay with jitter.
 *
 *     delay = min(baseDelay * 2^attempt + jitter, maxDelay)
 *     jitter = random(0, baseDelay)
 */
export function computeBackoffDelay(
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
): number {
	const exponential = baseDelayMs * Math.pow(2, attempt);
	const jitter = Math.random() * baseDelayMs;
	return Math.min(exponential + jitter, maxDelayMs);
}

/** Sleep for the given duration. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Retry ──────────────────────────────────────────────────────────────────

/** Options for the retry helper. */
export interface RetryOptions {
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
	unknownErrorCounts: Map<string, number>;
	onClassified?: (error: Error, classification: string, attempt: number) => void;
	onRetry?: (attempt: number, delayMs: number, error: Error, classification: string) => void;
}

/**
 * Execute an async operation with self-healing error recovery.
 *
 * Transient errors are retried with exponential backoff and jitter.
 * Fatal errors are thrown immediately.
 * Unknown errors are retried once, then treated as fatal on 3rd occurrence.
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	opts: RetryOptions,
): Promise<T> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		try {
			return await operation();
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			lastError = error;

			const classification = classifyError(error);
			opts.onClassified?.(error, classification, attempt);

			if (classification === "fatal") throw error;

			if (classification === "unknown") {
				const key = error.message.slice(0, 100);
				const count = (opts.unknownErrorCounts.get(key) ?? 0) + 1;
				opts.unknownErrorCounts.set(key, count);
				if (count >= 3) throw error;
			}

			if (attempt < opts.maxRetries) {
				const delay = computeBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
				opts.onRetry?.(attempt + 1, delay, error, classification);
				await sleep(delay);
			}
		}
	}

	throw lastError ?? new Error("Retry exhausted with no error captured");
}

// ─── Message Validation ─────────────────────────────────────────────────────

/**
 * Find the longest valid prefix of messages.
 *
 * A valid message sequence follows these rules:
 * 1. Each message has an id, role, content array, and timestamp.
 * 2. tool_result messages must follow a message containing tool_call parts.
 * 3. No orphaned tool results.
 */
export function findValidMessagePrefix(messages: AgentMessage[]): AgentMessage[] {
	const valid: AgentMessage[] = [];
	let lastHadToolCalls = false;

	for (const msg of messages) {
		if (!msg.id || !msg.role || !Array.isArray(msg.content)) break;
		if (typeof msg.timestamp !== "number" || msg.timestamp <= 0) break;
		if (msg.role === "tool_result" && !lastHadToolCalls) break;
		lastHadToolCalls = msg.content.some((p) => p.type === "tool_call");
		valid.push(msg);
	}

	return valid;
}

// ─── Context Recovery ───────────────────────────────────────────────────────

/** Options for context recovery. */
export interface RecoveryOptions {
	lastGoodMessages: AgentMessage[] | null;
	onRecovered?: (method: string, originalLength: number, recoveredLength: number) => void;
}

/**
 * Recover from context corruption by restoring the last known good state.
 *
 * Scans the current messages backward to find the last structurally valid
 * prefix. If no valid prefix is found, falls back to the last snapshot.
 */
export function recoverContext(
	state: AgentState,
	opts: RecoveryOptions,
): AgentState {
	const validPrefix = findValidMessagePrefix(state.messages);

	if (validPrefix.length === state.messages.length) return state;

	if (validPrefix.length > 0) {
		opts.onRecovered?.("prefix_scan", state.messages.length, validPrefix.length);
		return { ...state, messages: validPrefix };
	}

	if (opts.lastGoodMessages) {
		opts.onRecovered?.("snapshot_restore", state.messages.length, opts.lastGoodMessages.length);
		return { ...state, messages: [...opts.lastGoodMessages] };
	}

	opts.onRecovered?.("fresh_start", state.messages.length, 0);
	return { ...state, messages: [] };
}

// ─── Health Threshold Checks ────────────────────────────────────────────────

/** Metrics for a single turn. */
export interface TurnMetrics {
	startTime: number;
	endTime: number;
	latencyMs: number;
	tokensBefore: number;
	tokensAfter: number;
	hadError: boolean;
	errorType?: "transient" | "fatal" | "unknown";
}

/** Options for health threshold checking. */
export interface HealthCheckOptions {
	errorRateWarningThreshold: number;
	latencyWarningMs: number;
	contextLimit: number;
	onWarning?: (metric: string, value: number, threshold: number, message: string) => void;
}

/**
 * Check health metrics against configured thresholds.
 * Emits warnings via the callback when metrics cross thresholds.
 */
export function checkHealthThresholds(
	recentTurns: TurnMetrics[],
	currentTokens: number,
	opts: HealthCheckOptions,
): void {
	if (recentTurns.length < 3) return;

	const errorCount = recentTurns.filter((t) => t.hadError).length;
	const errorRate = errorCount / recentTurns.length;
	if (errorRate >= opts.errorRateWarningThreshold) {
		opts.onWarning?.(
			"error_rate", errorRate, opts.errorRateWarningThreshold,
			`Error rate ${(errorRate * 100).toFixed(0)}% exceeds threshold`,
		);
	}

	const avgLatency = recentTurns.reduce((s, t) => s + t.latencyMs, 0) / recentTurns.length;
	if (avgLatency >= opts.latencyWarningMs) {
		opts.onWarning?.(
			"latency", avgLatency, opts.latencyWarningMs,
			`Average latency ${Math.round(avgLatency)}ms exceeds threshold`,
		);
	}

	const utilization = currentTokens / opts.contextLimit;
	if (utilization >= 0.85) {
		opts.onWarning?.(
			"context_utilization", utilization, 0.85,
			`Context ${(utilization * 100).toFixed(0)}% full`,
		);
	}
}
