/**
 * @chitragupta/dharma — Rta (ऋत) Invariant Layer.
 *
 * In Vedic philosophy, Rta is the cosmic order — the fundamental law that
 * governs reality, more foundational than even Dharma (its social expression).
 *
 * Rta defines invariant rules that CANNOT be violated under any circumstances.
 * They are checked BEFORE Dharma's PolicyEngine rules. If Rta blocks an action,
 * the PolicyEngine is never consulted.
 *
 * Five core invariants:
 *   R1  No Credential Leak     — never expose secrets via tool output
 *   R2  No Destructive Overwrite — never write to critical system files
 *   R3  No Unbounded Recursion  — never exceed agent depth / spawn loops
 *   R4  No Cost Explosion       — never exceed per-session cost budget
 *   R5  No Data Exfiltration    — never send project data to external hosts
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Context supplied to every Rta invariant check. */
export interface RtaContext {
	toolName: string;
	args: Record<string, unknown>;
	workingDirectory: string;
	/** Recent messages for context-aware checks. */
	recentMessages?: Array<{ role: string; content: string }>;
	/** Session metadata. */
	sessionId?: string;
	project?: string;
	/** Current agent depth (0 = root). */
	agentDepth?: number;
	/** Purpose string of the current agent spawn (for loop detection). */
	agentPurpose?: string;
	/** Recently spawned agent purposes (for loop detection). */
	recentSpawnPurposes?: string[];
	/** Estimated cost of the next operation in dollars. */
	estimatedCost?: number;
	/** Total cost already spent in this session in dollars. */
	totalCostSoFar?: number;
	/** Session cost budget in dollars. 0 = unlimited. */
	costBudget?: number;
	/** Allowed external domains for network access. */
	allowedDomains?: string[];
}

/** The result of evaluating a single Rta invariant rule. */
export interface RtaVerdict {
	allowed: boolean;
	ruleId: string;
	reason?: string;
	/** Suggested safe alternative if blocked. */
	alternative?: string;
}

/** A single Rta invariant rule. All Rta rules are critical. */
export interface RtaRule {
	id: string;
	name: string;
	description: string;
	severity: "critical";
	check: (context: RtaContext) => RtaVerdict;
}

