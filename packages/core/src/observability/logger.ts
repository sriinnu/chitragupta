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

import { writeFileSync, appendFileSync, statSync, renameSync } from "node:fs";

// ─── Log Level ───────────────────────────────────────────────────────────────

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	FATAL = 4,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
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

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = "\x1b[2m";
const ANSI_BOLD = "\x1b[1m";

const LEVEL_COLORS: Record<LogLevel, string> = {
	[LogLevel.DEBUG]: "\x1b[36m",   // cyan
	[LogLevel.INFO]: "\x1b[32m",    // green
	[LogLevel.WARN]: "\x1b[33m",    // yellow
	[LogLevel.ERROR]: "\x1b[31m",   // red
	[LogLevel.FATAL]: "\x1b[35;1m", // bold magenta
};

// ─── Transports ──────────────────────────────────────────────────────────────

/**
 * Console transport — human-readable colored output with timestamps.
 */
export class ConsoleTransport implements LogTransport {
	private readonly useColors: boolean;

	constructor(opts?: { colors?: boolean }) {
		this.useColors = opts?.colors ?? (process.stdout.isTTY ?? false);
	}

	write(entry: LogEntry): void {
		const ts = entry.timestamp.slice(11, 23); // HH:mm:ss.SSS
		const lvl = LOG_LEVEL_NAMES[entry.level].padEnd(5);
		const pkg = entry.package ? ` [${entry.package}]` : "";

		let line: string;
		if (this.useColors) {
			const color = LEVEL_COLORS[entry.level];
			line = `${ANSI_DIM}${ts}${ANSI_RESET} ${color}${lvl}${ANSI_RESET}${ANSI_BOLD}${pkg}${ANSI_RESET} ${entry.message}`;
		} else {
			line = `${ts} ${lvl}${pkg} ${entry.message}`;
		}

		// Append context keys if present
		const ctxKeys = Object.keys(entry.context);
		if (ctxKeys.length > 0) {
			const ctxStr = ctxKeys
				.map((k) => `${k}=${JSON.stringify(entry.context[k])}`)
				.join(" ");
			line += ` ${this.useColors ? ANSI_DIM : ""}${ctxStr}${this.useColors ? ANSI_RESET : ""}`;
		}

		if (entry.requestId) {
			line += ` req=${entry.requestId}`;
		}
		if (entry.duration !== undefined) {
			line += ` duration=${entry.duration}ms`;
		}
		if (entry.error) {
			line += `\n  ${entry.error.name}: ${entry.error.message}`;
			if (entry.error.stack) {
				line += `\n${entry.error.stack.split("\n").slice(1).map((l) => `  ${l.trim()}`).join("\n")}`;
			}
		}

		const stream = entry.level >= LogLevel.ERROR ? process.stderr : process.stdout;
		stream.write(line + "\n");
	}
}

/**
 * JSON transport — structured JSON lines for log aggregation.
 * Outputs one JSON object per line to stdout/stderr.
 */
export class JsonTransport implements LogTransport {
	write(entry: LogEntry): void {
		const obj: Record<string, unknown> = {
			timestamp: entry.timestamp,
			level: LOG_LEVEL_NAMES[entry.level],
			message: entry.message,
			package: entry.package,
		};

		if (Object.keys(entry.context).length > 0) {
			obj.context = entry.context;
		}
		if (entry.requestId) obj.requestId = entry.requestId;
		if (entry.traceId) obj.traceId = entry.traceId;
		if (entry.spanId) obj.spanId = entry.spanId;
		if (entry.error) obj.error = entry.error;
		if (entry.duration !== undefined) obj.duration = entry.duration;

		const stream = entry.level >= LogLevel.ERROR ? process.stderr : process.stdout;
		stream.write(JSON.stringify(obj) + "\n");
	}
}

/**
 * File transport — appends JSON lines to a file with optional rotation by size.
 */
export class FileTransport implements LogTransport {
	private readonly filePath: string;
	private readonly maxSizeBytes: number;
	private readonly maxFiles: number;
	private currentSize: number;

