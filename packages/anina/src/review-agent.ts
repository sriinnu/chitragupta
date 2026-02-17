/**
 * @chitragupta/anina — Parikshaka (परीक्षक) — Code Review Agent.
 *
 * Reads code changes and provides structured review feedback:
 * - Bug detection: null checks, off-by-one, race conditions
 * - Style issues: naming, formatting, consistency
 * - Architecture: coupling, cohesion, separation of concerns
 * - Security: injection, XSS, secrets, permissions
 * - Performance: unnecessary allocations, O(n²) patterns, memory leaks
 *
 * In Sanskrit, parikshaka is the examiner — one who inspects, tests, and judges.
 * A code reviewer examines changes with a critical eye, never modifying code itself.
 */

import { PARIKSHAKA_PROFILE } from "@chitragupta/core";

import { Agent } from "./agent.js";
import { safeExecSync, validateCommand } from "./safe-exec.js";
import type { AgentConfig, AgentMessage, ToolHandler } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Tool names allowed for review tasks.
 * Reviewers read and search — they NEVER write or edit.
 */
export const REVIEW_TOOL_NAMES = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"diff",
	"bash",
]);

/** Severity ordering for score calculation. Higher index = more severe. */
const SEVERITY_WEIGHT: Record<ReviewSeverity, number> = {
	info: 0.5,
	warning: 1,
	error: 2,
	critical: 4,
};

/** Category labels the agent uses in structured output. */
const CATEGORY_PATTERNS: Record<ReviewFocus, RegExp> = {
	bugs: /^\s*(?:BUG|BUGS?):/im,
	style: /^\s*(?:STYLE|FORMATTING):/im,
	architecture: /^\s*(?:ARCH(?:ITECTURE)?|DESIGN):/im,
	security: /^\s*(?:SEC(?:URITY)?):/im,
	performance: /^\s*(?:PERF(?:ORMANCE)?):/im,
	testing: /^\s*(?:TEST(?:ING)?):/im,
};

/** Maps severity label text to the severity enum value. */
const SEVERITY_PATTERNS: Record<string, ReviewSeverity> = {
	critical: "critical",
	error: "error",
	warning: "warning",
	warn: "warning",
	info: "info",
	note: "info",
};

// ─── Types ───────────────────────────────────────────────────────────────────

/** Areas of focus for the review. */
export type ReviewFocus = "bugs" | "style" | "architecture" | "security" | "performance" | "testing";

/** Severity levels for review issues. */
export type ReviewSeverity = "info" | "warning" | "error" | "critical";

/** A single issue found during review. */
export interface ReviewIssue {
	severity: ReviewSeverity;
	category: ReviewFocus;
	file: string;
	line?: number;
	message: string;
	suggestion?: string;
}

/** Aggregated result of a code review. */
export interface ReviewResult {
	issues: ReviewIssue[];
	summary: string;
	filesReviewed: string[];
	/** Quality score from 0 (terrible) to 10 (exemplary). */
	overallScore: number;
}

/** Configuration for creating a review agent. */
export interface ReviewAgentConfig {
	workingDirectory: string;
	/** Review focus areas. Default: all. */
	focus?: ReviewFocus[];
	/** Severity threshold. Default: "info". */
	minSeverity?: ReviewSeverity;
	/** Maximum issues to report. Default: 20. */
	maxIssues?: number;
	/** Provider and model overrides. */
	providerId?: string;
	modelId?: string;
	/** Parent agent for sub-agent spawning. */
	parentAgent?: Agent;
	/**
	 * Tool handlers to use. If not provided, the agent has no tools.
	 * Use REVIEW_TOOL_NAMES to filter a full tool set to review-relevant tools.
	 */
	tools?: ToolHandler[];
	/** CommHub for IPC. */
	commHub?: AgentConfig["commHub"];
	/** Policy engine adapter. */
	policyEngine?: AgentConfig["policyEngine"];
	/** Samiti for ambient channel broadcasts. */
	samiti?: AgentConfig["samiti"];
	/** Lokapala guardians for tool call scanning. */
	lokapala?: AgentConfig["lokapala"];
	/** ActorSystem for P2P mesh communication. */
	actorSystem?: AgentConfig["actorSystem"];
	/** KaalaBrahma lifecycle manager. */
	kaala?: AgentConfig["kaala"];
}

// ─── ReviewAgent ─────────────────────────────────────────────────────────────

/**
 * Parikshaka -- a code review agent that reads code and provides
 * structured feedback on bugs, style, architecture, security, and performance.
 * Read-only: never modifies files.
 *
 * @example
 * ```ts
 * import { ReviewAgent } from "@chitragupta/anina";
 * import { getAllTools } from "@chitragupta/yantra";
 *
 * const reviewer = new ReviewAgent({
 *   workingDirectory: "/path/to/project",
 *   tools: getAllTools(),
 *   focus: ["bugs", "security"],
 * });
 * const result = await reviewer.reviewFiles(["src/auth.ts"]);
 * console.log(result.overallScore, result.issues.length);
 * ```
 */
