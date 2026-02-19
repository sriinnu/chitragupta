/** @chitragupta/anina — Kartru (कर्तृ) — Coding Agent. */

import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { KARTRU_PROFILE } from "@chitragupta/core";

import { Agent } from "./agent.js";
import { detectProjectConventions } from "./coding-agent-conventions.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Tool names relevant for coding tasks. */
export const CODE_TOOL_NAMES = new Set(["read", "write", "edit", "bash", "grep", "find", "ls", "diff"]);

// ─── Types ───────────────────────────────────────────────────────────────────

/** Event types emitted by the coding agent during execution. */
export type CodingAgentEvent =
	| { type: "tool_call"; name: string; args: Record<string, unknown> }
	| { type: "tool_done"; name: string; durationMs: number }
	| { type: "thinking"; text: string }
	| { type: "text"; text: string }
	| { type: "file_modified"; path: string }
	| { type: "file_created"; path: string }
	| { type: "validation_start" }
	| { type: "validation_result"; passed: boolean; output: string }
	| { type: "retry"; attempt: number; maxRetries: number };

/** Configuration for creating a coding agent. */
export interface CodingAgentConfig {
	providerId?: string;
	modelId?: string;
	workingDirectory: string;
	language?: string;
	testCommand?: string;
	buildCommand?: string;
	lintCommand?: string;
	autoValidate?: boolean;
	maxValidationRetries?: number;
	parentAgent?: Agent;
	additionalContext?: string;
	commHub?: AgentConfig["commHub"];
	policyEngine?: AgentConfig["policyEngine"];
	samiti?: AgentConfig["samiti"];
	lokapala?: AgentConfig["lokapala"];
	actorSystem?: AgentConfig["actorSystem"];
	kaala?: AgentConfig["kaala"];
	tools?: ToolHandler[];
	onEvent?: (event: CodingAgentEvent) => void;
}

/** Result of a coding task. */
export interface CodingResult {
	/** Whether the task succeeded. */
	success: boolean;
	/** Files that were modified. */
	filesModified: string[];
	/** Files that were created. */
	filesCreated: string[];
	/** Whether validation passed (compile + test). */
	validationPassed: boolean;
	/** Validation output (compile errors, test results). */
	validationOutput?: string;
	/** The agent's summary of what was done. */
	summary: string;
	/** Number of validation retries needed. */
	validationRetries: number;
}

/** Detected project conventions inferred from the working directory. */
export interface ProjectConventions {
	/** Primary language (e.g. "typescript", "javascript", "unknown"). */
	language: string;
	/** Shell command to run tests (e.g. "npm test"). */
	testCommand?: string;
	/** Shell command to build/compile (e.g. "npm run build"). */
	buildCommand?: string;
	/** Shell command to lint (e.g. "npx eslint ."). */
	lintCommand?: string;
	/** Detected indentation style. */
	indentation: "tabs" | "spaces";
	/** Detected indent width (e.g. 2, 4). */
	indentWidth: number;
	/** Module system in use. */
	moduleSystem: "esm" | "commonjs" | "unknown";
	/** Whether a tsconfig.json was found. */
	hasTypeScript: boolean;
	/** Detected framework (e.g. "react", "next.js"). */
	framework?: string;
	/** Whether this is a monorepo. */
	isMonorepo?: boolean;
	/** Package manager in use (npm, pnpm, yarn, bun). */
	packageManager?: string;
	/** Detected test framework (vitest, jest, mocha, ava, tap). */
	testFramework?: string;
	/** Detected formatter (prettier, biome). */
	formatter?: string;
	/** TypeScript strictness level (strict, moderate, loose). */
	tsStrictness?: "strict" | "moderate" | "loose";
	/** TypeScript compilation target. */
	tsTarget?: string;
	/** Test directory pattern (e.g. "__tests__", "test", "*.test.ts"). */
	testPattern?: string;
}

// ─── CodingAgent ─────────────────────────────────────────────────────────────

/**
 * Kartru -- a preconfigured coding agent that reads, writes, edits,
 * and validates code using auto-detected project conventions.
 *
 * @example
 * ```ts
 * import { CodingAgent } from "@chitragupta/anina";
 * import { getAllTools } from "@chitragupta/yantra";
 *
 * const agent = new CodingAgent({
 *   workingDirectory: "/path/to/project",
 *   tools: getAllTools(),
 * });
 * const result = await agent.execute("Add input validation to the login form");
 * console.log(result.summary, result.validationPassed);
 * ```
 */
export class CodingAgent {
	private agent: Agent;
	private config: CodingAgentConfig & {
		autoValidate: boolean;
		maxValidationRetries: number;
	};
	private filesModified: Set<string> = new Set();
	private filesCreated: Set<string> = new Set();
	private conventions: ProjectConventions | null = null;

