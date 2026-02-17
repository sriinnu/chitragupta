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

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Resolved config with defaults applied. */
interface ResolvedConfig {
	maxConcurrency: number;
	timeout: number;
	retries: number;
	retryBaseDelayMs: number;
	retryMaxDelayMs: number;
}

function resolveConfig(config?: PatternConfig): ResolvedConfig {
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
 * Create an AbortController-backed timeout promise that rejects after `ms`.
 * Returns `null` if timeout is 0 (disabled).
 */
function createTimeoutRace(ms: number): {
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

	const cleanup = (): void => {
		clearTimeout(timer);
	};

	return { controller, timeoutPromise, cleanup };
}

/**
 * Execute a function with retries and exponential backoff.
 * Returns the result and total retry count consumed.
 */
async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries: number,
	baseMs: number,
	maxMs: number,
	signal?: AbortSignal,
): Promise<{ result: T; retries: number }> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (signal?.aborted) {
			throw new Error("Aborted");
		}

		try {
			const result = await fn();
			return { result, retries: attempt };
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt < maxRetries) {
				const delay = backoffDelay(attempt, baseMs, maxMs);
				await sleep(delay);
			}
		}
	}

	throw lastError ?? new Error("All retry attempts exhausted");
}

/**
 * Run tasks with bounded concurrency using a semaphore pattern.
 * Executes up to `limit` tasks concurrently from the input array.
 */
async function boundedParallel<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	if (limit >= items.length) {
		return Promise.allSettled(items.map(fn));
	}

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
	for (let i = 0; i < workerCount; i++) {
		workers.push(worker());
	}
	await Promise.all(workers);

	return results;
}

// ─── Pattern 1: Single ──────────────────────────────────────────────────────

/**
 * Single pattern — one agent handles everything sequentially.
 *
 * The simplest formation: a lone warrior executing the task with optional
 * retry resilience and timeout protection.
 *
 * @param task - The task description to execute.
 * @param executor - Function that executes the task and returns a result.
 * @param config - Optional configuration for timeout and retries.
 * @returns Standardized pattern result.
 */
export async function singlePattern(
	task: string,
	executor: (task: string) => Promise<unknown>,
	config?: PatternConfig,
): Promise<PatternResult> {
	const cfg = resolveConfig(config);
	const start = Date.now();
	let retryCount = 0;

	const timeout = createTimeoutRace(cfg.timeout);

	try {
		const executionPromise = (async (): Promise<unknown> => {
			const { result, retries } = await withRetry(
				() => executor(task),
				cfg.retries,
				cfg.retryBaseDelayMs,
				cfg.retryMaxDelayMs,
				timeout?.controller.signal,
			);
			retryCount = retries;
			return result;
		})();

		const result = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		return {
			pattern: "single",
			success: true,
			results: [result],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount },
		};
	} catch (err) {
		return {
			pattern: "single",
			success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount },
		};
	} finally {
		timeout?.cleanup();
	}
}

// ─── Pattern 2: Independent ─────────────────────────────────────────────────

/**
 * Independent pattern — multiple agents work on independent subtasks concurrently.
 *
 * Like archers on a battlefield, each fires at their own target with no
 * cross-coordination. Bounded by maxConcurrency to prevent resource exhaustion.
 *
 * @param subtasks - Array of independent subtask descriptions.
 * @param executor - Function that executes a single subtask.
 * @param config - Optional configuration for concurrency, timeout, and retries.
 * @returns Standardized pattern result with one entry per subtask.
 */
export async function independentPattern(
	subtasks: string[],
	executor: (task: string) => Promise<unknown>,
	config?: PatternConfig,
): Promise<PatternResult> {
	const cfg = resolveConfig(config);
	const start = Date.now();
	let totalRetries = 0;

	const timeout = createTimeoutRace(cfg.timeout);

	try {
		const executionPromise = (async (): Promise<PromiseSettledResult<unknown>[]> => {
			return boundedParallel(subtasks, cfg.maxConcurrency, async (subtask) => {
				const { result, retries } = await withRetry(
					() => executor(subtask),
					cfg.retries,
					cfg.retryBaseDelayMs,
					cfg.retryMaxDelayMs,
					timeout?.controller.signal,
				);
				totalRetries += retries;
				return result;
			});
		})();

		const settled = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		const results = settled.map((s) =>
			s.status === "fulfilled" ? s.value : (s.reason instanceof Error ? s.reason.message : String(s.reason)),
		);
		const allSucceeded = settled.every((s) => s.status === "fulfilled");

		return {
			pattern: "independent",
			success: allSucceeded,
			results,
			metrics: { duration: Date.now() - start, agentCount: subtasks.length, retryCount: totalRetries },
		};
	} catch (err) {
		return {
			pattern: "independent",
			success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: subtasks.length, retryCount: totalRetries },
		};
	} finally {
		timeout?.cleanup();
	}
}

