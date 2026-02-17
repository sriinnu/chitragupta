/**
 * Pre-built orchestration plans for common development workflows.
 */

import type { OrchestrationPlan } from "./types.js";

// ─── Code Review Plan ────────────────────────────────────────────────────────

/**
 * CODE_REVIEW_PLAN: A writer produces code, then a reviewer inspects it.
 * Hierarchical strategy with a review gate.
 */
export const CODE_REVIEW_PLAN: OrchestrationPlan = {
	id: "preset:code-review",
	name: "Code Review Pipeline",
	strategy: "hierarchical",
	agents: [
		{
			id: "writer",
			role: "code-writer",
			capabilities: ["code-writing", "implementation", "typescript", "python"],
			maxConcurrent: 2,
			autoScale: false,
			minInstances: 1,
			maxInstances: 2,
		},
		{
			id: "reviewer",
			role: "code-reviewer",
			capabilities: ["code-review", "analysis", "best-practices", "security"],
			maxConcurrent: 1,
			autoScale: false,
			minInstances: 1,
			maxInstances: 1,
		},
	],
	routing: [
		{
			id: "route-write",
			match: { type: "keyword", keywords: ["write", "implement", "create", "build", "fix"] },
			target: "writer",
			priority: 20,
		},
		{
			id: "route-review",
			match: { type: "keyword", keywords: ["review", "check", "inspect", "audit"] },
			target: "reviewer",
			priority: 20,
		},
		{
			id: "route-review-type",
			match: { type: "expression", expr: 'task.type == "review"' },
			target: "reviewer",
			priority: 30,
		},
		{
			id: "route-fallback",
			match: { type: "always" },
			target: "writer",
			priority: 0,
		},
	],
	coordination: {
		aggregation: "chain",
		sharedContext: true,
		tolerateFailures: false,
	},
	fallback: {
		escalateToHuman: true,
	},
};

// ─── TDD Plan ────────────────────────────────────────────────────────────────

/**
 * TDD_PLAN: Test-writer writes tests first, implementer writes code,
 * then tester verifies. Chain strategy.
 */
