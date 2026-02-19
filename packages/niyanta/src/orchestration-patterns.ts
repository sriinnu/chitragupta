/**
 * Vyuha — Advanced orchestration patterns for multi-agent coordination.
 *
 * Sanskrit: Vyuha (व्यूह) = battle formation, strategic arrangement.
 *
 * Five patterns of increasing coordination complexity:
 *   1. Single    — One executor handles everything sequentially.
 *   2. Independent — N executors work on N independent subtasks concurrently.
 *   3. Centralized — One coordinator decomposes, dispatches, and merges.
 *   4. Decentralized — Agents coordinate among themselves via message passing.
 *   5. Hybrid    — Centralized decomposition with decentralized execution.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for orchestration patterns. All limits are configurable. */
export interface PatternConfig {
	/** Maximum number of concurrent executors. Default: Infinity (unbounded). */
	maxConcurrency?: number;
	/** Timeout in milliseconds for the entire pattern execution. Default: none. */
	timeout?: number;
	/** Maximum retry attempts per subtask on failure. Default: 0 (no retries). */
	retries?: number;
	/** Base delay in milliseconds for exponential backoff between retries. Default: 200. */
	retryBaseDelayMs?: number;
	/** Maximum backoff delay in milliseconds. Default: 10000. */
	retryMaxDelayMs?: number;
}

/** Standardized result from any orchestration pattern. */
export interface PatternResult {
	/** Name of the pattern that produced this result. */
	pattern: string;
	/** Whether the overall pattern execution succeeded. */
	success: boolean;
	/** Results from each executor invocation. */
	results: unknown[];
	/** Execution metrics. */
	metrics: {
		/** Total duration in milliseconds. */
		duration: number;
		/** Number of agents / executors involved. */
		agentCount: number;
		/** Total retry attempts made across all subtasks. */
		retryCount: number;
	};
}

// ─── Internal Helpers (exported for pattern-executors) ───────────────────────

/** Resolved config with defaults applied. */
export interface ResolvedConfig {
	maxConcurrency: number;
	timeout: number;
	retries: number;
	retryBaseDelayMs: number;
	retryMaxDelayMs: number;
}

/** Resolve partial config into full config with defaults. */
export function resolveConfig(config?: PatternConfig): ResolvedConfig {
	return {
		maxConcurrency: config?.maxConcurrency ?? Infinity,
		timeout: config?.timeout ?? 0,
		retries: config?.retries ?? 0,
		retryBaseDelayMs: config?.retryBaseDelayMs ?? 200,
		retryMaxDelayMs: config?.retryMaxDelayMs ?? 10_000,
	};
}

/**
 * Compute exponential backoff delay with jitter.
 * delay = min(base * 2^attempt + jitter, maxDelay)
 */
function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
	const exponential = baseMs * Math.pow(2, attempt);
	const jitter = Math.random() * baseMs;
	return Math.min(exponential + jitter, maxMs);
}

/** Sleep for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create an AbortController-backed timeout that rejects after `ms`.
 * Returns `null` if timeout is 0 (disabled).
 */
export function createTimeoutRace(ms: number): {
	controller: AbortController;
	timeoutPromise: Promise<never>;
	cleanup: () => void;
} | null {
	if (ms <= 0) return null;

	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error(`Pattern execution timed out after ${ms}ms`));
		}, ms);
	});

	const cleanup = (): void => { clearTimeout(timer); };
	return { controller, timeoutPromise, cleanup };
}

/**
 * Execute a function with retries and exponential backoff.
 * Returns the result and total retry count consumed.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries: number,
	baseMs: number,
	maxMs: number,
	signal?: AbortSignal,
): Promise<{ result: T; retries: number }> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (signal?.aborted) throw new Error("Aborted");
		try {
			const result = await fn();
			return { result, retries: attempt };
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < maxRetries) {
				await sleep(backoffDelay(attempt, baseMs, maxMs));
			}
		}
	}

	throw lastError ?? new Error("All retry attempts exhausted");
}

/**
 * Run tasks with bounded concurrency using a semaphore pattern.
 * Executes up to `limit` tasks concurrently from the input array.
 */
export async function boundedParallel<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	if (limit >= items.length) return Promise.allSettled(items.map(fn));

	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const idx = nextIndex++;
			try {
				const value = await fn(items[idx]);
				results[idx] = { status: "fulfilled", value };
			} catch (reason) {
				results[idx] = { status: "rejected", reason };
			}
		}
	}

	const workerCount = Math.min(limit, items.length);
	const workers: Promise<void>[] = [];
	for (let i = 0; i < workerCount; i++) workers.push(worker());
	await Promise.all(workers);

	return results;
}

// ─── Re-export pattern executors ─────────────────────────────────────────────

export {
	singlePattern,
	independentPattern,
	centralizedPattern,
	decentralizedPattern,
	hybridPattern,
} from "./pattern-executors.js";
