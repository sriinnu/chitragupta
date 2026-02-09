/**
 * @chitragupta/dharma — Policy Engine.
 * Evaluates and enforces policy rules against agent actions.
 */

import type {
	PolicyRule,
	PolicySet,
	PolicyAction,
	PolicyContext,
	PolicyVerdict,
	PolicyEngineConfig,
	AuditEntry,
} from "./types.js";

/**
 * The PolicyEngine evaluates agent actions against a set of policy rules
 * and produces verdicts that allow, deny, warn, or modify those actions.
 *
 * Rules are organized into policy sets (with priority ordering) and standalone
 * rules. Higher-priority policy sets are evaluated first; standalone rules are
 * evaluated last.
 *
 * @example
 * ```ts
 * const engine = new PolicyEngine(config);
 * engine.addRule(myCustomRule);
 * const result = await engine.enforce(action, context);
 * if (!result.allowed) {
 *   console.log("Blocked:", result.verdicts);
 * }
 * ```
 */
export class PolicyEngine {
	private readonly config: PolicyEngineConfig;
	private readonly policySets: Map<string, PolicySet> = new Map();
	private readonly standaloneRules: Map<string, PolicyRule> = new Map();
	private readonly auditLog: AuditEntry[] = [];

	/**
	 * Create a new PolicyEngine with the given configuration.
	 *
	 * @param config - Engine configuration including enforcement mode, budgets, and custom rules.
	 */
	constructor(config: PolicyEngineConfig) {
		this.config = { ...config };

		// Register custom rules from config
		for (const rule of config.customRules) {
			this.standaloneRules.set(rule.id, rule);
		}
	}

	// ─── Rule Management ──────────────────────────────────────────────────────

	/**
	 * Add a standalone rule to the engine. If a rule with the same ID
	 * already exists, it is replaced.
	 *
	 * @param rule - The policy rule to add.
	 */
	addRule(rule: PolicyRule): void {
		this.standaloneRules.set(rule.id, rule);
	}

	/**
	 * Remove a standalone rule by its ID.
	 *
	 * @param ruleId - The ID of the rule to remove.
	 */
	removeRule(ruleId: string): void {
		this.standaloneRules.delete(ruleId);
	}

	/**
	 * Add a policy set (collection of rules with a priority level).
	 * Higher-priority sets are evaluated first.
	 *
	 * @param set - The policy set to add.
	 */
	addPolicySet(set: PolicySet): void {
		this.policySets.set(set.id, set);
	}

	/**
	 * Remove a policy set by its ID.
	 *
	 * @param setId - The ID of the policy set to remove.
	 */
	removePolicySet(setId: string): void {
		this.policySets.delete(setId);
	}

	// ─── Evaluation ───────────────────────────────────────────────────────────

	/**
	 * Gather all rules sorted by priority (policy set priority first,
	 * then standalone rules last).
	 */
	private getAllRulesSorted(): PolicyRule[] {
		// Sort policy sets by priority descending (higher = evaluated first)
		const sortedSets = [...this.policySets.values()].sort(
			(a, b) => b.priority - a.priority,
		);

		const rules: PolicyRule[] = [];

		for (const set of sortedSets) {
			for (const rule of set.rules) {
				rules.push(rule);
			}
		}

		// Standalone rules come after policy sets
		for (const rule of this.standaloneRules.values()) {
			rules.push(rule);
		}

		return rules;
	}