/** An entry in the Rta audit log. */
export interface RtaAuditEntry {
	timestamp: number;
	ruleId: string;
	allowed: boolean;
	toolName: string;
	reason?: string;
	sessionId?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * System hard ceiling for agent tree depth. Mirrors the value from
 * @chitragupta/anina (SYSTEM_MAX_AGENT_DEPTH). Defined here to avoid
 * a circular dependency between dharma and anina.
 */
const RTA_SYSTEM_MAX_AGENT_DEPTH = 10;

/** Maximum audit log entries retained in memory. */
const MAX_AUDIT_LOG_SIZE = 1000;

/** Default per-session cost budget in dollars. */
const DEFAULT_COST_BUDGET = 10;

/** Maximum identical consecutive spawn purposes before triggering loop detection. */
const MAX_REPEATED_SPAWN_PURPOSES = 3;

// ─── Credential Patterns ─────────────────────────────────────────────────────

/**
 * Patterns that match credential-bearing output paths or argument values.
 * Covers API keys, tokens, secrets, passwords, and credential file references.
 */
const CREDENTIAL_ARG_PATTERN =
	/(?:api[_-]?key|token|secret|password|credential|passwd|private[_-]?key)/i;

/** Patterns for bash commands that would dump credential files. */
const CREDENTIAL_DUMP_PATTERNS: RegExp[] = [
	// echo/cat/head/tail/less/more of credential files
	/(?:echo|cat|head|tail|less|more|bat)\s+.*(?:\.env|credentials\.json|\.netrc|\.npmrc|\.pypirc|id_rsa|id_ed25519|\.pem)/i,
	// printenv / env for credential variables
	/(?:printenv|env)\s+.*(?:api[_-]?key|token|secret|password|credential)/i,
	// Echoing env vars that look like credentials
	/echo\s+.*\$\{?(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AWS_SECRET)/i,
];

// ─── Protected System Paths ──────────────────────────────────────────────────

/** Paths that must never be written to. */
const PROTECTED_PATH_PREFIXES: string[] = [
	"/etc/",
	"/usr/",
	"/System/",
	"/bin/",
	"/sbin/",
	"/var/",
	"/boot/",
	"/lib/",
	"/lib64/",
];

/** Specific files that must never be written to (exact basename or suffix match). */
const PROTECTED_FILES: string[] = [
	".git/config",
	".git/HEAD",
	".git/hooks/",
];

/** Files that should not be overwritten unless explicitly safe. */
const PROTECTED_OVERWRITE_FILES: string[] = [
	"package-lock.json",
	".env",
];

// ─── Exfiltration Patterns ───────────────────────────────────────────────────

/** Matches curl/wget/fetch commands sending data to non-localhost URLs. */
const EXFILTRATION_CMD_PATTERNS: RegExp[] = [
	// curl with data flags
	/curl\s+(?:.*\s)?(?:-d\s|-F\s|--data\s|--data-binary\s|--data-raw\s|--data-urlencode\s|--upload-file\s)/,
	// Piping into curl/wget
	/\|\s*(?:curl|wget)\s/,
	// wget with post
	/wget\s+(?:.*\s)?--post-(?:data|file)[\s=]/,
	// nc/netcat as sink
	/\|\s*(?:nc|netcat)\s/,
	// Node/Python fetch/requests with local files
	/(?:node|python|python3)\s+-e\s+.*(?:fetch|requests\.post|urllib)/,
];

/** Matches localhost/loopback URLs (exempted from exfiltration checks). */
const LOCALHOST_PATTERN =
	/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)/i;

// ─── Rule Implementations ────────────────────────────────────────────────────

/**
 * R1: No Credential Leak
 * Block any tool call that would expose API keys, tokens, passwords, or credentials.
 */
export const noCredentialLeak: RtaRule = {
	id: "rta:no-credential-leak",
	name: "No Credential Leak",
	description: "Block tool calls that would expose API keys, tokens, passwords, or credentials",
	severity: "critical",
	check(context: RtaContext): RtaVerdict {
		const { toolName, args } = context;

		// Check if any arg value looks like a credential being sent to an output path
		for (const [key, value] of Object.entries(args)) {
			if (typeof value !== "string") continue;

			// Check if the argument KEY suggests a credential being passed as output
			if (CREDENTIAL_ARG_PATTERN.test(key) && isOutputArg(key)) {
				return {
					allowed: false,
					ruleId: this.id,
					reason: `Argument "${key}" appears to expose credentials in output`,
					alternative: "Use environment variables or a secrets manager instead of passing credentials in tool arguments",
				};
			}

			// Check if the VALUE contains credential file paths being targeted for output
			if (isOutputArg(key) && CREDENTIAL_ARG_PATTERN.test(value)) {
				return {
					allowed: false,
					ruleId: this.id,
					reason: `Output path "${value}" references credential data`,
					alternative: "Do not write credential data to output files",
				};
			}
		}

		// Check bash/shell commands
		const command = extractCommand(toolName, args);
		if (command) {
			for (const pattern of CREDENTIAL_DUMP_PATTERNS) {
				if (pattern.test(command)) {
					return {
						allowed: false,
						ruleId: this.id,
						reason: `Command would expose credential data: "${truncate(command, 80)}"`,
						alternative: "Read credentials through secure APIs, not shell commands",
					};
				}
			}
		}

		return { allowed: true, ruleId: this.id };
	},
};

/**
 * R2: No Destructive Overwrite
 * Block write/edit operations on critical system files and protected paths.
 */
export const noDestructiveOverwrite: RtaRule = {
	id: "rta:no-destructive-overwrite",
	name: "No Destructive Overwrite",
	description: "Block write/edit operations on critical system files and protected paths",
	severity: "critical",
	check(context: RtaContext): RtaVerdict {
		const { toolName, args } = context;

		// Only check write-capable tools
		if (!isWriteTool(toolName)) {
			return { allowed: true, ruleId: this.id };
		}

		const targetPath = extractTargetPath(args);
		if (!targetPath) {
			return { allowed: true, ruleId: this.id };
		}

		// Check system path prefixes
		for (const prefix of PROTECTED_PATH_PREFIXES) {
			if (targetPath.startsWith(prefix)) {
				return {
					allowed: false,
					ruleId: this.id,
					reason: `Cannot write to system path "${truncate(targetPath, 80)}"`,
					alternative: "Only modify files within your project directory",
				};
			}
		}

		// Check protected git/config files
		for (const protectedFile of PROTECTED_FILES) {
			if (targetPath.includes(protectedFile)) {
				return {
					allowed: false,
					ruleId: this.id,
					reason: `Cannot write to protected file "${protectedFile}"`,
					alternative: "Use git commands to modify repository configuration",
				};
			}
		}

		// Check overwrite-protected files (only for full-overwrite tools, not edits)
		if (isOverwriteTool(toolName)) {
			for (const protectedFile of PROTECTED_OVERWRITE_FILES) {
				if (targetPath.endsWith(protectedFile) || targetPath.endsWith("/" + protectedFile)) {
					return {
						allowed: false,
						ruleId: this.id,
						reason: `Cannot overwrite protected file "${protectedFile}"`,
						alternative: protectedFile === "package-lock.json"
							? "Use npm install to regenerate the lock file"
							: "Use a dedicated editor to modify .env files with caution",
					};
				}
			}
		}

		return { allowed: true, ruleId: this.id };
	},
};

/**
 * R3: No Unbounded Recursion
 * Block agent spawning that exceeds depth limits or creates spawn loops.
 */
export const noUnboundedRecursion: RtaRule = {
	id: "rta:no-unbounded-recursion",
	name: "No Unbounded Recursion",
	description: "Block agent spawning that exceeds depth limits or creates spawn loops",
	severity: "critical",
	check(context: RtaContext): RtaVerdict {
		const { toolName, agentDepth, agentPurpose, recentSpawnPurposes } = context;

		// Only check agent-spawning tools
		if (!isAgentSpawnTool(toolName)) {
			return { allowed: true, ruleId: this.id };
		}

		// Check depth limit
		if (agentDepth !== undefined && agentDepth >= RTA_SYSTEM_MAX_AGENT_DEPTH) {
			return {
				allowed: false,
				ruleId: this.id,
				reason: `Agent depth ${agentDepth} has reached the system maximum of ${RTA_SYSTEM_MAX_AGENT_DEPTH}`,
				alternative: "Complete the current task without spawning more sub-agents, or restructure the task decomposition",
			};
		}

		// Check for spawn loops — same purpose repeated too many times
		if (agentPurpose && recentSpawnPurposes && recentSpawnPurposes.length > 0) {
			const purposeLower = agentPurpose.toLowerCase().trim();
			let consecutiveCount = 0;

			for (let i = recentSpawnPurposes.length - 1; i >= 0; i--) {
				if (recentSpawnPurposes[i].toLowerCase().trim() === purposeLower) {
					consecutiveCount++;
				} else {
					break;
				}
			}

			if (consecutiveCount >= MAX_REPEATED_SPAWN_PURPOSES) {
				return {
					allowed: false,
					ruleId: this.id,
					reason: `Agent spawn loop detected: purpose "${truncate(agentPurpose, 60)}" has been repeated ${consecutiveCount} times consecutively`,
					alternative: "Reformulate the task or handle it in the current agent instead of spawning another with the same purpose",
				};
			}
		}

		return { allowed: true, ruleId: this.id };
	},
};

/**
 * R4: No Cost Explosion
 * Block operations that would exceed the session cost budget.
 */
export const noCostExplosion: RtaRule = {
	id: "rta:no-cost-explosion",
	name: "No Cost Explosion",
	description: "Block operations that would exceed the per-session cost budget",
	severity: "critical",
	check(context: RtaContext): RtaVerdict {
		const {
			estimatedCost = 0,
			totalCostSoFar = 0,
			costBudget,
		} = context;

		const effectiveBudget = costBudget !== undefined && costBudget > 0
			? costBudget
			: DEFAULT_COST_BUDGET;

		// Check if the session has already exceeded its budget
		if (totalCostSoFar >= effectiveBudget) {
			return {
				allowed: false,
				ruleId: this.id,
				reason: `Session cost budget exhausted: $${totalCostSoFar.toFixed(2)} spent of $${effectiveBudget.toFixed(2)} budget`,
				alternative: "Start a new session or increase the cost budget in configuration",
			};
		}

		// Check if the next operation would exceed the budget
		if (estimatedCost > 0 && totalCostSoFar + estimatedCost > effectiveBudget) {
			return {
				allowed: false,
				ruleId: this.id,
				reason: `Next operation ($${estimatedCost.toFixed(2)}) would exceed budget: $${totalCostSoFar.toFixed(2)} + $${estimatedCost.toFixed(2)} > $${effectiveBudget.toFixed(2)}`,
				alternative: "Use a cheaper model or reduce the request size",
			};
		}

		return { allowed: true, ruleId: this.id };
	},
};

/**
 * R5: No Data Exfiltration
 * Block tool calls that send project data to external (non-localhost) services.
 */
export const noDataExfiltration: RtaRule = {
	id: "rta:no-data-exfiltration",
	name: "No Data Exfiltration",
	description: "Block tool calls that send project data to external services",
	severity: "critical",
	check(context: RtaContext): RtaVerdict {
		const { toolName, args, allowedDomains } = context;

		const command = extractCommand(toolName, args);
		if (!command) {
			return { allowed: true, ruleId: this.id };
		}

		// Check against exfiltration patterns
		for (const pattern of EXFILTRATION_CMD_PATTERNS) {
			if (pattern.test(command)) {
				// Check if the target is localhost (allowed)
				if (LOCALHOST_PATTERN.test(command)) {
					return { allowed: true, ruleId: this.id };
				}

				// Check if the target is in the allowed domains list
				if (allowedDomains && allowedDomains.length > 0) {
					const urlMatch = command.match(/https?:\/\/([^/\s:]+)/);
					if (urlMatch) {
						const domain = urlMatch[1].toLowerCase();
						if (allowedDomains.some((d) => domain === d.toLowerCase() || domain.endsWith("." + d.toLowerCase()))) {
							return { allowed: true, ruleId: this.id };
						}
					}
				}

				return {
					allowed: false,
					ruleId: this.id,
					reason: `Potential data exfiltration detected: "${truncate(command, 80)}"`,
					alternative: "If this is intentional, add the target domain to the allowedDomains list in your configuration",
				};
			}
		}

		return { allowed: true, ruleId: this.id };
	},
};

// ─── Built-in Rule Set ───────────────────────────────────────────────────────

/** All five core Rta invariant rules. */
export const RTA_RULES: RtaRule[] = [
	noCredentialLeak,
	noDestructiveOverwrite,
	noUnboundedRecursion,
	noCostExplosion,
	noDataExfiltration,
];

// ─── RtaEngine ───────────────────────────────────────────────────────────────

/**
 * The RtaEngine evaluates invariant rules that cannot be violated.
 * It runs BEFORE the PolicyEngine — if Rta blocks, Dharma is never consulted.
 *
 * @example
 * ```ts
 * const rta = new RtaEngine();
 * const verdict = rta.check(context);
 * if (!verdict.allowed) {
 *   // Hard block — do not proceed to PolicyEngine
 *   console.error(`Rta violation: ${verdict.reason}`);
 * }
 * ```
 */
export class RtaEngine {
	private readonly rules: Map<string, RtaRule> = new Map();
	private readonly auditLog: RtaAuditEntry[] = [];

