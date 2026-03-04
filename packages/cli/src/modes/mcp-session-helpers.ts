/**
 * MCP Session Recording — Helpers.
 *
 * ANSI stripping, semantic content extraction, tool classification,
 * and noise filtering for session recording. Extracted from
 * mcp-session.ts to keep each file under 450 LOC.
 *
 * @module
 */

import { DaemonUnavailableError } from "@chitragupta/daemon";

// ─── ANSI & Text Helpers ────────────────────────────────────────────────────

/** Strip ANSI escape sequences from text. */
export function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");
}

/** Truncate long payloads before persisting in turn.toolCalls JSON. */
export function truncateForStorage(text: string, maxChars = 4000): string {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...[truncated]`;
}

/** Safely stringify a value for tool-call persistence (handles circular refs). */
export function stringifyForStorage(value: unknown, maxChars = 4000): string {
	try {
		return truncateForStorage(JSON.stringify(value), maxChars);
	} catch {
		return truncateForStorage(String(value), maxChars);
	}
}

// ─── Tool Classification ────────────────────────────────────────────────────

/** Tools whose args carry meaningful user intent (queries, tasks, proposals). */
export const SEMANTIC_TOOLS = new Set([
	"chitragupta_recall", "chitragupta_memory_search", "chitragupta_prompt",
	"chitragupta_record_conversation", "coding_agent", "sabha_deliberate",
	"akasha_deposit", "akasha_traces",
]);

/** Tools that return status/summary — store one-line summary, not full output. */
export const SUMMARY_TOOLS = new Set([
	"chitragupta_session_list", "chitragupta_session_show", "chitragupta_context",
	"chitragupta_day_show", "chitragupta_day_search", "chitragupta_vidhis",
	"mesh_status", "mesh_spawn", "health_status", "atman_report",
	"vasana_tendencies", "chitragupta_consolidate",
]);

/** Filesystem/shell tools — store action + path, not full content. */
export const FILE_TOOLS = new Set([
	"read", "write", "edit", "grep", "find", "ls", "bash", "diff", "watch",
	"project_analysis",
]);

// ─── Content Extraction ─────────────────────────────────────────────────────

/** Extract user intent string from tool args. */
export function extractIntent(args: Record<string, unknown>): string {
	for (const key of ["query", "message", "task", "proposal", "prompt", "content", "text"]) {
		const val = args[key];
		if (typeof val === "string" && val.length > 3 && val.length < 2000) {
			return val.slice(0, 500);
		}
	}
	return "";
}

/** Extract meaningful content from a tool call. Returns `[userContent, assistantContent]`. */
export function extractSemanticContent(
	tool: string,
	args: Record<string, unknown>,
	resultText: string,
	elapsedMs: number,
): [string, string] {
	const cleanResult = stripAnsi(resultText);

	if (SEMANTIC_TOOLS.has(tool)) {
		const intent = extractIntent(args);
		const summary = cleanResult.slice(0, 500);
		return [intent || `Used ${tool}`, `${tool}: ${summary}`];
	}

	if (FILE_TOOLS.has(tool)) {
		const filePath = String(args.path ?? args.file_path ?? args.pattern ?? "");
		const action = tool === "read" ? "Read" : tool === "write" ? "Wrote"
			: tool === "edit" ? "Edited" : tool === "grep" ? "Searched"
			: tool === "bash" ? "Ran" : `Used ${tool} on`;
		return [
			`${action} ${filePath}`.trim(),
			`${action} ${filePath} (${elapsedMs.toFixed(0)}ms)`.trim(),
		];
	}

	if (SUMMARY_TOOLS.has(tool)) {
		const intent = extractIntent(args);
		const summary = cleanResult.split("\n")[0]?.slice(0, 200) ?? "";
		return [intent, `${tool}: ${summary}`];
	}

	const intent = extractIntent(args);
	return [
		intent || `Used ${tool}`,
		`${tool}: ${cleanResult.slice(0, 300)}`,
	];
}

// ─── Error & Noise Detection ────────────────────────────────────────────────

/** Check if error indicates daemon is unreachable (socket errors, unavailable). */
export function isDaemonError(err: unknown): boolean {
	if (err instanceof DaemonUnavailableError) return true;
	const code = (err as NodeJS.ErrnoException).code;
	return typeof code === "string" && ["ECONNREFUSED", "ENOENT", "EPIPE", "ECONNRESET"].includes(code);
}

/** True when a synthetic "user" turn carries meaningful intent worth persisting. */
export function shouldPersistSyntheticUserTurn(content: string): boolean {
	const normalized = content.trim().toLowerCase();
	if (!normalized || normalized.length < 6) return false;
	if (/^(?:checked|used|read|ran|executed|called|invoked|loaded|opened)\b/.test(normalized)) return false;
	if (/^(?:used|checked)\s+(?:chitragupta_[a-z0-9_]+|mcp__[a-z0-9_]+)/i.test(normalized)) return false;
	if (/^\[compressed\]/i.test(normalized)) return false;
	return true;
}
