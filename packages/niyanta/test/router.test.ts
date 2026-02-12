import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskRouter, jaccardSimilarity } from "../src/router.js";
import type { AgentSlot, OrchestratorTask, RoutingRule } from "../src/types.js";

/** Helper: create a minimal task for testing. */
function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: "task-1",
    type: "prompt",
    description: "Write a function",
    priority: "normal",
    status: "pending",
    ...overrides,
  };
}

/** Helper: create an agent slot. */
function makeSlot(id: string, capabilities: string[] = [], role = "worker"): AgentSlot {
  return {
    id,
    role,
    capabilities,
    maxConcurrent: 2,
  };
}

describe("jaccardSimilarity", () => {
  it("should return 1 for identical sets", () => {
    expect(jaccardSimilarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("should return 0 for completely disjoint sets", () => {
    expect(jaccardSimilarity(["a", "b"], ["c", "d"])).toBe(0);
  });

  it("should return correct value for partial overlap", () => {
    // intersection = {b}, union = {a, b, c} -> 1/3
    const sim = jaccardSimilarity(["a", "b"], ["b", "c"]);
    expect(sim).toBeCloseTo(1 / 3, 5);
  });

  it("should return 0 when both sets are empty", () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it("should be case-insensitive", () => {
    expect(jaccardSimilarity(["TypeScript"], ["typescript"])).toBe(1);
  });

  it("should handle one empty set", () => {
    expect(jaccardSimilarity(["a"], [])).toBe(0);
  });
});

describe("TaskRouter", () => {
  const slots: AgentSlot[] = [
    makeSlot("writer", ["code-writing", "typescript"]),
    makeSlot("reviewer", ["code-review", "analysis"]),
    makeSlot("tester", ["testing", "assertions"]),
  ];

  describe("keyword matcher", () => {
    it("should route tasks matching keyword rules", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "keyword", keywords: ["write", "implement", "create"] },
          target: "writer",
          priority: 10,
        },
        {
          id: "r2",
          match: { type: "keyword", keywords: ["review", "check"] },
          target: "reviewer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);

      expect(router.route(makeTask({ description: "Write a utility function" }))).toBe("writer");
      expect(router.route(makeTask({ description: "Review the pull request" }))).toBe("reviewer");
    });

    it("should be case-insensitive for keyword matching", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "keyword", keywords: ["DEPLOY"] },
          target: "writer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.route(makeTask({ description: "deploy the application" }))).toBe("writer");
    });
  });

  describe("pattern matcher", () => {
    it("should route tasks matching regex patterns", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "pattern", regex: "\\btest\\b.*\\bsuite\\b" },
          target: "tester",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.route(makeTask({ description: "Create a test suite for auth" }))).toBe("tester");
      // Should not match without both words
      expect(router.route(makeTask({ description: "Test the system" }))).not.toBe("tester");
    });
  });

  describe("capability matcher", () => {
    it("should route to a slot with matching capabilities (Jaccard > 0.3)", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "capability", required: ["code-review", "analysis"] },
          target: "reviewer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.route(makeTask({ description: "any task" }))).toBe("reviewer");
    });
  });

  describe("file_type matcher", () => {
    it("should match tasks that mention file extensions", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "file_type", extensions: [".ts", ".tsx"] },
          target: "writer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.route(makeTask({ description: "Fix the bug in utils.ts" }))).toBe("writer");
    });

    it("should check task context as well as description", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "file_type", extensions: [".py"] },
          target: "writer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      const task = makeTask({
        description: "Fix the module",
        context: { file: "main.py" },
      });
      expect(router.route(task)).toBe("writer");
    });
  });

  describe("always matcher", () => {
    it("should always match (catch-all)", () => {
      const rules: RoutingRule[] = [
        { id: "r1", match: { type: "always" }, target: "writer", priority: 0 },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.route(makeTask({ description: "anything at all" }))).toBe("writer");
    });
  });

  describe("expression matcher", () => {
    it("should match task.type equality expressions", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "expression", expr: 'task.type == "review"' },
          target: "reviewer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.route(makeTask({ type: "review" }))).toBe("reviewer");
      expect(router.route(makeTask({ type: "prompt" }))).not.toBe("reviewer");
    });

    it("should match task.description contains expressions", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "expression", expr: 'task.description contains "security"' },
          target: "reviewer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.route(makeTask({ description: "Audit the security headers" }))).toBe("reviewer");
    });
  });

  describe("priority ordering", () => {
    it("should evaluate higher priority rules first", () => {
      const rules: RoutingRule[] = [
        {
          id: "low",
          match: { type: "always" },
          target: "writer",
          priority: 1,
        },
        {
          id: "high",
          match: { type: "keyword", keywords: ["write"] },
          target: "tester",
          priority: 100,
        },
      ];

      const router = new TaskRouter(rules, slots);
      // "write" matches both, but high-priority rule routes to tester
      expect(router.route(makeTask({ description: "write tests" }))).toBe("tester");
    });
  });

  describe("fallback round-robin", () => {
    it("should round-robin when no rules match", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "keyword", keywords: ["zzzzz_never_match"] },
          target: "writer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      const first = router.route(makeTask({ description: "something random" }));
      const second = router.route(makeTask({ description: "another random" }));
      const third = router.route(makeTask({ description: "third random" }));

      // Should cycle through slots
      expect([first, second, third]).toContain("writer");
      expect([first, second, third]).toContain("reviewer");
      expect([first, second, third]).toContain("tester");
    });
  });

  describe("caching", () => {
    it("should cache route decisions", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "keyword", keywords: ["build"] },
          target: "writer",
          priority: 10,
        },
      ];

      const router = new TaskRouter(rules, slots);
      expect(router.getCacheSize()).toBe(0);

      router.route(makeTask({ description: "build the app" }));
      expect(router.getCacheSize()).toBe(1);

      // Same task type + description should hit cache
      router.route(makeTask({ description: "build the app" }));
      expect(router.getCacheSize()).toBe(1);
    });

    it("should allow clearing the cache", () => {
      const rules: RoutingRule[] = [
        { id: "r1", match: { type: "always" }, target: "writer", priority: 1 },
      ];

      const router = new TaskRouter(rules, slots);
      router.route(makeTask());
      expect(router.getCacheSize()).toBe(1);

      router.clearCache();
      expect(router.getCacheSize()).toBe(0);
    });
  });

  describe("routeAndTransform", () => {
    it("should apply transform function when present on the matching rule", () => {
      const rules: RoutingRule[] = [
        {
          id: "r1",
          match: { type: "keyword", keywords: ["urgent"] },
          target: "writer",
          priority: 10,
          transform: (task) => ({ ...task, priority: "critical" }),
        },
      ];

      const router = new TaskRouter(rules, slots);
      const result = router.routeAndTransform(makeTask({ description: "urgent fix needed" }));

      expect(result.slotId).toBe("writer");
      expect(result.task.priority).toBe("critical");
    });

    it("should return the original task when no transform is defined", () => {
      const rules: RoutingRule[] = [
        { id: "r1", match: { type: "always" }, target: "reviewer", priority: 1 },
      ];

      const router = new TaskRouter(rules, slots);
      const task = makeTask();
      const result = router.routeAndTransform(task);

      expect(result.slotId).toBe("reviewer");
      expect(result.task).toBe(task);
    });
  });
});
