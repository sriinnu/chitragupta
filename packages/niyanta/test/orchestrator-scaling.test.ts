import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestratorTask, AgentSlot, TaskResult, FallbackConfig } from "../src/types.js";

const mockCompetitiveRace = vi.fn().mockReturnValue(["slot-a", "slot-b"]);
const mockHierarchicalDecompose = vi.fn();
const mockSwarmCoordinate = vi.fn().mockReturnValue({
	slotIds: ["slot-a", "slot-b"],
	context: { taskId: "t-1", contributions: new Map(), sharedNotes: [] },
});
const mockMergeSwarmResults = vi.fn().mockReturnValue({ success: true, output: "merged" });

vi.mock("../src/strategies.js", () => ({
	competitiveRace: (...args: unknown[]) => mockCompetitiveRace(...args),
	hierarchicalDecompose: (...args: unknown[]) => mockHierarchicalDecompose(...args),
	swarmCoordinate: (...args: unknown[]) => mockSwarmCoordinate(...args),
	mergeSwarmResults: (...args: unknown[]) => mockMergeSwarmResults(...args),
}));

import {
	checkAutoScale, processCompetitive, processSwarm, processHierarchical,
	cancelRaceSiblings, collectSwarmResult, handleTaskFailure, applyFallback,
	checkPlanCompletion, spawnAgent, freeAgent, buildSlotStats,
} from "../src/orchestrator-scaling.js";
import type { AgentInstance } from "../src/orchestrator-scaling.js";
import type { SwarmContext } from "../src/strategies.js";

function makeTask(o?: Partial<OrchestratorTask>): OrchestratorTask {
	return { id: "task-1", type: "prompt", description: "Do something", priority: "normal", dependencies: [], status: "pending", ...o };
}
function makeSlot(o?: Partial<AgentSlot>): AgentSlot {
	return { id: "slot-a", role: "coder", capabilities: ["code"], ...o };
}
function makeAgent(o?: Partial<AgentInstance>): AgentInstance {
	return { id: "agent-1", slotId: "slot-a", tasksCompleted: 0, status: "idle", ...o };
}
function makeResult(o?: Partial<TaskResult>): TaskResult {
	return { success: true, output: "done", ...o };
}

