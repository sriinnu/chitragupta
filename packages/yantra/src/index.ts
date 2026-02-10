/**
 * @chitragupta/yantra — Built-in tool system for Chitragupta.
 *
 * All tools are ToolHandler plugins conforming to the standard interface.
 * They can be individually imported, replaced, or extended.
 *
 * @example
 * ```ts
 * import { getAllTools, getToolByName } from "@chitragupta/yantra";
 *
 * const tools = getAllTools();
 * const readTool = getToolByName("read");
 * ```
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
	ToolDefinition,
	ToolContext,
	ToolResult,
	ToolHandler,
} from "./types.js";

// ─── Individual Tool Handlers ───────────────────────────────────────────────

import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { bashTool } from "./bash.js";
import { grepTool } from "./grep.js";
import { findTool } from "./find.js";
import { lsTool } from "./ls.js";
import { memoryTool } from "./memory-tool.js";
import { sessionTool } from "./session-tool.js";
import { diffTool } from "./diff.js";
import { watchTool } from "./watch.js";
import { projectAnalysisTool } from "./project-analysis.js";

export {
	readTool,
	writeTool,
	editTool,
	bashTool,
	grepTool,
	findTool,
	lsTool,
	memoryTool,
	sessionTool,
	diffTool,
	watchTool,
	projectAnalysisTool,
};

// ─── Runtime Configuration ──────────────────────────────────────────────────

export { configureGrep } from "./grep.js";
export type { GrepConfig } from "./grep.js";

export { configureRead } from "./read.js";
export type { ReadConfig } from "./read.js";

export { configureBash } from "./bash.js";
export type { BashConfig } from "./bash.js";

// ─── Diff utilities (public API) ────────────────────────────────────────────
export { computeUnifiedDiff } from "./diff.js";

// ─── Tool Registry Helpers ──────────────────────────────────────────────────

import type { ToolHandler } from "./types.js";

/**
 * All built-in tool handlers, in a stable order.
 */
const ALL_TOOLS: ToolHandler[] = [
	readTool,
	writeTool,
	editTool,
	bashTool,
	grepTool,
	findTool,
	lsTool,
	memoryTool,
	sessionTool,
	diffTool,
	watchTool,
	projectAnalysisTool,
];

/**
 * Returns all built-in tool handlers.
 */
export function getAllTools(): ToolHandler[] {
	return [...ALL_TOOLS];
}

/**
 * Look up a built-in tool handler by its definition name.
 * Returns undefined if no tool matches.
 */
export function getToolByName(name: string): ToolHandler | undefined {
	return ALL_TOOLS.find((t) => t.definition.name === name);
}

// ─── Framework / Language Detection ─────────────────────────────────────────

export {
	SKIP_DIRS,
	BINARY_EXTENSIONS,
	detectLanguages,
	detectFrameworks,
	findEntryPoints,
	analyzeDependencies,
	countLines,
	analyzeFileTypes,
} from "./framework-detectors.js";
export type { FileTypeCount, DependencyInfo, LargestFile } from "./framework-detectors.js";

// ─── Sandbox (Kshetra) ─────────────────────────────────────────────────────

export { Sandbox } from "./sandbox.js";
export type { SandboxConfig, SandboxInfo } from "./sandbox.js";
