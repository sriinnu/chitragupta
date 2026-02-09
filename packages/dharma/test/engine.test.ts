import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolicyEngine } from "../src/engine.js";
import type {
  PolicyRule,
  PolicyAction,
  PolicyContext,
  PolicyVerdict,
  PolicyEngineConfig,
  PolicySet,
} from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<PolicyEngineConfig> = {}): PolicyEngineConfig {
  return {
    enforce: true,
    costBudget: 10,
    allowedPaths: [],
    deniedPaths: [],
    deniedCommands: [],
    maxFilesPerSession: 50,
    maxCommandsPerSession: 100,
    inheritToSubAgents: false,
    customRules: [],
    ...overrides,
  };
}

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

function makeAction(overrides: Partial<PolicyAction> = {}): PolicyAction {
  return {
    type: "file_read",
    filePath: "/tmp/project/src/index.ts",
    ...overrides,
  };
}

function createAllowRule(id: string, name = "Allow Rule"): PolicyRule {
  return {
    id,
    name,
    description: "Always allows",
    severity: "info",
    category: "custom",
    evaluate: () => ({ status: "allow", ruleId: id, reason: "Allowed" }),
  };
}

function createDenyRule(id: string, name = "Deny Rule"): PolicyRule {
  return {
    id,
    name,
    description: "Always denies",
    severity: "error",
    category: "custom",
    evaluate: () => ({ status: "deny", ruleId: id, reason: "Denied by rule" }),
  };
}

function createWarnRule(id: string, name = "Warn Rule"): PolicyRule {
  return {
    id,
    name,
    description: "Always warns",
    severity: "warning",
    category: "custom",
    evaluate: () => ({ status: "warn", ruleId: id, reason: "Warning issued" }),
  };
}

function createModifyRule(id: string, modification: Partial<PolicyAction>): PolicyRule {
  return {
    id,
    name: "Modify Rule",
    description: "Modifies the action",
    severity: "info",
    category: "custom",
    evaluate: (action) => ({
      status: "modify" as const,
      ruleId: id,
      reason: "Modified",
      modifiedAction: { ...action, ...modification },
    }),
  };
}