	constructor() {
		// Register all core invariant rules
		for (const rule of RTA_RULES) {
			this.rules.set(rule.id, rule);
		}
	}

	// ─── Rule Management ──────────────────────────────────────────────────

	/**
	 * Add a custom invariant rule. If a rule with the same ID already exists,
	 * it is replaced.
	 */
	addRule(rule: RtaRule): void {
		this.rules.set(rule.id, rule);
	}

	/** Remove a rule by its ID. */
	removeRule(id: string): void {
		this.rules.delete(id);
	}

	/** List all registered rules. */
	getRules(): RtaRule[] {
		return [...this.rules.values()];
	}

	// ─── Checking ─────────────────────────────────────────────────────────

	/**
	 * Check all rules. Returns the first violation found, or an allow verdict
	 * if all rules pass. Short-circuits on first violation.
	 */
	check(context: RtaContext): RtaVerdict {
		for (const rule of this.rules.values()) {
			const verdict = rule.check(context);
			this.recordAudit(verdict, context);
			if (!verdict.allowed) {
				return verdict;
			}
		}

		return { allowed: true, ruleId: "rta:all-passed" };
	}

	/**
	 * Check all rules without short-circuiting. Returns every verdict,
	 * including allows and denials. Useful for comprehensive reporting.
	 */
	checkAll(context: RtaContext): RtaVerdict[] {
		const verdicts: RtaVerdict[] = [];

		for (const rule of this.rules.values()) {
			const verdict = rule.check(context);
			this.recordAudit(verdict, context);
			verdicts.push(verdict);
		}

		return verdicts;
	}

