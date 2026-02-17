/**
 * @chitragupta/swara — Token bucket rate limiter.
 *
 * Provides per-provider rate limiting using a token bucket algorithm
 * with sliding window tracking. Supports priority queuing so that
 * interactive (user-initiated) requests take precedence over background
 * requests.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Priority level for rate limiter requests. */
export type RequestPriority = "high" | "normal" | "low";

export interface RateLimitConfig {
	/** Maximum requests per minute. */
	requestsPerMinute: number;
	/** Maximum tokens per minute (approximate). */
	tokensPerMinute: number;
}

/** Default rate limits — conservative to work across most providers. */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
	requestsPerMinute: 60,
	tokensPerMinute: 100_000,
};

// ─── Internal Types ─────────────────────────────────────────────────────────

interface QueuedRequest {
	resolve: () => void;
	reject: (reason: Error) => void;
	priority: RequestPriority;
	tokens: number;
	enqueuedAt: number;
}

// ─── Sliding Window Tracker ─────────────────────────────────────────────────

/**
 * Tracks events within a rolling time window (default: 60 seconds).
 * Used to count requests and tokens consumed within the window.
 */
class SlidingWindow {
	private entries: Array<{ timestamp: number; value: number }> = [];
	private readonly windowMs: number;

	constructor(windowMs: number = 60_000) {
		this.windowMs = windowMs;
	}

	/**
	 * Record an event with a value (e.g., 1 for a request, or N for tokens).
	 */
	record(value: number): void {
		this.entries.push({ timestamp: Date.now(), value });
		this.prune();
	}

	/**
	 * Get the sum of all values within the current window.
	 */
	sum(): number {
		this.prune();
		let total = 0;
		for (const entry of this.entries) {
			total += entry.value;
		}
		return total;
	}

	/**
	 * Get the count of entries in the current window.
	 */
	count(): number {
		this.prune();
		return this.entries.length;
	}

	/**
	 * Remove entries that have fallen outside the sliding window.
	 */
	private prune(): void {
		const cutoff = Date.now() - this.windowMs;
		let pruneIndex = 0;
		while (pruneIndex < this.entries.length && this.entries[pruneIndex].timestamp < cutoff) {
			pruneIndex++;
		}
		if (pruneIndex > 0) {
			this.entries.splice(0, pruneIndex);
		}
	}

	/**
	 * Reset all tracked entries.
	 */
	reset(): void {
		this.entries = [];
	}
}

// ─── Token Bucket Limiter ───────────────────────────────────────────────────

/**
 * Rate limiter using a token bucket algorithm with sliding window tracking.
 *
 * Ensures that requests stay within configured per-minute limits for both
 * request count and token count. Requests that exceed the limit are queued
 * and processed in priority order (high > normal > low).
 *
 * @example
 * ```ts
 * const limiter = new TokenBucketLimiter({ requestsPerMinute: 60, tokensPerMinute: 100_000 });
 *
 * // Wait for capacity before making a request
 * await limiter.acquire(1000, "high");
 * // ... make the LLM request ...
 * ```
 */
export class TokenBucketLimiter {
	private config: RateLimitConfig;
	private requestWindow: SlidingWindow;
	private tokenWindow: SlidingWindow;
	private queue: QueuedRequest[] = [];
	private drainTimer: ReturnType<typeof setTimeout> | null = null;
	private destroyed = false;

	constructor(config: Partial<RateLimitConfig> = {}) {
		this.config = { ...DEFAULT_RATE_LIMITS, ...config };
		this.requestWindow = new SlidingWindow(60_000);
		this.tokenWindow = new SlidingWindow(60_000);
	}

