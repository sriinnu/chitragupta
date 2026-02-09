/**
 * @chitragupta/anina — Anveshi (अन्वेषी) — Debug Agent.
 *
 * Investigates bugs and errors through systematic analysis:
 * 1. Understand the error (parse stack traces, error messages)
 * 2. Locate the source (find files, grep for patterns)
 * 3. Hypothesize root cause
 * 4. Verify hypothesis (read surrounding code, check recent changes)
 * 5. Propose fix (with diff preview)
 * 6. Optionally apply fix and validate
 *
 * In Sanskrit, anveshi is the seeker — one who traces causes back to
 * their roots through methodical investigation.
 */

import { ANVESHI_PROFILE } from "@chitragupta/core";

import { Agent } from "./agent.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Tool names required for debugging.
 * Debuggers need the full toolkit — reading, searching, AND writing (for fixes).
 */
export const DEBUG_TOOL_NAMES = new Set([
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
	"diff",
]);

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for creating a debug agent. */
export interface DebugAgentConfig {
	workingDirectory: string;
	/** Whether to auto-fix after finding root cause. Default: false. */
	autoFix?: boolean;
	/** Test command to verify fix. */
	testCommand?: string;
	/** Build command. */
	buildCommand?: string;
	/** Provider and model overrides. */
	providerId?: string;
	modelId?: string;
	/** Parent agent for sub-agent spawning. */
	parentAgent?: Agent;
	/**
	 * Tool handlers to use. If not provided, the agent has no tools.
	 * Use DEBUG_TOOL_NAMES to filter a full tool set to debug-relevant tools.
	 */
	tools?: ToolHandler[];
	/** CommHub for IPC. */
	commHub?: AgentConfig["commHub"];
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
}

/** A structured bug report to investigate. */
export interface BugReport {
	/** Error message or bug description. */
	error: string;
	/** Stack trace if available. */
	stackTrace?: string;
	/** Steps to reproduce. */
	reproduction?: string;
	/** Relevant file paths. */
	relevantFiles?: string[];
}

/** Result of a debugging investigation. */
export interface DebugResult {
	/** Root cause analysis. */
	rootCause: string;
	/** Files investigated during analysis. */
	filesInvestigated: string[];
	/** The file and line where the bug originates. */
	bugLocation?: { file: string; line: number };
	/** Proposed fix description. */
	proposedFix: string;
	/** Whether fix was applied. */
	fixApplied: boolean;
	/** Whether fix passed validation (build + test). */
	validationPassed?: boolean;
	/** Confidence in the diagnosis [0, 1]. */
	confidence: number;
}

// ─── DebugAgent ──────────────────────────────────────────────────────────────

/**
 * Anveshi -- a debug agent that systematically investigates bugs
 * through error parsing, source location, hypothesis verification,
 * and optional auto-fixing with validation.
 *
 * @example
 * ```ts
 * import { DebugAgent } from "@chitragupta/anina";
 * import { getAllTools } from "@chitragupta/yantra";
 *
 * const debugger = new DebugAgent({
 *   workingDirectory: "/path/to/project",
 *   tools: getAllTools(),
 *   autoFix: true,
 *   testCommand: "npm test",
 * });
 * const result = await debugger.investigate({
 *   error: "TypeError: Cannot read properties of null",
 *   stackTrace: "at AuthService.validate (src/auth.ts:42)",
 * });
 * console.log(result.rootCause, result.confidence);
 * ```
 */
export class DebugAgent {
	private agent: Agent;
	private config: DebugAgentConfig & {
		autoFix: boolean;
	};

	constructor(config: DebugAgentConfig) {
		this.config = {
			...config,
			autoFix: config.autoFix ?? false,
		};

		// Debuggers need ALL code tools — including write/edit for applying fixes
		const tools = config.tools
			? config.tools.filter((t) => DEBUG_TOOL_NAMES.has(t.definition.name))
			: [];

		const agentConfig: AgentConfig = {
			profile: ANVESHI_PROFILE,
			providerId: config.providerId ?? "anthropic",
			model: config.modelId ?? ANVESHI_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools,
			thinkingLevel: ANVESHI_PROFILE.preferredThinking ?? "high",
			workingDirectory: config.workingDirectory,
			policyEngine: config.policyEngine,
			commHub: config.commHub,
		};

		this.agent = new Agent(agentConfig);
	}

	/**
	 * Investigate a bug from an error message or description.
	 *
	 * Follows the Anveshi method:
	 * 1. Parse the error and stack trace
	 * 2. Locate the source files
	 * 3. Hypothesize root cause
	 * 4. Verify hypothesis
	 * 5. Propose fix
	 */
	async investigate(report: BugReport): Promise<DebugResult> {
		const prompt = this.buildInvestigatePrompt(report, this.config.autoFix);
		const response = await this.agent.prompt(prompt);
		return this.parseDebugResponse(response);
	}

