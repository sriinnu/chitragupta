/**
 * @chitragupta/anina — Shodhaka (शोधक) — Research Agent.
 *
 * Searches codebases, reads documentation, and provides structured
 * answers about architecture, patterns, and implementation details.
 * Read-only — never modifies files.
 */

import { SHODHAKA_PROFILE } from "@chitragupta/core";

import { Agent } from "./agent.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Tool names allowed for research tasks.
 * Researchers read and search — they NEVER write or edit.
 *
 * @example
 * ```ts
 * import { getAllTools } from "@chitragupta/yantra";
 * const researchTools = getAllTools().filter(t => RESEARCH_TOOL_NAMES.has(t.definition.name));
 * ```
 */
export const RESEARCH_TOOL_NAMES = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"bash",
]);

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for creating a research agent. */
export interface ResearchAgentConfig {
	workingDirectory: string;
	/** Provider ID to use. Default: "anthropic". */
	providerId?: string;
	/** Model ID. Default from profile. */
	modelId?: string;
	/** Parent agent (if spawning as sub-agent). */
	parentAgent?: Agent;
	/**
	 * Tool handlers to use. If not provided, the agent has no tools.
	 * Use RESEARCH_TOOL_NAMES to filter a full tool set to research-relevant tools.
	 */
	tools?: ToolHandler[];
	/** CommHub for IPC. */
	commHub?: AgentConfig["commHub"];
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
}

/** A structured research query. */
export interface ResearchQuery {
	/** The question to answer. */
	question: string;
	/** Scope of the research. */
	scope?: "file" | "directory" | "project" | "architecture";
	/** Relevant files to include in the investigation. */
	relevantFiles?: string[];
}

/** Result of a research investigation. */
export interface ResearchResult {
	/** The answer to the research question. */
	answer: string;
	/** Files that were examined during research. */
	filesExamined: string[];
	/** Code references supporting the answer. */
	codeReferences: Array<{ file: string; line?: number; snippet: string }>;
	/** Confidence in the answer [0, 1]. */
	confidence: number;
	/** Related topics discovered during research. */
	relatedTopics: string[];
}

// ─── ResearchAgent ───────────────────────────────────────────────────────────

/**
 * Shodhaka -- a read-only research agent that searches codebases,
 * reads documentation, and provides structured answers with
 * file references and confidence scores.
 *
 * @example
 * ```ts
 * import { ResearchAgent } from "@chitragupta/anina";
 * import { getAllTools } from "@chitragupta/yantra";
 *
 * const researcher = new ResearchAgent({
 *   workingDirectory: "/path/to/project",
 *   tools: getAllTools(),
 * });
 * const result = await researcher.research({
 *   question: "How does the authentication flow work?",
 *   scope: "architecture",
 * });
 * console.log(result.answer, result.confidence);
 * ```
 */
export class ResearchAgent {
	private agent: Agent;
	private config: ResearchAgentConfig;

	constructor(config: ResearchAgentConfig) {
		this.config = config;

		// Filter tools to research-only subset (NO write/edit — researchers don't modify code)
		const tools = config.tools
			? config.tools.filter((t) => RESEARCH_TOOL_NAMES.has(t.definition.name))
			: [];

		const agentConfig: AgentConfig = {
			profile: SHODHAKA_PROFILE,
			providerId: config.providerId ?? "anthropic",
			model: config.modelId ?? SHODHAKA_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools,
			thinkingLevel: SHODHAKA_PROFILE.preferredThinking ?? "high",
			workingDirectory: config.workingDirectory,
			policyEngine: config.policyEngine,
			commHub: config.commHub,
		};

		this.agent = new Agent(agentConfig);
	}

	/**
	 * Research a question about the codebase.
	 *
	 * The agent will read files, search for patterns, and construct
	 * a structured answer with file references and confidence level.
	 */
	async research(query: ResearchQuery): Promise<ResearchResult> {
		const prompt = this.buildResearchPrompt(query);
		const response = await this.agent.prompt(prompt);
		return this.parseResearchResponse(response);
	}

