import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	unlink: vi.fn(),
	writeFile: vi.fn(),
}));

vi.mock("node:os", () => ({
	tmpdir: vi.fn().mockReturnValue("/tmp"),
}));

vi.mock("node:crypto", () => ({
	randomBytes: vi.fn().mockReturnValue({ toString: () => "abcdef01" }),
}));

const mockExecFile = vi.mocked(execFile);
const mockReadFile = vi.mocked(readFile);
const mockUnlink = vi.mocked(unlink);

function mockExecSuccess(stdout = "", stderr = "") {
	mockExecFile.mockImplementation(
		(_cmd: any, _args: any, _opts: any, callback: any) => {
			if (typeof _opts === "function") {
				callback = _opts;
			}
			callback(null, stdout, stderr);
			return {} as any;
		},
	);
}

function mockExecFailure(message = "Command failed") {
	mockExecFile.mockImplementation(
		(_cmd: any, _args: any, _opts: any, callback: any) => {
			if (typeof _opts === "function") {
				callback = _opts;
			}
			callback(new Error(message), "", "");
			return {} as any;
		},
	);
}

describe("screenshot", () => {
	let captureTerminal: typeof import("../src/screenshot.js").captureTerminal;
	let captureUrl: typeof import("../src/screenshot.js").captureUrl;
	let captureFile: typeof import("../src/screenshot.js").captureFile;

	const originalPlatform = process.platform;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();

		mockUnlink.mockResolvedValue(undefined);
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	async function loadModule() {
		const mod = await import("../src/screenshot.js");
		captureTerminal = mod.captureTerminal;
		captureUrl = mod.captureUrl;
		captureFile = mod.captureFile;
	}

	describe("captureTerminal on darwin", () => {
		beforeEach(async () => {
			Object.defineProperty(process, "platform", { value: "darwin" });
			await loadModule();
		});

		it("calls screencapture with correct flags", async () => {
			const pngBuffer = Buffer.from("PNG_DATA");
			mockExecSuccess();
			mockReadFile.mockResolvedValueOnce(pngBuffer as any);

			await captureTerminal();

			const firstCall = mockExecFile.mock.calls[0] as any[];
			expect(firstCall[0]).toBe("screencapture");
			expect(firstCall[1]).toContain("-x");
			expect(firstCall[1]).toContain("-t");
			expect(firstCall[1]).toContain("png");
		});

		it("returns buffer with screenshot data", async () => {
			const pngBuffer = Buffer.from("PNG_SCREENSHOT");
			mockExecSuccess();
			mockReadFile.mockResolvedValueOnce(pngBuffer as any);

			const result = await captureTerminal();
			expect(Buffer.isBuffer(result)).toBe(true);
			expect(result.toString()).toBe("PNG_SCREENSHOT");
		});

		it("cleans up temp file after capture", async () => {
			mockExecSuccess();
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureTerminal();

			expect(mockUnlink).toHaveBeenCalled();
		});

		it("cleans up temp file even on error", async () => {
			mockExecFailure("screencapture failed");

			await expect(captureTerminal()).rejects.toThrow();
			expect(mockUnlink).toHaveBeenCalled();
		});
	});

	describe("captureTerminal on linux", () => {
		beforeEach(async () => {
			Object.defineProperty(process, "platform", { value: "linux" });
			await loadModule();
		});

		it("throws when no screenshot tools found", async () => {
			mockExecFailure("not found");

			await expect(captureTerminal()).rejects.toThrow("No screenshot tool found");
		});

		it("uses first available tool", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/import", "");
					} else if (callCount === 2) {
						callback(null, "", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("screenshot") as any);

			const result = await captureTerminal();
			expect(Buffer.isBuffer(result)).toBe(true);
		});
	});

	describe("captureTerminal on unsupported platform", () => {
		it("throws on unsupported platform", async () => {
			Object.defineProperty(process, "platform", { value: "freebsd" });
			await loadModule();

			await expect(captureTerminal()).rejects.toThrow("not supported");
		});
	});

	describe("captureUrl", () => {
		beforeEach(async () => {
			Object.defineProperty(process, "platform", { value: "darwin" });
			await loadModule();
		});

		it("throws when no browser is found", async () => {
			mockExecFailure("not found");

			await expect(captureUrl("https://example.com")).rejects.toThrow(
				"No headless browser found",
			);
		});

		it("uses chromium with correct args when found", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/chromium", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("browser_screenshot") as any);

			const result = await captureUrl("https://example.com");

			expect(Buffer.isBuffer(result)).toBe(true);
			const chromeCall = mockExecFile.mock.calls[1] as any[];
			expect(chromeCall[0]).toBe("chromium");
			expect(chromeCall[1]).toContain("--headless=new");
			expect(chromeCall[1]).toContain("--no-sandbox");
			expect(chromeCall[1]).toContain("https://example.com");
		});

		it("passes --full-page-screenshot when fullPage option is set", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/chromium", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureUrl("https://example.com", { fullPage: true });

			const chromeCall = mockExecFile.mock.calls[1] as any[];
			expect(chromeCall[1]).toContain("--full-page-screenshot");
		});

		it("uses custom window size", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/chromium", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureUrl("https://example.com", { width: 1920, height: 1080 });

			const chromeCall = mockExecFile.mock.calls[1] as any[];
			expect(chromeCall[1]).toContain("--window-size=1920,1080");
		});

		it("defaults to 1280x720 viewport", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/chromium", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureUrl("https://example.com");

			const chromeCall = mockExecFile.mock.calls[1] as any[];
			expect(chromeCall[1]).toContain("--window-size=1280,720");
		});

		it("uses firefox when only firefox is available", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount <= 5) {
						callback(new Error("not found"), "", "");
					} else if (callCount === 6) {
						callback(null, "/usr/bin/firefox", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureUrl("https://example.com");

			const lastCall = mockExecFile.mock.calls[mockExecFile.mock.calls.length - 1] as any[];
			expect(lastCall[0]).toBe("firefox");
			expect(lastCall[1]).toContain("--headless");
		});

		it("cleans up temp file after capture", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/chromium", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureUrl("https://example.com");

			expect(mockUnlink).toHaveBeenCalled();
		});
	});

	describe("captureFile", () => {
		beforeEach(async () => {
			Object.defineProperty(process, "platform", { value: "darwin" });
			await loadModule();
		});

		it("converts path to file:// URL", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/chromium", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureFile("/home/user/page.html");

			const chromeCall = mockExecFile.mock.calls[1] as any[];
			const urlArg = chromeCall[1].find((a: string) => a.startsWith("file://"));
			expect(urlArg).toContain("file://");
			expect(urlArg).toContain("page.html");
		});

		it("passes options through to captureUrl", async () => {
			let callCount = 0;
			mockExecFile.mockImplementation(
				(_cmd: any, _args: any, _opts: any, callback: any) => {
					if (typeof _opts === "function") {
						callback = _opts;
					}
					callCount++;
					if (callCount === 1) {
						callback(null, "/usr/bin/chromium", "");
					} else {
						callback(null, "", "");
					}
					return {} as any;
				},
			);
			mockReadFile.mockResolvedValueOnce(Buffer.from("data") as any);

			await captureFile("/page.html", { width: 800, height: 600 });

			const chromeCall = mockExecFile.mock.calls[1] as any[];
			expect(chromeCall[1]).toContain("--window-size=800,600");
		});

		it("throws when no browser found", async () => {
			mockExecFailure("not found");

			await expect(captureFile("/page.html")).rejects.toThrow(
				"No headless browser found",
			);
		});
	});
});