	/**
	 * Investigate a failing test.
	 *
	 * Runs the test command to capture the error output, then passes it
	 * as a BugReport for investigation.
	 */
	async investigateTest(testCommand: string): Promise<DebugResult> {
		let testOutput: string;
		let testFailed = false;

		try {
			testOutput = safeExecSync(testCommand, {
				cwd: this.config.workingDirectory,
				encoding: "utf-8",
				timeout: 120_000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err: unknown) {
			testFailed = true;
			const execErr = err as { stdout?: string; stderr?: string; message?: string };
			// If this is a validation error (not an exec error), re-throw
			if (execErr.message?.startsWith("Command rejected:")) {
				throw err;
			}
			testOutput = [execErr.stderr ?? "", execErr.stdout ?? ""].filter(Boolean).join("\n");
		}

		if (!testFailed) {
			return {
				rootCause: "Test passed successfully — no bug found.",
				filesInvestigated: [],
				proposedFix: "No fix needed.",
				fixApplied: false,
				confidence: 1.0,
			};
		}

		// Parse out the error message and stack trace from test output
		const { error, stackTrace } = this.parseTestOutput(testOutput);

		const report: BugReport = {
			error: error || `Test failed: ${testCommand}`,
			stackTrace,
			reproduction: `Run: ${testCommand}`,
		};

		return this.investigate(report);
	}

	/**
	 * Quick fix: investigate + auto-apply fix + validate.
	 *
	 * This is a convenience method that creates a bug report with autoFix=true,
	 * investigates the bug, applies the fix, and validates it against the
	 * configured build and test commands.
	 */
	async quickFix(report: BugReport): Promise<DebugResult> {
		const prompt = this.buildInvestigatePrompt(report, true);
		const response = await this.agent.prompt(prompt);
		const result = this.parseDebugResponse(response);

		// If the agent applied a fix, validate it
		if (result.fixApplied && this.hasValidationCommands()) {
			const validation = await this.validate();
			result.validationPassed = validation.passed;

			// If validation failed, tell the agent and let it try again
			if (!validation.passed) {
				const retryPrompt = [
					"The fix was applied but validation failed:",
					"```",
					validation.output,
					"```",
					"",
					"Please analyze the validation failure, fix it, and try again.",
					"Update your ROOT CAUSE, PROPOSED FIX, and CONFIDENCE accordingly.",
				].join("\n");

				const retryResponse = await this.agent.prompt(retryPrompt);
				const retryResult = this.parseDebugResponse(retryResponse);

				// Re-validate after retry
				if (retryResult.fixApplied) {
					const retryValidation = await this.validate();
					retryResult.validationPassed = retryValidation.passed;
				}

				return retryResult;
			}
		}

		return result;
	}

	/** Get the underlying agent instance. */
	getAgent(): Agent {
		return this.agent;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────────

	/**
	 * Build the investigation prompt from a bug report.
	 */
	private buildInvestigatePrompt(report: BugReport, autoFix: boolean): string {
		const parts: string[] = [];

		parts.push("Investigate the following bug report and find the root cause.");
		parts.push("");

		parts.push(`ERROR: ${report.error}`);

		if (report.stackTrace) {
			parts.push("");
			parts.push("STACK TRACE:");
			parts.push("```");
			parts.push(report.stackTrace);
			parts.push("```");
		}

		if (report.reproduction) {
			parts.push("");
			parts.push(`REPRODUCTION: ${report.reproduction}`);
		}

		if (report.relevantFiles && report.relevantFiles.length > 0) {
			parts.push("");
			parts.push("RELEVANT FILES:");
			for (const f of report.relevantFiles) {
				parts.push(`- ${f}`);
			}
		}

		parts.push("");
		parts.push("Follow your investigation method systematically:");
		parts.push("1. Parse the error — what is the symptom?");
		parts.push("2. Locate the source — find the file and line");
		parts.push("3. Hypothesize — what could cause this?");
		parts.push("4. Verify — read surrounding code, check recent changes (git log, git blame)");
		parts.push("5. Propose — describe the minimal fix");

		if (autoFix) {
			parts.push("6. APPLY the fix — edit the file(s) to implement your proposed fix");
			if (this.config.testCommand) {
				parts.push(`7. Run tests to verify: ${this.config.testCommand}`);
			}
		}

		parts.push("");
		parts.push(this.buildOutputInstructions(autoFix));

		return parts.join("\n");
	}

	/**
	 * Build the output format instructions for the debug prompt.
	 */
	private buildOutputInstructions(autoFix: boolean): string {
		const lines = [
			"Format your response to include these clearly labeled sections:",
			"",
			"ROOT CAUSE: <1-3 sentence explanation of WHY the bug occurs>",
			"BUG LOCATION: <file>:<line>",
			"PROPOSED FIX: <description of the minimal change needed>",
			"CONFIDENCE: <number 0.0 to 1.0>",
			"FILES INVESTIGATED: <comma-separated list of files you read>",
		];

		if (autoFix) {
			lines.push("FIX APPLIED: YES or NO");
		}

		return lines.join("\n");
	}

	/**
	 * Parse the agent's response into a structured DebugResult.
	 */
	private parseDebugResponse(message: AgentMessage): DebugResult {
		const text = this.extractText(message);

		const rootCause = this.parseField(text, "ROOT CAUSE") ?? "Unable to determine root cause.";
		const proposedFix = this.parseField(text, "PROPOSED FIX") ?? "No fix proposed.";
		const confidenceStr = this.parseField(text, "CONFIDENCE") ?? "0.5";
		const bugLocationStr = this.parseField(text, "BUG LOCATION");
		const filesStr = this.parseField(text, "FILES INVESTIGATED") ?? "";
		const fixAppliedStr = this.parseField(text, "FIX APPLIED");

		// Parse confidence
		const confidence = Math.max(0, Math.min(1, parseFloat(confidenceStr) || 0.5));

		// Parse bug location (format: "file:line")
		let bugLocation: { file: string; line: number } | undefined;
		if (bugLocationStr) {
			const locMatch = bugLocationStr.match(/^(.+?):(\d+)/);
			if (locMatch) {
				bugLocation = { file: locMatch[1].trim(), line: parseInt(locMatch[2], 10) };
			}
		}

		// Parse files investigated
		const filesInvestigated = filesStr
			.split(/[,\n]/)
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		// Parse fix applied
		const fixApplied = fixAppliedStr?.trim().toUpperCase() === "YES";

		return {
			rootCause,
			filesInvestigated,
			bugLocation,
			proposedFix,
			fixApplied,
			confidence,
		};
	}

	/**
	 * Parse a labeled field from the agent's text response.
	 * Matches "FIELD: value" patterns, capturing everything after the colon.
	 */
	private parseField(text: string, field: string): string | undefined {
		// Escape regex special chars in the field name
		const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`^${escaped}:\\s*(.+?)$`, "im");
		const match = text.match(regex);
		return match ? match[1].trim() : undefined;
	}

	/**
	 * Parse test output into error message and stack trace.
	 */
	private parseTestOutput(output: string): { error: string; stackTrace?: string } {
		const lines = output.split("\n");

		// Look for common error patterns
		let errorLine = "";
		let stackStart = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Node.js/TypeScript error patterns
			if (line.match(/^\s*(Error|TypeError|ReferenceError|SyntaxError|RangeError):/)) {
				errorLine = line.trim();
				stackStart = i + 1;
				break;
			}

			// Jest/Vitest assertion patterns
			if (line.match(/^\s*(FAIL|AssertionError|expect\()/)) {
				errorLine = line.trim();
				stackStart = i + 1;
				break;
			}

			// Generic "error" keyword
			if (line.toLowerCase().includes("error") && !errorLine) {
				errorLine = line.trim();
			}
		}

		// Extract stack trace
		let stackTrace: string | undefined;
		if (stackStart > 0) {
			const stackLines: string[] = [];
			for (let i = stackStart; i < lines.length; i++) {
				if (lines[i].match(/^\s+at /)) {
					stackLines.push(lines[i]);
				} else if (stackLines.length > 0) {
					break; // End of stack trace
				}
			}
			if (stackLines.length > 0) {
				stackTrace = stackLines.join("\n");
			}
		}

		return {
			error: errorLine || output.slice(0, 500),
			stackTrace,
		};
	}

	/**
	 * Run validation: build command then test command.
	 */
	private async validate(): Promise<{ passed: boolean; output: string }> {
		const outputs: string[] = [];
		let allPassed = true;

		const commands = [
			{ label: "build", cmd: this.config.buildCommand },
			{ label: "test", cmd: this.config.testCommand },
		];

		for (const { label, cmd } of commands) {
			if (!cmd) continue;

			try {
				const result = safeExecSync(cmd, {
					cwd: this.config.workingDirectory,
					encoding: "utf-8",
					timeout: 120_000,
					stdio: ["pipe", "pipe", "pipe"],
				});
				outputs.push(`[${label}] PASSED\n${result}`);
			} catch (err: unknown) {
				const execErr = err as { stdout?: string; stderr?: string; message?: string };
				// If this is a validation error, re-throw immediately
				if (execErr.message?.startsWith("Command rejected:")) {
					throw err;
				}
				allPassed = false;
				const stderr = execErr.stderr ?? "";
				const stdout = execErr.stdout ?? "";
				outputs.push(`[${label}] FAILED\n${stderr}\n${stdout}`);
			}
		}

		return {
			passed: allPassed,
			output: outputs.join("\n---\n"),
		};
	}

	/**
	 * Check whether any validation commands are configured.
	 */
	private hasValidationCommands(): boolean {
		return !!(this.config.buildCommand ?? this.config.testCommand);
	}

	/**
	 * Extract plain text from an agent message.
	 */
	private extractText(message: AgentMessage): string {
		return message.content
			.filter((p) => p.type === "text")
			.map((p) => (p as { type: "text"; text: string }).text)
			.join("\n");
	}
}
