/**
 * Lucy Bridge — Tests
 * Tests for the autonomous coding bridge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeLucy } from "../src/modes/lucy-bridge.js";
import type { LucyBridgeConfig, LucyEpisode, LucyTrace } from "../src/modes/lucy-bridge.js";

// Mock the coding router
vi.mock("../src/modes/coding-router.js", () => ({
	routeViaBridge: vi.fn(),
}));

import { routeViaBridge } from "../src/modes/coding-router.js";

const mockRouteViaBridge = vi.mocked(routeViaBridge);

beforeEach(() => {
	vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function createConfig(overrides?: Partial<LucyBridgeConfig>): LucyBridgeConfig {
	return {
		projectPath: "/test/project",
		maxAutoFixAttempts: 2,
		autoFixThreshold: 0.7,
		queryEpisodic: vi.fn().mockResolvedValue([]),
		queryAkasha: vi.fn().mockResolvedValue([]),
		recordEpisode: vi.fn().mockResolvedValue(undefined),
		depositAkasha: vi.fn().mockResolvedValue(undefined),
		onEvent: vi.fn(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Lucy Bridge", () => {
	describe("executeLucy", () => {
		it("executes a task successfully", async () => {
			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi (rpc)",
				output: "Task completed. All tests pass.",
				exitCode: 0,
				bridgeResult: {
					type: "result",
					filesModified: ["src/main.ts"],
					testsRun: { passed: 10, failed: 0, total: 10 },
					output: "Done",
					exitCode: 0,
				},
			});

			const config = createConfig();
			const result = await executeLucy("Fix the auth bug", config);

			expect(result.success).toBe(true);
			expect(result.filesModified).toEqual(["src/main.ts"]);
			expect(result.autoFixAttempts).toBe(0);
			expect(result.cli).toBe("takumi (rpc)");
		});

		it("queries episodic and akasha memory before execution", async () => {
			const queryEpisodic = vi.fn().mockResolvedValue(["past fix hint"]);
			const queryAkasha = vi.fn().mockResolvedValue(["arch decision"]);

			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "Done",
				exitCode: 0,
			});

			const config = createConfig({ queryEpisodic, queryAkasha });
			await executeLucy("Add auth", config);

			expect(queryEpisodic).toHaveBeenCalledWith("Add auth", "/test/project");
			expect(queryAkasha).toHaveBeenCalledWith("Add auth");
		});

		it("attempts auto-fix on test failures", async () => {
			// First call: test failure
			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "FAIL 3 tests\nTests: 3 failed, 7 passed",
				exitCode: 1,
			});

			// Second call (auto-fix): success
			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "All tests pass",
				exitCode: 0,
			});

			const config = createConfig();
			const result = await executeLucy("Add feature", config);

			expect(result.autoFixAttempts).toBe(1);
			expect(result.success).toBe(true);
			expect(mockRouteViaBridge).toHaveBeenCalledTimes(2);
		});

		it("respects maxAutoFixAttempts", async () => {
			// All calls fail
			mockRouteViaBridge.mockResolvedValue({
				cli: "takumi",
				output: "FAIL 3 tests\n5 failed",
				exitCode: 1,
			});

			const config = createConfig({ maxAutoFixAttempts: 2 });
			const result = await executeLucy("Broken task", config);

			expect(result.autoFixAttempts).toBe(2);
			expect(result.success).toBe(false);
			// 1 initial + 2 auto-fix = 3 total
			expect(mockRouteViaBridge).toHaveBeenCalledTimes(3);
		});

		it("skips auto-fix for crashes (exit code > 128)", async () => {
			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "FAIL 1 test\nSegmentation fault",
				exitCode: 139,
			});

			const config = createConfig();
			const result = await executeLucy("Crash task", config);

			expect(result.autoFixAttempts).toBe(0);
			expect(result.success).toBe(false);
		});

		it("records results in episodic memory and akasha", async () => {
			const recordEpisode = vi.fn().mockResolvedValue(undefined);
			const depositAkasha = vi.fn().mockResolvedValue(undefined);

			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "Done",
				exitCode: 0,
				bridgeResult: {
					type: "result",
					filesModified: ["a.ts"],
					output: "Done",
					exitCode: 0,
				},
			});

			const config = createConfig({ recordEpisode, depositAkasha });
			await executeLucy("Build feature", config);

			expect(recordEpisode).toHaveBeenCalledOnce();
			const episode = recordEpisode.mock.calls[0][0] as LucyEpisode;
			expect(episode.success).toBe(true);
			expect(episode.task).toBe("Build feature");

			expect(depositAkasha).toHaveBeenCalledOnce();
			const trace = depositAkasha.mock.calls[0][0] as LucyTrace;
			expect(trace.type).toBe("solution");
			expect(trace.topics).toContain("lucy-bridge");
		});

		it("deposits warning trace on failure", async () => {
			const depositAkasha = vi.fn().mockResolvedValue(undefined);

			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "none",
				output: "No CLI available",
				exitCode: 1,
			});

			const config = createConfig({ depositAkasha });
			await executeLucy("Impossible task", config);

			const trace = depositAkasha.mock.calls[0][0] as LucyTrace;
			expect(trace.type).toBe("warning");
		});

		it("handles memory query failures gracefully", async () => {
			const queryEpisodic = vi.fn().mockRejectedValue(new Error("DB down"));
			const queryAkasha = vi.fn().mockRejectedValue(new Error("Network err"));

			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "Done",
				exitCode: 0,
			});

			const config = createConfig({ queryEpisodic, queryAkasha });
			const result = await executeLucy("Resilient task", config);

			// Should still succeed even when memory is unavailable
			expect(result.success).toBe(true);
		});

		it("emits events for each phase", async () => {
			const onEvent = vi.fn();

			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "Done",
				exitCode: 0,
			});

			const config = createConfig({ onEvent });
			await executeLucy("Event task", config);

			const phases = onEvent.mock.calls.map(
				(c) => (c[0] as { phase: string }).phase,
			);
			expect(phases).toContain("context");
			expect(phases).toContain("execute");
			expect(phases).toContain("record");
			expect(phases).toContain("done");
		});

		it("extracts topic tags from task description", async () => {
			const depositAkasha = vi.fn().mockResolvedValue(undefined);

			mockRouteViaBridge.mockResolvedValueOnce({
				cli: "takumi",
				output: "Done",
				exitCode: 0,
			});

			const config = createConfig({ depositAkasha });
			await executeLucy("Fix typescript test for API auth", config);

			const trace = depositAkasha.mock.calls[0][0] as LucyTrace;
			expect(trace.topics).toContain("bugfix");
			expect(trace.topics).toContain("typescript");
			expect(trace.topics).toContain("testing");
			expect(trace.topics).toContain("api");
			expect(trace.topics).toContain("authentication");
		});
	});
});
