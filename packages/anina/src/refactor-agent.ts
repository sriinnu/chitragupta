/**
 * @chitragupta/anina — Parikartru (परिकर्तृ) — Refactor Agent.
 *
 * Systematically improves code structure, naming, and patterns
 * while preserving behavior. Always validates after changes.
 */

import { PARIKARTRU_PROFILE } from "@chitragupta/core";

import { Agent } from "./agent.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Tool names required for refactoring.
 * Refactoring agents need the full toolkit — read, write, edit, search, and bash.
 *
 * @example
 * ```ts
 * import { getAllTools } from "@chitragupta/yantra";
 * const refactorTools = getAllTools().filter(t => REFACTOR_TOOL_NAMES.has(t.definition.name));
 * ```
 */
export const REFACTOR_TOOL_NAMES = new Set([
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
	"diff",
]);

/** Default maximum files to modify in a single refactor. */
const DEFAULT_MAX_FILES = 10;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for creating a refactor agent. */
export interface RefactorAgentConfig {
	workingDirectory: string;
	/** Test command to run after refactoring. */
	testCommand?: string;
	/** Build/compile command. */
	buildCommand?: string;
	/** Maximum files to modify in one refactor. Default: 10. */
	maxFiles?: number;
	/** Whether to run tests after each file change. Default: true. */
	validatePerFile?: boolean;
	/** Provider and model overrides. */
	providerId?: string;
	modelId?: string;
	/** Parent agent for sub-agent spawning. */
	parentAgent?: Agent;
	/**
	 * Tool handlers to use. If not provided, the agent has no tools.
	 * Use REFACTOR_TOOL_NAMES to filter a full tool set to refactor-relevant tools.
	 */
	tools?: ToolHandler[];
	/** CommHub for IPC. */
	commHub?: AgentConfig["commHub"];
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
}

/** The type of refactoring operation. */
export type RefactorType = "rename" | "extract" | "inline" | "move" | "simplify" | "modernize" | "general";

/** A plan describing a refactoring before execution. */
export interface RefactorPlan {
	type: RefactorType;
	description: string;
	filesAffected: string[];
	estimatedChanges: number;
	risks: string[];
}

/** Result of a completed refactoring. */
export interface RefactorResult {
	success: boolean;
	plan: RefactorPlan;
	filesModified: string[];
	validationPassed: boolean;
	validationOutput?: string;
	summary: string;
	rollbackCommand?: string;
}

// ─── RefactorAgent ───────────────────────────────────────────────────────────

/**
 * Parikartru -- a refactoring agent that systematically improves code
 * structure, naming, and patterns while preserving behavior.
 * Always validates changes against build and test commands.
 *
 * @example
 * ```ts
 * import { RefactorAgent } from "@chitragupta/anina";
 * import { getAllTools } from "@chitragupta/yantra";
 *
 * const refactorer = new RefactorAgent({
 *   workingDirectory: "/path/to/project",
 *   tools: getAllTools(),
 *   testCommand: "npm test",
 *   buildCommand: "npm run build",
 * });
 * const plan = await refactorer.plan("Extract auth logic into a service class");
 * const result = await refactorer.execute("Extract auth logic into a service class");
 * console.log(result.summary, result.validationPassed);
 * ```
 */
export class RefactorAgent {
	private agent: Agent;
	private config: RefactorAgentConfig & {
		maxFiles: number;
		validatePerFile: boolean;
	};

	constructor(config: RefactorAgentConfig) {
		this.config = {
			...config,
			maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
			validatePerFile: config.validatePerFile ?? true,
		};

		// Refactoring needs the full code toolkit
		const tools = config.tools
			? config.tools.filter((t) => REFACTOR_TOOL_NAMES.has(t.definition.name))
			: [];

		const agentConfig: AgentConfig = {
			profile: PARIKARTRU_PROFILE,
			providerId: config.providerId ?? "anthropic",
			model: config.modelId ?? PARIKARTRU_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools,
			thinkingLevel: PARIKARTRU_PROFILE.preferredThinking ?? "high",
			workingDirectory: config.workingDirectory,
			policyEngine: config.policyEngine,
			commHub: config.commHub,
		};

		this.agent = new Agent(agentConfig);
	}