// ─── Pattern 3: Centralized ─────────────────────────────────────────────────

/**
 * Centralized pattern — one coordinator decomposes, dispatches, and merges.
 *
 * The Senapati (commander) pattern: a single coordinator breaks the task
 * into subtasks, dispatches them to workers, and merges results.
 *
 * @param task - The top-level task description.
 * @param decomposer - Function that breaks the task into subtasks.
 * @param executor - Function that executes a single subtask.
 * @param merger - Function that merges all subtask results into a final result.
 * @param config - Optional configuration.
 * @returns Standardized pattern result. The merged result is the last element.
 */
export async function centralizedPattern(
	task: string,
	decomposer: (task: string) => string[],
	executor: (task: string) => Promise<unknown>,
	merger: (results: unknown[]) => unknown,
	config?: PatternConfig,
): Promise<PatternResult> {
	const cfg = resolveConfig(config);
	const start = Date.now();
	let totalRetries = 0;

	const timeout = createTimeoutRace(cfg.timeout);

	try {
		const executionPromise = (async (): Promise<{ subtaskResults: unknown[]; merged: unknown }> => {
			// Phase 1: Decompose
			const subtasks = decomposer(task);
			if (subtasks.length === 0) {
				// No decomposition — execute directly
				const { result, retries } = await withRetry(
					() => executor(task),
					cfg.retries,
					cfg.retryBaseDelayMs,
					cfg.retryMaxDelayMs,
					timeout?.controller.signal,
				);
				totalRetries += retries;
				return { subtaskResults: [result], merged: result };
			}

			// Phase 2: Dispatch to workers (bounded concurrency)
			const settled = await boundedParallel(subtasks, cfg.maxConcurrency, async (subtask) => {
				const { result, retries } = await withRetry(
					() => executor(subtask),
					cfg.retries,
					cfg.retryBaseDelayMs,
					cfg.retryMaxDelayMs,
					timeout?.controller.signal,
				);
				totalRetries += retries;
				return result;
			});

			const subtaskResults = settled.map((s) =>
				s.status === "fulfilled" ? s.value : undefined,
			);

			// Phase 3: Merge (only fulfilled results)
			const fulfilled = settled
				.filter((s): s is PromiseFulfilledResult<unknown> => s.status === "fulfilled")
				.map((s) => s.value);
			const merged = merger(fulfilled);

			return { subtaskResults, merged };
		})();

		const { subtaskResults, merged } = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		return {
			pattern: "centralized",
			success: true,
			results: [...subtaskResults, merged],
			metrics: {
				duration: Date.now() - start,
				agentCount: subtaskResults.length + 1, // workers + coordinator
				retryCount: totalRetries,
			},
		};
	} catch (err) {
		return {
			pattern: "centralized",
			success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount: totalRetries },
		};
	} finally {
		timeout?.cleanup();
	}
}

// ─── Pattern 4: Decentralized ───────────────────────────────────────────────

/**
 * Decentralized pattern — agents coordinate among themselves via message passing.
 *
 * A Gana (peer council): agents communicate through a shared message bus
 * without a central coordinator. Each agent has an inbox and can send
 * messages to any other agent.
 *
 * @param task - The task description shared with all agents.
 * @param agentCount - Number of agents to spawn.
 * @param agentFn - Function for each agent: receives agentId, inbox, and a sendTo callback.
 * @param config - Optional configuration.
 * @returns Standardized pattern result with one entry per agent.
 */
