import { describe, it, expect, vi } from "vitest";

vi.mock("@chitragupta/core", () => ({
  getChitraguptaHome: () => "/tmp/mock-chitragupta-home",
}));

import {
  STRICT_PRESET,
  STANDARD_PRESET,
  PERMISSIVE_PRESET,
  READONLY_PRESET,
  REVIEW_PRESET,
  PRESETS,
} from "../src/presets.js";
import { PolicyEngine } from "../src/engine.js";
import type { PolicyAction, PolicyContext } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    sessionId: "sess-1",
    agentId: "agent-1",
    agentDepth: 0,
    projectPath: "/tmp/project",
    totalCostSoFar: 0,
    costBudget: 10,
    filesModified: [],
    commandsRun: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createEngineWithPreset(preset: {
  config: typeof STRICT_PRESET.config;
  policySets: typeof STRICT_PRESET.policySets;
}): PolicyEngine {
  const engine = new PolicyEngine(preset.config);
  for (const policySet of preset.policySets) {
    engine.addPolicySet(policySet);
  }
  return engine;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Policy Presets", () => {
  describe("PRESETS map", () => {
    it("should contain all five presets", () => {
      expect(Object.keys(PRESETS)).toEqual([
        "strict",
        "standard",
        "permissive",
        "readonly",
        "review",
      ]);
    });
  });

  describe("STRICT_PRESET", () => {
    it("should have enforce=true", () => {
      expect(STRICT_PRESET.config.enforce).toBe(true);
    });

    it("should have costBudget of $5", () => {
      expect(STRICT_PRESET.config.costBudget).toBe(5);
    });

    it("should have 20 maxFilesPerSession", () => {
      expect(STRICT_PRESET.config.maxFilesPerSession).toBe(20);
    });

    it("should have 50 maxCommandsPerSession", () => {
      expect(STRICT_PRESET.config.maxCommandsPerSession).toBe(50);
    });

    it("should inherit to sub-agents", () => {
      expect(STRICT_PRESET.config.inheritToSubAgents).toBe(true);
    });

    it("should have 4 policy sets (security, cost, scope, convention)", () => {
      expect(STRICT_PRESET.policySets).toHaveLength(4);
    });

    it("should deny destructive commands", async () => {
      const engine = createEngineWithPreset(STRICT_PRESET);
      const action: PolicyAction = { type: "shell_exec", command: "rm -rf /" };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(false);
    });

    it("should deny denied paths like node_modules", () => {
      expect(STRICT_PRESET.config.deniedPaths).toContain("**/node_modules/**");
    });

    it("should deny dangerous commands like sudo", () => {
      expect(STRICT_PRESET.config.deniedCommands).toContain("sudo");
    });
  });

  describe("STANDARD_PRESET", () => {
    it("should have enforce=true", () => {
      expect(STANDARD_PRESET.config.enforce).toBe(true);
    });

    it("should have costBudget of $20", () => {
      expect(STANDARD_PRESET.config.costBudget).toBe(20);
    });

    it("should have 50 maxFilesPerSession", () => {
      expect(STANDARD_PRESET.config.maxFilesPerSession).toBe(50);
    });

    it("should have 4 policy sets", () => {
      expect(STANDARD_PRESET.policySets).toHaveLength(4);
    });

    it("should deny rm -rf /", async () => {
      const engine = createEngineWithPreset(STANDARD_PRESET);
      const action: PolicyAction = { type: "shell_exec", command: "rm -rf /" };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(false);
    });
  });

  describe("PERMISSIVE_PRESET", () => {
    it("should have enforce=false", () => {
      expect(PERMISSIVE_PRESET.config.enforce).toBe(false);
    });

    it("should have costBudget of 0 (unlimited)", () => {
      expect(PERMISSIVE_PRESET.config.costBudget).toBe(0);
    });

    it("should have 0 maxFilesPerSession (unlimited)", () => {
      expect(PERMISSIVE_PRESET.config.maxFilesPerSession).toBe(0);
    });

    it("should not inherit to sub-agents", () => {
      expect(PERMISSIVE_PRESET.config.inheritToSubAgents).toBe(false);
    });

    it("should have only 1 policy set (critical security)", () => {
      expect(PERMISSIVE_PRESET.policySets).toHaveLength(1);
    });

    it("should have empty denied commands", () => {
      expect(PERMISSIVE_PRESET.config.deniedCommands).toEqual([]);
    });

    it("should still deny secrets in prompts even in permissive mode", async () => {
      const engine = createEngineWithPreset(PERMISSIVE_PRESET);
      const action: PolicyAction = {
        type: "llm_call",
        content: "My API key is sk-abcdefghijklmnopqrstuv",
      };
      const verdicts = await engine.evaluate(action, makeContext());
      const denyVerdicts = verdicts.filter((v) => v.status === "deny");
      expect(denyVerdicts.length).toBeGreaterThan(0);
    });
  });

  describe("READONLY_PRESET", () => {
    it("should have enforce=true", () => {
      expect(READONLY_PRESET.config.enforce).toBe(true);
    });

    it("should have costBudget of $10", () => {
      expect(READONLY_PRESET.config.costBudget).toBe(10);
    });

    it("should deny file_write operations", async () => {
      const engine = createEngineWithPreset(READONLY_PRESET);
      const action: PolicyAction = {
        type: "file_write",
        filePath: "/tmp/project/src/test.ts",
        content: "test",
      };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(false);
      const denyVerdicts = result.verdicts.filter((v) => v.status === "deny");
      expect(denyVerdicts.some((v) => v.reason.includes("Read-only mode"))).toBe(true);
    });

    it("should deny file_delete operations", async () => {
      const engine = createEngineWithPreset(READONLY_PRESET);
      const action: PolicyAction = {
        type: "file_delete",
        filePath: "/tmp/project/src/test.ts",
      };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(false);
    });

    it("should deny shell_exec operations", async () => {
      const engine = createEngineWithPreset(READONLY_PRESET);
      const action: PolicyAction = {
        type: "shell_exec",
        command: "echo hello",
      };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(false);
    });

    it("should allow file_read operations", async () => {
      const engine = createEngineWithPreset(READONLY_PRESET);
      const action: PolicyAction = {
        type: "file_read",
        filePath: "/tmp/project/src/test.ts",
      };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(true);
    });
  });

  describe("REVIEW_PRESET", () => {
    it("should have enforce=true", () => {
      expect(REVIEW_PRESET.config.enforce).toBe(true);
    });

    it("should have costBudget of $15", () => {
      expect(REVIEW_PRESET.config.costBudget).toBe(15);
    });

    it("should have 10 maxCommandsPerSession", () => {
      expect(REVIEW_PRESET.config.maxCommandsPerSession).toBe(10);
    });

    it("should deny file_write operations", async () => {
      const engine = createEngineWithPreset(REVIEW_PRESET);
      const action: PolicyAction = {
        type: "file_write",
        filePath: "/tmp/project/test.ts",
        content: "test",
      };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(false);
      const denyVerdicts = result.verdicts.filter((v) => v.status === "deny");
      expect(denyVerdicts.some((v) => v.reason.includes("Review mode"))).toBe(true);
    });

    it("should deny agent_spawn operations", async () => {
      const engine = createEngineWithPreset(REVIEW_PRESET);
      const action: PolicyAction = { type: "agent_spawn" };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(false);
    });

    it("should allow shell_exec operations (limited review commands)", async () => {
      const engine = createEngineWithPreset(REVIEW_PRESET);
      const action: PolicyAction = {
        type: "shell_exec",
        command: "git log --oneline",
      };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(true);
    });

    it("should allow file_read operations", async () => {
      const engine = createEngineWithPreset(REVIEW_PRESET);
      const action: PolicyAction = {
        type: "file_read",
        filePath: "/tmp/project/src/main.ts",
      };
      const result = await engine.enforce(action, makeContext());
      expect(result.allowed).toBe(true);
    });
  });

  describe("preset behavior differences", () => {
    it("STRICT should deny what PERMISSIVE allows (file writes to non-denied paths)", async () => {
      // PERMISSIVE has enforce=false, so it never blocks. But STRICT enforces.
      const strictEngine = createEngineWithPreset(STRICT_PRESET);
      const permissiveEngine = createEngineWithPreset(PERMISSIVE_PRESET);

      const action: PolicyAction = {
        type: "shell_exec",
        command: "rm -rf /tmp/test",
      };
      const ctx = makeContext();

      const strictResult = await strictEngine.enforce(action, ctx);
      const permissiveResult = await permissiveEngine.enforce(action, ctx);

      // STRICT denies, PERMISSIVE allows (enforce=false)
      expect(strictResult.allowed).toBe(false);
      expect(permissiveResult.allowed).toBe(true);
    });

    it("READONLY should be stricter than REVIEW for shell commands", async () => {
      const readonlyEngine = createEngineWithPreset(READONLY_PRESET);
      const reviewEngine = createEngineWithPreset(REVIEW_PRESET);

      const action: PolicyAction = {
        type: "shell_exec",
        command: "git status",
      };
      const ctx = makeContext();

      const readonlyResult = await readonlyEngine.enforce(action, ctx);
      const reviewResult = await reviewEngine.enforce(action, ctx);

      expect(readonlyResult.allowed).toBe(false);
      expect(reviewResult.allowed).toBe(true);
    });
  });
});
