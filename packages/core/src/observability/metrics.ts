/**
 * Maapaka Metrics — Prometheus-compatible metrics registry for Chitragupta.
 * Sanskrit: Maapaka (मापक) = measurer, gauge.
 *
 * Provides a MetricsRegistry that manages Counter, Gauge, and Histogram
 * instruments with Prometheus text exposition and JSON export.
 * Complements the niyanta MetricsCollector with application-wide instrumentation.
 *
 * Pure Node.js — no external dependencies.
 */

import { Counter, Gauge, Histogram } from "./metrics-instruments.js";

// Re-export everything from instruments for backward compatibility
export { Counter, Gauge, Histogram, formatLabels, escapeLabel } from "./metrics-instruments.js";
export type { MetricType, MetricDefinition } from "./metrics-instruments.js";

// ─── Metrics Registry ────────────────────────────────────────────────────────

export class MetricsRegistry {
	private counters = new Map<string, Counter>();
	private gauges = new Map<string, Gauge>();
	private histograms = new Map<string, Histogram>();

	/** Create or get an existing counter. */
	counter(name: string, help: string, labels?: string[]): Counter {
		let c = this.counters.get(name);
		if (!c) {
			c = new Counter(name, help, labels);
			this.counters.set(name, c);
		}
		return c;
	}

	/** Create or get an existing gauge. */
	gauge(name: string, help: string, labels?: string[]): Gauge {
		let g = this.gauges.get(name);
		if (!g) {
			g = new Gauge(name, help, labels);
			this.gauges.set(name, g);
		}
		return g;
	}

	/** Create or get an existing histogram. */
	histogram(name: string, help: string, labels?: string[], buckets?: number[]): Histogram {
		let h = this.histograms.get(name);
		if (!h) {
			h = new Histogram(name, help, labels, buckets);
			this.histograms.set(name, h);
		}
		return h;
	}

	/** Export all metrics in Prometheus text exposition format. */
	collect(): string {
		const sections: string[] = [];

		for (const c of this.counters.values()) {
			sections.push(c.collect());
		}
		for (const g of this.gauges.values()) {
			sections.push(g.collect());
		}
		for (const h of this.histograms.values()) {
			sections.push(h.collect());
		}

		return sections.join("\n\n") + "\n";
	}

	/** Export all metrics as a JSON dump. */
	collectJson(): { counters: ReturnType<Counter["collectJson"]>[]; gauges: ReturnType<Gauge["collectJson"]>[]; histograms: ReturnType<Histogram["collectJson"]>[] } {
		return {
			counters: Array.from(this.counters.values()).map((c) => c.collectJson()),
			gauges: Array.from(this.gauges.values()).map((g) => g.collectJson()),
			histograms: Array.from(this.histograms.values()).map((h) => h.collectJson()),
		};
	}

	/** Reset all metrics. */
	reset(): void {
		for (const c of this.counters.values()) c.reset();
		for (const g of this.gauges.values()) g.reset();
		for (const h of this.histograms.values()) h.reset();
	}
}

// ─── Default Metrics ─────────────────────────────────────────────────────────

/**
 * Register the default Chitragupta HTTP/WS/Agent metrics on a registry.
 * Returns an object with references to each metric for direct instrumentation.
 */
export function registerDefaultMetrics(registry: MetricsRegistry) {
	return {
		httpRequestsTotal: registry.counter(
			"chitragupta_http_requests_total",
			"Total HTTP requests processed",
			["method", "path", "status"],
		),
		httpRequestDuration: registry.histogram(
			"chitragupta_http_request_duration_seconds",
			"HTTP request duration in seconds",
			["method", "path"],
		),
		httpRequestSize: registry.histogram(
			"chitragupta_http_request_size_bytes",
			"HTTP request body size in bytes",
		),
		wsConnectionsTotal: registry.counter(
			"chitragupta_ws_connections_total",
			"Total WebSocket connections accepted",
		),
		wsConnectionsActive: registry.gauge(
			"chitragupta_ws_connections_active",
			"Currently active WebSocket connections",
		),
		wsMessagesTotal: registry.counter(
			"chitragupta_ws_messages_total",
			"Total WebSocket messages",
			["type", "direction"],
		),
		agentRequestsTotal: registry.counter(
			"chitragupta_agent_requests_total",
			"Total agent requests",
			["status"],
		),
		agentTokensTotal: registry.counter(
			"chitragupta_agent_tokens_total",
			"Total agent tokens consumed",
			["type"],
		),
		memoryOperationsTotal: registry.counter(
			"chitragupta_memory_operations_total",
			"Total memory operations",
			["operation", "scope"],
		),
	};
}

// ─── Global Registry ─────────────────────────────────────────────────────────

let globalRegistry: MetricsRegistry | null = null;

/** Get or create the global metrics registry. */
export function getMetricsRegistry(): MetricsRegistry {
	if (!globalRegistry) {
		globalRegistry = new MetricsRegistry();
	}
	return globalRegistry;
}

/** Reset the global metrics registry. Primarily for testing. */
export function resetMetricsRegistry(): void {
	globalRegistry = null;
}
