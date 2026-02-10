/**
 * Orchestrator metrics & monitoring — tracks task latency, agent utilization,
 * cost per task, throughput, error rate, and provides sliding-window statistics.
 */

import type { MetricsReport, OrchestratorStats, TaskMetrics, WindowStats } from "./types.js";

// ─── Recorded Data Point ─────────────────────────────────────────────────────

interface DataPoint {
	timestamp: number;
	slotId: string;
	latency: number;
	tokenUsage: number;
	cost: number;
	toolCalls: number;
	success: boolean;
}

// ─── Metrics Collector ───────────────────────────────────────────────────────

/**
 * MetricsCollector -- collects and aggregates orchestrator metrics with
 * sliding-window statistics (1m, 5m, 15m) and percentile calculations
 * (p50, p95, p99).
 *
 * Data points are automatically pruned past the configured retention period.
 *
 * @example
 * ```ts
 * const collector = new MetricsCollector();
 * collector.record("slot-a", { startTime: 1000, endTime: 2000, tokenUsage: 50, cost: 0.01, toolCalls: 3, retries: 0 }, true);
 * const report = collector.getReport();
 * ```
 */
export class MetricsCollector {
	private readonly dataPoints: DataPoint[] = [];
	private readonly maxRetention: number;

	/**
	 * @param maxRetentionMs Maximum retention period for data points (default: 15 minutes)
	 */
	constructor(maxRetentionMs: number = 15 * 60 * 1000) {
		this.maxRetention = maxRetentionMs;
	}

	/**
	 * Record a completed task's metrics.
	 *
	 * @param slotId - The agent slot that executed the task.
	 * @param metrics - The task metrics (start/end time, token usage, cost, etc.).
	 * @param success - Whether the task succeeded.
	 */
	record(slotId: string, metrics: TaskMetrics, success: boolean): void {
		this.dataPoints.push({
			timestamp: metrics.endTime,
			slotId,
			latency: metrics.endTime - metrics.startTime,
			tokenUsage: metrics.tokenUsage,
			cost: metrics.cost,
			toolCalls: metrics.toolCalls,
			success,
		});

		// Prune old data points beyond retention
		this.prune();
	}

	/**
	 * Record a failure (no metrics available).
	 *
	 * @param slotId - The agent slot that failed.
	 */
	recordFailure(slotId: string): void {
		this.dataPoints.push({
			timestamp: Date.now(),
			slotId,
			latency: 0,
			tokenUsage: 0,
			cost: 0,
			toolCalls: 0,
			success: false,
		});
		this.prune();
	}

	/**
	 * Get a full metrics report with windowed statistics.
	 *
	 * @param currentStats - Optional override for the overall stats section. If not
	 *        provided, stats are computed from collected data points.
	 * @returns A report with overall stats, 1m/5m/15m windows, latency percentiles,
	 *          cost-by-slot breakdown, and error rate.
	 */
	getReport(currentStats?: OrchestratorStats): MetricsReport {
		const now = Date.now();

		const overall: OrchestratorStats = currentStats ?? {
			totalTasks: this.dataPoints.length,
			pendingTasks: 0,
			runningTasks: 0,
			completedTasks: this.dataPoints.filter((d) => d.success).length,
			failedTasks: this.dataPoints.filter((d) => !d.success).length,
			activeAgents: 0,
			totalCost: this.dataPoints.reduce((sum, d) => sum + d.cost, 0),
			totalTokens: this.dataPoints.reduce((sum, d) => sum + d.tokenUsage, 0),
			averageLatency: this.averageLatency(this.dataPoints),
			throughput: this.calculateThroughput(this.dataPoints),
		};

		return {
			overall,
			windows: {
				"1m": this.windowStats(now - 60_000),
				"5m": this.windowStats(now - 300_000),
				"15m": this.windowStats(now - 900_000),
			},
			latencyPercentiles: this.percentiles(),
			costBySlot: this.costBySlot(),
			errorRate: this.errorRate(),
		};
	}