export async function decentralizedPattern(
	task: string,
	agentCount: number,
	agentFn: (
		agentId: number,
		inbox: unknown[],
		sendTo: (agentId: number, msg: unknown) => void,
	) => Promise<unknown>,
	config?: PatternConfig,
): Promise<PatternResult> {
	const cfg = resolveConfig(config);
	const start = Date.now();
	const effectiveCount = Math.max(1, agentCount);

	// Message infrastructure: each agent gets a mailbox
	const mailboxes: unknown[][] = [];
	for (let i = 0; i < effectiveCount; i++) {
		mailboxes.push([]);
	}

	function sendTo(targetId: number, msg: unknown): void {
		if (targetId >= 0 && targetId < effectiveCount) {
			mailboxes[targetId].push(msg);
		}
	}

	// Seed every agent's inbox with the task
	for (let i = 0; i < effectiveCount; i++) {
		mailboxes[i].push({ type: "task", payload: task });
	}

	const timeout = createTimeoutRace(cfg.timeout);

	try {
		const executionPromise = (async (): Promise<PromiseSettledResult<unknown>[]> => {
			return boundedParallel(
				Array.from({ length: effectiveCount }, (_, i) => i),
				cfg.maxConcurrency,
				async (agentId) => {
					const { result } = await withRetry(
						() => agentFn(agentId, mailboxes[agentId], sendTo),
						cfg.retries,
						cfg.retryBaseDelayMs,
						cfg.retryMaxDelayMs,
						timeout?.controller.signal,
					);
					return result;
				},
			);
		})();

		const settled = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		const results = settled.map((s) =>
			s.status === "fulfilled" ? s.value : (s.reason instanceof Error ? s.reason.message : String(s.reason)),
		);
		const allSucceeded = settled.every((s) => s.status === "fulfilled");

		return {
			pattern: "decentralized",
			success: allSucceeded,
			results,
			metrics: { duration: Date.now() - start, agentCount: effectiveCount, retryCount: 0 },
		};
	} catch (err) {
		return {
			pattern: "decentralized",
			success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: effectiveCount, retryCount: 0 },
		};
	} finally {
		timeout?.cleanup();
	}
}

// ─── Pattern 5: Hybrid ──────────────────────────────────────────────────────

/**
 * Hybrid pattern — centralized decomposition with decentralized execution.
 *
 * The Chakravyuha: a coordinator decomposes the task, then executors work
 * independently while aware of their peers (for optional coordination).
 * Results are merged by the coordinator.
 *
 * @param task - The top-level task description.
 * @param decomposer - Function that breaks the task into subtasks.
 * @param executor - Function that executes a subtask, receiving peer subtask names.
 * @param merger - Function that merges all subtask results into a final result.
 * @param config - Optional configuration.
 * @returns Standardized pattern result.
 */
export async function hybridPattern(
	task: string,
	decomposer: (task: string) => string[],
	executor: (subtask: string, peers: string[]) => Promise<unknown>,
	merger: (results: unknown[]) => unknown,
	config?: PatternConfig,
): Promise<PatternResult> {
	const cfg = resolveConfig(config);
	const start = Date.now();
	let totalRetries = 0;

	const timeout = createTimeoutRace(cfg.timeout);

	try {
		const executionPromise = (async (): Promise<{ subtaskResults: unknown[]; merged: unknown }> => {
			// Phase 1: Centralized decomposition
			const subtasks = decomposer(task);
			if (subtasks.length === 0) {
				const { result, retries } = await withRetry(
					() => executor(task, []),
					cfg.retries,
					cfg.retryBaseDelayMs,
					cfg.retryMaxDelayMs,
					timeout?.controller.signal,
				);
				totalRetries += retries;
				return { subtaskResults: [result], merged: result };
			}

			// Phase 2: Decentralized execution — each executor knows its peers
			const settled = await boundedParallel(subtasks, cfg.maxConcurrency, async (subtask) => {
				const peers = subtasks.filter((s) => s !== subtask);
				const { result, retries } = await withRetry(
					() => executor(subtask, peers),
					cfg.retries,
					cfg.retryBaseDelayMs,
					cfg.retryMaxDelayMs,
					timeout?.controller.signal,
				);
				totalRetries += retries;
				return result;
			});

			const subtaskResults = settled.map((s) =>
				s.status === "fulfilled" ? s.value : undefined,
			);

			// Phase 3: Centralized merge
			const fulfilled = settled
				.filter((s): s is PromiseFulfilledResult<unknown> => s.status === "fulfilled")
				.map((s) => s.value);
			const merged = merger(fulfilled);

			return { subtaskResults, merged };
		})();

		const { subtaskResults, merged } = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		return {
			pattern: "hybrid",
			success: true,
			results: [...subtaskResults, merged],
			metrics: {
				duration: Date.now() - start,
				agentCount: subtaskResults.length + 1, // workers + coordinator
				retryCount: totalRetries,
			},
		};
	} catch (err) {
		return {
			pattern: "hybrid",
			success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount: totalRetries },
		};
	} finally {
		timeout?.cleanup();
	}
}
