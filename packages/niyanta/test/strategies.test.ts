import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  roundRobinAssign,
  leastLoadedAssign,
  specializedAssign,
  hierarchicalDecompose,
  competitiveRace,
  swarmCoordinate,
  mergeSwarmResults,
} from "../src/strategies.js";
import type { SlotStats } from "../src/strategies.js";
import type { AgentSlot, OrchestratorTask, TaskResult } from "../src/types.js";

/** Helper: create a minimal task. */
function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: "task-1",
    type: "prompt",
    description: "Do something",
    priority: "normal",
    status: "pending",
    ...overrides,
  };
}

/** Helper: create an agent slot. */
function makeSlot(id: string, capabilities: string[] = []): AgentSlot {
  return {
    id,
    role: "worker",
    capabilities,
    maxConcurrent: 2,
  };
}

describe("strategies", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // roundRobin
  // ═══════════════════════════════════════════════════════════════════════

  describe("roundRobinAssign", () => {
    it("should distribute tasks equally across slots", () => {
      const slots = [makeSlot("a"), makeSlot("b"), makeSlot("c")];
      const counter = { value: 0 };

      const assignments: string[] = [];
      for (let i = 0; i < 6; i++) {
        assignments.push(roundRobinAssign(slots, makeTask(), counter));
      }

      expect(assignments).toEqual(["a", "b", "c", "a", "b", "c"]);
    });

    it("should cycle through all slots", () => {
      const slots = [makeSlot("x"), makeSlot("y")];
      const counter = { value: 0 };

      expect(roundRobinAssign(slots, makeTask(), counter)).toBe("x");
      expect(roundRobinAssign(slots, makeTask(), counter)).toBe("y");
      expect(roundRobinAssign(slots, makeTask(), counter)).toBe("x");
    });

    it("should throw when no slots are available", () => {
      const counter = { value: 0 };
      expect(() => roundRobinAssign([], makeTask(), counter)).toThrow("No slots available");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // leastLoaded
  // ═══════════════════════════════════════════════════════════════════════

  describe("leastLoadedAssign", () => {
    it("should pick the slot with fewest running tasks", () => {
      const slots = [makeSlot("busy"), makeSlot("idle"), makeSlot("medium")];
      const stats = new Map<string, SlotStats>([
        ["busy", { slotId: "busy", runningTasks: 5, queuedTasks: 0, completedTasks: 10 }],
        ["idle", { slotId: "idle", runningTasks: 0, queuedTasks: 0, completedTasks: 3 }],
        ["medium", { slotId: "medium", runningTasks: 2, queuedTasks: 1, completedTasks: 7 }],
      ]);

      expect(leastLoadedAssign(slots, stats)).toBe("idle");
    });

    it("should break ties by fewest queued tasks", () => {
      const slots = [makeSlot("a"), makeSlot("b")];
      const stats = new Map<string, SlotStats>([
        ["a", { slotId: "a", runningTasks: 1, queuedTasks: 5, completedTasks: 0 }],
        ["b", { slotId: "b", runningTasks: 1, queuedTasks: 2, completedTasks: 0 }],
      ]);

      expect(leastLoadedAssign(slots, stats)).toBe("b");
    });

    it("should default to zero for unknown slots", () => {
      const slots = [makeSlot("new")];
      const stats = new Map<string, SlotStats>();

      // No stats for "new" -> defaults to 0 running, 0 queued
      expect(leastLoadedAssign(slots, stats)).toBe("new");
    });

    it("should throw when no slots are available", () => {
      expect(() => leastLoadedAssign([], new Map())).toThrow("No slots available");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // specialized
  // ═══════════════════════════════════════════════════════════════════════

  describe("specializedAssign", () => {
    it("should match a task to the slot with best capability overlap", () => {
      const slots = [
        makeSlot("writer", ["code-writing", "typescript"]),
        makeSlot("tester", ["testing", "assertions", "mocking"]),
        makeSlot("reviewer", ["code-review", "analysis"]),
      ];

      // Task about testing should match tester
      const task = makeTask({ description: "Run test specs for the auth module" });
      expect(specializedAssign(slots, task)).toBe("tester");
    });

    it("should match a refactoring task to the appropriate slot", () => {
      const slots = [
        makeSlot("coder", ["code-writing", "implementation"]),
        makeSlot("refactorer", ["refactoring", "code-writing"]),
      ];

      const task = makeTask({ description: "Refactor the database layer" });
      expect(specializedAssign(slots, task)).toBe("refactorer");
    });

    it("should fall back to first slot when no capabilities match", () => {
      const slots = [
        makeSlot("first", ["dancing"]),
        makeSlot("second", ["cooking"]),
      ];

      // No capability keywords in the description
      const task = makeTask({ description: "Something completely unrelated" });
      expect(specializedAssign(slots, task)).toBe("first");
    });

    it("should throw when no slots are available", () => {
      expect(() => specializedAssign([], makeTask())).toThrow("No slots available");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // hierarchical
  // ═══════════════════════════════════════════════════════════════════════

  describe("hierarchicalDecompose", () => {
    it("should split on 'then' for sequential tasks", () => {
      const task = makeTask({
        description: "Analyze the code then refactor it",
      });
      const subtasks = hierarchicalDecompose(task, 1);

      expect(subtasks.length).toBe(2);
      expect(subtasks[0].description).toBe("Analyze the code");
      expect(subtasks[1].description).toBe("refactor it");
    });

    it("should split on 'and' for parallel tasks within a step", () => {
      const task = makeTask({
        description: "Write tests and write documentation",
      });
      const subtasks = hierarchicalDecompose(task, 1);

      expect(subtasks.length).toBe(2);
      expect(subtasks[0].description).toBe("Write tests");
      expect(subtasks[1].description).toBe("write documentation");
    });

    it("should handle combined sequential and parallel splits", () => {
      const task = makeTask({
        description: "Analyze the codebase and check dependencies then implement the fix",
      });
      const subtasks = hierarchicalDecompose(task, 1);

      // Step 1: "Analyze the codebase" and "check dependencies" (2 parallel)
      // Step 2: "implement the fix" (1 sequential)
      expect(subtasks.length).toBe(3);
    });

    it("should return the original task when depth is 0", () => {
      const task = makeTask({ description: "Analyze then fix" });
      const result = hierarchicalDecompose(task, 0);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(task.id);
    });

    it("should return the original task when no decomposition markers exist", () => {
      const task = makeTask({ description: "Simple task with nothing to split" });
      const result = hierarchicalDecompose(task, 1);
      expect(result).toHaveLength(1);
    });

    it("should infer task types for subtasks", () => {
      const task = makeTask({
        description: "Write the tests then review the implementation",
      });
      const subtasks = hierarchicalDecompose(task, 1);

      expect(subtasks[0].type).toBe("test");
      expect(subtasks[1].type).toBe("review");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // competitive
  // ═══════════════════════════════════════════════════════════════════════

  describe("competitiveRace", () => {
    it("should return slot IDs for racing agents", () => {
      const slots = [makeSlot("a"), makeSlot("b"), makeSlot("c")];
      const racers = competitiveRace(slots, makeTask());

      expect(racers).toHaveLength(2); // Default count = 2
      expect(racers).toEqual(["a", "b"]);
    });

    it("should respect the count parameter", () => {
      const slots = [makeSlot("a"), makeSlot("b"), makeSlot("c")];
      const racers = competitiveRace(slots, makeTask(), 3);

      expect(racers).toHaveLength(3);
      expect(racers).toEqual(["a", "b", "c"]);
    });

    it("should cap at available slots", () => {
      const slots = [makeSlot("only")];
      const racers = competitiveRace(slots, makeTask(), 5);
      expect(racers).toHaveLength(1);
    });

    it("should throw when no slots are available", () => {
      expect(() => competitiveRace([], makeTask())).toThrow("No slots available");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // swarm
  // ═══════════════════════════════════════════════════════════════════════

  describe("swarmCoordinate", () => {
    it("should return all slot IDs and initialize shared context", () => {
      const slots = [makeSlot("a"), makeSlot("b"), makeSlot("c")];
      const task = makeTask({ id: "swarm-task" });

      const { slotIds, context } = swarmCoordinate(slots, task, true);

      expect(slotIds).toEqual(["a", "b", "c"]);
      expect(context.taskId).toBe("swarm-task");
      expect(context.contributions.size).toBe(0);
      expect(context.sharedNotes).toEqual([]);
    });

    it("should throw when no slots are available", () => {
      expect(() => swarmCoordinate([], makeTask())).toThrow("No slots available");
    });
  });

  describe("mergeSwarmResults", () => {
    it("should merge successful results", () => {
      const results: TaskResult[] = [
        { success: true, output: "Part A" },
        { success: true, output: "Part B" },
      ];

      const merged = mergeSwarmResults(results);
      expect(merged.success).toBe(true);
      expect(merged.output).toContain("Part A");
      expect(merged.output).toContain("Part B");
    });

    it("should merge artifacts and deduplicate", () => {
      const results: TaskResult[] = [
        { success: true, output: "A", artifacts: ["file1.ts", "file2.ts"] },
        { success: true, output: "B", artifacts: ["file2.ts", "file3.ts"] },
      ];

      const merged = mergeSwarmResults(results);
      expect(merged.artifacts).toContain("file1.ts");
      expect(merged.artifacts).toContain("file2.ts");
      expect(merged.artifacts).toContain("file3.ts");
      // file2.ts should appear only once
      expect(merged.artifacts!.filter((a) => a === "file2.ts")).toHaveLength(1);
    });

    it("should return failure when all results fail", () => {
      const results: TaskResult[] = [
        { success: false, output: "", error: "Crash 1" },
        { success: false, output: "", error: "Crash 2" },
      ];

      const merged = mergeSwarmResults(results);
      expect(merged.success).toBe(false);
      expect(merged.output).toBe("All swarm agents failed");
      expect(merged.error).toContain("Crash 1");
      expect(merged.error).toContain("Crash 2");
    });

    it("should aggregate metrics from successful results", () => {
      const results: TaskResult[] = [
        {
          success: true,
          output: "A",
          metrics: { startTime: 100, endTime: 200, tokenUsage: 50, cost: 0.01, toolCalls: 2, retries: 0 },
        },
        {
          success: true,
          output: "B",
          metrics: { startTime: 150, endTime: 300, tokenUsage: 80, cost: 0.02, toolCalls: 3, retries: 1 },
        },
      ];

      const merged = mergeSwarmResults(results);
      expect(merged.metrics).toBeDefined();
      expect(merged.metrics!.startTime).toBe(100);
      expect(merged.metrics!.endTime).toBe(300);
      expect(merged.metrics!.tokenUsage).toBe(130);
      expect(merged.metrics!.cost).toBe(0.03);
      expect(merged.metrics!.toolCalls).toBe(5);
      expect(merged.metrics!.retries).toBe(1);
    });
  });
});