function createThrowingRule(id: string): PolicyRule {
  return {
    id,
    name: "Throwing Rule",
    description: "Throws an error during evaluation",
    severity: "error",
    category: "custom",
    evaluate: () => {
      throw new Error("Rule evaluation exploded");
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine(makeConfig());
  });

  // ─── Rule Management ────────────────────────────────────────────────────

  describe("addRule / removeRule", () => {
    it("should add a standalone rule and use it in evaluation", async () => {
      const rule = createDenyRule("test-deny");
      engine.addRule(rule);

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].status).toBe("deny");
      expect(verdicts[0].ruleId).toBe("test-deny");
    });

    it("should remove a standalone rule by ID", async () => {
      engine.addRule(createDenyRule("test-deny"));
      engine.removeRule("test-deny");

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(0);
    });

    it("should replace a rule if added with the same ID", async () => {
      engine.addRule(createDenyRule("rule-1"));
      engine.addRule(createAllowRule("rule-1"));

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].status).toBe("allow");
    });
  });

  // ─── Policy Sets ──────────────────────────────────────────────────────

  describe("addPolicySet / removePolicySet", () => {
    it("should add a policy set and evaluate its rules", async () => {
      const policySet: PolicySet = {
        id: "test-set",
        name: "Test Set",
        description: "A test policy set",
        rules: [createAllowRule("allow-1"), createDenyRule("deny-1")],
        priority: 100,
      };
      engine.addPolicySet(policySet);

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(2);
      expect(verdicts[0].ruleId).toBe("allow-1");
      expect(verdicts[1].ruleId).toBe("deny-1");
    });

    it("should remove a policy set by ID", async () => {
      const policySet: PolicySet = {
        id: "test-set",
        name: "Test Set",
        description: "desc",
        rules: [createDenyRule("deny-1")],
        priority: 100,
      };
      engine.addPolicySet(policySet);
      engine.removePolicySet("test-set");

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(0);
    });
  });

  // ─── Rule Priority Ordering ───────────────────────────────────────────

  describe("rule priority ordering", () => {
    it("should evaluate higher-priority policy sets first", async () => {
      const order: string[] = [];

      const lowRule: PolicyRule = {
        id: "low-rule",
        name: "Low",
        description: "",
        severity: "info",
        category: "custom",
        evaluate: () => {
          order.push("low");
          return { status: "allow", ruleId: "low-rule", reason: "ok" };
        },
      };

      const highRule: PolicyRule = {
        id: "high-rule",
        name: "High",
        description: "",
        severity: "info",
        category: "custom",
        evaluate: () => {
          order.push("high");
          return { status: "allow", ruleId: "high-rule", reason: "ok" };
        },
      };

      engine.addPolicySet({
        id: "low-set",
        name: "Low Set",
        description: "",
        rules: [lowRule],
        priority: 10,
      });

      engine.addPolicySet({
        id: "high-set",
        name: "High Set",
        description: "",
        rules: [highRule],
        priority: 100,
      });

      await engine.evaluate(makeAction(), makeContext());
      expect(order).toEqual(["high", "low"]);
    });

    it("should evaluate standalone rules after policy set rules", async () => {
      const order: string[] = [];

      const setRule: PolicyRule = {
        id: "set-rule",
        name: "Set Rule",
        description: "",
        severity: "info",
        category: "custom",
        evaluate: () => {
          order.push("set");
          return { status: "allow", ruleId: "set-rule", reason: "ok" };
        },
      };

      const standaloneRule: PolicyRule = {
        id: "standalone-rule",
        name: "Standalone",
        description: "",
        severity: "info",
        category: "custom",
        evaluate: () => {
          order.push("standalone");
          return { status: "allow", ruleId: "standalone-rule", reason: "ok" };
        },
      };

      engine.addPolicySet({
        id: "set-1",
        name: "Set 1",
        description: "",
        rules: [setRule],
        priority: 50,
      });
      engine.addRule(standaloneRule);

      await engine.evaluate(makeAction(), makeContext());
      expect(order).toEqual(["set", "standalone"]);
    });
  });

  // ─── evaluate() ───────────────────────────────────────────────────────

  describe("evaluate()", () => {
    it("should return empty array when no rules registered", async () => {
      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toEqual([]);
    });

    it("should NOT short-circuit on deny — evaluates all rules", async () => {
      engine.addRule(createDenyRule("deny-1"));
      engine.addRule(createAllowRule("allow-1"));
      engine.addRule(createDenyRule("deny-2"));

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(3);
      expect(verdicts[0].status).toBe("deny");
      expect(verdicts[1].status).toBe("allow");
      expect(verdicts[2].status).toBe("deny");
    });

    it("should convert thrown errors to deny verdicts", async () => {
      engine.addRule(createThrowingRule("throw-1"));

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].status).toBe("deny");
      expect(verdicts[0].reason).toContain("threw an error");
      expect(verdicts[0].reason).toContain("Rule evaluation exploded");
    });
  });

  // ─── enforce() ────────────────────────────────────────────────────────

  describe("enforce()", () => {
    it("should return allowed=true when all rules allow", async () => {
      engine.addRule(createAllowRule("a1"));
      engine.addRule(createAllowRule("a2"));

      const result = await engine.enforce(makeAction(), makeContext());
      expect(result.allowed).toBe(true);
      expect(result.verdicts).toHaveLength(2);
    });

    it("should short-circuit on first deny when enforce=true", async () => {
      engine.addRule(createDenyRule("deny-1"));
      engine.addRule(createAllowRule("never-reached"));

      const result = await engine.enforce(makeAction(), makeContext());
      expect(result.allowed).toBe(false);
      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].ruleId).toBe("deny-1");
    });

    it("should not short-circuit on deny when enforce=false", async () => {
      engine = new PolicyEngine(makeConfig({ enforce: false }));
      engine.addRule(createDenyRule("deny-1"));
      engine.addRule(createAllowRule("allow-1"));

      const result = await engine.enforce(makeAction(), makeContext());
      // In non-enforce mode, allowed is always true
      expect(result.allowed).toBe(true);
      expect(result.verdicts).toHaveLength(2);
    });

    it("should handle warn status without blocking", async () => {
      engine.addRule(createWarnRule("warn-1"));
      engine.addRule(createAllowRule("allow-1"));

      const result = await engine.enforce(makeAction(), makeContext());
      expect(result.allowed).toBe(true);
      expect(result.verdicts.some((v) => v.status === "warn")).toBe(true);
    });

    it("should apply modify actions and pass modified action to subsequent rules", async () => {
      const modifyRule = createModifyRule("mod-1", { content: "modified-content" });

      const inspectRule: PolicyRule = {
        id: "inspect-1",
        name: "Inspector",
        description: "Inspects the action",
        severity: "info",
        category: "custom",
        evaluate: (action) => ({
          status: "allow",
          ruleId: "inspect-1",
          reason: `Content: ${action.content}`,
        }),
      };

      engine.addRule(modifyRule);
      engine.addRule(inspectRule);

      const result = await engine.enforce(
        makeAction({ content: "original" }),
        makeContext(),
      );

      expect(result.allowed).toBe(true);
      expect(result.modifiedAction).toBeDefined();
      expect(result.modifiedAction!.content).toBe("modified-content");
      // The inspect rule should have received the modified action
      expect(result.verdicts[1].reason).toContain("modified-content");
    });

    it("should treat throwing rules as deny in enforce mode", async () => {
      engine.addRule(createThrowingRule("throw-1"));

      const result = await engine.enforce(makeAction(), makeContext());
      expect(result.allowed).toBe(false);
      expect(result.verdicts[0].status).toBe("deny");
    });
  });

  // ─── Multiple Rules on Same Action ────────────────────────────────────

  describe("multiple rules on the same action", () => {
    it("should accumulate verdicts from multiple rules", async () => {
      engine.addRule(createWarnRule("warn-1"));
      engine.addRule(createWarnRule("warn-2"));
      engine.addRule(createAllowRule("allow-1"));

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(3);
      expect(verdicts.filter((v) => v.status === "warn")).toHaveLength(2);
      expect(verdicts.filter((v) => v.status === "allow")).toHaveLength(1);
    });

    it("should let deny override warn in enforce result", async () => {
      engine.addRule(createWarnRule("warn-first"));
      engine.addRule(createDenyRule("deny-second"));

      const result = await engine.enforce(makeAction(), makeContext());
      expect(result.allowed).toBe(false);
    });
  });

  // ─── Audit Log ────────────────────────────────────────────────────────

  describe("audit log", () => {
    it("should record audit entries during enforce()", async () => {
      engine.addRule(createAllowRule("a1"));

      await engine.enforce(makeAction(), makeContext());
      const log = engine.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].finalDecision).toBe("allow");
    });

    it("should clear audit log", async () => {
      engine.addRule(createAllowRule("a1"));
      await engine.enforce(makeAction(), makeContext());

      engine.clearAuditLog();
      expect(engine.getAuditLog()).toHaveLength(0);
    });
  });

  // ─── Config Import / Export ───────────────────────────────────────────

  describe("exportConfig / importConfig", () => {
    it("should export config without custom rules", () => {
      const exported = engine.exportConfig();
      expect(exported.enforce).toBe(true);
      expect(exported.costBudget).toBe(10);
      expect(exported.customRules).toEqual([]);
    });

    it("should import a new config and re-register custom rules", async () => {
      const newRule = createDenyRule("new-deny");
      engine.importConfig(makeConfig({ customRules: [newRule] }));

      const verdicts = await engine.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].ruleId).toBe("new-deny");
    });
  });

  // ─── Constructor Custom Rules ─────────────────────────────────────────

  describe("constructor custom rules", () => {
    it("should register custom rules from config at construction time", async () => {
      const rule = createAllowRule("init-rule");
      const eng = new PolicyEngine(makeConfig({ customRules: [rule] }));

      const verdicts = await eng.evaluate(makeAction(), makeContext());
      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].ruleId).toBe("init-rule");
    });
  });
});
