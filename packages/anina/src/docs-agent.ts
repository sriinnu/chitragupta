/**
 * @chitragupta/anina — Lekhaka (लेखक) — Documentation Agent.
 *
 * Writes and updates documentation: READMEs, JSDoc comments,
 * API docs, changelogs, and architecture documents.
 */

import { LEKHAKA_PROFILE } from "@chitragupta/core";

import { Agent } from "./agent.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Tool names required for documentation tasks.
 * Documentation agents need to read AND write (to create/update docs).
 *
 * @example
 * ```ts
 * import { getAllTools } from "@chitragupta/yantra";
 * const docsTools = getAllTools().filter(t => DOCS_TOOL_NAMES.has(t.definition.name));
 * ```
 */
export const DOCS_TOOL_NAMES = new Set([
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
]);

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for creating a documentation agent. */
export interface DocsAgentConfig {
	workingDirectory: string;
	/** Documentation style. Default: "technical". */
	style?: "technical" | "tutorial" | "api-reference" | "casual";
	/** Provider and model overrides. */
	providerId?: string;
	modelId?: string;
	/** Parent agent for sub-agent spawning. */
	parentAgent?: Agent;
	/**
	 * Tool handlers to use. If not provided, the agent has no tools.
	 * Use DOCS_TOOL_NAMES to filter a full tool set to docs-relevant tools.
	 */
	tools?: ToolHandler[];
	/** CommHub for IPC. */
	commHub?: AgentConfig["commHub"];
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
}

/** The type of documentation task. */
export type DocsTask = "readme" | "jsdoc" | "changelog" | "api-docs" | "architecture" | "custom";

/** Result of a documentation task. */
export interface DocsResult {
	/** Files that were modified. */
	filesModified: string[];
	/** Files that were created. */
	filesCreated: string[];
	/** Summary of what was documented. */
	summary: string;
	/** Approximate word count of generated documentation. */
	wordCount: number;
}

// ─── DocsAgent ───────────────────────────────────────────────────────────────

/**
 * Lekhaka -- a documentation agent that writes and updates READMEs,
 * JSDoc comments, API docs, changelogs, and architecture documents.
 *
 * @example
 * ```ts
 * import { DocsAgent } from "@chitragupta/anina";
 * import { getAllTools } from "@chitragupta/yantra";
 *
 * const docs = new DocsAgent({
 *   workingDirectory: "/path/to/project",
 *   tools: getAllTools(),
 *   style: "technical",
 * });
 * const result = await docs.readme("/path/to/package");
 * console.log(result.summary, result.wordCount);
 * ```
 */
export class DocsAgent {
	private agent: Agent;
	private config: DocsAgentConfig & {
		style: "technical" | "tutorial" | "api-reference" | "casual";
	};

	constructor(config: DocsAgentConfig) {
		this.config = {
			...config,
			style: config.style ?? "technical",
		};

		// Documentation agents need read AND write/edit to create/update docs
		const tools = config.tools
			? config.tools.filter((t) => DOCS_TOOL_NAMES.has(t.definition.name))
			: [];

		const agentConfig: AgentConfig = {
			profile: LEKHAKA_PROFILE,
			providerId: config.providerId ?? "anthropic",
			model: config.modelId ?? LEKHAKA_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools,
			thinkingLevel: LEKHAKA_PROFILE.preferredThinking ?? "medium",
			workingDirectory: config.workingDirectory,
			policyEngine: config.policyEngine,
			commHub: config.commHub,
		};

		this.agent = new Agent(agentConfig);
	}

