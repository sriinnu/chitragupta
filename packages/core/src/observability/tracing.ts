/**
 * Sutra Tracing — Distributed tracing for Chitragupta.
 * Sanskrit: Sutra (सूत्र) = thread, trace, connection.
 *
 * Lightweight tracing implementation with AsyncLocalStorage-based
 * context propagation, span hierarchies, and pluggable exporters.
 *
 * Span IDs: 16-char hex random
 * Trace IDs: 32-char hex random
 *
 * Pure Node.js — no external dependencies.
 */

import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SpanStatus = "OK" | "ERROR" | "UNSET";

export interface SpanEvent {
	/** Event name */
	name: string;
	/** Event timestamp (ISO-8601) */
	timestamp: string;
	/** Optional event attributes */
	attributes?: Record<string, unknown>;
}

export interface Span {
	/** 32-char hex trace identifier (shared across all spans in a trace) */
	traceId: string;
	/** 16-char hex span identifier */
	spanId: string;
	/** Parent span ID (undefined for root spans) */
	parentSpanId?: string;
	/** Human-readable span name (operation name) */
	name: string;
	/** Start time (ISO-8601) */
	startTime: string;
	/** End time (ISO-8601, set when span is ended) */
	endTime?: string;
	/** Span completion status */
	status: SpanStatus;
	/** Key-value attributes attached to this span */
	attributes: Record<string, unknown>;
	/** Timestamped events within this span */
	events: SpanEvent[];
}

export interface TraceExporter {
	/** Export a batch of completed spans. */
	export(spans: Span[]): void;
}

export interface TracerConfig {
	/** Exporters to send completed spans to. */
	exporters?: TraceExporter[];
	/** Maximum spans to buffer before auto-flushing. Default: 100. */
	bufferSize?: number;
}

// ─── ID Generation ───────────────────────────────────────────────────────────

/** Generate a 32-char hex trace ID. */
export function generateTraceId(): string {
	return randomBytes(16).toString("hex");
}

/** Generate a 16-char hex span ID. */
export function generateSpanId(): string {
	return randomBytes(8).toString("hex");
}

// ─── Async Context ───────────────────────────────────────────────────────────

const spanStorage = new AsyncLocalStorage<Span>();

// ─── Tracer ──────────────────────────────────────────────────────────────────

export class Tracer {
	private readonly exporters: TraceExporter[];
	private readonly bufferSize: number;
	private buffer: Span[] = [];

	constructor(config?: TracerConfig) {
		this.exporters = config?.exporters ?? [];
		this.bufferSize = config?.bufferSize ?? 100;
	}

	/**
	 * Start a new span. If a parent span is provided or active in the
	 * async context, the new span inherits the trace ID and records the
	 * parent-child relationship.
	 */
	startSpan(name: string, parentSpan?: Span): Span {
		const parent = parentSpan ?? this.getActiveSpan();
		const traceId = parent?.traceId ?? generateTraceId();
		const spanId = generateSpanId();

		const span: Span = {
			traceId,
			spanId,
			parentSpanId: parent?.spanId,
			name,
			startTime: new Date().toISOString(),
			status: "UNSET",
			attributes: {},
			events: [],
		};

		return span;
	}

	/**
	 * End a span, recording the end time and optional status.
	 * The span is added to the export buffer.
	 */
	endSpan(span: Span, status?: SpanStatus): void {
		span.endTime = new Date().toISOString();
		if (status) {
			span.status = status;
		} else if (span.status === "UNSET") {
			span.status = "OK";
		}

		this.buffer.push(span);

		if (this.buffer.length >= this.bufferSize) {
			this.flush();
		}
	}

