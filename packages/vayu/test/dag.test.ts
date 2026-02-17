import { describe, it, expect } from "vitest";
import {
  validateDAG,
  topologicalSort,
  getExecutionLevels,
  getCriticalPath,
} from "../src/dag.js";
import type { WorkflowStep, StepExecution } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function step(id: string, dependsOn: string[] = []): WorkflowStep {
  return {
    id,
    name: `Step ${id}`,
    action: { type: "prompt", message: `Do ${id}` },
    dependsOn,
  };
}

// ─── validateDAG ────────────────────────────────────────────────────────────

describe("validateDAG", () => {
  it("should validate a single step with no dependencies", () => {
    const result = validateDAG([step("a")]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should validate a simple linear chain", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["b"])];
    const result = validateDAG(steps);
    expect(result.valid).toBe(true);
  });

  it("should validate a diamond dependency graph", () => {
    const steps = [
      step("a"),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    const result = validateDAG(steps);
    expect(result.valid).toBe(true);
  });

  it("should validate multiple independent root steps", () => {
    const steps = [step("a"), step("b"), step("c", ["a", "b"])];
    const result = validateDAG(steps);
    expect(result.valid).toBe(true);
  });

  it("should detect duplicate step IDs", () => {
    const steps = [step("a"), step("a")];
    const result = validateDAG(steps);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate step ID"))).toBe(true);
  });

  it("should detect missing dependency references", () => {
    const steps = [step("a", ["nonexistent"])];
    const result = validateDAG(steps);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown step"))).toBe(true);
  });

  it("should detect a simple cycle (A -> B -> A)", () => {
    const steps = [step("a", ["b"]), step("b", ["a"])];
    const result = validateDAG(steps);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("cycle") || e.includes("root"))).toBe(true);
  });

  it("should detect a longer cycle (A -> B -> C -> A)", () => {
    const steps = [
      step("a", ["c"]),
      step("b", ["a"]),
      step("c", ["b"]),
    ];
    const result = validateDAG(steps);
    expect(result.valid).toBe(false);
  });

  it("should detect self-referencing step", () => {
    const steps = [step("a", ["a"])];
    const result = validateDAG(steps);
    expect(result.valid).toBe(false);
  });

  it("should handle empty steps array", () => {
    const result = validateDAG([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("should detect that all steps have dependencies (no roots)", () => {
    // A depends on B, B depends on C, C depends on A => cycle, no roots
    const steps = [
      step("a", ["c"]),
      step("b", ["a"]),
      step("c", ["b"]),
    ];
    const result = validateDAG(steps);
    expect(result.valid).toBe(false);
  });

  it("should detect orphaned steps not reachable from roots", () => {
    // "root" has no deps, "connected" depends on root
    // "orphan" depends on a nonexistent step "phantom" (missing ref already reported)
    // But let's test a reachable orphan: orphan depends on itself via a side cycle
    const steps = [
      step("root"),
      step("connected", ["root"]),
      step("orphanA", ["orphanB"]),
      step("orphanB", ["orphanA"]),
    ];
    const result = validateDAG(steps);
    expect(result.valid).toBe(false);
  });
});

// ─── topologicalSort ────────────────────────────────────────────────────────

describe("topologicalSort", () => {
  it("should sort a single step", () => {
    const sorted = topologicalSort([step("a")]);
    expect(sorted).toEqual(["a"]);
  });

  it("should sort a linear chain in dependency order", () => {
    const steps = [step("c", ["b"]), step("a"), step("b", ["a"])];
    const sorted = topologicalSort(steps);

    // "a" must come before "b", "b" must come before "c"
    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"));
  });

  it("should sort a diamond dependency correctly", () => {
    const steps = [
      step("d", ["b", "c"]),
      step("b", ["a"]),
      step("c", ["a"]),
      step("a"),
    ];
    const sorted = topologicalSort(steps);

    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"));
    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("c"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("d"));
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("d"));
  });

  it("should handle multiple independent roots", () => {
    const steps = [step("a"), step("b"), step("c", ["a", "b"])];
    const sorted = topologicalSort(steps);

    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("c"));
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"));
  });

  it("should throw on cycles", () => {
    const steps = [step("a", ["b"]), step("b", ["a"])];
    expect(() => topologicalSort(steps)).toThrow(/[Cc]ycle/);
  });

  it("should sort a wide parallel graph", () => {
    // Root -> [a, b, c, d, e] -> End
    const steps = [
      step("root"),
      step("a", ["root"]),
      step("b", ["root"]),
      step("c", ["root"]),
      step("d", ["root"]),
      step("e", ["root"]),
      step("end", ["a", "b", "c", "d", "e"]),
    ];
    const sorted = topologicalSort(steps);

    expect(sorted[0]).toBe("root");
    expect(sorted[sorted.length - 1]).toBe("end");
    expect(sorted.indexOf("root")).toBe(0);
  });

  it("should handle a complex multi-path graph", () => {
    //   a
    //  / \
    // b   c
    //  \ / \
    //   d   e
    //    \ /
    //     f
    const steps = [
      step("a"),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
      step("e", ["c"]),
      step("f", ["d", "e"]),
    ];
    const sorted = topologicalSort(steps);

    expect(sorted.indexOf("a")).toBe(0);
    expect(sorted.indexOf("f")).toBe(sorted.length - 1);
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("d"));
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("d"));
    expect(sorted.indexOf("c")).toBeLessThan(sorted.indexOf("e"));
    expect(sorted.indexOf("d")).toBeLessThan(sorted.indexOf("f"));
    expect(sorted.indexOf("e")).toBeLessThan(sorted.indexOf("f"));
  });
});

// ─── getExecutionLevels ─────────────────────────────────────────────────────