	constructor(config: CodingAgentConfig) {
		this.config = {
			...config,
			autoValidate: config.autoValidate ?? true,
			maxValidationRetries: config.maxValidationRetries ?? 3,
		};

		// Filter tools to code-relevant subset (if full set is provided)
		const tools = config.tools
			? config.tools.filter((t) => CODE_TOOL_NAMES.has(t.definition.name))
			: [];

		const agentConfig: AgentConfig = {
			profile: KARTRU_PROFILE,
			providerId: config.providerId ?? "anthropic",
			model: config.modelId ?? KARTRU_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools,
			thinkingLevel: KARTRU_PROFILE.preferredThinking ?? "high",
			workingDirectory: config.workingDirectory,
			onEvent: (event, data) => {
				this.trackFileOperations(event, data);
				this.forwardEvent(event, data);
			},
			policyEngine: config.policyEngine,
			commHub: config.commHub,
			actorSystem: config.actorSystem,
			samiti: config.samiti,
			lokapala: config.lokapala,
			kaala: config.kaala,
		};

		this.agent = new Agent(agentConfig);
	}

	/**
	 * Execute a coding task.
	 *
	 * The agent will:
	 * 1. Understand the task
	 * 2. Read relevant files
	 * 3. Make changes
	 * 4. Validate (compile + test if configured)
	 * 5. Retry if validation fails (up to maxValidationRetries)
	 */
	async execute(task: string): Promise<CodingResult> {
		// Detect conventions if not already done
		if (!this.conventions) {
			this.conventions = await this.detectConventions();
		}

		// Build an enriched prompt with conventions context
		const enrichedTask = this.buildTaskPrompt(task);

		let validationRetries = 0;
		let validationPassed = false;
		let validationOutput: string | undefined;
		let lastResponse: AgentMessage | null = null;
		let success = false;

		try {
			// Initial execution
			lastResponse = await this.agent.prompt(enrichedTask);
			success = true;

			// Auto-validate loop
			if (this.config.autoValidate && this.hasValidationCommands()) {
				this.config.onEvent?.({ type: "validation_start" });
				const result = await this.validate();
				validationPassed = result.passed;
				validationOutput = result.output;
				this.config.onEvent?.({ type: "validation_result", passed: result.passed, output: result.output });

				while (!validationPassed && validationRetries < this.config.maxValidationRetries) {
					validationRetries++;
					this.config.onEvent?.({ type: "retry", attempt: validationRetries, maxRetries: this.config.maxValidationRetries });

					// Send validation errors back to the agent for fixing
					const fixPrompt = [
						"Validation failed. Fix these errors:\n",
						"```",
						result.output,
						"```",
						"\nFix the issues and ensure the code compiles and tests pass.",
					].join("\n");

					lastResponse = await this.agent.prompt(fixPrompt);

					const retryResult = await this.validate();
					validationPassed = retryResult.passed;
					validationOutput = retryResult.output;
					this.config.onEvent?.({ type: "validation_result", passed: retryResult.passed, output: retryResult.output });

					if (validationPassed) break;
				}
			} else {
				// No validation commands configured — skip validation
				validationPassed = true;
			}
		} catch (err) {
			success = false;
			validationOutput = err instanceof Error ? err.message : String(err);
		}

		const summary = this.extractSummary(lastResponse);

		return {
			success,
			filesModified: [...this.filesModified],
			filesCreated: [...this.filesCreated],
			validationPassed,
			validationOutput,
			summary,
			validationRetries,
		};
	}