	/**
	 * Generate or update a README for a directory/package.
	 *
	 * Reads package.json, index files, and existing README (if any),
	 * then generates or updates a comprehensive README.md.
	 */
	async readme(targetPath: string): Promise<DocsResult> {
		const prompt = [
			`Generate or update a README.md for: ${targetPath}`,
			"",
			`Documentation style: ${this.config.style}`,
			"",
			"Steps:",
			"1. Read package.json (if it exists) for name, description, dependencies, scripts",
			"2. Read index files and key source files to understand the API surface",
			"3. Read the existing README.md (if any) to preserve useful content",
			"4. Write a comprehensive README.md with:",
			"   - Title and description",
			"   - Installation instructions",
			"   - Usage examples with code snippets",
			"   - API overview",
			"   - Configuration options",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseDocsResponse(response);
	}

	/**
	 * Add JSDoc comments to a file's exported functions/classes.
	 *
	 * Reads the file, identifies exported symbols without JSDoc,
	 * and adds clear, concise documentation comments.
	 */
	async jsdoc(filePath: string): Promise<DocsResult> {
		const prompt = [
			`Add JSDoc comments to exported functions and classes in: ${filePath}`,
			"",
			`Documentation style: ${this.config.style}`,
			"",
			"Steps:",
			"1. Read the file",
			"2. Identify all exported functions, classes, interfaces, and types",
			"3. For each export that lacks JSDoc, add a clear comment with:",
			"   - A one-line description",
			"   - @param tags for parameters",
			"   - @returns tag for return values",
			"   - @example if the usage is non-obvious",
			"4. Do NOT modify existing JSDoc comments unless they are incorrect",
			"5. Do NOT change any code — only add/update comments",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseDocsResponse(response);
	}

	/**
	 * Generate a changelog from git history.
	 *
	 * Runs `git log` since the given ref, categorizes commits,
	 * and generates a structured CHANGELOG.md.
	 */
	async changelog(sinceRef?: string): Promise<DocsResult> {
		const ref = sinceRef ?? "HEAD~20";
		const prompt = [
			`Generate a CHANGELOG.md from git history since: ${ref}`,
			"",
			`Documentation style: ${this.config.style}`,
			"",
			"Steps:",
			`1. Run: git log --oneline ${ref}..HEAD`,
			"2. Categorize commits into: Added, Changed, Fixed, Removed, Security",
			"3. Read the existing CHANGELOG.md (if any) to preserve older entries",
			"4. Write a structured CHANGELOG.md following Keep a Changelog format",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseDocsResponse(response);
	}

	/**
	 * Document the architecture of a directory.
	 *
	 * Reads directory structure, key files, and generates
	 * an ARCHITECTURE.md explaining the design.
	 */
	async architecture(targetPath: string): Promise<DocsResult> {
		const prompt = [
			`Document the architecture of: ${targetPath}`,
			"",
			`Documentation style: ${this.config.style}`,
			"",
			"Steps:",
			"1. List the directory structure (ls, find)",
			"2. Read key files: package.json, index files, config files",
			"3. Identify the major components and their relationships",
			"4. Write an ARCHITECTURE.md with:",
			"   - High-level overview diagram (ASCII or description)",
			"   - Component descriptions",
			"   - Data flow and key interactions",
			"   - Design decisions and trade-offs",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseDocsResponse(response);
	}

	/**
	 * Execute a custom documentation task.
	 */
	async write(task: string): Promise<DocsResult> {
		const prompt = [
			task,
			"",
			`Documentation style: ${this.config.style}`,
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseDocsResponse(response);
	}

	/** Get the underlying agent instance. */
	getAgent(): Agent {
		return this.agent;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────────

	/**
	 * Build output format instructions for the docs prompt.
	 */
	private buildOutputInstructions(): string {
		return [
			"After completing the documentation task, provide this summary:",
			"",
			"FILES MODIFIED: <comma-separated list of files you edited>",
			"FILES CREATED: <comma-separated list of new files you created>",
			"SUMMARY: <1-3 sentence description of what you documented>",
			"WORD COUNT: <approximate word count of documentation written>",
		].join("\n");
	}

	/**
	 * Parse the agent's response into a structured DocsResult.
	 */
	private parseDocsResponse(message: AgentMessage): DocsResult {
		const text = this.extractText(message);

		const filesModifiedStr = this.parseField(text, "FILES MODIFIED") ?? "";
		const filesCreatedStr = this.parseField(text, "FILES CREATED") ?? "";
		const summary = this.parseField(text, "SUMMARY") ?? "Documentation completed.";
		const wordCountStr = this.parseField(text, "WORD COUNT") ?? "0";

		const filesModified = filesModifiedStr
			.split(/[,\n]/)
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		const filesCreated = filesCreatedStr
			.split(/[,\n]/)
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		const wordCount = parseInt(wordCountStr, 10) || 0;

		return {
			filesModified,
			filesCreated,
			summary,
			wordCount,
		};
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
