/**
 * Logger transports — Console, JSON, and File output implementations.
 *
 * Extracted from logger.ts for maintainability.
 *
 * @module logger-transports
 */

import { writeFileSync, appendFileSync, statSync, renameSync } from "node:fs";

// ─── Shared Types (duplicated to avoid circular imports) ─────────────────────

/** Log level enum values — must match LogLevel in logger.ts. */
export const LOG_LEVEL = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
	FATAL: 4,
} as const;

/** Log entry as received by transports. */
export interface TransportLogEntry {
	timestamp: string;
	level: number;
	levelName: string;
	message: string;
	context: Record<string, unknown>;
	requestId?: string;
	traceId?: string;
	spanId?: string;
	error?: { name: string; message: string; stack?: string };
	duration?: number;
	package?: string;
}

/** Transport interface that logger.ts will use. */
export interface TransportWriter {
	write(entry: TransportLogEntry): void;
}

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = "\x1b[2m";
const ANSI_BOLD = "\x1b[1m";

/** Log level names for transport formatting. */
export const LOG_LEVEL_NAMES: Record<number, string> = {
	[LOG_LEVEL.DEBUG]: "DEBUG",
	[LOG_LEVEL.INFO]: "INFO",
	[LOG_LEVEL.WARN]: "WARN",
	[LOG_LEVEL.ERROR]: "ERROR",
	[LOG_LEVEL.FATAL]: "FATAL",
};

const LEVEL_COLORS: Record<number, string> = {
	[LOG_LEVEL.DEBUG]: "\x1b[36m",   // cyan
	[LOG_LEVEL.INFO]: "\x1b[32m",    // green
	[LOG_LEVEL.WARN]: "\x1b[33m",    // yellow
	[LOG_LEVEL.ERROR]: "\x1b[31m",   // red
	[LOG_LEVEL.FATAL]: "\x1b[35;1m", // bold magenta
};

// ─── Console Transport ───────────────────────────────────────────────────────

/**
 * Console transport — human-readable colored output with timestamps.
 */
export class ConsoleTransport implements TransportWriter {
	private readonly useColors: boolean;
	private readonly forceStderr: boolean;

	constructor(opts?: { colors?: boolean; forceStderr?: boolean }) {
		this.useColors = opts?.colors ?? (process.stdout.isTTY ?? false);
		this.forceStderr = opts?.forceStderr ?? false;
	}

	write(entry: TransportLogEntry): void {
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

		if (entry.requestId) { line += ` req=${entry.requestId}`; }
		if (entry.duration !== undefined) { line += ` duration=${entry.duration}ms`; }
		if (entry.error) {
			line += `\n  ${entry.error.name}: ${entry.error.message}`;
			if (entry.error.stack) {
				line += `\n${entry.error.stack.split("\n").slice(1).map((l) => `  ${l.trim()}`).join("\n")}`;
			}
		}

		const stream = this.forceStderr
			? process.stderr
			: (entry.level >= LOG_LEVEL.ERROR ? process.stderr : process.stdout);
		stream.write(line + "\n");
	}
}

// ─── JSON Transport ──────────────────────────────────────────────────────────

/**
 * JSON transport — structured JSON lines for log aggregation.
 * Outputs one JSON object per line to stdout/stderr.
 */
export class JsonTransport implements TransportWriter {
	private readonly forceStderr: boolean;

	constructor(opts?: { forceStderr?: boolean }) {
		this.forceStderr = opts?.forceStderr ?? false;
	}

	write(entry: TransportLogEntry): void {
		const obj: Record<string, unknown> = {
			timestamp: entry.timestamp,
			level: LOG_LEVEL_NAMES[entry.level],
			message: entry.message,
			package: entry.package,
		};

		if (Object.keys(entry.context).length > 0) { obj.context = entry.context; }
		if (entry.requestId) obj.requestId = entry.requestId;
		if (entry.traceId) obj.traceId = entry.traceId;
		if (entry.spanId) obj.spanId = entry.spanId;
		if (entry.error) obj.error = entry.error;
		if (entry.duration !== undefined) obj.duration = entry.duration;

		const stream = this.forceStderr
			? process.stderr
			: (entry.level >= LOG_LEVEL.ERROR ? process.stderr : process.stdout);
		stream.write(JSON.stringify(obj) + "\n");
	}
}

// ─── File Transport ──────────────────────────────────────────────────────────

/**
 * File transport — appends JSON lines to a file with optional rotation by size.
 */
export class FileTransport implements TransportWriter {
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

		try { this.currentSize = statSync(this.filePath).size; }
		catch { this.currentSize = 0; }
	}

	write(entry: TransportLogEntry): void {
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

		if (this.currentSize + bytes > this.maxSizeBytes) {
			this.rotate();
		}

		try {
			appendFileSync(this.filePath, line, "utf-8");
			this.currentSize += bytes;
		} catch {
			// File write error — silently ignore
		}
	}

	private rotate(): void {
		try {
			for (let i = this.maxFiles - 1; i >= 1; i--) {
				try { renameSync(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`); }
				catch { /* File may not exist */ }
			}
			renameSync(this.filePath, `${this.filePath}.1`);
			writeFileSync(this.filePath, "", "utf-8");
			this.currentSize = 0;
		} catch {
			// Rotation failed — continue writing
		}
	}
}