	/**
	 * Explain a specific file: its purpose, patterns, and connections.
	 */
	async explainFile(filePath: string): Promise<ResearchResult> {
		const prompt = [
			`Read and explain the file: ${filePath}`,
			"",
			"Provide:",
			"1. The file's purpose and responsibility",
			"2. Key patterns and abstractions used",
			"3. How it connects to other parts of the codebase (imports, exports, callers)",
			"4. Any notable design decisions or trade-offs",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseResearchResponse(response);
	}

	/**
	 * Find and explain a pattern across the codebase.
	 */
	async findPattern(pattern: string): Promise<ResearchResult> {
		const prompt = [
			`Search the codebase for the pattern: "${pattern}"`,
			"",
			"1. Use grep/find to locate all occurrences",
			"2. Read the most relevant files to understand usage context",
			"3. Explain how the pattern is used and why",
			"4. Note any inconsistencies or variations in usage",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseResearchResponse(response);
	}

	/**
	 * Produce an architectural overview of the project or directory.
	 */
	async architectureOverview(): Promise<ResearchResult> {
		const prompt = [
			"Produce an architectural overview of this project.",
			"",
			"1. Read package.json, index files, config files, and directory structure",
			"2. Identify the major modules, their responsibilities, and dependencies",
			"3. Describe the data flow and key abstractions",
			"4. Note the patterns used (plugin system, event bus, factory, etc.)",
			"5. Identify entry points and public API surface",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseResearchResponse(response);
	}

	/** Get the underlying agent instance. */
	getAgent(): Agent {
		return this.agent;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────────

	/**
	 * Build the research prompt from a query.
	 */
	private buildResearchPrompt(query: ResearchQuery): string {
		const parts: string[] = [];

		parts.push(`Research question: ${query.question}`);

		if (query.scope) {
			parts.push(`Scope: ${query.scope}`);
		}

		if (query.relevantFiles && query.relevantFiles.length > 0) {
			parts.push("");
			parts.push("Start by reading these relevant files:");
			for (const f of query.relevantFiles) {
				parts.push(`- ${f}`);
			}
		}

		parts.push("");
		parts.push("Search thoroughly. Read files, grep for patterns, examine directory structure.");
		parts.push("Cite specific file:line references for every claim you make.");
		parts.push("");
		parts.push(this.buildOutputInstructions());

		return parts.join("\n");
	}

	/**
	 * Build the output format instructions.
	 */
	private buildOutputInstructions(): string {
		return [
			"Format your response to include these clearly labeled sections:",
			"",
			"ANSWER: <your structured answer to the question>",
			"CONFIDENCE: <number 0.0 to 1.0>",
			"FILES EXAMINED: <comma-separated list of files you read>",
			"CODE REFERENCES: <one per line, format: file:line snippet>",
			"RELATED TOPICS: <comma-separated list of related areas to explore>",
		].join("\n");
	}

	/**
	 * Parse the agent's response into a structured ResearchResult.
	 */
	private parseResearchResponse(message: AgentMessage): ResearchResult {
		const text = this.extractText(message);

		const answer = this.parseField(text, "ANSWER") ?? text.slice(0, 500);
		const confidenceStr = this.parseField(text, "CONFIDENCE") ?? "0.7";
		const filesStr = this.parseField(text, "FILES EXAMINED") ?? "";
		const relatedStr = this.parseField(text, "RELATED TOPICS") ?? "";

		// Parse confidence
		const confidence = Math.max(0, Math.min(1, parseFloat(confidenceStr) || 0.7));

		// Parse files examined
		const filesExamined = filesStr
			.split(/[,\n]/)
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		// Parse code references
		const codeReferences = this.parseCodeReferences(text);

		// Parse related topics
		const relatedTopics = relatedStr
			.split(/[,\n]/)
			.map((t) => t.trim())
			.filter((t) => t.length > 0);

		return {
			answer,
			filesExamined,
			codeReferences,
			confidence,
			relatedTopics,
		};
	}

	/**
	 * Parse code references from the response text.
	 * Matches patterns like: "file.ts:42 some code snippet"
	 */
	private parseCodeReferences(text: string): Array<{ file: string; line?: number; snippet: string }> {
		const refs: Array<{ file: string; line?: number; snippet: string }> = [];

		// Find the CODE REFERENCES section
		const sectionMatch = text.match(/CODE REFERENCES:\s*\n?([\s\S]*?)(?=\n[A-Z][\w\s]*:|$)/i);
		if (!sectionMatch) return refs;

		const section = sectionMatch[1];
		const lines = section.split("\n").filter((l) => l.trim().length > 0);

		for (const line of lines) {
			const refMatch = line.trim().match(/^-?\s*(.+?):(\d+)\s+(.+)/);
			if (refMatch) {
				refs.push({
					file: refMatch[1].trim(),
					line: parseInt(refMatch[2], 10),
					snippet: refMatch[3].trim(),
				});
			} else {
				// Try without line number: "file.ts: some description"
				const noLineMatch = line.trim().match(/^-?\s*(.+?):\s+(.+)/);
				if (noLineMatch) {
					refs.push({
						file: noLineMatch[1].trim(),
						snippet: noLineMatch[2].trim(),
					});
				}
			}
		}

		return refs;
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