describe("orchestrator-scaling", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	// ─── checkAutoScale ──────────────────────────────────────────────────

	describe("checkAutoScale", () => {
		it("emits agent:overloaded when queue exceeds agent count", () => {
			const emitFn = vi.fn();
			checkAutoScale("slot-a", [makeSlot()], new Map([["slot-a", [makeTask(), makeTask()]]]), new Map([["slot-a", new Set(["a1"])]]), vi.fn(), emitFn);
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "agent:overloaded", agentSlot: "slot-a", queueDepth: 2 }));
		});

		it("spawns when autoScale enabled and under maxInstances", () => {
			const spawnFn = vi.fn();
			checkAutoScale("slot-a", [makeSlot({ autoScale: true, maxInstances: 3 })], new Map([["slot-a", [makeTask()]]]), new Map([["slot-a", new Set(["a1"])]]), spawnFn, vi.fn());
			expect(spawnFn).toHaveBeenCalledWith("slot-a");
		});

		it("does not spawn at maxInstances", () => {
			const spawnFn = vi.fn();
			checkAutoScale("slot-a", [makeSlot({ autoScale: true, maxInstances: 1 })], new Map([["slot-a", [makeTask()]]]), new Map([["slot-a", new Set(["a1"])]]), spawnFn, vi.fn());
			expect(spawnFn).not.toHaveBeenCalled();
		});

		it("does not spawn when autoScale is false", () => {
			const spawnFn = vi.fn();
			checkAutoScale("slot-a", [makeSlot({ autoScale: false })], new Map([["slot-a", [makeTask()]]]), new Map([["slot-a", new Set(["a1"])]]), spawnFn, vi.fn());
			expect(spawnFn).not.toHaveBeenCalled();
		});

		it("no-ops when slot not found", () => {
			const spawnFn = vi.fn(); const emitFn = vi.fn();
			checkAutoScale("nonexistent", [], new Map(), new Map(), spawnFn, emitFn);
			expect(spawnFn).not.toHaveBeenCalled();
			expect(emitFn).not.toHaveBeenCalled();
		});

		it("does not spawn when queue is empty", () => {
			const spawnFn = vi.fn();
			checkAutoScale("slot-a", [makeSlot({ autoScale: true, maxInstances: 5 })], new Map([["slot-a", []]]), new Map([["slot-a", new Set(["a1"])]]), spawnFn, vi.fn());
			expect(spawnFn).not.toHaveBeenCalled();
		});

		it("does not emit overloaded when queue not deeper than agents", () => {
			const emitFn = vi.fn();
			checkAutoScale("slot-a", [makeSlot()], new Map([["slot-a", [makeTask()]]]), new Map([["slot-a", new Set(["a1", "a2"])]]), vi.fn(), emitFn);
			expect(emitFn).not.toHaveBeenCalled();
		});
	});

	// ─── processCompetitive ──────────────────────────────────────────────

	describe("processCompetitive", () => {
		it("creates racer tasks for each race slot", () => {
			const tasks = new Map<string, OrchestratorTask>();
			processCompetitive(makeTask({ id: "t-1" }), [makeSlot({ id: "slot-a" }), makeSlot({ id: "slot-b" })], tasks, vi.fn());
			expect(tasks.has("t-1:race-slot-a")).toBe(true);
			expect(tasks.has("t-1:race-slot-b")).toBe(true);
		});

		it("racer tasks have raceParent metadata", () => {
			const tasks = new Map<string, OrchestratorTask>();
			processCompetitive(makeTask({ id: "t-1" }), [makeSlot({ id: "slot-a" })], tasks, vi.fn());
			expect(tasks.get("t-1:race-slot-a")!.metadata!.raceParent).toBe("t-1");
		});

		it("assigns each racer to its slot", () => {
			const assignFn = vi.fn();
			processCompetitive(makeTask({ id: "t-1" }), [makeSlot({ id: "slot-a" }), makeSlot({ id: "slot-b" })], new Map(), assignFn);
			expect(assignFn).toHaveBeenCalledTimes(2);
		});
	});

	// ─── processSwarm ────────────────────────────────────────────────────

	describe("processSwarm", () => {
		it("creates swarm tasks for each slot", () => {
			const tasks = new Map<string, OrchestratorTask>();
			processSwarm(makeTask({ id: "t-1" }), [makeSlot({ id: "slot-a" }), makeSlot({ id: "slot-b" })], undefined, tasks, new Map(), vi.fn());
			expect(tasks.has("t-1:swarm-slot-a")).toBe(true);
			expect(tasks.has("t-1:swarm-slot-b")).toBe(true);
		});

		it("swarm tasks have swarmParent metadata", () => {
			const tasks = new Map<string, OrchestratorTask>();
			processSwarm(makeTask({ id: "t-1" }), [makeSlot({ id: "slot-a" })], undefined, tasks, new Map(), vi.fn());
			expect(tasks.get("t-1:swarm-slot-a")!.metadata!.swarmParent).toBe("t-1");
		});

		it("stores SwarmContext", () => {
			const sc = new Map<string, SwarmContext>();
			processSwarm(makeTask({ id: "t-1" }), [makeSlot()], undefined, new Map(), sc, vi.fn());
			expect(sc.has("t-1")).toBe(true);
		});

		it("assigns each swarm task to its slot", () => {
			const assignFn = vi.fn();
			processSwarm(makeTask({ id: "t-1" }), [makeSlot({ id: "slot-a" }), makeSlot({ id: "slot-b" })], undefined, new Map(), new Map(), assignFn);
			expect(assignFn).toHaveBeenCalledTimes(2);
		});
	});

	// ─── processHierarchical ─────────────────────────────────────────────

	describe("processHierarchical", () => {
		it("assigns directly when decomposition returns same task", () => {
			mockHierarchicalDecompose.mockReturnValue([makeTask({ id: "t-1" })]);
			const assignFn = vi.fn();
			const routeFn = vi.fn().mockReturnValue("slot-a");
			processHierarchical(makeTask({ id: "t-1" }), new Map(), routeFn, assignFn, vi.fn());
			expect(assignFn).toHaveBeenCalledTimes(1);
			expect(routeFn).toHaveBeenCalledTimes(1);
		});

		it("enqueues subtasks when decomposition produces different tasks", () => {
			mockHierarchicalDecompose.mockReturnValue([
				makeTask({ id: "t-1:sub-1" }),
				makeTask({ id: "t-1:sub-2" }),
			]);
			const enqueueFn = vi.fn();
			const tasks = new Map<string, OrchestratorTask>();
			processHierarchical(makeTask({ id: "t-1" }), tasks, vi.fn(), vi.fn(), enqueueFn);
			expect(enqueueFn).toHaveBeenCalledTimes(2);
			expect(tasks.has("t-1:sub-1")).toBe(true);
			expect(tasks.has("t-1:sub-2")).toBe(true);
		});

		it("does not call routeFn or assignFn when subtasks produced", () => {
			mockHierarchicalDecompose.mockReturnValue([
				makeTask({ id: "t-1:sub-1" }),
			]);
			const assignFn = vi.fn();
			const routeFn = vi.fn();
			processHierarchical(makeTask({ id: "t-1" }), new Map(), routeFn, assignFn, vi.fn());
			expect(routeFn).not.toHaveBeenCalled();
			expect(assignFn).not.toHaveBeenCalled();
		});
	});

	// ─── cancelRaceSiblings ──────────────────────────────────────────────

	describe("cancelRaceSiblings", () => {
		it("cancels non-winner siblings with same raceParent", () => {
			const tasks = new Map<string, OrchestratorTask>([
				["t-1:race-a", makeTask({ id: "t-1:race-a", metadata: { raceParent: "t-1" } })],
				["t-1:race-b", makeTask({ id: "t-1:race-b", metadata: { raceParent: "t-1" } })],
				["t-1", makeTask({ id: "t-1" })],
			]);
			const cancelFn = vi.fn();
			cancelRaceSiblings("t-1:race-a", "t-1", tasks, new Map(), cancelFn);
			expect(cancelFn).toHaveBeenCalledWith("t-1:race-b");
			expect(cancelFn).not.toHaveBeenCalledWith("t-1:race-a");
		});

		it("propagates winner result to parent task", () => {
			const tasks = new Map<string, OrchestratorTask>([
				["t-1:race-a", makeTask({ id: "t-1:race-a", metadata: { raceParent: "t-1" } })],
				["t-1", makeTask({ id: "t-1" })],
			]);
			const results = new Map<string, TaskResult>([
				["t-1:race-a", makeResult({ output: "winner" })],
			]);
			cancelRaceSiblings("t-1:race-a", "t-1", tasks, results, vi.fn());
			expect(tasks.get("t-1")!.status).toBe("completed");
			expect(results.get("t-1")!.output).toBe("winner");
		});

		it("does not propagate if winner has no result", () => {
			const tasks = new Map<string, OrchestratorTask>([
				["t-1", makeTask({ id: "t-1" })],
			]);
			cancelRaceSiblings("t-1:race-a", "t-1", tasks, new Map(), vi.fn());
			expect(tasks.get("t-1")!.status).toBe("pending");
		});
	});

	// ─── collectSwarmResult ──────────────────────────────────────────────

	describe("collectSwarmResult", () => {
		it("adds contribution to swarm context", () => {
			const context: SwarmContext = { taskId: "t-1", contributions: new Map(), sharedNotes: [] };
			const swarmContexts = new Map([["t-1", context]]);
			const tasks = new Map<string, OrchestratorTask>([
				["t-1:swarm-a", makeTask({ id: "t-1:swarm-a", metadata: { swarmParent: "t-1" }, status: "completed" })],
			]);
			collectSwarmResult("t-1:swarm-a", "t-1", makeResult(), tasks, new Map(), swarmContexts);
			expect(context.contributions.has("t-1:swarm-a")).toBe(true);
		});

		it("merges and completes parent when all swarm tasks done", () => {
			const context: SwarmContext = { taskId: "t-1", contributions: new Map(), sharedNotes: [] };
			const swarmContexts = new Map([["t-1", context]]);
			const tasks = new Map<string, OrchestratorTask>([
				["t-1:swarm-a", makeTask({ id: "t-1:swarm-a", metadata: { swarmParent: "t-1" }, status: "completed" })],
				["t-1", makeTask({ id: "t-1" })],
			]);
			const results = new Map<string, TaskResult>();
			collectSwarmResult("t-1:swarm-a", "t-1", makeResult(), tasks, results, swarmContexts);
			expect(tasks.get("t-1")!.status).toBe("completed");
			expect(results.has("t-1")).toBe(true);
		});

		it("does not merge when some swarm tasks still pending", () => {
			const context: SwarmContext = { taskId: "t-1", contributions: new Map(), sharedNotes: [] };
			const swarmContexts = new Map([["t-1", context]]);
			const tasks = new Map<string, OrchestratorTask>([
				["t-1:swarm-a", makeTask({ id: "t-1:swarm-a", metadata: { swarmParent: "t-1" }, status: "completed" })],
				["t-1:swarm-b", makeTask({ id: "t-1:swarm-b", metadata: { swarmParent: "t-1" }, status: "pending" })],
				["t-1", makeTask({ id: "t-1" })],
			]);
			collectSwarmResult("t-1:swarm-a", "t-1", makeResult(), tasks, new Map(), swarmContexts);
			expect(tasks.get("t-1")!.status).toBe("pending");
		});

		it("no-ops if swarm context not found", () => {
			const tasks = new Map<string, OrchestratorTask>();
			collectSwarmResult("t-1:swarm-a", "t-1", makeResult(), tasks, new Map(), new Map());
			// Should not throw
		});

		it("marks parent as failed when merge returns success:false", () => {
			mockMergeSwarmResults.mockReturnValueOnce({ success: false, output: "fail" });
			const context: SwarmContext = { taskId: "t-1", contributions: new Map(), sharedNotes: [] };
			const swarmContexts = new Map([["t-1", context]]);
			const tasks = new Map<string, OrchestratorTask>([
				["t-1:swarm-a", makeTask({ id: "t-1:swarm-a", metadata: { swarmParent: "t-1" }, status: "completed" })],
				["t-1", makeTask({ id: "t-1" })],
			]);
			collectSwarmResult("t-1:swarm-a", "t-1", makeResult(), tasks, new Map(), swarmContexts);
			expect(tasks.get("t-1")!.status).toBe("failed");
		});
	});

	// ─── handleTaskFailure ───────────────────────────────────────────────

	describe("handleTaskFailure", () => {
		it("retries when attempts remaining", () => {
			vi.useFakeTimers();
			const tasks = new Map([["t-1", makeTask({ id: "t-1", maxRetries: 2 })]]);
			const retryCount = new Map<string, number>();
			const emitFn = vi.fn();
			const enqueueFn = vi.fn();

			const retried = handleTaskFailure("t-1", new Error("fail"), tasks, new Map(), retryCount, vi.fn(), enqueueFn, vi.fn(), emitFn, true);
			expect(retried).toBe(true);
			expect(retryCount.get("t-1")).toBe(1);
			expect(tasks.get("t-1")!.status).toBe("retrying");
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "task:retry", taskId: "t-1", attempt: 1 }));
			vi.useRealTimers();
		});

		it("marks task failed when retries exhausted", () => {
			const tasks = new Map([["t-1", makeTask({ id: "t-1", maxRetries: 1 })]]);
			const retryCount = new Map([["t-1", 1]]);
			const results = new Map<string, TaskResult>();
			const emitFn = vi.fn();

			const retried = handleTaskFailure("t-1", new Error("boom"), tasks, results, retryCount, vi.fn(), vi.fn(), vi.fn(), emitFn, true);
			expect(retried).toBe(false);
			expect(tasks.get("t-1")!.status).toBe("failed");
			expect(results.has("t-1")).toBe(true);
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "task:failed", taskId: "t-1" }));
		});

		it("returns false for unknown task", () => {
			const result = handleTaskFailure("nonexistent", new Error("x"), new Map(), new Map(), new Map(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), true);
			expect(result).toBe(false);
		});

		it("marks failed when maxRetries is 0 (default)", () => {
			const tasks = new Map([["t-1", makeTask({ id: "t-1" })]]);
			const results = new Map<string, TaskResult>();
			handleTaskFailure("t-1", new Error("fail"), tasks, results, new Map(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), true);
			expect(tasks.get("t-1")!.status).toBe("failed");
		});

		it("frees agent on permanent failure", () => {
			const tasks = new Map([["t-1", makeTask({ id: "t-1" })]]);
			const freeFn = vi.fn();
			handleTaskFailure("t-1", new Error("x"), tasks, new Map(), new Map(), freeFn, vi.fn(), vi.fn(), vi.fn(), true);
			expect(freeFn).toHaveBeenCalledWith("t-1");
		});

		it("uses exponential backoff capped at 30s", () => {
			vi.useFakeTimers();
			const tasks = new Map([["t-1", makeTask({ id: "t-1", maxRetries: 10 })]]);
			const retryCount = new Map([["t-1", 5]]);
			const enqueueFn = vi.fn();
			const processQueueFn = vi.fn();

			handleTaskFailure("t-1", new Error("x"), tasks, new Map(), retryCount, vi.fn(), enqueueFn, processQueueFn, vi.fn(), true);
			// backoff = min(1000 * 2^5, 30000) = 30000
			vi.advanceTimersByTime(29999);
			expect(enqueueFn).not.toHaveBeenCalled();
			vi.advanceTimersByTime(2);
			expect(enqueueFn).toHaveBeenCalled();
			vi.useRealTimers();
		});
	});

	// ─── applyFallback ───────────────────────────────────────────────────

	describe("applyFallback", () => {
		it("no-ops when no fallback config", () => {
			const emitFn = vi.fn();
			applyFallback(makeTask(), new Error("x"), undefined, new Map(), vi.fn(), emitFn);
			expect(emitFn).not.toHaveBeenCalled();
		});

		it("calls handler and enqueues retry task if returned", () => {
			const retryTask = makeTask({ id: "retry-1" });
			const handler = vi.fn().mockReturnValue(retryTask);
			const tasks = new Map<string, OrchestratorTask>();
			const enqueueFn = vi.fn();
			applyFallback(makeTask(), new Error("x"), { handler, escalateToHuman: false }, tasks, enqueueFn, vi.fn());
			expect(handler).toHaveBeenCalled();
			expect(tasks.has("retry-1")).toBe(true);
			expect(enqueueFn).toHaveBeenCalledWith(retryTask);
		});

		it("escalates to human when handler returns null", () => {
			const handler = vi.fn().mockReturnValue(null);
			const emitFn = vi.fn();
			applyFallback(makeTask({ id: "t-1" }), new Error("boom"), { handler, escalateToHuman: true }, new Map(), vi.fn(), emitFn);
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "escalation", taskId: "t-1" }));
		});

		it("escalates to human when no handler provided", () => {
			const emitFn = vi.fn();
			applyFallback(makeTask({ id: "t-1" }), new Error("boom"), { escalateToHuman: true }, new Map(), vi.fn(), emitFn);
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "escalation" }));
		});

		it("does not escalate when handler succeeds", () => {
			const handler = vi.fn().mockReturnValue(makeTask({ id: "retry-1" }));
			const emitFn = vi.fn();
			applyFallback(makeTask(), new Error("x"), { handler, escalateToHuman: true }, new Map(), vi.fn(), emitFn);
			expect(emitFn).not.toHaveBeenCalled();
		});
	});

	// ─── checkPlanCompletion ─────────────────────────────────────────────

	describe("checkPlanCompletion", () => {
		it("emits plan:complete when all top-level tasks done", () => {
			const tasks = new Map<string, OrchestratorTask>([
				["t-1", makeTask({ id: "t-1", status: "completed", result: makeResult() })],
				["t-2", makeTask({ id: "t-2", status: "failed", result: makeResult({ success: false }) })],
			]);
			const emitFn = vi.fn();
			checkPlanCompletion(tasks, "plan-1", emitFn);
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "plan:complete", planId: "plan-1" }));
		});

		it("ignores race and swarm sub-tasks", () => {
			const tasks = new Map<string, OrchestratorTask>([
				["t-1", makeTask({ id: "t-1", status: "completed", result: makeResult() })],
				["t-1:race-a", makeTask({ id: "t-1:race-a", metadata: { raceParent: "t-1" }, status: "pending" })],
				["t-1:swarm-a", makeTask({ id: "t-1:swarm-a", metadata: { swarmParent: "t-1" }, status: "pending" })],
			]);
			const emitFn = vi.fn();
			checkPlanCompletion(tasks, "plan-1", emitFn);
			expect(emitFn).toHaveBeenCalled();
		});

		it("does not emit when some tasks still pending", () => {
			const tasks = new Map<string, OrchestratorTask>([
				["t-1", makeTask({ id: "t-1", status: "completed" })],
				["t-2", makeTask({ id: "t-2", status: "pending" })],
			]);
			const emitFn = vi.fn();
			checkPlanCompletion(tasks, "plan-1", emitFn);
			expect(emitFn).not.toHaveBeenCalled();
		});

		it("does not emit for empty task map", () => {
			const emitFn = vi.fn();
			checkPlanCompletion(new Map(), "plan-1", emitFn);
			expect(emitFn).not.toHaveBeenCalled();
		});
	});

	// ─── spawnAgent ──────────────────────────────────────────────────────

	describe("spawnAgent", () => {
		it("adds agent to agents map", () => {
			const agents = new Map<string, AgentInstance>();
			const slotAgents = new Map<string, Set<string>>();
			spawnAgent("slot-a", agents, slotAgents, vi.fn());
			expect(agents.size).toBe(1);
			const agent = [...agents.values()][0];
			expect(agent.slotId).toBe("slot-a");
			expect(agent.status).toBe("idle");
		});

		it("adds agent ID to slot agents set", () => {
			const agents = new Map<string, AgentInstance>();
			const slotAgents = new Map<string, Set<string>>();
			spawnAgent("slot-a", agents, slotAgents, vi.fn());
			expect(slotAgents.get("slot-a")!.size).toBe(1);
		});

		it("emits agent:spawned event", () => {
			const emitFn = vi.fn();
			spawnAgent("slot-a", new Map(), new Map(), emitFn);
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "agent:spawned", agentSlot: "slot-a" }));
		});

		it("appends to existing slot agents", () => {
			const agents = new Map<string, AgentInstance>();
			const slotAgents = new Map([["slot-a", new Set(["existing-1"])]]);
			spawnAgent("slot-a", agents, slotAgents, vi.fn());
			expect(slotAgents.get("slot-a")!.size).toBe(2);
		});
	});

	// ─── freeAgent ───────────────────────────────────────────────────────

	describe("freeAgent", () => {
		it("frees agent and marks idle", () => {
			const agents = new Map([["a-1", makeAgent({ id: "a-1", currentTask: "t-1", status: "busy" })]]);
			const emitFn = vi.fn();
			freeAgent("t-1", agents, new Map(), new Map(), emitFn);
			expect(agents.get("a-1")!.status).toBe("idle");
			expect(agents.get("a-1")!.currentTask).toBeUndefined();
			expect(agents.get("a-1")!.tasksCompleted).toBe(1);
		});

		it("emits agent:idle event", () => {
			const agents = new Map([["a-1", makeAgent({ id: "a-1", currentTask: "t-1", status: "busy" })]]);
			const emitFn = vi.fn();
			freeAgent("t-1", agents, new Map(), new Map(), emitFn);
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "agent:idle" }));
		});

		it("picks up next queued task", () => {
			const nextTask = makeTask({ id: "t-2" });
			const agents = new Map([["a-1", makeAgent({ id: "a-1", slotId: "slot-a", currentTask: "t-1", status: "busy" })]]);
			const slotQueues = new Map([["slot-a", [nextTask]]]);
			const tasks = new Map<string, OrchestratorTask>();
			const emitFn = vi.fn();
			freeAgent("t-1", agents, slotQueues, tasks, emitFn);
			expect(agents.get("a-1")!.currentTask).toBe("t-2");
			expect(agents.get("a-1")!.status).toBe("busy");
			expect(tasks.get("t-2")!.status).toBe("running");
			expect(emitFn).toHaveBeenCalledWith(expect.objectContaining({ type: "task:assigned", taskId: "t-2" }));
		});

		it("no-ops when no agent matches task", () => {
			const agents = new Map([["a-1", makeAgent({ id: "a-1", currentTask: "other" })]]);
			freeAgent("t-1", agents, new Map(), new Map(), vi.fn());
			expect(agents.get("a-1")!.currentTask).toBe("other");
		});
	});

	// ─── buildSlotStats ──────────────────────────────────────────────────

	describe("buildSlotStats", () => {
		it("builds stats for all plan agents", () => {
			const agents = new Map([
				["a-1", makeAgent({ id: "a-1", slotId: "slot-a", status: "busy", tasksCompleted: 3 })],
				["a-2", makeAgent({ id: "a-2", slotId: "slot-a", status: "idle", tasksCompleted: 2 })],
			]);
			const slotAgents = new Map([["slot-a", new Set(["a-1", "a-2"])]]);
			const slotQueues = new Map([["slot-a", [makeTask()]]]);
			const stats = buildSlotStats([makeSlot({ id: "slot-a" })], agents, slotAgents, slotQueues);
			expect(stats.get("slot-a")).toEqual({
				slotId: "slot-a",
				runningTasks: 1,
				queuedTasks: 1,
				completedTasks: 5,
			});
		});

		it("returns zeros for empty slot", () => {
			const stats = buildSlotStats([makeSlot({ id: "slot-a" })], new Map(), new Map(), new Map());
			expect(stats.get("slot-a")).toEqual({
				slotId: "slot-a",
				runningTasks: 0,
				queuedTasks: 0,
				completedTasks: 0,
			});
		});

		it("handles multiple slots", () => {
			const agents = new Map([
				["a-1", makeAgent({ id: "a-1", slotId: "slot-a", status: "busy", tasksCompleted: 1 })],
				["b-1", makeAgent({ id: "b-1", slotId: "slot-b", status: "idle", tasksCompleted: 4 })],
			]);
			const slotAgents = new Map([
				["slot-a", new Set(["a-1"])],
				["slot-b", new Set(["b-1"])],
			]);
			const stats = buildSlotStats(
				[makeSlot({ id: "slot-a" }), makeSlot({ id: "slot-b" })],
				agents, slotAgents, new Map(),
			);
			expect(stats.size).toBe(2);
			expect(stats.get("slot-a")!.runningTasks).toBe(1);
			expect(stats.get("slot-b")!.runningTasks).toBe(0);
		});
	});
});
