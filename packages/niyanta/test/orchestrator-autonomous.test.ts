import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSelectStrategy = vi.fn().mockReturnValue("round-robin");
const mockRecordReward = vi.fn();
const mockSetMode = vi.fn();
const mockGetStats = vi.fn().mockReturnValue({});
const mockSerialize = vi.fn().mockReturnValue({ mode: "thompson", arms: {} });
const mockDeserialize = vi.fn();

vi.mock("../src/strategy-bandit.js", () => ({
	StrategyBandit: class {
		selectStrategy = mockSelectStrategy;
		recordReward = mockRecordReward;
		setMode = mockSetMode;
		getStats = mockGetStats;
		serialize = mockSerialize;
		deserialize = mockDeserialize;
	},
}));

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn();
const mockMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
	writeFile: (...args: unknown[]) => mockWriteFile(...args),
	readFile: (...args: unknown[]) => mockReadFile(...args),
	mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

import { AutonomousOrchestrator } from "../src/orchestrator-autonomous.js";
import type { OrchestratorTask, OrchestratorStats, TaskResult } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides?: Partial<OrchestratorTask>): OrchestratorTask {
	return {
		id: "task-1",
		type: "prompt",
		description: "Implement a feature",
		priority: "normal",
		dependencies: [],
		status: "pending",
		...overrides,
	};
}

function makeStats(overrides?: Partial<OrchestratorStats>): OrchestratorStats {
	return {
		totalTasks: 10,
		pendingTasks: 2,
		runningTasks: 3,
		completedTasks: 5,
		failedTasks: 0,
		activeAgents: 4,
		totalCost: 1.0,
		totalTokens: 5000,
		averageLatency: 2000,
		throughput: 1.5,
		...overrides,
	};
}

