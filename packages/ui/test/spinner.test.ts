/**
 * Tests for the Spinner component — animated terminal spinner with
 * start/stop/update/fail/warn lifecycle methods.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Spinner } from "../src/components/spinner.js";

describe("Spinner", () => {
	let writeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		writeSpy.mockRestore();
	});

	describe("construction", () => {
		it("creates with default options", () => {
			const spinner = new Spinner();
			expect(spinner.isRunning).toBe(false);
		});

		it("accepts custom interval", () => {
			const spinner = new Spinner({ interval: 200 });
			expect(spinner.isRunning).toBe(false);
		});
	});

	describe("start", () => {
		it("starts the spinner", () => {
			const spinner = new Spinner();
			spinner.start("Loading...");
			expect(spinner.isRunning).toBe(true);
			spinner.stop();
		});

		it("writes hide cursor on start", () => {
			const spinner = new Spinner();
			spinner.start();
			// hideCursor writes \x1b[?25l
			const allWrites = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
			expect(allWrites).toContain("\x1b[?25l");
			spinner.stop();
		});

		it("does not restart if already running", () => {
			const spinner = new Spinner();
			spinner.start("first");
			const callCount = writeSpy.mock.calls.length;
			spinner.start("second"); // should be ignored
			expect(writeSpy.mock.calls.length).toBe(callCount);
			spinner.stop();
		});

		it("draws initial frame immediately", () => {
			const spinner = new Spinner();
			spinner.start("msg");
			expect(writeSpy).toHaveBeenCalled();
			spinner.stop();
		});
	});

	describe("stop", () => {
		it("stops the spinner", () => {
			const spinner = new Spinner();
			spinner.start();
			spinner.stop();
			expect(spinner.isRunning).toBe(false);
		});

		it("writes show cursor on stop", () => {
			const spinner = new Spinner();
			spinner.start();
			spinner.stop();
			const allWrites = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
			expect(allWrites).toContain("\x1b[?25h");
		});

		it("displays final message with success symbol", () => {
			const spinner = new Spinner();
			spinner.start();
			spinner.stop("Done!");
			const allWrites = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
			expect(allWrites).toContain("Done!");
		});

		it("does nothing if not running", () => {
			const spinner = new Spinner();
			const callCount = writeSpy.mock.calls.length;
			spinner.stop();
			expect(writeSpy.mock.calls.length).toBe(callCount);
		});
	});

	describe("update", () => {
		it("updates message while running", () => {
			const spinner = new Spinner();
			spinner.start("initial");
			writeSpy.mockClear();
			spinner.update("updated");
			expect(writeSpy).toHaveBeenCalled();
			const output = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
			expect(output).toContain("updated");
			spinner.stop();
		});

		it("updates message silently when not running", () => {
			const spinner = new Spinner();
			spinner.update("new msg");
			// Should not write to stdout when not running
			expect(writeSpy).not.toHaveBeenCalled();
		});
	});

	describe("fail", () => {
		it("stops with error symbol and message", () => {
			const spinner = new Spinner();
			spinner.start();
			spinner.fail("Error occurred");
			expect(spinner.isRunning).toBe(false);
			const allWrites = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
			expect(allWrites).toContain("Error occurred");
		});

		it("does nothing if not running", () => {
			const spinner = new Spinner();
			const callCount = writeSpy.mock.calls.length;
			spinner.fail("msg");
			expect(writeSpy.mock.calls.length).toBe(callCount);
		});
	});

	describe("warn", () => {
		it("stops with warning symbol and message", () => {
			const spinner = new Spinner();
			spinner.start();
			spinner.warn("Careful!");
			expect(spinner.isRunning).toBe(false);
			const allWrites = writeSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
			expect(allWrites).toContain("Careful!");
		});

		it("does nothing if not running", () => {
			const spinner = new Spinner();
			const callCount = writeSpy.mock.calls.length;
			spinner.warn("msg");
			expect(writeSpy.mock.calls.length).toBe(callCount);
		});
	});

	describe("animation", () => {
		it("advances frames on interval", () => {
			const spinner = new Spinner({ interval: 80 });
			spinner.start("tick");
			writeSpy.mockClear();
			vi.advanceTimersByTime(80);
			expect(writeSpy).toHaveBeenCalled();
			spinner.stop();
		});

		it("cycles through spinner frames", () => {
			const spinner = new Spinner({ interval: 80 });
			spinner.start("cycling");
			// Advance through several frames
			for (let i = 0; i < 5; i++) {
				vi.advanceTimersByTime(80);
			}
			// Should have been called multiple times
			expect(writeSpy.mock.calls.length).toBeGreaterThan(5);
			spinner.stop();
		});
	});
});
