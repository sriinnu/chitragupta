/**
 * @chitragupta/tantra — Types for the dynamic tool registry (plugin system).
 *
 * Defines the contracts for tool plugins, registry events, snapshots,
 * and configuration that govern runtime tool registration and lifecycle.
 */

import type { McpToolHandler, McpTool } from "./types.js";

// ─── Plugin Definition ──────────────────────────────────────────────────────

/**
 * A tool plugin that bundles one or more McpToolHandler instances
 * under a single identity. Plugins are the unit of third-party extension.
 */
export interface ToolPlugin {
	/** Unique plugin identifier (e.g. "my-company/analytics-tools"). */
	id: string;
	/** Human-readable plugin name. */
	name: string;
	/** Semver version string. */
	version: string;
	/** Optional description of the plugin's purpose. */
	description?: string;
	/** The tool handlers this plugin provides. */
	tools: McpToolHandler[];
}

/**
 * Read-only information about a registered plugin (no handler references).
 */
export interface PluginInfo {
	/** Plugin identifier. */
	id: string;
	/** Human-readable name. */
	name: string;
	/** Semver version. */
	version: string;
	/** Optional description. */
	description?: string;
	/** Names of tools provided by this plugin. */
	toolNames: string[];
	/** Whether all tools in this plugin are currently enabled. */
	enabled: boolean;
}

// ─── Registry Events ────────────────────────────────────────────────────────

/**
 * Discriminated union of events emitted by the ToolRegistry.
 * Consumers subscribe to these to react to registry mutations
 * (e.g. sending MCP `notifications/tools/list_changed`).
 */
export type RegistryChangeEvent =
	| { type: "tool:registered"; toolName: string; pluginId: string | undefined }
	| { type: "tool:unregistered"; toolName: string }
	| { type: "tool:enabled"; toolName: string }
	| { type: "tool:disabled"; toolName: string }
	| { type: "plugin:registered"; pluginId: string; toolNames: string[] }
	| { type: "plugin:unregistered"; pluginId: string; toolNames: string[] };

/**
 * Callback type for registry change listeners.
 */
export type RegistryChangeListener = (event: RegistryChangeEvent) => void;

// ─── Registry Snapshot ──────────────────────────────────────────────────────

/**
 * Serializable snapshot of the registry state.
 * Useful for diagnostics, persistence, and debugging.
 */
export interface RegistrySnapshot {
	/** ISO-8601 timestamp when the snapshot was taken. */
	timestamp: string;
	/** Total number of registered tools. */
	totalTools: number;
	/** Number of currently enabled tools. */
	enabledTools: number;
	/** Number of currently disabled tools. */
	disabledTools: number;
	/** Per-tool metadata. */
	tools: ToolSnapshotEntry[];
	/** Per-plugin metadata. */
	plugins: PluginInfo[];
}

/**
 * Snapshot entry for a single tool.
 */
export interface ToolSnapshotEntry {
	/** The tool definition (name, description, inputSchema). */
	definition: McpTool;
	/** Whether the tool is currently enabled. */
	enabled: boolean;
	/** Plugin ID that owns this tool, or undefined if standalone. */
	pluginId: string | undefined;
}

// ─── Registry Configuration ─────────────────────────────────────────────────

/**
 * Configuration options for the ToolRegistry.
 */
export interface ToolRegistryConfig {
	/** If true, duplicate tool names throw immediately. Defaults to true. */
	strictNamespaces?: boolean;
	/** If true, inputSchema is validated on registration. Defaults to true. */
	validateSchemas?: boolean;
}

// ─── Plugin Config File Format ──────────────────────────────────────────────

/**
 * Shape of the `chitragupta-plugins.json` config file.
 */
export interface PluginConfigFile {
	plugins: PluginConfigEntry[];
}

/**
 * A single entry in the plugin config file.
 */
export interface PluginConfigEntry {
	/** Plugin identifier. */
	id: string;
	/** Local file path to the plugin directory. */
	path?: string;
	/** npm package name to import. */
	package?: string;
	/** Whether this plugin should be loaded. Defaults to true. */
	enabled?: boolean;
}
