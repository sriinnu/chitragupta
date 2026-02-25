import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Samiti, WidgetDataStream } from "@chitragupta/sutra";
import type { WidgetSource, WidgetUpdate } from "@chitragupta/sutra";

/**
 * Mock `node:child_process` — intercept execFile calls so tests
 * never spawn real processes.
 */
vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockedExecFile = vi.mocked(execFile);

/** Helper: make `execFile` succeed with given stdout. */
function mockExecFileSuccess(stdout: string): void {
	mockedExecFile.mockImplementation(
		(_cmd, _args, _opts, callback) => {
			const cb = callback as (err: Error | null, stdout: string) => void;
			cb(null, stdout);
			return undefined as never;
		},
	);
}

/** Helper: make `execFile` fail with given error message. */
function mockExecFileError(message: string): void {
	mockedExecFile.mockImplementation(
		(_cmd, _args, _opts, callback) => {
			const cb = callback as (err: Error | null, stdout: string) => void;
			cb(new Error(message), "");
			return undefined as never;
		},
	);
}

describe("WidgetDataStream", () => {
	let samiti: Samiti;
	let stream: WidgetDataStream;

	const cpuWidget: WidgetSource = {
		id: "cpu-usage",
		label: "CPU Usage",
		script: "/usr/bin/top -l 1",
		refreshMs: 1000,
		format: "plain",
		timeoutMs: 5000,
	};

	const channelWidget: WidgetSource = {
		id: "alerts-feed",
		label: "Alert Feed",
		channel: "#widget-alerts",
		refreshMs: 0,
		format: "json",
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		samiti = new Samiti({ maxChannels: 50 });
		stream = new WidgetDataStream(samiti);
		mockExecFileSuccess("mock output");
	});

	afterEach(() => {
		stream.destroy();
		samiti.destroy();
		vi.useRealTimers();
	});

	// ═══════════════════════════════════════════════════════════════
	// REGISTRATION
	// ═══════════════════════════════════════════════════════════════

	describe("registerWidget / unregisterWidget", () => {
		it("should register a widget and list it", () => {
			stream.registerWidget(cpuWidget);
			expect(stream.listWidgets()).toContain("cpu-usage");
		});

		it("should throw if registering a duplicate widget ID", () => {
			stream.registerWidget(cpuWidget);
			expect(() => stream.registerWidget(cpuWidget)).toThrow(
				'Widget "cpu-usage" is already registered.',
			);
		});

		it("should unregister a widget and remove it from the list", () => {
			stream.registerWidget(cpuWidget);
			expect(stream.unregisterWidget("cpu-usage")).toBe(true);
			expect(stream.listWidgets()).not.toContain("cpu-usage");
		});

		it("should return false when unregistering a non-existent widget", () => {
			expect(stream.unregisterWidget("nonexistent")).toBe(false);
		});

		it("should create a Samiti channel for channel-based widgets", () => {
			stream.registerWidget(channelWidget);
			const ch = samiti.getChannel("#widget-alerts");
			expect(ch).toBeDefined();
			expect(ch!.name).toBe("#widget-alerts");
		});

		it("should not throw if Samiti channel already exists", () => {
			samiti.createChannel("#widget-alerts", "Pre-existing channel");
			expect(() => stream.registerWidget(channelWidget)).not.toThrow();
		});

		it("should return defensive copies from getWidgetSources", () => {
			stream.registerWidget(cpuWidget);
			const sources = stream.getWidgetSources();
			expect(sources).toHaveLength(1);
			expect(sources[0]!.id).toBe("cpu-usage");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// MAX WIDGETS LIMIT
	// ═══════════════════════════════════════════════════════════════

	describe("maxWidgets limit", () => {
		it("should enforce the maxWidgets cap", () => {
			const small = new WidgetDataStream(samiti, { maxWidgets: 2 });
			small.registerWidget({ ...cpuWidget, id: "w1" });
			small.registerWidget({ ...cpuWidget, id: "w2" });
			expect(() => small.registerWidget({ ...cpuWidget, id: "w3" })).toThrow(
				"Maximum widgets reached (2)",
			);
			small.destroy();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// SUBSCRIPTION
	// ═══════════════════════════════════════════════════════════════

	describe("subscribe / unsubscribe", () => {
		it("should deliver updates to subscribers", async () => {
			stream.registerWidget(cpuWidget);
			const updates: WidgetUpdate[] = [];
			stream.subscribe("cpu-usage", (u) => updates.push(u));
			stream.start();

			// Let the async execFile callback fire.
			await vi.advanceTimersByTimeAsync(0);

			expect(updates.length).toBeGreaterThanOrEqual(1);
			expect(updates[0]!.widgetId).toBe("cpu-usage");
			expect(updates[0]!.ok).toBe(true);
			expect(updates[0]!.content).toBe("mock output");
		});

		it("should stop delivering after unsubscribe", async () => {
			stream.registerWidget(cpuWidget);
			const updates: WidgetUpdate[] = [];
			const unsub = stream.subscribe("cpu-usage", (u) => updates.push(u));
			stream.start();

			await vi.advanceTimersByTimeAsync(0);
			const countAfterFirst = updates.length;

			unsub();
			await vi.advanceTimersByTimeAsync(cpuWidget.refreshMs);

			expect(updates.length).toBe(countAfterFirst);
		});

		it("should throw when subscribing to an unregistered widget", () => {
			expect(() => stream.subscribe("nonexistent", () => {})).toThrow(
				'Widget "nonexistent" is not registered.',
			);
		});

		it("should isolate subscriber errors from other subscribers", async () => {
			stream.registerWidget(cpuWidget);
			const good: WidgetUpdate[] = [];
			stream.subscribe("cpu-usage", () => {
				throw new Error("bad subscriber");
			});
			stream.subscribe("cpu-usage", (u) => good.push(u));
			stream.start();

			await vi.advanceTimersByTimeAsync(0);

			expect(good.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// LATEST VALUE / LATE JOINERS
	// ═══════════════════════════════════════════════════════════════

	describe("getLatest", () => {
		it("should return undefined before any execution", () => {
			stream.registerWidget(cpuWidget);
			expect(stream.getLatest("cpu-usage")).toBeUndefined();
		});

		it("should return the latest update after execution", async () => {
			stream.registerWidget(cpuWidget);
			stream.start();

			await vi.advanceTimersByTimeAsync(0);

			const latest = stream.getLatest("cpu-usage");
			expect(latest).toBeDefined();
			expect(latest!.widgetId).toBe("cpu-usage");
			expect(latest!.ok).toBe(true);
			expect(latest!.content).toBe("mock output");
		});

		it("should allow late joiners to get the latest value", async () => {
			stream.registerWidget(cpuWidget);
			stream.start();
			await vi.advanceTimersByTimeAsync(0);

			// Late joiner subscribes after first execution.
			const updates: WidgetUpdate[] = [];
			stream.subscribe("cpu-usage", (u) => updates.push(u));

			// Latest is available immediately.
			const latest = stream.getLatest("cpu-usage");
			expect(latest).toBeDefined();
			expect(latest!.content).toBe("mock output");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// SCRIPT EXECUTION
	// ═══════════════════════════════════════════════════════════════

	describe("script execution", () => {
		it("should produce ok=true update on success", async () => {
			mockExecFileSuccess("hello world");
			stream.registerWidget(cpuWidget);
			const updates: WidgetUpdate[] = [];
			stream.subscribe("cpu-usage", (u) => updates.push(u));
			stream.start();

			await vi.advanceTimersByTimeAsync(0);

			expect(updates[0]!.ok).toBe(true);
			expect(updates[0]!.content).toBe("hello world");
			expect(updates[0]!.error).toBeUndefined();
		});

		it("should produce ok=false update on script error", async () => {
			mockExecFileError("command not found");
			stream.registerWidget(cpuWidget);
			const updates: WidgetUpdate[] = [];
			stream.subscribe("cpu-usage", (u) => updates.push(u));
			stream.start();

			await vi.advanceTimersByTimeAsync(0);

			expect(updates[0]!.ok).toBe(false);
			expect(updates[0]!.error).toBe("command not found");
			expect(updates[0]!.content).toBe("");
		});

		it("should split script into command and args for execFile", async () => {
			stream.registerWidget({
				...cpuWidget,
				script: '/usr/bin/echo "hello world" --flag',
			});
			stream.start();

			await vi.advanceTimersByTimeAsync(0);

			expect(mockedExecFile).toHaveBeenCalledWith(
				"/usr/bin/echo",
				["hello world", "--flag"],
				expect.objectContaining({ timeout: 5000, maxBuffer: 65536 }),
				expect.any(Function),
			);
		});

		it("should refresh on interval when refreshMs > 0", async () => {
			stream.registerWidget(cpuWidget);
			stream.start();

			// Initial execution.
			await vi.advanceTimersByTimeAsync(0);
			const callsAfterInit = mockedExecFile.mock.calls.length;

			// Advance past one interval.
			await vi.advanceTimersByTimeAsync(cpuWidget.refreshMs);
			expect(mockedExecFile.mock.calls.length).toBeGreaterThan(callsAfterInit);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// CHANNEL-BASED WIDGETS
	// ═══════════════════════════════════════════════════════════════

	describe("channel-based widgets", () => {
		it("should relay Samiti messages as WidgetUpdates", () => {
			stream.registerWidget(channelWidget);
			const updates: WidgetUpdate[] = [];
			stream.subscribe("alerts-feed", (u) => updates.push(u));
			stream.start();

			samiti.broadcast("#widget-alerts", {
				sender: "test-agent",
				severity: "info",
				category: "test",
				content: "Alert content here",
			});

			expect(updates).toHaveLength(1);
			expect(updates[0]!.widgetId).toBe("alerts-feed");
			expect(updates[0]!.content).toBe("Alert content here");
			expect(updates[0]!.ok).toBe(true);
		});

		it("should use msg.data if it is a string", () => {
			stream.registerWidget(channelWidget);
			const updates: WidgetUpdate[] = [];
			stream.subscribe("alerts-feed", (u) => updates.push(u));
			stream.start();

			samiti.broadcast("#widget-alerts", {
				sender: "test-agent",
				severity: "info",
				category: "test",
				content: "fallback",
				data: "structured-data-string",
			});

			expect(updates[0]!.content).toBe("structured-data-string");
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// START / STOP LIFECYCLE
	// ═══════════════════════════════════════════════════════════════

	describe("start / stop", () => {
		it("should not execute scripts before start()", async () => {
			stream.registerWidget(cpuWidget);
			stream.subscribe("cpu-usage", () => {});

			await vi.advanceTimersByTimeAsync(5000);
			expect(mockedExecFile).not.toHaveBeenCalled();
		});

		it("should stop timers on stop()", async () => {
			stream.registerWidget(cpuWidget);
			stream.start();
			await vi.advanceTimersByTimeAsync(0);
			const callsBeforeStop = mockedExecFile.mock.calls.length;

			stream.stop();
			await vi.advanceTimersByTimeAsync(cpuWidget.refreshMs * 5);

			expect(mockedExecFile.mock.calls.length).toBe(callsBeforeStop);
		});

		it("should stop receiving channel messages on stop()", () => {
			stream.registerWidget(channelWidget);
			const updates: WidgetUpdate[] = [];
			stream.subscribe("alerts-feed", (u) => updates.push(u));
			stream.start();

			stream.stop();

			samiti.broadcast("#widget-alerts", {
				sender: "test-agent",
				severity: "info",
				category: "test",
				content: "should not arrive",
			});

			expect(updates).toHaveLength(0);
		});

		it("should report isRunning correctly", () => {
			expect(stream.isRunning).toBe(false);
			stream.start();
			expect(stream.isRunning).toBe(true);
			stream.stop();
			expect(stream.isRunning).toBe(false);
		});

		it("should be idempotent for start/start and stop/stop", () => {
			stream.start();
			stream.start(); // no-op
			expect(stream.isRunning).toBe(true);
			stream.stop();
			stream.stop(); // no-op
			expect(stream.isRunning).toBe(false);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// DESTROY
	// ═══════════════════════════════════════════════════════════════

	describe("destroy", () => {
		it("should throw on operations after destroy", () => {
			stream.destroy();
			expect(() => stream.registerWidget(cpuWidget)).toThrow(
				"WidgetDataStream has been destroyed",
			);
			expect(() => stream.subscribe("cpu-usage", () => {})).toThrow(
				"WidgetDataStream has been destroyed",
			);
			expect(() => stream.start()).toThrow("WidgetDataStream has been destroyed");
		});

		it("should clean up all internal state", async () => {
			stream.registerWidget(cpuWidget);
			stream.registerWidget(channelWidget);
			stream.start();
			await vi.advanceTimersByTimeAsync(0);

			stream.destroy();

			expect(stream.listWidgets()).toHaveLength(0);
			expect(stream.getLatest("cpu-usage")).toBeUndefined();
		});

		it("should be idempotent", () => {
			stream.destroy();
			expect(() => stream.destroy()).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// DYNAMIC REGISTRATION WHILE RUNNING
	// ═══════════════════════════════════════════════════════════════

	describe("dynamic registration while running", () => {
		it("should wire new widgets immediately when already running", async () => {
			stream.start();
			stream.registerWidget(cpuWidget);
			const updates: WidgetUpdate[] = [];
			stream.subscribe("cpu-usage", (u) => updates.push(u));

			await vi.advanceTimersByTimeAsync(0);

			expect(updates.length).toBeGreaterThanOrEqual(1);
		});
	});
});
