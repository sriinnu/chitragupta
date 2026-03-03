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

/**
 * Lifecycle hook names for the extension system.
 *
 * Pi-inspired hooks beyond the original 7:
 * - onInput: intercept/transform user messages before LLM processing
 * - onBeforeAgentStart: inject messages or modify system prompt
 * - onModelSelect: triggered on model switching
 * - onCompact: triggered on context compaction
 * - onSessionSwitch: triggered when switching between sessions
 */
export type ExtensionHookName =
	| "onSessionStart"
	| "onSessionEnd"
	| "onTurnStart"
	| "onTurnEnd"
	| "onToolCall"
	| "onToolResult"
	| "onError"
	| "onInput"
	| "onBeforeAgentStart"
	| "onModelSelect"
	| "onCompact"
	| "onSessionSwitch"
	| "onResourcesDiscover"
	| "onBashSpawn";

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

/** Context for onInput — intercept/transform user messages. */
export interface InputContext {
	/** Raw user input text. */
	text: string;
	/** Session ID if available. */
	sessionId?: string;
	/** Set to replace text before processing. */
	transformed?: string;
	/** Set to true to block the message entirely. */
	blocked?: boolean;
	/** Reason for blocking (shown to user). */
	blockReason?: string;
}

/** Context for onBeforeAgentStart — inject context before LLM call. */
export interface BeforeAgentContext {
	sessionId: string;
	/** System prompt segments. Extensions can push additional segments. */
	systemPromptSegments: string[];
	/** Model being used. */
	model: string;
}

/** Context for onModelSelect — triggered on model switch. */
export interface ModelSelectContext {
	previousModel: string;
	newModel: string;
	sessionId?: string;
}

/** Context for onCompact — triggered on context compaction. */
export interface CompactContext {
	sessionId: string;
	turnsBefore: number;
	turnsAfter: number;
}

/** Context for onSessionSwitch — triggered when switching sessions. */
export interface SessionSwitchContext {
	fromSessionId: string | null;
	toSessionId: string;
	projectPath: string;
}

/** Context for onResourcesDiscover — triggered during resource/tool discovery. */
export interface ResourcesDiscoverContext {
	/** Root project path for the discovery scope. */
	projectPath: string;
	/** Names of currently registered tools. */
	tools: string[];
	/** URIs of already-known resources. */
	existingResources: string[];
}

/** Context passed to onBashSpawn hook before shell command execution. */
export interface BashSpawnContext {
	/** The command to execute. */
	command: string;
	/** Working directory for the command. */
	cwd: string;
	/** Environment variables (sanitized subset, no credentials). */
	env: Record<string, string>;
	/** Set to true to cancel execution. */
	cancel?: boolean;
	/** Reason for cancellation (shown to user). */
	cancelReason?: string;
	/** Modified command (if extension wants to rewrite). */
	modifiedCommand?: string;
	/** Modified working directory. */
	modifiedCwd?: string;
}

/** Hook handler function signatures — 13 lifecycle hooks. */
export interface ExtensionHooks {
	onSessionStart?: (ctx: SessionContext) => void | Promise<void>;
	onSessionEnd?: (ctx: SessionContext) => void | Promise<void>;
	onTurnStart?: (ctx: TurnContext) => void | Promise<void>;
	onTurnEnd?: (ctx: TurnContext) => void | Promise<void>;
	onToolCall?: (ctx: ToolCallContext) => void | Promise<void>;
	onToolResult?: (ctx: ToolResultContext) => void | Promise<void>;
	onError?: (ctx: ErrorContext) => void | Promise<void>;
	onInput?: (ctx: InputContext) => void | Promise<void>;
	onBeforeAgentStart?: (ctx: BeforeAgentContext) => void | Promise<void>;
	onModelSelect?: (ctx: ModelSelectContext) => void | Promise<void>;
	onCompact?: (ctx: CompactContext) => void | Promise<void>;
	onSessionSwitch?: (ctx: SessionSwitchContext) => void | Promise<void>;
	onResourcesDiscover?: (ctx: ResourcesDiscoverContext) => void | Promise<void>;
	onBashSpawn?: (ctx: BashSpawnContext) => void | Promise<void>;
}

/** Command registration for extensions (pi-inspired). */
export interface ExtensionCommand {
	/** Command name (e.g., "nanny", "ssh-connect"). */
	name: string;
	/** Short description shown in help. */
	description: string;
	/** Execute the command. */
	execute: (args: string[]) => void | Promise<void>;
}

/** Keyboard shortcut registration for extensions. */
export interface ExtensionShortcut {
	/** Key combination (e.g., "ctrl+shift+s"). */
	keys: string;
	/** Short description. */
	description: string;
	/** Handler function. */
	handler: () => void | Promise<void>;
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
	/** Custom commands (pi-inspired). */
	commands?: ExtensionCommand[];
	/** Custom keyboard shortcuts (pi-inspired). */
	shortcuts?: ExtensionShortcut[];
	/** Called when the extension is loaded. Receives the ExtensionAPI. */
	activate?: (api: ExtensionAPI) => void | Promise<void>;
	/** Called when the extension is unloaded. */
	deactivate?: () => void | Promise<void>;
}

/**
 * Extension API — passed to activate() for runtime registration.
 *
 * Inspired by pi's ExtensionAPI: supports runtime tool registration,
 * command registration, and session control without module-level exports.
 */
export interface ExtensionAPI {
	/** Register a tool at runtime (available immediately). */
	registerTool(handler: McpToolHandler): void;
	/** Register a command at runtime. */
	registerCommand(command: ExtensionCommand): void;
	/** Register a keyboard shortcut at runtime. */
	registerShortcut(shortcut: ExtensionShortcut): void;
	/** Get the current working directory. */
	cwd(): string;
	/** Get the current session ID (null if no session). */
	sessionId(): string | null;
	/** Get current model name. */
	model(): string | null;
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
