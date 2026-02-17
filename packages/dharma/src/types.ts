/**
 * @chitragupta/dharma — Guardrails & Policy Engine types.
 * The law/duty that governs agent behavior.
 */

// ─── Policy Categories ──────────────────────────────────────────────────────

export type PolicyCategory =
	| "security"      // Prevent dangerous operations
	| "cost"          // Budget/spending limits
	| "content"       // Content filtering (no secrets in prompts)
	| "filesystem"    // File access restrictions
	| "network"       // Network/API call restrictions
	| "execution"     // Shell command restrictions
	| "convention"    // Coding style enforcement
	| "scope"         // Stay within project boundaries
	| "custom";

// ─── Policy Action ──────────────────────────────────────────────────────────

/** An action the agent wants to take. */
export interface PolicyAction {
	type: "tool_call" | "file_read" | "file_write" | "file_delete" | "shell_exec" | "network_request" | "llm_call" | "agent_spawn";
	tool?: string;
	args?: Record<string, unknown>;
	filePath?: string;
	command?: string;
	url?: string;
	cost?: number;
	content?: string;
}

// ─── Policy Context ─────────────────────────────────────────────────────────

/** Context available to policy evaluation. */
export interface PolicyContext {
	sessionId: string;
	agentId: string;
	agentDepth: number;
	projectPath: string;
	totalCostSoFar: number;
	costBudget: number;
	filesModified: string[];
	commandsRun: string[];
	timestamp: number;
}

// ─── Policy Verdict ─────────────────────────────────────────────────────────

/** The result of evaluating a policy rule. */
export interface PolicyVerdict {
	status: "allow" | "deny" | "warn" | "modify";
	ruleId: string;
	reason: string;
	/** If status is "modify", this contains the modified action. */
	modifiedAction?: PolicyAction;
	/** Suggested alternative if denied. */
	suggestion?: string;
}

// ─── Policy Rule ────────────────────────────────────────────────────────────

/** A policy rule that can approve, deny, or modify agent actions. */
export interface PolicyRule {
	id: string;
	name: string;
	description: string;
	severity: "error" | "warning" | "info";
	category: PolicyCategory;
	/** Evaluate this rule against an action. Returns a verdict. */
	evaluate(action: PolicyAction, context: PolicyContext): PolicyVerdict | Promise<PolicyVerdict>;
}

// ─── Policy Set ─────────────────────────────────────────────────────────────

/** A policy set is a collection of rules that can be loaded/saved. */
export interface PolicySet {
	id: string;
	name: string;
	description: string;
	rules: PolicyRule[];
	/** Priority order — higher = evaluated first. */
	priority: number;
}

// ─── Policy Engine Configuration ────────────────────────────────────────────

/** Configuration for the policy engine. */
export interface PolicyEngineConfig {
	/** Whether to enforce policies (true) or just warn (false). */
	enforce: boolean;
	/** Cost budget in dollars. 0 = unlimited. */
	costBudget: number;
	/** Allowed file patterns (glob). Empty = allow all. */
	allowedPaths: string[];
	/** Denied file patterns (glob). */
	deniedPaths: string[];
	/** Denied shell commands (substrings). */
	deniedCommands: string[];
	/** Max files an agent can modify in a session. */
	maxFilesPerSession: number;
	/** Max shell commands per session. */
	maxCommandsPerSession: number;
	/** Whether sub-agents inherit parent restrictions. */
	inheritToSubAgents: boolean;
	/** Custom rules loaded from project config. */
	customRules: PolicyRule[];
}

// ─── Audit Entry ────────────────────────────────────────────────────────────

/** Audit log entry for every policy evaluation. */
export interface AuditEntry {
	timestamp: number;
	sessionId: string;
	agentId: string;
	action: PolicyAction;
	verdicts: PolicyVerdict[];
	finalDecision: "allow" | "deny" | "warn";
}
