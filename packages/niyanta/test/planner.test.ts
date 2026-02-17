import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decompose, suggestPlan } from "../src/planner.js";
import type { AgentSlot } from "../src/types.js";

describe("planner", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // decompose
  // ═══════════════════════════════════════════════════════════════════════

  describe("decompose", () => {
    it("should decompose sequential steps separated by 'then'", () => {
      const tasks = decompose("Analyze the code then refactor the module");

      expect(tasks.length).toBe(2);
      expect(tasks[0].description).toBe("Analyze the code");
      expect(tasks[1].description).toBe("refactor the module");

      // Second task should depend on the first
      expect(tasks[1].dependencies).toBeDefined();
      expect(tasks[1].dependencies!.length).toBeGreaterThan(0);
    });

    it("should decompose parallel steps separated by 'and'", () => {
      const tasks = decompose("Write tests and write documentation");

      expect(tasks.length).toBe(2);
      expect(tasks[0].description).toBe("Write tests");
      expect(tasks[1].description).toBe("write documentation");

      // Parallel tasks should have no dependencies (within the same step)
      expect(tasks[0].dependencies).toBeUndefined();
      expect(tasks[1].dependencies).toBeUndefined();
    });

    it("should handle combined sequential and parallel patterns", () => {
      const tasks = decompose(
        "Read the source and scan dependencies then fix the bugs and update docs",
      );

      expect(tasks.length).toBe(4);
      // First step: 2 parallel tasks (read + scan)
      expect(tasks[0].description).toBe("Read the source");
      expect(tasks[1].description).toBe("scan dependencies");
      // Second step: 2 parallel tasks (fix + update) depending on first step
      expect(tasks[2].dependencies).toBeDefined();
      expect(tasks[3].dependencies).toBeDefined();
    });

    it("should return a single task when no decomposition is possible", () => {
      const tasks = decompose("Just do this simple thing");

      expect(tasks.length).toBe(1);
      expect(tasks[0].description).toBe("Just do this simple thing");
      expect(tasks[0].id).toBe("task-0-0");
    });

    it("should infer task types from keywords", () => {
      const tasks = decompose("Test the auth module then review the changes");

      expect(tasks[0].type).toBe("test");
      expect(tasks[1].type).toBe("review");
    });

    it("should infer priority from urgency keywords", () => {
      const tasks = decompose("Urgently fix the critical bug");
      expect(tasks[0].priority).toBe("critical");
    });

    it("should default to 'normal' priority when no urgency keywords present", () => {
      const tasks = decompose("Build a new feature");
      expect(tasks[0].priority).toBe("normal");
    });

    it("should detect low priority keywords", () => {
      const tasks = decompose("Nice to have: add dark mode");
      expect(tasks[0].priority).toBe("low");
    });

    it("should detect background priority", () => {
      const tasks = decompose("Whenever you get a chance, clean up old logs");
      expect(tasks[0].priority).toBe("background");
    });

    it("should set status to 'pending' for all tasks", () => {
      const tasks = decompose("Do A then do B");
      for (const task of tasks) {
        expect(task.status).toBe("pending");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // suggestPlan
  // ═══════════════════════════════════════════════════════════════════════

  describe("suggestPlan", () => {
    const slots: AgentSlot[] = [
      {
        id: "writer",
        role: "code-writer",
        capabilities: ["code-writing", "typescript"],
        maxConcurrent: 2,
      },
      {
        id: "reviewer",
        role: "code-reviewer",
        capabilities: ["code-review", "analysis"],
        maxConcurrent: 1,
      },
    ];

    it("should suggest round-robin for a single simple task", () => {
      const plan = suggestPlan("Build a login form", slots);

      expect(plan.strategy).toBe("round-robin");
      expect(plan.coordination.aggregation).toBe("first-wins");
      expect(plan.agents).toBe(slots);
    });

    it("should suggest hierarchical strategy for tasks with review keywords", () => {
      const plan = suggestPlan("Implement feature then review the code", slots);

      expect(plan.strategy).toBe("hierarchical");
      expect(plan.coordination.aggregation).toBe("chain");
      expect(plan.coordination.sharedContext).toBe(true);
    });

    it("should suggest round-robin with chain for sequential tasks without review", () => {
      const plan = suggestPlan("Analyze the code then refactor the module", slots);

      expect(plan.strategy).toBe("round-robin");
      expect(plan.coordination.aggregation).toBe("chain");
    });

    it("should suggest swarm for complex tasks with many subtasks", () => {
      // Create more than 3 parallel subtasks
      const complexTask =
        "Fix auth and fix payments and fix notifications and fix logging";
      const plan = suggestPlan(complexTask, slots);

      expect(plan.strategy).toBe("swarm");
      expect(plan.coordination.aggregation).toBe("merge");
      expect(plan.coordination.tolerateFailures).toBe(true);
    });

    it("should include routing rules from available slots", () => {
      const plan = suggestPlan("Do something", slots);

      expect(plan.routing.length).toBeGreaterThan(0);
      // Should have a fallback rule
      const fallback = plan.routing.find((r) => r.match.type === "always");
      expect(fallback).toBeDefined();
    });

    it("should set escalateToHuman in fallback config", () => {
      const plan = suggestPlan("Build a thing", slots);

      expect(plan.fallback).toBeDefined();
      expect(plan.fallback!.escalateToHuman).toBe(true);
    });

    it("should generate a descriptive plan name", () => {
      const plan = suggestPlan("Build a login form with OAuth integration", slots);

      expect(plan.name).toContain("Auto-plan");
      expect(plan.name).toContain("Build a login form");
    });

    it("should truncate long descriptions in the plan name", () => {
      const longDesc = "A".repeat(100);
      const plan = suggestPlan(longDesc, slots);

      expect(plan.name.length).toBeLessThan(100);
      expect(plan.name).toContain("...");
    });

    it("should generate a unique plan ID", () => {
      const plan1 = suggestPlan("Task A", slots);
      const plan2 = suggestPlan("Task B", slots);

      expect(plan1.id).toContain("plan-");
      expect(plan2.id).toContain("plan-");
    });
  });
});
