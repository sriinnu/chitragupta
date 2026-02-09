import { describe, it, expect } from "vitest";
import {
	CODE_REVIEW_PLAN,
	TDD_PLAN,
	REFACTOR_PLAN,
	BUG_HUNT_PLAN,
	DOCUMENTATION_PLAN,
} from "@chitragupta/niyanta";
import type { OrchestrationPlan } from "@chitragupta/niyanta";

// ─── Shared Helpers ─────────────────────────────────────────────────────────

const ALL_PLANS: [string, OrchestrationPlan][] = [
	["CODE_REVIEW_PLAN", CODE_REVIEW_PLAN],
	["TDD_PLAN", TDD_PLAN],
	["REFACTOR_PLAN", REFACTOR_PLAN],
	["BUG_HUNT_PLAN", BUG_HUNT_PLAN],
	["DOCUMENTATION_PLAN", DOCUMENTATION_PLAN],
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("presets", () => {
	// ── Common structural checks ─────────────────────────────────────────

	describe("common structure", () => {
		it.each(ALL_PLANS)("%s should have a non-empty id", (_name, plan) => {
			expect(plan.id).toBeTruthy();
			expect(typeof plan.id).toBe("string");
		});

		it.each(ALL_PLANS)("%s should have a non-empty name", (_name, plan) => {
			expect(plan.name).toBeTruthy();
			expect(typeof plan.name).toBe("string");
		});

		it.each(ALL_PLANS)("%s should have a valid strategy", (_name, plan) => {
			const validStrategies = [
				"round-robin", "least-loaded", "specialized",
				"hierarchical", "swarm", "competitive", "custom",
			];
			expect(validStrategies).toContain(plan.strategy);
		});

		it.each(ALL_PLANS)("%s should have at least one agent", (_name, plan) => {
			expect(plan.agents.length).toBeGreaterThanOrEqual(1);
		});

		it.each(ALL_PLANS)("%s agents should have non-empty capabilities", (_name, plan) => {
			for (const agent of plan.agents) {
				expect(agent.capabilities.length).toBeGreaterThan(0);
			}
		});

		it.each(ALL_PLANS)("%s agents should have maxConcurrent >= 1", (_name, plan) => {
			for (const agent of plan.agents) {
				expect(agent.maxConcurrent).toBeGreaterThanOrEqual(1);
			}
		});

		it.each(ALL_PLANS)("%s agents should have minInstances <= maxInstances", (_name, plan) => {
			for (const agent of plan.agents) {
				if (agent.minInstances !== undefined && agent.maxInstances !== undefined) {
					expect(agent.minInstances).toBeLessThanOrEqual(agent.maxInstances);
				}
			}
		});

		it.each(ALL_PLANS)("%s agents should have unique ids", (_name, plan) => {
			const ids = plan.agents.map((a) => a.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it.each(ALL_PLANS)("%s should have at least one routing rule", (_name, plan) => {
			expect(plan.routing.length).toBeGreaterThanOrEqual(1);
		});

		it.each(ALL_PLANS)("%s should have a fallback routing rule (type 'always', priority 0)", (_name, plan) => {
			const fallbackRule = plan.routing.find(
				(r) => r.match.type === "always" && r.priority === 0,
			);
			expect(fallbackRule).toBeDefined();
		});

		it.each(ALL_PLANS)("%s routing rules should have valid match types", (_name, plan) => {
			const validTypes = ["keyword", "pattern", "capability", "file_type", "always", "expression"];
			for (const rule of plan.routing) {
				expect(validTypes).toContain(rule.match.type);
			}
		});

		it.each(ALL_PLANS)("%s non-fallback routing rules should have priority > 0", (_name, plan) => {
			for (const rule of plan.routing) {
				if (rule.match.type !== "always") {
					expect(rule.priority).toBeGreaterThan(0);
				}
			}
		});

		it.each(ALL_PLANS)("%s routing rule targets should reference valid agent ids", (_name, plan) => {
			const agentIds = new Set(plan.agents.map((a) => a.id));
			for (const rule of plan.routing) {
				expect(agentIds.has(rule.target)).toBe(true);
			}
		});

		it.each(ALL_PLANS)("%s should have a coordination config", (_name, plan) => {
			expect(plan.coordination).toBeDefined();
			expect(typeof plan.coordination.sharedContext).toBe("boolean");
			expect(typeof plan.coordination.tolerateFailures).toBe("boolean");
		});
	});

	// ── CODE_REVIEW_PLAN ─────────────────────────────────────────────────

	describe("CODE_REVIEW_PLAN", () => {
		it("should have the correct id", () => {
			expect(CODE_REVIEW_PLAN.id).toBe("preset:code-review");
		});

		it("should use hierarchical strategy", () => {
			expect(CODE_REVIEW_PLAN.strategy).toBe("hierarchical");
		});

		it("should have 2 agents: writer and reviewer", () => {
			expect(CODE_REVIEW_PLAN.agents).toHaveLength(2);
			const ids = CODE_REVIEW_PLAN.agents.map((a) => a.id);
			expect(ids).toContain("writer");
			expect(ids).toContain("reviewer");
		});

		it("writer should have code-writer role", () => {
			const writer = CODE_REVIEW_PLAN.agents.find((a) => a.id === "writer");
			expect(writer!.role).toBe("code-writer");
		});

		it("reviewer should have code-reviewer role", () => {
			const reviewer = CODE_REVIEW_PLAN.agents.find((a) => a.id === "reviewer");
			expect(reviewer!.role).toBe("code-reviewer");
		});

		it("should have 4 routing rules", () => {
			expect(CODE_REVIEW_PLAN.routing).toHaveLength(4);
		});

		it("should use chain aggregation with shared context and no failure tolerance", () => {
			expect(CODE_REVIEW_PLAN.coordination.aggregation).toBe("chain");
			expect(CODE_REVIEW_PLAN.coordination.sharedContext).toBe(true);
			expect(CODE_REVIEW_PLAN.coordination.tolerateFailures).toBe(false);
		});

		it("should escalate to human on fallback", () => {
			expect(CODE_REVIEW_PLAN.fallback?.escalateToHuman).toBe(true);
		});
	});

	// ── TDD_PLAN ─────────────────────────────────────────────────────────

	describe("TDD_PLAN", () => {
		it("should have the correct id", () => {
			expect(TDD_PLAN.id).toBe("preset:tdd");
		});

		it("should use round-robin strategy", () => {
			expect(TDD_PLAN.strategy).toBe("round-robin");
		});

		it("should have 3 agents: test-writer, implementer, tester", () => {
			expect(TDD_PLAN.agents).toHaveLength(3);
			const ids = TDD_PLAN.agents.map((a) => a.id);
			expect(ids).toContain("test-writer");
			expect(ids).toContain("implementer");
			expect(ids).toContain("tester");
		});

		it("should have 5 routing rules", () => {
			expect(TDD_PLAN.routing).toHaveLength(5);
		});

		it("test-writer should have the test-writer role", () => {
			const tw = TDD_PLAN.agents.find((a) => a.id === "test-writer");
			expect(tw!.role).toBe("test-writer");
		});

		it("implementer should have the code-writer role", () => {
			const impl = TDD_PLAN.agents.find((a) => a.id === "implementer");
			expect(impl!.role).toBe("code-writer");
		});

		it("should use chain aggregation", () => {
			expect(TDD_PLAN.coordination.aggregation).toBe("chain");
		});

		it("should escalate to human", () => {
			expect(TDD_PLAN.fallback?.escalateToHuman).toBe(true);
		});
	});

	// ── REFACTOR_PLAN ────────────────────────────────────────────────────

	describe("REFACTOR_PLAN", () => {
		it("should have the correct id", () => {
			expect(REFACTOR_PLAN.id).toBe("preset:refactor");
		});

		it("should use round-robin strategy", () => {
			expect(REFACTOR_PLAN.strategy).toBe("round-robin");
		});

		it("should have 4 agents: analyzer, planner, executor, verifier", () => {
			expect(REFACTOR_PLAN.agents).toHaveLength(4);
			const ids = REFACTOR_PLAN.agents.map((a) => a.id);
			expect(ids).toContain("analyzer");
			expect(ids).toContain("planner");
			expect(ids).toContain("executor");
			expect(ids).toContain("verifier");
		});

		it("should have 7 routing rules", () => {
			expect(REFACTOR_PLAN.routing).toHaveLength(7);
		});

		it("executor should support auto-scaling", () => {
			const executor = REFACTOR_PLAN.agents.find((a) => a.id === "executor");
			expect(executor!.autoScale).toBe(true);
			expect(executor!.minInstances).toBe(1);
			expect(executor!.maxInstances).toBe(3);
		});

		it("should use chain aggregation with shared context", () => {
			expect(REFACTOR_PLAN.coordination.aggregation).toBe("chain");
			expect(REFACTOR_PLAN.coordination.sharedContext).toBe(true);
		});

		it("should have expression-type routing rules", () => {
			const exprRules = REFACTOR_PLAN.routing.filter((r) => r.match.type === "expression");
			expect(exprRules.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ── BUG_HUNT_PLAN ────────────────────────────────────────────────────

	describe("BUG_HUNT_PLAN", () => {
		it("should have the correct id", () => {
			expect(BUG_HUNT_PLAN.id).toBe("preset:bug-hunt");
		});

		it("should use competitive strategy", () => {
			expect(BUG_HUNT_PLAN.strategy).toBe("competitive");
		});

		it("should have 3 investigator agents", () => {
			expect(BUG_HUNT_PLAN.agents).toHaveLength(3);
			for (const agent of BUG_HUNT_PLAN.agents) {
				expect(agent.id).toMatch(/^investigator-\d$/);
				expect(agent.role).toBe("bug-investigator");
			}
		});

		it("should have 1 routing rule (fallback only)", () => {
			expect(BUG_HUNT_PLAN.routing).toHaveLength(1);
			expect(BUG_HUNT_PLAN.routing[0].match.type).toBe("always");
		});

		it("should use first-wins aggregation", () => {
			expect(BUG_HUNT_PLAN.coordination.aggregation).toBe("first-wins");
		});

		it("should not share context between agents", () => {
			expect(BUG_HUNT_PLAN.coordination.sharedContext).toBe(false);
		});

		it("should tolerate failures with maxFailures=2", () => {
			expect(BUG_HUNT_PLAN.coordination.tolerateFailures).toBe(true);
			expect(BUG_HUNT_PLAN.coordination.maxFailures).toBe(2);
		});

		it("should escalate to human", () => {
			expect(BUG_HUNT_PLAN.fallback?.escalateToHuman).toBe(true);
		});

		it("all investigators should have unique capabilities", () => {
			const capSets = BUG_HUNT_PLAN.agents.map((a) =>
				a.capabilities.sort().join(","),
			);
			const unique = new Set(capSets);
			// Each investigator has a different set of capabilities
			expect(unique.size).toBe(3);
		});
	});

	// ── DOCUMENTATION_PLAN ───────────────────────────────────────────────

	describe("DOCUMENTATION_PLAN", () => {
		it("should have the correct id", () => {
			expect(DOCUMENTATION_PLAN.id).toBe("preset:documentation");
		});

		it("should use specialized strategy", () => {
			expect(DOCUMENTATION_PLAN.strategy).toBe("specialized");
		});

		it("should have 2 agents: code-reader and doc-writer", () => {
			expect(DOCUMENTATION_PLAN.agents).toHaveLength(2);
			const ids = DOCUMENTATION_PLAN.agents.map((a) => a.id);
			expect(ids).toContain("code-reader");
			expect(ids).toContain("doc-writer");
		});

		it("should have 6 routing rules", () => {
			expect(DOCUMENTATION_PLAN.routing).toHaveLength(6);
		});

		it("code-reader should have code-analyzer role", () => {
			const cr = DOCUMENTATION_PLAN.agents.find((a) => a.id === "code-reader");
			expect(cr!.role).toBe("code-analyzer");
		});

		it("doc-writer should have documenter role", () => {
			const dw = DOCUMENTATION_PLAN.agents.find((a) => a.id === "doc-writer");
			expect(dw!.role).toBe("documenter");
		});

		it("should have file_type routing rules", () => {
			const fileRules = DOCUMENTATION_PLAN.routing.filter((r) => r.match.type === "file_type");
			expect(fileRules.length).toBeGreaterThanOrEqual(2);
		});

		it("should NOT escalate to human on fallback", () => {
			expect(DOCUMENTATION_PLAN.fallback?.escalateToHuman).toBe(false);
		});

		it("code-reader should support auto-scaling", () => {
			const cr = DOCUMENTATION_PLAN.agents.find((a) => a.id === "code-reader");
			expect(cr!.autoScale).toBe(true);
			expect(cr!.minInstances).toBe(1);
			expect(cr!.maxInstances).toBe(3);
		});

		it("should use chain aggregation with shared context", () => {
			expect(DOCUMENTATION_PLAN.coordination.aggregation).toBe("chain");
			expect(DOCUMENTATION_PLAN.coordination.sharedContext).toBe(true);
		});
	});
});
