import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	LogLevel,
	Logger,
	ConsoleTransport,
	JsonTransport,
	createLogger,
	configureLogging,
	resetLoggingConfig,
} from "@chitragupta/core";
import type { LogEntry, LogTransport } from "@chitragupta/core";

// ─── Test Transport ──────────────────────────────────────────────────────────

class TestTransport implements LogTransport {
	entries: LogEntry[] = [];
	write(entry: LogEntry): void {
		this.entries.push(entry);
	}
	clear(): void {
		this.entries = [];
	}
	last(): LogEntry | undefined {
		return this.entries[this.entries.length - 1];
	}
}

describe("Logger", () => {
	let transport: TestTransport;

	beforeEach(() => {
		transport = new TestTransport();
		resetLoggingConfig();
	});

	afterEach(() => {
		resetLoggingConfig();
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Log Level Filtering
	// ═══════════════════════════════════════════════════════════════════════

	describe("log level filtering", () => {
		it("should emit entries at or above the configured level", () => {
			const logger = new Logger("test", { level: LogLevel.INFO, transports: [transport] });
			logger.debug("should not appear");
			logger.info("should appear");
			logger.warn("should also appear");
			expect(transport.entries).toHaveLength(2);
			expect(transport.entries[0].message).toBe("should appear");
			expect(transport.entries[1].message).toBe("should also appear");
		});

		it("should not emit entries below the configured level", () => {
			const logger = new Logger("test", { level: LogLevel.ERROR, transports: [transport] });
			logger.debug("no");
			logger.info("no");
			logger.warn("no");
			expect(transport.entries).toHaveLength(0);
			logger.error("yes");
			expect(transport.entries).toHaveLength(1);
		});

		it("should support DEBUG level showing all messages", () => {
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [transport] });
			logger.debug("d");
			logger.info("i");
			logger.warn("w");
			logger.error("e");
			logger.fatal("f");
			expect(transport.entries).toHaveLength(5);
		});

		it("should support FATAL level showing only fatal", () => {
			const logger = new Logger("test", { level: LogLevel.FATAL, transports: [transport] });
			logger.error("no");
			logger.fatal("yes");
			expect(transport.entries).toHaveLength(1);
			expect(transport.entries[0].level).toBe(LogLevel.FATAL);
		});

		it("should allow dynamic level change via setLevel", () => {
			const logger = new Logger("test", { level: LogLevel.ERROR, transports: [transport] });
			logger.info("no");
			expect(transport.entries).toHaveLength(0);
			logger.setLevel(LogLevel.INFO);
			logger.info("yes");
			expect(transport.entries).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Log Entry Structure
	// ═══════════════════════════════════════════════════════════════════════

	describe("log entry structure", () => {
		it("should include timestamp, level, levelName, message, and package", () => {
			const logger = new Logger("my-pkg", { level: LogLevel.DEBUG, transports: [transport] });
			logger.info("hello world");
			const entry = transport.last()!;
			expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(entry.level).toBe(LogLevel.INFO);
			expect(entry.levelName).toBe("INFO");
			expect(entry.message).toBe("hello world");
			expect(entry.package).toBe("my-pkg");
		});

		it("should include context metadata", () => {
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [transport] });
			logger.info("with context", { userId: "abc", count: 42 });
			const entry = transport.last()!;
			expect(entry.context.userId).toBe("abc");
			expect(entry.context.count).toBe(42);
		});

		it("should serialize errors in error/fatal methods", () => {
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [transport] });
			const err = new TypeError("something broke");
			logger.error("oops", err);
			const entry = transport.last()!;
			expect(entry.error).toBeDefined();
			expect(entry.error!.name).toBe("TypeError");
			expect(entry.error!.message).toBe("something broke");
			expect(entry.error!.stack).toBeDefined();
		});

		it("should handle non-Error objects in error field", () => {
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [transport] });
			logger.error("oops", "string error");
			const entry = transport.last()!;
			expect(entry.error).toBeDefined();
			expect(entry.error!.message).toBe("string error");
		});

		it("should extract requestId from context into entry.requestId", () => {
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [transport] });
			logger.info("req", { requestId: "abc-123" });
			const entry = transport.last()!;
			expect(entry.requestId).toBe("abc-123");
			// Should not remain in context
			expect(entry.context.requestId).toBeUndefined();
		});

		it("should extract duration from context into entry.duration", () => {
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [transport] });
			logger.info("timed", { duration: 150 });
			const entry = transport.last()!;
			expect(entry.duration).toBe(150);
			expect(entry.context.duration).toBeUndefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Child Loggers
	// ═══════════════════════════════════════════════════════════════════════

	describe("child loggers", () => {
		it("should create a child with prefixed name", () => {
			const parent = new Logger("parent", { level: LogLevel.DEBUG, transports: [transport] });
			const child = parent.child("child");
			child.info("from child");
			expect(transport.last()!.package).toBe("parent:child");
		});

		it("should inherit parent level", () => {
			const parent = new Logger("parent", { level: LogLevel.WARN, transports: [transport] });
			const child = parent.child("child");
			child.info("should not appear");
			expect(transport.entries).toHaveLength(0);
			child.warn("should appear");
			expect(transport.entries).toHaveLength(1);
		});

		it("should inherit parent context", () => {
			const parent = new Logger("p", {
				level: LogLevel.DEBUG,
				transports: [transport],
				defaultContext: { env: "test" },
			});
			const child = parent.child("c");
			child.info("msg");
			expect(transport.last()!.context.env).toBe("test");
		});

		it("should allow grandchild loggers", () => {
			const root = new Logger("a", { level: LogLevel.DEBUG, transports: [transport] });
			const child = root.child("b");
			const grandchild = child.child("c");
			grandchild.info("deep");
			expect(transport.last()!.package).toBe("a:b:c");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Context Merging
	// ═══════════════════════════════════════════════════════════════════════

	describe("withContext", () => {
		it("should return a new logger with merged context", () => {
			const logger = new Logger("test", {
				level: LogLevel.DEBUG,
				transports: [transport],
				defaultContext: { service: "api" },
			});
			const scoped = logger.withContext({ requestId: "req-1" });
			scoped.info("scoped message");
			expect(transport.last()!.context.service).toBe("api");
			expect(transport.last()!.requestId).toBe("req-1");
		});

		it("should not mutate the original logger", () => {
			const logger = new Logger("test", {
				level: LogLevel.DEBUG,
				transports: [transport],
			});
			const scoped = logger.withContext({ extra: "val" });
			logger.info("original");
			expect(transport.last()!.context.extra).toBeUndefined();
			scoped.info("scoped");
			expect(transport.last()!.context.extra).toBe("val");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Global Configuration
	// ═══════════════════════════════════════════════════════════════════════

	describe("global configuration", () => {
		it("should use global transports when none specified", () => {
			configureLogging({ transports: [transport], level: LogLevel.DEBUG });
			const logger = new Logger("test");
			logger.info("global transport");
			expect(transport.entries).toHaveLength(1);
		});

		it("should use global level when none specified", () => {
			configureLogging({ transports: [transport], level: LogLevel.WARN });
			const logger = new Logger("test");
			logger.info("should not appear");
			logger.warn("should appear");
			expect(transport.entries).toHaveLength(1);
		});

		it("should merge global default context", () => {
			configureLogging({
				transports: [transport],
				level: LogLevel.DEBUG,
				defaultContext: { env: "test" },
			});
			const logger = new Logger("test");
			logger.info("msg");
			expect(transport.last()!.context.env).toBe("test");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Factory
	// ═══════════════════════════════════════════════════════════════════════

	describe("createLogger factory", () => {
		it("should create a logger with the given name", () => {
			configureLogging({ transports: [transport], level: LogLevel.DEBUG });
			const logger = createLogger("my-module");
			logger.info("test");
			expect(transport.last()!.package).toBe("my-module");
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Transports
	// ═══════════════════════════════════════════════════════════════════════

	describe("transports", () => {
		it("ConsoleTransport should write to stdout for info", () => {
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
			const ct = new ConsoleTransport({ colors: false });
			ct.write({
				timestamp: "2025-01-01T00:00:00.000Z",
				level: LogLevel.INFO,
				levelName: "INFO",
				message: "hello",
				context: {},
				package: "test",
			});
			expect(writeSpy).toHaveBeenCalledOnce();
			const output = writeSpy.mock.calls[0][0] as string;
			expect(output).toContain("hello");
			expect(output).toContain("INFO");
			writeSpy.mockRestore();
		});

		it("ConsoleTransport should write to stderr for error", () => {
			const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
			const ct = new ConsoleTransport({ colors: false });
			ct.write({
				timestamp: "2025-01-01T00:00:00.000Z",
				level: LogLevel.ERROR,
				levelName: "ERROR",
				message: "fail",
				context: {},
				package: "test",
			});
			expect(writeSpy).toHaveBeenCalledOnce();
			writeSpy.mockRestore();
		});

		it("JsonTransport should write valid JSON to stdout", () => {
			const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
			const jt = new JsonTransport();
			jt.write({
				timestamp: "2025-01-01T00:00:00.000Z",
				level: LogLevel.INFO,
				levelName: "INFO",
				message: "json test",
				context: { key: "value" },
				package: "test",
			});
			const output = writeSpy.mock.calls[0][0] as string;
			const parsed = JSON.parse(output.trim());
			expect(parsed.message).toBe("json test");
			expect(parsed.level).toBe("INFO");
			expect(parsed.context.key).toBe("value");
			writeSpy.mockRestore();
		});

		it("should dispatch to multiple transports", () => {
			const t1 = new TestTransport();
			const t2 = new TestTransport();
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [t1, t2] });
			logger.info("multi");
			expect(t1.entries).toHaveLength(1);
			expect(t2.entries).toHaveLength(1);
		});

		it("should survive transport errors without crashing", () => {
			const broken: LogTransport = {
				write() { throw new Error("transport failure"); },
			};
			const logger = new Logger("test", { level: LogLevel.DEBUG, transports: [broken, transport] });
			logger.info("should not crash");
			// The second transport should still receive the entry
			expect(transport.entries).toHaveLength(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════
	// Getters
	// ═══════════════════════════════════════════════════════════════════════

	describe("getters", () => {
		it("should return the logger name", () => {
			const logger = new Logger("my-name", { transports: [transport] });
			expect(logger.getName()).toBe("my-name");
		});

		it("should return the current level", () => {
			const logger = new Logger("test", { level: LogLevel.WARN, transports: [transport] });
			expect(logger.getLevel()).toBe(LogLevel.WARN);
		});
	});
});
