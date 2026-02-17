/**
 * @chitragupta/swara — Request queue with priority and concurrency control.
 *
 * Manages concurrent LLM requests with priority levels, per-provider
 * concurrency limits, timeouts, and cancellation support.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Priority levels for queued requests. */
export type QueuePriority = "high" | "normal" | "low";

export interface RequestQueueConfig {
	/** Maximum concurrent requests. Defaults to 3. */
	concurrency: number;
	/** Default timeout per request in milliseconds. Defaults to 120_000 (2 min). */
	defaultTimeoutMs: number;
}

export const DEFAULT_QUEUE_CONFIG: RequestQueueConfig = {
	concurrency: 3,
	defaultTimeoutMs: 120_000,
};

/** Statistics about the queue state. */
export interface QueueStats {
	pending: number;
	active: number;
	completed: number;
	failed: number;
	cancelled: number;
	total: number;
}

/** A handle returned when a request is enqueued. */
export interface RequestHandle<T> {
	/** Unique ID for this request. */
	id: string;
	/** The promise that resolves when the request completes. */
	promise: Promise<T>;
	/** Cancel this specific request. */
	cancel(): void;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

type RequestStatus = "pending" | "active" | "completed" | "failed" | "cancelled";

interface QueuedItem<T> {
	id: string;
	priority: QueuePriority;
	execute: (signal: AbortSignal) => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: Error) => void;
	status: RequestStatus;
	timeoutMs: number;
	abortController: AbortController;
	enqueuedAt: number;
	startedAt?: number;
	completedAt?: number;
}

// ─── Priority order mapping ─────────────────────────────────────────────────

const PRIORITY_ORDER: Record<QueuePriority, number> = {
	high: 0,
	normal: 1,
	low: 2,
};

// ─── Request Queue ──────────────────────────────────────────────────────────

/**
 * A priority request queue with concurrency control.
 *
 * Manages LLM requests with three priority levels:
 *   - **high**: user-initiated requests (interactive prompts)
 *   - **normal**: agent loop requests (tool follow-ups)
 *   - **low**: background/prefetch requests
 *
 * Higher priority requests are processed first. Each request has a timeout
 * and can be individually cancelled.
 *
 * @example
 * ```ts
 * const queue = new RequestQueue({ concurrency: 3 });
 *
 * const handle = queue.enqueue(
 *   (signal) => provider.stream(model, context, { signal }),
 *   "high",
 *   30_000,
 * );
 *
 * const result = await handle.promise;
 * ```
 */
export class RequestQueue {
	private config: RequestQueueConfig;
	private pending: QueuedItem<unknown>[] = [];
	private active: Map<string, QueuedItem<unknown>> = new Map();
	private completedCount = 0;
	private failedCount = 0;
	private cancelledCount = 0;
	private idCounter = 0;
	private destroyed = false;

	constructor(config: Partial<RequestQueueConfig> = {}) {
		this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
	}

	/**
	 * Enqueue a request for execution.
	 *
	 * The `execute` function receives an AbortSignal that will be triggered
	 * on timeout or cancellation. The request is queued by priority and
	 * executed when a concurrency slot becomes available.
	 *
	 * @param execute     The async function to run. Receives an AbortSignal.
	 * @param priority    Priority level. Defaults to "normal".
	 * @param timeoutMs   Per-request timeout in ms. Defaults to config.defaultTimeoutMs.
	 * @returns           A RequestHandle with the promise and cancel method.
	 */
	enqueue<T>(
		execute: (signal: AbortSignal) => Promise<T>,
		priority: QueuePriority = "normal",
		timeoutMs?: number,
	): RequestHandle<T> {
		if (this.destroyed) {
			throw new Error("Request queue has been destroyed.");
		}

		const id = `req_${++this.idCounter}`;
		const abortController = new AbortController();

		let resolveOuter!: (value: T) => void;
		let rejectOuter!: (reason: Error) => void;

		const promise = new Promise<T>((resolve, reject) => {
			resolveOuter = resolve;
			rejectOuter = reject;
		});

		const item: QueuedItem<unknown> = {
			id,
			priority,
			execute: execute as (signal: AbortSignal) => Promise<unknown>,
			resolve: resolveOuter as (value: unknown) => void,
			reject: rejectOuter,
			status: "pending",
			timeoutMs: timeoutMs ?? this.config.defaultTimeoutMs,
			abortController,
			enqueuedAt: Date.now(),
		};

		// Insert into pending queue sorted by priority
		this.insertByPriority(item);

		// Try to run immediately if there's capacity
		this.processQueue();

		const handle: RequestHandle<T> = {
			id,
			promise,
			cancel: () => this.cancelRequest(id),
		};

		return handle;
	}

