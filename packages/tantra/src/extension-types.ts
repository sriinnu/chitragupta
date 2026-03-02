/**
 * @chitragupta/tantra — Extension API Types.
 *
 * Defines the lifecycle hooks, extension manifest, and registration
 * interfaces for Chitragupta's extension system.
 *
 * Extensions can be placed in:
 *   - ~/.chitragupta/extensions/*.ts (global)
 *   - .chitragupta/extensions/*.ts (project-local)
 *
 * @module
 */

import type { McpToolHandler } from "./types.js";

/** Lifecycle hook names for the extension system. */
export type ExtensionHookName =
	| "onSessionStart"
	| "onSessionEnd"
	| "onTurnStart"
	| "onTurnEnd"
	| "onToolCall"
	| "onToolResult"
	| "onError";

/** Context passed to session lifecycle hooks. */
export interface SessionContext {
	sessionId: string;
	projectPath: string;
	transport: "stdio" | "sse";
	startedAt: number;
}

/** Context passed to turn lifecycle hooks. */
export interface TurnContext {
	sessionId: string;
	turnNumber: number;
	role: "user" | "assistant";
	content: string;
}

/** Context passed to tool call hooks. */
export interface ToolCallContext {
	toolName: string;
	args: Record<string, unknown>;
	sessionId: string;
	turnNumber: number;
}

/** Context passed to tool result hooks. */
export interface ToolResultContext extends ToolCallContext {
	result: unknown;
	durationMs: number;
	isError: boolean;
}

/** Context passed to error hooks. */
export interface ErrorContext {
	error: Error;
	source: string;
	sessionId?: string;
}

/** Hook handler function signatures. */
export interface ExtensionHooks {
	onSessionStart?: (ctx: SessionContext) => void | Promise<void>;
	onSessionEnd?: (ctx: SessionContext) => void | Promise<void>;
	onTurnStart?: (ctx: TurnContext) => void | Promise<void>;
	onTurnEnd?: (ctx: TurnContext) => void | Promise<void>;
	onToolCall?: (ctx: ToolCallContext) => void | Promise<void>;
	onToolResult?: (ctx: ToolResultContext) => void | Promise<void>;
	onError?: (ctx: ErrorContext) => void | Promise<void>;
}

/** Extension manifest — what an extension module must export. */
export interface ExtensionManifest {
	/** Unique extension name. */
	name: string;
	/** Semantic version string. */
	version: string;
	/** Short description. */
	description?: string;
	/** Lifecycle hooks this extension provides. */
	hooks?: ExtensionHooks;
	/** Custom MCP tools this extension registers. */
	tools?: McpToolHandler[];
	/** Called when the extension is loaded. */
	activate?: () => void | Promise<void>;
	/** Called when the extension is unloaded. */
	deactivate?: () => void | Promise<void>;
}

/** Loaded extension state. */
export interface LoadedExtension {
	manifest: ExtensionManifest;
	filePath: string;
	loadedAt: number;
	active: boolean;
	errors: string[];
}

/** Extension loader configuration. */
export interface ExtensionLoaderConfig {
	/** Global extensions directory. Default: ~/.chitragupta/extensions */
	globalDir?: string;
	/** Project-local extensions directory. Default: .chitragupta/extensions */
	projectDir?: string;
	/** Enable hot-reload via file watcher. Default: false */
	hotReload?: boolean;
	/** Maximum extensions to load. Default: 50 */
	maxExtensions?: number;
}
