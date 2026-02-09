/**
 * Bhaaravaha — Load testing engine for Chitragupta.
 * Sanskrit: Bhaaravaha (भारवाह) = load carrier.
 *
 * Token-bucket rate limiter with linear ramp-up, high-resolution
 * latency tracking (performance.now()), and per-second timeline
 * collection. Pure Node.js — no external dependencies.
 */

import { performance } from "node:perf_hooks";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoadConfig {
	/** Target requests per second. */
	targetRps: number;
	/** Total test duration in seconds. */
	duration: number;
	/** Maximum parallel in-flight requests. */
	concurrency: number;
	/** Seconds to linearly ramp from 0 to targetRps. Default: 0 (instant). */
	rampUp?: number;
	/** Seconds of warmup before measurement begins. Default: 5. */
	warmup?: number;
	/** Per-request timeout in milliseconds. Default: 10000. */
	timeout?: number;
}

export interface LoadResult {
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	/** 50th percentile latency in ms. */
	p50: number;
	/** 95th percentile latency in ms. */
	p95: number;
	/** 99th percentile latency in ms. */
	p99: number;
	/** Arithmetic mean latency in ms. */
	avgLatency: number;
	/** Maximum observed latency in ms. */
	maxLatency: number;
	/** Minimum observed latency in ms. */
	minLatency: number;
	/** Actual sustained throughput in requests/second. */
	throughput: number;
	/** Error rate 0..1. */
	errorRate: number;
	/** Error message -> count. */
	errors: Map<string, number>;
	/** Per-second timeline snapshots. */
	timeline: TimelineEntry[];
	/** Actual test duration in ms (measurement window only, excludes warmup). */
	duration: number;
}

export interface TimelineEntry {
	/** Unix-epoch timestamp in ms. */
	timestamp: number;
	/** Requests completed in this 1-second window. */
	rps: number;
	/** Average latency for this window in ms. */
	avgLatency: number;
	/** Error rate for this window (0..1). */
	errorRate: number;
}

// ─── Token Bucket ────────────────────────────────────────────────────────────

/**
 * A token-bucket rate limiter.
 *
 * Tokens refill continuously at `rate` tokens per second.
 * A maximum of `rate` tokens can accumulate (burst = 1 second).
 */
class TokenBucket {
	private tokens: number;
	private lastRefill: number;
	private rate: number;

	constructor(rate: number) {
		this.rate = rate;
		this.tokens = rate; // Start with a full bucket
		this.lastRefill = performance.now();
	}

	/** Update the refill rate (used during ramp-up). */
	setRate(newRate: number): void {
		this.refill(); // settle current tokens first
		this.rate = newRate;
	}

	/** Try to consume one token. Returns true if allowed. */
	tryConsume(): boolean {
		this.refill();
		if (this.tokens >= 1) {
			this.tokens -= 1;
			return true;
		}
		return false;
	}

	private refill(): void {
		const now = performance.now();
		const elapsedSec = (now - this.lastRefill) / 1000;
		this.lastRefill = now;
		this.tokens = Math.min(this.rate, this.tokens + elapsedSec * this.rate);
	}
}

// ─── LoadRunner ──────────────────────────────────────────────────────────────

export class LoadRunner {
	private readonly config: Required<LoadConfig>;

	constructor(config: LoadConfig) {
		this.config = {
			targetRps: config.targetRps,
			duration: config.duration,
			concurrency: config.concurrency,
			rampUp: config.rampUp ?? 0,
			warmup: config.warmup ?? 5,
			timeout: config.timeout ?? 10_000,
		};
	}

