import { describe, it, expect, beforeEach } from "vitest";
import {
	Tracer,
	ConsoleTraceExporter,
	JsonTraceExporter,
	generateTraceId,
	generateSpanId,
	resetTracer,
} from "@chitragupta/core";
import type { Span, TraceExporter } from "@chitragupta/core";

// ─── Test Exporter ───────────────────────────────────────────────────────────

class TestExporter implements TraceExporter {
	spans: Span[] = [];
	export(spans: Span[]): void {
		this.spans.push(...spans);
	}
	clear(): void {
		this.spans = [];
	}
}

describe("Tracing", () => {
	let exporter: TestExporter;
	let tracer: Tracer;

	beforeEach(() => {
		exporter = new TestExporter();
		tracer = new Tracer({ exporters: [exporter], bufferSize: 1000 });
		resetTracer();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// ID Generation
	// ═══════════════════════════════════════════════════════════════════════

	describe("ID generation", () => {
		it("should generate a 32-char hex trace ID", () => {
			const id = generateTraceId();
			expect(id).toHaveLength(32);
			expect(id).toMatch(/^[0-9a-f]{32}$/);
		});

		it("should generate a 16-char hex span ID", () => {
			const id = generateSpanId();
			expect(id).toHaveLength(16);
			expect(id).toMatch(/^[0-9a-f]{16}$/);
		});

		it("should generate unique IDs", () => {
			const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()));
			expect(ids.size).toBe(100);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Span Creation
	// ═══════════════════════════════════════════════════════════════════════

	describe("span creation", () => {
		it("should create a root span with trace ID and span ID", () => {
			const span = tracer.startSpan("test-op");
			expect(span.traceId).toHaveLength(32);
			expect(span.spanId).toHaveLength(16);
			expect(span.parentSpanId).toBeUndefined();
			expect(span.name).toBe("test-op");
			expect(span.status).toBe("UNSET");
			expect(span.startTime).toBeDefined();
			expect(span.endTime).toBeUndefined();
		});

		it("should create a child span inheriting the parent trace ID", () => {
			const parent = tracer.startSpan("parent");
			const child = tracer.startSpan("child", parent);
			expect(child.traceId).toBe(parent.traceId);
			expect(child.parentSpanId).toBe(parent.spanId);
			expect(child.spanId).not.toBe(parent.spanId);
		});

		it("should end a span with OK status by default", () => {
			const span = tracer.startSpan("test");
			tracer.endSpan(span);
			expect(span.endTime).toBeDefined();
			expect(span.status).toBe("OK");
		});

		it("should end a span with explicit ERROR status", () => {
			const span = tracer.startSpan("test");
			tracer.endSpan(span, "ERROR");
			expect(span.status).toBe("ERROR");
		});

		it("should preserve explicit status when ending", () => {
			const span = tracer.startSpan("test");
			span.status = "ERROR";
			tracer.endSpan(span);
			expect(span.status).toBe("ERROR");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Span Events and Attributes
	// ═══════════════════════════════════════════════════════════════════════

	describe("events and attributes", () => {
		it("should add events to a span", () => {
			const span = tracer.startSpan("test");
			tracer.addEvent(span, "cache-miss", { key: "abc" });
			expect(span.events).toHaveLength(1);
			expect(span.events[0].name).toBe("cache-miss");
			expect(span.events[0].attributes?.key).toBe("abc");
			expect(span.events[0].timestamp).toBeDefined();
		});

		it("should set attributes on a span", () => {
			const span = tracer.startSpan("test");
			tracer.setAttribute(span, "http.method", "GET");
			tracer.setAttribute(span, "http.status", 200);
			expect(span.attributes["http.method"]).toBe("GET");
			expect(span.attributes["http.status"]).toBe(200);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// AsyncLocalStorage / withSpan
	// ═══════════════════════════════════════════════════════════════════════

	describe("withSpan", () => {
		it("should create and end a span around a function", async () => {
			const result = await tracer.withSpan("my-op", (span) => {
				expect(span.name).toBe("my-op");
				return 42;
			});
			expect(result).toBe(42);
			tracer.flush();
			expect(exporter.spans).toHaveLength(1);
			expect(exporter.spans[0].status).toBe("OK");
			expect(exporter.spans[0].endTime).toBeDefined();
		});

		it("should set ERROR status when the function throws", async () => {
			await expect(
				tracer.withSpan("fail", () => {
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			tracer.flush();
			expect(exporter.spans).toHaveLength(1);
			expect(exporter.spans[0].status).toBe("ERROR");
			expect(exporter.spans[0].events.some((e) => e.name === "exception")).toBe(true);
		});

		it("should propagate context for nested withSpan calls", async () => {
			await tracer.withSpan("outer", async (outer) => {
				await tracer.withSpan("inner", (inner) => {
					expect(inner.parentSpanId).toBe(outer.spanId);
					expect(inner.traceId).toBe(outer.traceId);
				});
			});
			tracer.flush();
			expect(exporter.spans).toHaveLength(2);
		});

		it("should support async functions in withSpan", async () => {
			const result = await tracer.withSpan("async-op", async () => {
				await new Promise((r) => setTimeout(r, 10));
				return "done";
			});
			expect(result).toBe("done");
			tracer.flush();
			expect(exporter.spans[0].status).toBe("OK");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Export
	// ═══════════════════════════════════════════════════════════════════════

	describe("export", () => {
		it("should flush buffered spans to exporters", () => {
			const s1 = tracer.startSpan("op1");
			tracer.endSpan(s1);
			const s2 = tracer.startSpan("op2");
			tracer.endSpan(s2);
			expect(exporter.spans).toHaveLength(0);
			tracer.flush();
			expect(exporter.spans).toHaveLength(2);
		});

		it("should auto-flush when buffer size is reached", () => {
			const smallTracer = new Tracer({ exporters: [exporter], bufferSize: 2 });
			const s1 = smallTracer.startSpan("op1");
			smallTracer.endSpan(s1);
			expect(exporter.spans).toHaveLength(0);
			const s2 = smallTracer.startSpan("op2");
			smallTracer.endSpan(s2);
			expect(exporter.spans).toHaveLength(2);
		});

		it("should survive exporter errors", () => {
			const brokenExporter: TraceExporter = {
				export() { throw new Error("export failure"); },
			};
			const t = new Tracer({ exporters: [brokenExporter, exporter] });
			const s = t.startSpan("op");
			t.endSpan(s);
			t.flush(); // Should not throw
			expect(exporter.spans).toHaveLength(1);
		});
	});
});
