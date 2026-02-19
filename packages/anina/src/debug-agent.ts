/**
 * @chitragupta/anina — Anveshi (अन्वेषी) — Debug Agent.
 *
 * Investigates bugs through systematic analysis: parse error, locate source,
 * hypothesize root cause, verify, propose fix, optionally apply and validate.
 *
 * Prompt building, response parsing, test output parsing, and validation
 * execution live in debug-agent-helpers.ts.
 */

import { ANVESHI_PROFILE } from "@chitragupta/core";
import { Agent } from "./agent.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentConfig, ToolHandler } from "./types.js";
import {
	buildInvestigatePrompt, parseDebugResponse, parseTestOutput, runValidation,
} from "./debug-agent-helpers.js";

// Re-export helpers for consumers
export {
	buildInvestigatePrompt, buildOutputInstructions,
	parseDebugResponse, parseTestOutput, runValidation,
} from "./debug-agent-helpers.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Tool names required for debugging. */
export const DEBUG_TOOL_NAMES = new Set([
	"read", "write", "edit", "bash", "grep", "find", "ls", "diff",
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
	providerId?: string;
	modelId?: string;
	parentAgent?: Agent;
	tools?: ToolHandler[];
	commHub?: AgentConfig["commHub"];
	policyEngine?: AgentConfig["policyEngine"];
	samiti?: AgentConfig["samiti"];
	lokapala?: AgentConfig["lokapala"];
	actorSystem?: AgentConfig["actorSystem"];
	kaala?: AgentConfig["kaala"];
}

/** A structured bug report to investigate. */
export interface BugReport {
	error: string;
	stackTrace?: string;
	reproduction?: string;
	relevantFiles?: string[];
}

/** Result of a debugging investigation. */
export interface DebugResult {
	rootCause: string;
	filesInvestigated: string[];
	bugLocation?: { file: string; line: number };
	proposedFix: string;
	fixApplied: boolean;
	validationPassed?: boolean;
	confidence: number;
}

// ─── DebugAgent ──────────────────────────────────────────────────────────────

/**
 * Anveshi -- a debug agent that systematically investigates bugs
 * through error parsing, source location, hypothesis verification,
 * and optional auto-fixing with validation.
 */
export class DebugAgent {
	private agent: Agent;
	private config: DebugAgentConfig & { autoFix: boolean };

	constructor(config: DebugAgentConfig) {
		this.config = { ...config, autoFix: config.autoFix ?? false };
		const tools = config.tools ? config.tools.filter((t) => DEBUG_TOOL_NAMES.has(t.definition.name)) : [];
		const agentConfig: AgentConfig = {
			profile: ANVESHI_PROFILE, providerId: config.providerId ?? "anthropic",
			model: config.modelId ?? ANVESHI_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools, thinkingLevel: ANVESHI_PROFILE.preferredThinking ?? "high",
			workingDirectory: config.workingDirectory,
			policyEngine: config.policyEngine, commHub: config.commHub,
			actorSystem: config.actorSystem, samiti: config.samiti,
			lokapala: config.lokapala, kaala: config.kaala,
		};
		this.agent = new Agent(agentConfig);
	}

	/** Investigate a bug from an error message or description. */
	async investigate(report: BugReport): Promise<DebugResult> {
		const prompt = buildInvestigatePrompt(report, this.config.autoFix, this.config.testCommand);
		const response = await this.agent.prompt(prompt);
		return parseDebugResponse(response);
	}

	/** Investigate a failing test by running it and capturing output. */
	async investigateTest(testCommand: string): Promise<DebugResult> {
		let testOutput: string;
		let testFailed = false;
		try {
			testOutput = safeExecSync(testCommand, {
				cwd: this.config.workingDirectory, encoding: "utf-8", timeout: 120_000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err: unknown) {
			testFailed = true;
			const execErr = err as { stdout?: string; stderr?: string; message?: string };
			if (execErr.message?.startsWith("Command rejected:")) throw err;
			testOutput = [execErr.stderr ?? "", execErr.stdout ?? ""].filter(Boolean).join("\n");
		}
		if (!testFailed) {
			return {
				rootCause: "Test passed successfully — no bug found.",
				filesInvestigated: [], proposedFix: "No fix needed.", fixApplied: false, confidence: 1.0,
			};
		}
		const { error, stackTrace } = parseTestOutput(testOutput);
		return this.investigate({ error: error || `Test failed: ${testCommand}`, stackTrace, reproduction: `Run: ${testCommand}` });
	}

	/** Quick fix: investigate + auto-apply fix + validate. */
	async quickFix(report: BugReport): Promise<DebugResult> {
		const prompt = buildInvestigatePrompt(report, true, this.config.testCommand);
		const response = await this.agent.prompt(prompt);
		const result = parseDebugResponse(response);

		if (result.fixApplied && this.hasValidationCommands()) {
			const validation = await runValidation(this.config.workingDirectory, this.config.buildCommand, this.config.testCommand);
			result.validationPassed = validation.passed;

			if (!validation.passed) {
				const retryPrompt = [
					"The fix was applied but validation failed:", "```", validation.output, "```", "",
					"Please analyze the validation failure, fix it, and try again.",
					"Update your ROOT CAUSE, PROPOSED FIX, and CONFIDENCE accordingly.",
				].join("\n");
				const retryResponse = await this.agent.prompt(retryPrompt);
				const retryResult = parseDebugResponse(retryResponse);
				if (retryResult.fixApplied) {
					const rv = await runValidation(this.config.workingDirectory, this.config.buildCommand, this.config.testCommand);
					retryResult.validationPassed = rv.passed;
				}
				return retryResult;
			}
		}
		return result;
	}

	/** Get the underlying agent instance. */
	getAgent(): Agent { return this.agent; }

	private hasValidationCommands(): boolean {
		return !!(this.config.buildCommand ?? this.config.testCommand);
	}
}
