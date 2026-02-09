import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../src/keys.js", () => ({
	parseKeypress: vi.fn().mockReturnValue({
		name: "a",
		ctrl: false,
		meta: false,
		shift: false,
		sequence: "a",
	}),
}));

const mockStdin = Object.assign(new EventEmitter(), {
	isTTY: true,
	setRawMode: vi.fn().mockReturnThis(),
	resume: vi.fn(),
	pause: vi.fn(),
}) as any;

const mockStdout = {
	write: vi.fn(),
} as any;

describe("InputHandler", () => {
	let InputHandler: typeof import("../src/input.js").InputHandler;
	let parseKeypress: typeof import("../src/keys.js").parseKeypress;

	beforeEach(async () => {
		vi.clearAllMocks();

		vi.stubGlobal("process", {
			...process,
			stdin: mockStdin,
			stdout: mockStdout,
		});

		// Reset emitter listeners
		mockStdin.removeAllListeners();

		const inputModule = await import("../src/input.js");
		InputHandler = inputModule.InputHandler;

		const keysModule = await import("../src/keys.js");
		parseKeypress = keysModule.parseKeypress;

		mockStdin.setRawMode.mockClear();
		mockStdin.resume.mockClear();
		mockStdin.pause.mockClear();
		mockStdout.write.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("creates an instance", () => {
		const input = new InputHandler();
		expect(input).toBeDefined();
		expect(input.isRunning).toBe(false);
	});

	it("registers key handlers via onKey", () => {
		const input = new InputHandler();
		const handler = vi.fn();
		input.onKey(handler);
		expect(input).toBeDefined();
	});

	it("removes key handlers via offKey", () => {
		const input = new InputHandler();
		const handler = vi.fn();
		input.onKey(handler);
		input.offKey(handler);
		expect(input).toBeDefined();
	});

	it("registers line handlers via onLine", () => {
		const input = new InputHandler();
		const handler = vi.fn();
		input.onLine(handler);
		expect(input).toBeDefined();
	});

	it("removes line handlers via offLine", () => {
		const input = new InputHandler();
		const handler = vi.fn();
		input.onLine(handler);
		input.offLine(handler);
		expect(input).toBeDefined();
	});

	it("enables raw mode when starting on TTY", () => {
		const input = new InputHandler();
		input.start();

		expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
		expect(mockStdin.resume).toHaveBeenCalled();
		expect(input.isRunning).toBe(true);
	});

	it("writes bracketed paste enable sequence on start", () => {
		const input = new InputHandler();
		input.start();

		expect(mockStdout.write).toHaveBeenCalledWith("\x1b[?2004h");
	});

	it("registers data listener on stdin", () => {
		const input = new InputHandler();
		input.start();

		expect(mockStdin.listenerCount("data")).toBeGreaterThanOrEqual(1);
	});

	it("does not start twice", () => {
		const input = new InputHandler();
		input.start();
		input.start();

		expect(mockStdin.setRawMode).toHaveBeenCalledTimes(1);
	});

	it("disables raw mode when stopping", () => {
		const input = new InputHandler();
		input.start();
		input.stop();

		expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
		expect(mockStdin.pause).toHaveBeenCalled();
		expect(input.isRunning).toBe(false);
	});

	it("writes bracketed paste disable sequence on stop", () => {
		const input = new InputHandler();
		input.start();
		input.stop();

		expect(mockStdout.write).toHaveBeenCalledWith("\x1b[?2004l");
	});

	it("does not stop if not running", () => {
		const input = new InputHandler();
		input.stop();

		expect(mockStdout.write).not.toHaveBeenCalled();
	});

	it("returns false before start", () => {
		const input = new InputHandler();
		expect(input.isRunning).toBe(false);
	});

	it("returns true after start", () => {
		const input = new InputHandler();
		input.start();
		expect(input.isRunning).toBe(true);
	});

	it("returns false after stop", () => {
		const input = new InputHandler();
		input.start();
		input.stop();
		expect(input.isRunning).toBe(false);
	});

	it("clears all handlers via removeAllHandlers", () => {
		const input = new InputHandler();
		input.onKey(vi.fn());
		input.onKey(vi.fn());
		input.onLine(vi.fn());
		input.removeAllHandlers();
		expect(input).toBeDefined();
	});

	describe("handleData", () => {
		it("emits key events via handlers", () => {
			const handler = vi.fn();
			const input = new InputHandler();
			input.onKey(handler);
			input.start();

			mockStdin.emit("data", Buffer.from("a"));

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ name: "a" }),
			);
		});

		it("accumulates characters in line buffer and emits on return", () => {
			const lineHandler = vi.fn();
			const input = new InputHandler();
			input.onLine(lineHandler);
			input.start();

			vi.mocked(parseKeypress)
				.mockReturnValueOnce({ name: "h", ctrl: false, meta: false, shift: false, sequence: "h" })
				.mockReturnValueOnce({ name: "i", ctrl: false, meta: false, shift: false, sequence: "i" })
				.mockReturnValueOnce({ name: "return", ctrl: false, meta: false, shift: false, sequence: "\r" });

			mockStdin.emit("data", Buffer.from("h"));
			mockStdin.emit("data", Buffer.from("i"));
			mockStdin.emit("data", Buffer.from("\r"));

			expect(lineHandler).toHaveBeenCalledWith("hi");
		});

		it("handles backspace in line buffer", () => {
			const lineHandler = vi.fn();
			const input = new InputHandler();
			input.onLine(lineHandler);
			input.start();

			vi.mocked(parseKeypress)
				.mockReturnValueOnce({ name: "a", ctrl: false, meta: false, shift: false, sequence: "a" })
				.mockReturnValueOnce({ name: "b", ctrl: false, meta: false, shift: false, sequence: "b" })
				.mockReturnValueOnce({ name: "backspace", ctrl: false, meta: false, shift: false, sequence: "\x7f" })
				.mockReturnValueOnce({ name: "return", ctrl: false, meta: false, shift: false, sequence: "\r" });

			mockStdin.emit("data", Buffer.from("a"));
			mockStdin.emit("data", Buffer.from("b"));
			mockStdin.emit("data", Buffer.from("\x7f"));
			mockStdin.emit("data", Buffer.from("\r"));

			expect(lineHandler).toHaveBeenCalledWith("a");
		});
	});

	describe("paste detection", () => {
		it("detects complete paste in a single chunk", () => {
			const handler = vi.fn();
			const input = new InputHandler();
			input.onKey(handler);
			input.start();

			const pasteContent = "\x1b[200~pasted text\x1b[201~";
			mockStdin.emit("data", Buffer.from(pasteContent));

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ name: "paste", sequence: "pasted text" }),
			);
		});

		it("handles multi-chunk paste", () => {
			const handler = vi.fn();
			const input = new InputHandler();
			input.onKey(handler);
			input.start();

			mockStdin.emit("data", Buffer.from("\x1b[200~hello "));
			expect(handler).not.toHaveBeenCalled();

			mockStdin.emit("data", Buffer.from("world\x1b[201~"));
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ name: "paste", sequence: "hello world" }),
			);
		});
	});
});