export class ReviewAgent {
	private agent: Agent;
	private config: ReviewAgentConfig & {
		focus: ReviewFocus[];
		minSeverity: ReviewSeverity;
		maxIssues: number;
	};

	constructor(config: ReviewAgentConfig) {
		this.config = {
			...config,
			focus: config.focus ?? ["bugs", "style", "architecture", "security", "performance", "testing"],
			minSeverity: config.minSeverity ?? "info",
			maxIssues: config.maxIssues ?? 20,
		};

		// Filter tools to review-only subset (NO write/edit — reviewers don't modify code)
		const tools = config.tools
			? config.tools.filter((t) => REVIEW_TOOL_NAMES.has(t.definition.name))
			: [];

		const agentConfig: AgentConfig = {
			profile: PARIKSHAKA_PROFILE,
			providerId: config.providerId ?? "anthropic",
			model: config.modelId ?? PARIKSHAKA_PROFILE.preferredModel ?? "claude-sonnet-4-5-20250929",
			tools,
			thinkingLevel: PARIKSHAKA_PROFILE.preferredThinking ?? "high",
			workingDirectory: config.workingDirectory,
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
	 * Review specific files.
	 * Reads each file and sends content to the agent for structured review.
	 */
	async reviewFiles(filePaths: string[]): Promise<ReviewResult> {
		const focusStr = this.config.focus.join(", ");
		const prompt = [
			`Review the following ${filePaths.length} file(s) for issues.`,
			`Focus areas: ${focusStr}`,
			`Minimum severity: ${this.config.minSeverity}`,
			`Maximum issues to report: ${this.config.maxIssues}`,
			"",
			"Files to review:",
			...filePaths.map((f) => `- ${f}`),
			"",
			"Read each file and provide your review.",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseReviewResponse(response, filePaths);
	}

	/**
	 * Review a git diff (staged, unstaged, or between refs).
	 *
	 * @param diffSpec - Git diff specifier. Examples:
	 *   - `undefined` or `""` — unstaged changes (`git diff`)
	 *   - `"--staged"` — staged changes
	 *   - `"main..HEAD"` — changes between refs
	 *   - `"abc123"` — changes since a specific commit
	 */
	async reviewDiff(diffSpec?: string): Promise<ReviewResult> {
		const diffCmd = diffSpec ? `git diff ${diffSpec}` : "git diff";
		let diffOutput: string;

		// ── Security gate: validate the constructed command ──
		validateCommand(diffCmd);

		try {
			diffOutput = safeExecSync(diffCmd, {
				cwd: this.config.workingDirectory,
				encoding: "utf-8",
				timeout: 30_000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err: unknown) {
			const execErr = err as { stdout?: string; stderr?: string; message?: string };
			// If this is a validation error, re-throw immediately
			if (execErr.message?.startsWith("Command rejected:")) {
				throw err;
			}
			diffOutput = execErr.stdout ?? execErr.stderr ?? "Failed to get diff";
		}

		if (!diffOutput.trim()) {
			return {
				issues: [],
				summary: "No changes to review.",
				filesReviewed: [],
				overallScore: 10,
			};
		}

		// Extract file names from the diff
		const filesReviewed = this.extractFilesFromDiff(diffOutput);
		const focusStr = this.config.focus.join(", ");

		const prompt = [
			"Review the following git diff for issues.",
			`Focus areas: ${focusStr}`,
			`Minimum severity: ${this.config.minSeverity}`,
			`Maximum issues to report: ${this.config.maxIssues}`,
			"",
			"```diff",
			diffOutput,
			"```",
			"",
			this.buildOutputInstructions(),
		].join("\n");

		const response = await this.agent.prompt(prompt);
		return this.parseReviewResponse(response, filesReviewed);
	}

	/**
	 * Review changes since last commit (shorthand for `reviewDiff("HEAD")`).
	 */
	async reviewChanges(): Promise<ReviewResult> {
		return this.reviewDiff("HEAD");
	}

	/** Get the underlying agent instance. */
	getAgent(): Agent {
		return this.agent;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────────

	/**
	 * Build the output format instructions for the review prompt.
	 */
	private buildOutputInstructions(): string {
		return [
			"Format your response as follows:",
			"",
			"SUMMARY: <1-3 sentence overview of code quality>",
			"SCORE: <number 0-10>",
			"",
			"Then list issues, one per block:",
			"",
			"<SEVERITY>: <CATEGORY>: <file>:<line> <message>",
			"SUGGESTION: <how to fix>",
			"",
			"Where SEVERITY is one of: CRITICAL, ERROR, WARNING, INFO",
			"Where CATEGORY is one of: BUG, STYLE, ARCHITECTURE, SECURITY, PERFORMANCE, TESTING",
			"",
			"Example:",
			"ERROR: BUG: src/auth.ts:42 Possible null dereference — `user` can be undefined when session expires",
			"SUGGESTION: Add a null check before accessing user.id",
			"",
			"If no issues are found, just provide the SUMMARY and SCORE.",
		].join("\n");
	}

	/**
	 * Parse the agent's response into a structured ReviewResult.
	 */
	private parseReviewResponse(message: AgentMessage, filesReviewed: string[]): ReviewResult {
		const text = this.extractText(message);
		const issues = this.parseIssues(text);
		const summary = this.parseSummary(text);
		const overallScore = this.parseScore(text, issues);

		// Filter by minimum severity
		const severityOrder: ReviewSeverity[] = ["info", "warning", "error", "critical"];
		const minIdx = severityOrder.indexOf(this.config.minSeverity);
		const filtered = issues.filter((i) => severityOrder.indexOf(i.severity) >= minIdx);

		// Cap at maxIssues
		const capped = filtered.slice(0, this.config.maxIssues);

		return {
			issues: capped,
			summary,
			filesReviewed,
			overallScore,
		};
	}

	/**
	 * Parse individual issues from the agent's text response.
	 */
	private parseIssues(text: string): ReviewIssue[] {
		const issues: ReviewIssue[] = [];
		const lines = text.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			// Match pattern: SEVERITY: CATEGORY: file:line message
			const issueMatch = line.match(
				/^(CRITICAL|ERROR|WARNING|WARN|INFO|NOTE):\s*(BUG|BUGS|STYLE|FORMATTING|ARCH(?:ITECTURE)?|DESIGN|SEC(?:URITY)?|PERF(?:ORMANCE)?|TEST(?:ING)?):\s*(\S+?)(?::(\d+))?\s+(.+)/i,
			);

			if (issueMatch) {
				const severity = SEVERITY_PATTERNS[issueMatch[1].toLowerCase()] ?? "info";
				const category = this.normalizeCategory(issueMatch[2]);
				const file = issueMatch[3];
				const lineNum = issueMatch[4] ? parseInt(issueMatch[4], 10) : undefined;
				const message = issueMatch[5];

				// Check next line for suggestion
				let suggestion: string | undefined;
				if (i + 1 < lines.length) {
					const nextLine = lines[i + 1].trim();
					const sugMatch = nextLine.match(/^SUGGESTION:\s*(.+)/i);
					if (sugMatch) {
						suggestion = sugMatch[1];
						i++; // Skip the suggestion line
					}
				}

				issues.push({ severity, category, file, line: lineNum, message, suggestion });
			}
		}

		return issues;
	}

	/**
	 * Parse the summary from the agent's response.
	 */
	private parseSummary(text: string): string {
		const match = text.match(/SUMMARY:\s*(.+?)(?:\n|$)/i);
		if (match) return match[1].trim();

		// Fallback: first non-empty line
		const firstLine = text.split("\n").find((l) => l.trim().length > 0);
		return firstLine?.trim() ?? "Review completed.";
	}

	/**
	 * Parse or compute the overall quality score.
	 */
	private parseScore(text: string, issues: ReviewIssue[]): number {
		// Try to parse explicit SCORE from response
		const match = text.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
		if (match) {
			const parsed = parseFloat(match[1]);
			return Math.max(0, Math.min(10, parsed));
		}

		// Compute from issue severities: start at 10, deduct by severity weight
		let score = 10;
		for (const issue of issues) {
			score -= SEVERITY_WEIGHT[issue.severity];
		}
		return Math.max(0, Math.round(score * 10) / 10);
	}

	/**
	 * Normalize a category string from the parsed output to a ReviewFocus value.
	 */
	private normalizeCategory(raw: string): ReviewFocus {
		const lower = raw.toLowerCase();
		if (lower === "bug" || lower === "bugs") return "bugs";
		if (lower === "style" || lower === "formatting") return "style";
		if (lower.startsWith("arch") || lower === "design") return "architecture";
		if (lower.startsWith("sec")) return "security";
		if (lower.startsWith("perf")) return "performance";
		if (lower.startsWith("test")) return "testing";
		return "bugs"; // Default fallback
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

	/**
	 * Extract file paths from a unified diff output.
	 */
	private extractFilesFromDiff(diff: string): string[] {
		const files = new Set<string>();
		const lines = diff.split("\n");

		for (const line of lines) {
			// Match "diff --git a/path b/path" or "+++ b/path"
			const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\//);
			if (gitDiffMatch) {
				files.add(gitDiffMatch[1]);
				continue;
			}
			const plusMatch = line.match(/^\+\+\+ b\/(.+)/);
			if (plusMatch && plusMatch[1] !== "/dev/null") {
				files.add(plusMatch[1]);
			}
		}

		return [...files];
	}
}
