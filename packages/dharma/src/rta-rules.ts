/**
 * @chitragupta/dharma — Rta invariant rule implementations.
 *
 * Five core invariants: no credential leak, no destructive overwrite,
 * no unbounded recursion, no cost explosion, no data exfiltration.
 * Extracted from rta.ts to keep files under 450 LOC.
 */

import type { RtaContext, RtaVerdict, RtaRule } from "./rta-types.js";
import {
	RTA_SYSTEM_MAX_AGENT_DEPTH,
	DEFAULT_COST_BUDGET,
	MAX_REPEATED_SPAWN_PURPOSES,
	CREDENTIAL_ARG_PATTERN,
	CREDENTIAL_DUMP_PATTERNS,
	PROTECTED_PATH_PREFIXES,
	PROTECTED_FILES,
	PROTECTED_OVERWRITE_FILES,
	EXFILTRATION_CMD_PATTERNS,
	LOCALHOST_PATTERN,
} from "./rta-types.js";

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

		// Check system path prefixes (case-insensitive for Windows paths)
		const normalizedTarget = process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
		for (const prefix of PROTECTED_PATH_PREFIXES) {
			const normalizedPrefix = process.platform === "win32" ? prefix.toLowerCase() : prefix;
			if (normalizedTarget.startsWith(normalizedPrefix)) {
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
		if (totalCostSoFar + estimatedCost > effectiveBudget) {
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


// ─── Helpers ─────────────────────────────────────────────────────────────


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

