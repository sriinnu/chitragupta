/**
 * @chitragupta/anina/lokapala — Rakshaka — रक्षक — Security Guardian.
 *
 * The Protector. Monitors all tool executions, command outputs, and file
 * changes for security violations: leaked credentials, dangerous commands,
 * path traversal, SQL injection, and permission misconfigurations.
 *
 * Like Indra guarding the eastern gate, Rakshaka stands vigilant against
 * threats that might slip through the agent's actions unnoticed.
 *
 * ## Detection Categories
 *
 * | Category            | Severity | Examples                              |
 * |---------------------|----------|---------------------------------------|
 * | Credential leak     | critical | API keys, tokens, private keys        |
 * | Dangerous command   | critical | rm -rf /, chmod 777, curl | sh        |
 * | Path traversal      | warning  | ../../etc/passwd                      |
 * | SQL injection       | warning  | DROP TABLE, UNION SELECT              |
 * | Permission issue    | info     | World-readable sensitive files         |
 *
 * @packageDocumentation
 */

import type { Finding, GuardianConfig, GuardianStats, ScanContext } from "./types.js";
import { fnv1a, resolveConfig, FindingRing } from "./types.js";

// ─── Credential Patterns ────────────────────────────────────────────────────

/** Patterns that indicate leaked credentials in output or arguments. */
const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{
		pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{20,}/i,
		label: "API key",
	},
	{
		pattern: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/i,
		label: "Secret/token/password",
	},
	{
		pattern: /sk-[a-zA-Z0-9_\-]{20,}/,
		label: "OpenAI API key",
	},
	{
		pattern: /ghp_[a-zA-Z0-9]{36}/,
		label: "GitHub personal access token",
	},
	{
		pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
		label: "Private key",
	},
	{
		pattern: /(?:aws_access_key_id|aws_secret_access_key)\s*=\s*\S+/i,
		label: "AWS credential",
	},
	{
		pattern: /xox[bpsa]-[a-zA-Z0-9-]{10,}/,
		label: "Slack token",
	},
	{
		pattern: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,
		label: "JWT token",
	},
];

// ─── Dangerous Command Patterns ─────────────────────────────────────────────

/** Command patterns that are inherently dangerous. */
const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{
		pattern: /rm\s+(?:-[a-zA-Z]*\s+)*[/~]/,
		label: "Recursive delete from root or home",
	},
	{
		pattern: /chmod\s+777\s/,
		label: "World-writable permission",
	},
	{
		pattern: /curl\s.*\|\s*(ba)?sh/,
		label: "Pipe remote script to shell",
	},
	{
		pattern: /wget\s.*\|\s*(ba)?sh/,
		label: "Pipe remote script to shell",
	},
	{
		pattern: /mkfs\./,
		label: "Filesystem format command",
	},
	{
		pattern: /dd\s+.*of=\/dev\//,
		label: "Direct device write",
	},
	{
		pattern: /:\(\)\s*\{.*\|.*&\s*\}\s*;/,
		label: "Fork bomb",
	},
	{
		pattern: />\s*\/dev\/[sh]da/,
		label: "Write to block device",
	},
];

// ─── SQL Injection Patterns ─────────────────────────────────────────────────

/** Patterns that indicate SQL injection attempts. */
const SQL_INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{
		pattern: /(?:DROP|DELETE|TRUNCATE)\s+(?:TABLE|DATABASE)\s/i,
		label: "Destructive SQL statement",
	},
	{
		pattern: /UNION\s+(?:ALL\s+)?SELECT\s/i,
		label: "UNION SELECT injection",
	},
	{
		pattern: /;\s*(?:DROP|DELETE|INSERT|UPDATE|ALTER)\s/i,
		label: "Chained SQL statement",
	},
	{
		pattern: /'\s*OR\s+'?1'?\s*=\s*'?1/i,
		label: "Boolean-based SQL injection",
	},
	{
		pattern: /'\s*--/,
		label: "SQL comment injection",
	},
];

// ─── Path Traversal ─────────────────────────────────────────────────────────

