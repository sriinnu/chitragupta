/**
 * @chitragupta/anina/lokapala — Rakshaka — रक्षक — Security Guardian.
 *
 * The Protector. Monitors all tool executions, command outputs, and file
 * changes for security violations: leaked credentials, dangerous commands,
 * path traversal, SQL injection, and permission misconfigurations.
 *
 * Detection patterns and scanning helpers live in rakshaka-patterns.ts.
 *
 * @packageDocumentation
 */

import type { Finding, GuardianConfig, GuardianStats, ScanContext } from "./types.js";
import { resolveConfig, FindingRing } from "./types.js";
import {
	CREDENTIAL_PATTERNS, DANGEROUS_COMMAND_PATTERNS, SQL_INJECTION_PATTERNS,
	PATH_TRAVERSAL_PATTERN, SENSITIVE_PATHS,
	createAddFinding, scanText, scanFilePath,
	type AddFindingFn,
} from "./rakshaka-patterns.js";

// Re-export patterns for consumers
export {
	CREDENTIAL_PATTERNS, DANGEROUS_COMMAND_PATTERNS, SQL_INJECTION_PATTERNS,
	PATH_TRAVERSAL_PATTERN, SENSITIVE_PATHS,
	scanText, scanFilePath,
	type SecurityPattern,
} from "./rakshaka-patterns.js";

// ─── Rakshaka ───────────────────────────────────────────────────────────────

/**
 * Security Guardian -- monitors tool executions and outputs for
 * credential leaks, dangerous commands, injection attacks, and
 * path traversal attempts.
 */
export class Rakshaka {
	private readonly config: GuardianConfig;
	private readonly findings: FindingRing;
	private readonly addFinding: AddFindingFn;
	private scansCompleted: number = 0;
	private autoFixesApplied: number = 0;
	private lastScanAt: number = 0;
	private totalScanDurationMs: number = 0;
	private findingsBySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 };

	constructor(config?: Partial<GuardianConfig>) {
		this.config = resolveConfig(config);
		this.findings = new FindingRing(this.config.maxFindings);
		this.addFinding = createAddFinding(this.config, this.findings, this.findingsBySeverity);
	}

	/** Perform a full security scan over the given context. */
	scan(context: ScanContext): Finding[] {
		if (!this.config.enabled) return [];
		const startMs = Date.now();
		const newFindings: Finding[] = [];

		for (const exec of context.toolExecutions) {
			newFindings.push(...this.scanToolExecution(exec.toolName, exec.args, exec.output));
		}
		if (context.fileChanges) {
			for (const filePath of context.fileChanges) newFindings.push(...scanFilePath(filePath, this.addFinding));
		}
		if (context.commandOutputs) {
			for (const output of context.commandOutputs) newFindings.push(...scanText(output, "command-output", this.addFinding));
		}

		this.scansCompleted++;
		this.lastScanAt = Date.now();
		this.totalScanDurationMs += Date.now() - startMs;
		return newFindings;
	}

	/** Scan a single tool execution for security issues. */
	scanToolExecution(toolName: string, args: Record<string, unknown>, output: string): Finding[] {
		if (!this.config.enabled) return [];
		const newFindings: Finding[] = [];
		const argsStr = JSON.stringify(args);
		const location = `tool:${toolName}`;

		// Credential patterns in output + args
		for (const { pattern, label } of CREDENTIAL_PATTERNS) {
			if (pattern.test(output)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka", domain: "security", severity: "critical",
					title: `Credential leak detected: ${label}`,
					description: `Tool "${toolName}" output contains what appears to be a ${label}. This could leak sensitive credentials to logs or context.`,
					location, suggestion: "Redact or mask the credential before including in output.",
					confidence: 0.85, autoFixable: false,
				});
			}
			if (pattern.test(argsStr)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka", domain: "security", severity: "critical",
					title: `Credential in tool args: ${label}`,
					description: `Tool "${toolName}" was called with arguments containing a ${label}. Arguments may be logged or persisted.`,
					location, suggestion: "Use environment variables or a secrets manager instead of inline credentials.",
					confidence: 0.9, autoFixable: false,
				});
			}
		}

		// Dangerous commands (shell tools only)
		if (toolName === "bash" || toolName === "exec" || toolName === "shell") {
			const commandStr = typeof args.command === "string" ? args.command : argsStr;
			for (const { pattern, label } of DANGEROUS_COMMAND_PATTERNS) {
				if (pattern.test(commandStr)) {
					this.addFinding(newFindings, {
						guardianId: "rakshaka", domain: "security", severity: "critical",
						title: `Dangerous command: ${label}`,
						description: `Command passed to "${toolName}" matches dangerous pattern: ${label}.`,
						location, suggestion: "Review the command carefully before execution. Consider using safer alternatives.",
						confidence: 0.95, autoFixable: false,
					});
				}
			}
		}

		// SQL injection in args
		for (const { pattern, label } of SQL_INJECTION_PATTERNS) {
			if (pattern.test(argsStr)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka", domain: "security", severity: "warning",
					title: `SQL injection pattern: ${label}`,
					description: `Tool "${toolName}" arguments contain a potential SQL injection pattern: ${label}.`,
					location, suggestion: "Use parameterized queries instead of string concatenation.",
					confidence: 0.7, autoFixable: false,
				});
			}
		}

		// Path traversal in args
		if (PATH_TRAVERSAL_PATTERN.test(argsStr)) {
			this.addFinding(newFindings, {
				guardianId: "rakshaka", domain: "security", severity: "warning",
				title: "Path traversal detected",
				description: `Tool "${toolName}" arguments contain path traversal sequences (../../..). This could be used to access files outside the intended directory.`,
				location, suggestion: "Resolve paths to absolute form and validate they remain within the project root.",
				confidence: 0.75, autoFixable: false,
			});
		}

		// Sensitive file path access
		for (const sp of SENSITIVE_PATHS) {
			if (argsStr.includes(sp)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka", domain: "security", severity: "warning",
					title: `Sensitive file access: ${sp}`,
					description: `Tool "${toolName}" references sensitive file "${sp}".`,
					location, suggestion: "Avoid accessing sensitive system files unless absolutely necessary.",
					confidence: 0.8, autoFixable: false,
				});
			}
		}

		return newFindings;
	}

	/** Get the most recent findings, newest first. */
	getFindings(limit?: number): Finding[] { return this.findings.toArray(limit); }

	/** Get aggregate statistics for this guardian. */
	stats(): GuardianStats {
		return {
			scansCompleted: this.scansCompleted, findingsTotal: this.findings.size,
			findingsBySeverity: { ...this.findingsBySeverity },
			autoFixesApplied: this.autoFixesApplied, lastScanAt: this.lastScanAt,
			avgScanDurationMs: this.scansCompleted > 0 ? this.totalScanDurationMs / this.scansCompleted : 0,
		};
	}
}
