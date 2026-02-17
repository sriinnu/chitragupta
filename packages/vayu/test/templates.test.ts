import { describe, it, expect } from "vitest";
import {
  CODE_REVIEW_WORKFLOW,
  REFACTOR_WORKFLOW,
  BUG_FIX_WORKFLOW,
  DEPLOY_WORKFLOW,
} from "../src/templates.js";
import { validateDAG } from "../src/dag.js";
import type { Workflow } from "../src/types.js";

// ─── Shared assertions for all templates ────────────────────────────────────

function assertValidWorkflow(workflow: Workflow): void {
  // Should have required fields
  expect(workflow.id).toBeTruthy();
  expect(workflow.name).toBeTruthy();
  expect(workflow.description).toBeTruthy();
  expect(workflow.version).toBe("1.0.0");
  expect(workflow.steps.length).toBeGreaterThan(0);

  // All steps should have required fields
  for (const step of workflow.steps) {
    expect(step.id).toBeTruthy();
    expect(step.name).toBeTruthy();
    expect(step.action).toBeDefined();
    expect(step.action.type).toBeTruthy();
    expect(Array.isArray(step.dependsOn)).toBe(true);
  }

  // Should form a valid DAG
  const validation = validateDAG(workflow.steps);
  expect(validation.valid).toBe(true);
  expect(validation.errors).toEqual([]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Workflow Templates", () => {
  describe("CODE_REVIEW_WORKFLOW", () => {
    it("should be a valid workflow", () => {
      assertValidWorkflow(CODE_REVIEW_WORKFLOW);
    });

    it("should have id 'code-review'", () => {
      expect(CODE_REVIEW_WORKFLOW.id).toBe("code-review");
    });

    it("should have 4 steps: read-files, analyze, check-conventions, report", () => {
      const stepIds = CODE_REVIEW_WORKFLOW.steps.map((s) => s.id);
      expect(stepIds).toEqual(["read-files", "analyze", "check-conventions", "report"]);
    });

    it("should have read-files as the root step (no dependencies)", () => {
      const readFiles = CODE_REVIEW_WORKFLOW.steps.find((s) => s.id === "read-files");
      expect(readFiles).toBeDefined();
      expect(readFiles!.dependsOn).toEqual([]);
    });

    it("should have analyze and check-conventions depend on read-files", () => {
      const analyze = CODE_REVIEW_WORKFLOW.steps.find((s) => s.id === "analyze");
      const checkConv = CODE_REVIEW_WORKFLOW.steps.find((s) => s.id === "check-conventions");
      expect(analyze!.dependsOn).toEqual(["read-files"]);
      expect(checkConv!.dependsOn).toEqual(["read-files"]);
    });

    it("should have report depend on both analyze and check-conventions", () => {
      const report = CODE_REVIEW_WORKFLOW.steps.find((s) => s.id === "report");
      expect(report!.dependsOn).toContain("analyze");
      expect(report!.dependsOn).toContain("check-conventions");
    });

    it("should have a manual trigger", () => {
      expect(CODE_REVIEW_WORKFLOW.triggers).toBeDefined();
      expect(CODE_REVIEW_WORKFLOW.triggers!.some((t) => t.type === "manual")).toBe(true);
    });

    it("should use tool action for reading files", () => {
      const readFiles = CODE_REVIEW_WORKFLOW.steps.find((s) => s.id === "read-files");
      expect(readFiles!.action.type).toBe("tool");
    });

    it("should use prompt actions for analysis steps", () => {
      const analyze = CODE_REVIEW_WORKFLOW.steps.find((s) => s.id === "analyze");
      expect(analyze!.action.type).toBe("prompt");
    });
  });

  describe("REFACTOR_WORKFLOW", () => {
    it("should be a valid workflow", () => {
      assertValidWorkflow(REFACTOR_WORKFLOW);
    });

    it("should have id 'refactor'", () => {
      expect(REFACTOR_WORKFLOW.id).toBe("refactor");
    });

    it("should have 5 steps: analyze, plan, execute, test, verify", () => {
      const stepIds = REFACTOR_WORKFLOW.steps.map((s) => s.id);
      expect(stepIds).toEqual(["analyze", "plan", "execute", "test", "verify"]);
    });

    it("should form a linear dependency chain", () => {
      expect(REFACTOR_WORKFLOW.steps[0].dependsOn).toEqual([]);
      expect(REFACTOR_WORKFLOW.steps[1].dependsOn).toEqual(["analyze"]);
      expect(REFACTOR_WORKFLOW.steps[2].dependsOn).toEqual(["plan"]);
      expect(REFACTOR_WORKFLOW.steps[3].dependsOn).toEqual(["execute"]);
      expect(REFACTOR_WORKFLOW.steps[4].dependsOn).toEqual(["test"]);
    });

    it("should have test step with retry config", () => {
      const testStep = REFACTOR_WORKFLOW.steps.find((s) => s.id === "test");
      expect(testStep!.retry).toBeDefined();
      expect(testStep!.retry!.maxRetries).toBe(1);
    });

    it("should have test step with onFailure='continue'", () => {
      const testStep = REFACTOR_WORKFLOW.steps.find((s) => s.id === "test");
      expect(testStep!.onFailure).toBe("continue");
    });

    it("should use shell action for test step", () => {
      const testStep = REFACTOR_WORKFLOW.steps.find((s) => s.id === "test");
      expect(testStep!.action.type).toBe("shell");
      if (testStep!.action.type === "shell") {
        expect(testStep!.action.command).toBe("npm test");
      }
    });
  });

  describe("BUG_FIX_WORKFLOW", () => {
    it("should be a valid workflow", () => {
      assertValidWorkflow(BUG_FIX_WORKFLOW);
    });

    it("should have id 'bug-fix'", () => {
      expect(BUG_FIX_WORKFLOW.id).toBe("bug-fix");
    });

    it("should have 5 steps: reproduce, diagnose, fix, test, verify", () => {
      const stepIds = BUG_FIX_WORKFLOW.steps.map((s) => s.id);
      expect(stepIds).toEqual(["reproduce", "diagnose", "fix", "test", "verify"]);
    });

    it("should form a linear dependency chain", () => {
      expect(BUG_FIX_WORKFLOW.steps[0].dependsOn).toEqual([]);
      expect(BUG_FIX_WORKFLOW.steps[1].dependsOn).toEqual(["reproduce"]);
      expect(BUG_FIX_WORKFLOW.steps[2].dependsOn).toEqual(["diagnose"]);
      expect(BUG_FIX_WORKFLOW.steps[3].dependsOn).toEqual(["fix"]);
      expect(BUG_FIX_WORKFLOW.steps[4].dependsOn).toEqual(["test"]);
    });

    it("should have test step with retry config", () => {
      const testStep = BUG_FIX_WORKFLOW.steps.find((s) => s.id === "test");
      expect(testStep!.retry).toBeDefined();
      expect(testStep!.retry!.maxRetries).toBe(2);
    });

    it("should have step inputs linking to previous steps", () => {
      const diagnose = BUG_FIX_WORKFLOW.steps.find((s) => s.id === "diagnose");
      expect(diagnose!.inputs).toBeDefined();
      expect(diagnose!.inputs!.reproduction.source).toBe("step");
    });
  });

  describe("DEPLOY_WORKFLOW", () => {
    it("should be a valid workflow", () => {
      assertValidWorkflow(DEPLOY_WORKFLOW);
    });

    it("should have id 'deploy'", () => {
      expect(DEPLOY_WORKFLOW.id).toBe("deploy");
    });

    it("should have 5 steps: lint, test, build, review, deploy", () => {
      const stepIds = DEPLOY_WORKFLOW.steps.map((s) => s.id);
      expect(stepIds).toEqual(["lint", "test", "build", "review", "deploy"]);
    });

    it("should form a linear dependency chain", () => {
      expect(DEPLOY_WORKFLOW.steps[0].dependsOn).toEqual([]);
      expect(DEPLOY_WORKFLOW.steps[1].dependsOn).toEqual(["lint"]);
      expect(DEPLOY_WORKFLOW.steps[2].dependsOn).toEqual(["test"]);
      expect(DEPLOY_WORKFLOW.steps[3].dependsOn).toEqual(["build"]);
      expect(DEPLOY_WORKFLOW.steps[4].dependsOn).toEqual(["review"]);
    });

    it("should have an approval gate before deploy", () => {
      const review = DEPLOY_WORKFLOW.steps.find((s) => s.id === "review");
      expect(review!.action.type).toBe("approval");
    });

    it("should have timeouts on critical steps", () => {
      const lint = DEPLOY_WORKFLOW.steps.find((s) => s.id === "lint");
      const test = DEPLOY_WORKFLOW.steps.find((s) => s.id === "test");
      const build = DEPLOY_WORKFLOW.steps.find((s) => s.id === "build");
      const deploy = DEPLOY_WORKFLOW.steps.find((s) => s.id === "deploy");

      expect(lint!.timeout).toBe(60000);
      expect(test!.timeout).toBe(300000);
      expect(build!.timeout).toBe(120000);
      expect(deploy!.timeout).toBe(180000);
    });

    it("should have test step with retry and backoff", () => {
      const test = DEPLOY_WORKFLOW.steps.find((s) => s.id === "test");
      expect(test!.retry).toBeDefined();
      expect(test!.retry!.maxRetries).toBe(2);
      expect(test!.retry!.delay).toBe(3000);
      expect(test!.retry!.backoff).toBe(2);
    });

    it("should have deploy step with onFailure='fail'", () => {
      const deploy = DEPLOY_WORKFLOW.steps.find((s) => s.id === "deploy");
      expect(deploy!.onFailure).toBe("fail");
    });

    it("should use shell actions for lint, test, build, deploy", () => {
      const shellSteps = ["lint", "test", "build", "deploy"];
      for (const stepId of shellSteps) {
        const s = DEPLOY_WORKFLOW.steps.find((s) => s.id === stepId);
        expect(s!.action.type).toBe("shell");
      }
    });
  });
});
