/**
 * Vyuha pattern executors — the five orchestration formation implementations.
 *
 * Each pattern function takes an executor callback and optional config,
 * returning a standardized `PatternResult`.
 */

import type { PatternConfig, PatternResult } from "./orchestration-patterns.js";
import {
	resolveConfig,
	createTimeoutRace,
	withRetry,
	boundedParallel,
} from "./orchestration-patterns.js";

// ─── Pattern 1: Single ──────────────────────────────────────────────────────

/**
 * Single pattern — one agent handles everything sequentially.
 *
 * @param task - The task description to execute.
 * @param executor - Function that executes the task.
 * @param config - Optional timeout/retry config.
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
				() => executor(task), cfg.retries, cfg.retryBaseDelayMs, cfg.retryMaxDelayMs, timeout?.controller.signal,
			);
			retryCount = retries;
			return result;
		})();

		const result = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		return {
			pattern: "single", success: true, results: [result],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount },
		};
	} catch (err) {
		return {
			pattern: "single", success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount },
		};
	} finally {
		timeout?.cleanup();
	}
}

// ─── Pattern 2: Independent ─────────────────────────────────────────────────

/**
 * Independent pattern — multiple agents work on independent subtasks.
 *
 * @param subtasks - Array of independent subtask descriptions.
 * @param executor - Function that executes a single subtask.
 * @param config - Optional concurrency/timeout/retry config.
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
					() => executor(subtask), cfg.retries, cfg.retryBaseDelayMs, cfg.retryMaxDelayMs, timeout?.controller.signal,
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

		return {
			pattern: "independent", success: settled.every((s) => s.status === "fulfilled"), results,
			metrics: { duration: Date.now() - start, agentCount: subtasks.length, retryCount: totalRetries },
		};
	} catch (err) {
		return {
			pattern: "independent", success: false,
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
 * @param task - The top-level task description.
 * @param decomposer - Breaks the task into subtasks.
 * @param executor - Executes a single subtask.
 * @param merger - Merges all subtask results.
 * @param config - Optional configuration.
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
			const subtasks = decomposer(task);
			if (subtasks.length === 0) {
				const { result, retries } = await withRetry(
					() => executor(task), cfg.retries, cfg.retryBaseDelayMs, cfg.retryMaxDelayMs, timeout?.controller.signal,
				);
				totalRetries += retries;
				return { subtaskResults: [result], merged: result };
			}

			const settled = await boundedParallel(subtasks, cfg.maxConcurrency, async (subtask) => {
				const { result, retries } = await withRetry(
					() => executor(subtask), cfg.retries, cfg.retryBaseDelayMs, cfg.retryMaxDelayMs, timeout?.controller.signal,
				);
				totalRetries += retries;
				return result;
			});

			const subtaskResults = settled.map((s) => s.status === "fulfilled" ? s.value : undefined);
			const fulfilled = settled
				.filter((s): s is PromiseFulfilledResult<unknown> => s.status === "fulfilled")
				.map((s) => s.value);

			return { subtaskResults, merged: merger(fulfilled) };
		})();

		const { subtaskResults, merged } = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		return {
			pattern: "centralized", success: true, results: [...subtaskResults, merged],
			metrics: { duration: Date.now() - start, agentCount: subtaskResults.length + 1, retryCount: totalRetries },
		};
	} catch (err) {
		return {
			pattern: "centralized", success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount: totalRetries },
		};
	} finally {
		timeout?.cleanup();
	}
}

// ─── Pattern 4: Decentralized ───────────────────────────────────────────────

/**
 * Decentralized pattern — agents coordinate via message passing.
 *
 * @param task - The task description shared with all agents.
 * @param agentCount - Number of agents to spawn.
 * @param agentFn - Agent function receiving agentId, inbox, and sendTo callback.
 * @param config - Optional configuration.
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

	const mailboxes: unknown[][] = [];
	for (let i = 0; i < effectiveCount; i++) mailboxes.push([]);

	function sendTo(targetId: number, msg: unknown): void {
		if (targetId >= 0 && targetId < effectiveCount) mailboxes[targetId].push(msg);
	}

	for (let i = 0; i < effectiveCount; i++) mailboxes[i].push({ type: "task", payload: task });

	const timeout = createTimeoutRace(cfg.timeout);

	try {
		const executionPromise = (async (): Promise<PromiseSettledResult<unknown>[]> => {
			return boundedParallel(
				Array.from({ length: effectiveCount }, (_, i) => i),
				cfg.maxConcurrency,
				async (agentId) => {
					const { result } = await withRetry(
						() => agentFn(agentId, mailboxes[agentId], sendTo),
						cfg.retries, cfg.retryBaseDelayMs, cfg.retryMaxDelayMs, timeout?.controller.signal,
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

		return {
			pattern: "decentralized", success: settled.every((s) => s.status === "fulfilled"), results,
			metrics: { duration: Date.now() - start, agentCount: effectiveCount, retryCount: 0 },
		};
	} catch (err) {
		return {
			pattern: "decentralized", success: false,
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
 * @param task - The top-level task description.
 * @param decomposer - Breaks the task into subtasks.
 * @param executor - Executes a subtask, receiving peer subtask names.
 * @param merger - Merges all subtask results.
 * @param config - Optional configuration.
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
			const subtasks = decomposer(task);
			if (subtasks.length === 0) {
				const { result, retries } = await withRetry(
					() => executor(task, []), cfg.retries, cfg.retryBaseDelayMs, cfg.retryMaxDelayMs, timeout?.controller.signal,
				);
				totalRetries += retries;
				return { subtaskResults: [result], merged: result };
			}

			const settled = await boundedParallel(subtasks, cfg.maxConcurrency, async (subtask) => {
				const peers = subtasks.filter((s) => s !== subtask);
				const { result, retries } = await withRetry(
					() => executor(subtask, peers), cfg.retries, cfg.retryBaseDelayMs, cfg.retryMaxDelayMs, timeout?.controller.signal,
				);
				totalRetries += retries;
				return result;
			});

			const subtaskResults = settled.map((s) => s.status === "fulfilled" ? s.value : undefined);
			const fulfilled = settled
				.filter((s): s is PromiseFulfilledResult<unknown> => s.status === "fulfilled")
				.map((s) => s.value);

			return { subtaskResults, merged: merger(fulfilled) };
		})();

		const { subtaskResults, merged } = timeout
			? await Promise.race([executionPromise, timeout.timeoutPromise])
			: await executionPromise;

		return {
			pattern: "hybrid", success: true, results: [...subtaskResults, merged],
			metrics: { duration: Date.now() - start, agentCount: subtaskResults.length + 1, retryCount: totalRetries },
		};
	} catch (err) {
		return {
			pattern: "hybrid", success: false,
			results: [err instanceof Error ? err.message : String(err)],
			metrics: { duration: Date.now() - start, agentCount: 1, retryCount: totalRetries },
		};
	} finally {
		timeout?.cleanup();
	}
}