	/**
	 * Plan a refactoring without executing it.
	 *
	 * The agent reads relevant files, analyzes the codebase, and proposes
	 * a plan with affected files, estimated changes, and risks.
	 */
	async plan(description: string): Promise<RefactorPlan> {
		const prompt = [
			"Plan the following refactoring WITHOUT making any changes:",
			"",
			description,
			"",
			`Maximum files to modify: ${this.config.maxFiles}`,
			"",
			"Read the relevant files and analyze what needs to change.",
			"DO NOT edit or write any files. Only read and search.",
			"",
			this.buildPlanOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parsePlanResponse(response);
	}

	/**
	 * Execute a refactoring with validation.
	 *
	 * The agent will:
	 * 1. Analyze the codebase
	 * 2. Make the changes
	 * 3. Run `git diff` to show what changed
	 * 4. Validate with build + test commands
	 * 5. Provide a rollback command
	 */
	async execute(description: string): Promise<RefactorResult> {
		const prompt = [
			"Execute the following refactoring:",
			"",
			description,
			"",
			`Maximum files to modify: ${this.config.maxFiles}`,
			this.config.validatePerFile ? "Validate after each file change if possible." : "",
			"",
			"Steps:",
			"1. Read the relevant files to understand the current state",
			"2. Make the changes carefully, preserving behavior",
			"3. Run `git diff` to show what changed",
			this.config.buildCommand ? `4. Build: ${this.config.buildCommand}` : "",
			this.config.testCommand ? `5. Test: ${this.config.testCommand}` : "",
			"",
			this.buildResultOutputInstructions(),
		].filter(Boolean).join("\n");

		const response = await this.agent.prompt(prompt);
		const plan = this.parsePlanFromResult(response);
		const result = this.parseResultResponse(response, plan);

		// Run validation if commands are configured
		if (this.hasValidationCommands()) {
			const validation = await this.validate();
			result.validationPassed = validation.passed;
			result.validationOutput = validation.output;

			// If validation failed, try one more time
			if (!validation.passed) {
				const fixPrompt = [
					"The refactoring broke the build/tests. Fix the issues:",
					"```",
					validation.output,
					"```",
					"",
					"Fix the problems while preserving the refactoring intent.",
					"",
					this.buildResultOutputInstructions(),
				].join("\n");

				const fixResponse = await this.agent.prompt(fixPrompt);
				const fixResult = this.parseResultResponse(fixResponse, plan);

				const retryValidation = await this.validate();
				fixResult.validationPassed = retryValidation.passed;
				fixResult.validationOutput = retryValidation.output;

				return fixResult;
			}
		}

		return result;
	}

	/**
	 * Rename a symbol across the codebase.
	 *
	 * Greps for the old name, edits each occurrence, and validates.
	 */
	async rename(oldName: string, newName: string, scope?: string): Promise<RefactorResult> {
		const scopeStr = scope ? ` within ${scope}` : "";
		return this.execute(`Rename "${oldName}" to "${newName}"${scopeStr}. Update all references, imports, and documentation.`);
	}

	/**
	 * Extract a function/method from a code region.
	 */
	async extract(filePath: string, description: string): Promise<RefactorResult> {
		return this.execute(`In ${filePath}: ${description}. Extract the identified code into a well-named function/method and update all callers.`);
	}

	/** Get the underlying agent instance. */
	getAgent(): Agent {
		return this.agent;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────────

	/**
	 * Build output instructions for the plan response.
	 */
	private buildPlanOutputInstructions(): string {
		return [
			"Format your response to include these clearly labeled sections:",
			"",
			"TYPE: <one of: rename, extract, inline, move, simplify, modernize, general>",
			"DESCRIPTION: <1-3 sentence description of the refactoring>",
			"FILES AFFECTED: <comma-separated list of files that would be changed>",
			"ESTIMATED CHANGES: <number of estimated individual edits>",
			"RISKS: <comma-separated list of risks or things that could go wrong>",
		].join("\n");
	}

	/**
	 * Build output instructions for the result response.
	 */
	private buildResultOutputInstructions(): string {
		return [
			"Format your response to include these clearly labeled sections:",
			"",
			"TYPE: <one of: rename, extract, inline, move, simplify, modernize, general>",
			"DESCRIPTION: <1-3 sentence description of the refactoring>",
			"FILES AFFECTED: <comma-separated list of files that would be changed>",
			"ESTIMATED CHANGES: <number of estimated individual edits>",
			"RISKS: <comma-separated list of risks>",
			"FILES MODIFIED: <comma-separated list of files actually modified>",
			"SUCCESS: YES or NO",
			"SUMMARY: <brief summary of what was done>",
			"ROLLBACK: <git command to undo the changes, e.g., git checkout -- file1 file2>",
		].join("\n");
	}

	/**
	 * Parse a RefactorPlan from the agent response.
	 */
	private parsePlanResponse(message: AgentMessage): RefactorPlan {
		const text = this.extractText(message);
		return this.parsePlanFromText(text);
	}

	/**
	 * Parse a RefactorPlan from text.
	 */
	private parsePlanFromText(text: string): RefactorPlan {
		const typeStr = this.parseField(text, "TYPE") ?? "general";
		const description = this.parseField(text, "DESCRIPTION") ?? "No description provided.";
		const filesStr = this.parseField(text, "FILES AFFECTED") ?? "";
		const changesStr = this.parseField(text, "ESTIMATED CHANGES") ?? "0";
		const risksStr = this.parseField(text, "RISKS") ?? "";

		const validTypes = new Set<RefactorType>(["rename", "extract", "inline", "move", "simplify", "modernize", "general"]);
		const type: RefactorType = validTypes.has(typeStr.toLowerCase() as RefactorType)
			? (typeStr.toLowerCase() as RefactorType)
			: "general";

		const filesAffected = filesStr
			.split(/[,\n]/)
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		const estimatedChanges = parseInt(changesStr, 10) || 0;

		const risks = risksStr
			.split(/[,\n]/)
			.map((r) => r.trim())
			.filter((r) => r.length > 0);

		return { type, description, filesAffected, estimatedChanges, risks };
	}

	/**
	 * Parse a RefactorPlan from a result response (which has both plan and result fields).
	 */
	private parsePlanFromResult(message: AgentMessage): RefactorPlan {
		const text = this.extractText(message);
		return this.parsePlanFromText(text);
	}

	/**
	 * Parse the full RefactorResult from the agent response.
	 */
	private parseResultResponse(message: AgentMessage, plan: RefactorPlan): RefactorResult {
		const text = this.extractText(message);

		const filesModifiedStr = this.parseField(text, "FILES MODIFIED") ?? "";
		const successStr = this.parseField(text, "SUCCESS") ?? "NO";
		const summary = this.parseField(text, "SUMMARY") ?? "Refactoring completed.";
		const rollbackCommand = this.parseField(text, "ROLLBACK");

		const filesModified = filesModifiedStr
			.split(/[,\n]/)
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		const success = successStr.trim().toUpperCase() === "YES";

		return {
			success,
			plan,
			filesModified,
			validationPassed: true, // Overridden after validation
			validationOutput: undefined,
			summary,
			rollbackCommand,
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
	 * Parse a labeled field from the agent's text response.
	 */
	private parseField(text: string, field: string): string | undefined {
		const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`^${escaped}:\\s*(.+?)$`, "im");
		const match = text.match(regex);
		return match ? match[1].trim() : undefined;
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