	/** Add a timestamped event to a span. */
	addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
		span.events.push({
			name,
			timestamp: new Date().toISOString(),
			attributes,
		});
	}

	/** Set an attribute on a span. */
	setAttribute(span: Span, key: string, value: unknown): void {
		span.attributes[key] = value;
	}

	/**
	 * Get the active span from the current async context.
	 * Returns null if no span is active.
	 */
	getActiveSpan(): Span | null {
		return spanStorage.getStore() ?? null;
	}

	/**
	 * Run a function within a span's async context. The span is automatically
	 * started before and ended after the function completes (or errors).
	 *
	 * The active span is set via AsyncLocalStorage so nested withSpan calls
	 * automatically establish parent-child relationships.
	 */
	async withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>): Promise<T> {
		const span = this.startSpan(name);

		try {
			const result = await spanStorage.run(span, () => fn(span));
			this.endSpan(span, "OK");
			return result;
		} catch (err) {
			span.status = "ERROR";
			this.addEvent(span, "exception", {
				"exception.type": err instanceof Error ? err.name : "Error",
				"exception.message": err instanceof Error ? err.message : String(err),
			});
			this.endSpan(span, "ERROR");
			throw err;
		}
	}

	/** Flush all buffered spans to exporters. */
	flush(): void {
		if (this.buffer.length === 0) return;
		const spans = [...this.buffer];
		this.buffer = [];

		for (const exporter of this.exporters) {
			try {
				exporter.export(spans);
			} catch {
				// Exporter failure must never crash the application
			}
		}
	}

	/** Get the number of buffered spans awaiting export. */
	getBufferSize(): number {
		return this.buffer.length;
	}
}

// ─── Exporters ───────────────────────────────────────────────────────────────

/**
 * Console trace exporter — logs spans in a human-readable format.
 */
export class ConsoleTraceExporter implements TraceExporter {
	export(spans: Span[]): void {
		for (const span of spans) {
			const duration = span.startTime && span.endTime
				? new Date(span.endTime).getTime() - new Date(span.startTime).getTime()
				: 0;
			const parent = span.parentSpanId ? ` parent=${span.parentSpanId}` : "";
			const attrs = Object.keys(span.attributes).length > 0
				? ` ${JSON.stringify(span.attributes)}`
				: "";

			process.stdout.write(
				`[TRACE] ${span.name} trace=${span.traceId.slice(0, 8)}.. ` +
				`span=${span.spanId}${parent} ` +
				`status=${span.status} ${duration}ms${attrs}\n`,
			);

			for (const event of span.events) {
				process.stdout.write(
					`  [EVENT] ${event.name} ${event.timestamp}` +
					(event.attributes ? ` ${JSON.stringify(event.attributes)}` : "") +
					"\n",
				);
			}
		}
	}
}

/**
 * JSON trace exporter — outputs spans as JSON lines, compatible
 * with Jaeger/Zipkin JSON import formats.
 */
export class JsonTraceExporter implements TraceExporter {
	private readonly writer: (line: string) => void;

	constructor(writer?: (line: string) => void) {
		this.writer = writer ?? ((line: string) => process.stdout.write(line + "\n"));
	}

	export(spans: Span[]): void {
		for (const span of spans) {
			const obj: Record<string, unknown> = {
				traceId: span.traceId,
				spanId: span.spanId,
				operationName: span.name,
				startTime: span.startTime,
				endTime: span.endTime,
				status: span.status,
				tags: span.attributes,
			};

			if (span.parentSpanId) {
				obj.parentSpanId = span.parentSpanId;
			}

			if (span.events.length > 0) {
				obj.logs = span.events.map((e) => ({
					timestamp: e.timestamp,
					fields: { event: e.name, ...(e.attributes ?? {}) },
				}));
			}

			this.writer(JSON.stringify(obj));
		}
	}
}

// ─── Global Tracer Instance ──────────────────────────────────────────────────

let globalTracer: Tracer | null = null;

/** Get or create the global tracer. */
export function getTracer(config?: TracerConfig): Tracer {
	if (!globalTracer) {
		globalTracer = new Tracer(config);
	}
	return globalTracer;
}

/** Reset the global tracer. Primarily for testing. */
export function resetTracer(): void {
	if (globalTracer) {
		globalTracer.flush();
	}
	globalTracer = null;
}