	/**
	 * Export metrics in Prometheus text exposition format for monitoring integration.
	 *
	 * @returns A multi-line string in Prometheus text format, including counters,
	 *          gauges, percentiles, and per-slot breakdowns.
	 */
	exportPrometheus(): string {
		const report = this.getReport();
		const lines: string[] = [];

		// Overall stats
		lines.push("# HELP niyanta_tasks_total Total tasks processed");
		lines.push("# TYPE niyanta_tasks_total counter");
		lines.push(`niyanta_tasks_total ${report.overall.totalTasks}`);

		lines.push("# HELP niyanta_tasks_completed_total Total completed tasks");
		lines.push("# TYPE niyanta_tasks_completed_total counter");
		lines.push(`niyanta_tasks_completed_total ${report.overall.completedTasks}`);

		lines.push("# HELP niyanta_tasks_failed_total Total failed tasks");
		lines.push("# TYPE niyanta_tasks_failed_total counter");
		lines.push(`niyanta_tasks_failed_total ${report.overall.failedTasks}`);

		lines.push("# HELP niyanta_tasks_pending Current pending tasks");
		lines.push("# TYPE niyanta_tasks_pending gauge");
		lines.push(`niyanta_tasks_pending ${report.overall.pendingTasks}`);

		lines.push("# HELP niyanta_tasks_running Current running tasks");
		lines.push("# TYPE niyanta_tasks_running gauge");
		lines.push(`niyanta_tasks_running ${report.overall.runningTasks}`);

		lines.push("# HELP niyanta_agents_active Current active agents");
		lines.push("# TYPE niyanta_agents_active gauge");
		lines.push(`niyanta_agents_active ${report.overall.activeAgents}`);

		lines.push("# HELP niyanta_cost_total Total cost in currency units");
		lines.push("# TYPE niyanta_cost_total counter");
		lines.push(`niyanta_cost_total ${report.overall.totalCost}`);

		lines.push("# HELP niyanta_tokens_total Total tokens consumed");
		lines.push("# TYPE niyanta_tokens_total counter");
		lines.push(`niyanta_tokens_total ${report.overall.totalTokens}`);

		lines.push("# HELP niyanta_latency_average_ms Average task latency in milliseconds");
		lines.push("# TYPE niyanta_latency_average_ms gauge");
		lines.push(`niyanta_latency_average_ms ${report.overall.averageLatency}`);

		lines.push("# HELP niyanta_throughput_per_minute Tasks completed per minute");
		lines.push("# TYPE niyanta_throughput_per_minute gauge");
		lines.push(`niyanta_throughput_per_minute ${report.overall.throughput}`);

		// Percentiles
		lines.push("# HELP niyanta_latency_percentile_ms Latency percentiles in milliseconds");
		lines.push("# TYPE niyanta_latency_percentile_ms gauge");
		lines.push(`niyanta_latency_percentile_ms{quantile="0.5"} ${report.latencyPercentiles.p50}`);
		lines.push(`niyanta_latency_percentile_ms{quantile="0.95"} ${report.latencyPercentiles.p95}`);
		lines.push(`niyanta_latency_percentile_ms{quantile="0.99"} ${report.latencyPercentiles.p99}`);

		// Error rate
		lines.push("# HELP niyanta_error_rate Error rate (0-1)");
		lines.push("# TYPE niyanta_error_rate gauge");
		lines.push(`niyanta_error_rate ${report.errorRate}`);

		// Cost by slot
		lines.push("# HELP niyanta_cost_by_slot_total Cost per agent slot");
		lines.push("# TYPE niyanta_cost_by_slot_total counter");
		for (const [slotId, cost] of Object.entries(report.costBySlot)) {
			lines.push(`niyanta_cost_by_slot_total{slot="${slotId}"} ${cost}`);
		}

		// Window stats
		for (const [window, stats] of Object.entries(report.windows)) {
			const label = window.replace("m", "min");
			lines.push(`# HELP niyanta_window_throughput_${label} Throughput in ${window} window`);
			lines.push(`# TYPE niyanta_window_throughput_${label} gauge`);
			lines.push(`niyanta_window_throughput_${label} ${stats.throughput}`);
		}

		return lines.join("\n") + "\n";
	}

	/**
	 * Reset all collected metrics.
	 */
	reset(): void {
		this.dataPoints.length = 0;
	}

	// ─── Internal Helpers ──────────────────────────────────────────────────

	private prune(): void {
		const cutoff = Date.now() - this.maxRetention;
		while (this.dataPoints.length > 0 && this.dataPoints[0].timestamp < cutoff) {
			this.dataPoints.shift();
		}
	}

	private windowStats(sinceTimestamp: number): WindowStats {
		const points = this.dataPoints.filter((d) => d.timestamp >= sinceTimestamp);
		const successful = points.filter((d) => d.success);
		const failed = points.filter((d) => !d.success);

		return {
			tasksCompleted: successful.length,
			tasksFailed: failed.length,
			averageLatency: this.averageLatency(successful),
			throughput: this.calculateThroughput(points),
			tokenUsage: points.reduce((sum, d) => sum + d.tokenUsage, 0),
			cost: points.reduce((sum, d) => sum + d.cost, 0),
		};
	}

	private averageLatency(points: DataPoint[]): number {
		const withLatency = points.filter((d) => d.latency > 0);
		if (withLatency.length === 0) return 0;
		return withLatency.reduce((sum, d) => sum + d.latency, 0) / withLatency.length;
	}

	private calculateThroughput(points: DataPoint[]): number {
		if (points.length < 2) return points.length;
		const completed = points.filter((d) => d.success);
		if (completed.length === 0) return 0;
		const timestamps = completed.map((d) => d.timestamp);
		const spanMs = Math.max(...timestamps) - Math.min(...timestamps);
		const spanMin = spanMs / 60_000;
		return spanMin > 0 ? completed.length / spanMin : completed.length;
	}

	private percentiles(): { p50: number; p95: number; p99: number } {
		const latencies = this.dataPoints
			.filter((d) => d.latency > 0)
			.map((d) => d.latency)
			.sort((a, b) => a - b);

		if (latencies.length === 0) {
			return { p50: 0, p95: 0, p99: 0 };
		}

		return {
			p50: percentile(latencies, 0.50),
			p95: percentile(latencies, 0.95),
			p99: percentile(latencies, 0.99),
		};
	}

	private costBySlot(): Record<string, number> {
		const result: Record<string, number> = {};
		for (const point of this.dataPoints) {
			result[point.slotId] = (result[point.slotId] ?? 0) + point.cost;
		}
		return result;
	}

	private errorRate(): number {
		if (this.dataPoints.length === 0) return 0;
		const failures = this.dataPoints.filter((d) => !d.success).length;
		return failures / this.dataPoints.length;
	}
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Calculate the value at a given percentile from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0];
	const index = (sorted.length - 1) * p;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower];
	const weight = index - lower;
	return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