	constructor(opts: {
		filePath: string;
		/** Maximum file size in bytes before rotation. Default: 10 MiB. */
		maxSizeBytes?: number;
		/** Number of rotated files to keep. Default: 5. */
		maxFiles?: number;
	}) {
		this.filePath = opts.filePath;
		this.maxSizeBytes = opts.maxSizeBytes ?? 10 * 1024 * 1024;
		this.maxFiles = opts.maxFiles ?? 5;

		// Get current file size
		try {
			this.currentSize = statSync(this.filePath).size;
		} catch {
			this.currentSize = 0;
		}
	}

	write(entry: LogEntry): void {
		const line = JSON.stringify({
			timestamp: entry.timestamp,
			level: LOG_LEVEL_NAMES[entry.level],
			message: entry.message,
			package: entry.package,
			...(Object.keys(entry.context).length > 0 ? { context: entry.context } : {}),
			...(entry.requestId ? { requestId: entry.requestId } : {}),
			...(entry.traceId ? { traceId: entry.traceId } : {}),
			...(entry.spanId ? { spanId: entry.spanId } : {}),
			...(entry.error ? { error: entry.error } : {}),
			...(entry.duration !== undefined ? { duration: entry.duration } : {}),
		}) + "\n";

		const bytes = Buffer.byteLength(line, "utf-8");

		// Check if rotation is needed
		if (this.currentSize + bytes > this.maxSizeBytes) {
			this.rotate();
		}

		try {
			appendFileSync(this.filePath, line, "utf-8");
			this.currentSize += bytes;
		} catch {
			// File write error — silently ignore to avoid crashing the application
		}
	}

	private rotate(): void {
		try {
			// Shift existing rotated files: .4 -> .5, .3 -> .4, etc.
			for (let i = this.maxFiles - 1; i >= 1; i--) {
				try {
					renameSync(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`);
				} catch {
					// File may not exist — that's fine
				}
			}
			// Rotate current file to .1
			renameSync(this.filePath, `${this.filePath}.1`);
			// Create empty new file
			writeFileSync(this.filePath, "", "utf-8");
			this.currentSize = 0;
		} catch {
			// Rotation failed — continue writing to current file
		}
	}
}

// ─── Logger ──────────────────────────────────────────────────────────────────

/**
 * Resolve the effective log level from the environment, config, and global config.
 */
function resolveLevel(configLevel?: LogLevel): LogLevel {
	// 1. Environment variable always wins
	const envLevel = process.env.LOG_LEVEL?.toLowerCase();
	if (envLevel && envLevel in LOG_LEVEL_PARSE) {
		return LOG_LEVEL_PARSE[envLevel];
	}

	// 2. Explicit config level
	if (configLevel !== undefined) {
		return configLevel;
	}

	// 3. Global config level
	if (globalConfig.level !== undefined) {
		return globalConfig.level;
	}

	// 4. Default: INFO in production, DEBUG in development
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
		const child = new Logger(`${this.name}:${childName}`, {
			level: this.level,
			transports: this.transports,
			defaultContext: { ...this.context },
		});
		return child;
	}

	/**
	 * Return a new logger with additional context merged in.
	 * Does not mutate the original logger.
	 */
	withContext(ctx: Record<string, unknown>): Logger {
		const merged = new Logger(this.name, {
			level: this.level,
			transports: this.transports,
			defaultContext: { ...this.context, ...ctx },
		});
		return merged;
	}

	/** Dynamically change the minimum log level. */
	setLevel(level: LogLevel): void {
		this.level = level;
	}

	/** Get the current log level. */
	getLevel(): LogLevel {
		return this.level;
	}

	/** Get the logger name. */
	getName(): string {
		return this.name;
	}

	// ─── Internal ────────────────────────────────────────────────────────

	private emit(
		level: LogLevel,
		message: string,
		error?: Error | unknown,
		ctx?: Record<string, unknown>,
	): void {
		// Fast path: skip if below threshold
		if (level < this.level) return;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			levelName: LOG_LEVEL_NAMES[level],
			message,
			context: { ...this.context, ...(ctx ?? {}) },
			package: this.name,
		};

		// Extract request/trace IDs from context
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

		// Serialize error
		if (error) {
			if (error instanceof Error) {
				entry.error = {
					name: error.name,
					message: error.message,
					stack: error.stack,
				};
			} else {
				entry.error = {
					name: "Error",
					message: String(error),
				};
			}
		}

		// Dispatch to all transports
		for (const transport of this.transports) {
			try {
				transport.write(entry);
			} catch {
				// Transport failure must never crash the application
			}
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
