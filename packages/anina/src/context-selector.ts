/**
 * @chitragupta/anina -- Context Selector for Conditional Context Loading.
 *
 * Parses markdown-formatted context files (CLAUDE.md, CHITRAGUPTA.md, etc.)
 * into tagged sections, then selects only the sections relevant to the
 * current task type and within the token budget.
 *
 * This addresses ArXiv 2602.11988: full context dumps reduce LLM success
 * rates and waste tokens. Selective loading improves both quality and cost.
 *
 * @packageDocumentation
 */

import type { TaskType } from "./task-classifier.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A parsed section from a context/instruction file.
 * Each section corresponds to a markdown heading (## level) and its content.
 */
export interface ContextSection {
	/** Unique identifier derived from the heading (e.g., "git-rules", "code-standards"). */
	id: string;
	/** The original heading text. */
	heading: string;
	/** The full text content of this section (heading + body). */
	content: string;
	/** Which task types this section is relevant for. */
	relevantFor: TaskType[];
	/** Priority: 0 = always include, 1 = high, 2 = medium, 3 = low. */
	priority: number;
	/** Estimated token count (chars / 4, a standard rough approximation). */
	tokenEstimate: number;
}

/** Configuration for context selection. */
export interface ContextSelectionConfig {
	/** Maximum token budget for selected context. Default: 4000. */
	tokenBudget?: number;
	/** If true, always include priority-0 sections regardless of task type. Default: true. */
	alwaysIncludeCritical?: boolean;
}

// ── Heading-to-TaskType Mapping ──────────────────────────────────────────────

/**
 * Maps heading keywords to the task types they are relevant for.
 * Used to auto-tag sections based on their heading text.
 */
interface HeadingRule {
	/** Keywords to match in the heading (case-insensitive). */
	keywords: readonly string[];
	/** Task types this heading is relevant for. */
	relevantFor: TaskType[];
	/** Priority level for this heading category. */
	priority: number;
}

/**
 * Rules for mapping markdown headings to task relevance.
 * Order matters: first matching rule wins.
 */
const HEADING_RULES: readonly HeadingRule[] = [
	// ── Priority 0 (always included) ────────────────────────────────
	{
		keywords: ["identity", "core", "non-negotiable", "critical", "doctrine"],
		relevantFor: ["code-write", "code-fix", "code-refactor", "code-review", "test", "config", "research", "git", "memory", "general"],
		priority: 0,
	},

	// ── Git-specific ────────────────────────────────────────────────
	{
		keywords: ["git", "commit", "push", "branch", "worktree", "pr", "pull request"],
		relevantFor: ["git", "code-write"],
		priority: 1,
	},

	// ── Testing ─────────────────────────────────────────────────────
	{
		keywords: ["test", "testing", "verification", "vitest", "jest"],
		relevantFor: ["test", "code-fix", "code-write"],
		priority: 1,
	},

	// ── Code standards ──────────────────────────────────────────────
	{
		keywords: ["code standard", "language", "typescript", "convention", "style", "lint", "format"],
		relevantFor: ["code-write", "code-refactor", "code-review", "test"],
		priority: 1,
	},

	// ── Architecture ────────────────────────────────────────────────
	{
		keywords: ["architecture", "design", "routing", "orchestration", "wiring"],
		relevantFor: ["code-write", "code-refactor", "research", "code-review"],
		priority: 2,
	},

	// ── Memory and continuity ───────────────────────────────────────
	{
		keywords: ["memory", "continuity", "session", "context", "recall", "handover"],
		relevantFor: ["memory", "research"],
		priority: 2,
	},

	// ── Safety and quality ──────────────────────────────────────────
	{
		keywords: ["safety", "quality", "security", "audit", "guard"],
		relevantFor: ["code-review", "code-write", "code-fix", "config"],
		priority: 2,
	},

	// ── Configuration and setup ─────────────────────────────────────
	{
		keywords: ["config", "setup", "install", "deploy", "environment", "infra", "publish", "package"],
		relevantFor: ["config", "code-write"],
		priority: 2,
	},

	// ── Communication and dialogue ──────────────────────────────────
	{
		keywords: ["communication", "dialogue", "response", "tone", "style"],
		relevantFor: ["general", "research"],
		priority: 3,
	},

	// ── Tools and capabilities ──────────────────────────────────────
	{
		keywords: ["tool", "capability", "available", "mcp", "chitragupta"],
		relevantFor: ["research", "memory", "general"],
		priority: 2,
	},

	// ── Repos and publishing ────────────────────────────────────────
	{
		keywords: ["repo", "publish", "npm", "package", "monorepo"],
		relevantFor: ["config", "git"],
		priority: 2,
	},

	// ── Refactoring ─────────────────────────────────────────────────
	{
		keywords: ["refactor", "multi-file", "loc", "line count"],
		relevantFor: ["code-refactor", "code-write"],
		priority: 1,
	},

	// ── Parallel / worktree ─────────────────────────────────────────
	{
		keywords: ["parallel", "worktree", "session", "agent"],
		relevantFor: ["git", "config", "research"],
		priority: 2,
	},
] as const;

// ── Section Parsing ──────────────────────────────────────────────────────────

/**
 * Estimate token count from character count.
 * Uses the standard approximation of 1 token ~ 4 characters.
 *
 * @param text - The text to estimate tokens for.
 * @returns Estimated token count.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Convert a markdown heading to a kebab-case section ID.
 *
 * @param heading - Raw heading text (e.g., "## Git Rules").
 * @returns Kebab-case ID (e.g., "git-rules").
 */
export function headingToId(heading: string): string {
	return heading
		.replace(/^#+\s*/, "")          // Remove leading ## markers
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")   // Remove non-alphanumeric except spaces/dashes
		.trim()
		.replace(/\s+/g, "-")           // Spaces to dashes
		.replace(/-+/g, "-")            // Collapse multiple dashes
		.replace(/^-|-$/g, "");          // Trim leading/trailing dashes
}

/**
 * Determine the relevance and priority of a section based on its heading.
 * Matches heading text against HEADING_RULES keyword patterns.
 *
 * @param heading - The section heading text.
 * @returns Object with relevantFor task types and priority level.
 */
export function tagSection(heading: string): { relevantFor: TaskType[]; priority: number } {
	const lowerHeading = heading.toLowerCase();

	for (const rule of HEADING_RULES) {
		const matched = rule.keywords.some((kw) => lowerHeading.includes(kw));
		if (matched) {
			return {
				relevantFor: [...rule.relevantFor],
				priority: rule.priority,
			};
		}
	}

	// Default: relevant for general tasks, low priority
	return {
		relevantFor: ["general", "research"],
		priority: 3,
	};
}

/**
 * Parse raw markdown content into tagged context sections.
 *
 * Splits on ## headings (level 2). Each heading becomes a section with
 * auto-assigned relevance and priority based on heading text keywords.
 * Content before the first heading is treated as a preamble section
 * with priority 0 (always included).
 *
 * @param rawContent - Raw markdown content from a context file.
 * @returns Array of parsed and tagged context sections.
 *
 * @example
 * ```ts
 * const sections = parseContextSections("## Git Rules\nAlways push to dev.\n\n## Testing\nRun vitest.");
 * // sections[0].id === "git-rules"
 * // sections[0].relevantFor includes "git"
 * ```
 */
export function parseContextSections(rawContent: string): ContextSection[] {
	if (!rawContent || rawContent.trim().length === 0) {
		return [];
	}

	const sections: ContextSection[] = [];
	const lines = rawContent.split("\n");

	let currentHeading = "";
	let currentLines: string[] = [];
	let inPreamble = true;

	/**
	 * Flush the accumulated lines into a section.
	 */
	function flushSection(): void {
		const content = currentLines.join("\n").trim();
		if (content.length === 0) return;

		if (inPreamble) {
			// Preamble (content before first heading) is always-include
			sections.push({
				id: "preamble",
				heading: "Preamble",
				content,
				relevantFor: ["code-write", "code-fix", "code-refactor", "code-review", "test", "config", "research", "git", "memory", "general"],
				priority: 0,
				tokenEstimate: estimateTokens(content),
			});
		} else {
			const tag = tagSection(currentHeading);
			sections.push({
				id: headingToId(currentHeading),
				heading: currentHeading.replace(/^#+\s*/, ""),
				content,
				relevantFor: tag.relevantFor,
				priority: tag.priority,
				tokenEstimate: estimateTokens(content),
			});
		}
	}

	for (const line of lines) {
		// Detect ## headings (level 2 or higher)
		const headingMatch = /^(#{1,3})\s+/.exec(line);
		if (headingMatch) {
			// Flush previous section
			flushSection();
			currentHeading = line;
			currentLines = [line];
			inPreamble = false;
		} else {
			currentLines.push(line);
		}
	}

	// Flush the last section
	flushSection();

	return sections;
}

// ── Context Selection ────────────────────────────────────────────────────────

/**
 * Select context sections relevant to the given task type within a token budget.
 *
 * Selection algorithm:
 * 1. Always include priority-0 sections (critical rules, identity).
 * 2. Include sections whose relevantFor includes the task type.
 * 3. Sort included sections by priority (lower = more important).
 * 4. If over budget, drop sections from highest priority number first.
 *
 * @param sections - All parsed context sections.
 * @param taskType - The classified task type to select context for.
 * @param config - Optional selection configuration.
 * @returns Concatenated context string with only the relevant sections.
 *
 * @example
 * ```ts
 * const selected = selectContext(sections, "git", { tokenBudget: 2000 });
 * // Returns only git-relevant sections, within ~2000 tokens
 * ```
 */
export function selectContext(
	sections: ContextSection[],
	taskType: TaskType,
	config?: ContextSelectionConfig,
): string {
	const budget = config?.tokenBudget ?? 4000;
	const alwaysIncludeCritical = config?.alwaysIncludeCritical ?? true;

	// Partition into critical (priority 0) and filtered sections
	const critical: ContextSection[] = [];
	const relevant: ContextSection[] = [];

	for (const section of sections) {
		if (alwaysIncludeCritical && section.priority === 0) {
			critical.push(section);
		} else if (section.relevantFor.includes(taskType)) {
			relevant.push(section);
		}
	}

	// Sort relevant sections by priority (lower = more important)
	relevant.sort((a, b) => a.priority - b.priority);

	// Build result within budget
	const result: ContextSection[] = [];
	let totalTokens = 0;

	// Always include critical sections first
	for (const section of critical) {
		totalTokens += section.tokenEstimate;
		result.push(section);
	}

	// Add relevant sections until budget is exhausted
	for (const section of relevant) {
		if (totalTokens + section.tokenEstimate > budget) {
			// Over budget -- skip this section
			continue;
		}
		totalTokens += section.tokenEstimate;
		result.push(section);
	}

	// Join sections with double newlines
	return result.map((s) => s.content).join("\n\n");
}

/**
 * Get a summary of which sections were selected vs. dropped.
 * Useful for debugging and transparency.
 *
 * @param sections - All parsed sections.
 * @param taskType - The task type used for selection.
 * @param config - Optional selection configuration.
 * @returns Summary object with included/excluded section IDs and token stats.
 */
export function getSelectionSummary(
	sections: ContextSection[],
	taskType: TaskType,
	config?: ContextSelectionConfig,
): { included: string[]; excluded: string[]; totalTokens: number; budgetTokens: number } {
	const budget = config?.tokenBudget ?? 4000;
	const alwaysIncludeCritical = config?.alwaysIncludeCritical ?? true;

	const included: string[] = [];
	const excluded: string[] = [];
	let totalTokens = 0;

	// Collect critical
	const critical: ContextSection[] = [];
	const relevant: ContextSection[] = [];
	const rest: ContextSection[] = [];

	for (const section of sections) {
		if (alwaysIncludeCritical && section.priority === 0) {
			critical.push(section);
		} else if (section.relevantFor.includes(taskType)) {
			relevant.push(section);
		} else {
			rest.push(section);
		}
	}

	relevant.sort((a, b) => a.priority - b.priority);

	for (const s of critical) {
		totalTokens += s.tokenEstimate;
		included.push(s.id);
	}

	for (const s of relevant) {
		if (totalTokens + s.tokenEstimate > budget) {
			excluded.push(s.id);
			continue;
		}
		totalTokens += s.tokenEstimate;
		included.push(s.id);
	}

	for (const s of rest) {
		excluded.push(s.id);
	}

	return { included, excluded, totalTokens, budgetTokens: budget };
}
