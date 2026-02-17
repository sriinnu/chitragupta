import { describe, it, expect } from "vitest";
import { WorkflowBuilder, StepBuilder } from "../src/builder.js";
import { validateDAG } from "../src/dag.js";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("WorkflowBuilder", () => {
  describe("basic workflow construction", () => {
    it("should build a workflow with id and name", () => {
      const workflow = new WorkflowBuilder("wf-1", "My Workflow").build();

      expect(workflow.id).toBe("wf-1");
      expect(workflow.name).toBe("My Workflow");
      expect(workflow.steps).toEqual([]);
    });

    it("should set description", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .describe("A test workflow")
        .build();

      expect(workflow.description).toBe("A test workflow");
    });

    it("should set version", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .setVersion("2.0.0")
        .build();

      expect(workflow.version).toBe("2.0.0");
    });

    it("should set global context", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .setContext({ env: "production", debug: false })
        .build();

      expect(workflow.context).toEqual({ env: "production", debug: false });
    });

    it("should set timeout", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .setTimeout(30000)
        .build();

      expect(workflow.timeout).toBe(30000);
    });

    it("should set maxConcurrency", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .setConcurrency(4)
        .build();

      expect(workflow.maxConcurrency).toBe(4);
    });

    it("should add triggers", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .trigger({ type: "manual" })
        .trigger({ type: "file_change", patterns: ["src/**/*.ts"] })
        .build();

      expect(workflow.triggers).toHaveLength(2);
      expect(workflow.triggers![0].type).toBe("manual");
      expect(workflow.triggers![1].type).toBe("file_change");
    });

    it("should have no triggers by default", () => {
      const workflow = new WorkflowBuilder("wf-1", "W").build();
      expect(workflow.triggers).toBeUndefined();
    });
  });

  describe("fluent step API: workflow().step().step().build()", () => {
    it("should build a workflow with chained steps", () => {
      const workflow = new WorkflowBuilder("wf-1", "Pipeline")
        .step("lint", "Run Linter")
          .shell("npm run lint")
          .done()
        .step("test", "Run Tests")
          .shell("npm test")
          .dependsOn("lint")
          .done()
        .step("build", "Build Project")
          .shell("npm run build")
          .dependsOn("test")
          .done()
        .build();

      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[0].id).toBe("lint");
      expect(workflow.steps[1].id).toBe("test");
      expect(workflow.steps[2].id).toBe("build");

      // Verify dependency chain
      expect(workflow.steps[0].dependsOn).toEqual([]);
      expect(workflow.steps[1].dependsOn).toEqual(["lint"]);
      expect(workflow.steps[2].dependsOn).toEqual(["test"]);
    });

    it("should produce a valid DAG", () => {
      const workflow = new WorkflowBuilder("wf-1", "Pipeline")
        .step("a", "Step A").prompt("do A").done()
        .step("b", "Step B").prompt("do B").dependsOn("a").done()
        .step("c", "Step C").prompt("do C").dependsOn("a").done()
        .step("d", "Step D").prompt("do D").dependsOn("b", "c").done()
        .build();

      const result = validateDAG(workflow.steps);
      expect(result.valid).toBe(true);
    });
  });

  describe("step action types", () => {
    it("should set prompt action", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Prompt Step")
          .prompt("Analyze this code", "claude-opus", "code-review")
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("prompt");
      if (action.type === "prompt") {
        expect(action.message).toBe("Analyze this code");
        expect(action.model).toBe("claude-opus");
        expect(action.profile).toBe("code-review");
      }
    });

    it("should set tool action", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Tool Step")
          .tool("read_file", { path: "src/main.ts" })
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("tool");
      if (action.type === "tool") {
        expect(action.name).toBe("read_file");
        expect(action.args).toEqual({ path: "src/main.ts" });
      }
    });

    it("should set shell action with cwd", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Shell Step")
          .shell("npm test", "/tmp/project")
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("shell");
      if (action.type === "shell") {
        expect(action.command).toBe("npm test");
        expect(action.cwd).toBe("/tmp/project");
      }
    });

    it("should set transform action", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Transform Step")
          .transform("inputs.data.toUpperCase()")
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("transform");
    });

    it("should set wait action", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Wait Step")
          .wait(5000)
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("wait");
      if (action.type === "wait") {
        expect(action.duration).toBe(5000);
      }
    });

    it("should set approval action", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Approval Step")
          .approval("Please review and approve")
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("approval");
      if (action.type === "approval") {
        expect(action.message).toBe("Please review and approve");
      }
    });

    it("should set subworkflow action", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Sub Step")
          .subworkflow("sub-wf-1")
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("subworkflow");
      if (action.type === "subworkflow") {
        expect(action.workflowId).toBe("sub-wf-1");
      }
    });

    it("should set conditional action", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "Conditional Step")
          .conditional(
            { type: "expression", expr: "context.env === 'prod'" },
            "deploy",
            "skip",
          )
          .done()
        .build();

      const action = workflow.steps[0].action;
      expect(action.type).toBe("conditional");
    });
  });

  describe("step configuration", () => {
    it("should set step dependencies via dependsOn()", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("a", "A").prompt("do").done()
        .step("b", "B").prompt("do").dependsOn("a").done()
        .build();

      expect(workflow.steps[1].dependsOn).toEqual(["a"]);
    });

    it("should set multiple dependencies", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("a", "A").prompt("do").done()
        .step("b", "B").prompt("do").done()
        .step("c", "C").prompt("do").dependsOn("a", "b").done()
        .build();

      expect(workflow.steps[2].dependsOn).toEqual(["a", "b"]);
    });

    it("should set step condition", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "S1")
          .prompt("do")
          .condition({ type: "expression", expr: "true" })
          .done()
        .build();

      expect(workflow.steps[0].condition).toBeDefined();
      expect(workflow.steps[0].condition!.type).toBe("expression");
    });

    it("should set retry configuration", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "S1")
          .shell("flaky-command")
          .retry({ maxRetries: 3, delay: 1000, backoff: 2 })
          .done()
        .build();

      expect(workflow.steps[0].retry).toEqual({
        maxRetries: 3,
        delay: 1000,
        backoff: 2,
      });
    });

    it("should set step timeout", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "S1")
          .shell("long-running")
          .timeout(60000)
          .done()
        .build();

      expect(workflow.steps[0].timeout).toBe(60000);
    });

    it("should set step inputs", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "S1")
          .prompt("do")
          .input("files", { source: "step", stepId: "read", path: "result" })
          .input("config", { source: "literal", value: { key: "val" } })
          .done()
        .build();

      expect(workflow.steps[0].inputs).toBeDefined();
      expect(workflow.steps[0].inputs!.files.source).toBe("step");
      expect(workflow.steps[0].inputs!.config.source).toBe("literal");
    });

    it("should set failure strategy", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "S1")
          .shell("risky")
          .onFailure("continue")
          .done()
        .build();

      expect(workflow.steps[0].onFailure).toBe("continue");
    });

    it("should add tags", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("s1", "S1")
          .prompt("do")
          .tag("ci", "quality", "required")
          .done()
        .build();

      expect(workflow.steps[0].tags).toEqual(["ci", "quality", "required"]);
    });
  });

  describe("parallel() shorthand", () => {
    it("should add a parallel step group", () => {
      const workflow = new WorkflowBuilder("wf-1", "W")
        .step("a", "A").prompt("do").done()
        .parallel("par-1", "Parallel Group", ["a", "b", "c"])
        .build();

      expect(workflow.steps).toHaveLength(2);
      const parStep = workflow.steps[1];
      expect(parStep.action.type).toBe("parallel");
      if (parStep.action.type === "parallel") {
        expect(parStep.action.steps).toEqual(["a", "b", "c"]);
      }
    });
  });

  describe("StepBuilder.getStep()", () => {
    it("should return the built step without adding to workflow", () => {
      const builder = new WorkflowBuilder("wf-1", "W");
      const stepBuilder = builder.step("s1", "Step 1");
      stepBuilder.prompt("hello").timeout(5000);

      const builtStep = stepBuilder.getStep();
      expect(builtStep.id).toBe("s1");
      expect(builtStep.timeout).toBe(5000);
    });
  });

  describe("complex workflow example", () => {
    it("should build a full CI/CD pipeline with valid DAG", () => {
      const workflow = new WorkflowBuilder("cicd", "CI/CD Pipeline")
        .describe("Full CI/CD pipeline")
        .setVersion("2.0.0")
        .setTimeout(600000)
        .setConcurrency(3)
        .trigger({ type: "manual" })
        .setContext({ environment: "staging" })
        .step("lint", "Lint Code")
          .shell("npm run lint")
          .timeout(60000)
          .tag("quality")
          .done()
        .step("unit-tests", "Unit Tests")
          .shell("npm run test:unit")
          .dependsOn("lint")
          .retry({ maxRetries: 2, delay: 1000 })
          .tag("quality", "test")
          .done()
        .step("e2e-tests", "E2E Tests")
          .shell("npm run test:e2e")
          .dependsOn("lint")
          .timeout(120000)
          .onFailure("continue")
          .tag("quality", "test")
          .done()
        .step("build", "Build")
          .shell("npm run build")
          .dependsOn("unit-tests", "e2e-tests")
          .timeout(120000)
          .tag("build")
          .done()
        .step("review", "Deployment Review")
          .approval("Build complete. Approve for deployment?")
          .dependsOn("build")
          .tag("approval")
          .done()
        .step("deploy", "Deploy")
          .shell("npm run deploy")
          .dependsOn("review")
          .timeout(180000)
          .onFailure("fail")
          .tag("deploy")
          .done()
        .build();

      expect(workflow.id).toBe("cicd");
      expect(workflow.steps).toHaveLength(6);
      expect(workflow.timeout).toBe(600000);
      expect(workflow.maxConcurrency).toBe(3);

      // Should be a valid DAG
      const result = validateDAG(workflow.steps);
      expect(result.valid).toBe(true);
    });
  });
});