	/**
	 * Acquire permission to make a request.
	 *
	 * If capacity is available, resolves immediately. Otherwise, the caller
	 * is queued and resolved in priority order when capacity becomes available.
	 *
	 * @param tokens  Approximate number of tokens this request will consume.
	 *                Defaults to 1 (for request-count-only limiting).
	 * @param priority  Priority level. Higher priority requests are dequeued first.
	 */
	async acquire(tokens: number = 1, priority: RequestPriority = "normal"): Promise<void> {
		if (this.destroyed) {
			throw new Error("Rate limiter has been destroyed.");
		}

		// Fast path: if under limits, proceed immediately
		if (this.hasCapacity(tokens)) {
			this.requestWindow.record(1);
			this.tokenWindow.record(tokens);
			return;
		}

		// Slow path: queue the request
		return new Promise<void>((resolve, reject) => {
			const request: QueuedRequest = {
				resolve,
				reject,
				priority,
				tokens,
				enqueuedAt: Date.now(),
			};

			this.insertByPriority(request);
			this.scheduleDrain();
		});
	}

	/**
	 * Check if there is capacity for a request with the given token count.
	 */
	hasCapacity(tokens: number = 1): boolean {
		const currentRequests = this.requestWindow.count();
		const currentTokens = this.tokenWindow.sum();

		return (
			currentRequests < this.config.requestsPerMinute &&
			currentTokens + tokens <= this.config.tokensPerMinute
		);
	}

	/**
	 * Get current rate limiter statistics.
	 */
	getStats(): {
		requestsInWindow: number;
		tokensInWindow: number;
		queuedRequests: number;
		limits: RateLimitConfig;
	} {
		return {
			requestsInWindow: this.requestWindow.count(),
			tokensInWindow: this.tokenWindow.sum(),
			queuedRequests: this.queue.length,
			limits: { ...this.config },
		};
	}

	/**
	 * Update the rate limit configuration.
	 */
	updateConfig(config: Partial<RateLimitConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Reset all tracked usage and clear the queue.
	 * Queued requests are rejected with an error.
	 */
	reset(): void {
		this.requestWindow.reset();
		this.tokenWindow.reset();
		this.rejectAllQueued("Rate limiter was reset.");
	}

	/**
	 * Destroy the limiter, rejecting all queued requests.
	 */
	destroy(): void {
		this.destroyed = true;
		if (this.drainTimer !== null) {
			clearTimeout(this.drainTimer);
			this.drainTimer = null;
		}
		this.rejectAllQueued("Rate limiter was destroyed.");
	}

	// ─── Private ────────────────────────────────────────────────────────

	/**
	 * Insert a request into the queue ordered by priority (high first).
	 */
	private insertByPriority(request: QueuedRequest): void {
		const priorityOrder: Record<RequestPriority, number> = {
			high: 0,
			normal: 1,
			low: 2,
		};

		const reqOrder = priorityOrder[request.priority];
		let insertIdx = this.queue.length;

		for (let i = 0; i < this.queue.length; i++) {
			if (priorityOrder[this.queue[i].priority] > reqOrder) {
				insertIdx = i;
				break;
			}
		}

		this.queue.splice(insertIdx, 0, request);
	}

	/**
	 * Schedule a drain cycle to process queued requests.
	 */
	private scheduleDrain(): void {
		if (this.drainTimer !== null || this.destroyed) return;

		// Check every 100ms
		this.drainTimer = setTimeout(() => {
			this.drainTimer = null;
			this.drainQueue();
		}, 100);
	}

	/**
	 * Process as many queued requests as possible given current capacity.
	 */
	private drainQueue(): void {
		if (this.destroyed) return;

		while (this.queue.length > 0) {
			const next = this.queue[0];

			if (!this.hasCapacity(next.tokens)) {
				// No capacity yet, schedule another drain
				this.scheduleDrain();
				return;
			}

			// Remove from queue and grant access
			this.queue.shift();
			this.requestWindow.record(1);
			this.tokenWindow.record(next.tokens);
			next.resolve();
		}
	}

	/**
	 * Reject all queued requests with the given reason.
	 */
	private rejectAllQueued(reason: string): void {
		const pending = this.queue.splice(0);
		for (const request of pending) {
			request.reject(new Error(reason));
		}
	}
}
