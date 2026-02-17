/**
 * Arogya Health — Health check system for Chitragupta.
 * Sanskrit: Arogya (आरोग्य) = health, wellness.
 *
 * Provides a pluggable health check framework with built-in checks
 * for memory usage, event loop delay, and disk space. Returns aggregate
 * health status suitable for Kubernetes liveness/readiness probes,
 * Docker HEALTHCHECK, or monitoring dashboards.
 *
 * Pure Node.js — no external dependencies.
 */

import { freemem, totalmem } from "node:os";
import { statfsSync } from "node:fs";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

// ─── Types ───────────────────────────────────────────────────────────────────

export type HealthStatus = "UP" | "DOWN" | "DEGRADED";

export interface HealthCheckResult {
	/** Health status of this individual check */
	status: HealthStatus;
	/** Optional human-readable message */
	message?: string;
	/** Duration of the check in milliseconds */
	duration?: number;
}

export interface HealthCheck {
	/** Human-readable name for this check */
	name: string;
	/** Execute the health check and return a result */
	check(): Promise<HealthCheckResult>;
}

export interface HealthReport {
	/** Aggregate status (worst of all checks) */
	status: HealthStatus;
	/** ISO-8601 timestamp of the report */
	timestamp: string;
	/** Application version */
	version: string;
	/** Uptime in milliseconds */
	uptime: number;
	/** Individual check results */
	checks: Record<string, HealthCheckResult>;
}

// ─── Health Checker ──────────────────────────────────────────────────────────

export class HealthChecker {
	private checks: HealthCheck[] = [];
	private readonly version: string;
	private readonly startTime: number;

	constructor(opts?: { version?: string }) {
		this.version = opts?.version ?? "0.1.0";
		this.startTime = Date.now();
	}

	/** Register a health check. */
	register(check: HealthCheck): void {
		this.checks.push(check);
	}

	/**
	 * Run all registered checks and return an aggregate report.
	 *
	 * Aggregate status logic:
	 * - If any check is DOWN -> overall is DOWN
	 * - If any check is DEGRADED -> overall is DEGRADED
	 * - Otherwise -> UP
	 */
	async getStatus(): Promise<HealthReport> {
		const results: Record<string, HealthCheckResult> = {};
		let aggregateStatus: HealthStatus = "UP";

		const promises = this.checks.map(async (hc) => {
			const start = Date.now();
			try {
				const result = await hc.check();
				result.duration = Date.now() - start;
				results[hc.name] = result;
			} catch (err) {
				results[hc.name] = {
					status: "DOWN",
					message: err instanceof Error ? err.message : String(err),
					duration: Date.now() - start,
				};
			}
		});

		await Promise.all(promises);

		// Determine aggregate status
		for (const result of Object.values(results)) {
			if (result.status === "DOWN") {
				aggregateStatus = "DOWN";
				break; // DOWN is the worst — no need to check further
			}
			if (result.status === "DEGRADED") {
				aggregateStatus = "DEGRADED";
			}
		}

		return {
			status: aggregateStatus,
			timestamp: new Date().toISOString(),
			version: this.version,
			uptime: Date.now() - this.startTime,
			checks: results,
		};
	}
}

// ─── Built-in Checks ─────────────────────────────────────────────────────────

/**
 * Memory health check — warns if heap usage exceeds a threshold.
 *
 * Default threshold: 80% of V8 heap limit.
 */
export class MemoryHealthCheck implements HealthCheck {
	readonly name = "memory";
	private readonly threshold: number;

	constructor(opts?: { threshold?: number }) {
		this.threshold = opts?.threshold ?? 0.8;
	}

	async check(): Promise<HealthCheckResult> {
		const mem = process.memoryUsage();
		// Use rss vs total system memory as a secondary indicator
		const heapUsedPct = mem.heapUsed / mem.heapTotal;
		const rssBytes = mem.rss;
		const systemTotal = totalmem();
		const systemFree = freemem();
		const systemUsedPct = 1 - (systemFree / systemTotal);

		const message = `heap=${(heapUsedPct * 100).toFixed(1)}% ` +
			`rss=${(rssBytes / 1024 / 1024).toFixed(1)}MB ` +
			`system=${(systemUsedPct * 100).toFixed(1)}%`;

		if (heapUsedPct > this.threshold) {
			return {
				status: heapUsedPct > 0.95 ? "DOWN" : "DEGRADED",
				message: `High heap usage: ${message}`,
			};
		}

		return { status: "UP", message };
	}
}

/**
 * Event loop health check — warns if event loop delay exceeds a threshold.
 *
 * Default threshold: 100ms p99 delay.
 */
export class EventLoopHealthCheck implements HealthCheck {
	readonly name = "event_loop";
	private readonly thresholdMs: number;
	private histogram: IntervalHistogram | null = null;

	constructor(opts?: { thresholdMs?: number }) {
		this.thresholdMs = opts?.thresholdMs ?? 100;
		try {
			this.histogram = monitorEventLoopDelay({ resolution: 20 });
			this.histogram.enable();
		} catch {
			// monitorEventLoopDelay not available — degrade gracefully
			this.histogram = null;
		}
	}

	async check(): Promise<HealthCheckResult> {
		if (!this.histogram) {
			return { status: "UP", message: "Event loop monitoring unavailable" };
		}

		// Values are in nanoseconds
		const p99Ms = this.histogram.percentile(99) / 1e6;
		const meanMs = this.histogram.mean / 1e6;
		const minMs = this.histogram.min / 1e6;
		const maxMs = this.histogram.max / 1e6;

		// Reset after reading so the next check reflects a fresh window
		this.histogram.reset();

		const message = `p99=${p99Ms.toFixed(2)}ms mean=${meanMs.toFixed(2)}ms ` +
			`min=${minMs.toFixed(2)}ms max=${maxMs.toFixed(2)}ms`;

		if (p99Ms > this.thresholdMs) {
			return {
				status: p99Ms > this.thresholdMs * 5 ? "DOWN" : "DEGRADED",
				message: `High event loop delay: ${message}`,
			};
		}

		return { status: "UP", message };
	}

	/** Disable the internal histogram. Call when shutting down. */
	dispose(): void {
		if (this.histogram) {
			this.histogram.disable();
			this.histogram = null;
		}
	}
}

/**
 * Disk health check — warns if disk usage exceeds a threshold.
 *
 * Default threshold: 90% usage.
 * Checks the filesystem containing the given path (default: cwd).
 */
export class DiskHealthCheck implements HealthCheck {
	readonly name = "disk";
	private readonly threshold: number;
	private readonly path: string;

	constructor(opts?: { threshold?: number; path?: string }) {
		this.threshold = opts?.threshold ?? 0.9;
		this.path = opts?.path ?? process.cwd();
	}

	async check(): Promise<HealthCheckResult> {
		try {
			const stats = statfsSync(this.path);
			const totalBytes = stats.blocks * stats.bsize;
			const freeBytes = stats.bfree * stats.bsize;
			const usedPct = 1 - (freeBytes / totalBytes);

			const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
			const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
			const message = `used=${(usedPct * 100).toFixed(1)}% free=${freeGB}GB total=${totalGB}GB`;

			if (usedPct > this.threshold) {
				return {
					status: usedPct > 0.98 ? "DOWN" : "DEGRADED",
					message: `High disk usage: ${message}`,
				};
			}

			return { status: "UP", message };
		} catch (err) {
			return {
				status: "DEGRADED",
				message: `Disk check failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}
}
