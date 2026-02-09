/**
 * @chitragupta/vayu — Pre-built workflow templates.
 *
 * Common agent workflow patterns ready to use or customize.
 */

import type { Workflow } from "./types.js";

// ─── Code Review Workflow ───────────────────────────────────────────────────

/**
 * CODE_REVIEW_WORKFLOW: Read files, Analyze, Check conventions, Report.
 */
export const CODE_REVIEW_WORKFLOW: Workflow = {
	id: "code-review",
	name: "Code Review",
	description: "Automated code review workflow: read files, analyze code quality, check conventions, and generate a report.",
	version: "1.0.0",
	steps: [
		{
			id: "read-files",
			name: "Read source files",
			action: {
				type: "tool",
				name: "read_files",
				args: { pattern: "src/**/*.ts" },
			},
			dependsOn: [],
			tags: ["input"],
		},
		{
			id: "analyze",
			name: "Analyze code quality",
			action: {
				type: "prompt",
				message: "Analyze the following source files for code quality issues, potential bugs, and improvement suggestions. Focus on: error handling, type safety, performance, and readability.",
			},
			dependsOn: ["read-files"],
			inputs: {
				files: { source: "step", stepId: "read-files", path: "result" },
			},
			tags: ["analysis"],
		},
		{
			id: "check-conventions",
			name: "Check coding conventions",
			action: {
				type: "prompt",
				message: "Review the source files for adherence to coding conventions: naming, formatting, documentation, imports, and project structure. List any violations found.",
			},
			dependsOn: ["read-files"],
			inputs: {
				files: { source: "step", stepId: "read-files", path: "result" },
			},
			tags: ["analysis"],
		},
		{
			id: "report",
			name: "Generate review report",
			action: {
				type: "prompt",
				message: "Compile the code quality analysis and convention check results into a clear, actionable code review report with severity ratings (critical, warning, info) for each finding.",
			},
			dependsOn: ["analyze", "check-conventions"],
			inputs: {
				analysis: { source: "step", stepId: "analyze", path: "response" },
				conventions: { source: "step", stepId: "check-conventions", path: "response" },
			},
			tags: ["output"],
		},
	],
	triggers: [{ type: "manual" }],
};

// ─── Refactor Workflow ──────────────────────────────────────────────────────

/**
 * REFACTOR_WORKFLOW: Analyze, Plan, Execute changes, Run tests, Verify.
 */
export const REFACTOR_WORKFLOW: Workflow = {
	id: "refactor",
	name: "Refactor Code",
	description: "Guided code refactoring workflow: analyze current code, plan changes, execute refactoring, run tests, and verify.",
	version: "1.0.0",
	steps: [
		{
			id: "analyze",
			name: "Analyze code for refactoring",
			action: {
				type: "prompt",
				message: "Analyze the codebase and identify areas that would benefit from refactoring. Consider: code duplication, complex functions, poor abstractions, and maintainability issues.",
			},
			dependsOn: [],
			tags: ["analysis"],
		},
		{
			id: "plan",
			name: "Create refactoring plan",
			action: {
				type: "prompt",
				message: "Based on the analysis, create a detailed refactoring plan. For each change: describe what to change, why, the expected impact, and the risk level. Order changes from safest to riskiest.",
			},
			dependsOn: ["analyze"],
			inputs: {
				analysis: { source: "step", stepId: "analyze", path: "response" },
			},
			tags: ["planning"],
		},
		{
			id: "execute",
			name: "Execute refactoring changes",
			action: {
				type: "prompt",
				message: "Execute the refactoring plan step by step. Make the code changes as described in the plan, ensuring each change is atomic and testable.",
			},
			dependsOn: ["plan"],
			inputs: {
				plan: { source: "step", stepId: "plan", path: "response" },
			},
			tags: ["execution"],
		},
		{
			id: "test",
			name: "Run tests",
			action: {
				type: "shell",
				command: "npm test",
			},
			dependsOn: ["execute"],
			onFailure: "continue",
			retry: { maxRetries: 1, delay: 2000 },
			tags: ["verification"],
		},
		{
			id: "verify",
			name: "Verify refactoring results",
			action: {
				type: "prompt",
				message: "Review the refactoring results and test output. Confirm that: all tests pass, the refactored code is cleaner, no functionality was broken, and the changes match the plan.",
			},
			dependsOn: ["test"],
			inputs: {
				testResults: { source: "step", stepId: "test", path: "stdout" },
			},
			tags: ["verification"],
		},
	],
	triggers: [{ type: "manual" }],
};

