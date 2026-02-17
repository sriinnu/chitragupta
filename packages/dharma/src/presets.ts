/**
 * @chitragupta/dharma — Pre-built policy presets.
 * Ready-to-use configurations for common use cases.
 */

import type { PolicyEngineConfig, PolicySet, PolicyRule } from "./types.js";
import { SECURITY_RULES } from "./rules/security.js";
import { COST_RULES } from "./rules/cost.js";
import { CONVENTION_RULES } from "./rules/convention.js";
import { SCOPE_RULES } from "./rules/scope.js";
import {
	noSecretsInPrompts,
	noDestructiveCommands,
	noNetworkExfiltration,
	sandboxFileAccess,
} from "./rules/security.js";
import { budgetLimit, rateLimitGuard } from "./rules/cost.js";
import { projectBoundary, noModifyGitHistory, readOnlyPaths } from "./rules/scope.js";

// ─── Helper ─────────────────────────────────────────────────────────────────

function createPolicySet(
	id: string,
	name: string,
	description: string,
	rules: PolicyRule[],
	priority: number,
): PolicySet {
	return { id, name, description, rules, priority };
}

// ─── Presets ────────────────────────────────────────────────────────────────

/**
 * STRICT: All security rules enforced, $5 budget, 20 file limit,
 * no sudo, project-bound. For high-security environments.
 */
export const STRICT_PRESET: { config: PolicyEngineConfig; policySets: PolicySet[] } = {
	config: {
		enforce: true,
		costBudget: 5,
		allowedPaths: [],
		deniedPaths: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
		deniedCommands: ["sudo", "rm -rf", "mkfs", "dd if=", "chmod 777"],
		maxFilesPerSession: 20,
		maxCommandsPerSession: 50,
		inheritToSubAgents: true,
		customRules: [],
	},
	policySets: [
		createPolicySet("strict-security", "Strict Security", "All security rules enforced", SECURITY_RULES, 100),
		createPolicySet("strict-cost", "Strict Cost", "Tight budget enforcement", COST_RULES, 90),
		createPolicySet("strict-scope", "Strict Scope", "Tight scope restrictions", SCOPE_RULES, 80),
		createPolicySet("strict-convention", "Strict Convention", "Convention enforcement", CONVENTION_RULES, 70),
	],
};

/**
 * STANDARD: Security + cost rules enforced, $20 budget, 50 file limit,
 * conventions as warnings. Good default for most projects.
 */
export const STANDARD_PRESET: { config: PolicyEngineConfig; policySets: PolicySet[] } = {
	config: {
		enforce: true,
		costBudget: 20,
		allowedPaths: [],
		deniedPaths: ["**/node_modules/**", "**/.git/**"],
		deniedCommands: ["rm -rf /", "mkfs", "dd if="],
		maxFilesPerSession: 50,
		maxCommandsPerSession: 100,
		inheritToSubAgents: true,
		customRules: [],
	},
	policySets: [
		createPolicySet("standard-security", "Standard Security", "Core security rules", SECURITY_RULES, 100),
		createPolicySet("standard-cost", "Standard Cost", "Budget enforcement", COST_RULES, 90),
		createPolicySet("standard-scope", "Standard Scope", "Scope restrictions", SCOPE_RULES, 80),
		createPolicySet("standard-convention", "Standard Convention", "Convention warnings", CONVENTION_RULES, 50),
	],
};

/**
 * PERMISSIVE: Only critical security rules (no rm -rf /), no budget limit,
 * warnings only. For trusted environments.
 */
export const PERMISSIVE_PRESET: { config: PolicyEngineConfig; policySets: PolicySet[] } = {
	config: {
		enforce: false,
		costBudget: 0,
		allowedPaths: [],
		deniedPaths: [],
		deniedCommands: [],
		maxFilesPerSession: 0,
		maxCommandsPerSession: 0,
		inheritToSubAgents: false,
		customRules: [],
	},
	policySets: [
		createPolicySet(
			"permissive-security",
			"Permissive Security",
			"Only critical security rules",
			[noSecretsInPrompts, noDestructiveCommands, noNetworkExfiltration],
			100,
		),
	],
};