	/**
	 * Evaluate ALL rules against an action and return every verdict.
	 * Does NOT short-circuit on deny -- useful for generating comprehensive reports.
	 *
	 * @param action - The agent action to evaluate.
	 * @param context - Context about the current session, agent, and project.
	 * @returns An array of verdicts from every applicable rule.
	 */
	async evaluate(action: PolicyAction, context: PolicyContext): Promise<PolicyVerdict[]> {
		const rules = this.getAllRulesSorted();
		const verdicts: PolicyVerdict[] = [];

		for (const rule of rules) {
			try {
				const verdict = await rule.evaluate(action, context);
				verdicts.push(verdict);
			} catch (err) {
				// If a rule throws, treat it as a deny for safety
				verdicts.push({
					status: "deny",
					ruleId: rule.id,
					reason: `Rule "${rule.name}" threw an error during evaluation: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
		}

		return verdicts;
	}

	/**
	 * Enforce policies against an action. Returns the final decision.
	 * In enforce mode (`config.enforce === true`), short-circuits on first "deny".
	 * Applies "modify" verdicts in sequence, passing modified actions to subsequent rules.
	 *
	 * @param action - The agent action to evaluate.
	 * @param context - Context about the current session, agent, and project.
	 * @returns Object containing allowed status, all verdicts, and optionally the modified action.
	 */
	async enforce(
		action: PolicyAction,
		context: PolicyContext,
	): Promise<{
		allowed: boolean;
		verdicts: PolicyVerdict[];
		modifiedAction?: PolicyAction;
	}> {
		const rules = this.getAllRulesSorted();
		const verdicts: PolicyVerdict[] = [];
		let currentAction = { ...action };
		let finalDecision: "allow" | "deny" | "warn" = "allow";

		for (const rule of rules) {
			try {
				const verdict = await rule.evaluate(currentAction, context);
				verdicts.push(verdict);

				if (verdict.status === "deny") {
					finalDecision = "deny";

					// Record audit entry
					this.recordAudit(context, action, verdicts, finalDecision);

					if (this.config.enforce) {
						// Short-circuit: deny immediately in enforce mode
						return {
							allowed: false,
							verdicts,
						};
					}
				} else if (verdict.status === "warn") {
					if (finalDecision !== "deny") {
						finalDecision = "warn";
					}
				} else if (verdict.status === "modify" && verdict.modifiedAction) {
					currentAction = { ...verdict.modifiedAction };
				}
			} catch (err) {
				const errorVerdict: PolicyVerdict = {
					status: "deny",
					ruleId: rule.id,
					reason: `Rule "${rule.name}" threw an error: ${err instanceof Error ? err.message : String(err)}`,
				};
				verdicts.push(errorVerdict);
				finalDecision = "deny";

				this.recordAudit(context, action, verdicts, finalDecision);

				if (this.config.enforce) {
					return {
						allowed: false,
						verdicts,
					};
				}
			}
		}

		// Record final audit entry
		this.recordAudit(context, action, verdicts, finalDecision);

		const allowed = this.config.enforce ? finalDecision !== "deny" : true;
		const hasModification = currentAction !== action && verdicts.some((v) => v.status === "modify");

		return {
			allowed,
			verdicts,
			modifiedAction: hasModification ? currentAction : undefined,
		};
	}

	// ─── Audit ────────────────────────────────────────────────────────────────

	private recordAudit(
		context: PolicyContext,
		action: PolicyAction,
		verdicts: PolicyVerdict[],
		finalDecision: "allow" | "deny" | "warn",
	): void {
		this.auditLog.push({
			timestamp: Date.now(),
			sessionId: context.sessionId,
			agentId: context.agentId,
			action,
			verdicts: [...verdicts],
			finalDecision,
		});
	}

	/**
	 * Get the full in-memory audit log.
	 *
	 * @returns A readonly array of all audit entries recorded during enforce() calls.
	 */
	getAuditLog(): readonly AuditEntry[] {
		return this.auditLog;
	}

	/** Clear the in-memory audit log. */
	clearAuditLog(): void {
		this.auditLog.length = 0;
	}

	// ─── Config Import/Export ─────────────────────────────────────────────────

	/**
	 * Export the current engine configuration as a serializable object.
	 * Custom rules are excluded since they contain function references.
	 *
	 * @returns A copy of the config with an empty customRules array.
	 */
	exportConfig(): Omit<PolicyEngineConfig, "customRules"> & { customRules: never[] } {
		return {
			enforce: this.config.enforce,
			costBudget: this.config.costBudget,
			allowedPaths: [...this.config.allowedPaths],
			deniedPaths: [...this.config.deniedPaths],
			deniedCommands: [...this.config.deniedCommands],
			maxFilesPerSession: this.config.maxFilesPerSession,
			maxCommandsPerSession: this.config.maxCommandsPerSession,
			inheritToSubAgents: this.config.inheritToSubAgents,
			customRules: [] as never[],
		};
	}

	/**
	 * Import a configuration, replacing the current one.
	 * Re-registers all custom rules from the imported config.
	 *
	 * @param config - The new configuration to import.
	 */
	importConfig(config: PolicyEngineConfig): void {
		Object.assign(this.config, config);

		// Re-register custom rules
		this.standaloneRules.clear();
		for (const rule of config.customRules) {
			this.standaloneRules.set(rule.id, rule);
		}
	}
}