	// ─── Audit Log ────────────────────────────────────────────────────────

	/**
	 * Get recent audit log entries.
	 *
	 * @param limit - Maximum entries to return. Defaults to all entries.
	 */
	getAuditLog(limit?: number): RtaAuditEntry[] {
		if (limit !== undefined && limit > 0) {
			return this.auditLog.slice(-limit);
		}
		return [...this.auditLog];
	}

	/** Clear the in-memory audit log. */
	clearAuditLog(): void {
		this.auditLog.length = 0;
	}

	// ─── Internal ─────────────────────────────────────────────────────────

	private recordAudit(verdict: RtaVerdict, context: RtaContext): void {
		// Evict oldest entries if we exceed the cap
		if (this.auditLog.length >= MAX_AUDIT_LOG_SIZE) {
			this.auditLog.splice(0, this.auditLog.length - MAX_AUDIT_LOG_SIZE + 1);
		}

		this.auditLog.push({
			timestamp: Date.now(),
			ruleId: verdict.ruleId,
			allowed: verdict.allowed,
			toolName: context.toolName,
			reason: verdict.reason,
			sessionId: context.sessionId,
		});
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Determine whether an argument name suggests output (file path, destination). */
function isOutputArg(key: string): boolean {
	const outputKeys = new Set([
		"output", "out", "outfile", "outputfile", "output_path",
		"outpath", "destination", "dest", "target", "file_path",
		"filepath", "path", "write_path", "save_path",
	]);
	return outputKeys.has(key.toLowerCase().replace(/-/g, "_"));
}

/** Extract a shell command from tool args, if present. */
function extractCommand(toolName: string, args: Record<string, unknown>): string | null {
	// Direct command argument
	if (typeof args.command === "string" && args.command.length > 0) {
		return args.command;
	}

	// Bash tool
	if (toolName.toLowerCase().includes("bash") || toolName.toLowerCase().includes("shell")) {
		if (typeof args.command === "string") return args.command;
		if (typeof args.cmd === "string") return args.cmd;
		if (typeof args.script === "string") return args.script;
	}

	return null;
}

/** Check if a tool name indicates a write/edit operation. */
function isWriteTool(toolName: string): boolean {
	const writePrefixes = ["write", "edit", "create", "save", "overwrite", "patch"];
	const lower = toolName.toLowerCase();
	return writePrefixes.some((p) => lower.includes(p));
}

/** Check if a tool name indicates a full-overwrite operation (not a patch/edit). */
function isOverwriteTool(toolName: string): boolean {
	const overwritePrefixes = ["write", "create", "save", "overwrite"];
	const lower = toolName.toLowerCase();
	return overwritePrefixes.some((p) => lower.includes(p));
}

/** Check if a tool name indicates an agent spawn operation. */
function isAgentSpawnTool(toolName: string): boolean {
	const spawnKeywords = ["spawn", "agent", "sub_agent", "subagent", "delegate", "fork"];
	const lower = toolName.toLowerCase();
	return spawnKeywords.some((k) => lower.includes(k));
}

/** Extract a target file path from tool args. */
function extractTargetPath(args: Record<string, unknown>): string | null {
	const pathKeys = ["path", "file_path", "filepath", "filePath", "target", "destination", "file"];
	for (const key of pathKeys) {
		if (typeof args[key] === "string" && args[key].length > 0) {
			return args[key];
		}
	}
	return null;
}

/** Truncate a string to a maximum length, adding ellipsis if needed. */
function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen - 3) + "...";
}