export const TDD_PLAN: OrchestrationPlan = {
	id: "preset:tdd",
	name: "Test-Driven Development Pipeline",
	strategy: "round-robin",
	agents: [
		{
			id: "test-writer",
			role: "test-writer",
			capabilities: ["testing", "test-design", "assertions", "mocking"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
		{
			id: "implementer",
			role: "code-writer",
			capabilities: ["code-writing", "implementation", "tdd"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
		{
			id: "tester",
			role: "tester",
			capabilities: ["testing", "verification", "integration-testing"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
	],
	routing: [
		{
			id: "route-test-write",
			match: { type: "keyword", keywords: ["write test", "create test", "test spec"] },
			target: "test-writer",
			priority: 30,
		},
		{
			id: "route-implement",
			match: { type: "keyword", keywords: ["implement", "write code", "create", "build"] },
			target: "implementer",
			priority: 20,
		},
		{
			id: "route-verify",
			match: { type: "keyword", keywords: ["run test", "verify", "validate", "check"] },
			target: "tester",
			priority: 20,
		},
		{
			id: "route-test-type",
			match: { type: "expression", expr: 'task.type == "test"' },
			target: "tester",
			priority: 25,
		},
		{
			id: "route-fallback",
			match: { type: "always" },
			target: "implementer",
			priority: 0,
		},
	],
	coordination: {
		aggregation: "chain",
		sharedContext: true,
		tolerateFailures: false,
	},
	fallback: {
		escalateToHuman: true,
	},
};

// ─── Refactor Plan ───────────────────────────────────────────────────────────

/**
 * REFACTOR_PLAN: Analyzer identifies issues, planner creates a strategy,
 * executor performs the refactor, verifier confirms correctness.
 * Chain with rollback on verification failure.
 */
export const REFACTOR_PLAN: OrchestrationPlan = {
	id: "preset:refactor",
	name: "Refactoring Pipeline",
	strategy: "round-robin",
	agents: [
		{
			id: "analyzer",
			role: "code-analyzer",
			capabilities: ["analysis", "code-review", "complexity-analysis", "smell-detection"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
		{
			id: "planner",
			role: "refactor-planner",
			capabilities: ["planning", "architecture", "design-patterns"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
		{
			id: "executor",
			role: "code-writer",
			capabilities: ["code-writing", "refactoring", "implementation"],
			maxConcurrent: 2,
			autoScale: true,
			minInstances: 1,
			maxInstances: 3,
		},
		{
			id: "verifier",
			role: "verifier",
			capabilities: ["testing", "verification", "regression-testing"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
	],
	routing: [
		{
			id: "route-analyze",
			match: { type: "keyword", keywords: ["analyze", "identify", "assess", "detect"] },
			target: "analyzer",
			priority: 30,
		},
		{
			id: "route-plan",
			match: { type: "keyword", keywords: ["plan", "strategy", "design", "outline"] },
			target: "planner",
			priority: 30,
		},
		{
			id: "route-execute",
			match: { type: "keyword", keywords: ["refactor", "rewrite", "restructure", "extract"] },
			target: "executor",
			priority: 20,
		},
		{
			id: "route-verify",
			match: { type: "keyword", keywords: ["verify", "test", "validate", "confirm"] },
			target: "verifier",
			priority: 20,
		},
		{
			id: "route-analyze-type",
			match: { type: "expression", expr: 'task.type == "analyze"' },
			target: "analyzer",
			priority: 25,
		},
		{
			id: "route-refactor-type",
			match: { type: "expression", expr: 'task.type == "refactor"' },
			target: "executor",
			priority: 25,
		},
		{
			id: "route-fallback",
			match: { type: "always" },
			target: "executor",
			priority: 0,
		},
	],
	coordination: {
		aggregation: "chain",
		sharedContext: true,
		tolerateFailures: false,
	},
	fallback: {
		escalateToHuman: true,
	},
};

// ─── Bug Hunt Plan ───────────────────────────────────────────────────────────

/**
 * BUG_HUNT_PLAN: Multiple agents investigate a bug in parallel.
 * Competitive strategy — best diagnosis wins.
 */
export const BUG_HUNT_PLAN: OrchestrationPlan = {
	id: "preset:bug-hunt",
	name: "Bug Hunt (Competitive)",
	strategy: "competitive",
	agents: [
		{
			id: "investigator-1",
			role: "bug-investigator",
			capabilities: ["debugging", "analysis", "stack-traces", "logging"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
		{
			id: "investigator-2",
			role: "bug-investigator",
			capabilities: ["debugging", "analysis", "reproduction", "bisect"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
		{
			id: "investigator-3",
			role: "bug-investigator",
			capabilities: ["debugging", "analysis", "root-cause", "performance"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 1,
		},
	],
	routing: [
		{
			id: "route-fallback",
			match: { type: "always" },
			target: "investigator-1",
			priority: 0,
		},
	],
	coordination: {
		aggregation: "first-wins",
		sharedContext: false,
		tolerateFailures: true,
		maxFailures: 2,
	},
	fallback: {
		escalateToHuman: true,
	},
};

// ─── Documentation Plan ──────────────────────────────────────────────────────

/**
 * DOCUMENTATION_PLAN: A code-reader analyzes the codebase, then a doc-writer
 * produces documentation. Specialized routing.
 */
export const DOCUMENTATION_PLAN: OrchestrationPlan = {
	id: "preset:documentation",
	name: "Documentation Pipeline",
	strategy: "specialized",
	agents: [
		{
			id: "code-reader",
			role: "code-analyzer",
			capabilities: ["analysis", "code-reading", "api-extraction", "type-analysis"],
			maxConcurrent: 2,
			autoScale: true,
			minInstances: 1,
			maxInstances: 3,
		},
		{
			id: "doc-writer",
			role: "documenter",
			capabilities: ["documentation", "technical-writing", "markdown", "examples"],
			maxConcurrent: 1,
			minInstances: 1,
			maxInstances: 2,
		},
	],
	routing: [
		{
			id: "route-analyze",
			match: { type: "keyword", keywords: ["analyze", "read", "extract", "scan", "parse"] },
			target: "code-reader",
			priority: 20,
		},
		{
			id: "route-analyze-type",
			match: { type: "expression", expr: 'task.type == "analyze"' },
			target: "code-reader",
			priority: 25,
		},
		{
			id: "route-doc",
			match: { type: "keyword", keywords: ["document", "write doc", "readme", "api doc", "jsdoc"] },
			target: "doc-writer",
			priority: 20,
		},
		{
			id: "route-file-ts",
			match: { type: "file_type", extensions: [".ts", ".js", ".tsx", ".jsx"] },
			target: "code-reader",
			priority: 15,
		},
		{
			id: "route-file-md",
			match: { type: "file_type", extensions: [".md", ".mdx", ".txt"] },
			target: "doc-writer",
			priority: 15,
		},
		{
			id: "route-fallback",
			match: { type: "always" },
			target: "code-reader",
			priority: 0,
		},
	],
	coordination: {
		aggregation: "chain",
		sharedContext: true,
		tolerateFailures: false,
	},
	fallback: {
		escalateToHuman: false,
	},
};
