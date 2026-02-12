/**
 * @chitragupta/dharma — Budget enforcement rules.
 * Control spending and prevent runaway costs.
 */

import type { PolicyRule, PolicyAction, PolicyContext, PolicyVerdict } from "../types.js";

// ─── Rate Limit State ───────────────────────────────────────────────────────

/** Track LLM call timestamps per session for rate limiting. */
const callTimestamps: Map<string, number[]> = new Map();

const MAX_CALLS_PER_MINUTE = 30;

// ─── Rule Implementations ───────────────────────────────────────────────────

/** Denies LLM calls if totalCostSoFar exceeds costBudget. */
export const budgetLimit: PolicyRule = {
	id: "cost.budget-limit",
	name: "Budget Limit",
	description: "Denies LLM calls when the total session cost exceeds the configured budget",
	severity: "error",
	category: "cost",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		if (action.type !== "llm_call") {
			return { status: "allow", ruleId: this.id, reason: "Not an LLM call" };
		}

		if (context.costBudget <= 0) {
			return { status: "allow", ruleId: this.id, reason: "No budget limit configured" };
		}

		if (context.totalCostSoFar >= context.costBudget) {
			return {
				status: "deny",
				ruleId: this.id,
				reason: `Budget exhausted: spent $${context.totalCostSoFar.toFixed(2)} of $${context.costBudget.toFixed(2)} budget`,
				suggestion: "Increase the budget in your policy configuration or start a new session",
			};
		}

		// Warn when approaching budget (80% threshold)
		if (context.totalCostSoFar >= context.costBudget * 0.8) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `Approaching budget limit: spent $${context.totalCostSoFar.toFixed(2)} of $${context.costBudget.toFixed(2)} (${((context.totalCostSoFar / context.costBudget) * 100).toFixed(0)}%)`,
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Within budget" };
	},
};

/** Warns if a single LLM call is estimated to cost more than $1. */
export const perCallCostWarning: PolicyRule = {
	id: "cost.per-call-cost-warning",
	name: "Per-Call Cost Warning",
	description: "Warns when a single LLM call is estimated to cost more than $1",
	severity: "warning",
	category: "cost",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "llm_call") {
			return { status: "allow", ruleId: this.id, reason: "Not an LLM call" };
		}

		const cost = action.cost ?? 0;
		if (cost > 1.0) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `Single call estimated at $${cost.toFixed(2)} — this is expensive`,
				suggestion: "Consider using a cheaper model or reducing the input size",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Call cost is within acceptable range" };
	},
};

/** Warns when using expensive models (opus-class) for potentially simple tasks. */
export const modelCostGuard: PolicyRule = {
	id: "cost.model-cost-guard",
	name: "Model Cost Guard",
	description: "Warns when using expensive models for potentially simple tasks",
	severity: "warning",
	category: "cost",
	evaluate(action: PolicyAction, _context: PolicyContext): PolicyVerdict {
		if (action.type !== "llm_call") {
			return { status: "allow", ruleId: this.id, reason: "Not an LLM call" };
		}

		const args = action.args ?? {};
		const model = (args.model as string) ?? "";
		const content = action.content ?? "";

		const expensiveModels = ["opus", "claude-opus", "gpt-4", "gpt-4o"];
		const isExpensive = expensiveModels.some((m) => model.toLowerCase().includes(m));

		if (!isExpensive) {
			return { status: "allow", ruleId: this.id, reason: "Model is not classified as expensive" };
		}

		// Heuristic: short prompts (under 500 chars) with no code blocks are likely simple tasks
		const isSimple = content.length < 500 && !content.includes("```");

		if (isSimple) {
			return {
				status: "warn",
				ruleId: this.id,
				reason: `Using expensive model "${model}" for what appears to be a simple task`,
				suggestion: "Consider using a lighter model (e.g., Sonnet or Haiku) for simple queries",
			};
		}

		return { status: "allow", ruleId: this.id, reason: "Expensive model usage appears justified" };
	},
};

/** Denies if more than N LLM calls in the last minute (rate limiting). */
export const rateLimitGuard: PolicyRule = {
	id: "cost.rate-limit-guard",
	name: "Rate Limit Guard",
	description: "Denies if more than 30 LLM calls are made in the last minute",
	severity: "error",
	category: "cost",
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict {
		if (action.type !== "llm_call") {
			return { status: "allow", ruleId: this.id, reason: "Not an LLM call" };
		}

		const now = Date.now();
		const oneMinuteAgo = now - 60_000;
		const key = context.sessionId;

		// Get or create timestamps list for this session
		let timestamps = callTimestamps.get(key);
		if (!timestamps) {
			timestamps = [];
			callTimestamps.set(key, timestamps);
		}

		// Prune old timestamps
		const recent = timestamps.filter((t) => t > oneMinuteAgo);

		if (recent.length >= MAX_CALLS_PER_MINUTE) {
			callTimestamps.set(key, recent);
			return {
				status: "deny",
				ruleId: this.id,
				reason: `Rate limit exceeded: ${recent.length} LLM calls in the last minute (max: ${MAX_CALLS_PER_MINUTE})`,
				suggestion: "Wait a moment before making more LLM calls",
			};
		}

		// Record this call, then persist the updated list
		recent.push(now);
		callTimestamps.set(key, recent);

		return { status: "allow", ruleId: this.id, reason: "Within rate limit" };
	},
};

/** All built-in cost rules. */
export const COST_RULES: PolicyRule[] = [
	budgetLimit,
	perCallCostWarning,
	modelCostGuard,
	rateLimitGuard,
];