	/**
	 * Cancel a specific request by ID.
	 * If pending, removes it from the queue. If active, aborts it.
	 */
	cancelRequest(id: string): boolean {
		// Check pending queue
		const pendingIdx = this.pending.findIndex((item) => item.id === id);
		if (pendingIdx !== -1) {
			const item = this.pending[pendingIdx];
			this.pending.splice(pendingIdx, 1);
			item.status = "cancelled";
			item.completedAt = Date.now();
			item.abortController.abort();
			item.reject(new Error("Request cancelled"));
			this.cancelledCount++;
			return true;
		}

		// Check active requests
		const activeItem = this.active.get(id);
		if (activeItem) {
			activeItem.abortController.abort();
			// The running execute() should catch the abort and reject
			// The completion handler in processItem will update status
			return true;
		}

		return false;
	}

	/**
	 * Cancel all pending and active requests.
	 */
	cancelAll(): number {
		let cancelled = 0;

		// Cancel all pending
		const pendingCopy = [...this.pending];
		this.pending = [];
		for (const item of pendingCopy) {
			item.status = "cancelled";
			item.completedAt = Date.now();
			item.abortController.abort();
			item.reject(new Error("Request cancelled (cancelAll)"));
			this.cancelledCount++;
			cancelled++;
		}

		// Cancel all active — mark as cancelled, abort the signal, and
		// immediately reject so callers don't wait for execute() to settle.
		const activeCopy = [...this.active.values()];
		for (const item of activeCopy) {
			item.status = "cancelled";
			item.completedAt = Date.now();
			item.abortController.abort();
			this.active.delete(item.id);
			item.reject(new Error("Request cancelled (cancelAll)"));
			this.cancelledCount++;
			cancelled++;
		}

		return cancelled;
	}

	/**
	 * Get current queue statistics.
	 */
	getStats(): QueueStats {
		return {
			pending: this.pending.length,
			active: this.active.size,
			completed: this.completedCount,
			failed: this.failedCount,
			cancelled: this.cancelledCount,
			total:
				this.pending.length +
				this.active.size +
				this.completedCount +
				this.failedCount +
				this.cancelledCount,
		};
	}

	/**
	 * Check if the queue is idle (no pending or active requests).
	 */
	isIdle(): boolean {
		return this.pending.length === 0 && this.active.size === 0;
	}

	/**
	 * Wait until the queue becomes idle.
	 */
	async drain(): Promise<void> {
		if (this.isIdle()) return;

		return new Promise<void>((resolve) => {
			const check = () => {
				if (this.isIdle()) {
					resolve();
				} else {
					setTimeout(check, 50);
				}
			};
			check();
		});
	}

	/**
	 * Update the concurrency limit.
	 * If increased, immediately starts processing more queued requests.
	 */
	setConcurrency(concurrency: number): void {
		this.config.concurrency = Math.max(1, concurrency);
		this.processQueue();
	}

	/**
	 * Destroy the queue, cancelling all requests.
	 */
	destroy(): void {
		this.destroyed = true;
		this.cancelAll();
	}

	// ─── Private ────────────────────────────────────────────────────────

	/**
	 * Insert an item into the pending queue in priority order.
	 */
	private insertByPriority(item: QueuedItem<unknown>): void {
		const itemOrder = PRIORITY_ORDER[item.priority];
		let insertIdx = this.pending.length;

		for (let i = 0; i < this.pending.length; i++) {
			if (PRIORITY_ORDER[this.pending[i].priority] > itemOrder) {
				insertIdx = i;
				break;
			}
		}

		this.pending.splice(insertIdx, 0, item);
	}

	/**
	 * Process items from the pending queue up to the concurrency limit.
	 */
	private processQueue(): void {
		while (
			this.pending.length > 0 &&
			this.active.size < this.config.concurrency &&
			!this.destroyed
		) {
			const item = this.pending.shift()!;
			this.processItem(item);
		}
	}

	/**
	 * Execute a single queued item with timeout handling.
	 */
	private processItem(item: QueuedItem<unknown>): void {
		item.status = "active";
		item.startedAt = Date.now();
		this.active.set(item.id, item);

		// Set up timeout
		const timeoutTimer = setTimeout(() => {
			item.abortController.abort();
		}, item.timeoutMs);

		// Execute
		item.execute(item.abortController.signal)
			.then((result) => {
				clearTimeout(timeoutTimer);
				// If already cancelled by cancelAll/destroy, the promise was
				// already rejected — just clean up without double-resolving.
				if (item.status === "cancelled") {
					this.active.delete(item.id);
					return;
				}
				item.status = "completed";
				item.completedAt = Date.now();
				this.active.delete(item.id);
				this.completedCount++;
				item.resolve(result);
			})
			.catch((error: unknown) => {
				clearTimeout(timeoutTimer);
				// If already cancelled by cancelAll/destroy, the promise was
				// already rejected — just clean up without double-rejecting.
				if (item.status === "cancelled") {
					this.active.delete(item.id);
					return;
				}

				const err = error instanceof Error ? error : new Error(String(error));
				const wasCancelled = item.abortController.signal.aborted;
				if (wasCancelled) {
					item.status = "cancelled";
					this.cancelledCount++;
				} else {
					item.status = "failed";
					this.failedCount++;
				}

				item.completedAt = Date.now();
				this.active.delete(item.id);
				item.reject(err);
			})
			.finally(() => {
				// Process next items in the queue
				this.processQueue();
			});
	}
}