	/**
	 * Execute the load test.
	 *
	 * The provided `scenario` function is called once per request.
	 * The runner handles concurrency limiting, rate control, latency
	 * tracking, and timeline collection.
	 *
	 * @param scenario — async function invoked per request. `iteration`
	 *   is a monotonically increasing counter starting at 0. The function
	 *   should throw to signal failure.
	 * @param signal — optional AbortSignal for early termination.
	 */
	async run(
		scenario: (iteration: number) => Promise<void>,
		signal?: AbortSignal,
	): Promise<LoadResult> {
		const {
			targetRps,
			duration,
			concurrency,
			rampUp,
			warmup,
			timeout,
		} = this.config;

		// ── Measurement accumulators ──────────────────────────────────
		const latencies: number[] = [];
		let successCount = 0;
		let failCount = 0;
		const errors = new Map<string, number>();
		const timeline: TimelineEntry[] = [];

		// Per-second window accumulators
		let windowRequests = 0;
		let windowLatencySum = 0;
		let windowErrors = 0;

		// ── Concurrency semaphore ────────────────────────────────────
		let inFlight = 0;
		const waitSlot = (): Promise<void> => {
			if (inFlight < concurrency) return Promise.resolve();
			return new Promise<void>((resolve) => {
				const check = setInterval(() => {
					if (inFlight < concurrency || aborted) {
						clearInterval(check);
						resolve();
					}
				}, 1);
			});
		};

		// ── Rate limiter (token bucket) ──────────────────────────────
		const initialRate = rampUp > 0 ? Math.max(1, targetRps * 0.01) : targetRps;
		const bucket = new TokenBucket(initialRate);

		// ── Main loop state ──────────────────────────────────────────
		let iteration = 0;
		let aborted = false;
		let isWarmup = warmup > 0;

		const onAbort = () => { aborted = true; };
		signal?.addEventListener("abort", onAbort, { once: true });

		const testStartMs = performance.now();
		const warmupEndMs = testStartMs + warmup * 1000;
		const totalEndMs = warmupEndMs + duration * 1000;
		const rampEndMs = testStartMs + rampUp * 1000;

		let lastSecondMs = warmupEndMs; // timeline ticks start after warmup
		let measurementStartMs = warmupEndMs;

		// ── Execute one request, track its outcome ───────────────────
		const executeOne = async (iter: number, measuring: boolean): Promise<void> => {
			inFlight++;
			const reqStart = performance.now();
			let succeeded = false;

			try {
				await Promise.race([
					scenario(iter),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error("Request timeout")), timeout),
					),
				]);
				succeeded = true;
			} catch (err) {
				if (measuring) {
					const msg = err instanceof Error ? err.message : String(err);
					errors.set(msg, (errors.get(msg) ?? 0) + 1);
				}
			} finally {
				inFlight--;
			}

			const latency = performance.now() - reqStart;

			if (measuring) {
				latencies.push(latency);
				if (succeeded) {
					successCount++;
				} else {
					failCount++;
				}
				windowRequests++;
				windowLatencySum += latency;
				if (!succeeded) windowErrors++;
			}
		};

		// ── Main scheduling loop ─────────────────────────────────────
		while (!aborted) {
			const now = performance.now();

			// Check termination
			if (now >= totalEndMs) break;

			// Ramp-up: linearly increase rate
			if (rampUp > 0 && now < rampEndMs) {
				const progress = Math.min(1, (now - testStartMs) / (rampUp * 1000));
				bucket.setRate(Math.max(1, targetRps * progress));
			} else if (rampUp > 0) {
				bucket.setRate(targetRps);
			}

			// Transition from warmup to measurement
			if (isWarmup && now >= warmupEndMs) {
				isWarmup = false;
				measurementStartMs = now;
				lastSecondMs = now;
			}

			// Per-second timeline snapshot (only during measurement)
			if (!isWarmup && now - lastSecondMs >= 1000) {
				timeline.push({
					timestamp: Date.now(),
					rps: windowRequests,
					avgLatency: windowRequests > 0 ? windowLatencySum / windowRequests : 0,
					errorRate: windowRequests > 0 ? windowErrors / windowRequests : 0,
				});
				windowRequests = 0;
				windowLatencySum = 0;
				windowErrors = 0;
				lastSecondMs = now;
			}

			// Try to dispatch a request
			if (bucket.tryConsume()) {
				await waitSlot();
				if (aborted) break;
				const measuring = !isWarmup;
				// Fire-and-forget (bounded by concurrency semaphore)
				executeOne(iteration++, measuring);
			} else {
				// Sleep a tiny bit before retrying
				await new Promise<void>((r) => setTimeout(r, 1));
			}
		}

		// ── Wait for all in-flight requests to drain ─────────────────
		const drainStart = performance.now();
		while (inFlight > 0 && performance.now() - drainStart < timeout + 1000) {
			await new Promise<void>((r) => setTimeout(r, 5));
		}

		// Flush last partial second to timeline
		if (windowRequests > 0) {
			timeline.push({
				timestamp: Date.now(),
				rps: windowRequests,
				avgLatency: windowLatencySum / windowRequests,
				errorRate: windowRequests > 0 ? windowErrors / windowRequests : 0,
			});
		}

		signal?.removeEventListener("abort", onAbort);

		// ── Compute percentiles ──────────────────────────────────────
		latencies.sort((a, b) => a - b);
		const total = latencies.length;
		const measurementDurationMs = performance.now() - measurementStartMs;

		return {
			totalRequests: total,
			successfulRequests: successCount,
			failedRequests: failCount,
			p50: percentile(latencies, 0.50),
			p95: percentile(latencies, 0.95),
			p99: percentile(latencies, 0.99),
			avgLatency: total > 0 ? latencies.reduce((s, v) => s + v, 0) / total : 0,
			maxLatency: total > 0 ? latencies[total - 1] : 0,
			minLatency: total > 0 ? latencies[0] : 0,
			throughput: measurementDurationMs > 0 ? (total / measurementDurationMs) * 1000 : 0,
			errorRate: total > 0 ? failCount / total : 0,
			errors,
			timeline,
			duration: measurementDurationMs,
		};
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.ceil(p * sorted.length) - 1;
	return sorted[Math.max(0, idx)];
}
