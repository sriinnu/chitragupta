import { describe, it, expect, beforeEach } from "vitest";
import {
	Counter,
	Gauge,
	Histogram,
	MetricsRegistry,
	registerDefaultMetrics,
	getMetricsRegistry,
	resetMetricsRegistry,
} from "@chitragupta/core";

describe("Metrics", () => {
	// ═══════════════════════════════════════════════════════════════════════
	// Counter
	// ═══════════════════════════════════════════════════════════════════════

	describe("Counter", () => {
		it("should start at zero", () => {
			const c = new Counter("test_total", "Test counter");
			expect(c.get()).toBe(0);
		});

		it("should increment by 1 by default", () => {
			const c = new Counter("test_total", "Test counter");
			c.inc();
			expect(c.get()).toBe(1);
			c.inc();
			expect(c.get()).toBe(2);
		});

		it("should increment by a custom value", () => {
			const c = new Counter("test_total", "Test counter");
			c.inc(5);
			expect(c.get()).toBe(5);
			c.inc(3);
			expect(c.get()).toBe(8);
		});

		it("should throw on negative increment", () => {
			const c = new Counter("test_total", "Test counter");
			expect(() => c.inc(-1)).toThrow("non-negative");
		});

		it("should support labeled values", () => {
			const c = new Counter("http_requests_total", "HTTP requests", ["method", "status"]);
			c.inc(1, { method: "GET", status: "200" });
			c.inc(1, { method: "POST", status: "201" });
			c.inc(1, { method: "GET", status: "200" });
			expect(c.get({ method: "GET", status: "200" })).toBe(2);
			expect(c.get({ method: "POST", status: "201" })).toBe(1);
			expect(c.get({ method: "DELETE", status: "404" })).toBe(0);
		});

		it("should reset all values", () => {
			const c = new Counter("test_total", "Test counter");
			c.inc(10);
			c.reset();
			expect(c.get()).toBe(0);
		});

		it("should export Prometheus text format", () => {
			const c = new Counter("test_total", "A test counter", ["method"]);
			c.inc(3, { method: "GET" });
			c.inc(1, { method: "POST" });
			const text = c.collect();
			expect(text).toContain("# HELP test_total A test counter");
			expect(text).toContain("# TYPE test_total counter");
			expect(text).toContain('test_total{method="GET"} 3');
			expect(text).toContain('test_total{method="POST"} 1');
		});

		it("should export JSON format", () => {
			const c = new Counter("test_total", "Test", ["method"]);
			c.inc(5, { method: "GET" });
			const json = c.collectJson();
			expect(json.name).toBe("test_total");
			expect(json.type).toBe("counter");
			expect(json.values).toHaveLength(1);
			expect(json.values[0].value).toBe(5);
			expect(json.values[0].labels.method).toBe("GET");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Gauge
	// ═══════════════════════════════════════════════════════════════════════

	describe("Gauge", () => {
		it("should start at zero", () => {
			const g = new Gauge("test_gauge", "Test gauge");
			expect(g.get()).toBe(0);
		});

		it("should set to an absolute value", () => {
			const g = new Gauge("test_gauge", "Test gauge");
			g.set(42);
			expect(g.get()).toBe(42);
			g.set(0);
			expect(g.get()).toBe(0);
		});

		it("should increment", () => {
			const g = new Gauge("test_gauge", "Test gauge");
			g.inc();
			expect(g.get()).toBe(1);
			g.inc(5);
			expect(g.get()).toBe(6);
		});

		it("should decrement", () => {
			const g = new Gauge("test_gauge", "Test gauge");
			g.set(10);
			g.dec();
			expect(g.get()).toBe(9);
			g.dec(4);
			expect(g.get()).toBe(5);
		});

		it("should support negative values", () => {
			const g = new Gauge("test_gauge", "Test gauge");
			g.dec(5);
			expect(g.get()).toBe(-5);
		});

		it("should support labeled values", () => {
			const g = new Gauge("connections", "Active connections", ["type"]);
			g.set(5, { type: "ws" });
			g.set(10, { type: "http" });
			expect(g.get({ type: "ws" })).toBe(5);
			expect(g.get({ type: "http" })).toBe(10);
		});

		it("should reset all values", () => {
			const g = new Gauge("test_gauge", "Test gauge");
			g.set(42);
			g.reset();
			expect(g.get()).toBe(0);
		});

		it("should export Prometheus text format", () => {
			const g = new Gauge("active_conns", "Active connections");
			g.set(7);
			const text = g.collect();
			expect(text).toContain("# TYPE active_conns gauge");
			expect(text).toContain("active_conns 7");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Histogram
	// ═══════════════════════════════════════════════════════════════════════

	describe("Histogram", () => {
		it("should start empty", () => {
			const h = new Histogram("duration", "Request duration");
			const { sum, count } = h.get();
			expect(sum).toBe(0);
			expect(count).toBe(0);
		});

		it("should observe values and update sum/count", () => {
			const h = new Histogram("duration", "Request duration");
			h.observe(0.1);
			h.observe(0.5);
			h.observe(1.2);
			const { sum, count } = h.get();
			expect(count).toBe(3);
			expect(sum).toBeCloseTo(1.8, 5);
		});

		it("should distribute values into buckets", () => {
			const h = new Histogram("duration", "Duration", [], [0.1, 0.5, 1.0]);
			h.observe(0.05);  // <= 0.1, 0.5, 1.0
			h.observe(0.3);   // <= 0.5, 1.0
			h.observe(0.8);   // <= 1.0
			h.observe(2.0);   // > all buckets
			const text = h.collect();
			expect(text).toContain('_bucket{le="0.1"} 1');
			expect(text).toContain('_bucket{le="0.5"} 2');
			expect(text).toContain('_bucket{le="1"} 3');
			expect(text).toContain('_bucket{le="+Inf"} 4');
		});

		it("should use default buckets when none specified", () => {
			const h = new Histogram("duration", "Duration");
			expect(h.bucketBoundaries).toEqual([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
		});

		it("should support labeled observations", () => {
			const h = new Histogram("duration", "Duration", ["method"], [0.1, 0.5, 1.0]);
			h.observe(0.05, { method: "GET" });
			h.observe(0.3, { method: "POST" });
			const get = h.get({ method: "GET" });
			const post = h.get({ method: "POST" });
			expect(get.count).toBe(1);
			expect(post.count).toBe(1);
		});

		it("should reset all data", () => {
			const h = new Histogram("duration", "Duration");
			h.observe(1.0);
			h.observe(2.0);
			h.reset();
			expect(h.get().count).toBe(0);
			expect(h.get().sum).toBe(0);
		});

		it("should export Prometheus text format", () => {
			const h = new Histogram("req_duration", "Request duration", [], [0.1, 1.0]);
			h.observe(0.05);
			h.observe(0.5);
			const text = h.collect();
			expect(text).toContain("# HELP req_duration Request duration");
			expect(text).toContain("# TYPE req_duration histogram");
			expect(text).toContain("req_duration_sum");
			expect(text).toContain("req_duration_count 2");
		});

		it("should export JSON format", () => {
			const h = new Histogram("duration", "Duration", [], [0.1, 1.0]);
			h.observe(0.5);
			const json = h.collectJson();
			expect(json.name).toBe("duration");
			expect(json.type).toBe("histogram");
			expect(json.values).toHaveLength(1);
			expect(json.values[0].count).toBe(1);
			expect(json.values[0].sum).toBe(0.5);
			expect(json.values[0].buckets["0.1"]).toBe(0);
			expect(json.values[0].buckets["1"]).toBe(1);
			expect(json.values[0].buckets["+Inf"]).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// MetricsRegistry
	// ═══════════════════════════════════════════════════════════════════════

	describe("MetricsRegistry", () => {
		let registry: MetricsRegistry;

		beforeEach(() => {
			registry = new MetricsRegistry();
		});

		it("should create and return counters", () => {
			const c1 = registry.counter("test_total", "Test");
			const c2 = registry.counter("test_total", "Test");
			expect(c1).toBe(c2); // Same instance
			c1.inc(5);
			expect(c2.get()).toBe(5);
		});

		it("should create and return gauges", () => {
			const g = registry.gauge("active", "Active count");
			g.set(10);
			expect(g.get()).toBe(10);
		});

		it("should create and return histograms", () => {
			const h = registry.histogram("latency", "Latency");
			h.observe(0.5);
			expect(h.get().count).toBe(1);
		});

		it("should collect all metrics in Prometheus format", () => {
			registry.counter("requests_total", "Total requests");
			registry.gauge("active_conns", "Active connections");
			registry.histogram("latency_seconds", "Latency");

			const text = registry.collect();
			expect(text).toContain("requests_total");
			expect(text).toContain("active_conns");
			expect(text).toContain("latency_seconds");
		});

		it("should collect all metrics in JSON format", () => {
			registry.counter("c1", "Counter 1");
			registry.gauge("g1", "Gauge 1");
			registry.histogram("h1", "Histogram 1");

			const json = registry.collectJson();
			expect(json.counters).toHaveLength(1);
			expect(json.gauges).toHaveLength(1);
			expect(json.histograms).toHaveLength(1);
		});

		it("should reset all metrics", () => {
			const c = registry.counter("test_total", "Test");
			const g = registry.gauge("test_gauge", "Test");
			c.inc(10);
			g.set(5);
			registry.reset();
			expect(c.get()).toBe(0);
			expect(g.get()).toBe(0);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Default Metrics
	// ═══════════════════════════════════════════════════════════════════════

	describe("default metrics", () => {
		it("should register all default Chitragupta metrics", () => {
			const registry = new MetricsRegistry();
			const defaults = registerDefaultMetrics(registry);

			expect(defaults.httpRequestsTotal).toBeInstanceOf(Counter);
			expect(defaults.httpRequestDuration).toBeInstanceOf(Histogram);
			expect(defaults.httpRequestSize).toBeInstanceOf(Histogram);
			expect(defaults.wsConnectionsTotal).toBeInstanceOf(Counter);
			expect(defaults.wsConnectionsActive).toBeInstanceOf(Gauge);
			expect(defaults.wsMessagesTotal).toBeInstanceOf(Counter);
			expect(defaults.agentRequestsTotal).toBeInstanceOf(Counter);
			expect(defaults.agentTokensTotal).toBeInstanceOf(Counter);
			expect(defaults.memoryOperationsTotal).toBeInstanceOf(Counter);

			const text = registry.collect();
			expect(text).toContain("chitragupta_http_requests_total");
			expect(text).toContain("chitragupta_http_request_duration_seconds");
			expect(text).toContain("chitragupta_ws_connections_total");
			expect(text).toContain("chitragupta_agent_requests_total");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Global Registry
	// ═══════════════════════════════════════════════════════════════════════

	describe("global registry", () => {
		beforeEach(() => {
			resetMetricsRegistry();
		});

		it("should return the same instance on repeated calls", () => {
			const r1 = getMetricsRegistry();
			const r2 = getMetricsRegistry();
			expect(r1).toBe(r2);
		});

		it("should return a new instance after reset", () => {
			const r1 = getMetricsRegistry();
			resetMetricsRegistry();
			const r2 = getMetricsRegistry();
			expect(r1).not.toBe(r2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Label Escaping
	// ═══════════════════════════════════════════════════════════════════════

	describe("label escaping", () => {
		it("should escape special characters in label values", () => {
			const c = new Counter("test_total", "Test", ["path"]);
			c.inc(1, { path: '/api/"test"' });
			const text = c.collect();
			expect(text).toContain('path="/api/\\"test\\""');
		});
	});
});
