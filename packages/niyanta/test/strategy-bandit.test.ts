import { describe, it, expect } from "vitest";
import { StrategyBandit } from "../src/strategy-bandit.js";
import type { BanditContext, BanditMode, StrategyBanditState } from "../src/strategy-bandit.js";
import type { OrchestratorStrategy } from "../src/types.js";

// ─── UCB1 ───────────────────────────────────────────────────────────────────

describe("StrategyBandit — UCB1", () => {
	it("explores all strategies before exploiting", () => {
		const bandit = new StrategyBandit();
		bandit.setMode("ucb1");

		const seen = new Set<OrchestratorStrategy>();
		// UCB1 gives unplayed strategies infinite score, so all 6 should be tried first
		for (let i = 0; i < 6; i++) {
			const strategy = bandit.selectStrategy();
			seen.add(strategy);
			bandit.recordReward(strategy, 0.5);
		}
		expect(seen.size).toBe(6);
	});

	it("with enough plays, consistently selects the best strategy", () => {
		const bandit = new StrategyBandit();
		bandit.setMode("ucb1");

		// Give all strategies a play with mediocre rewards first
		const allStrategies: OrchestratorStrategy[] = [
			"round-robin", "least-loaded", "specialized",
			"hierarchical", "swarm", "competitive",
		];
		for (const s of allStrategies) {
			bandit.recordReward(s, 0.3);
		}

		// Now heavily reward "specialized"
		for (let i = 0; i < 50; i++) {
			bandit.recordReward("specialized", 0.95);
		}
		// Give poor rewards to others
		for (const s of allStrategies.filter((s) => s !== "specialized")) {
			for (let i = 0; i < 10; i++) {
				bandit.recordReward(s, 0.1);
			}
		}

		// After many plays, "specialized" should be selected
		const counts = new Map<OrchestratorStrategy, number>();
		for (let i = 0; i < 30; i++) {
			const selected = bandit.selectStrategy();
			counts.set(selected, (counts.get(selected) ?? 0) + 1);
			bandit.recordReward(selected, selected === "specialized" ? 0.95 : 0.1);
		}

		expect(counts.get("specialized") ?? 0).toBeGreaterThan(15);
	});
});

// ─── Thompson Sampling ──────────────────────────────────────────────────────

describe("StrategyBandit — Thompson Sampling", () => {
	it("converges to the best strategy over time", () => {
		const bandit = new StrategyBandit();
		bandit.setMode("thompson");

		const bestStrategy: OrchestratorStrategy = "hierarchical";
		const selectionCounts = new Map<OrchestratorStrategy, number>();

		for (let round = 0; round < 200; round++) {
			const selected = bandit.selectStrategy();
			selectionCounts.set(selected, (selectionCounts.get(selected) ?? 0) + 1);

			// "hierarchical" always gets reward 0.9, others get 0.2
			const reward = selected === bestStrategy ? 0.9 : 0.2;
			bandit.recordReward(selected, reward);
		}

		// Over 200 rounds, the best strategy should be selected most frequently
		const bestCount = selectionCounts.get(bestStrategy) ?? 0;
		for (const [strategy, count] of selectionCounts) {
			if (strategy !== bestStrategy) {
				expect(bestCount).toBeGreaterThan(count);
			}
		}
	});

	it("all strategies are explored at least once in early rounds", () => {
		const bandit = new StrategyBandit();
		bandit.setMode("thompson");

		const seen = new Set<OrchestratorStrategy>();
		// Run enough rounds that Thompson sampling should explore broadly
		for (let i = 0; i < 100; i++) {
			const s = bandit.selectStrategy();
			seen.add(s);
			bandit.recordReward(s, 0.5);
		}

		// With Beta(1,1) priors, all strategies should be tried within 100 rounds
		expect(seen.size).toBe(6);
	});
});

// ─── LinUCB ─────────────────────────────────────────────────────────────────

