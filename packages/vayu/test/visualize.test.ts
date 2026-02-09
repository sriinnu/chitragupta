import { describe, it, expect } from "vitest";
import { renderDAG } from "../src/visualize.js";
import type { Workflow, WorkflowExecution, StepExecution, WorkflowStep } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function step(id: string, dependsOn: string[] = []): WorkflowStep {
  return {
    id,
    name: `Step ${id}`,
    action: { type: "prompt", message: `Do ${id}` },
    dependsOn,
  };
}

function makeWorkflow(steps: WorkflowStep[], name = "Test Workflow"): Workflow {
  return {
    id: "test-wf",
    name,
    description: "A test workflow",
    version: "1.0.0",
    steps,
  };
}

function makeExecution(
  stepStatuses: Record<string, StepExecution["status"]>,
  overrides: Partial<WorkflowExecution> = {},
): WorkflowExecution {
  const steps = new Map<string, StepExecution>();
  for (const [id, status] of Object.entries(stepStatuses)) {
    steps.set(id, {
      stepId: id,
      status,
      retryCount: 0,
      duration: status === "completed" ? 1000 : undefined,
      startTime: Date.now() - 2000,
      endTime: status === "completed" ? Date.now() : undefined,
    });
  }

  return {
    workflowId: "test-wf",
    executionId: "exec-1",
    status: "running",
    startTime: Date.now() - 5000,
    steps,
    context: {},
    ...overrides,
  };
}

/**
 * Strip ANSI escape codes from a string for easier assertion.
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("renderDAG", () => {
  describe("linear DAG rendering", () => {
    it("should render a single-step workflow", () => {
      const workflow = makeWorkflow([step("a")]);
      const output = renderDAG(workflow);

      expect(output).toBeTruthy();
      const stripped = stripAnsi(output);
      expect(stripped).toContain("[a]");
    });

    it("should render a linear chain with arrows", () => {
      const workflow = makeWorkflow([
        step("lint"),
        step("test", ["lint"]),
        step("build", ["test"]),
      ]);
      const output = renderDAG(workflow);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("[lint]");
      expect(stripped).toContain("[test]");
      expect(stripped).toContain("[build]");
    });

    it("should show step statuses when execution is provided", () => {
      const workflow = makeWorkflow([
        step("lint"),
        step("test", ["lint"]),
        step("build", ["test"]),
      ]);
      const execution = makeExecution({
        lint: "completed",
        test: "running",
        build: "pending",
      });

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      // Should contain status icons (Unicode characters)
      expect(stripped).toContain("\u2713"); // completed checkmark
      expect(stripped).toContain("\u25CF"); // running circle
      expect(stripped).toContain("\u25CB"); // pending empty circle
    });
  });

  describe("parallel DAG rendering", () => {
    it("should render a diamond DAG with parallel branches", () => {
      const workflow = makeWorkflow([
        step("start"),
        step("branch-a", ["start"]),
        step("branch-b", ["start"]),
        step("end", ["branch-a", "branch-b"]),
      ]);
      const output = renderDAG(workflow);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("[start]");
      expect(stripped).toContain("[branch-a]");
      expect(stripped).toContain("[branch-b]");
      expect(stripped).toContain("[end]");
    });

    it("should render branch connectors for parallel steps", () => {
      const workflow = makeWorkflow([
        step("root"),
        step("a", ["root"]),
        step("b", ["root"]),
        step("c", ["root"]),
        step("merge", ["a", "b", "c"]),
      ]);

      const output = renderDAG(workflow);
      const stripped = stripAnsi(output);

      // Should contain branch characters
      expect(stripped).toContain("\u250C"); // top-left corner
      expect(stripped).toContain("\u2514"); // bottom-left corner
    });
  });

  describe("summary table", () => {
    it("should include a step summary section", () => {
      const workflow = makeWorkflow([step("a"), step("b", ["a"])]);
      const output = renderDAG(workflow);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("Step Summary:");
    });

    it("should show step names in the summary", () => {
      const workflow = makeWorkflow([
        { ...step("lint"), name: "Run Linter" },
        { ...step("test", ["lint"]), name: "Run Tests" },
      ]);
      const output = renderDAG(workflow);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("Run Linter");
      expect(stripped).toContain("Run Tests");
    });

    it("should show durations for completed steps", () => {
      const workflow = makeWorkflow([step("a")]);
      const execution = makeExecution({ a: "completed" });
      execution.steps.get("a")!.duration = 1500;

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("1.5s");
    });

    it("should show duration in ms for fast steps", () => {
      const workflow = makeWorkflow([step("a")]);
      const execution = makeExecution({ a: "completed" });
      execution.steps.get("a")!.duration = 50;

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("50ms");
    });

    it("should show retry count if retries occurred", () => {
      const workflow = makeWorkflow([step("a")]);
      const execution = makeExecution({ a: "completed" });
      execution.steps.get("a")!.retryCount = 2;

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("retry 2");
    });

    it("should show error message for failed steps", () => {
      const workflow = makeWorkflow([step("a")]);
      const execution = makeExecution({ a: "failed" });
      execution.steps.get("a")!.error = "Command exited with code 1";

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("Command exited with code 1");
    });
  });

  describe("workflow-level status", () => {
    it("should show overall workflow status when execution provided", () => {
      const workflow = makeWorkflow([step("a")]);
      const execution = makeExecution({ a: "completed" }, { status: "completed" });
      execution.endTime = Date.now();

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("Status:");
      expect(stripped).toContain("completed");
    });

    it("should show 'running...' for workflows without endTime", () => {
      const workflow = makeWorkflow([step("a")]);
      const execution = makeExecution({ a: "running" }, { status: "running" });
      delete execution.endTime;

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("running...");
    });
  });

  describe("status icons", () => {
    it("should use correct icons for all statuses", () => {
      const workflow = makeWorkflow([
        step("a"),
        step("b", ["a"]),
        step("c", ["a"]),
        step("d", ["a"]),
        step("e", ["a"]),
        step("f", ["a"]),
      ]);

      const execution = makeExecution({
        a: "completed",
        b: "running",
        c: "failed",
        d: "pending",
        e: "skipped",
        f: "cancelled",
      });

      const output = renderDAG(workflow, execution);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("\u2713"); // completed
      expect(stripped).toContain("\u25CF"); // running
      expect(stripped).toContain("\u2717"); // failed
      expect(stripped).toContain("\u25CB"); // pending
      expect(stripped).toContain("\u2014"); // skipped
      expect(stripped).toContain("\u2205"); // cancelled
    });
  });

  describe("workflow name display", () => {
    it("should display the workflow name in the header", () => {
      const workflow = makeWorkflow(
        [step("a"), step("b", ["a"]), step("c", ["a"])],
        "My CI Pipeline",
      );
      const output = renderDAG(workflow);
      const stripped = stripAnsi(output);

      expect(stripped).toContain("My CI Pipeline");
    });
  });

  describe("edge cases", () => {
    it("should handle workflows with many parallel branches", () => {
      const branches = Array.from({ length: 10 }, (_, i) =>
        step(`branch-${i}`, ["root"]),
      );
      const workflow = makeWorkflow([
        step("root"),
        ...branches,
        step("merge", branches.map((b) => b.id)),
      ]);

      const output = renderDAG(workflow);
      expect(output).toBeTruthy();
      const stripped = stripAnsi(output);
      expect(stripped).toContain("[root]");
      expect(stripped).toContain("[merge]");
    });
  });
});
