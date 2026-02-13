/**
 * Maapaka Metrics — Prometheus-compatible metrics registry for Chitragupta.
 * Sanskrit: Maapaka (मापक) = measurer, gauge.
 *
 * Provides Counter, Gauge, and Histogram metric types with label support,
 * Prometheus text exposition format, and JSON export. Complements the
 * niyanta MetricsCollector (orchestrator-level sliding-window stats) with
 * application-wide metric instrumentation.
 *
 * Pure Node.js — no external dependencies.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricDefinition {
	/** Metric name (Prometheus-compatible: [a-zA-Z_:][a-zA-Z0-9_:]*) */
	name: string;
	/** Metric type */
	type: MetricType;
	/** Human-readable help text */
	help: string;
	/** Unit of measurement (e.g. "seconds", "bytes") */
	unit?: string;
	/** Label names for this metric */
	labels?: string[];
}

// ─── Label Key ───────────────────────────────────────────────────────────────

/** Serialize a label set to a stable, comparable string key. */
function labelsKey(labels?: Record<string, string>): string {
	if (!labels || Object.keys(labels).length === 0) return "";
	return Object.keys(labels)
		.sort()
		.map((k) => `${k}="${labels[k]}"`)
		.join(",");
}

/** Format labels for Prometheus output. */
function formatLabels(labels?: Record<string, string>): string {
	if (!labels || Object.keys(labels).length === 0) return "";
	const pairs = Object.keys(labels)
		.sort()
		.map((k) => `${k}="${escapeLabel(labels[k])}"`)
		.join(",");
	return `{${pairs}}`;
}

