import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { watchTool } from "@chitragupta/yantra";
import type { ToolContext } from "@chitragupta/yantra";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockStat, mockReaddir, mockAccess, mockWatch } = vi.hoisted(() => ({
	mockStat: vi.fn(),
	mockReaddir: vi.fn(),
	mockAccess: vi.fn(),
	mockWatch: vi.fn(),
}));

vi.mock("node:fs", () => {
	const fakeWatcher = {
		on: vi.fn(),
		close: vi.fn(),
	};
	mockWatch.mockReturnValue(fakeWatcher);
	return {
		promises: {
			stat: mockStat,
			readdir: mockReaddir,
			access: mockAccess,
		},
		watch: mockWatch,
	};
});

const CTX: ToolContext = { sessionId: "test", workingDirectory: "/work" };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("watchTool", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ─── Definition ───────────────────────────────────────────────────

	describe("definition", () => {
		it("should have correct name", () => {
			expect(watchTool.definition.name).toBe("watch");
		});

		it("should have description", () => {
			expect(watchTool.definition.description).toContain("Watch files");
		});

		it("should have path, durationMs, and recursive properties", () => {
			const props = watchTool.definition.inputSchema.properties as Record<string, any>;
			expect(props.path).toBeDefined();
			expect(props.durationMs).toBeDefined();
			expect(props.recursive).toBeDefined();
		});

		it("should not require any properties", () => {
			expect(watchTool.definition.inputSchema.required).toEqual([]);
		});
	});

	// ─── Path validation ──────────────────────────────────────────────

	describe("path validation", () => {
		it("should error when path does not exist", async () => {
			mockStat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

			const resultPromise = watchTool.execute({ path: "/nonexistent" }, CTX);
			await vi.advanceTimersByTimeAsync(100);
			const result = await resultPromise;

			expect(result.isError).toBe(true);
			expect(result.content).toContain("Path not found");
		});

		it("should error on other stat errors", async () => {
			mockStat.mockRejectedValue(Object.assign(new Error("Permission denied"), { code: "EACCES" }));

			const resultPromise = watchTool.execute({ path: "/secret" }, CTX);
			await vi.advanceTimersByTimeAsync(100);
			const result = await resultPromise;

			expect(result.isError).toBe(true);
			expect(result.content).toContain("Permission denied");
		});
	});

	// ─── Watch behavior ───────────────────────────────────────────────

	describe("watch behavior", () => {
		it("should report no changes when nothing happens", async () => {
			mockStat.mockResolvedValue({ isDirectory: () => false });

			const resultPromise = watchTool.execute({ path: "/work/file.ts", durationMs: 200 }, CTX);

			// Advance past the duration
			await vi.advanceTimersByTimeAsync(300);
			const result = await resultPromise;

			expect(result.content).toContain("No changes detected");
			expect(result.metadata?.changeCount).toBe(0);
		});

		it("should detect file changes", async () => {
			mockStat.mockResolvedValue({ isDirectory: () => true });
			mockReaddir.mockResolvedValue([]);
			mockAccess.mockResolvedValue(undefined);

			let watchCallback: ((event: string, filename: string) => void) | undefined;
			mockWatch.mockImplementation((_path: string, _opts: any, cb: any) => {
				watchCallback = cb;
				return { on: vi.fn(), close: vi.fn() };
			});

			const resultPromise = watchTool.execute({ path: "/work", durationMs: 500 }, CTX);
			await vi.advanceTimersByTimeAsync(50);

			// Simulate a file change
			if (watchCallback) {
				watchCallback("change", "test.ts");
			}

			// Wait for debounce + duration
			await vi.advanceTimersByTimeAsync(600);
			const result = await resultPromise;

			expect(result.metadata?.changeCount).toBeGreaterThan(0);
		});

		it("should handle abort signal", async () => {
			const abortController = new AbortController();
			abortController.abort();

			mockStat.mockResolvedValue({ isDirectory: () => false });

			const ctxWithSignal: ToolContext = { ...CTX, signal: abortController.signal };
			const result = await watchTool.execute({ path: "/work/file.ts" }, ctxWithSignal);

			expect(result.content).toContain("Watch aborted");
			expect(result.metadata?.changeCount).toBe(0);
		});

		it("should handle watcher errors", async () => {
			mockStat.mockResolvedValue({ isDirectory: () => false });

			let errorCallback: ((err: Error) => void) | undefined;
			mockWatch.mockImplementation((_path: string, _opts: any, _cb: any) => {
				return {
					on: vi.fn((event: string, cb: any) => {
						if (event === "error") errorCallback = cb;
					}),
					close: vi.fn(),
				};
			});

			const resultPromise = watchTool.execute({ path: "/work/file.ts", durationMs: 500 }, CTX);
			await vi.advanceTimersByTimeAsync(50);

			// Trigger watcher error
			if (errorCallback) {
				errorCallback(new Error("watcher failed"));
			}

			const result = await resultPromise;
			expect(result.isError).toBe(true);
			expect(result.content).toContain("Watcher error");
		});

		it("should cap duration to MAX_WATCH_DURATION_MS", async () => {
			mockStat.mockResolvedValue({ isDirectory: () => false });

			const resultPromise = watchTool.execute({ path: "/work/f.ts", durationMs: 999_999 }, CTX);
			// Max is 30000, so advancing past that should resolve
			await vi.advanceTimersByTimeAsync(31_000);
			const result = await resultPromise;

			expect(result.metadata?.durationMs).toBe(30_000);
		});

		it("should use working directory as default path", async () => {
			mockStat.mockResolvedValue({ isDirectory: () => true });
			mockReaddir.mockResolvedValue([]);

			const resultPromise = watchTool.execute({}, CTX);
			await vi.advanceTimersByTimeAsync(6_000);
			const result = await resultPromise;

			// stat should be called with the working directory
			expect(mockStat).toHaveBeenCalledWith("/work");
		});

		it("should handle fs.watch throwing synchronously", async () => {
			mockStat.mockResolvedValue({ isDirectory: () => false });
			mockWatch.mockImplementation(() => { throw new Error("watch not supported"); });

			const resultPromise = watchTool.execute({ path: "/work/f.ts", durationMs: 100 }, CTX);
			await vi.advanceTimersByTimeAsync(200);
			const result = await resultPromise;

			expect(result.isError).toBe(true);
			expect(result.content).toContain("Error starting watcher");
		});
	});
});