// ─── Bug Fix Workflow ───────────────────────────────────────────────────────

/**
 * BUG_FIX_WORKFLOW: Reproduce, Diagnose, Fix, Test, Verify.
 */
export const BUG_FIX_WORKFLOW: Workflow = {
	id: "bug-fix",
	name: "Bug Fix",
	description: "Systematic bug fix workflow: reproduce the issue, diagnose root cause, implement fix, test, and verify.",
	version: "1.0.0",
	steps: [
		{
			id: "reproduce",
			name: "Reproduce the bug",
			action: {
				type: "prompt",
				message: "Attempt to reproduce the reported bug. Identify the exact steps to trigger it, the expected behavior, and the actual behavior. Document the reproduction steps clearly.",
			},
			dependsOn: [],
			tags: ["diagnosis"],
		},
		{
			id: "diagnose",
			name: "Diagnose root cause",
			action: {
				type: "prompt",
				message: "Based on the reproduction steps, analyze the codebase to identify the root cause of the bug. Trace the code path, identify the faulty logic, and explain why the bug occurs.",
			},
			dependsOn: ["reproduce"],
			inputs: {
				reproduction: { source: "step", stepId: "reproduce", path: "response" },
			},
			tags: ["diagnosis"],
		},
		{
			id: "fix",
			name: "Implement the fix",
			action: {
				type: "prompt",
				message: "Implement a fix for the identified root cause. The fix should be minimal, focused, and not introduce regressions. Explain each change made.",
			},
			dependsOn: ["diagnose"],
			inputs: {
				diagnosis: { source: "step", stepId: "diagnose", path: "response" },
			},
			tags: ["execution"],
		},
		{
			id: "test",
			name: "Run tests",
			action: {
				type: "shell",
				command: "npm test",
			},
			dependsOn: ["fix"],
			retry: { maxRetries: 2, delay: 1000 },
			tags: ["verification"],
		},
		{
			id: "verify",
			name: "Verify the fix",
			action: {
				type: "prompt",
				message: "Verify that the bug fix is complete: the original bug no longer reproduces, all tests pass, and no regressions were introduced. Summarize what was fixed and why.",
			},
			dependsOn: ["test"],
			inputs: {
				testResults: { source: "step", stepId: "test", path: "stdout" },
			},
			tags: ["verification"],
		},
	],
	triggers: [{ type: "manual" }],
};

// ─── Deploy Workflow ────────────────────────────────────────────────────────

/**
 * DEPLOY_WORKFLOW: Lint, Test, Build, Review, Deploy.
 */
export const DEPLOY_WORKFLOW: Workflow = {
	id: "deploy",
	name: "Deploy to Production",
	description: "Production deployment pipeline: lint, test, build, review, and deploy with approval gate.",
	version: "1.0.0",
	steps: [
		{
			id: "lint",
			name: "Run linter",
			action: {
				type: "shell",
				command: "npm run lint",
			},
			dependsOn: [],
			timeout: 60000,
			tags: ["quality"],
		},
		{
			id: "test",
			name: "Run tests",
			action: {
				type: "shell",
				command: "npm test",
			},
			dependsOn: ["lint"],
			timeout: 300000,
			retry: { maxRetries: 2, delay: 3000, backoff: 2 },
			tags: ["quality"],
		},
		{
			id: "build",
			name: "Build project",
			action: {
				type: "shell",
				command: "npm run build",
			},
			dependsOn: ["test"],
			timeout: 120000,
			tags: ["build"],
		},
		{
			id: "review",
			name: "Deployment review",
			action: {
				type: "approval",
				message: "Build complete. Review the build output and approve for production deployment.",
			},
			dependsOn: ["build"],
			tags: ["approval"],
		},
		{
			id: "deploy",
			name: "Deploy to production",
			action: {
				type: "shell",
				command: "npm run deploy",
			},
			dependsOn: ["review"],
			timeout: 180000,
			onFailure: "fail",
			tags: ["deploy"],
		},
	],
	triggers: [{ type: "manual" }],
};
