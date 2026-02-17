/**
 * Observability — Drishti observability stack for Chitragupta.
 *
 * Re-exports logger, tracing, metrics, and health modules.
 */

// Logger
export {
	LogLevel,
	Logger,
	ConsoleTransport,
	JsonTransport,
	FileTransport,
	createLogger,
	configureLogging,
	getLoggingConfig,
	resetLoggingConfig,
} from "./logger.js";
export type {
	LogEntry,
	LogTransport,
	LoggerConfig,
} from "./logger.js";

// Tracing
export {
	Tracer,
	ConsoleTraceExporter,
	JsonTraceExporter,
	generateTraceId,
	generateSpanId,
	getTracer,
	resetTracer,
} from "./tracing.js";
export type {
	Span,
	SpanStatus,
	SpanEvent,
	TraceExporter,
	TracerConfig,
} from "./tracing.js";

// Metrics
export {
	Counter,
	Gauge,
	Histogram,
	MetricsRegistry,
	registerDefaultMetrics,
	getMetricsRegistry,
	resetMetricsRegistry,
} from "./metrics.js";
export type {
	MetricType,
	MetricDefinition,
} from "./metrics.js";

// Health
export {
	HealthChecker,
	MemoryHealthCheck,
	EventLoopHealthCheck,
	DiskHealthCheck,
} from "./health.js";
export type {
	HealthStatus,
	HealthCheck,
	HealthCheckResult,
	HealthReport,
} from "./health.js";
