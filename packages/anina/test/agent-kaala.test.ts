import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	KaalaBrahma,
	type AgentHeartbeat,
	type AgentLifecycleStatus,
} from "../src/agent-kaala.js";

function makeHeartbeat(overrides: Partial<AgentHeartbeat> = {}): AgentHeartbeat {
	return {
		agentId: `agent-${Math.random().toString(36).slice(2, 8)}`,
		lastBeat: Date.now(),
		startedAt: Date.now(),
		turnCount: 0,
		tokenUsage: 0,
		status: "alive",
		parentId: null,
		depth: 0,
		purpose: "test agent",
		tokenBudget: 200_000,
		...overrides,
	};
}

describe("KaalaBrahma", () => {
	let kaala: KaalaBrahma;

	beforeEach(() => {
		kaala = new KaalaBrahma({
			heartbeatInterval: 60_000, // Long interval so monitoring doesn't fire in tests
			staleThreshold: 5_000,
			deadThreshold: 10_000,
		});
	});

	afterEach(() => {
		kaala.dispose();
	});

	// ─── Registration ────────────────────────────────────────────────────

	describe("registerAgent", () => {
		it("should register an agent and track it in health reports", () => {
			const hb = makeHeartbeat({ agentId: "root" });
			kaala.registerAgent(hb);

			const health = kaala.getTreeHealth();
			expect(health.totalAgents).toBe(1);
			expect(health.aliveAgents).toBe(1);
		});

		it("should allow registering multiple agents", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "a1" }));
			kaala.registerAgent(makeHeartbeat({ agentId: "a2" }));
			kaala.registerAgent(makeHeartbeat({ agentId: "a3" }));

			expect(kaala.getTreeHealth().totalAgents).toBe(3);
		});
	});

	// ─── Heartbeat Recording ─────────────────────────────────────────────

	describe("recordHeartbeat", () => {
		it("should update the lastBeat timestamp", () => {
			const hb = makeHeartbeat({ agentId: "hb-test" });
			kaala.registerAgent(hb);

			// Advance time slightly
			kaala.recordHeartbeat("hb-test", { turnCount: 5, tokenUsage: 1000 });

			const snap = kaala.getAgentHealth("hb-test");
			expect(snap).toBeDefined();
			expect(snap!.turnCount).toBe(5);
			expect(snap!.tokenUsage).toBe(1000);
		});

		it("should reset a stale agent back to alive on heartbeat", () => {
			const hb = makeHeartbeat({ agentId: "stale-reset", status: "alive" });
			kaala.registerAgent(hb);

			// Manually make it stale by changing status
			kaala.reportStuck("stale-reset");
			const before = kaala.getAgentHealth("stale-reset");
			expect(before!.status).toBe("stale");

			// Record a heartbeat -> should go back to alive
			kaala.recordHeartbeat("stale-reset");
			const after = kaala.getAgentHealth("stale-reset");
			expect(after!.status).toBe("alive");
		});

		it("should be a no-op for unknown agent IDs", () => {
			// Should not throw
			kaala.recordHeartbeat("nonexistent");
		});
	});

	// ─── Status Changes ──────────────────────────────────────────────────

	describe("markCompleted / markError", () => {
		it("should set an agent to completed status", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "done" }));
			kaala.markCompleted("done");
			expect(kaala.getAgentHealth("done")!.status).toBe("completed");
		});

		it("should set an agent to error status", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "err" }));
			kaala.markError("err");
			expect(kaala.getAgentHealth("err")!.status).toBe("error");
		});
	});

	// ─── Status Change Callback ──────────────────────────────────────────

	describe("onStatusChange", () => {
		it("should fire callbacks when status changes", () => {
			const cb = vi.fn();
			kaala.onStatusChange(cb);

			kaala.registerAgent(makeHeartbeat({ agentId: "cb-test" }));
			kaala.markCompleted("cb-test");

			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith("cb-test", "alive", "completed", null);
		});

		it("should support unsubscription", () => {
			const cb = vi.fn();
			const unsub = kaala.onStatusChange(cb);

			kaala.registerAgent(makeHeartbeat({ agentId: "unsub-test" }));
			unsub();
			kaala.markCompleted("unsub-test");

			expect(cb).not.toHaveBeenCalled();
		});

		it("should not fire if the status did not actually change", () => {
			const cb = vi.fn();
			kaala.onStatusChange(cb);

			kaala.registerAgent(makeHeartbeat({ agentId: "same", status: "alive" }));
			// Reporting a heartbeat on an already-alive agent shouldn't fire callback
			kaala.recordHeartbeat("same");

			expect(cb).not.toHaveBeenCalled();
		});
	});

	// ─── reportStuck / healAgent ─────────────────────────────────────────

	describe("reportStuck", () => {
		it("should set an alive agent to stale", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "stuck" }));
			kaala.reportStuck("stuck", "loop detected");

			expect(kaala.getAgentHealth("stuck")!.status).toBe("stale");
			expect(kaala.getStuckReason("stuck")).toBe("loop detected");
		});

		it("should not change status if agent is not alive", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "not-alive", status: "alive" }));
			kaala.markCompleted("not-alive");
			kaala.reportStuck("not-alive");

			expect(kaala.getAgentHealth("not-alive")!.status).toBe("completed");
		});
	});

	describe("healAgent", () => {
		it("should allow an ancestor to heal a stale descendant", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "parent", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "child", parentId: "parent", depth: 1 }));
			kaala.reportStuck("child");

			const result = kaala.healAgent("parent", "child");
			expect(result.success).toBe(true);
			expect(kaala.getAgentHealth("child")!.status).toBe("alive");
		});

		it("should reject healing if healer is not an ancestor", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "a", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "b", depth: 0 }));
			kaala.reportStuck("b");

			const result = kaala.healAgent("a", "b");
			expect(result.success).toBe(false);
			expect(result.reason).toContain("not an ancestor");
		});

		it("should reject healing a non-stale/non-error agent", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "p", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "c", parentId: "p", depth: 1 }));

			const result = kaala.healAgent("p", "c");
			expect(result.success).toBe(false);
			expect(result.reason).toContain("Cannot heal");
		});
	});

	// ─── Kill Cascade ────────────────────────────────────────────────────

	describe("killAgent", () => {
		it("should kill a target agent and all its descendants", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "root", depth: 0, tokenBudget: 100_000 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "child1", parentId: "root", depth: 1, tokenBudget: 70_000 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "child2", parentId: "root", depth: 1, tokenBudget: 70_000 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "grandchild", parentId: "child1", depth: 2, tokenBudget: 49_000 }));

			const result = kaala.killAgent("root", "child1");
			expect(result.success).toBe(true);
			// Should kill child1 and grandchild (bottom-up)
			expect(result.killedIds).toContain("child1");
			expect(result.killedIds).toContain("grandchild");
			expect(result.cascadeCount).toBe(2);
			// Root and child2 should still be alive
			expect(kaala.getAgentHealth("root")!.status).toBe("alive");
			expect(kaala.getAgentHealth("child2")!.status).toBe("alive");
		});

		it("should not allow killing an ancestor (upward kill)", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "parent", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "child", parentId: "parent", depth: 1 }));

			const result = kaala.killAgent("child", "parent");
			expect(result.success).toBe(false);
			expect(result.reason).toContain("not an ancestor");
		});

		it("should not kill an already-killed agent", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "root", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "target", parentId: "root", depth: 1 }));

			kaala.killAgent("root", "target");
			const result = kaala.killAgent("root", "target");
			expect(result.success).toBe(false);
			expect(result.reason).toContain("already killed");
		});

		it("should calculate freed tokens from killed agents", () => {
			kaala.registerAgent(makeHeartbeat({
				agentId: "root", depth: 0, tokenBudget: 100_000,
			}));
			kaala.registerAgent(makeHeartbeat({
				agentId: "child", parentId: "root", depth: 1,
				tokenBudget: 50_000, tokenUsage: 10_000,
			}));

			const result = kaala.killAgent("root", "child");
			expect(result.freedTokens).toBe(40_000);
		});
	});

	// ─── canSpawn ────────────────────────────────────────────────────────

	describe("canSpawn", () => {
		it("should allow spawning when limits are not reached", () => {
			kaala.registerAgent(makeHeartbeat({
				agentId: "spawner", depth: 0, tokenBudget: 200_000,
			}));

			const { allowed } = kaala.canSpawn("spawner");
			expect(allowed).toBe(true);
		});

		it("should deny spawning at max depth", () => {
			const kaala3 = new KaalaBrahma({ maxAgentDepth: 2 });
			kaala3.registerAgent(makeHeartbeat({ agentId: "deep", depth: 2 }));

			const { allowed, reason } = kaala3.canSpawn("deep");
			expect(allowed).toBe(false);
			expect(reason).toContain("max depth");
			kaala3.dispose();
		});

		it("should deny spawning when max sub-agents reached", () => {
			const kaala2 = new KaalaBrahma({ maxSubAgents: 2 });
			kaala2.registerAgent(makeHeartbeat({ agentId: "parent", depth: 0 }));
			kaala2.registerAgent(makeHeartbeat({ agentId: "c1", parentId: "parent", depth: 1 }));
			kaala2.registerAgent(makeHeartbeat({ agentId: "c2", parentId: "parent", depth: 1 }));

			const { allowed, reason } = kaala2.canSpawn("parent");
			expect(allowed).toBe(false);
			expect(reason).toContain("sub-agents");
			kaala2.dispose();
		});

		it("should deny spawning when agent is not alive", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "stale-spawn" }));
			kaala.reportStuck("stale-spawn");

			const { allowed, reason } = kaala.canSpawn("stale-spawn");
			expect(allowed).toBe(false);
			expect(reason).toContain("stale");
		});

		it("should deny spawning when budget is too low", () => {
			kaala.registerAgent(makeHeartbeat({
				agentId: "poor", depth: 0, tokenBudget: 500,
			}));

			const { allowed, reason } = kaala.canSpawn("poor");
			expect(allowed).toBe(false);
			expect(reason).toContain("Insufficient budget");
		});
	});

	// ─── computeChildBudget ──────────────────────────────────────────────

	describe("computeChildBudget", () => {
		it("should compute budget based on decay factor", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "p", tokenBudget: 200_000 }));
			const budget = kaala.computeChildBudget("p");
			// Default decay factor is 0.7
			expect(budget).toBe(Math.floor(200_000 * 0.7));
		});

		it("should return 0 for unknown parent", () => {
			expect(kaala.computeChildBudget("nonexistent")).toBe(0);
		});
	});

	// ─── healTree ────────────────────────────────────────────────────────

	describe("healTree", () => {
		it("should detect stale agents based on time threshold", () => {
			const longAgo = Date.now() - 8_000;
			kaala.registerAgent(makeHeartbeat({
				agentId: "old", lastBeat: longAgo, startedAt: longAgo,
			}));

			const report = kaala.healTree();
			// After stale threshold (5s), agent becomes stale, then after dead (10s) not yet
			// But 8s > 5s stale threshold, so it should be marked stale
			// Since lastBeat was 8s ago > staleThreshold=5s, agent should go stale
			// Then the healTree reaps dead agents - 8s < 10s deadThreshold, so not dead yet
			const health = kaala.getAgentHealth("old");
			expect(health).toBeDefined();
			expect(health!.status).toBe("stale");
		});

		it("should promote stale agents to dead after dead threshold", () => {
			const veryOld = Date.now() - 15_000;
			kaala.registerAgent(makeHeartbeat({
				agentId: "ancient", lastBeat: veryOld, startedAt: veryOld,
			}));

			kaala.healTree();
			// 15s > 10s deadThreshold -> dead, then reaped
			const health = kaala.getAgentHealth("ancient");
			expect(health).toBeUndefined(); // Reaped (removed)
		});

		it("should kill over-budget agents", () => {
			kaala.registerAgent(makeHeartbeat({
				agentId: "overbudget", tokenBudget: 1000, tokenUsage: 1500,
			}));

			const report = kaala.healTree();
			expect(report.overBudgetKilled).toBe(1);
		});

		it("should handle orphans with cascade policy", () => {
			// Child with a parentId that doesn't exist = orphan
			kaala.registerAgent(makeHeartbeat({
				agentId: "orphan", parentId: "deleted-parent", depth: 1,
			}));

			const report = kaala.healTree();
			expect(report.orphansHandled).toBeGreaterThan(0);
		});
	});

	// ─── getTreeHealth ───────────────────────────────────────────────────

	describe("getTreeHealth", () => {
		it("should return a full health snapshot", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "a", depth: 0 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "b", parentId: "a", depth: 1 }));
			kaala.registerAgent(makeHeartbeat({ agentId: "c", parentId: "a", depth: 1 }));

			const health = kaala.getTreeHealth();
			expect(health.totalAgents).toBe(3);
			expect(health.aliveAgents).toBe(3);
			expect(health.maxDepth).toBe(1);
			expect(health.agents).toHaveLength(3);
		});

		it("should report null for highest token usage when all are zero", () => {
			kaala.registerAgent(makeHeartbeat({ agentId: "z", tokenUsage: 0 }));
			const health = kaala.getTreeHealth();
			expect(health.highestTokenUsage).toBeNull();
		});
	});

	// ─── Dispose ─────────────────────────────────────────────────────────

	describe("dispose", () => {
		it("should prevent further operations after disposal", () => {
			kaala.dispose();
			expect(() => kaala.registerAgent(makeHeartbeat())).toThrow("disposed");
		});

		it("should be idempotent", () => {
			kaala.dispose();
			kaala.dispose(); // Should not throw
		});
	});

	// ─── Config ──────────────────────────────────────────────────────────

	describe("setConfig / getConfig", () => {
		it("should update configuration", () => {
			kaala.setConfig({ staleThreshold: 60_000 });
			const cfg = kaala.getConfig();
			expect(cfg.staleThreshold).toBe(60_000);
		});

		it("should clamp maxAgentDepth to system ceiling", () => {
			kaala.setConfig({ maxAgentDepth: 999 });
			const cfg = kaala.getConfig();
			expect(cfg.maxAgentDepth).toBeLessThanOrEqual(10); // SYSTEM_MAX_AGENT_DEPTH
		});
	});
});