describe("StrategyBandit — LinUCB", () => {
	it("context features influence selection", () => {
		const bandit = new StrategyBandit();
		bandit.setMode("linucb");

		// Train: "specialized" does well for complex tasks, "round-robin" for simple
		for (let i = 0; i < 50; i++) {
			const complexCtx: BanditContext = {
				taskComplexity: 0.9,
				agentCount: 0.8,
				memoryPressure: 0.3,
				avgLatency: 0.4,
				errorRate: 0.1,
			};
			bandit.recordReward("specialized", 0.9, complexCtx);
			bandit.recordReward("round-robin", 0.2, complexCtx);

			const simpleCtx: BanditContext = {
				taskComplexity: 0.1,
				agentCount: 0.2,
				memoryPressure: 0.1,
				avgLatency: 0.2,
				errorRate: 0.05,
			};
			bandit.recordReward("round-robin", 0.9, simpleCtx);
			bandit.recordReward("specialized", 0.2, simpleCtx);
		}

		// Now test: complex context should prefer "specialized"
		const complexSelection = bandit.selectStrategy({
			taskComplexity: 0.9,
			agentCount: 0.8,
			memoryPressure: 0.3,
			avgLatency: 0.4,
			errorRate: 0.1,
		});

		// Simple context should prefer "round-robin"
		const simpleSelection = bandit.selectStrategy({
			taskComplexity: 0.1,
			agentCount: 0.2,
			memoryPressure: 0.1,
			avgLatency: 0.2,
			errorRate: 0.05,
		});

		// Due to training, these should be the preferred strategies
		expect(complexSelection).toBe("specialized");
		expect(simpleSelection).toBe("round-robin");
	});
});

// ─── Mode Switching ─────────────────────────────────────────────────────────

describe("StrategyBandit — mode switching", () => {
	it("can switch between UCB1, Thompson, and LinUCB", () => {
		const bandit = new StrategyBandit();

		bandit.setMode("ucb1");
		const s1 = bandit.selectStrategy();
		expect(typeof s1).toBe("string");

		bandit.setMode("thompson");
		const s2 = bandit.selectStrategy();
		expect(typeof s2).toBe("string");

		bandit.setMode("linucb");
		const s3 = bandit.selectStrategy();
		expect(typeof s3).toBe("string");
	});
});

// ─── Serialize / Deserialize ────────────────────────────────────────────────

describe("StrategyBandit — serialization", () => {
	it("state round-trips correctly", () => {
		const bandit = new StrategyBandit();
		bandit.setMode("thompson");

		// Build up some state
		for (let i = 0; i < 20; i++) {
			const s = bandit.selectStrategy();
			bandit.recordReward(s, Math.random());
		}

		const serialized = bandit.serialize();

		// Deserialize into a new instance
		const restored = new StrategyBandit();
		restored.deserialize(serialized);

		const restoredState = restored.serialize();

		expect(restoredState.mode).toBe(serialized.mode);
		expect(restoredState.totalPlays).toBe(serialized.totalPlays);
		expect(restoredState.explorationConstant).toBe(serialized.explorationConstant);
		expect(restoredState.linucbAlpha).toBe(serialized.linucbAlpha);

		for (let i = 0; i < serialized.strategies.length; i++) {
			const orig = serialized.strategies[i];
			const rest = restoredState.strategies[i];
			expect(rest.name).toBe(orig.name);
			expect(rest.plays).toBe(orig.plays);
			expect(rest.totalReward).toBeCloseTo(orig.totalReward, 10);
			expect(rest.alpha).toBeCloseTo(orig.alpha, 10);
			expect(rest.beta).toBeCloseTo(orig.beta, 10);
		}
	});

	it("getStats returns per-strategy statistics", () => {
		const bandit = new StrategyBandit();
		bandit.recordReward("swarm", 0.8);
		bandit.recordReward("swarm", 0.6);
		bandit.recordReward("competitive", 0.3);

		const stats = bandit.getStats();
		expect(stats.length).toBe(6); // All 6 strategies

		const swarmStats = stats.find((s) => s.name === "swarm")!;
		expect(swarmStats.plays).toBe(2);
		expect(swarmStats.totalReward).toBeCloseTo(1.4, 5);
		expect(swarmStats.averageReward).toBeCloseTo(0.7, 5);
	});
});