/** Escape a Prometheus label value. */
function escapeLabel(val: string): string {
	return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ─── Counter ─────────────────────────────────────────────────────────────────

export class Counter {
	readonly name: string;
	readonly help: string;
	readonly labelNames: string[];
	private values = new Map<string, number>();
	private labelSets = new Map<string, Record<string, string>>();

	constructor(name: string, help: string, labels?: string[]) {
		this.name = name;
		this.help = help;
		this.labelNames = labels ?? [];
	}

	/** Increment the counter by `value` (default 1). Value must be finite and non-negative. */
	inc(value: number = 1, labels?: Record<string, string>): void {
		if (!Number.isFinite(value)) return; // silently ignore NaN/Infinity
		if (value < 0) {
			throw new Error(`Counter ${this.name}: increment value must be non-negative, got ${value}`);
		}
		const key = labelsKey(labels);
		this.values.set(key, (this.values.get(key) ?? 0) + value);
		if (labels && !this.labelSets.has(key)) {
			this.labelSets.set(key, labels);
		}
	}

	/** Get the current value for a label set. */
	get(labels?: Record<string, string>): number {
		return this.values.get(labelsKey(labels)) ?? 0;
	}

	/** Reset all values to zero. */
	reset(): void {
		this.values.clear();
		this.labelSets.clear();
	}

	/** Export in Prometheus text format. */
	collect(): string {
		const lines: string[] = [];
		lines.push(`# HELP ${this.name} ${this.help}`);
		lines.push(`# TYPE ${this.name} counter`);

		if (this.values.size === 0) {
			lines.push(`${this.name} 0`);
		} else {
			for (const [key, val] of this.values) {
				const lbls = this.labelSets.get(key);
				lines.push(`${this.name}${formatLabels(lbls)} ${val}`);
			}
		}

		return lines.join("\n");
	}

	/** Export as JSON object. */
	collectJson(): { name: string; type: "counter"; help: string; values: Array<{ labels: Record<string, string>; value: number }> } {
		const values: Array<{ labels: Record<string, string>; value: number }> = [];
		for (const [key, val] of this.values) {
			values.push({
				labels: this.labelSets.get(key) ?? {},
				value: val,
			});
		}
		return { name: this.name, type: "counter", help: this.help, values };
	}
}

// ─── Gauge ───────────────────────────────────────────────────────────────────

export class Gauge {
	readonly name: string;
	readonly help: string;
	readonly labelNames: string[];
	private values = new Map<string, number>();
	private labelSets = new Map<string, Record<string, string>>();

	constructor(name: string, help: string, labels?: string[]) {
		this.name = name;
		this.help = help;
		this.labelNames = labels ?? [];
	}

	/** Set the gauge to an absolute value. NaN/Infinity values are silently ignored. */
	set(value: number, labels?: Record<string, string>): void {
		if (!Number.isFinite(value)) return;
		const key = labelsKey(labels);
		this.values.set(key, value);
		if (labels && !this.labelSets.has(key)) {
			this.labelSets.set(key, labels);
		}
	}

	/** Increment the gauge by 1 (or by value if provided). NaN/Infinity values are silently ignored. */
	inc(value: number = 1, labels?: Record<string, string>): void {
		if (!Number.isFinite(value)) return;
		const key = labelsKey(labels);
		this.values.set(key, (this.values.get(key) ?? 0) + value);
		if (labels && !this.labelSets.has(key)) {
			this.labelSets.set(key, labels);
		}
	}

	/** Decrement the gauge by 1 (or by value if provided). NaN/Infinity values are silently ignored. */
	dec(value: number = 1, labels?: Record<string, string>): void {
		if (!Number.isFinite(value)) return;
		const key = labelsKey(labels);
		this.values.set(key, (this.values.get(key) ?? 0) - value);
		if (labels && !this.labelSets.has(key)) {
			this.labelSets.set(key, labels);
		}
	}

	/** Get the current value for a label set. */
	get(labels?: Record<string, string>): number {
		return this.values.get(labelsKey(labels)) ?? 0;
	}

	/** Reset all values. */
	reset(): void {
		this.values.clear();
		this.labelSets.clear();
	}

	/** Export in Prometheus text format. */
	collect(): string {
		const lines: string[] = [];
		lines.push(`# HELP ${this.name} ${this.help}`);
		lines.push(`# TYPE ${this.name} gauge`);

		if (this.values.size === 0) {
			lines.push(`${this.name} 0`);
		} else {
			for (const [key, val] of this.values) {
				const lbls = this.labelSets.get(key);
				lines.push(`${this.name}${formatLabels(lbls)} ${val}`);
			}
		}

		return lines.join("\n");
	}

	/** Export as JSON. */
	collectJson(): { name: string; type: "gauge"; help: string; values: Array<{ labels: Record<string, string>; value: number }> } {
		const values: Array<{ labels: Record<string, string>; value: number }> = [];
		for (const [key, val] of this.values) {
			values.push({
				labels: this.labelSets.get(key) ?? {},
				value: val,
			});
		}
		return { name: this.name, type: "gauge", help: this.help, values };
	}
}

// ─── Histogram ───────────────────────────────────────────────────────────────

/** Default Prometheus histogram buckets. */
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramData {
	buckets: number[];     // count per bucket (index matches sorted bucket boundaries)
	sum: number;
	count: number;
}

export class Histogram {
	readonly name: string;
	readonly help: string;
	readonly labelNames: string[];
	readonly bucketBoundaries: number[];
	private data = new Map<string, HistogramData>();
	private labelSets = new Map<string, Record<string, string>>();

	constructor(name: string, help: string, labels?: string[], buckets?: number[]) {
		this.name = name;
		this.help = help;
		this.labelNames = labels ?? [];
		this.bucketBoundaries = [...(buckets ?? DEFAULT_BUCKETS)].sort((a, b) => a - b);
	}

	/** Record an observed value. NaN/Infinity values are silently ignored. */
	observe(value: number, labels?: Record<string, string>): void {
		if (!Number.isFinite(value)) return;
		const key = labelsKey(labels);
		let entry = this.data.get(key);
		if (!entry) {
			entry = {
				buckets: new Array(this.bucketBoundaries.length).fill(0),
				sum: 0,
				count: 0,
			};
			this.data.set(key, entry);
			if (labels) {
				this.labelSets.set(key, labels);
			}
		}

		entry.sum += value;
		entry.count++;

		// Increment all buckets whose boundary >= value
		for (let i = 0; i < this.bucketBoundaries.length; i++) {
			if (value <= this.bucketBoundaries[i]) {
				entry.buckets[i]++;
			}
		}
	}

	/** Get sum and count for a label set. */
	get(labels?: Record<string, string>): { sum: number; count: number } {
		const entry = this.data.get(labelsKey(labels));
		return entry ? { sum: entry.sum, count: entry.count } : { sum: 0, count: 0 };
	}

	/** Reset all data. */
	reset(): void {
		this.data.clear();
		this.labelSets.clear();
	}

	/** Export in Prometheus text format. */
	collect(): string {
		const lines: string[] = [];
		lines.push(`# HELP ${this.name} ${this.help}`);
		lines.push(`# TYPE ${this.name} histogram`);

		if (this.data.size === 0) {
			// Output empty histogram with zero values
			for (const boundary of this.bucketBoundaries) {
				lines.push(`${this.name}_bucket{le="${boundary}"} 0`);
			}
			lines.push(`${this.name}_bucket{le="+Inf"} 0`);
			lines.push(`${this.name}_sum 0`);
			lines.push(`${this.name}_count 0`);
		} else {
			for (const [key, entry] of this.data) {
				const lbls = this.labelSets.get(key);
				const lblStr = lbls ? formatLabels(lbls) : "";

				// For labeled histograms, we need to merge le with other labels
				const lblPairs = lbls
					? Object.keys(lbls).sort().map((k) => `${k}="${escapeLabel(lbls[k])}"`).join(",")
					: "";

				for (let i = 0; i < this.bucketBoundaries.length; i++) {
					const le = `le="${this.bucketBoundaries[i]}"`;
					const fullLabels = lblPairs ? `{${lblPairs},${le}}` : `{${le}}`;
					lines.push(`${this.name}_bucket${fullLabels} ${entry.buckets[i]}`);
				}

				const infLe = lblPairs ? `{${lblPairs},le="+Inf"}` : `{le="+Inf"}`;
				lines.push(`${this.name}_bucket${infLe} ${entry.count}`);
				lines.push(`${this.name}_sum${lblStr} ${entry.sum}`);
				lines.push(`${this.name}_count${lblStr} ${entry.count}`);
			}
		}

		return lines.join("\n");
	}

	/** Export as JSON. */
	collectJson(): { name: string; type: "histogram"; help: string; values: Array<{ labels: Record<string, string>; sum: number; count: number; buckets: Record<string, number> }> } {
		const values: Array<{ labels: Record<string, string>; sum: number; count: number; buckets: Record<string, number> }> = [];
		for (const [key, entry] of this.data) {
			const buckets: Record<string, number> = {};
			for (let i = 0; i < this.bucketBoundaries.length; i++) {
				buckets[String(this.bucketBoundaries[i])] = entry.buckets[i];
			}
			buckets["+Inf"] = entry.count;
			values.push({
				labels: this.labelSets.get(key) ?? {},
				sum: entry.sum,
				count: entry.count,
				buckets,
			});
		}
		return { name: this.name, type: "histogram", help: this.help, values };
	}
}

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
