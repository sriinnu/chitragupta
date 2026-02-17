import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PolicyAction, PolicyContext } from "@chitragupta/dharma";
import {
	budgetLimit,
	perCallCostWarning,
	modelCostGuard,
	rateLimitGuard,
	COST_RULES,
} from "@chitragupta/dharma";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<PolicyAction> = {}): PolicyAction {
	return {
		type: "llm_call",
		content: "Hello, how are you?",
		cost: 0.05,
		...overrides,
	};
}

function makeContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
	return {
		sessionId: "sess-cost-001",
		agentId: "agent-001",
		agentDepth: 0,
		projectPath: "/project",
		totalCostSoFar: 0,
		costBudget: 10,
		filesModified: [],
		commandsRun: [],
		timestamp: Date.now(),
		...overrides,
	};
}

// ─── budgetLimit ────────────────────────────────────────────────────────────

describe("budgetLimit", () => {
	it("allows non-llm_call actions", async () => {
		const verdict = await budgetLimit.evaluate(
			makeAction({ type: "file_write" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when costBudget is 0 (unlimited)", async () => {
		const verdict = await budgetLimit.evaluate(
			makeAction(),
			makeContext({ costBudget: 0 }),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("denies when totalCostSoFar >= costBudget", async () => {
		const verdict = await budgetLimit.evaluate(
			makeAction(),
			makeContext({ totalCostSoFar: 10, costBudget: 10 }),
		);
		expect(verdict).toMatchObject({ status: "deny" });
		expect(verdict.reason).toContain("exhausted");
	});

	it("denies when totalCostSoFar exceeds costBudget", async () => {
		const verdict = await budgetLimit.evaluate(
			makeAction(),
			makeContext({ totalCostSoFar: 15, costBudget: 10 }),
		);
		expect(verdict).toMatchObject({ status: "deny" });
	});

	it("warns when at 80% of budget", async () => {
		const verdict = await budgetLimit.evaluate(
			makeAction(),
			makeContext({ totalCostSoFar: 8, costBudget: 10 }),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("80%");
	});

	it("warns when between 80% and 100% of budget", async () => {
		const verdict = await budgetLimit.evaluate(
			makeAction(),
			makeContext({ totalCostSoFar: 9.5, costBudget: 10 }),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("allows when under 80% of budget", async () => {
		const verdict = await budgetLimit.evaluate(
			makeAction(),
			makeContext({ totalCostSoFar: 5, costBudget: 10 }),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(budgetLimit.id).toBe("cost.budget-limit");
		expect(budgetLimit.category).toBe("cost");
		expect(budgetLimit.severity).toBe("error");
	});
});

// ─── perCallCostWarning ─────────────────────────────────────────────────────

describe("perCallCostWarning", () => {
	it("allows non-llm_call actions", async () => {
		const verdict = await perCallCostWarning.evaluate(
			makeAction({ type: "file_read" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("warns when action.cost > 1.0", async () => {
		const verdict = await perCallCostWarning.evaluate(
			makeAction({ cost: 1.5 }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("$1.50");
	});

	it("allows when action.cost <= 1.0", async () => {
		const verdict = await perCallCostWarning.evaluate(
			makeAction({ cost: 1.0 }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when action.cost is 0", async () => {
		const verdict = await perCallCostWarning.evaluate(
			makeAction({ cost: 0 }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when action.cost is undefined (defaults to 0)", async () => {
		const verdict = await perCallCostWarning.evaluate(
			makeAction({ cost: undefined }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(perCallCostWarning.id).toBe("cost.per-call-cost-warning");
	});
});

// ─── modelCostGuard ─────────────────────────────────────────────────────────

describe("modelCostGuard", () => {
	it("allows non-llm_call actions", async () => {
		const verdict = await modelCostGuard.evaluate(
			makeAction({ type: "tool_call" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows non-expensive models", async () => {
		const verdict = await modelCostGuard.evaluate(
			makeAction({ args: { model: "claude-sonnet-4-20250514" }, content: "hi" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("warns on expensive model with short simple content", async () => {
		const verdict = await modelCostGuard.evaluate(
			makeAction({ args: { model: "claude-opus-4-20250514" }, content: "What is 2+2?" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
		expect(verdict.reason).toContain("expensive model");
	});

	it("warns on gpt-4 with short simple content", async () => {
		const verdict = await modelCostGuard.evaluate(
			makeAction({ args: { model: "gpt-4" }, content: "Summarize this." }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "warn" });
	});

	it("allows expensive model with complex content (long with code blocks)", async () => {
		const longContent = "Please review this code:\n" + "x".repeat(600) + "\n```ts\nconst x = 1;\n```\n";
		const verdict = await modelCostGuard.evaluate(
			makeAction({ args: { model: "claude-opus-4-20250514" }, content: longContent }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows expensive model with long content even without code blocks", async () => {
		const longContent = "x".repeat(600);
		const verdict = await modelCostGuard.evaluate(
			makeAction({ args: { model: "gpt-4o" }, content: longContent }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when no model specified", async () => {
		const verdict = await modelCostGuard.evaluate(
			makeAction({ args: {} }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows when no args specified", async () => {
		const verdict = await modelCostGuard.evaluate(
			makeAction({ args: undefined }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(modelCostGuard.id).toBe("cost.model-cost-guard");
	});
});

// ─── rateLimitGuard ─────────────────────────────────────────────────────────

describe("rateLimitGuard", () => {
	it("allows non-llm_call actions", async () => {
		const verdict = await rateLimitGuard.evaluate(
			makeAction({ type: "file_write" }),
			makeContext(),
		);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("allows calls under the rate limit", async () => {
		const ctx = makeContext({ sessionId: "rate-test-under" });
		for (let i = 0; i < 5; i++) {
			const verdict = await rateLimitGuard.evaluate(makeAction(), ctx);
			expect(verdict).toMatchObject({ status: "allow" });
		}
	});

	it("denies when exceeding 30 calls per minute", async () => {
		const ctx = makeContext({ sessionId: "rate-test-over" });
		// Make 30 allowed calls
		for (let i = 0; i < 30; i++) {
			const verdict = await rateLimitGuard.evaluate(makeAction(), ctx);
			expect(verdict).toMatchObject({ status: "allow" });
		}
		// The 31st call should be denied
		const verdict = await rateLimitGuard.evaluate(makeAction(), ctx);
		expect(verdict).toMatchObject({ status: "deny" });
		expect(verdict.reason).toContain("Rate limit");
	});

	it("uses separate rate limits per session", async () => {
		const ctx1 = makeContext({ sessionId: "rate-sess-A" });
		const ctx2 = makeContext({ sessionId: "rate-sess-B" });
		// Fill up session A
		for (let i = 0; i < 30; i++) {
			await rateLimitGuard.evaluate(makeAction(), ctx1);
		}
		// Session B should still be fine
		const verdict = await rateLimitGuard.evaluate(makeAction(), ctx2);
		expect(verdict).toMatchObject({ status: "allow" });
	});

	it("has correct metadata", () => {
		expect(rateLimitGuard.id).toBe("cost.rate-limit-guard");
		expect(rateLimitGuard.severity).toBe("error");
	});
});

// ─── COST_RULES ─────────────────────────────────────────────────────────────

describe("COST_RULES", () => {
	it("is an array of exactly 4 rules", () => {
		expect(COST_RULES).toHaveLength(4);
	});

	it("contains all cost rules", () => {
		const ids = COST_RULES.map((r) => r.id);
		expect(ids).toContain("cost.budget-limit");
		expect(ids).toContain("cost.per-call-cost-warning");
		expect(ids).toContain("cost.model-cost-guard");
		expect(ids).toContain("cost.rate-limit-guard");
	});

	it("all rules have category cost", () => {
		for (const rule of COST_RULES) {
			expect(rule.category).toBe("cost");
		}
	});

	it("all rules have an evaluate function", () => {
		for (const rule of COST_RULES) {
			expect(typeof rule.evaluate).toBe("function");
		}
	});
});