function makeResult(overrides?: Partial<TaskResult>): TaskResult {
	return {
		success: true,
		output: "done",
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AutonomousOrchestrator", () => {
	let orch: AutonomousOrchestrator;

	beforeEach(() => {
		vi.clearAllMocks();
		orch = new AutonomousOrchestrator();
	});

	describe("constructor", () => {
		it("initializes with default config and thompson mode", () => {
			const _o = new AutonomousOrchestrator();
			expect(mockSetMode).toHaveBeenCalledWith("thompson");
		});

		it("accepts custom config overrides", () => {
			vi.clearAllMocks();
			const _o = new AutonomousOrchestrator({
				banditMode: "ucb1",
				successWeight: 0.6,
				speedWeight: 0.2,
				costWeight: 0.2,
			});
			expect(mockSetMode).toHaveBeenCalledWith("ucb1");
		});

		it("initializes performance tracker for all 6 strategies", () => {
			const strategies = [
				"round-robin", "least-loaded", "specialized",
				"hierarchical", "swarm", "competitive",
			] as const;
			for (const s of strategies) {
				expect(orch.getPerformanceHistory(s)).toEqual([]);
			}
		});
	});

	describe("computeReward", () => {
		it("computes full reward for a successful task", () => {
			const reward = orch.computeReward(true, 10000, 30000, 0.05, 0.10);
			const expected = 0.5 * 1.0 + 0.3 * (1 - 10000 / 30000) + 0.2 * (1 - 0.05 / 0.10);
			expect(reward).toBeCloseTo(expected, 6);
		});

		it("gives zero success component on failure", () => {
			const reward = orch.computeReward(false, 10000, 30000, 0.05, 0.10);
			const expected = 0.5 * 0 + 0.3 * (1 - 10000 / 30000) + 0.2 * (1 - 0.05 / 0.10);
			expect(reward).toBeCloseTo(expected, 6);
		});

		it("clamps reward to maximum of 1", () => {
			const reward = orch.computeReward(true, 0, 30000, 0, 0.10);
			expect(reward).toBeLessThanOrEqual(1);
			expect(reward).toBeGreaterThanOrEqual(0);
		});

		it("clamps reward to minimum of 0 when components are negative", () => {
			const reward = orch.computeReward(false, 100000, 10000, 1.0, 0.01);
			expect(reward).toBe(0);
		});

		it("gives zero speed bonus when expectedMs is zero", () => {
			const reward = orch.computeReward(true, 5000, 0, 0, 0.10);
			expect(reward).toBeCloseTo(0.5 + 0.0 + 0.2, 6);
		});

		it("gives zero cost bonus when budgetCost is zero", () => {
			const reward = orch.computeReward(true, 15000, 30000, 0.05, 0);
			expect(reward).toBeCloseTo(0.5 + 0.3 * 0.5, 6);
		});

		it("gives zero speed bonus when actual exceeds expected", () => {
			const reward = orch.computeReward(true, 60000, 30000, 0, 0.10);
			expect(reward).toBeCloseTo(0.5 + 0 + 0.2, 6);
		});

		it("respects custom weights from config", () => {
			const custom = new AutonomousOrchestrator({
				successWeight: 0.8,
				speedWeight: 0.1,
				costWeight: 0.1,
			});
			const reward = custom.computeReward(true, 15000, 30000, 0.05, 0.10);
			const expected = 0.8 * 1.0 + 0.1 * (1 - 15000 / 30000) + 0.1 * (1 - 0.05 / 0.10);
			expect(reward).toBeCloseTo(expected, 6);
		});

		it("returns 1.0 for perfect outcome", () => {
			const reward = orch.computeReward(true, 0, 30000, 0, 0.10);
			expect(reward).toBeCloseTo(1.0, 6);
		});
	});

	describe("estimateComplexity", () => {
		it("gives baseline complexity for minimal task", () => {
			const task = makeTask({ description: "", dependencies: [], priority: "normal" });
			const c = orch.estimateComplexity(task);
			const expected = 0.25 * 0 + 0.20 * 0 + 0.25 * 0.5 + 0.30 * 0.5;
			expect(c).toBeCloseTo(expected, 6);
		});

		it("increases with longer description", () => {
			const shortTask = makeTask({ description: "short" });
			const longTask = makeTask({ description: "x".repeat(500) });
			expect(orch.estimateComplexity(longTask)).toBeGreaterThan(orch.estimateComplexity(shortTask));
		});

		it("caps description length contribution at 500 chars", () => {
			const t1 = makeTask({ description: "x".repeat(500) });
			const t2 = makeTask({ description: "x".repeat(1000) });
			expect(orch.estimateComplexity(t1)).toBeCloseTo(orch.estimateComplexity(t2), 6);
		});

		it("increases with more dependencies", () => {
			const noDeps = makeTask({ dependencies: [] });
			const manyDeps = makeTask({ dependencies: ["a", "b", "c", "d", "e"] });
			expect(orch.estimateComplexity(manyDeps)).toBeGreaterThan(orch.estimateComplexity(noDeps));
		});

		it("caps dependency count contribution at 5", () => {
			const t1 = makeTask({ dependencies: ["a", "b", "c", "d", "e"] });
			const t2 = makeTask({ dependencies: ["a", "b", "c", "d", "e", "f", "g", "h"] });
			expect(orch.estimateComplexity(t1)).toBeCloseTo(orch.estimateComplexity(t2), 6);
		});

		it("assigns higher weight for critical priority", () => {
			const c = orch.estimateComplexity(makeTask({ description: "", priority: "critical" }));
			const n = orch.estimateComplexity(makeTask({ description: "", priority: "normal" }));
			expect(c).toBeGreaterThan(n);
		});

		it("assigns lower weight for background priority", () => {
			const bg = orch.estimateComplexity(makeTask({ description: "", priority: "background" }));
			const normal = orch.estimateComplexity(makeTask({ description: "", priority: "normal" }));
			expect(bg).toBeLessThan(normal);
		});

		it("maps high priority to 0.7", () => {
			const task = makeTask({ description: "", dependencies: [], priority: "high" });
			const c = orch.estimateComplexity(task);
			const expected = 0.25 * 0 + 0.20 * 0 + 0.25 * 0.7 + 0.30 * 0.5;
			expect(c).toBeCloseTo(expected, 6);
		});

		it("maps low priority to 0.3", () => {
			const task = makeTask({ description: "", dependencies: [], priority: "low" });
			const c = orch.estimateComplexity(task);
			const expected = 0.25 * 0 + 0.20 * 0 + 0.25 * 0.3 + 0.30 * 0.5;
			expect(c).toBeCloseTo(expected, 6);
		});

		it("detects keyword refactor giving higher complexity", () => {
			const task = makeTask({ description: "refactor the module", priority: "normal", dependencies: [] });
			const baseline = makeTask({ description: "do something plain", priority: "normal", dependencies: [] });
			expect(orch.estimateComplexity(task)).toBeGreaterThan(orch.estimateComplexity(baseline));
		});

		it("detects keyword lint giving lower complexity than refactor", () => {
			const lintTask = makeTask({ description: "lint the code", priority: "normal", dependencies: [] });
			const refactorTask = makeTask({ description: "refactor the code", priority: "normal", dependencies: [] });
			expect(orch.estimateComplexity(lintTask)).toBeLessThan(orch.estimateComplexity(refactorTask));
		});

		it("averages multiple keyword matches", () => {
			const task = makeTask({ description: "refactor and test", priority: "normal", dependencies: [] });
			const c = orch.estimateComplexity(task);
			expect(c).toBeGreaterThan(0.2);
			expect(c).toBeLessThan(0.8);
		});

		it("falls back to 0.5 keyword component when no keywords match", () => {
			const task = makeTask({ description: "hello world xyz", priority: "normal", dependencies: [] });
			const c = orch.estimateComplexity(task);
			expect(c).toBeGreaterThan(0);
			expect(c).toBeLessThanOrEqual(1);
		});

		it("always produces values in [0, 1]", () => {
			const tasks = [
				makeTask({ description: "x".repeat(1000), priority: "critical", dependencies: Array(10).fill("d") }),
				makeTask({ description: "", priority: "background", dependencies: [] }),
			];
			for (const t of tasks) {
				const c = orch.estimateComplexity(t);
				expect(c).toBeGreaterThanOrEqual(0);
				expect(c).toBeLessThanOrEqual(1);
			}
		});
	});

	describe("selectStrategy", () => {
		it("delegates to the bandit for selection", () => {
			mockSelectStrategy.mockReturnValue("specialized");
			const strategy = orch.selectStrategy(makeTask(), makeStats());
			expect(strategy).toBe("specialized");
			expect(mockSelectStrategy).toHaveBeenCalled();
		});

		it("falls back to round-robin when all strategies are banned", () => {
			const allStrategies = [
				"round-robin", "least-loaded", "specialized",
				"hierarchical", "swarm", "competitive",
			] as const;

			const orchBan = new AutonomousOrchestrator({
				banMinTasks: 2,
				banFailureThreshold: 0.3,
				banDurationMs: 60000,
			});

			for (const s of allStrategies) {
				for (let i = 0; i < 3; i++) {
					orchBan.recordOutcome(makeTask({ id: `${s}-${i}` }), makeResult({ success: false }), s);
				}
			}

			expect(orchBan.getActiveBans().length).toBe(6);
			const selected = orchBan.selectStrategy(makeTask(), makeStats());
			expect(selected).toBe("round-robin");
		});

		it("filters out banned strategies from bandit selection", () => {
			const orchBan = new AutonomousOrchestrator({
				banMinTasks: 2,
				banFailureThreshold: 0.3,
				banDurationMs: 60000,
			});
			for (let i = 0; i < 3; i++) {
				orchBan.recordOutcome(makeTask({ id: `fail-${i}` }), makeResult({ success: false }), "specialized");
			}
			expect(orchBan.getActiveBans().some((b) => b.strategy === "specialized")).toBe(true);

			mockSelectStrategy.mockReturnValue("specialized");
			const selected = orchBan.selectStrategy(makeTask(), makeStats());
			expect(selected).not.toBe("specialized");
		});

		it("returns bandit choice when it picks a non-banned strategy", () => {
			mockSelectStrategy.mockReturnValue("swarm");
			const selected = orch.selectStrategy(makeTask(), makeStats());
			expect(selected).toBe("swarm");
		});
	});

	describe("recordOutcome", () => {
		it("records reward with the bandit", () => {
			orch.recordOutcome(makeTask(), makeResult(), "round-robin");
			expect(mockRecordReward).toHaveBeenCalledWith("round-robin", expect.any(Number), expect.any(Object));
		});

		it("adds to performance history for the strategy", () => {
			orch.recordOutcome(makeTask(), makeResult(), "swarm");
			const history = orch.getPerformanceHistory("swarm");
			expect(history).toHaveLength(1);
			expect(history[0].strategy).toBe("swarm");
			expect(history[0].success).toBe(true);
		});

		it("computes duration from metrics when available", () => {
			const result = makeResult({
				metrics: { startTime: 1000, endTime: 5000, tokenUsage: 100, cost: 0.02, toolCalls: 3, retries: 0 },
			});
			orch.recordOutcome(makeTask(), result, "round-robin");
			const history = orch.getPerformanceHistory("round-robin");
			expect(history[0].durationMs).toBe(4000);
			expect(history[0].cost).toBe(0.02);
		});

		it("uses default duration when no metrics present", () => {
			orch.recordOutcome(makeTask(), makeResult(), "round-robin");
			const history = orch.getPerformanceHistory("round-robin");
			expect(history[0].durationMs).toBe(30000);
		});

		it("triggers auto-save at configured interval", async () => {
			const orchAutoSave = new AutonomousOrchestrator({ autoSaveInterval: 3, autoSavePath: "/tmp/test-state.json" });
			for (let i = 0; i < 3; i++) {
				orchAutoSave.recordOutcome(makeTask({ id: `t-${i}` }), makeResult(), "round-robin");
			}
			// saveState is fire-and-forget (async .catch()), flush microtasks
			await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled());
		});

		it("does not auto-save when interval is 0", () => {
			const orchNoSave = new AutonomousOrchestrator({ autoSaveInterval: 0 });
			for (let i = 0; i < 20; i++) {
				orchNoSave.recordOutcome(makeTask({ id: `t-${i}` }), makeResult(), "round-robin");
			}
			expect(mockWriteFile).not.toHaveBeenCalled();
		});

		it("does not auto-save without autoSavePath", () => {
			const orchNoPath = new AutonomousOrchestrator({ autoSaveInterval: 1, autoSavePath: "" });
			orchNoPath.recordOutcome(makeTask(), makeResult(), "round-robin");
			expect(mockWriteFile).not.toHaveBeenCalled();
		});
	});

	describe("strategy bans", () => {
		it("bans a strategy after enough failures exceed threshold", () => {
			const orchBan = new AutonomousOrchestrator({ banMinTasks: 5, banFailureThreshold: 0.5, banDurationMs: 60000 });
			for (let i = 0; i < 5; i++) {
				orchBan.recordOutcome(makeTask({ id: `f-${i}` }), makeResult({ success: false }), "swarm");
			}
			const bans = orchBan.getActiveBans();
			expect(bans).toHaveLength(1);
			expect(bans[0].strategy).toBe("swarm");
			expect(bans[0].failureRate).toBeGreaterThan(0.5);
		});

		it("does not ban if under banMinTasks", () => {
			const orchBan = new AutonomousOrchestrator({ banMinTasks: 10, banFailureThreshold: 0.5 });
			for (let i = 0; i < 9; i++) {
				orchBan.recordOutcome(makeTask({ id: `f-${i}` }), makeResult({ success: false }), "specialized");
			}
			expect(orchBan.getActiveBans()).toHaveLength(0);
		});

		it("does not ban if failure rate is at or below threshold", () => {
			const orchBan = new AutonomousOrchestrator({ banMinTasks: 4, banFailureThreshold: 0.5 });
			for (let i = 0; i < 2; i++) {
				orchBan.recordOutcome(makeTask({ id: `s-${i}` }), makeResult({ success: true }), "swarm");
			}
			for (let i = 0; i < 2; i++) {
				orchBan.recordOutcome(makeTask({ id: `f-${i}` }), makeResult({ success: false }), "swarm");
			}
			expect(orchBan.getActiveBans()).toHaveLength(0);
		});

		it("unbanStrategy removes a ban and returns true", () => {
			const orchBan = new AutonomousOrchestrator({ banMinTasks: 2, banFailureThreshold: 0.3, banDurationMs: 60000 });
			for (let i = 0; i < 3; i++) {
				orchBan.recordOutcome(makeTask({ id: `f-${i}` }), makeResult({ success: false }), "swarm");
			}
			expect(orchBan.getActiveBans()).toHaveLength(1);
			const removed = orchBan.unbanStrategy("swarm");
			expect(removed).toBe(true);
			expect(orchBan.getActiveBans()).toHaveLength(0);
		});

		it("unbanStrategy returns false for non-banned strategy", () => {
			expect(orch.unbanStrategy("round-robin")).toBe(false);
		});

		it("bans expire after banDurationMs", () => {
			vi.useFakeTimers();
			try {
				const orchBan = new AutonomousOrchestrator({ banMinTasks: 2, banFailureThreshold: 0.3, banDurationMs: 5000 });
				for (let i = 0; i < 3; i++) {
					orchBan.recordOutcome(makeTask({ id: `f-${i}` }), makeResult({ success: false }), "swarm");
				}
				expect(orchBan.getActiveBans()).toHaveLength(1);
				vi.advanceTimersByTime(6000);
				expect(orchBan.getActiveBans()).toHaveLength(0);
			} finally {
				vi.useRealTimers();
			}
		});

		it("ban includes reason with failure rate info", () => {
			const orchBan = new AutonomousOrchestrator({ banMinTasks: 2, banFailureThreshold: 0.3, banDurationMs: 60000 });
			for (let i = 0; i < 3; i++) {
				orchBan.recordOutcome(makeTask({ id: `f-${i}` }), makeResult({ success: false }), "swarm");
			}
			const bans = orchBan.getActiveBans();
			expect(bans[0].reason).toContain("Failure rate");
			expect(bans[0].reason).toContain("exceeds threshold");
		});
	});

	describe("performance history", () => {
		it("returns empty array for strategy with no records", () => {
			expect(orch.getPerformanceHistory("competitive")).toEqual([]);
		});

		it("accumulates multiple records per strategy", () => {
			for (let i = 0; i < 5; i++) {
				orch.recordOutcome(makeTask({ id: `t-${i}` }), makeResult(), "least-loaded");
			}
			expect(orch.getPerformanceHistory("least-loaded")).toHaveLength(5);
		});

		it("returns copies not references", () => {
			orch.recordOutcome(makeTask(), makeResult(), "round-robin");
			const h1 = orch.getPerformanceHistory("round-robin");
			const h2 = orch.getPerformanceHistory("round-robin");
			expect(h1).not.toBe(h2);
		});

		it("getBanditStats delegates to bandit.getStats", () => {
			orch.getBanditStats();
			expect(mockGetStats).toHaveBeenCalled();
		});
	});

	describe("persistence", () => {
		describe("saveState", () => {
			it("writes JSON to the specified path", async () => {
				await orch.saveState("/tmp/state.json");
				expect(mockMkdir).toHaveBeenCalledWith("/tmp", { recursive: true });
				expect(mockWriteFile).toHaveBeenCalledWith("/tmp/state.json", expect.any(String), "utf-8");
			});

			it("serializes bandit state performance and bans", async () => {
				orch.recordOutcome(makeTask(), makeResult(), "round-robin");
				await orch.saveState("/tmp/state.json");
				const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
				expect(written).toHaveProperty("banditState");
				expect(written).toHaveProperty("performanceHistory");
				expect(written).toHaveProperty("bans");
				expect(written).toHaveProperty("savedAt");
				expect(written.performanceHistory).toHaveLength(1);
			});

			it("creates parent directories recursively", async () => {
				await orch.saveState("/a/b/c/state.json");
				expect(mockMkdir).toHaveBeenCalledWith("/a/b/c", { recursive: true });
			});
		});

		describe("loadState", () => {
			it("restores bandit state from file", async () => {
				const state = { banditState: { mode: "thompson", arms: {} }, performanceHistory: [], bans: [], savedAt: Date.now() };
				mockReadFile.mockResolvedValue(JSON.stringify(state));
				await orch.loadState("/tmp/state.json");
				expect(mockDeserialize).toHaveBeenCalledWith(state.banditState);
			});

			it("restores performance history records", async () => {
				const record = { taskId: "t-1", strategy: "swarm", success: true, reward: 0.8, durationMs: 5000, cost: 0.01, expectedDurationMs: 30000, budgetCost: 0.10, recordedAt: Date.now() };
				const state = { banditState: { mode: "thompson", arms: {} }, performanceHistory: [record], bans: [], savedAt: Date.now() };
				mockReadFile.mockResolvedValue(JSON.stringify(state));
				await orch.loadState("/tmp/state.json");
				expect(orch.getPerformanceHistory("swarm")).toHaveLength(1);
				expect(orch.getPerformanceHistory("swarm")[0].taskId).toBe("t-1");
			});

			it("restores non-expired bans", async () => {
				const state = {
					banditState: { mode: "thompson", arms: {} },
					performanceHistory: [],
					bans: [{ strategy: "competitive", reason: "too many failures", bannedAt: Date.now(), expiresAt: Date.now() + 60000, failureRate: 0.8 }],
					savedAt: Date.now(),
				};
				mockReadFile.mockResolvedValue(JSON.stringify(state));
				await orch.loadState("/tmp/state.json");
				expect(orch.getActiveBans()).toHaveLength(1);
				expect(orch.getActiveBans()[0].strategy).toBe("competitive");
			});

			it("skips expired bans on load", async () => {
				const state = {
					banditState: { mode: "thompson", arms: {} },
					performanceHistory: [],
					bans: [{ strategy: "competitive", reason: "old failure", bannedAt: Date.now() - 120000, expiresAt: Date.now() - 60000, failureRate: 0.8 }],
					savedAt: Date.now() - 120000,
				};
				mockReadFile.mockResolvedValue(JSON.stringify(state));
				await orch.loadState("/tmp/state.json");
				expect(orch.getActiveBans()).toHaveLength(0);
			});

			it("handles missing file gracefully", async () => {
				mockReadFile.mockRejectedValue(new Error("ENOENT"));
				await expect(orch.loadState("/nonexistent.json")).resolves.toBeUndefined();
			});

			it("does not call deserialize if banditState is missing", async () => {
				const state = { performanceHistory: [], bans: [], savedAt: Date.now() };
				mockReadFile.mockResolvedValue(JSON.stringify(state));
				await expect(orch.loadState("/tmp/state.json")).resolves.toBeUndefined();
				expect(mockDeserialize).not.toHaveBeenCalled();
			});
		});
	});
});