/** Path traversal detection. */
const PATH_TRAVERSAL_PATTERN = /(?:^|\s|["'=])(?:\.\.\/){2,}/;

/** Sensitive file paths that should never appear in tool args. */
const SENSITIVE_PATHS = [
	"/etc/passwd",
	"/etc/shadow",
	"/etc/sudoers",
	".ssh/id_rsa",
	".ssh/id_ed25519",
	".gnupg/",
	".env",
	"credentials.json",
];

// ─── Rakshaka ───────────────────────────────────────────────────────────────

/**
 * Security Guardian -- monitors tool executions and outputs for
 * credential leaks, dangerous commands, injection attacks, and
 * path traversal attempts.
 */
export class Rakshaka {
	private readonly config: GuardianConfig;
	private readonly findings: FindingRing;
	private scansCompleted: number = 0;
	private autoFixesApplied: number = 0;
	private lastScanAt: number = 0;
	private totalScanDurationMs: number = 0;
	private findingsBySeverity: Record<string, number> = {
		info: 0,
		warning: 0,
		critical: 0,
	};

	constructor(config?: Partial<GuardianConfig>) {
		this.config = resolveConfig(config);
		this.findings = new FindingRing(this.config.maxFindings);
	}

	/**
	 * Perform a full security scan over the given context.
	 *
	 * Inspects all tool executions, file changes, and command outputs
	 * for security violations. Returns only findings above the
	 * configured confidence threshold.
	 */
	scan(context: ScanContext): Finding[] {
		if (!this.config.enabled) return [];

		const startMs = Date.now();
		const newFindings: Finding[] = [];

		// Scan each tool execution
		for (const exec of context.toolExecutions) {
			const toolFindings = this.scanToolExecution(
				exec.toolName,
				exec.args,
				exec.output,
			);
			newFindings.push(...toolFindings);
		}

		// Scan file changes for sensitive paths
		if (context.fileChanges) {
			for (const filePath of context.fileChanges) {
				const findings = this.scanFilePath(filePath);
				newFindings.push(...findings);
			}
		}

		// Scan raw command outputs
		if (context.commandOutputs) {
			for (const output of context.commandOutputs) {
				const findings = this.scanText(output, "command-output");
				newFindings.push(...findings);
			}
		}

		this.scansCompleted++;
		this.lastScanAt = Date.now();
		this.totalScanDurationMs += Date.now() - startMs;

		return newFindings;
	}

	/**
	 * Scan a single tool execution for security issues.
	 *
	 * Checks both the tool arguments and the tool output for
	 * credential patterns, dangerous commands, SQL injection,
	 * and path traversal.
	 */
	scanToolExecution(
		toolName: string,
		args: Record<string, unknown>,
		output: string,
	): Finding[] {
		if (!this.config.enabled) return [];

		const newFindings: Finding[] = [];
		const argsStr = JSON.stringify(args);
		const location = `tool:${toolName}`;

		// Credential patterns in output
		for (const { pattern, label } of CREDENTIAL_PATTERNS) {
			if (pattern.test(output)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka",
					domain: "security",
					severity: "critical",
					title: `Credential leak detected: ${label}`,
					description: `Tool "${toolName}" output contains what appears to be a ${label}. This could leak sensitive credentials to logs or context.`,
					location,
					suggestion: "Redact or mask the credential before including in output.",
					confidence: 0.85,
					autoFixable: false,
				});
			}
		}

		// Credential patterns in args
		for (const { pattern, label } of CREDENTIAL_PATTERNS) {
			if (pattern.test(argsStr)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka",
					domain: "security",
					severity: "critical",
					title: `Credential in tool args: ${label}`,
					description: `Tool "${toolName}" was called with arguments containing a ${label}. Arguments may be logged or persisted.`,
					location,
					suggestion: "Use environment variables or a secrets manager instead of inline credentials.",
					confidence: 0.9,
					autoFixable: false,
				});
			}
		}

		// Dangerous commands (only relevant for bash/exec tools)
		if (toolName === "bash" || toolName === "exec" || toolName === "shell") {
			const commandStr = typeof args.command === "string" ? args.command : argsStr;
			for (const { pattern, label } of DANGEROUS_COMMAND_PATTERNS) {
				if (pattern.test(commandStr)) {
					this.addFinding(newFindings, {
						guardianId: "rakshaka",
						domain: "security",
						severity: "critical",
						title: `Dangerous command: ${label}`,
						description: `Command passed to "${toolName}" matches dangerous pattern: ${label}.`,
						location,
						suggestion: "Review the command carefully before execution. Consider using safer alternatives.",
						confidence: 0.95,
						autoFixable: false,
					});
				}
			}
		}

		// SQL injection in args
		for (const { pattern, label } of SQL_INJECTION_PATTERNS) {
			if (pattern.test(argsStr)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka",
					domain: "security",
					severity: "warning",
					title: `SQL injection pattern: ${label}`,
					description: `Tool "${toolName}" arguments contain a potential SQL injection pattern: ${label}.`,
					location,
					suggestion: "Use parameterized queries instead of string concatenation.",
					confidence: 0.7,
					autoFixable: false,
				});
			}
		}

		// Path traversal in args
		if (PATH_TRAVERSAL_PATTERN.test(argsStr)) {
			this.addFinding(newFindings, {
				guardianId: "rakshaka",
				domain: "security",
				severity: "warning",
				title: "Path traversal detected",
				description: `Tool "${toolName}" arguments contain path traversal sequences (../../..). This could be used to access files outside the intended directory.`,
				location,
				suggestion: "Resolve paths to absolute form and validate they remain within the project root.",
				confidence: 0.75,
				autoFixable: false,
			});
		}

		// Sensitive file path access
		for (const sensitivePath of SENSITIVE_PATHS) {
			if (argsStr.includes(sensitivePath)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka",
					domain: "security",
					severity: "warning",
					title: `Sensitive file access: ${sensitivePath}`,
					description: `Tool "${toolName}" references sensitive file "${sensitivePath}".`,
					location,
					suggestion: "Avoid accessing sensitive system files unless absolutely necessary.",
					confidence: 0.8,
					autoFixable: false,
				});
			}
		}

		return newFindings;
	}

	/**
	 * Get the most recent findings, newest first.
	 *
	 * @param limit Maximum number of findings to return (default: all).
	 */
	getFindings(limit?: number): Finding[] {
		return this.findings.toArray(limit);
	}

	/** Get aggregate statistics for this guardian. */
	stats(): GuardianStats {
		return {
			scansCompleted: this.scansCompleted,
			findingsTotal: this.findings.size,
			findingsBySeverity: { ...this.findingsBySeverity },
			autoFixesApplied: this.autoFixesApplied,
			lastScanAt: this.lastScanAt,
			avgScanDurationMs:
				this.scansCompleted > 0
					? this.totalScanDurationMs / this.scansCompleted
					: 0,
		};
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	/**
	 * Scan arbitrary text for credential patterns.
	 * Used for raw command outputs.
	 */
	private scanText(text: string, source: string): Finding[] {
		const newFindings: Finding[] = [];

		for (const { pattern, label } of CREDENTIAL_PATTERNS) {
			if (pattern.test(text)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka",
					domain: "security",
					severity: "critical",
					title: `Credential leak in ${source}: ${label}`,
					description: `Output from "${source}" contains what appears to be a ${label}.`,
					location: source,
					confidence: 0.85,
					autoFixable: false,
				});
			}
		}

		return newFindings;
	}

	/**
	 * Check a file path against the sensitive paths list.
	 */
	private scanFilePath(filePath: string): Finding[] {
		const newFindings: Finding[] = [];

		for (const sensitivePath of SENSITIVE_PATHS) {
			if (filePath.includes(sensitivePath)) {
				this.addFinding(newFindings, {
					guardianId: "rakshaka",
					domain: "security",
					severity: "info",
					title: `Sensitive file modified: ${sensitivePath}`,
					description: `File "${filePath}" matches sensitive path pattern "${sensitivePath}".`,
					location: filePath,
					suggestion: "Ensure this modification is intentional and doesn't expose sensitive data.",
					confidence: 0.7,
					autoFixable: false,
				});
			}
		}

		// Path traversal in file path itself
		if (PATH_TRAVERSAL_PATTERN.test(filePath)) {
			this.addFinding(newFindings, {
				guardianId: "rakshaka",
				domain: "security",
				severity: "warning",
				title: "Path traversal in file change",
				description: `File path "${filePath}" contains traversal sequences.`,
				location: filePath,
				confidence: 0.8,
				autoFixable: false,
			});
		}

		return newFindings;
	}

	/**
	 * Create a Finding, apply confidence threshold filter, and store it.
	 */
	private addFinding(
		accumulator: Finding[],
		partial: Omit<Finding, "id" | "timestamp">,
	): void {
		if (partial.confidence < this.config.confidenceThreshold) return;

		const timestamp = Date.now();
		const id = fnv1a(
			`${partial.guardianId}:${partial.title}:${partial.location ?? ""}:${timestamp}`,
		);

		const finding: Finding = {
			...partial,
			id,
			timestamp,
		};

		this.findings.push(finding);
		this.findingsBySeverity[finding.severity] =
			(this.findingsBySeverity[finding.severity] ?? 0) + 1;
		accumulator.push(finding);
	}
}
