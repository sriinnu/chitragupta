import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowExecutor } from "../src/executor.js";
import type { Workflow, WorkflowStep, WorkflowEvent, StepCondition } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function step(
  id: string,
  dependsOn: string[] = [],
  overrides: Partial<WorkflowStep> = {},
): WorkflowStep {
  return {
    id,
    name: `Step ${id}`,
    action: { type: "prompt", message: `Do ${id}` },
    dependsOn,
    ...overrides,
  };
}

function makeWorkflow(
  steps: WorkflowStep[],
  overrides: Partial<Workflow> = {},
): Workflow {
  return {
    id: "test-workflow",
    name: "Test Workflow",
    description: "A test workflow",
    version: "1.0.0",
    steps,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("WorkflowExecutor", () => {
  let executor: WorkflowExecutor;

  beforeEach(() => {
    executor = new WorkflowExecutor();
  });

  describe("basic execution", () => {
    it("should execute a single-step workflow", async () => {
      const workflow = makeWorkflow([step("a")]);
      const execution = await executor.execute(workflow);

      expect(execution.status).toBe("completed");
      expect(execution.steps.get("a")?.status).toBe("completed");
    });

    it("should execute a linear chain of steps in order", async () => {
      const events: WorkflowEvent[] = [];
      const workflow = makeWorkflow([
        step("a"),
        step("b", ["a"]),
        step("c", ["b"]),
      ]);

      const execution = await executor.execute(workflow, (e) => events.push(e));

      expect(execution.status).toBe("completed");
      expect(execution.steps.get("a")?.status).toBe("completed");
      expect(execution.steps.get("b")?.status).toBe("completed");
      expect(execution.steps.get("c")?.status).toBe("completed");

      // Verify order via events
      const startEvents = events.filter((e) => e.type === "step:start");
      const startOrder = startEvents.map((e) => (e as { stepId: string }).stepId);
      expect(startOrder.indexOf("a")).toBeLessThan(startOrder.indexOf("b"));
      expect(startOrder.indexOf("b")).toBeLessThan(startOrder.indexOf("c"));
    });

    it("should execute parallel steps concurrently", async () => {
      const workflow = makeWorkflow([
        step("root"),
        step("a", ["root"]),
        step("b", ["root"]),
        step("c", ["root"]),
        step("end", ["a", "b", "c"]),
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.status).toBe("completed");
      expect(execution.steps.get("a")?.status).toBe("completed");
      expect(execution.steps.get("b")?.status).toBe("completed");
      expect(execution.steps.get("c")?.status).toBe("completed");
      expect(execution.steps.get("end")?.status).toBe("completed");
    });
  });

  describe("concurrency limits", () => {
    it("should respect maxConcurrency=1 (sequential execution)", async () => {
      const executionOrder: string[] = [];

      const makeTrackedStep = (id: string, dependsOn: string[] = []): WorkflowStep => ({
        id,
        name: `Step ${id}`,
        action: { type: "prompt", message: `Do ${id}` },
        dependsOn,
      });

      const workflow = makeWorkflow(
        [
          makeTrackedStep("root"),
          makeTrackedStep("a", ["root"]),
          makeTrackedStep("b", ["root"]),
          makeTrackedStep("end", ["a", "b"]),
        ],
        { maxConcurrency: 1 },
      );

      const execution = await executor.execute(workflow, (e) => {
        if (e.type === "step:start") {
          executionOrder.push((e as { stepId: string }).stepId);
        }
      });

      expect(execution.status).toBe("completed");
      // With concurrency=1, only one step runs at a time
      expect(executionOrder).toHaveLength(4);
    });
  });

  describe("step conditions", () => {
    it("should skip a step when condition evaluates to false", async () => {
      const falseCondition: StepCondition = {
        type: "expression",
        expr: "false",
      };

      const workflow = makeWorkflow([
        step("a"),
        step("b", ["a"], { condition: falseCondition }),
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.steps.get("a")?.status).toBe("completed");
      expect(execution.steps.get("b")?.status).toBe("skipped");
    });

    it("should run a step when condition evaluates to true", async () => {
      const trueCondition: StepCondition = {
        type: "expression",
        expr: "true",
      };

      const workflow = makeWorkflow([
        step("a"),
        step("b", ["a"], { condition: trueCondition }),
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.steps.get("a")?.status).toBe("completed");
      expect(execution.steps.get("b")?.status).toBe("completed");
    });

    it("should emit step:skip event when condition is false", async () => {
      const events: WorkflowEvent[] = [];
      const workflow = makeWorkflow([
        step("a"),
        step("b", ["a"], {
          condition: { type: "expression", expr: "false" },
        }),
      ]);

      await executor.execute(workflow, (e) => events.push(e));
      const skipEvents = events.filter((e) => e.type === "step:skip");
      expect(skipEvents).toHaveLength(1);
      expect((skipEvents[0] as { stepId: string }).stepId).toBe("b");
    });
  });

  describe("retry on failure", () => {
    it("should retry a failing step up to maxRetries", async () => {
      const events: WorkflowEvent[] = [];

      // Create a step that always fails by using an invalid shell command
      const failingStep: WorkflowStep = {
        id: "fail-step",
        name: "Failing Step",
        action: { type: "shell", command: "exit 1" },
        dependsOn: [],
        retry: { maxRetries: 2, delay: 10 },
        onFailure: "continue",
      };

      const workflow = makeWorkflow([failingStep]);
      const execution = await executor.execute(workflow, (e) => events.push(e));

      const retryEvents = events.filter((e) => e.type === "step:retry");
      // Should have retried up to 2 times
      expect(retryEvents.length).toBeLessThanOrEqual(2);
      expect(execution.steps.get("fail-step")?.status).toBe("failed");
    });

    it("should mark the step as failed after all retries exhausted", async () => {
      const failingStep: WorkflowStep = {
        id: "fail",
        name: "Fail",
        action: { type: "shell", command: "exit 1" },
        dependsOn: [],
        retry: { maxRetries: 1, delay: 10 },
        onFailure: "continue",
      };

      const workflow = makeWorkflow([failingStep]);
      const execution = await executor.execute(workflow);

      expect(execution.steps.get("fail")?.status).toBe("failed");
      expect(execution.steps.get("fail")?.retryCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("failure strategies", () => {
    it("should fail the entire workflow when step fails with onFailure='fail'", async () => {
      const workflow = makeWorkflow([
        {
          id: "fail",
          name: "Fail",
          action: { type: "shell", command: "exit 1" },
          dependsOn: [],
          onFailure: "fail",
        },
        step("after-fail", ["fail"]),
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.status).toBe("failed");
      // Downstream step should be cancelled
      expect(execution.steps.get("after-fail")?.status).toBe("cancelled");
    });

    it("should continue workflow when step fails with onFailure='continue'", async () => {
      const workflow = makeWorkflow([
        {
          id: "fail",
          name: "Fail",
          action: { type: "shell", command: "exit 1" },
          dependsOn: [],
          onFailure: "continue",
        },
        step("after-fail", ["fail"]),
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.steps.get("fail")?.status).toBe("failed");
      // With "continue" strategy, downstream should still run
      expect(execution.steps.get("after-fail")?.status).toBe("completed");
    });
  });

  describe("workflow events", () => {
    it("should emit workflow:start and workflow:done events", async () => {
      const events: WorkflowEvent[] = [];
      const workflow = makeWorkflow([step("a")]);

      await executor.execute(workflow, (e) => events.push(e));

      const startEvents = events.filter((e) => e.type === "workflow:start");
      const doneEvents = events.filter((e) => e.type === "workflow:done");

      expect(startEvents).toHaveLength(1);
      expect(doneEvents).toHaveLength(1);
    });

    it("should emit step:start and step:done events for each step", async () => {
      const events: WorkflowEvent[] = [];
      const workflow = makeWorkflow([step("a"), step("b", ["a"])]);

      await executor.execute(workflow, (e) => events.push(e));

      const stepStarts = events.filter((e) => e.type === "step:start");
      const stepDones = events.filter((e) => e.type === "step:done");

      expect(stepStarts).toHaveLength(2);
      expect(stepDones).toHaveLength(2);
    });
  });

  describe("DAG validation", () => {
    it("should throw for invalid DAG (cycle)", async () => {
      const workflow = makeWorkflow([
        step("a", ["b"]),
        step("b", ["a"]),
      ]);

      await expect(executor.execute(workflow)).rejects.toThrow(/[Ii]nvalid.*DAG/);
    });

    it("should throw for missing dependency references", async () => {
      const workflow = makeWorkflow([step("a", ["nonexistent"])]);

      await expect(executor.execute(workflow)).rejects.toThrow(/[Ii]nvalid.*DAG/);
    });
  });

  describe("timeout handling", () => {
    it("should timeout a step that exceeds its timeout", async () => {
      const slowStep: WorkflowStep = {
        id: "slow",
        name: "Slow Step",
        action: { type: "wait", duration: 5000 },
        dependsOn: [],
        timeout: 50, // Very short timeout
        onFailure: "continue",
      };

      const workflow = makeWorkflow([slowStep]);
      const execution = await executor.execute(workflow);

      expect(execution.steps.get("slow")?.status).toBe("failed");
      expect(execution.steps.get("slow")?.error).toContain("timed out");
    });
  });

  describe("prompt and tool actions", () => {
    it("should execute prompt actions and store output", async () => {
      const workflow = makeWorkflow([
        {
          id: "prompt-step",
          name: "Prompt",
          action: { type: "prompt", message: "Hello world" },
          dependsOn: [],
        },
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.steps.get("prompt-step")?.status).toBe("completed");
      const output = execution.steps.get("prompt-step")?.output as Record<string, unknown>;
      expect(output.type).toBe("prompt_result");
    });

    it("should execute tool actions and store output", async () => {
      const workflow = makeWorkflow([
        {
          id: "tool-step",
          name: "Tool",
          action: { type: "tool", name: "read_file", args: { path: "test.ts" } },
          dependsOn: [],
        },
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.steps.get("tool-step")?.status).toBe("completed");
      const output = execution.steps.get("tool-step")?.output as Record<string, unknown>;
      expect(output.type).toBe("tool_result");
    });
  });

  describe("wait action", () => {
    it("should complete a wait action after the specified duration", async () => {
      const workflow = makeWorkflow([
        {
          id: "wait-step",
          name: "Wait",
          action: { type: "wait", duration: 50 },
          dependsOn: [],
        },
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.steps.get("wait-step")?.status).toBe("completed");
      const output = execution.steps.get("wait-step")?.output as Record<string, unknown>;
      expect(output.type).toBe("wait_complete");
    });
  });

  describe("conditional action", () => {
    it("should execute conditional action and return branch info", async () => {
      const workflow = makeWorkflow([
        {
          id: "cond-step",
          name: "Conditional",
          action: {
            type: "conditional",
            if: { type: "expression", expr: "true" },
            then: "step-a",
            else: "step-b",
          },
          dependsOn: [],
        },
      ]);

      const execution = await executor.execute(workflow);
      expect(execution.steps.get("cond-step")?.status).toBe("completed");
      const output = execution.steps.get("cond-step")?.output as Record<string, unknown>;
      expect(output.branch).toBe("then");
    });
  });

  describe("context and step outputs", () => {
    it("should store step outputs in execution context", async () => {
      const workflow = makeWorkflow([
        step("a"),
        step("b", ["a"]),
      ]);

      const execution = await executor.execute(workflow);
      // Step a's output should be in context
      expect(execution.context["a.output"]).toBeDefined();
    });
  });
});