/**
 * READONLY: No writes, no shell commands, read + analyze only.
 * For code review and analysis tasks.
 */
export const READONLY_PRESET: { config: PolicyEngineConfig; policySets: PolicySet[] } = {
	config: {
		enforce: true,
		costBudget: 10,
		allowedPaths: [],
		deniedPaths: [],
		deniedCommands: [],
		maxFilesPerSession: 0,
		maxCommandsPerSession: 0,
		inheritToSubAgents: true,
		customRules: [],
	},
	policySets: [
		createPolicySet("readonly-security", "Read-Only Security", "Security rules", SECURITY_RULES, 100),
		createPolicySet("readonly-cost", "Read-Only Cost", "Cost limits", COST_RULES, 90),
		createPolicySet(
			"readonly-access",
			"Read-Only Access",
			"Deny all write and execution operations",
			[createReadOnlyRule()],
			200,
		),
	],
};

/**
 * REVIEW: Read-only + can suggest changes but not apply them.
 * Like READONLY but can produce diffs and suggestions.
 */
export const REVIEW_PRESET: { config: PolicyEngineConfig; policySets: PolicySet[] } = {
	config: {
		enforce: true,
		costBudget: 15,
		allowedPaths: [],
		deniedPaths: [],
		deniedCommands: [],
		maxFilesPerSession: 0,
		maxCommandsPerSession: 10,
		inheritToSubAgents: true,
		customRules: [],
	},
	policySets: [
		createPolicySet("review-security", "Review Security", "Security rules", SECURITY_RULES, 100),
		createPolicySet("review-cost", "Review Cost", "Cost limits", COST_RULES, 90),
		createPolicySet(
			"review-access",
			"Review Access",
			"Deny write/delete operations but allow reads and limited commands",
			[createReviewRule()],
			200,
		),
	],
};

// ─── Special Rules for Read-Only / Review Presets ───────────────────────────

function createReadOnlyRule(): PolicyRule {
	return {
		id: "preset.read-only",
		name: "Read Only",
		description: "Denies all write, delete, shell execution, and network request operations",
		severity: "error",
		category: "scope",
		evaluate(action, _context) {
			const denyTypes = new Set(["file_write", "file_delete", "shell_exec", "network_request", "agent_spawn"]);
			if (denyTypes.has(action.type)) {
				return {
					status: "deny",
					ruleId: this.id,
					reason: `Read-only mode: "${action.type}" operations are not allowed`,
					suggestion: "This session is read-only. You can read and analyze files but not modify them.",
				};
			}
			return { status: "allow", ruleId: this.id, reason: "Read operations are allowed" };
		},
	};
}

function createReviewRule(): PolicyRule {
	return {
		id: "preset.review-only",
		name: "Review Only",
		description: "Denies file write and delete operations but allows reads and limited shell commands",
		severity: "error",
		category: "scope",
		evaluate(action, _context) {
			const denyTypes = new Set(["file_write", "file_delete", "agent_spawn"]);
			if (denyTypes.has(action.type)) {
				return {
					status: "deny",
					ruleId: this.id,
					reason: `Review mode: "${action.type}" operations are not allowed`,
					suggestion: "This session is review-only. You can read, analyze, and suggest changes but not apply them.",
				};
			}
			return { status: "allow", ruleId: this.id, reason: "Operation is allowed in review mode" };
		},
	};
}

/** All available presets by name. */
export const PRESETS = {
	strict: STRICT_PRESET,
	standard: STANDARD_PRESET,
	permissive: PERMISSIVE_PRESET,
	readonly: READONLY_PRESET,
	review: REVIEW_PRESET,
} as const;

export type PresetName = keyof typeof PRESETS;
