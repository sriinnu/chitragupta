/**
 * MCP Prompts & Resources.
 *
 * Prompt handlers (slash-command shortcuts) and resource definitions for the
 * Chitragupta MCP server. Each prompt maps to a common workflow pattern.
 *
 * @module
 */

import type { McpResourceHandler, McpContent, McpPromptHandler } from "@chitragupta/tantra";
import { loadProjectMemory } from "../bootstrap.js";

// ─── Resource ───────────────────────────────────────────────────────────────

/** Create an MCP resource for project memory. */
export function createMemoryResource(projectPath: string): McpResourceHandler {
	return {
		definition: {
			uri: "chitragupta://memory/project",
			name: "Project Memory",
			description: "Chitragupta's project memory file (MEMORY.md) containing learned patterns, conventions, and decisions.",
			mimeType: "text/markdown",
		},
		async read(_uri: string): Promise<McpContent[]> {
			const content = loadProjectMemory(projectPath);
			return [{ type: "text", text: content ?? "No project memory found." }];
		},
	};
}

// ─── Prompt Helper ──────────────────────────────────────────────────────────

/** Shorthand factory for MCP prompt handlers. */
function prompt(
	name: string,
	description: string,
	args: { name: string; description: string; required: boolean }[],
	getText: (a: Record<string, string>) => string,
): McpPromptHandler {
	return {
		definition: { name, description, arguments: args },
		async get(a: Record<string, string>): Promise<McpContent[]> {
			return [{ type: "text", text: getText(a) }];
		},
	};
}

// ─── Prompt Factories ───────────────────────────────────────────────────────

/** Save decisions, patterns, or solutions to memory. */
export const createSavePrompt = (): McpPromptHandler => prompt(
	"save", "Save decisions, patterns, or solutions to memory.", [
		{ name: "what", description: "What to remember", required: false },
		{ name: "type", description: "solution | pattern | warning | shortcut | correction | preference", required: false },
	],
	(a) => {
		const what = a.what || "";
		const t = a.type || "solution";
		return what
			? `Save to memory: "${what}"\nCall akasha_deposit with type="${t}" and relevant topic tags. Confirm what was saved.`
			: "Review this conversation for key decisions, solutions, patterns, and warnings. Save each one via akasha_deposit with the appropriate type. Summarize what was saved.";
	},
);

/** Recall the last session. */
export const createLastSessionPrompt = (): McpPromptHandler => prompt(
	"last_session", "Recall the last session — what was worked on, decisions, and unfinished tasks.", [],
	() => "Call chitragupta_session_list (limit 1), then chitragupta_session_show to load it. Summarize: what was worked on, key decisions, files modified, unfinished work.",
);

/** Review code for issues. */
export const createReviewPrompt = (): McpPromptHandler => prompt(
	"code_review", "Review code for issues, security, and quality.", [
		{ name: "file", description: "File path to review", required: true },
		{ name: "focus", description: "security | performance | style | all", required: false },
	],
	(a) => `Review "${a.file || ""}" (focus: ${a.focus || "all"}). Report: critical issues, suggestions, and good patterns found.`,
);

/** Search project memory. */
export const createMemorySearchPrompt = (): McpPromptHandler => prompt(
	"memory_search", "Search project memory for past decisions and context.", [
		{ name: "query", description: "What to search for", required: true },
	],
	(a) => `Call chitragupta_memory_search for "${a.query || ""}". Also check chitragupta_session_list for related sessions. Summarize what was found.`,
);

/** Browse or restore sessions. */
export const createSessionPrompt = (): McpPromptHandler => prompt(
	"session", "Browse or restore past sessions.", [
		{ name: "session_id", description: "Session ID to load (omit to list recent)", required: false },
	],
	(a) => a.session_id
		? `Load session ${a.session_id} via chitragupta_session_show. Summarize: what was worked on, decisions, unfinished work.`
		: "Call chitragupta_session_list. Present the list with dates and titles.",
);

/** Save work state before session ends. */
export const createHandoverPrompt = (): McpPromptHandler => prompt(
	"handover", "Save work state before session ends — files, decisions, errors, next steps.", [
		{ name: "summary", description: "Brief summary of current work (optional)", required: false },
	],
	(a) => (a.summary ? `Context: ${a.summary}\n` : "") + "Call chitragupta_handover to generate a structured work-state summary. Save key outcomes via akasha_deposit.",
);

/** Investigate an error. */
export const createDebugPrompt = (): McpPromptHandler => prompt(
	"debug", "Investigate an error — reproduce, trace, isolate, fix.", [
		{ name: "issue", description: "The error or unexpected behavior", required: true },
		{ name: "file", description: "Suspected file (optional)", required: false },
	],
	(a) => `Debug: "${a.issue || ""}"${a.file ? ` in ${a.file}` : ""}. Check chitragupta memory first. Then: reproduce → hypothesize → trace → isolate → fix & verify.`,
);

/** Deep-dive codebase research. */
export const createResearchPrompt = (): McpPromptHandler => prompt(
	"research", "Deep-dive into codebase architecture — read-only analysis.", [
		{ name: "topic", description: "What to research", required: true },
	],
	(a) => `Research: "${a.topic || ""}". Search memory for prior analysis. Find relevant files, read them, trace data flow. Output: architecture overview, key files, patterns, dependencies. Read-only — do not modify files.`,
);

/** Plan-then-execute refactoring. */
export const createRefactorPrompt = (): McpPromptHandler => prompt(
	"refactor", "Plan-then-execute refactoring with validation.", [
		{ name: "target", description: "What to refactor (file, module, pattern)", required: true },
		{ name: "goal", description: "Desired outcome", required: false },
	],
	(a) => `Refactor: "${a.target || ""}"${a.goal ? ` — goal: ${a.goal}` : ""}. Analyze → present plan before changes → execute incrementally → validate after each step → deposit pattern in Akasha.`,
);

/** System health dashboard. */
export const createStatusPrompt = (): McpPromptHandler => prompt(
	"status", "Chitragupta system health — memory, sessions, knowledge traces.", [],
	() => "Call health_status for Triguna state. Call chitragupta_session_list (limit 5) for recent activity. Call akasha_traces with query 'recent' for knowledge state. Present a concise dashboard.",
);

/** Recall past decisions about a topic. */
export const createRecallPrompt = (): McpPromptHandler => prompt(
	"recall", "Remember what we decided about a topic.", [
		{ name: "topic", description: "What to recall (e.g. 'auth', 'database', 'deployment')", required: true },
	],
	(a) => `Recall everything about "${a.topic || ""}": call chitragupta_memory_search, akasha_traces, and check recent sessions. Present a timeline of decisions and current state.`,
);