describe("getExecutionLevels", () => {
  it("should put single step in level 0", () => {
    const levels = getExecutionLevels([step("a")]);
    expect(levels).toEqual([["a"]]);
  });

  it("should group parallel steps at the same level", () => {
    const steps = [
      step("root"),
      step("a", ["root"]),
      step("b", ["root"]),
      step("c", ["root"]),
    ];
    const levels = getExecutionLevels(steps);

    expect(levels).toHaveLength(2);
    expect(levels[0]).toEqual(["root"]);
    expect(levels[1]).toHaveLength(3);
    expect(levels[1]).toContain("a");
    expect(levels[1]).toContain("b");
    expect(levels[1]).toContain("c");
  });

  it("should create correct levels for a linear chain", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["b"])];
    const levels = getExecutionLevels(steps);

    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(["a"]);
    expect(levels[1]).toEqual(["b"]);
    expect(levels[2]).toEqual(["c"]);
  });

  it("should handle diamond topology", () => {
    const steps = [
      step("a"),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    const levels = getExecutionLevels(steps);

    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(["a"]);
    expect(levels[1]).toContain("b");
    expect(levels[1]).toContain("c");
    expect(levels[2]).toEqual(["d"]);
  });

  it("should handle multiple independent roots at level 0", () => {
    const steps = [step("a"), step("b"), step("c", ["a", "b"])];
    const levels = getExecutionLevels(steps);

    expect(levels[0]).toContain("a");
    expect(levels[0]).toContain("b");
    expect(levels[levels.length - 1]).toContain("c");
  });

  it("should handle a wide-then-narrow graph", () => {
    //       root
    //    / | | | \
    //   a  b  c  d  e
    //    \ | | | /
    //      merge
    const steps = [
      step("root"),
      step("a", ["root"]),
      step("b", ["root"]),
      step("c", ["root"]),
      step("d", ["root"]),
      step("e", ["root"]),
      step("merge", ["a", "b", "c", "d", "e"]),
    ];
    const levels = getExecutionLevels(steps);

    expect(levels).toHaveLength(3);
    expect(levels[0]).toEqual(["root"]);
    expect(levels[1]).toHaveLength(5);
    expect(levels[2]).toEqual(["merge"]);
  });
});

// ─── getCriticalPath ────────────────────────────────────────────────────────

describe("getCriticalPath", () => {
  it("should return the single step for a single-step workflow", () => {
    const steps = [step("a")];
    const executions = new Map<string, StepExecution>([
      ["a", { stepId: "a", status: "completed", retryCount: 0, duration: 100 }],
    ]);

    const path = getCriticalPath(steps, executions);
    expect(path).toEqual(["a"]);
  });

  it("should find the longest path in a diamond graph", () => {
    const steps = [
      step("start"),
      step("fast", ["start"]),
      step("slow", ["start"]),
      step("end", ["fast", "slow"]),
    ];
    const executions = new Map<string, StepExecution>([
      ["start", { stepId: "start", status: "completed", retryCount: 0, duration: 100 }],
      ["fast", { stepId: "fast", status: "completed", retryCount: 0, duration: 50 }],
      ["slow", { stepId: "slow", status: "completed", retryCount: 0, duration: 500 }],
      ["end", { stepId: "end", status: "completed", retryCount: 0, duration: 100 }],
    ]);

    const path = getCriticalPath(steps, executions);
    // Critical path should go through the slow branch
    expect(path).toContain("start");
    expect(path).toContain("slow");
    expect(path).toContain("end");
    expect(path).not.toContain("fast");
  });

  it("should find critical path in a linear chain", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["b"])];
    const executions = new Map<string, StepExecution>([
      ["a", { stepId: "a", status: "completed", retryCount: 0, duration: 100 }],
      ["b", { stepId: "b", status: "completed", retryCount: 0, duration: 200 }],
      ["c", { stepId: "c", status: "completed", retryCount: 0, duration: 300 }],
    ]);

    const path = getCriticalPath(steps, executions);
    expect(path).toEqual(["a", "b", "c"]);
  });

  it("should handle steps with no execution data (duration=0)", () => {
    const steps = [step("a"), step("b", ["a"])];
    const executions = new Map<string, StepExecution>();

    const path = getCriticalPath(steps, executions);
    // All durations are 0, but path should still be valid
    expect(path.length).toBeGreaterThanOrEqual(1);
  });

  it("should find critical path in a complex graph", () => {
    //   a(100)
    //  / \
    // b(10) c(500)
    //  \   / \
    //  d(50) e(200)
    //    \  /
    //    f(100)
    const steps = [
      step("a"),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
      step("e", ["c"]),
      step("f", ["d", "e"]),
    ];
    const executions = new Map<string, StepExecution>([
      ["a", { stepId: "a", status: "completed", retryCount: 0, duration: 100 }],
      ["b", { stepId: "b", status: "completed", retryCount: 0, duration: 10 }],
      ["c", { stepId: "c", status: "completed", retryCount: 0, duration: 500 }],
      ["d", { stepId: "d", status: "completed", retryCount: 0, duration: 50 }],
      ["e", { stepId: "e", status: "completed", retryCount: 0, duration: 200 }],
      ["f", { stepId: "f", status: "completed", retryCount: 0, duration: 100 }],
    ]);

    const path = getCriticalPath(steps, executions);
    // Critical path: a(100) -> c(500) -> e(200) -> f(100) = 900
    // vs a(100) -> c(500) -> d(50) -> f(100) = 750
    // vs a(100) -> b(10) -> d(50) -> f(100) = 260
    expect(path).toContain("a");
    expect(path).toContain("c");
    expect(path).toContain("f");
  });
});
