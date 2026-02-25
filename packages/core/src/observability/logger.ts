/**
 * Drishti Logger — Structured, pluggable logging for Chitragupta.
 * Sanskrit: Drishti (दृष्टि) = vision, sight, observation.
 *
 * Lightweight logger with level filtering, pluggable transports,
 * child loggers, and contextual metadata. Zero overhead when the
 * log level is below threshold — the message function is never called.
 *
 * Pure Node.js — no external dependencies.
 */

// ─── Log Level ───────────────────────────────────────────────────────────────

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	FATAL = 4,
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LogEntry {
	/** ISO-8601 timestamp */
	timestamp: string;
	/** Log severity level */
	level: LogLevel;
	/** Human-readable level name */
	levelName: string;
	/** Log message */
	message: string;
	/** Structured context metadata */
	context: Record<string, unknown>;
	/** HTTP request ID for correlation */
	requestId?: string;
	/** Distributed trace ID */
	traceId?: string;
	/** Span ID within a trace */
	spanId?: string;
	/** Error object if applicable */
	error?: { name: string; message: string; stack?: string };
	/** Duration in milliseconds for timed operations */
	duration?: number;
	/** Package or module name that produced this log */
	package?: string;
}

export interface LogTransport {
	/** Write a log entry to the output destination. */
	write(entry: LogEntry): void;
}

export interface LoggerConfig {
	/** Minimum level to emit. Entries below this level are silently discarded. */
	level?: LogLevel;
	/** Output transports. Defaults to [ConsoleTransport]. */
	transports?: LogTransport[];
	/** Default context merged into every log entry. */
	defaultContext?: Record<string, unknown>;
}

// Import transports
import { ConsoleTransport } from "./logger-transports.js";

// Re-export transports for backward compatibility
export { ConsoleTransport, JsonTransport, FileTransport, LOG_LEVEL_NAMES } from "./logger-transports.js";
export type { TransportLogEntry, TransportWriter } from "./logger-transports.js";

// ─── Global Configuration ────────────────────────────────────────────────────

let globalConfig: LoggerConfig = {};

/**
 * Configure global logging defaults. Affects all loggers created after this call,
 * and existing loggers that have not overridden these settings.
 */
export function configureLogging(config: LoggerConfig): void {
	globalConfig = { ...config };
}

/** Get the current global logging configuration. */
export function getLoggingConfig(): LoggerConfig {
	return { ...globalConfig };
}

/** Reset global config to defaults. Primarily for testing. */
export function resetLoggingConfig(): void {
	globalConfig = {};
}

// ─── Level Name Map ──────────────────────────────────────────────────────────

const LEVEL_NAMES: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: "DEBUG",
	[LogLevel.INFO]: "INFO",
	[LogLevel.WARN]: "WARN",
	[LogLevel.ERROR]: "ERROR",
	[LogLevel.FATAL]: "FATAL",
};

const LOG_LEVEL_PARSE: Record<string, LogLevel> = {
	debug: LogLevel.DEBUG,
	info: LogLevel.INFO,
	warn: LogLevel.WARN,
	error: LogLevel.ERROR,
	fatal: LogLevel.FATAL,
};

// ─── Logger ──────────────────────────────────────────────────────────────────

/**
 * Resolve the effective log level from the environment, config, and global config.
 */
function resolveLevel(configLevel?: LogLevel): LogLevel {
	const envLevel = process.env.LOG_LEVEL?.toLowerCase();
	if (envLevel && envLevel in LOG_LEVEL_PARSE) {
		return LOG_LEVEL_PARSE[envLevel];
	}
	if (configLevel !== undefined) return configLevel;
	if (globalConfig.level !== undefined) return globalConfig.level;
	return process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG;
}

export class Logger {
	private readonly name: string;
	private level: LogLevel;
	private readonly transports: LogTransport[];
	private readonly context: Record<string, unknown>;

	constructor(name: string, config?: LoggerConfig) {
		this.name = name;
		this.level = resolveLevel(config?.level);
		this.transports = config?.transports
			?? globalConfig.transports
			?? [new ConsoleTransport()];
		this.context = {
			...(globalConfig.defaultContext ?? {}),
			...(config?.defaultContext ?? {}),
		};
	}

	/** Log a DEBUG message. */
	debug(message: string, ctx?: Record<string, unknown>): void {
		this.emit(LogLevel.DEBUG, message, undefined, ctx);
	}

	/** Log an INFO message. */
	info(message: string, ctx?: Record<string, unknown>): void {
		this.emit(LogLevel.INFO, message, undefined, ctx);
	}

	/** Log a WARN message. */
	warn(message: string, ctx?: Record<string, unknown>): void {
		this.emit(LogLevel.WARN, message, undefined, ctx);
	}

	/** Log an ERROR message with optional Error object. */
	error(message: string, error?: Error | unknown, ctx?: Record<string, unknown>): void {
		this.emit(LogLevel.ERROR, message, error, ctx);
	}

	/** Log a FATAL message with optional Error object. */
	fatal(message: string, error?: Error | unknown, ctx?: Record<string, unknown>): void {
		this.emit(LogLevel.FATAL, message, error, ctx);
	}

	/**
	 * Create a child logger with inherited config and a prefixed name.
	 * The child shares transports and context with the parent.
	 */
	child(childName: string): Logger {
		return new Logger(`${this.name}:${childName}`, {
			level: this.level,
			transports: this.transports,
			defaultContext: { ...this.context },
		});
	}

	/**
	 * Return a new logger with additional context merged in.
	 * Does not mutate the original logger.
	 */
	withContext(ctx: Record<string, unknown>): Logger {
		return new Logger(this.name, {
			level: this.level,
			transports: this.transports,
			defaultContext: { ...this.context, ...ctx },
		});
	}

	/** Dynamically change the minimum log level. */
	setLevel(level: LogLevel): void { this.level = level; }

	/** Get the current log level. */
	getLevel(): LogLevel { return this.level; }

	/** Get the logger name. */
	getName(): string { return this.name; }

	// ─── Internal ────────────────────────────────────────────────────────

	private emit(
		level: LogLevel,
		message: string,
		error?: Error | unknown,
		ctx?: Record<string, unknown>,
	): void {
		if (level < this.level) return;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			levelName: LEVEL_NAMES[level],
			message,
			context: { ...this.context, ...(ctx ?? {}) },
			package: this.name,
		};

		if (entry.context.requestId) {
			entry.requestId = String(entry.context.requestId);
			delete entry.context.requestId;
		}
		if (entry.context.traceId) {
			entry.traceId = String(entry.context.traceId);
			delete entry.context.traceId;
		}
		if (entry.context.spanId) {
			entry.spanId = String(entry.context.spanId);
			delete entry.context.spanId;
		}
		if (entry.context.duration !== undefined) {
			entry.duration = Number(entry.context.duration);
			delete entry.context.duration;
		}

		if (error) {
			if (error instanceof Error) {
				entry.error = { name: error.name, message: error.message, stack: error.stack };
			} else {
				entry.error = { name: "Error", message: String(error) };
			}
		}

		for (const transport of this.transports) {
			try { transport.write(entry); }
			catch { /* Transport failure must never crash the application */ }
		}
	}
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a named logger with global defaults.
 *
 * @param name - Package or module identifier (e.g. "http-server", "agent:spawn")
 */
export function createLogger(name: string): Logger {
	return new Logger(name);
}