	/**
	 * Run validation: build command then test command then lint command.
	 * Returns { passed: boolean, output: string }.
	 */
	async validate(): Promise<{ passed: boolean; output: string }> {
		const outputs: string[] = [];
		let allPassed = true;

		const commands = [
			{ label: "build", cmd: this.config.buildCommand ?? this.conventions?.buildCommand },
			{ label: "test", cmd: this.config.testCommand ?? this.conventions?.testCommand },
			{ label: "lint", cmd: this.config.lintCommand ?? this.conventions?.lintCommand },
		];

		for (const { label, cmd } of commands) {
			if (!cmd) continue;

			try {
				const result = safeExecSync(cmd, {
					cwd: this.config.workingDirectory,
					encoding: "utf-8",
					timeout: 120_000, // 2 minute timeout per command
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

	/** Auto-detect project conventions from the working directory. */
	async detectConventions(): Promise<ProjectConventions> {
		this.conventions = detectProjectConventions(
			this.config.workingDirectory,
			this.config.language,
			{
				testCommand: this.config.testCommand,
				buildCommand: this.config.buildCommand,
				lintCommand: this.config.lintCommand,
			},
		);
		return this.conventions;
	}

	/** Get the underlying agent instance. */
	getAgent(): Agent {
		return this.agent;
	}

	/** Get the list of files modified during execution. */
	getFilesModified(): string[] {
		return [...this.filesModified];
	}

	/** Get the list of files created during execution. */
	getFilesCreated(): string[] {
		return [...this.filesCreated];
	}

	/** Get the detected project conventions. */
	getConventions(): ProjectConventions | null {
		return this.conventions;
	}

	/** Forward agent events to the caller's onEvent callback. */
	private forwardEvent(event: string, data: unknown): void {
		const cb = this.config.onEvent;
		if (!cb) return;
		const d = data as Record<string, unknown>;
		switch (event) {
			case "stream:tool_call": {
				let args: Record<string, unknown> = {};
				try { args = JSON.parse((d.arguments as string) ?? "{}") as Record<string, unknown>; } catch { /* skip */ }
				cb({ type: "tool_call", name: (d.name as string) ?? "unknown", args });
				break;
			}
			case "tool:done":
				cb({ type: "tool_done", name: (d.name as string) ?? "unknown", durationMs: (d.durationMs as number) ?? 0 });
				break;
			case "stream:thinking": { const t = (d.text as string) ?? ""; if (t) cb({ type: "thinking", text: t }); break; }
			case "stream:text": { const t = (d.text as string) ?? ""; if (t) cb({ type: "text", text: t }); break; }
		}
	}

	/** Track file operations (write/edit) from agent events. */
	private trackFileOperations(event: string, data: unknown): void {
		if (event !== "stream:tool_call") return;
		const d = data as Record<string, unknown>;
		const toolName = d.name as string | undefined;
		if (!toolName || (toolName !== "write" && toolName !== "edit")) return;
		const argsStr = d.arguments as string | undefined;
		if (!argsStr) return;
		try {
			const args = JSON.parse(argsStr) as Record<string, unknown>;
			const rawPath = (args.path ?? args.file_path ?? args.file) as string | undefined;
			if (!rawPath) return;
			const filePath = pathResolve(rawPath);
			if (toolName === "write") {
				(existsSync(filePath) ? this.filesModified : this.filesCreated).add(filePath);
			} else {
				this.filesModified.add(filePath);
			}
		} catch { /* malformed arguments */ }
	}

	/** Build an enriched task prompt with conventions context. */
	private buildTaskPrompt(task: string): string {
		const parts: string[] = [task];
		if (this.conventions) {
			const c = this.conventions;
			const ctx: string[] = ["\n\n--- Project Context ---"];
			ctx.push(`Language: ${c.language}`, `Module system: ${c.moduleSystem}`);
			ctx.push(`Indentation: ${c.indentation}${c.indentation === "spaces" ? ` (width ${c.indentWidth})` : ""}`);
			if (c.hasTypeScript) ctx.push(`TypeScript: yes${c.tsStrictness ? ` (${c.tsStrictness})` : ""}${c.tsTarget ? `, target: ${c.tsTarget}` : ""}`);
			if (c.framework) ctx.push(`Framework: ${c.framework}`);
			if (c.isMonorepo) ctx.push(`Monorepo: yes (${c.packageManager ?? "unknown"})`);
			else if (c.packageManager) ctx.push(`Package manager: ${c.packageManager}`);
			if (c.testFramework) ctx.push(`Test framework: ${c.testFramework}`);
			if (c.testPattern) ctx.push(`Test location: ${c.testPattern}`);
			if (c.formatter) ctx.push(`Formatter: ${c.formatter}`);
			if (c.buildCommand) ctx.push(`Build: ${c.buildCommand}`);
			if (c.testCommand) ctx.push(`Test: ${c.testCommand}`);
			if (c.lintCommand) ctx.push(`Lint: ${c.lintCommand}`);
			ctx.push(`Working directory: ${this.config.workingDirectory}`);
			parts.push(ctx.join("\n"));
		}
		if (this.config.additionalContext) {
			parts.push(`\n\n--- Additional Context ---\n${this.config.additionalContext}`);
		}
		return parts.join("");
	}

	/** Check whether any validation commands are configured. */
	private hasValidationCommands(): boolean {
		return !!(this.config.buildCommand ?? this.config.testCommand ?? this.config.lintCommand ??
			this.conventions?.buildCommand ?? this.conventions?.testCommand ?? this.conventions?.lintCommand);
	}

	/** Extract a summary string from the last agent response. */
	private extractSummary(message: AgentMessage | null): string {
		if (!message) return "No response from agent.";
		const fullText = message.content
			.filter((p) => p.type === "text")
			.map((p) => (p as { type: "text"; text: string }).text)
			.join("\n");
		return fullText.length <= 500 ? fullText : fullText.slice(0, 497) + "...";
	}
}
