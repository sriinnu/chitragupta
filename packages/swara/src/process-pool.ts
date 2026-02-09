/**
 * @chitragupta/swara — Process pool for concurrent CLI execution.
 *
 * Manages a bounded pool of child processes with FIFO queuing,
 * graceful timeouts (SIGTERM → SIGKILL), and lifecycle tracking.
 */

import { spawn, type ChildProcess } from "node:child_process";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Configuration for the process pool. */
export interface ProcessPoolConfig {
	/** Maximum number of concurrent child processes. Default: 5. */
	maxConcurrency?: number;
	/** Default timeout in milliseconds per process. Default: 30000. */
	defaultTimeout?: number;
}

/** Options for a single process execution. */
export interface ProcessExecOptions {
	/** Override the default timeout (ms) for this execution. */
	timeout?: number;
	/** Working directory for the child process. */
	cwd?: string;
	/** Additional environment variables (merged with process.env). */
	env?: Record<string, string>;
	/** Data to pipe into the child's stdin. */
	stdin?: string;
}

/** Result of a completed child process. */
export interface ProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	killed: boolean;
	duration: number;
}

/** Pool runtime statistics. */
export interface ProcessPoolStats {
	active: number;
	queued: number;
	completed: number;
	failed: number;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface QueueEntry {
	command: string;
	args: string[];
	options: ProcessExecOptions;
	resolve: (result: ProcessResult) => void;
	reject: (error: Error) => void;
}

// ─── Grace period before escalating SIGTERM → SIGKILL ───────────────────────

const SIGKILL_GRACE_MS = 3000;

// ─── ProcessPool ────────────────────────────────────────────────────────────

/**
 * Bounded process pool with FIFO queuing and graceful timeout handling.
 *
 * Processes exceeding their timeout receive SIGTERM. If they don't exit
 * within 3 seconds, SIGKILL is sent. Pool concurrency is configurable
 * with a sensible default of 5.
 */
export class ProcessPool {
	private readonly maxConcurrency: number;
	private readonly defaultTimeout: number;

	private readonly queue: QueueEntry[] = [];
	private readonly activeProcesses = new Set<ChildProcess>();
	private completed = 0;
	private failed = 0;
	private drainResolve: (() => void) | null = null;

	constructor(config: ProcessPoolConfig = {}) {
		this.maxConcurrency = config.maxConcurrency ?? 5;
		this.defaultTimeout = config.defaultTimeout ?? 30_000;
	}

	/**
	 * Execute a command with arguments. Queues if pool is at capacity.
	 */
	execute(
		command: string,
		args: string[],
		options: ProcessExecOptions = {},
	): Promise<ProcessResult> {
		return new Promise<ProcessResult>((resolve, reject) => {
			this.queue.push({ command, args, options, resolve, reject });
			this.dequeue();
		});
	}

	/** Return current pool statistics. */
	getStats(): ProcessPoolStats {
		return {
			active: this.activeProcesses.size,
			queued: this.queue.length,
			completed: this.completed,
			failed: this.failed,
		};
	}

	/** Wait for all queued and active processes to complete. */
	async drain(): Promise<void> {
		if (this.queue.length === 0 && this.activeProcesses.size === 0) return;
		return new Promise<void>((resolve) => {
			this.drainResolve = resolve;
		});
	}

	/** Kill all active processes immediately with SIGKILL. */
	killAll(): void {
		for (const child of this.activeProcesses) {
			child.kill("SIGKILL");
		}
	}

	// ─── Internal ─────────────────────────────────────────────────────────────

	private dequeue(): void {
		while (
			this.activeProcesses.size < this.maxConcurrency &&
			this.queue.length > 0
		) {
			const entry = this.queue.shift()!;
			this.spawn(entry);
		}
	}

	private spawn(entry: QueueEntry): void {
		const { command, args, options, resolve, reject } = entry;
		const startTime = Date.now();
		const timeout = options.timeout ?? this.defaultTimeout;

		const env = options.env
			? { ...process.env, ...options.env }
			: process.env;

		const child = spawn(command, args, {
			cwd: options.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.activeProcesses.add(child);

		let stdout = "";
		let stderr = "";
		let killed = false;
		let settled = false;

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		// Pipe stdin if provided
		if (options.stdin !== undefined) {
			child.stdin?.write(options.stdin);
			child.stdin?.end();
		} else {
			child.stdin?.end();
		}

		// Graceful timeout: SIGTERM → wait SIGKILL_GRACE_MS → SIGKILL
		const timeoutId = setTimeout(() => {
			killed = true;
			child.kill("SIGTERM");

			setTimeout(() => {
				if (!settled) {
					child.kill("SIGKILL");
				}
			}, SIGKILL_GRACE_MS);
		}, timeout);

		const settle = (exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			this.activeProcesses.delete(child);

			const duration = Date.now() - startTime;
			const code = exitCode ?? (killed ? 137 : 1);

			if (code !== 0) {
				this.failed++;
			} else {
				this.completed++;
			}

			resolve({ stdout, stderr, exitCode: code, killed, duration });

			// Kick the next item off the queue
			this.dequeue();

			if (this.drainResolve && this.queue.length === 0 && this.activeProcesses.size === 0) {
				this.drainResolve();
				this.drainResolve = null;
			}
		};

		child.on("close", (code) => {
			settle(code);
		});

		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			this.activeProcesses.delete(child);
			this.failed++;
			reject(err);
			this.dequeue();

			if (this.drainResolve && this.queue.length === 0 && this.activeProcesses.size === 0) {
				this.drainResolve();
				this.drainResolve = null;
			}
		});
	}
}
