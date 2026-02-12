/**
 * @chitragupta/anina — Kartru (कर्तृ) — Coding Agent.
 *
 * A preconfigured agent specialized for code tasks:
 * - Auto-selects code-relevant tools (read, write, edit, bash, grep, find, ls, diff)
 * - Code-focused system prompt with conventions awareness
 * - Self-validation loop: after edits, checks compilation and tests
 * - Can be spawned as a sub-agent or used standalone
 *
 * In Vedic grammar, kartru is the agent of action — the one who DOES.
 * A coding agent is the doer — it reads, writes, edits, tests, and ships code.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { KARTRU_PROFILE } from "@chitragupta/core";

import { Agent } from "./agent.js";
import { safeExecSync } from "./safe-exec.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Tool names relevant for coding tasks.
 * Use this to filter a full tool set down to what a coding agent needs.
 *
 * @example
 * ```ts
 * import { getAllTools } from "@chitragupta/yantra";
 * const codeTools = getAllTools().filter(t => CODE_TOOL_NAMES.has(t.definition.name));
 * ```
 */
export const CODE_TOOL_NAMES = new Set([
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

/** Configuration for creating a coding agent. */
export interface CodingAgentConfig {
	/** Provider ID to use. Default: "anthropic". */
	providerId?: string;
	/** Model ID. Default: "claude-sonnet-4-5-20250929". */
	modelId?: string;
	/** Working directory for the project. */
	workingDirectory: string;
	/** Language/framework hints for conventions. */
	language?: string;
	/** Test command to run after edits. */
	testCommand?: string;
	/** Build/compile command. */
	buildCommand?: string;
	/** Lint command. */
	lintCommand?: string;
	/** Whether to auto-validate after edits. Default: true. */
	autoValidate?: boolean;
	/** Maximum validation retries. Default: 3. */
	maxValidationRetries?: number;
	/** Parent agent (if spawning as sub-agent). */
	parentAgent?: Agent;
	/** Additional system prompt context. */
	additionalContext?: string;
	/**
	 * CommHub for IPC. Uses the same inline shape as AgentConfig.commHub.
	 */
	commHub?: AgentConfig["commHub"];
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
	/**
	 * Tool handlers to use. If not provided, the agent has no tools.
	 * Use CODE_TOOL_NAMES to filter a full tool set to coding-relevant tools.
	 */
	tools?: ToolHandler[];
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
			onEvent: (event, data) => this.trackFileOperations(event, data),
			policyEngine: config.policyEngine,
			commHub: config.commHub,
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
				const result = await this.validate();
				validationPassed = result.passed;
				validationOutput = result.output;

				while (!validationPassed && validationRetries < this.config.maxValidationRetries) {
					validationRetries++;

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

	/**
	 * Auto-detect project conventions from the working directory.
	 * Checks: package.json scripts, tsconfig.json, .eslintrc, biome.json, etc.
	 */
	async detectConventions(): Promise<ProjectConventions> {
		const dir = this.config.workingDirectory;
		const conventions: ProjectConventions = {
			language: this.config.language ?? "unknown",
			indentation: "tabs",
			indentWidth: 2,
			moduleSystem: "unknown",
			hasTypeScript: false,
		};

		// ─── Package manager detection ──────────────────────────────────
		if (existsSync(join(dir, "pnpm-lock.yaml")) || existsSync(join(dir, "pnpm-workspace.yaml")))
			conventions.packageManager = "pnpm";
		else if (existsSync(join(dir, "yarn.lock")))
			conventions.packageManager = "yarn";
		else if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock")))
			conventions.packageManager = "bun";
		else if (existsSync(join(dir, "package-lock.json")))
			conventions.packageManager = "npm";

		const runPrefix = conventions.packageManager === "pnpm" ? "pnpm" :
			conventions.packageManager === "yarn" ? "yarn" :
			conventions.packageManager === "bun" ? "bun" : "npm";

		// ─── Monorepo detection ─────────────────────────────────────────
		if (
			existsSync(join(dir, "pnpm-workspace.yaml")) ||
			existsSync(join(dir, "lerna.json")) ||
			existsSync(join(dir, "nx.json"))
		) {
			conventions.isMonorepo = true;
		}

		// ─── package.json detection ──────────────────────────────────────
		const pkgPath = join(dir, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;

				if (conventions.language === "unknown") {
					conventions.language = "javascript";
				}

				// Module system
				const typeField = pkg.type as string | undefined;
				conventions.moduleSystem = typeField === "module" ? "esm" : typeField === "commonjs" ? "commonjs" : "unknown";

				// Yarn workspaces monorepo
				if (pkg.workspaces && !conventions.isMonorepo) {
					conventions.isMonorepo = true;
				}

				// Scripts
				const scripts = pkg.scripts as Record<string, string> | undefined;
				if (scripts) {
					if (scripts.test && scripts.test !== "echo \"Error: no test specified\" && exit 1") {
						conventions.testCommand = `${runPrefix} test`;
					}
					if (scripts.build) {
						conventions.buildCommand = `${runPrefix} run build`;
					}
					if (scripts.lint) {
						conventions.lintCommand = `${runPrefix} run lint`;
					}
				}

				// Framework detection (expanded)
				const deps = { ...(pkg.dependencies as Record<string, string> ?? {}), ...(pkg.devDependencies as Record<string, string> ?? {}) };
				if (deps.next) conventions.framework = "next.js";
				else if (deps.nuxt) conventions.framework = "nuxt";
				else if (deps.remix || deps["@remix-run/node"]) conventions.framework = "remix";
				else if (deps.astro) conventions.framework = "astro";
				else if (deps["@angular/core"]) conventions.framework = "angular";
				else if (deps.react) conventions.framework = "react";
				else if (deps.vue) conventions.framework = "vue";
				else if (deps.svelte) conventions.framework = "svelte";
				else if (deps["@nestjs/core"]) conventions.framework = "nest.js";
				else if (deps.hono) conventions.framework = "hono";
				else if (deps.express) conventions.framework = "express";
				else if (deps.fastify) conventions.framework = "fastify";
				else if (deps.koa) conventions.framework = "koa";
				else if (deps.elysia) conventions.framework = "elysia";

				// Test framework detection
				if (deps.vitest) conventions.testFramework = "vitest";
				else if (deps.jest || deps["@jest/core"]) conventions.testFramework = "jest";
				else if (deps.mocha) conventions.testFramework = "mocha";
				else if (deps.ava) conventions.testFramework = "ava";
				else if (deps.tap || deps["@tapjs/core"]) conventions.testFramework = "tap";

				// Formatter detection
				if (deps.prettier) conventions.formatter = "prettier";
				else if (deps["@biomejs/biome"]) conventions.formatter = "biome";
			} catch {
				// Malformed package.json — continue with defaults
			}
		}

		// ─── TypeScript detection + tsconfig parsing ────────────────────
		const tsconfigPath = join(dir, "tsconfig.json");
		if (existsSync(tsconfigPath)) {
			conventions.hasTypeScript = true;
			if (conventions.language === "javascript" || conventions.language === "unknown") {
				conventions.language = "typescript";
			}

			try {
				// Strip comments from tsconfig (JSON with comments)
				const raw = readFileSync(tsconfigPath, "utf-8")
					.replace(/\/\/.*$/gm, "")
					.replace(/\/\*[\s\S]*?\*\//g, "")
					.replace(/,(\s*[}\]])/g, "$1"); // trailing commas
				const tsconfig = JSON.parse(raw) as Record<string, unknown>;
				const compilerOptions = tsconfig.compilerOptions as Record<string, unknown> | undefined;
				if (compilerOptions) {
					// Strictness detection
					if (compilerOptions.strict === true) {
						conventions.tsStrictness = "strict";
					} else if (compilerOptions.noImplicitAny === true || compilerOptions.strictNullChecks === true) {
						conventions.tsStrictness = "moderate";
					} else {
						conventions.tsStrictness = "loose";
					}
					// Target
					if (typeof compilerOptions.target === "string") {
						conventions.tsTarget = compilerOptions.target;
					}
				}
			} catch {
				// tsconfig parse error — continue with defaults
			}
		}

		// ─── Indentation detection (sample a source file) ────────────────
		const sampleFile = this.findSampleSourceFile(dir, conventions.hasTypeScript);
		if (sampleFile) {
			try {
				const content = readFileSync(sampleFile, "utf-8");
				const lines = content.split("\n").filter((l) => l.length > 0 && l !== l.trimStart());

				if (lines.length > 0) {
					const tabLines = lines.filter((l) => l.startsWith("\t")).length;
					const spaceLines = lines.length - tabLines;

					if (tabLines > spaceLines) {
						conventions.indentation = "tabs";
						conventions.indentWidth = 2; // Tab width is editor-dependent, default 2
					} else {
						conventions.indentation = "spaces";
						// Detect most common space indent width
						const widths = lines
							.filter((l) => l.startsWith(" "))
							.map((l) => {
								const match = l.match(/^( +)/);
								return match ? match[1].length : 0;
							})
							.filter((w) => w > 0);

						if (widths.length > 0) {
							// Find the GCD of the first few indent widths as the base
							const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
							const detected = widths.slice(0, 20).reduce(gcd);
							conventions.indentWidth = detected > 0 && detected <= 8 ? detected : 2;
						}
					}
				}
			} catch {
				// Can't read file — keep defaults
			}
		}

		// ─── Linter detection ────────────────────────────────────────────
		if (existsSync(join(dir, "biome.json")) || existsSync(join(dir, "biome.jsonc"))) {
			if (!conventions.lintCommand) conventions.lintCommand = `${runPrefix === "npm" ? "npx" : runPrefix} biome check .`;
		} else if (
			existsSync(join(dir, ".eslintrc")) ||
			existsSync(join(dir, ".eslintrc.js")) ||
			existsSync(join(dir, ".eslintrc.json")) ||
			existsSync(join(dir, ".eslintrc.yml")) ||
			existsSync(join(dir, "eslint.config.js")) ||
			existsSync(join(dir, "eslint.config.mjs")) ||
			existsSync(join(dir, "eslint.config.ts"))
		) {
			if (!conventions.lintCommand) conventions.lintCommand = `${runPrefix === "npm" ? "npx" : runPrefix} eslint .`;
		}

		// ─── Formatter detection (file-based) ───────────────────────────
		if (!conventions.formatter) {
			if (existsSync(join(dir, ".prettierrc")) || existsSync(join(dir, ".prettierrc.json")) ||
				existsSync(join(dir, ".prettierrc.js")) || existsSync(join(dir, "prettier.config.js"))) {
				conventions.formatter = "prettier";
			}
		}

		// ─── Test pattern detection ─────────────────────────────────────
		if (existsSync(join(dir, "__tests__"))) {
			conventions.testPattern = "__tests__";
		} else if (existsSync(join(dir, "test"))) {
			conventions.testPattern = "test";
		} else if (existsSync(join(dir, "tests"))) {
			conventions.testPattern = "tests";
		} else if (existsSync(join(dir, "src", "__tests__"))) {
			conventions.testPattern = "src/__tests__";
		} else {
			// Infer from test framework config
			if (conventions.testFramework === "vitest" || conventions.testFramework === "jest") {
				conventions.testPattern = "**/*.test.{ts,tsx,js,jsx}";
			}
		}

		// Apply config overrides
		if (this.config.testCommand) conventions.testCommand = this.config.testCommand;
		if (this.config.buildCommand) conventions.buildCommand = this.config.buildCommand;
		if (this.config.lintCommand) conventions.lintCommand = this.config.lintCommand;

		this.conventions = conventions;
		return conventions;
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

	// ─── Private Helpers ─────────────────────────────────────────────────────

	/**
	 * Track file operations from agent events.
	 * Monitors tool:done events for write/edit tool calls.
	 */
	private trackFileOperations(event: string, data: unknown): void {
		if (event !== "tool:done" && event !== "stream:tool_call") return;

		const eventData = data as Record<string, unknown>;
		const toolName = eventData.name as string | undefined;
		if (!toolName) return;

		if (event === "stream:tool_call") {
			// Parse the arguments from the tool call to extract file paths
			const argsStr = eventData.arguments as string | undefined;
			if (!argsStr) return;

			try {
				const args = JSON.parse(argsStr) as Record<string, unknown>;
				const filePath = (args.path ?? args.file_path ?? args.file) as string | undefined;
				if (!filePath) return;

				if (toolName === "write") {
					// Check if the file exists to determine create vs modify
					if (existsSync(filePath)) {
						this.filesModified.add(filePath);
					} else {
						this.filesCreated.add(filePath);
					}
				} else if (toolName === "edit") {
					this.filesModified.add(filePath);
				}
			} catch {
				// Malformed arguments — skip tracking
			}
		}
	}

	/**
	 * Build an enriched task prompt that includes conventions context.
	 */
	private buildTaskPrompt(task: string): string {
		const parts: string[] = [];

		parts.push(task);

		if (this.conventions) {
			const ctx: string[] = ["\n\n--- Project Context ---"];

			ctx.push(`Language: ${this.conventions.language}`);
			ctx.push(`Module system: ${this.conventions.moduleSystem}`);
			ctx.push(`Indentation: ${this.conventions.indentation}${this.conventions.indentation === "spaces" ? ` (width ${this.conventions.indentWidth})` : ""}`);

			if (this.conventions.hasTypeScript) {
				ctx.push(`TypeScript: yes${this.conventions.tsStrictness ? ` (${this.conventions.tsStrictness})` : ""}${this.conventions.tsTarget ? `, target: ${this.conventions.tsTarget}` : ""}`);
			}
			if (this.conventions.framework) ctx.push(`Framework: ${this.conventions.framework}`);
			if (this.conventions.isMonorepo) ctx.push(`Monorepo: yes (${this.conventions.packageManager ?? "unknown"})`);
			else if (this.conventions.packageManager) ctx.push(`Package manager: ${this.conventions.packageManager}`);
			if (this.conventions.testFramework) ctx.push(`Test framework: ${this.conventions.testFramework}`);
			if (this.conventions.testPattern) ctx.push(`Test location: ${this.conventions.testPattern}`);
			if (this.conventions.formatter) ctx.push(`Formatter: ${this.conventions.formatter}`);
			if (this.conventions.buildCommand) ctx.push(`Build: ${this.conventions.buildCommand}`);
			if (this.conventions.testCommand) ctx.push(`Test: ${this.conventions.testCommand}`);
			if (this.conventions.lintCommand) ctx.push(`Lint: ${this.conventions.lintCommand}`);

			ctx.push(`Working directory: ${this.config.workingDirectory}`);

			parts.push(ctx.join("\n"));
		}

		if (this.config.additionalContext) {
			parts.push(`\n\n--- Additional Context ---\n${this.config.additionalContext}`);
		}

		return parts.join("");
	}

	/**
	 * Check whether any validation commands are configured.
	 */
	private hasValidationCommands(): boolean {
		return !!(
			this.config.buildCommand ??
			this.config.testCommand ??
			this.config.lintCommand ??
			this.conventions?.buildCommand ??
			this.conventions?.testCommand ??
			this.conventions?.lintCommand
		);
	}

	/**
	 * Extract a summary string from the last agent response.
	 */
	private extractSummary(message: AgentMessage | null): string {
		if (!message) return "No response from agent.";

		const textParts = message.content
			.filter((p) => p.type === "text")
			.map((p) => (p as { type: "text"; text: string }).text);

		const fullText = textParts.join("\n");

		// Take the first ~500 chars as a summary
		if (fullText.length <= 500) return fullText;
		return fullText.slice(0, 497) + "...";
	}

	/**
	 * Find a sample source file in the working directory to detect indentation.
	 */
	private findSampleSourceFile(dir: string, isTypeScript: boolean): string | null {
		// Try common source directories
		const extensions = isTypeScript ? [".ts", ".tsx"] : [".js", ".jsx", ".ts", ".tsx"];
		const searchDirs = ["src", "lib", "app", "."];

		for (const subDir of searchDirs) {
			const searchPath = join(dir, subDir);
			if (!existsSync(searchPath)) continue;

			for (const ext of extensions) {
				// Try index file first, then scan for any matching file
				const indexFile = join(searchPath, `index${ext}`);
				if (existsSync(indexFile)) return indexFile;
			}
		}

		return null;
	}
}
